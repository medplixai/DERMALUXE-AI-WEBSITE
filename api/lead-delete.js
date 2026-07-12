// POST /api/lead-delete — removes lead(s). ADMIN_KEY protected.
// Body: { key, ts, phone }            → delete one lead
//       { key, testCleanup: true }    → delete known test entries
const guard = require("./_guard.js");
const LIST_KEY = "dl_leads";
const TEST_PREFIXES = ["Setup Test", "Security Test", "RL Test", "Spam Bot", "Print Test"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!guard.originAllowed(req)) return res.status(403).json({ error: "Unauthorized request origin" });

  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(501).json({ error: "ADMIN_KEY not configured" });

  const b = req.body || {};
  if (String(b.key || "") !== adminKey) return res.status(401).json({ error: "Invalid key" });

  const cfg = guard.kvConfig();
  if (!cfg) return res.status(501).json({ error: "Storage not configured" });

  const rl = await guard.rateLimit(cfg, `rl:ldel:h:${guard.getIp(req)}`, 60, 3600);
  if (!rl.allowed) return res.status(429).json({ error: "Too many requests" });

  try {
    const data = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", "4999"]);
    const all = data.result || [];
    let keep;
    if (b.testCleanup === true) {
      keep = all.filter((s) => {
        try {
          const l = JSON.parse(s);
          return !TEST_PREFIXES.some((p) => String(l.name || "").startsWith(p));
        } catch (e) { return false; }
      });
    } else {
      const ts = Number(b.ts);
      const phone = String(b.phone || "");
      if (!ts || !phone) return res.status(400).json({ error: "ts and phone required" });
      keep = all.filter((s) => {
        try {
          const l = JSON.parse(s);
          return !(l.ts === ts && l.phone === phone);
        } catch (e) { return false; }
      });
    }
    await guard.kvCommand(cfg, ["DEL", LIST_KEY]);
    for (let i = 0; i < keep.length; i += 400) {
      const chunk = keep.slice(i, i + 400);
      if (chunk.length) await guard.kvCommand(cfg, ["RPUSH", LIST_KEY].concat(chunk));
    }
    return res.status(200).json({ ok: true, removed: all.length - keep.length });
  } catch (e) {
    return res.status(500).json({ error: "Delete failed" });
  }
};
