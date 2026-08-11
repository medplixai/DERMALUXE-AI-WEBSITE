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

  // Today's appointments: 9AM same-day template reminder to each patient +
  // the day's schedule in the team digest. Near ones (<3h) also get r2 marked
  // so cron-post's 2h pass doesn't double-ping.
  try {
    const aq = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
    const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
    const today = istDay(now);
    const todays = [];
    for (const raw of (aq.result || [])) {
      let a; try { a = JSON.parse(raw); } catch (e) { continue; }
      if (!a || !a.at || !a.ph) { await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {}); continue; }
      if (a.at < now - 10800000) {
        // Long past (overnight stragglers) → move to appt:done, no team ping
        await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
        a.doneAt = now;
        await guard.kvCommand(cfg, ["LPUSH", "appt:done", JSON.stringify(a)]).catch(() => {});
        continue;
      }
      if (istDay(a.at) !== today) continue;
      todays.push(a);
      if (!a.r9 && a.at > now) {
        await notify.sendWaTemplate(a.ph, "appointment_reminder", [a.name || "friend", admin.fmtIst(a.at)]).catch(() => {});
        a.r9 = true;
        if (a.at - now < 10800000) a.r2 = true;
        await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
        await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(a)]).catch(() => {});
      }
    }
    if (todays.length) {
      lines.push("", `🩺 Ivala appointments: *${todays.length}* (patients ki reminders vellayi)`);
      todays.sort((x, y) => x.at - y.at).forEach((a) =>
        lines.push(`— ${admin.fmtIst(a.at).split(", ")[1] || admin.fmtIst(a.at)} · ${a.name || "?"} 📱 ${a.ph}${a.concern ? " · " + a.concern : ""}`));
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

  // Team-scheduled review/session reminders due today (checkup/session cmds)
  try {
    const cq = await guard.kvCommand(cfg, ["LRANGE", "chk:q", "0", "199"]);
    const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
    const today = istDay(now);
    let rem = 0;
    for (const raw of (cq.result || [])) {
      let c; try { c = JSON.parse(raw); } catch (e) { c = null; }
      if (!c || !c.ph || !c.due) { await guard.kvCommand(cfg, ["LREM", "chk:q", "1", raw]).catch(() => {}); continue; }
      if (istDay(c.due) > today) continue; // future — leave queued
      const first = String(c.name || "").split(" ")[0] || "friend";
      if (c.kind === "session") {
        await notify.sendWaTemplate(c.ph, "session_reminder", [first, String(c.note || "treatment").slice(0, 60)]).catch(() => {});
      } else {
        await notify.sendWaTemplate(c.ph, "review_reminder", [first, String(c.note || "Doctor suggest chesina review checkup").slice(0, 80)]).catch(() => {});
      }
      await guard.kvCommand(cfg, ["LREM", "chk:q", "1", raw]).catch(() => {});
      rem++;
    }
    if (rem) lines.push("", `🔁 Review/session reminders vellayi: *${rem}*`);
  } catch (e) {}

  // Cold leads nudge (Mon & Thu only, 3+ needed): owner fires 'reactivate'
  try {
    const istD = new Date(now + 330 * 60000).getUTCDay();
    if (istD === 1 || istD === 4) {
      const r2 = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]);
      const uniq = new Set();
      for (const s of (r2.result || [])) {
        let l; try { l = JSON.parse(s); } catch (e) { continue; }
        if (!l || l.type === "job" || (l.slot && l.date)) continue;
        const age = now - (l.ts || 0);
        if (age < 3 * 86400000 || age > 10 * 86400000) continue;
        const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
        if (ph.length === 10) uniq.add(ph);
      }
      if (uniq.size >= 3) lines.push("", `🧊 Cold leads (3-10 rojulu, book avvaledu): *${uniq.size}* — owner *reactivate* ani pampite follow-up veltundi`);
    }
  } catch (e) {}

  lines.push("", "Dashboard: dermaluxe.ai/leads.html");
  const body = lines.join("\n").slice(0, 3200);
  let sent = 0;
  for (const to of targets) { if (await notify.sendWa(to, body)) sent++; }
  return res.status(200).json({ ok: true, targets: targets.length, sent });
};
