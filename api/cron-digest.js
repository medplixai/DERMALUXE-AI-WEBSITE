// GET /api/cron-digest — Vercel Cron (03:30 UTC = 9:00 AM IST daily): builds
// the morning report via _digest.js (live mode — also fires the day's patient
// and candidate reminders) and delivers it to the team. Delivery is free-form
// first; when a recipient's 24h window is closed (131047) it falls back to
// the daily_digest_ping TEMPLATE so the report never silently disappears —
// the ping asks them to reply 'report', which reopens the window AND returns
// the full report via the admin command.
// Recipients: DIGEST_PHONES env, else ADMIN_PHONES ∪ LEAD_NOTIFY_PHONES.
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const dg = require("./_digest.js");
const wk = require("./_weekly.js");

module.exports = async (req, res) => {
  if (process.env.CRON_SECRET) {
    if (String(req.headers.authorization || "") !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(200).json({ ok: true, note: "kv not configured" });

  const norm = (v) => String(v || "").split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter((s) => s.length === 10);
  let targets = norm(process.env.DIGEST_PHONES);
  if (!targets.length) {
    targets = Array.from(new Set(norm(process.env.ADMIN_PHONES).concat(norm(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666"))));
  }
  if (!targets.length) return res.status(200).json({ ok: true, note: "no targets" });

  const out = await dg.buildDigest(cfg, true);
  let sent = 0, pinged = 0;
  for (const to of targets) {
    if (await notify.sendWa(to, out.body)) { sent++; continue; }
    const t = await notify.sendWaTemplate(to, "daily_digest_ping", [out.oneLine]);
    if (t.ok) pinged++;
  }
  // Monday: the weekly marketing report follows the daily one.
  let weekly = 0;
  try {
    if (new Date(Date.now() + 330 * 60000).getUTCDay() === 1) {
      const rep = await wk.buildWeekly(cfg);
      for (const to of targets) {
        if (await notify.sendWa(to, rep.body)) { weekly++; continue; }
        await notify.sendWaTemplate(to, "daily_digest_ping", [rep.oneLine]).catch(() => {});
      }
    }
  } catch (e) { console.error("cron-digest: weekly", e && e.message); }
  return res.status(200).json({ ok: true, targets: targets.length, sent, pinged, weekly });
};
