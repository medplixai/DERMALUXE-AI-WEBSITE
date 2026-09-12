// GET /api/doc?id=<docId> — serves a generated academy document (PDF or JPEG)
// stored in KV by api/academy.js. Ids are random 32-hex, so the URL is the key.
const guard = require("./_guard.js");

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || "").replace(/[^a-f0-9]/gi, "").slice(0, 64);
  if (!id) return res.status(400).send("id required");
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(501).send("storage not configured");
  try {
    const r = await guard.kvCommand(cfg, ["GET", `acad:doc:${id}`]);
    if (!r || !r.result) return res.status(404).send("Not found or expired");
    let rec; try { rec = JSON.parse(r.result); } catch (e) { rec = { t: "pdf", b: r.result }; }
    const buf = Buffer.from(rec.b, "base64");
    res.setHeader("Content-Type", rec.t === "jpg" ? "image/jpeg" : "application/pdf");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `inline; filename="${(rec.n || "dermaluxe").replace(/[^\w.\-]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.status(200).end(buf);
  } catch (e) {
    return res.status(500).send("error");
  }
};
