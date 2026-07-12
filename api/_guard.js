// Shared security helpers for API endpoints.
// (Underscore-prefixed files in /api are not exposed as routes on Vercel.)

function kvConfig() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    for (const k of Object.keys(env)) {
      if (!url && (k.endsWith("KV_REST_API_URL") || k.endsWith("UPSTASH_REDIS_REST_URL"))) url = env[k];
      if (!token && !k.includes("READ_ONLY") && (k.endsWith("KV_REST_API_TOKEN") || k.endsWith("UPSTASH_REDIS_REST_TOKEN"))) token = env[k];
    }
  }
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

function getIp(req) {
  const xf = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xf) ? xf[0] : String(xf || "")).split(",")[0].trim();
  return first || String(req.headers["x-real-ip"] || "unknown");
}

// Only requests originating from our own site are allowed.
const ALLOWED_HOSTS = new Set([
  "dermaluxe.ai",
  "www.dermaluxe.ai",
  "dermaluxe-ai-website.vercel.app",
  "localhost",
  "127.0.0.1",
]);

function originAllowed(req) {
  const src = req.headers.origin || req.headers.referer || "";
  if (!src) return false;
  try {
    const h = new URL(src).hostname;
    if (ALLOWED_HOSTS.has(h)) return true;
    // Vercel preview deployments of this project
    if (h.startsWith("dermaluxe-ai-website") && h.endsWith(".vercel.app")) return true;
    return false;
  } catch (e) {
    return false;
  }
}

// Sliding-window-ish counter: INCR + EXPIRE on first hit.
// Fails OPEN if storage is unavailable (site keeps working), but origin
// checks still apply.
async function rateLimit(cfg, key, limit, windowSec) {
  if (!cfg) return { allowed: true, count: 0 };
  try {
    const r = await kvCommand(cfg, ["INCR", key]);
    const n = Number(r.result || 0);
    if (n === 1) await kvCommand(cfg, ["EXPIRE", key, String(windowSec)]);
    return { allowed: n <= limit, count: n };
  } catch (e) {
    return { allowed: true, count: 0 };
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { kvConfig, kvCommand, getIp, originAllowed, rateLimit, today };
