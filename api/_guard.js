// Shared security helpers for API endpoints.
// (Underscore-prefixed files in /api are not exposed as routes on Vercel.)
const crypto = require("crypto");

// Constant-time string comparison for secrets (admin keys, webhook tokens).
function safeEqual(a, b) {
  const A = Buffer.from(String(a || ""));
  const B = Buffer.from(String(b || ""));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

// Where the clinic's data lives, and how to talk to it.
//
// Two stores are understood. The original is Upstash Redis, reached over its
// REST endpoint. The other is Postgres — the clinic's own schema inside the
// group's Supabase project in Mumbai — which answers the same Redis commands
// through one database function. The application above this line cannot tell
// them apart: it sends ["LRANGE","dl_leads","0","199"] to either and gets the
// same answer back.
//
// KV_PRIMARY decides. Until it says "supabase", nothing reads or writes the
// Postgres copy except the migration endpoint, which names both explicitly.
// Flipping it is the cutover; flipping it back is the way out.
function kvConfig() {
  const env = process.env;
  if (env.KV_PRIMARY === "supabase") {
    const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
    const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) return { kind: "pg", url, key };
    console.error("kv: KV_PRIMARY=supabase but SUPABASE_URL / SUPABASE_SERVICE_KEY are missing — staying on Redis");
  }
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    for (const k of Object.keys(env)) {
      if (!url && (k.endsWith("KV_REST_API_URL") || k.endsWith("UPSTASH_REDIS_REST_URL"))) url = env[k];
      if (!token && !k.includes("READ_ONLY") && (k.endsWith("KV_REST_API_TOKEN") || k.endsWith("UPSTASH_REDIS_REST_TOKEN"))) token = env[k];
    }
  }
  return url && token ? { kind: "redis", url, token } : null;
}

// The Postgres side of the house. One function call carries one command, or a
// whole batch of them, and hands back exactly what Redis would have said.
async function pgCall(cfg, fn, body) {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`db ${r.status} ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function kvCommand(cfg, cmd) {
  if (cfg && cfg.kind === "pg") {
    try {
      return { result: await pgCall(cfg, "dl_kv", { cmd }) };
    } catch (e) {
      console.error("kv:", cmd && cmd[0], e && e.message);
      return { error: String((e && e.message) || e) };
    }
  }
  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  return resp.json();
}

// Several commands, one trip. Worth reaching for wherever a screen needs a
// handful of unrelated things at once.
async function kvPipeline(cfg, cmds) {
  if (!cmds.length) return [];
  if (cfg && cfg.kind === "pg") {
    const out = await pgCall(cfg, "dl_kv_pipe", { cmds });
    return Array.isArray(out) ? out : [];
  }
  const r = await fetch(cfg.url + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("pipeline " + r.status + " " + (await r.text().catch(() => "")).slice(0, 160));
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error("pipeline returned " + JSON.stringify(j).slice(0, 160));
  return j.map((x) => (x && Object.prototype.hasOwnProperty.call(x, "result") ? x.result : null));
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

// --- Owner (admin) phone list -------------------------------------------------
// Single source of truth for "who is an owner" across WhatsApp admin commands,
// the staff dashboard and every owner alert. ADMIN_PHONES (env) ∪ STAFF_OWNERS
// (env, default 9010427777). All values normalised to the last 10 digits.
function phones10(v) {
  return String(v || "").split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10);
}
function ownerPhones() {
  return Array.from(new Set(phones10(process.env.ADMIN_PHONES).concat(phones10(process.env.STAFF_OWNERS || "9010427777"))));
}
function isOwnerPhone(digits) {
  const d = String(digits || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 && ownerPhones().indexOf(d) !== -1;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { kvConfig, kvCommand, kvPipeline, getIp, originAllowed, rateLimit, today, safeEqual, phones10, ownerPhones, isOwnerPhone };
