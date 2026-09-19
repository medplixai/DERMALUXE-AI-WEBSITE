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
  if (!guard.safeEqual(b.key, adminKey)) return res.status(401).json({ error: "Invalid key" });

  const cfg = guard.kvConfig();
  if (!cfg) return res.status(501).json({ error: "Storage not configured" });

  const rl = await guard.rateLimit(cfg, `rl:ldel:h:${guard.getIp(req)}`, 60, 3600);
  if (!rl.allowed) return res.status(429).json({ error: "Too many requests" });

  // Each lead is taken out by its exact value (LREM), never by reading the
  // whole list, deleting it and writing back what should stay. That old way
  // lost, silently:
  //   - any lead that arrived between the read and the delete,
  //   - every lead past the first 5000 (the read stopped there; the delete did not),
  //   - everything, if writing back failed — kvCommand reports errors instead
  //     of throwing, so the reply still said ok,
  //   - any entry that would not parse, dropped without a word.
  // The staff app's own delete already worked this way.
  try {
    const data = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", "-1"]);
    if (!data || data.error) return res.status(500).json({ error: "Could not read leads" });
    const drop = [];
    const ts = Number(b.ts), phone = String(b.phone || "");
    if (b.testCleanup !== true && (!ts || !phone)) return res.status(400).json({ error: "ts and phone required" });
    for (const s of (data.result || [])) {
      let l;
      try { l = JSON.parse(s); } catch (e) { continue; }   // never delete what cannot be read
      const hit = b.testCleanup === true
        ? TEST_PREFIXES.some((p) => String(l.name || "").startsWith(p))
        : l.ts === ts && String(l.phone) === phone;
      if (hit) drop.push({ raw: s, key: `${l.ts}|${l.phone}` });
    }
    let removed = 0, failed = 0;
    const gone = [];
    for (const d of drop) {
      const r = await guard.kvCommand(cfg, ["LREM", LIST_KEY, "1", d.raw]);
      if (r && !r.error && Number(r.result) > 0) { removed++; gone.push(d.key); } else failed++;
    }
    for (let i = 0; i < gone.length; i += 100) {
      const chunk = gone.slice(i, i + 100);
      await guard.kvCommand(cfg, ["HDEL", "dl_status"].concat(chunk)).catch(() => {});
    }
    return res.status(failed ? 500 : 200).json({ ok: !failed, removed, failed });
  } catch (e) {
    return res.status(500).json({ error: "Delete failed" });
  }
};
