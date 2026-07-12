// GET /api/leads?key=ADMIN_KEY — returns stored leads (newest first).
// Protected by the ADMIN_KEY env var. 501 until storage/key are configured.
const LIST_KEY = "dl_leads";

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(501).json({ error: "ADMIN_KEY not configured in Vercel env" });

  const key = (req.query && req.query.key) || "";
  if (key !== adminKey) return res.status(401).json({ error: "Invalid key" });

  const cfg = kvConfig();
  if (!cfg) return res.status(501).json({ error: "Lead storage (Vercel KV / Upstash) not configured" });

  try {
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["LRANGE", LIST_KEY, "0", "1999"]),
    });
    const data = await resp.json();
    const leads = (data.result || []).map((s) => {
      try { return JSON.parse(s); } catch (e) { return null; }
    }).filter(Boolean);
    return res.status(200).json({ ok: true, count: leads.length, leads });
  } catch (e) {
    return res.status(500).json({ error: "Failed to read leads" });
  }
};
