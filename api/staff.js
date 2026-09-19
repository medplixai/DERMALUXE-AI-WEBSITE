// /api/staff — DermaLuxe staff dashboard backend (login + data + actions).
// Auth: WhatsApp OTP to an allow-listed staff phone. Owner = ADMIN_PHONES.
// Staff list: KV hash staff:users {phone → {name, role, added}} — owner manages
// via the dashboard Team tab or WhatsApp admin: "staff add 9xxxxxxxxx Name".
// Session: HMAC-signed bearer token (30 days). Roles: owner | staff.
const crypto = require("crypto");
const guard = require("./_guard.js");
const clinic = require("./_clinic.js");
const notify = require("./_notify.js");

const LEADS = "dl_leads", STATUS = "dl_status", NOTES = "dl_notes", USERS = "staff:users";
const STATUS_TS = "dl_status_ts";           // when each status was last set, for offline writes
// A client-supplied timestamp, clamped so a wrong phone clock cannot file a
// note in the future or resurrect a very old one.
function stamp(v) {
  const now = Date.now(), n = Number(v);
  if (!n || !isFinite(n)) return now;
  return Math.min(now, Math.max(now - 14 * 86400000, n));
}

// ---- roles & capabilities ---------------------------------------------------
// One capability = one thing a person can actually do. Every entry below is
// enforced somewhere real; nothing here is decorative. `te` is the Telugu
// label shown beside it, `area` groups them in the Control panel.
const CAPS = {
  "leads.view":       "Leads & contact details",
  "leads.edit":       "Lead status + call notes",
  "leads.delete":     "Delete a lead",
  "appts.view":       "Appointments",
  "appts.edit":       "Book, reschedule, cancel",
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
  "pkg.log":          "Session log (laser 3/6 laaga)",
  "reports.view":     "Numbers — conversion & revenue",
  "money.view":       "Collection & pending dues",
  "money.bill":       "Bill cheyyadam & payment record",
  "money.expense":    "Kharchulu & migilindi",
  "stock.view":       "Stock chudadam",
  "stock.edit":       "Stock marchadam & order",
  "attend.manage":    "Andari haajaru mark cheyyadam",
  "consent.take":     "Treatment consent teesukovadam",
  "reviews.view":     "Patient ratings",
  "ai.use":           "AI Office assistant",
  "msg.send":         "Patient ki message pampadam",
  "team.manage":      "Control panel — logins & roles",
  "settings.manage":  "Dashboard password & switches",
};
const CAP_TE = {
  "leads.view": "లీడ్స్ చూడటం", "leads.edit": "లీడ్ స్టేటస్ & నోట్స్", "leads.delete": "లీడ్ తొలగించడం",
  "appts.view": "అపాయింట్‌మెంట్లు", "appts.edit": "బుక్ / రీషెడ్యూల్", "academy.view": "అకాడమీ స్టూడెంట్స్", "academy.edit": "స్టూడెంట్ యాడ్ / ఎడిట్",
  "academy.seats": "సీట్ల లెక్క మార్చడం", "academy.money": "ఫీజు నమోదు", "academy.docs": "డాక్యుమెంట్లు పంపడం",
  "academy.material": "మెటీరియల్ లింక్", "academy.certify": "సర్టిఫికెట్", "academy.delete": "స్టూడెంట్ తొలగింపు",
  "pkg.log": "సెషన్ నమోదు", "reports.view": "నంబర్లు / రిపోర్ట్‌లు", "money.view": "కలెక్షన్ & బాకీలు", "money.bill": "బిల్ & పేమెంట్", "money.expense": "ఖర్చులు & మిగిలింది", "stock.view": "స్టాక్ చూడటం", "stock.edit": "స్టాక్ మార్చటం", "attend.manage": "అందరి హాజరు", "consent.take": "ట్రీట్‌మెంట్ కన్సెంట్",
  "posts.view": "ఈరోజు పోస్ట్", "posts.toggle": "ఆటో-పోస్ట్ ఆన్/ఆఫ్", "reviews.view": "పేషెంట్ రేటింగ్స్",
  "ai.use": "AI ఆఫీస్", "msg.send": "మెసేజ్ పంపడం", "team.manage": "కంట్రోల్ ప్యానెల్", "settings.manage": "సెట్టింగ్స్",
};
const CAP_GROUPS = [
  { key: "leads",   label: "Leads & patients", te: "లీడ్స్",        caps: ["leads.view", "leads.edit", "leads.delete"] },
  { key: "appts",   label: "Appointments",     te: "అపాయింట్‌మెంట్లు", caps: ["appts.view", "appts.edit", "pkg.log"] },
  { key: "academy", label: "Academy",          te: "అకాడమీ",        caps: ["academy.view", "academy.edit", "academy.seats", "academy.money", "academy.docs", "academy.material", "academy.certify", "academy.delete"] },
  { key: "money",   label: "Money",             te: "డబ్బు",         caps: ["money.view", "money.bill", "money.expense", "reports.view"] },
  { key: "clinic",  label: "Clinic",            te: "క్లినిక్",       caps: ["stock.view", "stock.edit", "attend.manage", "consent.take"] },
  { key: "posts",   label: "Marketing & posts", te: "మార్కెటింగ్",   caps: ["posts.view", "posts.toggle"] },
  { key: "reviews", label: "Reviews",          te: "రివ్యూలు",      caps: ["reviews.view"] },
  { key: "admin",   label: "Admin",            te: "అడ్మిన్",       caps: ["ai.use", "msg.send", "team.manage", "settings.manage"] },
];
// Shipped defaults. The owner can retune any of these, or invent new roles,
// from the Control panel — the edits live in KV hash `staff:roles` and are
// merged over these on every request. `owner` is deliberately not editable.
const BUILTIN_ROLES = {
  owner:     { label: "Owner",     te: "ఓనర్",       note: "Anni powers — ee role marchalemu.",
    caps: ["*"] },
  manager:   { label: "Manager",   te: "మేనేజర్",     note: "Clinic mottam nadipevaru. Delete tappa dadapu anni.",
    caps: ["leads.view","leads.edit","appts.view","appts.edit","pkg.log","academy.view","academy.edit","academy.seats","academy.money","academy.docs","academy.material","academy.certify","money.view","money.bill","money.expense","reports.view","stock.view","stock.edit","attend.manage","consent.take","posts.view","posts.toggle","reviews.view","ai.use","msg.send","team.manage"] },
  doctor:    { label: "Doctor",    te: "డాక్టర్",     note: "Consultations + academy training. Money/settings ledu.",
    caps: ["leads.view","leads.edit","appts.view","appts.edit","pkg.log","stock.view","stock.edit","consent.take","academy.view","academy.edit","academy.material","academy.certify","reviews.view","ai.use","msg.send"] },
  reception: { label: "Reception", te: "రిసెప్షన్",   note: "Front desk — calls, appointments, seat count.",
    caps: ["leads.view","leads.edit","appts.view","appts.edit","pkg.log","stock.view","stock.edit","consent.take","academy.view","academy.seats","money.view","money.bill","posts.view","ai.use","msg.send"] },
  accounts:  { label: "Accounts",  te: "అకౌంట్స్",    note: "Fees, receipts, documents. Leads edit cheyaleru.",
    caps: ["leads.view","appts.view","academy.view","academy.money","academy.docs","money.view","money.bill","money.expense","reports.view","stock.view","reviews.view","ai.use"] },
  therapist: { label: "Therapist", te: "థెరపిస్ట్",   note: "Treatments chese vaaru — chudatam matrame.",
    caps: ["leads.view","appts.view","pkg.log","stock.view","stock.edit","consent.take","posts.view","ai.use"] },
  trainer:   { label: "Trainer",   te: "ట్రైనర్",     note: "Academy batch nadipevaru.",
    caps: ["academy.view","academy.edit","academy.material","academy.docs","appts.view","ai.use"] },
  marketing: { label: "Marketing", te: "మార్కెటింగ్", note: "Posts, campaigns, ratings.",
    caps: ["leads.view","posts.view","posts.toggle","reviews.view","reports.view","ai.use"] },
  staff:     { label: "Staff",     te: "స్టాఫ్",      note: "Default role — basic access.",
    caps: ["leads.view","leads.edit","appts.view","academy.view","posts.view","ai.use"] },
};
const ROLES_KEY = "staff:roles";
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
// Merged role book: defaults, then the owner's saved edits and custom roles.
// Split so the same work can be done from a value already in hand, which is
// what lets one database trip answer three questions instead of three trips.
function mergeRoles(saved) {
  const out = {};
  for (const k of Object.keys(BUILTIN_ROLES)) out[k] = { label: BUILTIN_ROLES[k].label, te: BUILTIN_ROLES[k].te, note: BUILTIN_ROLES[k].note || "", caps: BUILTIN_ROLES[k].caps.slice(), builtin: true, edited: false };
  for (const k of Object.keys(saved || {})) {
    if (k === "owner") continue; // owner is always full access
    let v = null; try { v = JSON.parse(saved[k]); } catch (e) { continue; }
    if (!v || typeof v !== "object") continue;
    const caps = Array.isArray(v.caps) ? v.caps.filter((c) => CAPS[c]) : [];
    out[k] = { label: clean(v.label, 40) || k, te: clean(v.te, 40), note: clean(v.note, 120), caps, builtin: !!BUILTIN_ROLES[k], edited: true };
  }
  return out;
}
async function loadRoles(cfg) {
  return mergeRoles(await hashAll(cfg, ROLES_KEY).catch(() => ({})));
}

// The same, from a raw staff:users entry rather than a fresh read.
function shapeUser(phone, raw, roles) {
  if (ownerPhones().includes(phone)) return { phone, name: "Owner", role: "owner" };
  let u = null; try { u = raw ? JSON.parse(raw) : null; } catch (e) { u = null; }
  if (!u) return null;
  return { phone, name: u.name || "Staff", role: roleOf(u.role, roles), extra: u.extra || [], revoked: u.revoked || [], off: !!u.off };
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
// Sessions are stateless, so a stolen phone could keep working for 30 days.
// Every token carries the epoch its owner was on when it was minted; bumping
// that number in KV kills every token they hold, everywhere, at once.
const EPOCH_KEY = "staff:epoch";
async function epochOf(cfg, phone) {
  const r = await guard.kvCommand(cfg, ["HGET", EPOCH_KEY, phone]).catch(() => ({}));
  return Number((r && r.result) || 0);
}
async function bumpEpoch(cfg, phone) {
  const next = (await epochOf(cfg, phone)) + 1;
  await guard.kvCommand(cfg, ["HSET", EPOCH_KEY, phone, String(next)]).catch(() => {});
  return next;
}
function makeToken(u, epoch) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = Buffer.from(JSON.stringify({ p: u.phone, n: u.name, r: roleOf(u.role), e: Number(epoch || 0), exp })).toString("base64url");
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
    return { phone: u.p, name: u.n, role: u.r, epoch: Number(u.e || 0) };
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
// A password belongs to ONE person. A single clinic-wide password would let
// anyone who knows it log in as the owner simply by typing the owner's number,
// so the hash is stored per phone.
// null = this person has no password yet · false = wrong · otherwise the
// stored record, which says whether it is the temporary one the owner sent.
async function checkPassword(cfg, phone, pwd) {
  if (!pwd || !phone) return false;
  const r = await guard.kvCommand(cfg, ["HGET", "staff:pwd", phone]).catch(() => ({}));
  if (r && r.result) {
    try {
      const rec = JSON.parse(r.result);
      return guard.safeEqual(scrypt(pwd, rec.salt), rec.hash) ? { temp: !!rec.temp } : false;
    } catch (e) { return false; }
  }
  return null;
}

async function resolveUser(cfg, phone, roles) {
  const owners = ownerPhones();
  if (owners.includes(phone)) return { phone, name: "Owner", role: "owner" };
  const u = (await users(cfg))[phone];
  if (u) return { phone, name: u.name || "Staff", role: roleOf(u.role, roles), extra: u.extra || [], revoked: u.revoked || [], off: !!u.off };
  return null;
}

const leadKey = (l) => `${l.ts}|${digits10(l.phone) || l.src_id || ""}`;
// Upstash answers HGETALL with a flat array, Postgres with an object.
function hashOf(v) {
  const out = {};
  if (Array.isArray(v)) { for (let i = 0; i + 1 < v.length; i += 2) out[v[i]] = v[i + 1]; }
  else if (v && typeof v === "object") Object.assign(out, v);
  return out;
}

async function hashAll(cfg, key) {
  const r = await guard.kvCommand(cfg, ["HGETALL", key]).catch(() => ({}));
  const a = r.result || [], out = {};
  if (Array.isArray(a)) { for (let i = 0; i + 1 < a.length; i += 2) out[a[i]] = a[i + 1]; }
  else if (a && typeof a === "object") Object.assign(out, a);
  return out;
}

// The dashboard used to pull eight hundred leads, and with them the status
// and the notes of every lead the clinic has ever had, on every single open —
// several times a minute across everyone's phones. Now it asks for one page
// and for the status and notes of exactly the leads on that page. The rest is
// still there: `a=leads&offset=` fetches the next page, and the app asks for
// it when someone searches, opens Patients, or picks a wider date filter.
const LEAD_PAGE = 200;

// HGETALL on the notes hash transfers every note ever written. These two ask
// for the keys on this page and nothing else. Upstash takes the field list as
// plain arguments, so the page size is also the argument count — 200 is well
// inside the limit.
async function hashSome(cfg, key, fields) {
  const out = {};
  if (!fields.length) return out;
  const r = await guard.kvCommand(cfg, ["HMGET", key].concat(fields)).catch(() => ({}));
  const a = (r && r.result) || [];
  fields.forEach((f, i) => { if (a[i] != null) out[f] = a[i]; });
  return out;
}

// The full enquiry text and the call prep can each run to a few thousand
// characters. The card shows 160 of one and the whole of the other; the rest
// travelled down the wire on every refresh to be thrown away.
function trimLead(l) {
  const out = Object.assign({}, l);
  if (typeof out.message === "string" && out.message.length > 300) out.message = out.message.slice(0, 300) + "…";
  if (typeof out.call_prep === "string" && out.call_prep.length > 200) out.call_prep = out.call_prep.slice(0, 200) + "…";
  return out;
}

// One page of leads, with the status and notes that belong to them.
async function leadPage(cfg, offset, count) {
  const from = Math.max(0, Number(offset) || 0);
  const to = from + (Number(count) || LEAD_PAGE) - 1;
  const [lr, total] = await Promise.all([
    guard.kvCommand(cfg, ["LRANGE", LEADS, String(from), String(to)]).catch(() => ({})),
    guard.kvCommand(cfg, ["LLEN", LEADS]).catch(() => ({})),
  ]);
  const raw = (lr.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
  const keys = raw.map(leadKey);
  const [st, notes] = await Promise.all([hashSome(cfg, STATUS, keys), hashSome(cfg, NOTES, keys)]);
  const leads = raw.map((l) => {
    const k = leadKey(l); let n = [];
    try { n = JSON.parse(notes[k] || "[]"); } catch (e) {}
    return Object.assign(trimLead(l), { key: k, status: STATUSES.includes(st[k]) ? st[k] : "new", notes: n, phone: digits10(l.phone) });
  });
  const leadsTotal = Number((total && total.result) || 0) || (from + leads.length);
  return { leads, leadsTotal, offset: from, more: from + leads.length < leadsTotal };
}

async function dataPayload(cfg, me, knownRoles) {
  const roles = knownRoles || await loadRoles(cfg);
  const caps0 = effCaps(roles, me), may = (c) => caps0.includes("*") || caps0.includes(c);
  // The team list used to be fetched after everything else, one more wait for
  // something nothing else depended on. It goes with the rest.
  const [page, ar, bk, dp, q, rv, en, teamRaw] = await Promise.all([
    leadPage(cfg, 0, LEAD_PAGE),
    guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "299"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", "acad:booked"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", "dp:today"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "19"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "rv:log", "0", "29"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", "dp:enabled"]).catch(() => ({})),
    may("team.manage") ? users(cfg).catch(() => ({})) : Promise.resolve(null),
  ]);
  const leads = page.leads;
  const now = Date.now();
  const appts = (ar.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
    .filter((a) => a && a.at && a.at > now - 12 * 3600000 && a.at < now + 30 * 86400000)
    .sort((a, b) => a.at - b.at);
  const booked = Math.max(0, Math.min(10, Number(bk.result || 0)));
  const academy = leads.filter((l) => /^academy/i.test(String(l.concern || "")));
  let today = null; try { today = dp.result ? JSON.parse(dp.result) : null; } catch (e) {}
  let queue = (q.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
  const reviews = (rv.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
  const team = teamRaw;
  const caps = caps0, allow = may;
  if (!allow("leads.view")) { leads.length = 0; page.leadsTotal = 0; page.more = false; }
  if (!allow("reviews.view")) reviews.length = 0;
  if (!allow("appts.view")) appts.length = 0;
  // Academy and the post queue used to go out to every logged-in user.
  if (!allow("academy.view")) academy.length = 0;
  const seePosts = allow("posts.view");
  if (!seePosts) { today = null; queue.length = 0; }
  const rk = roleOf(me.role, roles);
  return { me: Object.assign({}, me, { caps, roleLabel: roles[rk].label, roleTe: roles[rk].te }), roles, capList: CAPS, capTe: CAP_TE, capGroups: CAP_GROUPS, leads, leadsTotal: page.leadsTotal, leadsMore: page.more, leadPage: LEAD_PAGE, statuses: STATUSES, appts, academy: { booked: allow("academy.view") ? booked : 0, left: allow("academy.view") ? 10 - booked : 0, leads: academy }, today, queue, dailyOn: String(en.result || "1") !== "0", reviews, team, owners: can(me, "team.manage", roles) ? ownerPhones() : undefined, ts: now };
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
    const ok = await checkPassword(cfg, phone, pwd);
    if (ok === null) return json(res, 501, { error: "Ee number ki password set cheyaledu — OTP tho login cheyandi." });
    if (!ok) {
      // Wrong passwords were counted, to slow someone down, and then
      // forgotten. Nobody was ever told that somebody was trying. The rate
      // limit still holds the door; this says who is knocking.
      try {
        const missKey = `rl:miss:${phone}`;
        const [n] = await guard.kvPipeline(cfg, [["INCR", missKey], ["EXPIRE", missKey, "3600"]]);
        const misses = Number(n || 0);
        if (misses === 5) {
          const told = await guard.kvCommand(cfg, ["SET", `rl:miss:told:${phone}`, "1", "NX", "EX", "3600"]).catch(() => ({}));
          if (told && told.result) {
            for (const ownerPh of ownerPhones()) {
              await notify.sendWa(ownerPh,
                `\u26a0\ufe0f *DermaLuxe* — ${u.name} (${phone}) account ki 5 saarlu tappu password try chesaru (last 1 hour).\n\nVaalle ayithe parledu. Kaakapothe Control panel lo aa login ni off cheyyandi.`
              ).catch(() => {});
            }
          }
        }
      } catch (e) { console.error("login: miss counter", e && e.message); }
      return json(res, 401, { error: "Password tappu" });
    }
    await guard.kvCommand(cfg, ["DEL", `rl:miss:${phone}`]).catch(() => {});
    await guard.kvCommand(cfg, ["HSET", "staff:lastlogin", phone, String(Date.now())]).catch(() => {});
    // A password somebody else chose is a password to be replaced.
    return json(res, 200, { ok: true, token: makeToken(u, await epochOf(cfg, phone)), me: u, mustChange: !!ok.temp });
  }
  if (a === "send") {
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid 10-digit mobile number ivvandi" });
    // Two different worries, so two different limits.
    //
    // The clinic is behind one broadband connection, so everybody logging in
    // shares an address — twelve an hour was tight enough to block the fifth
    // person on a morning when new logins are handed out.
    //
    // The one that actually matters is per number, and it was missing: verify
    // stops after five wrong codes, but asking for a NEW code resets that
    // counter, so without this an attacker had unlimited rounds of five — and
    // could bury a staff member's WhatsApp in OTPs from any number of
    // addresses.
    const rlIp = await guard.rateLimit(cfg, `rl:stf:${ip}`, 30, 3600);
    const rlPh = await guard.rateLimit(cfg, `rl:stf:p:${phone}`, 5, 3600);
    const rlDay = await guard.rateLimit(cfg, `rl:stf:d:${phone}`, 15, 86400);
    if (!rlIp.allowed || !rlPh.allowed || !rlDay.allowed) {
      return json(res, 429, { error: "Chala sarlu OTP adigaru — konchem sepu aagandi (password unte daantho login cheyandi)" });
    }
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
    return json(res, 200, { ok: true, token: makeToken(u, await epochOf(cfg, phone)), me: u });
  }

  // ---- everything below needs a session ----
  const me = readToken(req);
  if (!me) return json(res, 401, { error: "Login required" });
  // Re-check the allowlist so removed staff lose access immediately — the
  // role book, the person and their session epoch, asked for together
  // because none of them depends on the others.
  // The rate limiter rides along: counting this request does not depend on
  // who is making it, so it costs nothing extra here and saves a whole trip.
  const rlKey = `rl:str:${me.phone}`;
  let rolesRaw = {}, userRaw = null, epochRaw = 0, rlCount = 0, rlTtl = -1;
  try {
    const [rr, ur, er, n, ttl] = await guard.kvPipeline(cfg, [
      ["HGETALL", ROLES_KEY],
      ["HGET", USERS, me.phone],
      ["HGET", EPOCH_KEY, me.phone],
      ["INCR", rlKey],
      ["TTL", rlKey],
    ]);
    rolesRaw = hashOf(rr); userRaw = ur; epochRaw = er;
    rlCount = Number(n || 0); rlTtl = Number(ttl);
  } catch (err) {
    console.error("staff: batched read", err && err.message);
    rolesRaw = await hashAll(cfg, ROLES_KEY).catch(() => ({}));
    userRaw = (await guard.kvCommand(cfg, ["HGET", USERS, me.phone]).catch(() => ({}))).result;
    epochRaw = (await guard.kvCommand(cfg, ["HGET", EPOCH_KEY, me.phone]).catch(() => ({}))).result;
  }
  const roles = mergeRoles(rolesRaw);
  const live = shapeUser(me.phone, userRaw, roles);
  if (!live) return json(res, 403, { error: "Access removed" });
  if (live.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
  if (Number(me.epoch || 0) < Number(epochRaw || 0)) return json(res, 401, { error: "Ee device nunchi logout chesaru. Malli login cheyandi." });
  me.role = live.role; me.name = live.name; me.extra = live.extra; me.revoked = live.revoked;
  // Powers are recomputed here on every request, so a role edit or a revoked
  // capability takes effect immediately — no re-login, no stale token.
  const allow = (c) => can(me, c, roles);

  if (rlCount > 900) return json(res, 429, { error: "Too many requests" });
  // Only the first request of an hour needs a second trip to set the window.
  if (rlCount > 0 && rlTtl < 0) guard.kvCommand(cfg, ["EXPIRE", rlKey, "3600"]).catch(() => {});
  if (!rlCount) {                                   // the batched read fell back
    const rlRead = await guard.rateLimit(cfg, rlKey, 900, 3600);
    if (!rlRead.allowed) return json(res, 429, { error: "Too many requests" });
  }

  if (a === "me") return json(res, 200, { ok: true, me: Object.assign({}, me, { caps: effCaps(roles, me) }) });
  if (a === "data") return json(res, 200, await dataPayload(cfg, me, roles));

  // The rest of the lead book, a page at a time. The app asks for this when
  // someone searches, opens Patients, or widens the date filter — not on the
  // way in, which is the whole point.
  if (a === "leads") {
    if (!allow("leads.view")) return json(res, 403, { error: "Mee role ki leads chuse permission ledu" });
    const rl = await guard.rateLimit(cfg, `rl:lp:${me.phone}`, 120, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const page = await leadPage(cfg, q.offset, LEAD_PAGE);
    return json(res, 200, Object.assign({ ok: true }, page));
  }

  // ---- what the clinic is holding ----
  // Nobody could answer "how much are the photos costing us" without guessing,
  // so the guess is replaced with a count. It walks the photo records, which
  // is not free, so the answer is cached for ten minutes.
  if (a === "storage") {
    if (!allow("settings.manage")) return json(res, 403, { error: "Idi owner ki matrame" });
    const ck = "storage:stats";
    if (q.fresh !== "1") {
      const hit = await guard.kvCommand(cfg, ["GET", ck]).catch(() => ({}));
      if (hit && hit.result) { try { return json(res, 200, Object.assign({ ok: true, cached: true }, JSON.parse(hit.result))); } catch (e) {} }
    }
    const dbsize = await guard.kvCommand(cfg, ["DBSIZE"]).catch(() => ({}));
    let photos = {};
    try { photos = await require("./_photo-store.js").stats(cfg); }
    catch (e) { console.error("storage: photos", e && e.message); photos = { error: true }; }
    const [leadCount, apptCount] = await Promise.all([
      guard.kvCommand(cfg, ["LLEN", LEADS]).catch(() => ({})),
      guard.kvCommand(cfg, ["LLEN", "appt:q"]).catch(() => ({})),
    ]);
    const out = {
      keys: Number((dbsize && dbsize.result) || 0),
      leads: Number((leadCount && leadCount.result) || 0),
      appts: Number((apptCount && apptCount.result) || 0),
      photos, at: Date.now(),
    };
    await guard.kvCommand(cfg, ["SET", ck, JSON.stringify(out), "EX", "600"]).catch(() => {});
    return json(res, 200, Object.assign({ ok: true, cached: false }, out));
  }

  // Move a batch of photos out of Redis now, rather than waiting for the
  // hourly job. Same code, same read-back check; this only sets the pace.
  if (a === "storage-move") {
    if (!allow("settings.manage")) return json(res, 403, { error: "Idi owner ki matrame" });
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const rl = await guard.rateLimit(cfg, `rl:mv:${me.phone}`, 60, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Konchem aagandi" });
    let out;
    try { out = await require("./_photo-store.js").migrate(cfg, 20); }
    catch (e) { console.error("storage-move", e && e.message); return json(res, 500, { error: "Move avvaledu — malli try cheyandi" }); }
    await guard.kvCommand(cfg, ["DEL", "storage:stats"]).catch(() => {});   // the panel figure is now stale
    return json(res, 200, Object.assign({ ok: true }, out));
  }

  // ---- control panel (read) ----
  if (a === "panel") {
    if (!allow("team.manage")) return json(res, 403, { error: "Control panel owner/manager ki matrame" });
    const [team, last, pwd, log, pwdPhones] = await Promise.all([
      users(cfg), hashAll(cfg, "staff:lastlogin").catch(() => ({})),
      guard.kvCommand(cfg, ["HGET", "staff:pwd", me.phone]).catch(() => ({})),
      guard.kvCommand(cfg, ["LRANGE", "staff:audit", "0", "49"]).catch(() => ({})),
      // Only which numbers have one — never a hash, never a length.
      guard.kvCommand(cfg, ["HKEYS", "staff:pwd"]).catch(() => ({})),
    ]);
    // Two things that were written and never shown: when the hourly database
    // check last passed (if that job itself stops, nothing else says so), and
    // what the automatic review ask has sent.
    const [hl, rl] = await guard.kvPipeline(cfg, [["GET", "health:last"], ["LRANGE", "rev:log", "0", "13"]]).catch(() => [null, []]);
    const health = {
      dbCheckAt: Number(hl) || 0,
      reviewAsks: (Array.isArray(rl) ? rl : []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean),
    };
    const hasPwd = new Set((pwdPhones && pwdPhones.result) || []);
    // Who is still using the one the owner sent them, rather than their own.
    const tempPwd = new Set();
    try {
      const all = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "staff:pwd"]).catch(() => ({}))).result);
      for (const [ph, raw] of Object.entries(all)) {
        try { if (JSON.parse(raw).temp) tempPwd.add(ph); } catch (e) {}
      }
    } catch (e) {}
    const people = Object.keys(team).map((ph) => {
      const u = Object.assign({ phone: ph }, team[ph]);
      u.role = roleOf(u.role, roles);
      u.caps = effCaps(roles, u);
      u.lastLogin = Number(last[ph] || 0) || null;
      u.hasPwd = hasPwd.has(ph);
      u.tempPwd = tempPwd.has(ph);
      return u;
    }).sort((x, y) => (y.lastLogin || 0) - (x.lastLogin || 0));
    const audit = (log.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
    return json(res, 200, {
      ok: true, roles, capList: CAPS, capTe: CAP_TE, capGroups: CAP_GROUPS, people, health,
      owners: ownerPhones().map((ph) => ({ phone: ph, lastLogin: Number(last[ph] || 0) || null })),
      passwordSet: !!(pwd && pwd.result),
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
    // A write made offline carries the moment it was actually made. If someone
    // in the clinic has changed this lead since, the older write is dropped
    // rather than allowed to undo the newer one.
    const at = stamp(b.at);
    const prev = await guard.kvCommand(cfg, ["HGET", STATUS_TS, key]).catch(() => ({}));
    const prevAt = Number((prev && prev.result) || 0);
    if (prevAt && at < prevAt) return json(res, 200, { ok: true, skipped: "newer change already saved", at: prevAt });
    await guard.kvCommand(cfg, ["HSET", STATUS, key, s]);
    await guard.kvCommand(cfg, ["HSET", STATUS_TS, key, String(at)]).catch(() => {});
    return json(res, 200, { ok: true, at });
  }
  if (a === "note") {
    if (!allow("leads.edit")) return json(res, 403, { error: "Mee role ki note add chese permission ledu" });
    const text = String(b.text || "").trim().slice(0, 400);
    if (!key || !text) return json(res, 400, { error: "key + text required" });
    const cur = await guard.kvCommand(cfg, ["HGET", NOTES, key]).catch(() => ({}));
    let list = []; try { list = JSON.parse(cur.result || "[]"); } catch (e) {}
    // Notes only ever append, so an offline one is simply filed at the time it
    // was written rather than the time it finally reached us.
    const nAt = stamp(b.at);
    list.unshift({ ts: nAt, by: me.name, text });
    list.sort((x, y) => (y.ts || 0) - (x.ts || 0));
    await guard.kvCommand(cfg, ["HSET", NOTES, key, JSON.stringify(list.slice(0, 30))]);
    return json(res, 200, { ok: true, notes: list.slice(0, 30) });
  }
  // A lead that walked in, or rang the clinic, or came from a friend. Every
  // other source writes into dl_leads and forwards to the clinic platform;
  // this is the one that was missing, so the desk had to wait for a patient
  // to message before they existed anywhere.
  if (a === "lead-add") {
    if (!allow("leads.edit")) return json(res, 403, { error: "Mee role ki lead add chese permission ledu" });
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid 10-digit number ivvandi" });
    const name = String(b.name || "").trim().slice(0, 60);
    if (!name) return json(res, 400, { error: "Peru ivvandi" });
    const rlAdd = await guard.rateLimit(cfg, `rl:ladd:${me.phone}`, 200, 3600);
    if (!rlAdd.allowed) return json(res, 429, { error: "Konchem aagandi" });

    const SRC = ["walkin", "phone", "referral", "poster", "camp", "other"];
    const src = SRC.includes(String(b.src)) ? String(b.src) : "walkin";
    const at = stamp(b.at);
    const lead = {
      ts: at, type: src, src,
      name, phone,
      age: String(b.age || "").slice(0, 8),
      gender: String(b.gender || "").slice(0, 12),
      concern: String(b.concern || "").trim().slice(0, 120),
      message: String(b.message || "").trim().slice(0, 400),
      heat: ["hot", "warm", "cold"].includes(String(b.heat)) ? String(b.heat) : "warm",
      by: me.name, byPhone: me.phone, manual: true,
    };

    // The same number twice in a week is nearly always the desk entering
    // somebody who already rang. Say so rather than quietly making a second
    // card for one person.
    const recent = await guard.kvCommand(cfg, ["LRANGE", LEADS, "0", "199"]).catch(() => ({}));
    let dupe = null;
    for (const raw of (recent.result || [])) {
      try {
        const l = JSON.parse(raw);
        if (digits10(l.phone) === phone && at - Number(l.ts || 0) < 7 * 86400000) { dupe = l; break; }
      } catch (e) {}
    }
    if (dupe && !b.anyway) {
      return json(res, 409, {
        error: `Ee number ${new Date(Number(dupe.ts)).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })} na already vachindi (${String(dupe.name || "")}). Malli add cheyyala?`,
        duplicate: { name: dupe.name || "", ts: dupe.ts, key: leadKey(dupe) },
      });
    }

    // Same order as every other source: the platform first, so the stored
    // copy carries whether it got there.
    const sync = await clinic.forwardLead(cfg, lead);
    if (sync.attempted) lead.synced = sync.synced;

    const ok = await guard.kvWrite(cfg, ["LPUSH", LEADS, JSON.stringify(lead)], "manual lead");
    if (!ok) return json(res, 500, { error: "Save avvaledu — malli try cheyandi" });
    await guard.kvCommand(cfg, ["LTRIM", LEADS, "0", "4999"]).catch(() => {});

    const key = leadKey(lead);
    if (b.status && ["new", "contacted", "booked", "visited", "closed"].includes(String(b.status))) {
      await guard.kvCommand(cfg, ["HSET", STATUS, key, String(b.status)]).catch(() => {});
      await guard.kvCommand(cfg, ["HSET", STATUS_TS, key, String(at)]).catch(() => {});
    }
    if (lead.message) {
      await guard.kvCommand(cfg, ["HSET", NOTES, key, JSON.stringify([{ ts: at, by: me.name, text: lead.message }])]).catch(() => {});
    }
    console.log("manual lead", src, "by", me.phone.slice(-4), sync.attempted ? (sync.synced ? "· synced" : "· sync failed, parked") : "");
    return json(res, 200, { ok: true, lead, key, synced: sync.attempted ? sync.synced : null });
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
  const PANEL = ["team-add", "team-remove", "team-role", "team-caps", "team-suspend", "team-signout", "role-save", "role-delete"];
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
    if (capsOf(roleOf(b.role, roles), roles).includes("team.manage"))
      return json(res, 403, { error: "Control panel unna role ivvagaligedi owner matrame" });
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
  // Your own password, nobody else's. An owner cannot set a password for a
  // staff member — that person sets their own, or logs in with an OTP.
  // Give somebody a working login.
  //
  // Adding a person only told them the dashboard exists; they still had to
  // arrive by OTP before they could set a password, which is a poor way to
  // hand a new receptionist their access on their first morning. Now the
  // owner presses a button, the server invents a password, stores only its
  // hash, and sends it to that person's own WhatsApp. The owner never sees
  // it and neither does anything else — and because it is marked temporary,
  // they are asked to replace it with one of their own the moment they use it.
  if (a === "team-password") {
    if (!allow("team.manage")) return json(res, 403, { error: "Idi owner/manager ki matrame" });
    const phone = digits10(b.phone);
    const team = await users(cfg);
    const person = team[phone];
    if (!person) return json(res, 404, { error: "Ee number staff list lo ledu" });
    if (ownerPhones().includes(phone)) return json(res, 400, { error: "Owner numbers ki password ikkada ivvalemu" });
    if (roleOf(person.role, roles) === "owner" && me.role !== "owner") {
      return json(res, 403, { error: "Owner ki password owner matrame ivvagalaru" });
    }
    const rl = await guard.rateLimit(cfg, `rl:pw:${me.phone}`, 20, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Konchem aagandi" });

    // No 0/O or 1/l/I — this gets read off a phone screen and typed on another.
    const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
    let pwd = "";
    for (const n of crypto.randomBytes(10)) pwd += ALPHA[n % ALPHA.length];
    const salt = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["HSET", "staff:pwd", phone, JSON.stringify({ salt, hash: scrypt(pwd, salt), ts: Date.now(), temp: true, by: me.phone })]);

    const sent = await notify.sendWa(phone,
      `🔐 *DermaLuxe staff login*\n\n${person.name} garu, mee login ready.\n\n🔗 www.dermaluxe.ai/staff.html\n📱 Number: ${phone}\n🔑 Password: *${pwd}*\n\nLogin ayyaka ⚙ Control panel lo mee sonta password pettukondi — idi taatkalikam.`
    ).catch(() => false);
    await audit(cfg, me, `Sent a new login password to ${person.name} (${phone})`);
    // The password is never returned to the browser — not even to the owner's.
    return json(res, 200, { ok: true, sent: !!sent, phone });
  }

  if (a === "set-password") {
    const pwd = String(b.password || "");
    if (b.off === true) {
      await guard.kvCommand(cfg, ["HDEL", "staff:pwd", me.phone]);
      await audit(cfg, me, "Sonta password teesesaru — OTP only");
      return json(res, 200, { ok: true, off: true });
    }
    if (pwd.length < 8) return json(res, 400, { error: "Password kaneesam 8 characters undali" });
    const salt = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["HSET", "staff:pwd", me.phone, JSON.stringify({ salt, hash: scrypt(pwd, salt), ts: Date.now() })]);
    await audit(cfg, me, "Sonta password set chesukunnaru");   // no longer temporary
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
  // Phone lost or stolen: one tap kills every session that person holds.
  if (a === "team-signout") {
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    if (!isOwner && phone === me.phone) return json(res, 403, { error: "Mee sonta session ni ikkada nunchi aapukolekaru — Logout vaadandi." });
    const all = await users(cfg);
    if (!isOwner && guard.isOwnerPhone(phone)) return json(res, 403, { error: "Owner ni logout cheyagaligedi owner matrame" });
    const n = await bumpEpoch(cfg, phone);
    // their phones should stop getting notifications too
    try { const push = require("./_push.js"); for (const t of await push.devicesOf(cfg, phone)) await push.dropDevice(cfg, t); } catch (e) {}
    await audit(cfg, me, `${(all[phone] && all[phone].name) || phone} — anni devices nunchi logout chesaru`);
    notify.sendWa(phone, "🔒 Mee DermaLuxe app anni phones nunchi logout ayindi. Malli login cheyyalante owner ni adagandi.").catch(() => {});
    return json(res, 200, { ok: true, epoch: n });
  }
  if (a === "team-suspend") {
    const phone = digits10(b.phone), off = b.off === true;
    const all = await users(cfg);
    if (!all[phone]) return json(res, 404, { error: "Staff member not found" });
    if (!isOwner && all[phone].role === "owner") return json(res, 403, { error: "Owner record ni marchagaligedi owner matrame" });
    all[phone].off = off;
    await guard.kvCommand(cfg, ["HSET", USERS, phone, JSON.stringify(all[phone])]);
    if (off) {
      await bumpEpoch(cfg, phone);   // switching someone off must log them out now
      try { const push = require("./_push.js"); for (const t of await push.devicesOf(cfg, phone)) await push.dropDevice(cfg, t); } catch (e) {}
    }
    await audit(cfg, me, `${all[phone].name} (${phone}) access ${off ? "OFF chesaru" : "malli ON chesaru"}`);
    notify.sendWa(phone, off
      ? "🔒 Mee DermaLuxe dashboard access ippudu off lo undi. Doubt unte owner ni adagandi."
      : "🔓 Mee DermaLuxe dashboard access malli on ayindi — www.dermaluxe.ai/staff.html").catch(() => {});
    return json(res, 200, { ok: true, team: await users(cfg) });
  }
  if (a === "team-remove") {
    const phone = digits10(b.phone);
    const all = await users(cfg);
    if (!isOwner && (guard.isOwnerPhone(phone) || (all[phone] && all[phone].role === "owner"))) return json(res, 403, { error: "Owner record ni teeyagaligedi owner matrame" });
    await guard.kvCommand(cfg, ["HDEL", USERS, phone]);
    await guard.kvCommand(cfg, ["HDEL", "staff:lastlogin", phone]).catch(() => {});
    await bumpEpoch(cfg, phone);
    try { const push = require("./_push.js"); for (const t of await push.devicesOf(cfg, phone)) await push.dropDevice(cfg, t); } catch (e) {}
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
// The only correct way for another endpoint to authenticate a staff request.
// Returns { ok:false, code, error } or { ok:true, me, caps, roles, allow }.
// Every rule lives here — signature, expiry, still-employed, not suspended,
// and the session epoch that "sign out from all phones" bumps.
// Every authenticated request starts here, so what it costs, everything
// costs. It needs three things — the role book, the person, and the session
// epoch — and none of them depends on the others, so they are asked for
// together. Three trips to the database became one, on every single request.
module.exports.requireStaff = async function (cfg, req) {
  const tok = readToken(req);
  if (!tok) return { ok: false, code: 401, error: "Login required" };
  let rolesRaw = {}, userRaw = null, epochRaw = 0;
  try {
    const [r, u, e] = await guard.kvPipeline(cfg, [
      ["HGETALL", ROLES_KEY],
      ["HGET", USERS, tok.phone],
      ["HGET", EPOCH_KEY, tok.phone],
    ]);
    rolesRaw = hashOf(r); userRaw = u; epochRaw = e;
  } catch (err) {
    // One batched read failing should not lock the clinic out; fall back to
    // asking separately, which is slower but no less correct.
    console.error("requireStaff: batched read", err && err.message);
    rolesRaw = await hashAll(cfg, ROLES_KEY).catch(() => ({}));
    userRaw = (await guard.kvCommand(cfg, ["HGET", USERS, tok.phone]).catch(() => ({}))).result;
    epochRaw = (await guard.kvCommand(cfg, ["HGET", EPOCH_KEY, tok.phone]).catch(() => ({}))).result;
  }
  const roles = mergeRoles(rolesRaw);
  const live = shapeUser(tok.phone, userRaw, roles);
  if (!live) return { ok: false, code: 403, error: "Access removed" };
  if (live.off) return { ok: false, code: 403, error: "Mee access ippudu off lo undi. Owner ni adagandi." };
  if (Number(tok.epoch || 0) < Number(epochRaw || 0)) return { ok: false, code: 401, error: "Ee device nunchi logout chesaru. Malli login cheyandi." };
  const caps = effCaps(roles, live);
  return { ok: true, me: live, caps, roles, allow: (c) => caps.includes("*") || caps.includes(c) };
};
module.exports.capsFor = async function (cfg, user) {
  const roles = await loadRoles(cfg);
  return effCaps(roles, user);
};
