// POST /api/lead-status — sets follow-up status for a lead. ADMIN_KEY protected.
// Body: { key, ts, phone, status }  status ∈ new|contacted|booked|visited|closed
const guard = require("./_guard.js");
const HASH_KEY = "dl_status";
const ALLOWED = ["new", "contacted", "booked", "visited", "closed"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!guard.originAllowed(req)) return res.status(403).json({ error: "Unauthorized request origin" });

  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(501).json({ error: "ADMIN_KEY not configured" });

  const b = req.body || {};
  if (!guard.safeEqual(b.key, adminKey)) return res.status(401).json({ error: "Invalid key" });

  const cfg = guard.kvConfig();
  if (!cfg) return res.status(501).json({ error: "Storage not configured" });

  const rl = await guard.rateLimit(cfg, `rl:lst:h:${guard.getIp(req)}`, 240, 3600);
  if (!rl.allowed) return res.status(429).json({ error: "Too many requests" });

  const ts = Number(b.ts);
  const phone = String(b.phone || "").replace(/\D/g, "");
  const status = String(b.status || "").toLowerCase();
  if (!ts || !phone) return res.status(400).json({ error: "ts and phone required" });
  if (ALLOWED.indexOf(status) === -1) return res.status(400).json({ error: "Invalid status" });

  try {
    await guard.kvCommand(cfg, ["HSET", HASH_KEY, `${ts}|${phone}`, status]);
    return res.status(200).json({ ok: true, status });
  } catch (e) {
    return res.status(500).json({ error: "Failed to save status" });
  }
};
