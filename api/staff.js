// /api/staff — DermaLuxe staff dashboard backend (login + data + actions).
// Auth: WhatsApp OTP to an allow-listed staff phone. Owner = ADMIN_PHONES.
// Staff list: KV hash staff:users {phone → {name, role, added}} — owner manages
// via the dashboard Team tab or WhatsApp admin: "staff add 9xxxxxxxxx Name".
// Session: HMAC-signed bearer token (30 days). Roles: owner | staff.
const crypto = require("crypto");
const guard = require("./_guard.js");
const notify = require("./_notify.js");

const LEADS = "dl_leads", STATUS = "dl_status", NOTES = "dl_notes", USERS = "staff:users";

// ---- roles & capabilities ---------------------------------------------------
const CAPS = {
  "leads.view": "Leads & contact details", "leads.edit": "Lead status + call notes", "leads.delete": "Delete leads",
  "appts.view": "Appointments", "academy.view": "Academy students & seats", "academy.edit": "Add students, payments, documents",
  "academy.certify": "Issue certificates", "posts.view": "Today's post & queue", "posts.toggle": "Daily auto-post on/off",
  "reviews.view": "Patient ratings", "team.manage": "Staff logins & password", "ai.use": "AI Office assistant",
};
const ROLES = {
  owner:     { label: "Owner",     te: "ఓనర్",       caps: ["*"] },
  manager:   { label: "Manager",   te: "మేనేజర్",     caps: ["leads.view","leads.edit","appts.view","academy.view","academy.edit","academy.certify","posts.view","posts.toggle","reviews.view","ai.use"] },
  reception: { label: "Reception", te: "రిసెప్షన్",   caps: ["leads.view","leads.edit","appts.view","academy.view","posts.view","ai.use"] },
  therapist: { label: "Therapist", te: "థెరపిస్ట్",   caps: ["leads.view","appts.view","posts.view","ai.use"] },
  trainer:   { label: "Trainer",   te: "ట్రైనర్",     caps: ["academy.view","academy.edit","appts.view","ai.use"] },
  marketing: { label: "Marketing", te: "మార్కెటింగ్", caps: ["leads.view","posts.view","posts.toggle","reviews.view","ai.use"] },
  staff:     { label: "Staff",     te: "స్టాఫ్",      caps: ["leads.view","leads.edit","appts.view","academy.view","posts.view","ai.use"] },
};
const roleOf = (r) => (ROLES[String(r || "staff")] ? String(r) : "staff");
const capsOf = (r) => ROLES[roleOf(r)].caps;
const can = (u, cap) => { const c = capsOf(u && u.role); return c.includes("*") || c.includes(cap); };
const STATUSES = ["new", "contacted", "booked", "visited", "closed"];
const SESSION_DAYS = 30;

const secret = () => process.env.STAFF_SECRET || process.env.ADMIN_KEY || process.env.WA_WEBHOOK_TOKEN || "";
const phones = (s) => String(s || "").split(",").map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10);
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const json = (res, code, obj) => { res.setHeader("Cache-Control", "no-store"); return res.status(code).json(obj); };

function sign(payload) { return crypto.createHmac("sha256", secret()).update(payload).digest("hex"); }
function makeToken(u) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = Buffer.from(JSON.stringify({ p: u.phone, n: u.name, r: roleOf(u.role), exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function readToken(req) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const [payload, sig] = tok.split(".");
  if (!payload || !sig || !secret()) return null;
  if (!guard.safeEqual(sig, sign(payload))) return null;
  try {
    const u = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!u.exp || u.exp < Date.now()) return null;
    return { phone: u.p, name: u.n, role: u.r };
  } catch (e) { return null; }
}

async function users(cfg) {
  const r = await guard.kvCommand(cfg, ["HGETALL", USERS]).catch(() => ({}));
  const out = {}; const a = r.result || [];
  if (Array.isArray(a)) { for (let i = 0; i + 1 < a.length; i += 2) { try { out[a[i]] = JSON.parse(a[i + 1]); } catch (e) {} } }
  else if (a && typeof a === "object") { for (const k of Object.keys(a)) { try { out[k] = JSON.parse(a[k]); } catch (e) {} } }
  return out;
}
function ownerPhones() {
  return Array.from(new Set(phones(process.env.ADMIN_PHONES).concat(phones(process.env.STAFF_OWNERS || "9010427777"))));
}
// Shared dashboard password (optional). Set by the owner from WhatsApp:
// "staff password <new password>"  → scrypt hash in KV (never stored in plain).
// Fallback: STAFF_PASSWORD env var.
function scrypt(pwd, salt) { return crypto.scryptSync(String(pwd), String(salt), 32).toString("hex"); }
async function checkPassword(cfg, pwd) {
  if (!pwd) return false;
  const r = await guard.kvCommand(cfg, ["GET", "staff:pwd"]).catch(() => ({}));
  if (r && r.result) {
    try { const rec = JSON.parse(r.result); return guard.safeEqual(scrypt(pwd, rec.salt), rec.hash); } catch (e) { return false; }
  }
  const env = process.env.STAFF_PASSWORD;
  return env ? guard.safeEqual(String(pwd), env) : null; // null = no password configured
}

async function resolveUser(cfg, phone) {
  const owners = ownerPhones();
  if (owners.includes(phone)) return { phone, name: "Owner", role: "owner" };
  const u = (await users(cfg))[phone];
  if (u) return { phone, name: u.name || "Staff", role: roleOf(u.role) };
  return null;
}

const leadKey = (l) => `${l.ts}|${digits10(l.phone) || l.src_id || ""}`;
async function hashAll(cfg, key) {
  const r = await guard.kvCommand(cfg, ["HGETALL", key]).catch(() => ({}));
  const a = r.result || [], out = {};
  if (Array.isArray(a)) { for (let i = 0; i + 1 < a.length; i += 2) out[a[i]] = a[i + 1]; }
  else if (a && typeof a === "object") Object.assign(out, a);
  return out;
}

async function dataPayload(cfg, me) {
  const [lr, st, notes, ar, bk, dp, q, rv, en] = await Promise.all([
    guard.kvCommand(cfg, ["LRANGE", LEADS, "0", "799"]).catch(() => ({})),
    hashAll(cfg, STATUS), hashAll(cfg, NOTES),
    guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "299"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", "acad:booked"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", "dp:today"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "19"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "rv:log", "0", "29"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", "dp:enabled"]).catch(() => ({})),
  ]);
  const leads = (lr.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean).map((l) => {
    const k = leadKey(l); let n = [];
    try { n = JSON.parse(notes[k] || "[]"); } catch (e) {}
    return Object.assign({}, l, { key: k, status: STATUSES.includes(st[k]) ? st[k] : "new", notes: n, phone: digits10(l.phone) });
  });
  const now = Date.now();
  const appts = (ar.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
    .filter((a) => a && a.at && a.at > now - 12 * 3600000 && a.at < now + 30 * 86400000)
    .sort((a, b) => a.at - b.at);
  const booked = Math.max(0, Math.min(10, Number(bk.result || 0)));
  const academy = leads.filter((l) => /^academy/i.test(String(l.concern || "")));
  let today = null; try { today = dp.result ? JSON.parse(dp.result) : null; } catch (e) {}
  const queue = (q.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
  const reviews = (rv.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
  const team = me.role === "owner" ? await users(cfg) : null;
  const caps = capsOf(me.role), allow = (c) => caps.includes("*") || caps.includes(c);
  if (!allow("leads.view")) leads.length = 0;
  if (!allow("reviews.view")) reviews.length = 0;
  if (!allow("appts.view")) appts.length = 0;
  return { me: Object.assign({}, me, { caps, roleLabel: ROLES[roleOf(me.role)].label, roleTe: ROLES[roleOf(me.role)].te }), roles: ROLES, capList: CAPS, leads, statuses: STATUSES, appts, academy: { booked, left: 10 - booked, leads: academy }, today, queue, dailyOn: String(en.result || "1") !== "0", reviews, team, owners: me.role === "owner" ? ownerPhones() : undefined, ts: now };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });
  if (!secret()) return json(res, 501, { error: "STAFF_SECRET / ADMIN_KEY not configured" });
  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "");
  const ip = guard.getIp(req);

  // ---- login ----
  if (a === "login") {
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const phone = digits10(b.phone), pwd = String(b.password || "");
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid 10-digit mobile number ivvandi" });
    const rlIp = await guard.rateLimit(cfg, `rl:stp:${ip}`, 20, 3600);
    const rlPh = await guard.rateLimit(cfg, `rl:stp:p:${phone}`, 10, 3600);
    if (!rlIp.allowed || !rlPh.allowed) return json(res, 429, { error: "Too many attempts — 1 gantha tarvata try cheyandi (leda OTP vadandi)" });
    const u = await resolveUser(cfg, phone);
    if (!u) return json(res, 403, { error: "Ee number staff list lo ledu. Owner ni adagandi." });
    const ok = await checkPassword(cfg, pwd);
    if (ok === null) return json(res, 501, { error: "Password inka set cheyaledu — OTP tho login cheyandi (owner: WhatsApp lo 'staff password <new password>')" });
    if (!ok) return json(res, 401, { error: "Password tappu" });
    await guard.kvCommand(cfg, ["HSET", "staff:lastlogin", phone, String(Date.now())]).catch(() => {});
    return json(res, 200, { ok: true, token: makeToken(u), me: u });
  }
  if (a === "send") {
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid 10-digit mobile number ivvandi" });
    const rl = await guard.rateLimit(cfg, `rl:stf:${ip}`, 12, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many attempts — try later" });
    const u = await resolveUser(cfg, phone);
    if (!u) return json(res, 403, { error: "Ee number staff list lo ledu. Owner ni adagandi (WhatsApp admin: staff add <number> <name>)." });
    const code = String(crypto.randomInt(100000, 999999));
    await guard.kvCommand(cfg, ["SET", `staff:otp:${phone}`, JSON.stringify({ code, tries: 0 }), "EX", "300"]);
    const line = `Mee DermaLuxe staff login OTP: *${code}* — 5 nimishalu valid. Meeru login cheyakapothe ignore cheyandi.`;
    let ok = await notify.sendWa(phone, `🔐 ${line}`);
    if (!ok) { const t = await notify.sendWaTemplate(phone, "clinic_update", [u.name.split(" ")[0] || "Team", line.replace(/\*/g, "")]); ok = !!(t && t.ok); }
    if (!ok) return json(res, 502, { error: "OTP WhatsApp lo pampalekapoyam — konchem sepu tarvata try cheyandi" });
    return json(res, 200, { ok: true });
  }
  if (a === "verify") {
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const phone = digits10(b.phone), code = String(b.code || "").trim();
    const r = await guard.kvCommand(cfg, ["GET", `staff:otp:${phone}`]).catch(() => ({}));
    let rec = null; try { rec = r.result ? JSON.parse(r.result) : null; } catch (e) {}
    if (!rec) return json(res, 401, { error: "OTP expire ayindi — malli pampandi" });
    if (rec.tries >= 5) { await guard.kvCommand(cfg, ["DEL", `staff:otp:${phone}`]); return json(res, 429, { error: "Too many wrong attempts — malli OTP pampandi" }); }
    if (!guard.safeEqual(code, rec.code)) {
      await guard.kvCommand(cfg, ["SET", `staff:otp:${phone}`, JSON.stringify({ code: rec.code, tries: rec.tries + 1 }), "EX", "300"]);
      return json(res, 401, { error: "OTP tappu" });
    }
    await guard.kvCommand(cfg, ["DEL", `staff:otp:${phone}`]);
    const u = await resolveUser(cfg, phone);
    if (!u) return json(res, 403, { error: "Not allowed" });
    await guard.kvCommand(cfg, ["HSET", "staff:lastlogin", phone, String(Date.now())]).catch(() => {});
    return json(res, 200, { ok: true, token: makeToken(u), me: u });
  }

  // ---- everything below needs a session ----
  const me = readToken(req);
  if (!me) return json(res, 401, { error: "Login required" });
  // re-check the allowlist so removed staff lose access immediately
  const live = await resolveUser(cfg, me.phone);
  if (!live) return json(res, 403, { error: "Access removed" });
  me.role = live.role; me.name = live.name;

  if (a === "me") return json(res, 200, { ok: true, me });
  if (a === "data") return json(res, 200, await dataPayload(cfg, me));

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rl = await guard.rateLimit(cfg, `rl:sta:${me.phone}`, 600, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
  const key = b.key ? String(b.key) : "";

  if (a === "status") {
    if (!can(me, "leads.edit")) return json(res, 403, { error: "Mee role ki idi cheyye permission ledu" });
    const s = String(b.status || "").toLowerCase();
    if (!key || !STATUSES.includes(s)) return json(res, 400, { error: "key + valid status required" });
    await guard.kvCommand(cfg, ["HSET", STATUS, key, s]);
    return json(res, 200, { ok: true });
  }
  if (a === "note") {
    if (!can(me, "leads.edit")) return json(res, 403, { error: "Mee role ki note add chese permission ledu" });
    const text = String(b.text || "").trim().slice(0, 400);
    if (!key || !text) return json(res, 400, { error: "key + text required" });
    const cur = await guard.kvCommand(cfg, ["HGET", NOTES, key]).catch(() => ({}));
    let list = []; try { list = JSON.parse(cur.result || "[]"); } catch (e) {}
    list.unshift({ ts: Date.now(), by: me.name, text });
    await guard.kvCommand(cfg, ["HSET", NOTES, key, JSON.stringify(list.slice(0, 30))]);
    return json(res, 200, { ok: true, notes: list.slice(0, 30) });
  }
  if (a === "academy") {
    if (!can(me, "academy.edit")) return json(res, 403, { error: "Mee role ki academy seats marche permission ledu" });
    const n = Math.max(0, Math.min(10, Number(b.booked)));
    if (Number.isNaN(n)) return json(res, 400, { error: "booked 0-10" });
    await guard.kvCommand(cfg, ["SET", "acad:booked", String(n)]);
    return json(res, 200, { ok: true, booked: n, left: 10 - n });
  }

  if (a === "delete" && !can(me, "leads.delete")) return json(res, 403, { error: "Owner matrame" });
  if (a === "daily" && !can(me, "posts.toggle")) return json(res, 403, { error: "Mee role ki idi marche permission ledu" });
  if (["team-add", "team-remove", "team-role", "set-password"].includes(a) && !can(me, "team.manage")) return json(res, 403, { error: "Owner matrame" });
  if (a === "team-add") {
    const phone = digits10(b.phone), name = String(b.name || "").trim().slice(0, 60);
    const role = roleOf(b.role);
    if (!/^[6-9]\d{9}$/.test(phone) || !name) return json(res, 400, { error: "phone + name required" });
    if (role === "owner" && me.role !== "owner") return json(res, 403, { error: "Owner role ivvagaligedi owner matrame" });
    await guard.kvCommand(cfg, ["HSET", USERS, phone, JSON.stringify({ name, role, added: Date.now(), by: me.phone })]);
    const what = capsOf(role).includes("*") ? "anni" : capsOf(role).map((c) => CAPS[c] || c).join(", ");
    notify.sendWa(phone, `👋 Hi ${name}! Meeru DermaLuxe staff dashboard ki *${ROLES[role].label}* ga add ayyaru.\n\n🔗 www.dermaluxe.ai/staff.html\n📱 Mee number: ${phone}\n🔐 Password leda OTP tho login cheyandi.\n\n📋 Mee access: ${what}`).catch(() => {});
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  if (a === "set-password") {
    const pwd = String(b.password || "");
    if (b.off === true) { await guard.kvCommand(cfg, ["DEL", "staff:pwd"]); return json(res, 200, { ok: true, off: true }); }
    if (pwd.length < 6) return json(res, 400, { error: "Password kaneesam 6 characters undali" });
    const salt = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["SET", "staff:pwd", JSON.stringify({ salt, hash: scrypt(pwd, salt), ts: Date.now(), by: me.phone })]);
    return json(res, 200, { ok: true });
  }
  if (a === "team-role") {
    const phone = digits10(b.phone), role = roleOf(b.role);
    const all = await users(cfg);
    if (!all[phone]) return json(res, 404, { error: "Staff member not found" });
    if (role === "owner" && me.role !== "owner") return json(res, 403, { error: "Owner role ivvagaligedi owner matrame" });
    all[phone].role = role;
    await guard.kvCommand(cfg, ["HSET", USERS, phone, JSON.stringify(all[phone])]);
    notify.sendWa(phone, `🔁 Mee DermaLuxe dashboard role ippudu *${ROLES[role].label}*.`).catch(() => {});
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  if (a === "team-remove") {
    const phone = digits10(b.phone);
    await guard.kvCommand(cfg, ["HDEL", USERS, phone]);
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  if (a === "delete") {
    if (!key) return json(res, 400, { error: "key required" });
    const r = await guard.kvCommand(cfg, ["LRANGE", LEADS, "0", "799"]).catch(() => ({}));
    for (const s of (r.result || [])) { try { const l = JSON.parse(s); if (leadKey(l) === key) { await guard.kvCommand(cfg, ["LREM", LEADS, "1", s]); break; } } catch (e) {} }
    await guard.kvCommand(cfg, ["HDEL", STATUS, key]).catch(() => {}); await guard.kvCommand(cfg, ["HDEL", NOTES, key]).catch(() => {});
    return json(res, 200, { ok: true });
  }
  if (a === "daily") {
    await guard.kvCommand(cfg, ["SET", "dp:enabled", b.on ? "1" : "0"]);
    return json(res, 200, { ok: true, dailyOn: !!b.on });
  }
  return json(res, 400, { error: "Unknown action" });
};
module.exports.ROLES = ROLES;
module.exports.CAPS = CAPS;
module.exports.capsOf = capsOf;
module.exports.can = can;
