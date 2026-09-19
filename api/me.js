// /api/me — the patient's own page (my.html).
//
// A patient signs in with a code sent to their WhatsApp and sees only what
// is theirs: upcoming appointments (and can confirm one), past visits, bills
// with what is still owed and a link to pay it, and how far along each
// package of sittings is. They can ask to book, reschedule or cancel — that
// arrives at the desk as a request, it never moves the diary by itself.
//
// Codes go only to numbers the clinic already knows (an enquiry, a bill or
// an appointment), so this cannot be used to send WhatsApp messages to
// strangers. The session is an HMAC-signed token for 30 days.
//
//   POST {a:"send", phone}          a code on WhatsApp
//   POST {a:"verify", phone, code}  → { token }
//   GET  ?a=home        (Bearer)    everything above
//   POST {a:"confirm", at}          "I'll come" for an upcoming appointment
//   POST {a:"request", kind, when, note, at?}   book | reschedule | cancel
const crypto = require("crypto");
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const money = require("./money.js");
const pay = require("./_pay.js");
const leadstore = require("./_leadstore.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(code).json(body);
};
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const secret = () => process.env.STAFF_SECRET || process.env.ADMIN_KEY || "";
const DAYS30 = 30 * 86400000;

function signSession(phone) {
  const exp = Date.now() + DAYS30;
  const body = `pt.${phone}.${exp}`;
  return Buffer.from(`${body}.${crypto.createHmac("sha256", secret()).update(body).digest("hex")}`).toString("base64url");
}
function session(req) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok || !secret()) return null;
  try {
    const [pt, phone, exp, sig] = Buffer.from(tok, "base64url").toString().split(".");
    if (pt !== "pt" || !/^[6-9]\d{9}$/.test(phone) || !(Number(exp) > Date.now())) return null;
    const want = crypto.createHmac("sha256", secret()).update(`pt.${phone}.${exp}`).digest("hex");
    return guard.safeEqual(sig, want) ? phone : null;
  } catch (e) { return null; }
}

const list = async (cfg, key, n) => (((await guard.kvCommand(cfg, ["LRANGE", key, "0", String(n - 1)]).catch(() => ({}))) || {}).result) || [];

async function known(cfg, phone) {
  if ((await list(cfg, `bill:of:${phone}`, 1)).length) return true;
  if ((await list(cfg, "appt:q", 400)).some((x) => ten((parse(x, {}) || {}).ph) === phone)) return true;
  return (await list(cfg, "dl_leads", 1500)).some((x) => ten((parse(x, {}) || {}).phone) === phone);
}

async function home(cfg, phone) {
  const now = Date.now();
  const q = (await list(cfg, "appt:q", 400)).map((x) => parse(x, null)).filter((a) => a && ten(a.ph) === phone && a.at);
  const done = (await list(cfg, "appt:done", 500)).map((x) => parse(x, null)).filter((a) => a && ten(a.ph) === phone && a.at && a.status !== "cancelled");
  const leads = (await list(cfg, "dl_leads", 1500)).map((x) => parse(x, null)).filter((l) => l && ten(l.phone) === phone);
  const extra = parse(((await guard.kvCommand(cfg, ["GET", `pt:${phone}`]).catch(() => ({}))) || {}).result || "", {}) || {};
  const name = extra.name || (leads.find((l) => l.name) || {}).name || (q.find((a) => a.name) || {}).name || "";

  const bills = [];
  for (const id of await list(cfg, `bill:of:${phone}`, 30)) {
    const b = await money.getBill(cfg, id);
    if (!b) continue;
    const t = money.totals(b);
    bills.push({ id: b.id, date: b.ts, items: (b.items || []).map((i) => i.name), total: t.total, paid: t.paid, balance: t.balance,
      pay: t.balance > 0 && (process.env.UPI_VPA || pay.rzpOn()) ? pay.link(b.id) : null,
      receipt: pay.link(b.id) });
  }
  const pk = require("./package.js");
  const packages = [];
  for (const id of await list(cfg, `pkg:of:${phone}`, 30)) {
    const p = parse(((await guard.kvCommand(cfg, ["GET", `pkg:${id}`]).catch(() => ({}))) || {}).result || "", null);
    if (!p) continue;
    const s = pk.shape(p);
    packages.push({ treatment: s.treatment, done: s.done, total: s.total, left: s.left, nextDue: s.nextDue, status: s.status });
  }
  return {
    name: String(name).split(" ")[0],
    upcoming: q.filter((a) => a.at > now - 3600000 && !["cancelled", "done", "noshow"].includes(a.status))
      .sort((a, b) => a.at - b.at).map((a) => ({ at: a.at, concern: a.concern || a.treatment || "", confirmed: !!a.cf, doctor: a.staffName || "" })),
    visits: done.filter((a) => !a.ns && a.status !== "noshow").sort((a, b) => b.at - a.at).slice(0, 20).map((a) => ({ at: a.at, concern: a.concern || "" })),
    bills: bills.sort((a, b) => b.date - a.date),
    due: bills.reduce((n, b) => n + b.balance, 0),
    packages,
  };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });
  if (!secret()) return json(res, 501, { error: "Not configured" });
  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "home");
  const ip = guard.getIp(req);

  if (a === "send") {
    if (!guard.originAllowed(req)) return json(res, 403, { error: "Unauthorized request origin" });
    const phone = ten(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "10 ankela mobile number ivvandi" });
    const r1 = await guard.rateLimit(cfg, `rl:me:ip:${ip}`, 8, 3600);
    const r2 = await guard.rateLimit(cfg, `rl:me:p:${phone}`, 5, 86400);
    if (!r1.allowed || !r2.allowed) return json(res, 429, { error: "Chala sarlu try chesaru — konchem sepu tarvata" });
    // Same answer either way, so the page cannot be used to learn who is a patient.
    const ok = { ok: true, msg: "Ee number clinic records lo unte, WhatsApp lo code vastundi." };
    if (!(await known(cfg, phone))) return json(res, 200, ok);
    const code = String(crypto.randomInt(100000, 999999));
    await guard.kvCommand(cfg, ["SET", `me:otp:${phone}`, JSON.stringify({ code, tries: 0 }), "EX", "600"]);
    const line = `Mee DermaLuxe login code: ${code} — 10 nimishalu valid. Meeru adagakapothe ignore cheyandi.`;
    const r = await notify.sendWaAuthCode(phone, code, "verification_code").catch(() => ({}));
    if (!(r && r.ok) && !(await notify.sendWa(phone, "🔐 " + line).catch(() => false))) {
      await notify.sendWaTemplate(phone, "clinic_update", ["there", line]).catch(() => {});
    }
    return json(res, 200, ok);
  }

  if (a === "verify") {
    if (!guard.originAllowed(req)) return json(res, 403, { error: "Unauthorized request origin" });
    const phone = ten(b.phone), code = String(b.code || "").trim();
    const rl = await guard.rateLimit(cfg, `rl:me:v:${ip}`, 20, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Chala sarlu try chesaru" });
    const rec = parse(((await guard.kvCommand(cfg, ["GET", `me:otp:${phone}`]).catch(() => ({}))) || {}).result || "", null);
    if (!rec) return json(res, 401, { error: "Code expire ayindi — malli pampandi" });
    if (rec.tries >= 5) { await guard.kvCommand(cfg, ["DEL", `me:otp:${phone}`]); return json(res, 429, { error: "Chala tappu codes — malli code teesukondi" }); }
    if (!guard.safeEqual(code, rec.code)) {
      await guard.kvCommand(cfg, ["SET", `me:otp:${phone}`, JSON.stringify({ code: rec.code, tries: rec.tries + 1 }), "EX", "600"]);
      return json(res, 401, { error: "Code tappu" });
    }
    await guard.kvCommand(cfg, ["DEL", `me:otp:${phone}`]);
    return json(res, 200, { ok: true, token: signSession(phone) });
  }

  const phone = session(req);
  if (!phone) return json(res, 401, { error: "Malli login avvandi" });
  const rl = await guard.rateLimit(cfg, `rl:me:u:${phone}`, 120, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Konchem sepu aagandi" });

  if (a === "home") return json(res, 200, Object.assign({ ok: true, phone }, await home(cfg, phone)));

  if (req.method !== "POST") return json(res, 405, { error: "POST" });

  if (a === "confirm") {
    const at = Number(b.at);
    for (const raw of await list(cfg, "appt:q", 400)) {
      const x = parse(raw, null);
      if (!x || ten(x.ph) !== phone || Math.abs(Number(x.at) - at) > 60000) continue;
      if (!x.cf) {
        x.cf = true; x.cfVia = "portal";
        await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
        await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(x)]).catch(() => {});
      }
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "Aa appointment dorakaledu" });
  }

  if (a === "request") {
    const kind = ["book", "reschedule", "cancel"].includes(b.kind) ? b.kind : "book";
    const perDay = await guard.rateLimit(cfg, `rl:me:r:${phone}`, 6, 86400);
    if (!perDay.allowed) return json(res, 429, { error: "Ee roju ki chala requests — clinic ki call cheyandi" });
    const when = clean(b.when, 60), note = clean(b.note, 200);
    const at = Number(b.at) || 0;
    const h2 = await home(cfg, phone);
    const label = { book: "Kotha appointment kavali", reschedule: "Appointment marchali", cancel: "Appointment cancel cheyyali" }[kind];
    const concern = `${label}${at ? " (" + new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + ")" : ""}${when ? " → " + when : ""}`;
    const lead = { ts: Date.now(), type: "portal", name: h2.name || "Patient", phone, concern: concern.slice(0, 120), message: note,
      heat: kind === "cancel" ? "warm" : "hot", page: "my.html", src_id: phone, call_prep: `Patient portal nundi: ${label}. ${note}`.slice(0, 220) };
    await leadstore.saveLead(cfg, lead, (l) => l.type === "portal" && ten(l.phone) === phone && lead.ts - l.ts < 3600000);
    await notify.leadAlert(cfg, lead).catch(() => {});
    return json(res, 200, { ok: true, msg: "Clinic ki cheppamu 🙏 Konchem sepu lo WhatsApp lo confirm chestaru." });
  }

  return json(res, 400, { error: "Unknown action" });
};
