// GET /api/cron-exam — Vercel Cron, 02:30 UTC = 08:00 IST, before the clinic
// opens, so the score reaches the owner with the morning and not at 3 AM. Twelve invented patients talk to the real
// agent; a judge scores each chat; the owner hears the score and the two
// worst chats. See _exam.js.
//
// Manual: ?key=<ADMIN_KEY or CRON_SECRET>&n=3[&ids=p04,p07][&dry=1][&keep=1]
// or from the app with a staff session that has settings.manage.
const guard = require("./_guard.js");
const exam = require("./_exam.js");

module.exports = async (req, res) => {
  const q = req.query || {};
  const gate = guard.cronAuth(req);
  const cfg = guard.kvConfig();
  if (!gate.ok) {
    const bearer = /^Bearer\s+\S+/.test(String((req.headers || {}).authorization || ""));
    const auth = cfg && bearer ? await require("./staff.js").requireStaff(cfg, req).catch(() => ({ ok: false })) : { ok: false };
    if (!auth.ok || !auth.allow("settings.manage")) return res.status(401).json({ error: "unauthorized" });
  }
  if (!cfg) return res.status(200).json({ ok: true, note: "kv not configured" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json({ ok: true, note: "no model key" });
  const n = Math.max(1, Math.min(40, Number(q.n) || 12));
  const ids = String(q.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  // The cron fires twice a morning (08:00 and a retry at 08:45): a day that
  // already has its result is not sat again.
  if (!ids.length && q.dry !== "1" && q.force !== "1") {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const had = await guard.kvCommand(cfg, ["GET", `exam:${day}`]).catch(() => ({}));
    if (had && had.result) return res.status(200).json({ ok: true, skipped: "already sat today", day });
  }
  const r = await exam.run(cfg, { n, ids: ids.length ? ids : undefined, dry: q.dry === "1", keep: q.keep === "1", turns: Math.max(2, Math.min(8, Number(q.turns) || 5)), budgetMs: 200000 });
  if (!r) return res.status(200).json({ ok: false });
  if (q.dry !== "1" && !ids.length) {
    const notify = require("./_notify.js");
    for (const to of guard.ownerPhones()) await notify.sendWa(to, exam.summary(r)).catch(() => {});
  }
  return res.status(200).json(Object.assign({ ok: true }, r));
};
