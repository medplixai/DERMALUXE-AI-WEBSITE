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
  const rl = await guard.rateLimit(cfg, `rl:ls:h:${ip}`, 120, 3600);
  if (!rl.allowed) return res.status(429).json({ error: "Too many attempts — try later" });

  // Prefer the x-admin-key header (keeps the key out of URL/access logs);
  // ?key= stays supported for backwards compatibility.
  const key = String(req.headers["x-admin-key"] || (req.query && req.query.key) || "");
  if (!guard.safeEqual(key, adminKey)) return res.status(401).json({ error: "Invalid key" });

  if (!cfg) return res.status(501).json({ error: "Lead storage (Vercel KV / Upstash) not configured" });

  try {
    const data = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", "1999"]);
    const leads = (data.result || []).map((s) => {
      try { return JSON.parse(s); } catch (e) { return null; }
    }).filter(Boolean);

    // Merge follow-up statuses (HGETALL returns [field, value, ...] over REST)
    let statuses = {};
    try {
      const st = await guard.kvCommand(cfg, ["HGETALL", "dl_status"]);
      const r = st.result || [];
      if (Array.isArray(r)) {
        for (let i = 0; i + 1 < r.length; i += 2) statuses[r[i]] = r[i + 1];
      } else if (r && typeof r === "object") {
        statuses = r;
      }
    } catch (e) {}
    leads.forEach((l) => { l.status = statuses[`${l.ts}|${l.phone}`] || "new"; });

    return res.status(200).json({ ok: true, count: leads.length, leads });
  } catch (e) {
    return res.status(500).json({ error: "Failed to read leads" });
  }
};
