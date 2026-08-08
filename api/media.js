// GET /api/media?id=<key> — serves a temporary image parked in KV (base64)
// so Instagram's servers can fetch it while publishing a post created from
// WhatsApp. Keys are 32-hex random, TTL 1h — unguessable and short-lived.
//
// GET /api/media?wa=<mediaId>&exp=<ms>&sig=<hmac> — streams a WhatsApp-hosted
// VIDEO straight from the WhatsApp media CDN to Instagram's fetcher (videos
// don't fit in KV). Link is HMAC-signed (WA_WEBHOOK_TOKEN) and expiring, so
// only URLs we minted work, and only for a couple of hours.
const crypto = require("crypto");
const guard = require("./_guard.js");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const q = req.query || {};

  if (q.wa) {
    const wa = String(q.wa || ""), exp = String(q.exp || ""), sig = String(q.sig || "");
    const secret = process.env.WA_WEBHOOK_TOKEN || "";
    const token = process.env.WA_CLOUD_TOKEN;
    if (!secret || !token || !/^\d{5,25}$/.test(wa) || !/^\d{10,16}$/.test(exp)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (Date.now() > Number(exp)) return res.status(410).json({ error: "Link expired" });
    const want = crypto.createHmac("sha256", secret).update(`${wa}.${exp}`).digest("hex");
    if (!guard.safeEqual(sig, want)) return res.status(403).json({ error: "Forbidden" });
    try {
      const metaResp = await fetch(`https://graph.facebook.com/v21.0/${wa}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!metaResp.ok) return res.status(404).json({ error: "Media not found" });
      const meta = await metaResp.json();
      if (!meta.url) return res.status(404).json({ error: "Media not found" });
      const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
      if (!bin.ok || !bin.body) return res.status(502).json({ error: "Media fetch failed" });
      res.statusCode = 200;
      res.setHeader("Content-Type", String(meta.mime_type || "video/mp4").split(";")[0]);
      if (meta.file_size) res.setHeader("Content-Length", String(meta.file_size));
      res.setHeader("Cache-Control", "no-store");
      const reader = bin.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    } catch (e) {
      console.error("media: wa proxy error", e && e.message);
      try { return res.status(500).json({ error: "Media fetch failed" }); } catch (e2) { return res.end(); }
    }
  }

  const id = String(q.id || "");
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: "Bad id" });
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(501).json({ error: "Storage not configured" });
  try {
    const r = await guard.kvCommand(cfg, ["GET", `adm:img:${id}`]);
    if (!r.result) return res.status(404).json({ error: "Not found or expired" });
    const buf = Buffer.from(r.result, "base64");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: "Media fetch failed" });
  }
};
