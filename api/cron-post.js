// GET /api/cron-post — Vercel Cron (every 10 min): publishes due scheduled
// Instagram posts from the adm:queue list and WhatsApps the admin the result.
// Idempotent: per-image NX lock + LREM before requeue/drop; max 2 publishes
// per run to stay inside the 60s budget.
const guard = require("./_guard.js");
const admin = require("./_admin.js");

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
      await notifyAdmin(it.by, `✅ *Scheduled ${it.vidId ? "reel" : "post"} live!* (${admin.fmtIst(it.due)})${out.link ? "\n" + out.link : ""}`);
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
  return res.status(200).json({ ok: true, published, kept, dropped });
};
