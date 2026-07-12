// POST /api/lead — stores a lead in Vercel KV / Upstash Redis.
// Works with either env pair:
//   KV_REST_API_URL + KV_REST_API_TOKEN   (Vercel KV)
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash direct)
// If storage is not configured yet, responds {stored:false} without failing the site.
const LIST_KEY = "dl_leads";

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function kvCommand(cfg, cmd) {
  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  return resp.json();
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  const phone = String(b.phone || "").replace(/\D/g, "");
  const name = String(b.name || "").slice(0, 80).trim();
  if (!name || !/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: "Invalid lead" });
  }

  const lead = {
    ts: Date.now(),
    type: String(b.type || "lead").slice(0, 24),          // ai_lead | ai_report | booking | teleconsult
    name: name,
    phone: phone,
    age: String(b.age || "").slice(0, 8),
    gender: String(b.gender || "").slice(0, 12),
    concern: String(b.concern || b.service || "").slice(0, 120),
    message: String(b.message || "").slice(0, 400),
    mode: String(b.mode || "").slice(0, 40),
    date: String(b.date || "").slice(0, 20),
    slot: String(b.slot || "").slice(0, 60),
    skin_score: b.skin_score == null ? null : Number(b.skin_score),
    hair_score: b.hair_score == null ? null : Number(b.hair_score),
    skin_age: b.skin_age == null ? null : Number(b.skin_age),
    skin_type: String(b.skin_type || "").slice(0, 20),
    treatments: Array.isArray(b.treatments) ? b.treatments.slice(0, 6).map(String) : [],
    page: String(b.page || "").slice(0, 200),
  };

  const cfg = kvConfig();
  if (!cfg) return res.status(200).json({ ok: true, stored: false, reason: "storage not configured" });

  try {
    await kvCommand(cfg, ["LPUSH", LIST_KEY, JSON.stringify(lead)]);
    await kvCommand(cfg, ["LTRIM", LIST_KEY, "0", "4999"]);
    return res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    return res.status(200).json({ ok: true, stored: false });
  }
};
