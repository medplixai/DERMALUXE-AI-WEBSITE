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
// One capability = one thing a person can actually do. Every entry below is
// enforced somewhere real; nothing here is decorative. `te` is the Telugu
// label shown beside it, `area` groups them in the Control panel.
const CAPS = {
  "leads.view":       "Leads & contact details",
  "leads.edit":       "Lead status + call notes",
  "leads.delete":     "Delete a lead",
  "appts.view":       "Appointments",
  "academy.view":     "Academy students & seats",
  "academy.edit":     "Add a student, edit details & notes",
  "academy.seats":    "Change the booked-seat count",
  "academy.money":    "Record fee payments",
  "academy.docs":     "Send receipt / admission / ID card",
  "academy.material": "Send course material links",
  "academy.certify":  "Issue certificates",
  "academy.delete":   "Remove a student",
  "posts.view":       "Today's post & queue",
  "posts.toggle":     "Daily auto-post on/off",
  "reviews.view":     "Patient ratings",
  "ai.use":           "AI Office assistant",
  "team.manage":      "Control panel — logins & roles",
  "settings.manage":  "Dashboard password & switches",
};
const CAP_TE = {
  "leads.view": "లీడ్స్ చూడటం", "leads.edit": "లీడ్ స్టేటస్ & నోట్స్", "leads.delete": "లీడ్ తొలగించడం",
  "appts.view": "అపాయింట్‌మెంట్లు", "academy.view": "అకాడమీ స్టూడెంట్స్", "academy.edit": "స్టూడెంట్ యాడ్ / ఎడిట్",
  "academy.seats": "సీట్ల లెక్క మార్చడం", "academy.money": "ఫీజు నమోదు", "academy.docs": "డాక్యుమెంట్లు పంపడం",
  "academy.material": "మెటీరియల్ లింక్", "academy.certify": "సర్టిఫికెట్", "academy.delete": "స్టూడెంట్ తొలగింపు",
  "posts.view": "ఈరోజు పోస్ట్", "posts.toggle": "ఆటో-పోస్ట్ ఆన్/ఆఫ్", "reviews.view": "పేషెంట్ రేటింగ్స్",
  "ai.use": "AI ఆఫీస్", "team.manage": "కంట్రోల్ ప్యానెల్", "settings.manage": "సెట్టింగ్స్",
};
const CAP_GROUPS = [
  { key: "leads",   label: "Leads & patients", te: "లీడ్స్",        caps: ["leads.view", "leads.edit", "leads.delete"] },
  { key: "appts",   label: "Appointments",     te: "అపాయింట్‌మెంట్లు", caps: ["appts.view"] },
  { key: "academy", label: "Academy",          te: "అకాడమీ",        caps: ["academy.view", "academy.edit", "academy.seats", "academy.money", "academy.docs", "academy.material", "academy.certify", "academy.delete"] },
  { key: "posts",   label: "Marketing & posts", te: "మార్కెటింగ్",   caps: ["posts.view", "posts.toggle"] },
  { key: "reviews", label: "Reviews",          te: "రివ్యూలు",      caps: ["reviews.view"] },
  { key: "admin",   label: "Admin",            te: "అడ్మిన్",       caps: ["ai.use", "team.manage", "settings.manage"] },
];
// Shipped defaults. The owner can retune any of these, or invent new roles,
// from the Control panel — the edits live in KV hash `staff:roles` and are
// merged over these on every request. `owner` is deliberately not editable.
const BUILTIN_ROLES = {
  owner:     { label: "Owner",     te: "ఓనర్",       note: "Anni powers — ee role marchalemu.",
    caps: ["*"] },
  manager:   { label: "Manager",   te: "మేనేజర్",     note: "Clinic mottam nadipevaru. Delete tappa dadapu anni.",
    caps: ["leads.view","leads.edit","appts.view","academy.view","academy.edit","academy.seats","academy.money","academy.docs","academy.material","academy.certify","posts.view","posts.toggle","reviews.view","ai.use","team.manage"] },
  doctor:    { label: "Doctor",    te: "డాక్టర్",     note: "Consultations + academy training. Money/settings ledu.",
    caps: ["leads.view","leads.edit","appts.view","academy.view","academy.edit","academy.material","academy.certify","reviews.view","ai.use"] },
  reception: { label: "Reception", te: "రిసెప్షన్",   note: "Front desk — calls, appointments, seat count.",
    caps: ["leads.view","leads.edit","appts.view","academy.view","academy.seats","posts.view","ai.use"] },
  accounts:  { label: "Accounts",  te: "అకౌంట్స్",    note: "Fees, receipts, documents. Leads edit cheyaleru.",
    caps: ["leads.view","appts.view","academy.view","academy.money","academy.docs","reviews.view","ai.use"] },
  therapist: { label: "Therapist", te: "థెరపిస్ట్",   note: "Treatments chese vaaru — chudatam matrame.",
    caps: ["leads.view","appts.view","posts.view","ai.use"] },
  trainer:   { label: "Trainer",   te: "ట్రైనర్",     note: "Academy batch nadipevaru.",
    caps: ["academy.view","academy.edit","academy.material","academy.docs","appts.view","ai.use"] },
  marketing: { label: "Marketing", te: "మార్కెటింగ్", note: "Posts, campaigns, ratings.",
    caps: ["leads.view","posts.view","posts.toggle","reviews.view","ai.use"] },
  staff:     { label: "Staff",     te: "స్టాఫ్",      note: "Default role — basic access.",
    caps: ["leads.view","leads.edit","appts.view","academy.view","posts.view","ai.use"] },
};
const ROLES_KEY = "staff:roles";
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
// Merged role book: defaults, then the owner's saved edits and custom roles.
async function loadRoles(cfg) {
  const out = {};
  for (const k of Object.keys(BUILTIN_ROLES)) out[k] = { label: BUILTIN_ROLES[k].label, te: BUILTIN_ROLES[k].te, note: BUILTIN_ROLES[k].note || "", caps: BUILTIN_ROLES[k].caps.slice(), builtin: true, edited: false };
  const saved = await hashAll(cfg, ROLES_KEY).catch(() => ({}));
  for (const k of Object.keys(saved)) {
    if (k === "owner") continue; // owner is always full access
    let v = null; try { v = JSON.parse(saved[k]); } catch (e) { continue; }
    if (!v || typeof v !== "object") continue;
    const caps = Array.isArray(v.caps) ? v.caps.filter((c) => CAPS[c]) : [];
    out[k] = { label: clean(v.label, 40) || k, te: clean(v.te, 40), note: clean(v.note, 120), caps, builtin: !!BUILTIN_ROLES[k], edited: true };
  }
  return out;
}
const roleOf = (r, roles) => ((roles || BUILTIN_ROLES)[String(r || "staff")] ? String(r) : "staff");
const capsOf = (r, roles) => ((roles || BUILTIN_ROLES)[roleOf(r, roles)] || BUILTIN_ROLES.staff).caps;
// A person's real powers: their role, plus anything granted to them alone,
// minus anything taken away from them alone.
function effCaps(roles, u) {
  const base = capsOf(u && u.role, roles);
  if (base.includes("*")) return ["*"];
  const set = new Set(base);
  for (const c of (u && Array.isArray(u.extra) ? u.extra : [])) if (CAPS[c]) set.add(c);
  for (const c of (u && Array.isArray(u.revoked) ? u.revoked : [])) set.delete(c);
  return Array.from(set);
}
const can = (u, cap, roles) => { const c = effCaps(roles, u); return c.includes("*") || c.includes(cap); };
// Every control-panel change is written down, so the owner can see who did what.
async function audit(cfg, me, what) {
  const rec = JSON.stringify({ ts: Date.now(), by: (me && me.name) || "?", phone: (me && me.phone) || "", what: clean(what, 200) });
  await guard.kvCommand(cfg, ["LPUSH", "staff:audit", rec]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "staff:audit", "0", "199"]).catch(() => {});
}
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
  return guard.ownerPhones(); // ADMIN_PHONES ∪ STAFF_OWNERS (default 9010427777)
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

async function resolveUser(cfg, phone, roles) {
  const owners = ownerPhones();
  if (owners.includes(phone)) return { phone, name: "Owner", role: "owner" };
  const u = (await users(cfg))[phone];
  if (u) return { phone, name: u.name || "Staff", role: roleOf(u.role, roles), extra: u.extra || [], revoked: u.revoked || [], off: !!u.off };
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
  let queue = (q.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
  const reviews = (rv.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
  const roles = await loadRoles(cfg);
  const team = can(me, "team.manage", roles) ? await users(cfg) : null;
  const caps = effCaps(roles, me), allow = (c) => caps.includes("*") || caps.includes(c);
  if (!allow("leads.view")) leads.length = 0;
  if (!allow("reviews.view")) reviews.length = 0;
  if (!allow("appts.view")) appts.length = 0;
  // Academy and the post queue used to go out to every logged-in user.
  if (!allow("academy.view")) academy.length = 0;
  const seePosts = allow("posts.view");
  if (!seePosts) { today = null; queue.length = 0; }
  const rk = roleOf(me.role, roles);
  return { me: Object.assign({}, me, { caps, roleLabel: roles[rk].label, roleTe: roles[rk].te }), roles, capList: CAPS, capTe: CAP_TE, capGroups: CAP_GROUPS, leads, statuses: STATUSES, appts, academy: { booked: allow("academy.view") ? booked : 0, left: allow("academy.view") ? 10 - booked : 0, leads: academy }, today, queue, dailyOn: String(en.result || "1") !== "0", reviews, team, owners: can(me, "team.manage", roles) ? ownerPhones() : undefined, ts: now };
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
    if (u.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
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
    if (u.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
    const code = String(crypto.randomInt(100000, 999999));
    await guard.kvCommand(cfg, ["SET", `staff:otp:${phone}`, JSON.stringify({ code, tries: 0 }), "EX", "300"]);
    const line = `Mee DermaLuxe staff login OTP: ${code} — 5 nimishalu valid. Meeru login cheyakapothe ignore cheyandi.`;
    const tried = [];
    // 1) authentication template — the only channel that always delivers
    const auth = await notify.sendWaAuthCode(phone, code, "staff_login_code");
    tried.push(`auth:${auth.ok ? "ok" : auth.msg || "fail"}`);
    let ok = auth.ok, via = auth.ok ? "template" : "";
    // 2) plain message (works only if they messaged us in the last 24 h)
    if (!ok) { const f = await notify.sendWa(phone, `🔐 ${line}`); tried.push(`text:${f ? "ok" : "fail"}`); if (f) { ok = true; via = "message"; } }
    // 3) last resort: an already-approved utility/marketing template
    if (!ok) { const t = await notify.sendWaTemplate(phone, "clinic_update", [String(u.name || "Team").split(" ")[0], line]); tried.push(`clinic_update:${t && t.ok ? "ok" : (t && t.msg) || "fail"}`); if (t && t.ok) { ok = true; via = "clinic_update"; } }
    console.log("staff otp", phone.slice(-4), tried.join(" | "));
    if (!ok) return json(res, 502, { error: "OTP WhatsApp lo pampalekapoyam. Owner tho password petti login cheyandi (WhatsApp admin: staff password <password>).", tried });
    return json(res, 200, { ok: true, via });
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
    if (u.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
    await guard.kvCommand(cfg, ["HSET", "staff:lastlogin", phone, String(Date.now())]).catch(() => {});
    return json(res, 200, { ok: true, token: makeToken(u), me: u });
  }

  // ---- everything below needs a session ----
  const me = readToken(req);
  if (!me) return json(res, 401, { error: "Login required" });
  // re-check the allowlist so removed staff lose access immediately
  const roles = await loadRoles(cfg);
  const live = await resolveUser(cfg, me.phone, roles);
  if (!live) return json(res, 403, { error: "Access removed" });
  if (live.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
  me.role = live.role; me.name = live.name; me.extra = live.extra; me.revoked = live.revoked;
  // Powers are recomputed here on every request, so a role edit or a revoked
  // capability takes effect immediately — no re-login, no stale token.
  const allow = (c) => can(me, c, roles);

  const rlRead = await guard.rateLimit(cfg, `rl:str:${me.phone}`, 900, 3600);
  if (!rlRead.allowed) return json(res, 429, { error: "Too many requests" });

  if (a === "me") return json(res, 200, { ok: true, me: Object.assign({}, me, { caps: effCaps(roles, me) }) });
  if (a === "data") return json(res, 200, await dataPayload(cfg, me));

  // ---- control panel (read) ----
  if (a === "panel") {
    if (!allow("team.manage")) return json(res, 403, { error: "Control panel owner/manager ki matrame" });
    const [team, last, pwd, log] = await Promise.all([
      users(cfg), hashAll(cfg, "staff:lastlogin").catch(() => ({})),
      guard.kvCommand(cfg, ["GET", "staff:pwd"]).catch(() => ({})),
      guard.kvCommand(cfg, ["LRANGE", "staff:audit", "0", "49"]).catch(() => ({})),
    ]);
    const people = Object.keys(team).map((ph) => {
      const u = Object.assign({ phone: ph }, team[ph]);
      u.role = roleOf(u.role, roles);
      u.caps = effCaps(roles, u);
      u.lastLogin = Number(last[ph] || 0) || null;
      return u;
    }).sort((x, y) => (y.lastLogin || 0) - (x.lastLogin || 0));
    const audit = (log.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
    return json(res, 200, {
      ok: true, roles, capList: CAPS, capTe: CAP_TE, capGroups: CAP_GROUPS, people,
      owners: ownerPhones().map((ph) => ({ phone: ph, lastLogin: Number(last[ph] || 0) || null })),
      passwordSet: !!(pwd && pwd.result) || !!process.env.STAFF_PASSWORD,
      audit, me: Object.assign({}, me, { caps: effCaps(roles, me) }),
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rl = await guard.rateLimit(cfg, `rl:sta:${me.phone}`, 600, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
  const key = b.key ? String(b.key) : "";

  if (a === "status") {
    if (!allow("leads.edit")) return json(res, 403, { error: "Mee role ki idi cheyye permission ledu" });
    const s = String(b.status || "").toLowerCase();
    if (!key || !STATUSES.includes(s)) return json(res, 400, { error: "key + valid status required" });
    await guard.kvCommand(cfg, ["HSET", STATUS, key, s]);
    return json(res, 200, { ok: true });
  }
  if (a === "note") {
    if (!allow("leads.edit")) return json(res, 403, { error: "Mee role ki note add chese permission ledu" });
    const text = String(b.text || "").trim().slice(0, 400);
    if (!key || !text) return json(res, 400, { error: "key + text required" });
    const cur = await guard.kvCommand(cfg, ["HGET", NOTES, key]).catch(() => ({}));
    let list = []; try { list = JSON.parse(cur.result || "[]"); } catch (e) {}
    list.unshift({ ts: Date.now(), by: me.name, text });
    await guard.kvCommand(cfg, ["HSET", NOTES, key, JSON.stringify(list.slice(0, 30))]);
    return json(res, 200, { ok: true, notes: list.slice(0, 30) });
  }
  if (a === "academy") {
    if (!allow("academy.seats")) return json(res, 403, { error: "Mee role ki academy seats marche permission ledu" });
    const n = Math.max(0, Math.min(10, Number(b.booked)));
    if (Number.isNaN(n)) return json(res, 400, { error: "booked 0-10" });
    await guard.kvCommand(cfg, ["SET", "acad:booked", String(n)]);
    return json(res, 200, { ok: true, booked: n, left: 10 - n });
  }

  if (a === "delete" && !allow("leads.delete")) return json(res, 403, { error: "Owner matrame" });
  if (a === "daily" && !allow("posts.toggle")) return json(res, 403, { error: "Mee role ki idi marche permission ledu" });
  const PANEL = ["team-add", "team-remove", "team-role", "team-caps", "team-suspend", "role-save", "role-delete"];
  if (PANEL.includes(a) && !allow("team.manage")) return json(res, 403, { error: "Idi control panel access unna vallake" });
  // A non-owner with control-panel access may only pass on powers they hold
  // themselves, and may never edit their own record — otherwise the panel is
  // a one-click route to full access.
  const isOwner = me.role === "owner";
  const myCaps = effCaps(roles, me);
  const cannotGrant = (list) => (list || []).filter((c) => !myCaps.includes("*") && !myCaps.includes(c));
  if (!isOwner && ["team-role", "team-caps", "team-suspend", "team-remove"].includes(a) && digits10(b.phone) === me.phone)
    return json(res, 403, { error: "Mee sonta access ni meere marchukolekaru. Owner ni adagandi." });
  if (!isOwner && ["team-add", "team-role"].includes(a)) {
    const short = cannotGrant(capsOf(roleOf(b.role, roles), roles));
    if (short.length) return json(res, 403, { error: `Meeku leni powers ivvalemu: ${short.map((c) => CAPS[c] || c).join(", ")}` });
  }
  if (!isOwner && a === "team-caps") {
    const short = cannotGrant(Array.isArray(b.extra) ? b.extra : []);
    if (short.length) return json(res, 403, { error: `Meeku leni powers ivvalemu: ${short.map((c) => CAPS[c] || c).join(", ")}` });
  }
  if (!isOwner && a === "role-save") {
    const short = cannotGrant(Array.isArray(b.caps) ? b.caps : []);
    if (short.length) return json(res, 403, { error: `Meeku leni powers role ki pettalemu: ${short.map((c) => CAPS[c] || c).join(", ")}` });
  }
  if (a === "set-password" && !allow("settings.manage")) return json(res, 403, { error: "Password marchagaligedi settings access unna vallake" });
  if (a === "team-add") {
    const phone = digits10(b.phone), name = clean(b.name, 60);
    const role = roleOf(b.role, roles);
    if (!/^[6-9]\d{9}$/.test(phone) || !name) return json(res, 400, { error: "phone + name required" });
    if (role === "owner" && me.role !== "owner") return json(res, 403, { error: "Owner role ivvagaligedi owner matrame" });
    if (ownerPhones().includes(phone)) return json(res, 400, { error: "Ee number already owner — daanini ikkada add cheyakkarledu." });
    const existing = (await users(cfg))[phone];
    await guard.kvCommand(cfg, ["HSET", USERS, phone, JSON.stringify({ name, role, extra: [], revoked: [], off: false, added: (existing && existing.added) || Date.now(), by: me.phone })]);
    const what = capsOf(role, roles).includes("*") ? "anni" : capsOf(role, roles).map((c) => CAPS[c] || c).join(", ");
    await audit(cfg, me, `${existing ? "Updated" : "Added"} login ${name} (${phone}) — ${roles[role].label}`);
    notify.sendWa(phone, `👋 Hi ${name}! Meeru DermaLuxe staff dashboard ki *${roles[role].label}* ga add ayyaru.\n\n🔗 www.dermaluxe.ai/staff.html\n📱 Mee number: ${phone}\n🔐 Password leda OTP tho login cheyandi.\n\n📋 Mee access: ${what}`).catch(() => {});
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  if (a === "set-password") {
    const pwd = String(b.password || "");
    if (b.off === true) { await guard.kvCommand(cfg, ["DEL", "staff:pwd"]); await audit(cfg, me, "Password teesesaru — OTP only"); return json(res, 200, { ok: true, off: true }); }
    if (pwd.length < 6) return json(res, 400, { error: "Password kaneesam 6 characters undali" });
    const salt = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["SET", "staff:pwd", JSON.stringify({ salt, hash: scrypt(pwd, salt), ts: Date.now(), by: me.phone })]);
    await audit(cfg, me, "Dashboard password set chesaru");
    return json(res, 200, { ok: true });
  }
  if (a === "team-role") {
    const phone = digits10(b.phone), role = roleOf(b.role, roles);
    const all = await users(cfg);
    if (!all[phone]) return json(res, 404, { error: "Staff member not found" });
    if (role === "owner" && me.role !== "owner") return json(res, 403, { error: "Owner role ivvagaligedi owner matrame" });
    all[phone].role = role;
    await guard.kvCommand(cfg, ["HSET", USERS, phone, JSON.stringify(all[phone])]);
    await audit(cfg, me, `${all[phone].name} (${phone}) role → ${roles[role].label}`);
    notify.sendWa(phone, `🔁 Mee DermaLuxe dashboard role ippudu *${roles[role].label}*.`).catch(() => {});
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  // Give or take away ONE power for ONE person, without touching their role.
  if (a === "team-caps") {
    const phone = digits10(b.phone);
    const all = await users(cfg);
    if (!all[phone]) return json(res, 404, { error: "Staff member not found" });
    const pick = (v) => (Array.isArray(v) ? v : []).filter((c) => CAPS[c]).slice(0, 20);
    const extra = pick(b.extra), revoked = pick(b.revoked).filter((c) => !extra.includes(c));
    if ((extra.includes("team.manage") || revoked.includes("team.manage")) && me.role !== "owner")
      return json(res, 403, { error: "Control panel access ivvagaligedi owner matrame" });
    all[phone].extra = extra; all[phone].revoked = revoked;
    await guard.kvCommand(cfg, ["HSET", USERS, phone, JSON.stringify(all[phone])]);
    const label = (c) => CAPS[c] || c;
    await audit(cfg, me, `${all[phone].name} (${phone}) powers — extra: ${extra.map(label).join(", ") || "none"} · off: ${revoked.map(label).join(", ") || "none"}`);
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  // Pause a login without deleting it (keeps the person's history).
  if (a === "team-suspend") {
    const phone = digits10(b.phone), off = b.off === true;
    const all = await users(cfg);
    if (!all[phone]) return json(res, 404, { error: "Staff member not found" });
    if (!isOwner && all[phone].role === "owner") return json(res, 403, { error: "Owner record ni marchagaligedi owner matrame" });
    all[phone].off = off;
    await guard.kvCommand(cfg, ["HSET", USERS, phone, JSON.stringify(all[phone])]);
    await audit(cfg, me, `${all[phone].name} (${phone}) access ${off ? "OFF chesaru" : "malli ON chesaru"}`);
    notify.sendWa(phone, off
      ? "🔒 Mee DermaLuxe dashboard access ippudu off lo undi. Doubt unte owner ni adagandi."
      : "🔓 Mee DermaLuxe dashboard access malli on ayindi — www.dermaluxe.ai/staff.html").catch(() => {});
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  if (a === "team-remove") {
    const phone = digits10(b.phone);
    const all = await users(cfg);
    if (!isOwner && all[phone] && all[phone].role === "owner") return json(res, 403, { error: "Owner record ni teeyagaligedi owner matrame" });
    await guard.kvCommand(cfg, ["HDEL", USERS, phone]);
    await guard.kvCommand(cfg, ["HDEL", "staff:lastlogin", phone]).catch(() => {});
    await audit(cfg, me, `Removed login ${(all[phone] && all[phone].name) || ""} (${phone})`);
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  // ---- roles: create one, retune one, or put a default back ----
  if (a === "role-save") {
    const key = String(b.key || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (!key || key.length < 2) return json(res, 400, { error: "Role key 2-20 letters (a-z, 0-9, _)" });
    if (key === "owner") return json(res, 400, { error: "Owner role marchalemu — adi eppudu full access." });
    const caps = (Array.isArray(b.caps) ? b.caps : []).filter((c) => CAPS[c]);
    if (!caps.length) return json(res, 400, { error: "Kaneesam oka power select cheyandi" });
    if (caps.includes("team.manage") && me.role !== "owner") return json(res, 403, { error: "Control panel power ivvagaligedi owner matrame" });
    const label = clean(b.label, 40) || key;
    await guard.kvCommand(cfg, ["HSET", ROLES_KEY, key, JSON.stringify({ label, te: clean(b.te, 40), note: clean(b.note, 120), caps })]);
    await audit(cfg, me, `Role ${label} (${key}) — ${caps.map((c) => CAPS[c] || c).join(", ")}`);
    return json(res, 200, { ok: true, roles: await loadRoles(cfg) });
  }
  if (a === "role-delete") {
    const key = String(b.key || "");
    if (key === "owner" || key === "staff") return json(res, 400, { error: "Ee role ni teeyalemu" });
    const saved = await hashAll(cfg, ROLES_KEY).catch(() => ({}));
    if (!saved[key]) return json(res, 404, { error: "Ee role KV lo ledu" });
    await guard.kvCommand(cfg, ["HDEL", ROLES_KEY, key]);
    let moved = 0;
    if (!BUILTIN_ROLES[key]) { // custom role deleted — park its people on "staff"
      const all = await users(cfg);
      for (const ph of Object.keys(all)) {
        if (all[ph].role !== key) continue;
        all[ph].role = "staff"; moved++;
        await guard.kvCommand(cfg, ["HSET", USERS, ph, JSON.stringify(all[ph])]);
      }
    }
    await audit(cfg, me, BUILTIN_ROLES[key] ? `Role ${key} default ki reset chesaru` : `Role ${key} teesesaru (${moved} → Staff)`);
    return json(res, 200, { ok: true, roles: await loadRoles(cfg), moved, reset: !!BUILTIN_ROLES[key] });
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
module.exports.ROLES = BUILTIN_ROLES;
module.exports.CAPS = CAPS;
module.exports.CAP_GROUPS = CAP_GROUPS;
module.exports.capsOf = capsOf;
module.exports.can = can;
module.exports.loadRoles = loadRoles;
module.exports.effCaps = effCaps;
// What another endpoint should call: merged roles + this person's own grants.
module.exports.liveUser = (cfg, phone, roles) => resolveUser(cfg, phone, roles);
// Decode a staff bearer token (identity only — never trust its role/caps).
module.exports.tokenUser = (req) => readToken(req);
module.exports.capsFor = async function (cfg, user) {
  const roles = await loadRoles(cfg);
  return effCaps(roles, user);
};
