// GET /api/leads?key=ADMIN_KEY — returns stored leads (newest first).
// Protected by the ADMIN_KEY env var + per-IP attempt limit.
const guard = require("./_guard.js");
const LIST_KEY = "dl_leads";

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(501).json({ error: "ADMIN_KEY not configured in Vercel env" });

  const cfg = guard.kvConfig();
  const ip = guard.getIp(req);
  const rl = await guard.rateLimit(cfg, `rl:ls:h:${ip}`, 30, 3600);
  if (!rl.allowed) return res.status(429).json({ error: "Too many attempts — try later" });

  const key = (req.query && req.query.key) || "";
  if (key !== adminKey) return res.status(401).json({ error: "Invalid key" });

  if (!cfg) return res.status(501).json({ error: "Lead storage (Vercel KV / Upstash) not configured" });

  try {
    const data = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", "1999"]);
    const leads = (data.result || []).map((s) => {
      try { return JSON.parse(s); } catch (e) { return null; }
    }).filter(Boolean);
    return res.status(200).json({ ok: true, count: leads.length, leads });
  } catch (e) {
    return res.status(500).json({ error: "Failed to read leads" });
  }
};
