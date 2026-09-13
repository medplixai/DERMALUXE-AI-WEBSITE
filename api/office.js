// api/office.js — "AI Office": the staff dashboard's assistant.
// POST { q, history? } with a Bearer token from /api/staff.
// It reads the clinic's live data (scoped to the staff member's role) and
// answers in the same Tenglish house style. It never messages patients itself —
// it drafts, summarises and explains; staff press send.
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");
const docs = require("./_docs.js");

const secret = () => process.env.STAFF_SECRET || process.env.ADMIN_KEY || process.env.WA_WEBHOOK_TOKEN || "";
const sign = (p) => crypto.createHmac("sha256", secret()).update(p).digest("hex");
const json = (res, c, o) => { res.setHeader("Cache-Control", "no-store"); return res.status(c).json(o); };
function staffUser(req) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const [payload, sig] = tok.split(".");
  if (!payload || !sig || !secret() || !guard.safeEqual(sig, sign(payload))) return null;
  try { const u = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); return u.exp > Date.now() ? { phone: u.p, name: u.n, role: u.r } : null; } catch (e) { return null; }
}
const has = (u, cap) => { const c = (u && u.caps) || staff.capsOf(u && u.role); return c.includes("*") || c.includes(cap); };
const istNow = () => new Date(Date.now() + 19800000);
const dayStart = () => { const d = istNow(); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 19800000; };
const fmt = (ts) => new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function hashAll(cfg, key) {
  const r = await guard.kvCommand(cfg, ["HGETALL", key]).catch(() => ({}));
  const a = r.result || [], out = {};
  if (Array.isArray(a)) { for (let i = 0; i + 1 < a.length; i += 2) out[a[i]] = a[i + 1]; }
  else if (a && typeof a === "object") Object.assign(out, a);
  return out;
}
const parseList = (r) => (r && r.result ? r.result : []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);

// Compact, role-scoped snapshot of the clinic right now.
async function snapshot(cfg, me) {
  const out = [];
  const now = Date.now(), d0 = dayStart(), week = now - 7 * 86400000;
  const [lr, st, ar, bk, dp, rv, slr] = await Promise.all([
    guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "399"]).catch(() => ({})),
    hashAll(cfg, "dl_status"),
    guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", "acad:booked"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", "dp:today"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "rv:log", "0", "49"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "acad:st:list", "0", "99"]).catch(() => ({})),
  ]);
  const leadKey = (l) => `${l.ts}|${String(l.phone || "").replace(/\D/g, "").slice(-10) || l.src_id || ""}`;
  const leads = parseList(lr).map((l) => Object.assign({}, l, { status: st[leadKey(l)] || "new" }));

  if (has(me, "leads.view")) {
    const today = leads.filter((l) => l.ts >= d0), wk = leads.filter((l) => l.ts >= week);
    const by = (arr, k) => arr.reduce((m, l) => { const v = String(l[k] || "—"); m[v] = (m[v] || 0) + 1; return m; }, {});
    out.push(`LEADS — total stored ${leads.length}; today ${today.length}; last 7 days ${wk.length}.`);
    out.push(`  by status (7d): ${JSON.stringify(by(wk, "status"))}`);
    out.push(`  by source (7d): ${JSON.stringify(by(wk, "type"))}`);
    const hot = leads.filter((l) => l.heat === "hot" && ["new", "contacted"].includes(l.status)).slice(0, 12);
    out.push(`  HOT & still open (${hot.length}):`);
    hot.forEach((l) => out.push(`   • ${l.name || "?"} | ${l.phone || l.src_id || "no phone"} | ${l.concern || "-"} | ${l.status} | ${fmt(l.ts)}${l.call_prep ? " | prep: " + String(l.call_prep).slice(0, 90) : ""}`));
    const stale = leads.filter((l) => l.status === "new" && l.ts < now - 2 * 86400000).length;
    if (stale) out.push(`  ${stale} leads are still "new" and older than 2 days.`);
  }
  if (has(me, "appts.view")) {
    const appts = parseList(ar).filter((a) => a.at && a.at > now - 6 * 3600000 && a.at < now + 8 * 86400000).sort((a, b) => a.at - b.at);
    out.push(`APPOINTMENTS — next 7 days: ${appts.length}.`);
    appts.slice(0, 15).forEach((a) => out.push(`   • ${fmt(a.at)} | ${a.name || "?"} | ${a.ph || ""} | ${a.concern || a.treatment || ""}`));
  }
  if (has(me, "academy.view")) {
    const booked = Number(bk.result || 0);
    const ids = slr.result || [];
    const studs = [];
    for (const id of ids.slice(0, 60)) { const r = await guard.kvCommand(cfg, ["GET", `acad:st:${id}`]).catch(() => ({})); try { if (r.result) studs.push(JSON.parse(r.result)); } catch (e) {} }
    const due = studs.filter((s) => Math.max(0, (s.fee || 0) - (s.paid || 0)) > 0);
    out.push(`ACADEMY — Batch ${docs.BATCH.no} starts ${docs.BATCH.start}; seats booked ${booked}/10 (${10 - booked} left); launch offer ends 30 Sep 2026.`);
    out.push(`  students on record: ${studs.length}; onboarding form pending: ${studs.filter((s) => !s.onboarded).length}; fee balance pending: ${due.length}`);
    studs.slice(0, 12).forEach((s) => out.push(`   • ${s.id} | ${s.name} | ${s.phone} | ${s.course} | paid ₹${(s.paid || 0).toLocaleString("en-IN")} / fee ₹${(s.fee || 0).toLocaleString("en-IN")} | ${s.status}${s.onboarded ? "" : " | FORM PENDING"}`));
    const acadLeads = leads.filter((l) => /^academy/i.test(String(l.concern || ""))).slice(0, 8);
    if (acadLeads.length) { out.push(`  academy enquiries not yet enrolled (${acadLeads.length}):`); acadLeads.forEach((l) => out.push(`   • ${l.name || "?"} | ${l.phone || ""} | ${l.concern} | ${l.status}`)); }
  }
  if (has(me, "posts.view")) {
    let today = null; try { today = dp.result ? JSON.parse(dp.result) : null; } catch (e) {}
    out.push(`TODAY'S POST — ${today ? `"${today.h1}" (${today.te || ""})` : "not generated yet"}.`);
  }
  if (has(me, "reviews.view")) {
    const revs = parseList(rv);
    const low = revs.filter((r) => Number(r.rating) <= 3);
    out.push(`RATINGS — last ${revs.length} recorded; ${low.length} at 3★ or below (need a service-recovery call).`);
    low.slice(0, 5).forEach((r) => out.push(`   • ${r.name || "?"} | ${r.ph || ""} | ${r.rating}★ | ${r.concern || ""}`));
  }
  return out.join("\n");
}

const CLINIC = `DermaLuxe by Medicare — Premium Skin, Hair & Aesthetics, Eluru (part of Medicare Skin & Hair Clinics: 10 branches, 3 lakh+ clients).
Mon–Sat 9 AM–9 PM, Sunday closed. Rama Mahal, Kasturi Vari Street, Opposite Happy Mobiles, R.R. Peta, Eluru 534002.
WhatsApp 99591 34666 (AI agent, 24×7) · Calls +91 99491 34666 · www.dermaluxe.ai
Doctors: Dr. Nikhitha Priyanka (MD DVL, main consultant), Dr. Meghana Valeti (MD DVL, Gold Medalist, Founder & Medical Director), Dr. Sai Divija (MD DVL).
Services: lasers (Diode LHR, PICO, CO2, MNRF), peels, Hydrafacial, acne/pigmentation/anti-ageing, hair fall, PRP & GFC, hair transplant (FUE/DHI), medical dermatology, weight loss, bridal packages.
DermaLuxe Academy: Skin Care / Hair Care / Skin+Hair courses, 1 or 2 months, 10 seats per batch, Batch 1 starts 20 Oct 2026. Launch offer ₹49,999 / ₹49,999 / ₹99,999 till 30 Sep 2026; ₹9,999 reserves a seat. Trainer Dr. Meghana Valeti.
Automation already running: WhatsApp AI agent (bookings, reminders, follow-ups, reviews, referrals), Instagram/Facebook DM agents, daily auto-post to Instagram + Facebook, academy daily study material + fee reminders, staff dashboard.`;

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const me = staffUser(req);
  if (!me) return json(res, 401, { error: "Login required" });
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });
  // Live powers from the Control panel, not the ones baked into the token.
  const roleBook = await staff.loadRoles(cfg);
  const live = await staff.liveUser(cfg, me.phone, roleBook);
  if (!live) return json(res, 403, { error: "Access removed" });
  if (live.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
  me.role = live.role; me.name = live.name;
  me.caps = staff.effCaps(roleBook, live);
  me.roleLabel = (roleBook[live.role] || {}).label || live.role;
  if (!has(me, "ai.use")) return json(res, 403, { error: "Mee role ki AI Office access ledu" });
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 501, { error: "AI key configure cheyaledu" });

  const rl = await guard.rateLimit(cfg, `rl:off:${me.phone}`, 120, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Konchem aagandi — gantaki 120 questions matrame" });

  const b = req.body || {};
  const q = String(b.q || "").trim().slice(0, 1200);
  if (!q) return json(res, 400, { error: "Question ivvandi" });
  const history = Array.isArray(b.history) ? b.history.slice(-6) : [];

  let snap = "";
  try { snap = await snapshot(cfg, me); } catch (e) { console.error("office: snapshot", e && e.message); snap = "(live data unavailable right now)"; }

  const caps = (me && me.caps) || staff.capsOf(me.role);
  const system = `You are "DermaLuxe AI Office" — the internal assistant inside the clinic's staff dashboard. You are talking to a colleague, not a patient.

WHO YOU ARE TALKING TO: ${me.name}, role "${me.roleLabel || me.role}". They can access: ${caps.includes("*") ? "everything" : caps.join(", ")}. Never reveal data outside that list; if they ask for it, say their role doesn't have access and suggest asking the owner.

CLINIC
${CLINIC}

LIVE DATA (right now, ${istNow().toISOString().slice(0, 16).replace("T", " ")} IST)
${snap}

HOW TO ANSWER
- Reply in the same language the colleague uses (Tenglish by default, plain Telugu if they write Telugu script, English if English). Respectful register (meeru/cheyandi).
- Be short and operational. Lead with the answer. Use a few bullet lines with a fitting emoji, never long paragraphs.
- When you use numbers, take them from LIVE DATA above. Never invent a number, name or phone. If something isn't in the data, say so plainly.
- When they ask "what should I do now", give a prioritised action list (max 5) from the real data — hot leads to call first, appointments today, students with pending forms or fees, 3★ ratings needing a recovery call.
- If they ask you to draft a message for a patient or student, write it ready-to-send in the clinic's style (warm, respectful, one clear next step, no prices, no medical promises) and tell them to send it from the lead's WhatsApp button. You cannot send messages yourself.
- Never quote treatment prices (academy course fees are fine — they are published). Never give a medical diagnosis or name medicines; for clinical questions say the doctor decides.
- If asked about something you cannot see (money in the bank, staff salaries, another branch), say so.`;

  const messages = [];
  history.forEach((h) => { if (h && h.q && h.a) { messages.push({ role: "user", content: String(h.q).slice(0, 800) }); messages.push({ role: "assistant", content: String(h.a).slice(0, 1500) }); } });
  messages.push({ role: "user", content: q });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.OFFICE_MODEL || process.env.AI_MODEL || "claude-opus-5", max_tokens: 1200, system, messages }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); console.error("office: claude", r.status, t.slice(0, 200)); return json(res, 502, { error: "AI reply raledu — malli try cheyandi" }); }
    const d = await r.json();
    const reply = ((d.content || []).find((c) => c.type === "text") || {}).text || "";
    await guard.kvCommand(cfg, ["LPUSH", "office:log", JSON.stringify({ by: me.name, role: me.role, q: q.slice(0, 200), ts: Date.now() })]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "office:log", "0", "499"]).catch(() => {});
    return json(res, 200, { ok: true, reply: reply || "Sorry, reply generate avvaledu — malli adagandi." });
  } catch (e) {
    console.error("office", e && e.message);
    return json(res, 500, { error: "AI Office error — malli try cheyandi" });
  }
};
