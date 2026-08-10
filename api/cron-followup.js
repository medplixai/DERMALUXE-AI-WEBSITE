// GET /api/cron-followup — Vercel Cron (hourly): drop-off recovery.
// WhatsApp leads captured 18–23h ago that never finished booking (no slot)
// get ONE friendly nudge while their 24h service window is still open —
// free-form messages are free inside the window, so this costs nothing.
// One nudge per phone per week (NX marker); max 10 per run.
const guard = require("./_guard.js");
const notify = require("./_notify.js");

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
        if (!a || !a.ph || !a.at || a.fu) continue;
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

  return res.status(200).json({ ok: true, checked, sent, visited });
};
