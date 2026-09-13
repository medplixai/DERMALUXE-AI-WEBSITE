// GET /api/cron-daily — Vercel Cron, 01:30 UTC = 7:00 AM IST daily.
// Builds today's poster (see _daily.js), queues it in adm:queue for 8:30 AM
// IST (cron-post publishes it to Instagram + Facebook), and WhatsApps a
// preview to the owner + clinic numbers. Also callable by the WhatsApp admin
// command "daily post now" (?now=1 → publishes immediately instead of queueing).
//
// KV switch: dp:enabled = "0" pauses the auto-post (admin: "daily off"/"daily on").
const guard = require("./_guard.js");
const daily = require("./_daily.js");
const admin = require("./_admin.js");

const BASE = "https://www.dermaluxe.ai";

async function waImage(to, url, caption) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  if (!token || !phoneId || !to) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, type: "image", image: { link: url, caption: String(caption || "").slice(0, 900) } }),
    });
    return r.ok;
  } catch (e) { return false; }
}
async function waText(to, text) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  if (!token || !phoneId || !to) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, text: { body: String(text).slice(0, 3500) } }),
    });
    return r.ok;
  } catch (e) { return false; }
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const auth = String(req.headers.authorization || "");
  const okCron = process.env.CRON_SECRET ? auth === `Bearer ${process.env.CRON_SECRET}` : true;
  const okAdmin = process.env.ADMIN_KEY ? guard.safeEqual(String(req.headers["x-admin-key"] || q.key || ""), process.env.ADMIN_KEY) : false;
  if (!okCron && !okAdmin) return res.status(401).json({ error: "unauthorized" });

  const cfg = guard.kvConfig();
  if (!cfg) return res.status(200).json({ ok: false, note: "kv not configured" });

  const now = q.now === "1";
  const force = !!q.force || now;
  if (!force) {
    const en = await guard.kvCommand(cfg, ["GET", "dp:enabled"]).catch(() => ({}));
    if (String(en.result || "1") === "0") return res.status(200).json({ ok: true, skipped: "disabled" });
    // one poster per IST day
    const mark = await guard.kvCommand(cfg, ["SET", `dp:done:${daily.todayIst()}`, "1", "NX", "EX", "90000"]).catch(() => ({}));
    if (!mark || !mark.result) return res.status(200).json({ ok: true, skipped: "already generated today" });
  }

  const t0 = Date.now();
  let out;
  try {
    out = await daily.createDailyPost(cfg, { topic: q.topic || undefined, by: q.by || undefined, queue: !now, dueMs: now ? Date.now() : undefined });
  } catch (e) {
    console.error("cron-daily: build failed", e && e.message);
    if (!force) await guard.kvCommand(cfg, ["DEL", `dp:done:${daily.todayIst()}`]).catch(() => {});
    const to = guard.ownerPhones()[0];
    if (to) await waText(to, `❌ Daily poster generate avvaledu: ${(e && e.message) || "unknown"}. 'daily post now' tho malli try cheyandi.`);
    return res.status(500).json({ ok: false, error: (e && e.message) || "failed" });
  }

  const url = `${BASE}/api/media?id=${out.imgId}`;
  let published = null, storyOut = null;
  if (now) {
    published = await admin.publishNow(cfg, { imgId: out.imgId, caption: out.caption, auto: true });
    // same poster as an Instagram story (24h) — stories skip captions/FB
    if (published && published.ok) storyOut = await admin.publishNow(cfg, { imgId: out.imgId, story: true, auto: true }).catch(() => null);
  } else {
    // queue the story 3 minutes after the feed post; cron-post handles story items
    await guard.kvCommand(cfg, ["LPUSH", "adm:queue", JSON.stringify({ imgId: out.imgId, story: true, due: out.due + 180000, by: out.by, tries: 0, auto: true, quiet: true })]).catch(() => {});
  }

  const when = admin.fmtIst(out.due);
  const preview = now
    ? (published && published.ok ? `✅ *Daily post live!* (${out.topic.h1})${published.fb ? " + 📘 FB" : ""}${storyOut && storyOut.ok ? " + 📸 Story" : ""}\n${published.link || ""}` : `❌ Publish fail: ${(published && published.msg) || "unknown"}`)
    : `🗓 *Today's auto post — ${out.topic.h1}*\nSchedule: ${when} → Instagram feed + story + Facebook.\n\nSkip cheyyalante: *unschedule 1* & *unschedule 2* · Topics: *daily topics*`;
  const caption = `${preview}\n\n${out.caption}`.slice(0, 900);
  for (const ph of out.notify) {
    const ok = await waImage(ph, url, caption);
    if (!ok) await waText(ph, caption);
  }
  return res.status(200).json({ ok: true, imgId: out.imgId, topic: out.topic.key, due: out.due, hadImage: out.hadImage, published, ms: Date.now() - t0 });
};
