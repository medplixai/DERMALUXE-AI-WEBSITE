// GET /api/cron-post — Vercel Cron (every 10 min): publishes due scheduled
// Instagram posts from the adm:queue list and WhatsApps the admin the result.
// Idempotent: per-image NX lock + LREM before requeue/drop; max 2 publishes
// per run to stay inside the 60s budget.
const guard = require("./_guard.js");
const admin = require("./_admin.js");
const notify = require("./_notify.js");

async function notifyAdmin(digits, text) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  if (!token || !phoneId || !digits) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${digits}`, text: { body: String(text).slice(0, 900) } }),
    });
  } catch (e) {}
}

module.exports = async (req, res) => {
  if (process.env.CRON_SECRET) {
    if (String(req.headers.authorization || "") !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(200).json({ ok: true, note: "kv not configured" });

  const r = await guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "49"]);
  const raws = r.result || [];
  const now = Date.now();
  let published = 0, kept = 0, dropped = 0;

  for (const raw of raws) {
    let it;
    try { it = JSON.parse(raw); } catch (e) {
      await guard.kvCommand(cfg, ["LREM", "adm:queue", "1", raw]).catch(() => {});
      dropped++; continue;
    }
    if (!it.due || it.due > now) { kept++; continue; }
    if (published >= 2) { kept++; continue; }

    const mediaKey = it.imgId || it.vidId;
    const lock = await guard.kvCommand(cfg, ["SET", `adm:lock:${mediaKey}`, "1", "NX", "EX", "540"]).catch(() => ({}));
    if (!lock || !lock.result) { kept++; continue; }

    const out = await admin.publishNow(cfg, it);
    await guard.kvCommand(cfg, ["LREM", "adm:queue", "1", raw]).catch(() => {});

    if (out.ok) {
      published++;
      await notifyAdmin(it.by, `✅ *Scheduled ${it.vidId ? "reel" : "post"} live!* (${admin.fmtIst(it.due)})${out.fb ? " + 📘 FB page" : ""}${out.link ? "\n" + out.link : ""}`);
    } else if (out.transient && (it.tries || 0) < 3) {
      it.tries = (it.tries || 0) + 1;
      if (out.creationId) it.creationId = out.creationId; // resume the same IG container next run
      await guard.kvCommand(cfg, ["LPUSH", "adm:queue", JSON.stringify(it)]).catch(() => {});
      await guard.kvCommand(cfg, ["DEL", `adm:lock:${mediaKey}`]).catch(() => {});
      kept++;
    } else {
      dropped++;
      await notifyAdmin(it.by, `❌ Scheduled ${it.vidId ? "reel" : "post"} fail ayindi (${admin.fmtIst(it.due)}): ${out.msg || "unknown"}. ${it.vidId ? "Video" : "Photo"} + 'post:' tho malli try cheyandi.`);
    }
  }
  // ---- Appointment reminders: ~2h-before nudge via template ---------------
  // (Same-day 9AM reminder lives in cron-digest; if that one already covered
  // a near appointment it sets r2 too, so patients never get double-pinged.)
  let reminded = 0;
  try {
    const aq = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
    for (const raw of (aq.result || [])) {
      let a;
      try { a = JSON.parse(raw); } catch (e) { a = null; }
      if (!a || !a.at || !a.ph) { await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {}); continue; }
      if (a.at < now - 10800000) {
        // Visit window over → move to appt:done (next-morning follow-up reads
        // it) + one team check-in so no-shows get a rebook nudge.
        await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
        a.doneAt = now;
        await guard.kvCommand(cfg, ["LPUSH", "appt:done", JSON.stringify(a)]).catch(() => {});
        await guard.kvCommand(cfg, ["LTRIM", "appt:done", "0", "499"]).catch(() => {});
        if (a.at > now - 14400000) { // just crossed the 3h line → ping once
          const team = String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666")
            .split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter((s) => s.length === 10);
          for (const to of team) {
            await notify.sendWa(to, `🩺 ${a.name || "?"} (${a.ph}) — ${admin.fmtIst(a.at)} appointment time daatindi.\nVachhara? Raakapothe *noshow ${a.ph}* ani pampandi — rebook nudge veltundi.`).catch(() => {});
          }
        }
        continue;
      }
      const mins = (a.at - now) / 60000;
      if (a.r2 || mins > 130 || mins < 15) continue; // <15 min = they just booked it, no point
      const out = await notify.sendWaTemplate(a.ph, "appointment_reminder", [a.name || "friend", admin.fmtIst(a.at)]);
      a.r2 = true; // one attempt only — never retry-spam a patient
      await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
      await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(a)]).catch(() => {});
      if (out.ok) reminded++;
    }
  } catch (e) { console.error("cron: appt reminders", e && e.message); }

  // ---- Broadcast queue drain (owner 'broadcast:' overflow past 80) --------
  let bsent = 0;
  try {
    let processed = 0;
    for (let i = 0; i < 30; i++) {
      const p = await guard.kvCommand(cfg, ["RPOP", "bc:q"]);
      if (!p || !p.result) break;
      let b;
      try { b = JSON.parse(p.result); } catch (e) { continue; }
      const btpl = b.tpl || "clinic_update";
      const out = await notify.sendWaTemplate(b.ph, btpl, admin.promoParams(btpl, b.name || "friend", b.text, b.p2));
      if (out.ok) bsent++;
      processed++;
    }
    if (processed) {
      const done = await guard.kvCommand(cfg, ["INCRBY", "bc:done", String(processed)]).catch(() => ({}));
      const m = await guard.kvCommand(cfg, ["GET", "bc:meta"]).catch(() => ({}));
      if (m && m.result) {
        const meta = JSON.parse(m.result);
        if (Number(done.result || 0) >= meta.total) {
          await notifyAdmin(meta.by, `📣 Broadcast complete — queue lo unna ${meta.total} kuda vellindi ✅`);
          await guard.kvCommand(cfg, ["DEL", "bc:meta"]).catch(() => {});
          await guard.kvCommand(cfg, ["DEL", "bc:done"]).catch(() => {});
        }
      }
    }
  } catch (e) { console.error("cron: broadcast drain", e && e.message); }

  return res.status(200).json({ ok: true, published, kept, dropped, reminded, bsent });
};
