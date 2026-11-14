// GET /api/cron-followup — Vercel Cron (hourly): drop-off recovery.
// WhatsApp leads captured 18–23h ago that never finished booking (no slot)
// get ONE friendly nudge while their 24h service window is still open —
// free-form messages are free inside the window, so this costs nothing.
// One nudge per phone per week (NX marker); max 10 per run.
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const admin = require("./_admin.js");

// Vercel kills this function at maxDuration, wherever it happens to be. That
// is not merely "slow": everything BELOW the kill never runs, so an hour that
// spends its whole budget answering stranded chats silently drops the 9:45 PM
// closing report, the dues reminders and the hourly key sweep — and the only
// trace is a timeout line nobody reads.
//
// So the expensive work is held to a deadline and the cheap tail is not. Past
// the deadline a block is skipped, named in `skipped`, and picked up by the
// next run an hour later — every one of them is either capped per run or
// guarded by an NX marker, so nothing is lost by waiting.
// Settable so the deadline can be proved without faking a clock, and so it
// can be tightened on a live account without a deploy.
const BUDGET_MS = Math.max(1, Number(process.env.FOLLOWUP_BUDGET_MS) || 210000);  // of the 300s ceiling; the tail needs the rest
const SPARE_MS = 25000;        // a block is not started without at least this

module.exports = async (req, res) => {
  const gate = guard.cronAuth(req);
  if (!gate.ok) return res.status(401).json({ error: "unauthorized", note: gate.note });
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(200).json({ ok: true, note: "kv not configured" });

  // ---- is the database actually answering? ------------------------------
  // Everything else in this job, and everything the clinic does all day,
  // assumes it is. If it stops, leads stop being saved and nobody finds out
  // until somebody happens to look. So: write something, read it back, throw
  // it away. If that does not work, say so on WhatsApp — which does not need
  // the database to work, unlike the push notifications.
  const STARTED = Date.now();
  const UNTIL = STARTED + BUDGET_MS;
  const timeLeft = () => UNTIL - Date.now();
  const skipped = [];
  // Enough clock left to start something that may take a while?
  const room = (what, ms) => { if (timeLeft() > (ms || SPARE_MS)) return true; skipped.push(what); return false; };

  let health = "ok";
  try {
    const nonce = String(Date.now());
    const [, got] = await guard.kvPipeline(cfg, [
      ["SET", "health:ping", nonce, "EX", "300"],
      ["GET", "health:ping"],
    ]);
    if (String(got) !== nonce) throw new Error("wrote " + nonce + ", read back " + JSON.stringify(got));
    await guard.kvCommand(cfg, ["SET", "health:last", String(Date.now())]).catch(() => {});
  } catch (e) {
    health = String((e && e.message) || e).slice(0, 200);
    console.error("DATABASE HEALTH CHECK FAILED —", health);
    for (const ph of guard.ownerPhones()) {
      await notify.sendWa(ph,
        `\u26a0\ufe0f *DermaLuxe — database andatledu*\n\n${health}\n\nIppudu kotha leads save avvakapovachu. WhatsApp agent reply istune untundi, kaani dashboard lo kanipinchakapovachu.`
      ).catch(() => {});
    }
  }

  const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "99"]);
  const now = Date.now();

  // Who must not be nudged to book, whichever touch it is: somebody who said
  // STOP, somebody already on the appointment list, somebody the desk has
  // already dealt with (contacted is still open; booked, visited and closed
  // are not — closed is usually "not interested"), and academy enquiries,
  // which have their own follow-up and are not looking for a consultation.
  // The touches below used to check some of these and not others.
  const optSet = new Set(((await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}))).result) || []);
  const booked = new Set();
  for (const key of ["appt:q", "appt:done"]) {
    const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "199"]).catch(() => ({}));
    for (const s of (q.result || [])) { try { booked.add(JSON.parse(s).ph); } catch (e) {} }
  }
  const deskStatus = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({}))).result) || {};
  const leadKey = (l) => `${l.ts}|${String(l.phone || "").replace(/\D/g, "").slice(-10) || l.src_id || ""}`;
  // Grade D (not a patient, said stop, very far) gets no chasing at all.
  const qualify = require("./_qualify.js");
  const gradeOf = async (ph) => { const r = await qualify.read(cfg, ph).catch(() => null); return (r && r.grade) || "C"; };
  const gradeD = async (ph) => (await gradeOf(ph)) === "D";
  // The paid template ladder is for the grades worth paying for: A and B get
  // days 3, 7 and 21; C gets day 3 only; D gets nothing.
  const paidOk = async (ph, rung) => {
    const c = qualify.cadenceOf(await gradeOf(ph));
    return c.paid === true || (c.paid === "day3" && rung === 3);
  };
  // The academy test comes from the ladder that now chases them, so the rule
  // that holds them OUT of these rungs and the rule that decides who goes INTO
  // that one are the same line of code. Two copies is how they ended up
  // excluded from everything with nothing standing in the gap.
  const acadfu = require("./_acadfu.js");
  const leaveAlone = (l, ph) => optSet.has(ph) || booked.has(ph)
    || ["booked", "visited", "closed"].includes(deskStatus[leadKey(l)])
    || acadfu.isAcademyLead(l);
  // The hour of the day in Eluru, worked out once. Every timed block below
  // compares against this; a block that computed its own copy inside a try
  // was invisible to the blocks after it, and one of them had been silently
  // throwing a ReferenceError into its catch since the day it shipped.
  const istHour = new Date(now + 330 * 60000).getUTCHours();
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
    if (leaveAlone(l, phone) || await gradeD(phone)) continue;
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

  // ---- the desk's two hourly nags (9 AM – 9 PM) ---------------------------
  // The owner's diagnosis of 9 Nov 2026, in two numbers: of 5 slots the agent
  // held that week ONE got a confirm call, and a new WhatsApp lead waited 39
  // hours on average for its first touch. Both are told to the reception
  // phones once an hour, as one push and one WhatsApp each — never one per
  // row, which would be ignored by lunchtime.
  // Who hears it: the desk stream's notifyTargets (reception + env list) when
  // it is there, else the env list alone. Defensive: three streams, one day.
  const deskTargets = async () => {
    const env = String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666").split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter((s) => s.length === 10);
    try { if (notify.notifyTargets) { const t = await notify.notifyTargets(cfg); if (Array.isArray(t) && t.length) return t; } } catch (e) {}
    return env;
  };
  const deskHours = istHour >= 9 && istHour <= 21;
  const first = (n) => String(n || "").trim().split(" ")[0];
  let confirmNags = 0;
  try {
    if (deskHours) {
      const aq = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "399"]).catch(() => ({}));
      const due = [];
      for (const raw of (aq.result || [])) {
        let a; try { a = JSON.parse(raw); } catch (e) { continue; }
        if (!a || !a.ph || !a.at || a.cf || a.cfn || a.at <= now) continue;
        if (a.status && a.status !== "booked") continue;
        if (now - (Number(a.ts) || 0) < 45 * 60000) continue;             // booked just now — give the desk its 45 minutes
        // cfn: this row has had its nag. One per row, ever — the hourly
        // list is for the NEW ones; the old ones are on the Appts screen.
        a.cfn = 1;
        await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
        await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(a)]).catch(() => {});
        due.push(a);
      }
      if (due.length) {
        due.sort((x, y) => (x.ts || 0) - (y.ts || 0));
        const names = due.map((a) => first(a.name || a.label) || a.ph).slice(0, 5).join(", ") + (due.length > 5 ? ` +${due.length - 5}` : "");
        try {
          const push = require("./_push.js");
          if (push.enabled()) await push.notifyCap(cfg, "appts.edit", {
            title: `⏰ ${due.length} slot${due.length > 1 ? "s" : ""} confirm call pending — ${names}`,
            body: "Call chesi Appts lo ✅ Confirm cheyandi. Call raakapothe patient raaru.",
            tab: "appts", urgent: true, data: { kind: "confirm" },
          });
        } catch (e) { console.error("cron: confirm nag push", e && e.message); }
        const lines = due.slice(0, 10).map((a) => `• ${a.name || a.label || "Patient"} · ${admin.fmtIst(a.at)} · ${a.ph}`);
        for (const to of await deskTargets()) {
          await notify.teamSend(cfg, to, `⏰ *${due.length} slot${due.length > 1 ? "s" : ""} confirm call pending*\n${lines.join("\n")}${due.length > 10 ? `\n…inka ${due.length - 10}` : ""}\n\nCall chesi app lo ✅ Confirm cheyandi.`).catch(() => {});
        }
        confirmNags = due.length;
      }
    }
  } catch (e) { console.error("cron: confirm nag", e && e.message); }

  // A new lead with a number that nobody has touched in an hour. "new" is the
  // desk's own status (dl_status); anything else means somebody has at least
  // looked. Jobs and academy enquiries have their own paths; a day old and it
  // is the daily follow-ups' problem, not this hour's.
  let slaNags = 0;
  try {
    if (deskHours) {
      const lr = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]).catch(() => ({}));
      // "Untouched" has to mean what the Leads screen means by it (staff.js
      // waiting): nobody set a status, nobody wrote a note. Otherwise the push
      // names a lead the screen shows no clock on, and the desk cannot find
      // what it is being told off about. A patient who already holds a slot
      // is the confirm nag's business, not this one's (review, 9 Nov).
      const [stTs, notesH] = await Promise.all([
        guard.kvCommand(cfg, ["HGETALL", "dl_status_ts"]).then((r) => guard.hashOf(r.result) || {}).catch(() => ({})),
        guard.kvCommand(cfg, ["HGETALL", "dl_notes"]).then((r) => guard.hashOf(r.result) || {}).catch(() => ({})),
      ]);
      const touched = (k) => !!stTs[k] || (!!notesH[k] && notesH[k] !== "[]");
      const late = [];
      for (const raw of (lr.result || [])) {
        let l; try { l = JSON.parse(raw); } catch (e) { continue; }
        if (!l || !l.ts || l.type === "job" || acadfu.isAcademyLead(l)) continue;
        const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
        if (ph.length !== 10 || optSet.has(ph)) continue;
        const age = now - l.ts;
        if (age < 3600000 || age > 86400000) continue;
        if ((deskStatus[leadKey(l)] || "new") !== "new" || touched(leadKey(l))) continue;
        if (booked.has(ph) || (l.slot && l.date)) continue;
        const nx = await guard.kvCommand(cfg, ["SET", `ntf:sla:${leadKey(l)}`, "1", "NX", "EX", "86400"]).catch(() => ({}));
        if (!nx || !nx.result) continue;                                // this lead's hour has been told
        late.push(l);
      }
      if (late.length) {
        late.sort((x, y) => x.ts - y.ts);
        const names = late.map((l) => first(l.name) || l.phone).slice(0, 5).join(", ") + (late.length > 5 ? ` +${late.length - 5}` : "");
        try {
          const push = require("./_push.js");
          if (push.enabled()) await push.notifyCap(cfg, "leads.edit", {
            title: `⏰ ${late.length} lead${late.length > 1 ? "s" : ""} ki 1 ganta daatina call ledu — ${names}`,
            body: "Leads lo call chesi status pettandi.",
            tab: "leads", urgent: true, data: { kind: "sla" },
          });
        } catch (e) { console.error("cron: sla nag push", e && e.message); }
        const lines = late.slice(0, 10).map((l) => `• ${l.name || "?"} · ${String(l.concern || "").slice(0, 30) || l.type} · ${String(l.phone || "").replace(/\D/g, "").slice(-10)}`);
        for (const to of await deskTargets()) {
          await notify.teamSend(cfg, to, `⏰ *${late.length} lead${late.length > 1 ? "s" : ""} ki 1 ganta daatina call ledu*\n${lines.join("\n")}${late.length > 10 ? `\n…inka ${late.length - 10}` : ""}\n\nCall chesi app lo status pettandi.`).catch(() => {});
        }
        slaNags = late.length;
      }
    }
  } catch (e) { console.error("cron: sla nag", e && e.message); }

  // ---- Day-3 booking push: enquired but never booked → ONE paid template
  // follow-up (~11:45 IST run; window closed by now so free-form won't land).
  // Guardrails: skip booked/opted-out/jobs, NX marker 30d, max 8 per day.
  let day3 = 0;
  try {
    if (istHour === 11) {
      const r2 = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]);
      for (const raw of (r2.result || [])) {
        if (day3 >= 8) break;
        let l; try { l = JSON.parse(raw); } catch (e) { continue; }
        if (!l || l.type === "job" || (l.slot && l.date)) continue;
        const age = now - (l.ts || 0);
        if (age < 60 * 3600000 || age > 84 * 3600000) continue; // ~day 3
        const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
        if (ph.length !== 10 || leaveAlone(l, ph) || !(await paidOk(ph, 3))) continue;
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
  async function leadTouch(minH, maxH, tpl, marker, ttl, cap, line, rung) {
    let n = 0;
    const rows = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "399"]);
    for (const raw of (rows.result || [])) {
      if (n >= cap) break;
      let l; try { l = JSON.parse(raw); } catch (e) { continue; }
      if (!l || l.type === "job" || (l.slot && l.date)) continue;
      const age = now - (l.ts || 0);
      if (age < minH * 3600000 || age > maxH * 3600000) continue;
      const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
      if (ph.length !== 10 || leaveAlone(l, ph) || !(await paidOk(ph, rung))) continue;
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
    const concern = (l) => String(l.concern || "skin/hair treatment").slice(0, 40);
    if (istHour === 11) day7 = await leadTouch(156, 180, "lead_checkin", "ntf:fu7", 2592000, 8, concern, 7);
    if (istHour === 12) day21 = await leadTouch(492, 516, "we_miss_you", "ntf:fu21", 5184000, 6, concern, 21);
  } catch (e) { console.error("cron: lead touches", e && e.message); }

  // ---- Day-before confirmation (6:15 PM IST): appointment_confirm template
  // with ✅ Vastanu / 🔁 Reschedule quick replies. One attempt per booking (c1).
  let confirmAsked = 0;
  try {
    if (istHour === 18) {
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
    if (istHour === 10) {
      const dq = await guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "299"]);
      for (const raw of (dq.result || [])) {
        let a; try { a = JSON.parse(raw); } catch (e) { continue; }
        // a cancelled or missed appointment was not a visit — no "how was it?";
        // nor is one nobody marked ("unmarked"): we do not know they came
        if (!a || !a.ph || !a.at || a.ns || a.status === "cancelled" || a.status === "noshow" || a.status === "unmarked") continue;
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
    if (istHour === 10) {
      const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
      const yday = istDay(now - 86400000);
      const dq = await guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "199"]);
      for (const raw of (dq.result || [])) {
        let a; try { a = JSON.parse(raw); } catch (e) { continue; }
        // ns = marked no-show (rebook nudge already sent); unmarked = nobody said they came
        if (!a || !a.ph || !a.at || a.fu || a.ns || a.status === "cancelled" || a.status === "noshow" || a.status === "unmarked") continue;
        // Yesterday's slot — or a visit the desk only got round to marking
        // later (the row reaches the history when it is marked, not when the
        // slot passes, since 9 Nov): anything filed in the last day whose slot
        // is over counts, once, so a late mark still gets its "how was it?".
        const filedLately = a.doneAt && now - a.doneAt < 86400000 && a.at < now && istDay(a.at) !== istDay(now);
        if (istDay(a.at) !== yday && !filedLately) continue;
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

  // ---- a treatment's natural next time (Hydrafacial monthly, peel at three
  // weeks…) for single treatments on a bill; packages are the block below.
  let cycled = null;
  try { if (istHour === 10 && room("cycles")) cycled = await require("./_cycles.js").run(cfg, 25); } catch (e) { console.error("cron: cycles", e && e.message); }

  // ---- next sitting is due -------------------------------------------------
  // Once a day, tell anyone whose multi-sitting treatment is due. This is what
  // the approved session_reminder template was always for; until packages
  // existed there was nothing to fire it from.
  let recalls = 0;
  try {
    if (istHour === 12) {                                  // 12:45 PM IST
      const pkg = require("./package.js");
      const rows = await pkg.due(cfg, 0);
      for (const p of rows) {
        if (!p.phone) continue;
        // one nudge per package per 6 days, however overdue it gets
        const nx = await guard.kvCommand(cfg, ["SET", `pkg:ping:${p.id}`, "1", "NX", "EX", "518400"]).catch(() => ({}));
        if (!nx || !nx.result) continue;
        const first = String(p.name || "").split(" ")[0] || "friend";
        const next = p.done + 1;
        const ok = await notify.sendWa(p.phone,
          `Hi ${first}! 🙏 Mee *${p.treatment}* lo ${next}/${p.total} sitting ki time ayindi.\n\nEppudu convenient ayithe cheppandi — slot pettestamu.\n\nDermaLuxe by Medicare, Eluru`);
        if (!ok) await notify.sendWaTemplate(p.phone, "session_reminder", [first, String(p.treatment).slice(0, 60)]).catch(() => {});
        recalls++;
      }
      if (recalls) {
        try {
          const push = require("./_push.js");
          if (push.enabled()) await push.notifyCap(cfg, "appts.view", {
            title: `🔁 ${recalls} patients ki next sitting due`,
            body: "Recall messages vellayi — call chesi slot pettandi.",
            tab: "appts", data: { kind: "recall" },
          });
        } catch (e) { console.error("cron: recall push", e && e.message); }
      }
    }
  } catch (e) { console.error("cron: recalls", e && e.message); }

  // ---- morning briefing (9:15 IST) ---------------------------------------
  // The day, before it starts, on everyone's phone. Deliberately worked out
  // from the data rather than asked of the AI: this fires every morning
  // whether or not an AI key is configured, it costs nothing, and it can
  // never invent a number. The AI Office is there for the questions that
  // follow — this is only the opening.
  let briefed = 0;
  try {
    if (istHour === 9) {                                   // 9:45 AM IST
      const nx = await guard.kvCommand(cfg, ["SET", `brief:${new Date(now + 330 * 60000).toISOString().slice(0, 10)}`, "1", "NX", "EX", "86400"]).catch(() => ({}));
      if (nx && nx.result) {
        const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
        const today = istDay(now);
        const aq = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "399"]).catch(() => ({}));
        const appts = [];
        for (const raw of (aq.result || [])) {
          let a; try { a = JSON.parse(raw); } catch (e) { continue; }
          if (a && a.at && istDay(a.at) === today && a.status !== "cancelled") appts.push(a);
        }
        appts.sort((x, y) => x.at - y.at);
        const unconfirmed = appts.filter((a) => !a.cf).length;

        const lr = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]).catch(() => ({}));
        const stR = await guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({}));
        const st = {}; const sa = (stR && stR.result) || {};
        if (Array.isArray(sa)) { for (let i = 0; i + 1 < sa.length; i += 2) st[sa[i]] = sa[i + 1]; }
        else Object.assign(st, sa);
        let openHot = 0;
        for (const raw of (lr.result || [])) {
          let l; try { l = JSON.parse(raw); } catch (e) { continue; }
          if (!l || !l.ts) continue;
          const key = `${l.ts}|${String(l.phone || "").replace(/\D/g, "").slice(-10) || l.src_id || ""}`;
          const status = st[key] || "new";
          if (l.heat === "hot" && ["new", "contacted"].includes(status)) openHot++;
        }

        let dueToday = 0;
        try { dueToday = (await require("./package.js").due(cfg, 0)).length; }
    catch (e) { console.error("cron: briefing package due", e && e.message); }

        // What is about to run out belongs in the morning, not in the middle
        // of a procedure.
        let lowStock = [];
        try {
          const stock = require("./stock.js");
          lowStock = (await stock.all(cfg)).filter(stock.isLow);
        } catch (e) { console.error("brief: stock", e && e.message); }

        const lines = [];
        if (appts.length) lines.push(`📅 ${appts.length} appointments — modati ${admin.fmtIst(appts[0].at)}`);
        else lines.push("📅 Ee roju appointments inka ledu");
        if (unconfirmed) lines.push(`❓ ${unconfirmed} inka confirm kaledu`);
        if (openHot) lines.push(`🔥 ${openHot} hot lead${openHot > 1 ? "s" : ""} ki call cheyyali`);
        if (dueToday) lines.push(`🔁 ${dueToday} patient${dueToday > 1 ? "s" : ""} ki next sitting due`);
        if (lowStock.length) {
          lines.push(`📦 ${lowStock.map((x) => x.name).slice(0, 3).join(", ")}${lowStock.length > 3 ? ` +${lowStock.length - 3}` : ""} aipotunnayi`);
        }

        const push = require("./_push.js");
        if (push.enabled()) {
          await push.notifyCap(cfg, "appts.view", {
            title: appts.length ? `☀️ Ee roju ${appts.length} appointments` : "☀️ Good morning — DermaLuxe",
            body: lines.join("\n"),
            tab: "appts", data: { kind: "brief" },
          });
          briefed = lines.length;
        }
      }
    }
  } catch (e) { console.error("cron: briefing", e && e.message); }

  // ---- a hot lead deserves an answer sooner than twenty hours --------------
  // A's are nudged two hours after they went quiet, B's after four — inside
  // WhatsApp's free window, so it costs nothing and lands as a normal message.
  let early = 0;
  try {
    for (const raw of (r.result || [])) {
      if (early >= 8) break;
      let l; try { l = JSON.parse(raw); } catch (e) { continue; }
      const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
      if (ph.length !== 10 || l.type === "job" || (l.slot && l.date)) continue;
      const age = (now - (l.ts || 0)) / 3600000;
      if (age < 2 || age > 18) continue;                       // the 18-23h rung below covers the rest
      if (leaveAlone(l, ph)) continue;
      const cad = qualify.cadenceOf(await gradeOf(ph));
      if (!cad.early || age < cad.early) continue;
      const nx = await guard.kvCommand(cfg, ["SET", `ntf:early:${ph}`, "1", "NX", "EX", "604800"]).catch(() => ({}));
      if (!nx || !nx.result) continue;
      const first = String(l.name || "").trim().split(" ")[0] || "andi";
      const ok = await notify.sendWa(ph, `Hi ${first}! 🙏 Meeru adigina *${String(l.concern || "treatment").slice(0, 40)}* gurinchi — mee doubts emaina unte ikkade adagandi 😊\nDoctor consultation ki ee roju/repu slots khaali unnayi. Eppudu convenient?`);
      if (ok) early++;
    }
  } catch (e) { console.error("cron: early nudge", e && e.message); }

  // ---- the academy enquiries, which until now nobody ever wrote to again ---
  let acad = null;
  try {
    if (room("academy")) acad = await acadfu.run(cfg, { optout: optSet, deskStatus, now });
  } catch (e) { console.error("cron: academy followup", e && e.message); }

  // ---- chats that went quiet, and colleagues who went quiet ---------------
  // The three jobs below each used to fetch the same 200 inbox rows for
  // themselves, and then ask the opt-out list once per chat — a whole set read
  // per candidate. Read once here, handed to all three.
  let inboxRows = null;
  try { inboxRows = await require("./_inbox.js").threads(cfg, 200); } catch (e) { console.error("cron: inbox rows", e && e.message); }
  const ctx = inboxRows ? { rows: inboxRows, optout: optSet } : null;

  let reengaged = 0, rescued = null;
  try { if (room("reengage")) reengaged = (await require("./_reengage.js").run(cfg, 10, UNTIL, ctx)).sent; } catch (e) { console.error("cron: reengage", e && e.message); }
  // Rescue always runs: its alerts are cheap, and only its AI hand-back is
  // held to the deadline. Somebody waiting twenty minutes cannot wait an hour.
  try { rescued = await require("./_rescue.js").run(cfg, 5, UNTIL, ctx); } catch (e) { console.error("cron: rescue", e && e.message); }

  // ---- who calls whom, and who has not called -----------------------------
  let assigned = 0, overdue = null;
  try { assigned = (await require("./_queue.js").assign(cfg, { max: 20 })).assigned; } catch (e) { console.error("cron: assign", e && e.message); }
  try { overdue = await require("./_queue.js").alertOverdue(cfg); } catch (e) { console.error("cron: call alerts", e && e.message); }

  // ---- grade the leads that came in before any of this existed -------------
  let backfilled = 0;
  try { if (room("backfill")) backfilled = (await qualify.backfill(cfg, 25)).graded; } catch (e) { console.error("cron: qualify backfill", e && e.message); }
  // Leads graded before "vaddu" counted: their own last words, read again.
  let lowered = 0;
  try { if (room("rescan")) lowered = (await qualify.rescan(cfg, 30)).lowered; } catch (e) { console.error("cron: qualify rescan", e && e.message); }
  // And every stored grade by today's rules (one read, writes only on change).
  let regraded = 0;
  try { if (room("regrade")) regraded = (await qualify.refresh(cfg)).changed; } catch (e) { console.error("cron: qualify refresh", e && e.message); }

  // ---- an A-grade lead the desk has not booked in two hours ----------------
  let callNags = 0;
  try {
    const rows = ((await guard.kvCommand(cfg, ["LRANGE", "qual:calls", "0", "-1"]).catch(() => ({}))).result) || [];
    for (const raw of rows) {
      let c; try { c = JSON.parse(raw); } catch (e) { await guard.kvCommand(cfg, ["LREM", "qual:calls", "1", raw]).catch(() => {}); continue; }
      if (now - c.ts < 2 * 3600000) continue;
      await guard.kvCommand(cfg, ["LREM", "qual:calls", "1", raw]).catch(() => {});
      if (booked.has(c.ph)) continue;
      const stOf = Object.entries(deskStatus).filter(([k]) => k.endsWith("|" + c.ph)).map(([, v]) => v);
      if (stOf.some((v) => ["booked", "visited", "closed"].includes(v))) continue;
      try {
        const push = require("./_push.js");
        if (push.enabled()) await push.notifyCap(cfg, "leads.edit", {
          title: `⏰ A-grade inka book kaledu — ${c.name || c.ph}`,
          body: "2 gantalu ayindi. Call chesi slot pettandi — Leads → Ippude call.",
          tab: "leads", urgent: true, data: { kind: "hot", phone: c.ph },
        });
      } catch (e) {}
      callNags++;
    }
  } catch (e) { console.error("cron: call nags", e && e.message); }

  // ---- stranded chats: the people the agent could not answer ---------------
  let recovered = 0;
  try { if (room("recover")) recovered = (await require("./_recover.js").run(cfg, 20, UNTIL, ctx)).answered; } catch (e) { console.error("cron: recover", e && e.message); }

  // ---- yesterday's agent, reviewed (8:15 AM) ------------------------------
  let reviewed = 0;
  try {
    if (istHour === 8) {
      const day = new Date(now + 330 * 60000 - 86400000).toISOString().slice(0, 10);
      // One Opus call over up to forty transcripts — the single longest thing
      // this job ever does. Started without room for it, it is what the kill
      // lands in the middle of. The NX marker is only taken once there IS room,
      // so a skipped review is retried at 8:15 tomorrow rather than lost.
      if (room("review", 90000)) {
        const nx = await guard.kvCommand(cfg, ["SET", `review:done:${day}`, "1", "NX", "EX", "172800"]).catch(() => ({}));
        if (nx && nx.result) { const rv = await require("./_review.js").run(cfg, day); reviewed = rv ? rv.checked : 0; }
      }
    }
  } catch (e) { console.error("cron: review", e && e.message); }

  // ---- the evening report (9:45 PM) -------------------------------------
  // The day in one WhatsApp to the owner after closing: money in and out,
  // who came, new leads, dues, whether the drawer was counted.
  let closing = 0;
  try {
    if (istHour === 21) {
      const day = new Date(now + 330 * 60000).toISOString().slice(0, 10);
      const nx = await guard.kvCommand(cfg, ["SET", `close:rep:${day}`, "1", "NX", "EX", "86400"]).catch(() => ({}));
      if (nx && nx.result) {
        const rep = await require("./_closing.js").build(cfg, day);
        for (const ph of guard.ownerPhones()) {
          if (await notify.sendWa(ph, rep.body)) { closing++; continue; }
          const t = await notify.sendWaTemplate(ph, "daily_digest_ping", [rep.oneLine]).catch(() => ({ ok: false }));
          if (t && t.ok) closing++;
        }
      }
    }
  } catch (e) { console.error("cron: closing report", e && e.message); }

  // ---- money already earned, quietly waiting ------------------------------
  // The balances sat on a screen nobody outside the clinic could see. Once a
  // day, at a civil hour, the people who owe something are reminded — nothing
  // newer than a few days, nothing more than once a week, and a handful at a
  // time so it never reads as chasing.
  let reminded = 0;
  try {
    if (istHour === 11) {                                  // 11:45 AM IST
      const money = require("./money.js");
      const opt = await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}));
      const optSet = new Set(opt.result || []);
      const rows = await money.dueForReminder(cfg, { minAgeDays: 3, everyDays: 7 });
      for (const row of rows) {
        if (reminded >= 6) break;
        if (optSet.has(String(row.bill.phone))) continue;
        const out = await money.remindOne(cfg, row.bill, row.t, "auto").catch(() => ({ sent: false }));
        if (out.sent) reminded++;
      }
      if (reminded) {
        try {
          const push = require("./_push.js");
          if (push.enabled()) await push.notifyCap(cfg, "money.view", {
            title: `💰 ${reminded} mandiki baaki gurthu chesam`,
            body: "Evaraina reply iste Money tab lo payment record cheyandi.",
            tab: "money", data: { kind: "dues" },
          });
        } catch (e) { console.error("cron: dues push", e && e.message); }
      }
    }
  } catch (e) { console.error("cron: dues", e && e.message); }

  // ---- moving old photos out of Redis ------------------------------------
  // A batch an hour, quietly, until the backlog is gone. It stops scanning
  // once there is nothing left to move rather than walking the keyspace for
  // ever, and picks itself back up a month later in case anything reappears.
  let photosMoved = 0;
  try {
    const store = require("./_photo-store.js");
    if (store.blobOn()) {
      const done = await guard.kvCommand(cfg, ["GET", "ph:migrate:done"]).catch(() => ({}));
      if (!done || !done.result) {
        const r = await store.migrate(cfg, 15);
        photosMoved = (r && r.moved) || 0;
        if (r && r.ok && r.done && !r.moved) {
          await guard.kvCommand(cfg, ["SET", "ph:migrate:done", "1", "EX", String(30 * 86400)]).catch(() => {});
        }
      }
    }
  } catch (e) { console.error("cron: photo migrate", e && e.message); }

  // ---- every comment on our posts answered and made a lead (owner, 7 Nov) ----
  // Instagram and the Facebook page, twenty of each an hour, oldest backlog
  // first cleared over a few hours; the handler's own once-per-comment marker
  // means nothing is ever answered twice.
  let comments = null;
  if (room("comments", 60000)) {
    try {
      const ig = require("./instagram.js");
      comments = { ig: await ig.sweepIgComments(cfg, 20).catch((e) => ({ ok: false, why: e.message })) };
      if (room("fb-comments", 40000)) comments.fb = await ig.sweepFbComments(cfg, 20).catch((e) => ({ ok: false, why: e.message }));
    } catch (e) { console.error("cron: comments", e && e.message); }
    // The sweep's answer was only in the cron's reply, which nobody reads, so a
    // Facebook permission error stayed invisible. Kept a day for the next check.
    if (!comments || !comments.fb) (comments = comments || {}).fb = comments.fb || { ok: false, why: "skipped: no time left this run" };
    console.log("cron: comments", JSON.stringify(comments).slice(0, 400));
    await guard.kvCommand(cfg, ["SET", "cron:comments:last", JSON.stringify(Object.assign({ at: Date.now() }, comments)).slice(0, 2000), "EX", "86400"]).catch(() => {});
  }

  // ---- the Instagram enquiries that never gave a number -------------------
  // Seven Instagram DM leads in three weeks, three with a number, none booked
  // (9 Nov). A few hours after the chat went quiet, one DM asks for the
  // number again, once per conversation; the marker lives in instagram.js.
  let igNudge = null;
  // Inside clinic hours only: a DM from the clinic at 1 AM reads badly, and a
  // number that arrives at 2 AM waits for the desk anyway.
  try { if (!deskHours) igNudge = { sent: 0, checked: 0, night: true }; else if (room("ig-nudge", 30000)) igNudge = await require("./instagram.js").nudgeQuiet(cfg, 10); } catch (e) { console.error("cron: ig nudge", e && e.message); }

  // ---- sweep keys whose time has passed --------------------------------
  // Redis forgets an expired key by itself. Postgres does not, so once an
  // hour the ones that have died are cleared out. Reads already ignore them;
  // this is only so they stop taking up room.
  let swept = 0;
  try {
    const cfg2 = guard.kvConfig();
    if (cfg2 && cfg2.kind === "pg") {
      const r = await fetch(`${cfg2.url}/rest/v1/rpc/dl_kv_reap`, {
        method: "POST",
        headers: { apikey: cfg2.key, Authorization: `Bearer ${cfg2.key}`, "Content-Type": "application/json" },
        body: "{}",
      });
      if (r.ok) swept = Number(await r.json()) || 0;
      else console.error("cron: reap", r.status);
    }
  } catch (e) { console.error("cron: reap", e && e.message); }

  // These go in the RESPONSE, which nothing keeps. The one question asked of
  // this job after a bad morning is "how long did it take, and what did it not
  // get to" — so it says both where somebody can read it afterwards.
  const took = Date.now() - STARTED;
  console.log(`cron-followup ${took}ms hour=${istHour}${skipped.length ? " skipped=" + skipped.join(",") : ""}` +
    ` sent=${sent} early=${early} acad=${acad ? acad.rung1 + acad.rung3 + acad.rung7 : 0} reengaged=${reengaged} recovered=${recovered} backfilled=${backfilled} lowered=${lowered} regraded=${regraded}`);
  return res.status(200).json({ ok: true, health, ms: took, skipped, acad, checked, sent, confirmNags, slaNags, day3, day7, day21, confirmAsked, visited, rated, visit7, visit30, recalls, cycled, briefed, reminded, closing, callNags, recovered, reviewed, backfilled, lowered, regraded, early, reengaged, rescued, assigned, overdue, photosMoved, comments, igNudge, swept });
};
