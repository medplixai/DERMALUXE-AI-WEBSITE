// POST /api/sync-retry — re-pushes leads that failed to reach the clinic
// platform (parked in dl_sync_pending). ADMIN_KEY protected.
// Body: { key }
const guard = require("./_guard.js");
const clinic = require("./_clinic.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!guard.originAllowed(req)) return res.status(403).json({ error: "Unauthorized request origin" });

  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(501).json({ error: "ADMIN_KEY not configured" });
  if (String((req.body || {}).key || "") !== adminKey) return res.status(401).json({ error: "Invalid key" });

  const cfg = guard.kvConfig();
  if (!cfg) return res.status(501).json({ error: "Storage not configured" });

  const rl = await guard.rateLimit(cfg, `rl:sr:h:${guard.getIp(req)}`, 20, 3600);
  if (!rl.allowed) return res.status(429).json({ error: "Too many requests" });

  if (!clinic.clinicConfig().syncUrl) {
    return res.status(200).json({ ok: true, retried: 0, synced: 0, remaining: 0, reason: "CLINIC_SYNC_URL not set" });
  }

  try {
    const data = await guard.kvCommand(cfg, ["LRANGE", clinic.PENDING_KEY, "0", "199"]);
    const items = (data.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
    // Clear the slice we are processing; failures get re-parked by forwardLead.
    await guard.kvCommand(cfg, ["DEL", clinic.PENDING_KEY]);

    let synced = 0;
    for (const lead of items) {
      const r = await clinic.forwardLead(cfg, lead);
      if (r.synced) synced++;
    }
    const left = await guard.kvCommand(cfg, ["LLEN", clinic.PENDING_KEY]);
    return res.status(200).json({ ok: true, retried: items.length, synced, remaining: Number(left.result || 0) });
  } catch (e) {
    return res.status(500).json({ error: "Retry failed" });
  }
};
