// GET /api/cron-digest — Vercel Cron (03:30 UTC = 9:00 AM IST daily):
// morning summary to the owner + care team — yesterday's leads, today's
// scheduled posts, yesterday's smart-link clicks. Delivery uses the free
// 24h service window (recipients keep it open by replying to alerts).
// Recipients: DIGEST_PHONES env, else ADMIN_PHONES ∪ LEAD_NOTIFY_PHONES.
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const admin = require("./_admin.js");
const hrmod = require("./_hr.js");

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

  const now = Date.now();
  const lines = ["🌅 *DermaLuxe Daily — " + admin.fmtIst(now).split(",")[0] + "*", ""];

  // Yesterday's leads (rolling 24h)
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]);
    const leads = (r.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter((l) => l && now - l.ts < 86400000);
    const by = {};
    leads.forEach((l) => { by[l.type] = (by[l.type] || 0) + 1; });
    lines.push(`📋 Ninna leads: *${leads.length}*` + (leads.length ? " (" + Object.keys(by).map((k) => `${k}:${by[k]}`).join(", ") + ")" : ""));
    leads.slice(0, 5).forEach((l) => lines.push(`— ${l.name || "?"} · ${String(l.concern || "").slice(0, 28)}`));
  } catch (e) {}

  // Today's scheduled posts
  try {
    const q = await guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "19"]);
    const due = (q.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter((it) => it && it.due && it.due - now < 86400000 && it.due > now - 600000)
      .sort((a, b) => a.due - b.due);
    if (due.length) {
      lines.push("", "⏰ Ee roju posts:");
      due.forEach((it) => lines.push(`— ${admin.fmtIst(it.due)} ${it.vidId ? "🎬" : "📷"} ${String(it.caption || "").replace(/\n/g, " ").slice(0, 30)}…`));
    }
  } catch (e) {}

  // Hiring: yesterday's applications + today's interviews (with reminders)
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "299"]);
    const apps = (r.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter((l) => l && l.type === "job" && now - l.ts < 86400000);
    if (apps.length) lines.push("", `💼 Ninna job applications: *${apps.length}* ('jobs report' tho chudandi)`);
  } catch (e) {}
  try {
    const q = await guard.kvCommand(cfg, ["LRANGE", "hr:ivq", "0", "49"]);
    const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
    const today = istDay(now);
    const seen = new Set();
    for (const raw of (q.result || [])) {
      let iv; try { iv = JSON.parse(raw); } catch (e) { continue; }
      if (!iv || !iv.at) continue;
      if (iv.at < now - 43200000) { await guard.kvCommand(cfg, ["LREM", "hr:ivq", "1", raw]).catch(() => {}); continue; }
      if (istDay(iv.at) !== today || seen.has(iv.phone)) continue;
      seen.add(iv.phone);
      const app = await hrmod.findApp(cfg, iv.phone);
      lines.push(`📅 Ivala interview: ${app ? app.name + " (" + app.role + ")" : iv.phone} — ${admin.fmtIst(iv.at)}`);
      await notify.sendWa(iv.phone,
        `⏰ Reminder: Ivala mee interview undi!\n🗓 *${admin.fmtIst(iv.at)}* IST\n📍 DermaLuxe, Rama Mahal, Kasturi Vari Street, Eluru\nAll the best! 🍀`).catch(() => {});
    }
  } catch (e) {}

  // Yesterday's smart-link clicks
  try {
    const y = new Date(now - 86400000).toISOString().slice(0, 10);
    const parts = [];
    for (const tag of ["insta", "wa", "fb", "gbp", "story"]) {
      const v = await guard.kvCommand(cfg, ["GET", `utm:${tag}:${y}`]).catch(() => ({}));
      if (Number(v.result || 0) > 0) parts.push(`${tag}:${v.result}`);
    }
    if (parts.length) lines.push("", `🔗 Ninna link clicks: ${parts.join(", ")}`);
  } catch (e) {}

  lines.push("", "Dashboard: dermaluxe.ai/leads.html");
  const body = lines.join("\n").slice(0, 3200);
  let sent = 0;
  for (const to of targets) { if (await notify.sendWa(to, body)) sent++; }
  return res.status(200).json({ ok: true, targets: targets.length, sent });
};
