// GET /api/media?id=<key> — serves a temporary image parked in KV (base64)
// so Instagram's servers can fetch it while publishing a post created from
// WhatsApp. Keys are 32-hex random, TTL 1h — unguessable and short-lived.
const guard = require("./_guard.js");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const id = String((req.query || {}).id || "");
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
