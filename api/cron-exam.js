// GET /api/cron-exam — Vercel Cron, 21:30 UTC = 03:00 IST, when the agent is
// not busy with real patients. Twelve invented patients talk to the real
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
  const r = await exam.run(cfg, { n, ids: ids.length ? ids : undefined, dry: q.dry === "1", keep: q.keep === "1", turns: Math.max(2, Math.min(8, Number(q.turns) || 6)) });
  if (!r) return res.status(200).json({ ok: false });
  if (q.dry !== "1" && !ids.length) {
    const notify = require("./_notify.js");
    for (const to of guard.ownerPhones()) await notify.sendWa(to, exam.summary(r)).catch(() => {});
  }
  return res.status(200).json(Object.assign({ ok: true }, r));
};
