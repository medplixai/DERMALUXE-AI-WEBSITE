// GET /api/marketing-stats — JSON for the marketing.html dashboard.
// Protected exactly like /api/leads: ADMIN_KEY via x-admin-key header
// (falls back to ?key=) + per-IP rate limit. Numbers only — no secrets.
const guard = require("./_guard.js");

const DAY = 86400000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(501).json({ error: "ADMIN_KEY not configured" });
  const cfg = guard.kvConfig();
  const ip = guard.getIp(req);
  const rl = await guard.rateLimit(cfg, `rl:mk:h:${ip}`, 60, 3600);
  if (!rl.allowed) return res.status(429).json({ error: "Too many requests — try later" });
  const key = String(req.headers["x-admin-key"] || (req.query && req.query.key) || "");
  if (!guard.safeEqual(key, adminKey)) return res.status(403).json({ error: "Invalid key" });
  if (!cfg) return res.status(200).json({ leads: { total30: 0, days: [], channels: {} }, links: {}, campaigns: [], recent: [] });

  const now = Date.now();
  const out = { leads: { total30: 0, total7: 0, days: [], channels: {} }, links: {}, linksTotal14: 0, campaigns: [], ig: null, recent: [] };

  // Leads: 30d channel split + 14d daily series + recent list
  try {
    const lr = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "999"]);
    const leads = (lr.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter((l) => l && now - l.ts < 30 * DAY);
    out.leads.total30 = leads.length;
    const daily = {};
    leads.forEach((l) => {
      const t = l.type || "other";
      out.leads.channels[t] = (out.leads.channels[t] || 0) + 1;
      if (now - l.ts < 7 * DAY) out.leads.total7++;
      if (now - l.ts < 14 * DAY) { const d = dayKey(l.ts); daily[d] = (daily[d] || 0) + 1; }
    });
    for (let d = 13; d >= 0; d--) {
      const k = dayKey(now - d * DAY);
      out.leads.days.push({ date: k.slice(5), count: daily[k] || 0 });
    }
    out.recent = leads.slice(0, 8).map((l) => ({
      name: String(l.name || "?").slice(0, 30), type: l.type || "",
      concern: String(l.concern || "").slice(0, 40), ts: l.ts,
    }));
  } catch (e) {}

  // Smart links: per-tag totals over 14d (single MGET)
  try {
    const tags = ["insta", "wa", "fb", "gbp", "story"];
    const keys = [];
    tags.forEach((tag) => { for (let d = 0; d < 14; d++) keys.push(`utm:${tag}:${dayKey(now - d * DAY)}`); });
    const mg = await guard.kvCommand(cfg, ["MGET"].concat(keys));
    const vals = mg.result || [];
    tags.forEach((tag, i) => {
      let sum = 0;
      for (let d = 0; d < 14; d++) sum += Number(vals[i * 14 + d] || 0);
      if (sum > 0) out.links[tag] = sum;
      out.linksTotal14 += sum;
    });
  } catch (e) {}

  // Campaign hits over 14d
  try {
    const cs = await guard.kvCommand(cfg, ["SMEMBERS", "camp:_set"]);
    const words = (cs.result || []).slice(0, 20);
    if (words.length) {
      const keys = [];
      words.forEach((w) => { for (let d = 0; d < 14; d++) keys.push(`camphit:${w}:${dayKey(now - d * DAY)}`); });
      const mg = await guard.kvCommand(cfg, ["MGET"].concat(keys));
      const vals = mg.result || [];
      words.forEach((w, i) => {
        let sum = 0;
        for (let d = 0; d < 14; d++) sum += Number(vals[i * 14 + d] || 0);
        out.campaigns.push({ word: w, hits14: sum });
      });
      out.campaigns.sort((a, b) => b.hits14 - a.hits14);
    }
  } catch (e) {}

  // IG snapshot (best-effort)
  try {
    let tok = null;
    try { const r = await guard.kvCommand(cfg, ["GET", "ig:ltok"]); if (r && r.result) tok = r.result; } catch (e) {}
    tok = tok || process.env.IG_LOGIN_TOKEN;
    if (tok) {
      const r = await fetch(`https://graph.instagram.com/v21.0/me?fields=username,followers_count,media_count&access_token=${encodeURIComponent(tok)}`);
      if (r.ok) {
        const d = await r.json();
        out.ig = { username: d.username, followers: d.followers_count, posts: d.media_count };
      }
    }
  } catch (e) {}

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(out);
};
