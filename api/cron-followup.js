// GET /api/cron-followup — Vercel Cron (hourly): drop-off recovery.
// WhatsApp leads captured 18–23h ago that never finished booking (no slot)
// get ONE friendly nudge while their 24h service window is still open —
// free-form messages are free inside the window, so this costs nothing.
// One nudge per phone per week (NX marker); max 10 per run.
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const admin = require("./_admin.js");

module.exports = async (req, res) => {
  if (process.env.CRON_SECRET) {
    if (String(req.headers.authorization || "") !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(200).json({ ok: true, note: "kv not configured" });

  const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "99"]);
  const now = Date.now();
  let sent = 0, checked = 0;

  for (const raw of (r.result || [])) {
    if (sent >= 10) break;
    let l; try { l = JSON.parse(raw); } catch (e) { continue; }
    const age = now - (l.ts || 0);
    if (age < 18 * 3600000 || age > 23 * 3600000) continue;      // near the window's end only
    if (l.type !== "whatsapp") continue;                          // v1: WhatsApp senders only
    const phone = String(l.phone || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10 || !l.name) continue;
    if (l.slot && l.date) continue;                               // booking already complete
    checked++;
    try {
      const nx = await guard.kvCommand(cfg, ["SET", `ntf:fu:${phone}`, "1", "NX", "EX", "604800"]);
      if (!nx.result) continue;                                   // already nudged this week
    } catch (e) { continue; }
    const concern = String(l.concern || "mee concern").slice(0, 60);
    const ok = await notify.sendWa(phone,
      `Hi ${l.name} garu! 👋 Meeru DermaLuxe lo *${concern}* gurinchi adigaru kada — inka em doubts unna cheppandi 😊 Ee week slots kuda available unnayi. Book cheyalante mee convenient day & time cheppandi chalu!\n· మీకు అనుకూలమైన టైమ్ చెప్తే చాలు — బుక్ చేసేస్తాం 🙏`);
    if (ok) sent++;
  }

  // ---- Day-3 booking push: enquired but never booked → ONE paid template
  // follow-up (~11:45 IST run; window closed by now so free-form won't land).
  // Guardrails: skip booked/opted-out/jobs, NX marker 30d, max 8 per day.
  let day3 = 0;
  try {
    const istNow = new Date(now + 330 * 60000);
    if (istNow.getUTCHours() === 11) {
      const booked = new Set();
      for (const key of ["appt:q", "appt:done"]) {
        const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "199"]).catch(() => ({}));
        for (const s of (q.result || [])) { try { booked.add(JSON.parse(s).ph); } catch (e) {} }
      }
      const opt = await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}));
      const optSet = new Set(opt.result || []);
      const r2 = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]);
      for (const raw of (r2.result || [])) {
        if (day3 >= 8) break;
        let l; try { l = JSON.parse(raw); } catch (e) { continue; }
        if (!l || l.type === "job" || (l.slot && l.date)) continue;
        const age = now - (l.ts || 0);
        if (age < 60 * 3600000 || age > 84 * 3600000) continue; // ~day 3
        const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
        if (ph.length !== 10 || booked.has(ph) || optSet.has(ph)) continue;
        try {
          const nx = await guard.kvCommand(cfg, ["SET", `ntf:fu3:${ph}`, "1", "NX", "EX", "2592000"]);
          if (!nx.result) continue; // already pushed this lead
        } catch (e) { continue; }
        const first = String(l.name || "").trim().split(" ")[0] || "friend";
        const line = l.concern
          ? `Meeru '${String(l.concern).slice(0, 40)}' gurinchi adigaru kada — doctor consultation tho correct plan vastundi. Ee week slots available, book cheyalante reply cheyandi 😊`
          : `Meeru mana treatments gurinchi adigaru kada — doctor consultation tho correct plan vastundi. Ee week slots available, book cheyalante reply cheyandi 😊`;
        const tpl = l.type === "instagram" ? "insta_lead_followup" : "clinic_update";
        let out = await notify.sendWaTemplate(ph, tpl, [first, line]);
        if (!out.ok && tpl !== "clinic_update") out = await notify.sendWaTemplate(ph, "clinic_update", [first, line]);
        if (out.ok) day3++;
      }
    }
  } catch (e) { console.error("cron: day3 followup", e && e.message); }

  // ---- Later lead touches: day 7 check-in (11:45 IST) and day 21 hello
  // (12:45 IST). Same guards as day 3: unbooked, not opted out, one send per
  // lead per marker window, small daily cap. Each is a paid template.
  async function leadTouch(minH, maxH, tpl, marker, ttl, cap, line) {
    let n = 0;
    const booked = new Set();
    for (const key of ["appt:q", "appt:done"]) {
      const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "199"]).catch(() => ({}));
      for (const s of (q.result || [])) { try { booked.add(JSON.parse(s).ph); } catch (e) {} }
    }
    const opt = await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}));
    const optSet = new Set(opt.result || []);
    const rows = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "399"]);
    for (const raw of (rows.result || [])) {
      if (n >= cap) break;
      let l; try { l = JSON.parse(raw); } catch (e) { continue; }
      if (!l || l.type === "job" || (l.slot && l.date)) continue;
      const age = now - (l.ts || 0);
      if (age < minH * 3600000 || age > maxH * 3600000) continue;
      const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
      if (ph.length !== 10 || booked.has(ph) || optSet.has(ph)) continue;
      try {
        const nx = await guard.kvCommand(cfg, ["SET", `${marker}:${ph}`, "1", "NX", "EX", String(ttl)]);
        if (!nx.result) continue;
      } catch (e) { continue; }
      const first = String(l.name || "").trim().split(" ")[0] || "friend";
      const out = await notify.sendWaTemplate(ph, tpl, [first, line(l)]);
      if (out.ok) n++;
      else await guard.kvCommand(cfg, ["DEL", `${marker}:${ph}`]).catch(() => {}); // template not approved yet → retry next day
    }
    return n;
  }
  let day7 = 0, day21 = 0;
  try {
    const h = new Date(now + 330 * 60000).getUTCHours();
    const concern = (l) => String(l.concern || "skin/hair treatment").slice(0, 40);
    if (h === 11) day7 = await leadTouch(156, 180, "lead_checkin", "ntf:fu7", 2592000, 8, concern);
    if (h === 12) day21 = await leadTouch(492, 516, "we_miss_you", "ntf:fu21", 5184000, 6, concern);
  } catch (e) { console.error("cron: lead touches", e && e.message); }

  // ---- Day-before confirmation (6:15 PM IST): appointment_confirm template
  // with ✅ Vastanu / 🔁 Reschedule quick replies. One attempt per booking (c1).
  let confirmAsked = 0;
  try {
    if (new Date(now + 330 * 60000).getUTCHours() === 18) {
      const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
      const tomorrow = istDay(now + 86400000);
      const aq = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
      for (const raw of (aq.result || [])) {
        let a; try { a = JSON.parse(raw); } catch (e) { continue; }
        if (!a || !a.ph || !a.at || a.c1 || a.cf || istDay(a.at) !== tomorrow) continue;
        const out = await notify.sendWaTemplate(a.ph, "appointment_confirm", [String(a.name || "").split(" ")[0] || "friend", admin.fmtIst(a.at)]);
        a.c1 = true;
        await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
        await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(a)]).catch(() => {});
        if (out.ok) confirmAsked++;
      }
    }
  } catch (e) { console.error("cron: day-before confirm", e && e.message); }

  // ---- Post-visit day 7 (results check) and day 30 (maintenance) ---------
  // Runs in the 10:45 IST block with the next-morning check; approved
  // templates service_followup / session_reminder carry the message.
  let visit7 = 0, visit30 = 0, rated = 0;
  try {
    if (new Date(now + 330 * 60000).getUTCHours() === 10) {
      const dq = await guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "299"]);
      for (const raw of (dq.result || [])) {
        let a; try { a = JSON.parse(raw); } catch (e) { continue; }
        if (!a || !a.ph || !a.at || a.ns) continue;
        const days = (now - a.at) / 86400000;
        const first = String(a.name || "").split(" ")[0] || "friend";
        const what = String(a.concern || "treatment").slice(0, 50);
        let changed = false;
        if (!a.rv && days >= 1.5 && days < 2.5) {
          // Day 2: rating buttons; rv:ask lets the webhook read the tap
          const out = await notify.sendWaTemplate(a.ph, "visit_rating", [first, what]).catch(() => ({ ok: false }));
          a.rv = true; changed = true;
          if (out.ok) {
            await guard.kvCommand(cfg, ["SET", `rv:ask:${a.ph}`, JSON.stringify({ name: first, concern: what, at: a.at }), "EX", "604800"]).catch(() => {});
            rated++;
          }
        } else if (!a.fu7 && days >= 6.5 && days < 7.5) {
          await notify.sendWaTemplate(a.ph, "service_followup", [first, what]).catch(() => {});
          a.fu7 = true; changed = true; visit7++;
        } else if (!a.fu30 && days >= 29.5 && days < 30.5) {
          await notify.sendWaTemplate(a.ph, "session_reminder", [first, what + " follow-up"]).catch(() => {});
          a.fu30 = true; changed = true; visit30++;
        }
        if (changed) {
          await guard.kvCommand(cfg, ["LREM", "appt:done", "1", raw]).catch(() => {});
          await guard.kvCommand(cfg, ["LPUSH", "appt:done", JSON.stringify(a)]).catch(() => {});
        }
      }
    }
  } catch (e) { console.error("cron: visit touches", e && e.message); }

  // ---- Post-visit follow-up: next morning (~10:45 IST), once per visit ----
  // Free-form first (the reminder replies usually keep the window open);
  // falls back to the visit_followup template so delivery never dies quietly.
  let visited = 0;
  try {
    const istNow = new Date(now + 330 * 60000);
    if (istNow.getUTCHours() === 10) {
      const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
      const yday = istDay(now - 86400000);
      const dq = await guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "199"]);
      for (const raw of (dq.result || [])) {
        let a; try { a = JSON.parse(raw); } catch (e) { continue; }
        if (!a || !a.ph || !a.at || a.fu || a.ns) continue; // ns = marked no-show (rebook nudge already sent)
        if (istDay(a.at) !== yday) continue;
        const first = String(a.name || "").split(" ")[0] || "friend";
        const ok = await notify.sendWa(a.ph,
          `Hi ${first}! 🙏 Ninna mee DermaLuxe visit ela anipinchindi?\n\nTreatment/skin care lo emaina doubts unte ikkade adagandi — free ga reply chestam 💖`);
        if (!ok) await notify.sendWaTemplate(a.ph, "visit_followup", [first]).catch(() => {});
        a.fu = true;
        await guard.kvCommand(cfg, ["LREM", "appt:done", "1", raw]).catch(() => {});
        await guard.kvCommand(cfg, ["LPUSH", "appt:done", JSON.stringify(a)]).catch(() => {});
        visited++;
      }
    }
  } catch (e) { console.error("cron: visit followup", e && e.message); }

  return res.status(200).json({ ok: true, checked, sent, day3, day7, day21, confirmAsked, visited, rated, visit7, visit30 });
};
