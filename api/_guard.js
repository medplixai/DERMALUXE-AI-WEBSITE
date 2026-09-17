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

// Who may run a scheduled job.
//
// Vercel's scheduler sends the bearer; a person running one by hand sends
// ?key= or an x-admin-key header, and either secret is accepted there since
// both are equally secret.
//
// It refuses when NEITHER secret is configured. Every cron here used to be
// written `if (process.env.CRON_SECRET) { ...check the bearer... }`, which
// skips the check entirely the moment that one variable goes missing — and
// these jobs publish to Instagram and Facebook, message patients, and write
// backups. Failing open on an absent environment variable is not something to
// leave lying in six files, so it lives here once.
function cronAuth(req) {
  const q = (req && req.query) || {};
  const hd = (req && req.headers) || {};
  const secrets = [process.env.CRON_SECRET, process.env.ADMIN_KEY].filter(Boolean);
  if (!secrets.length) return { ok: false, byCron: false, byAdmin: false, note: "CRON_SECRET / ADMIN_KEY unset — nothing may run this" };
  const byCron = !!process.env.CRON_SECRET && String(hd.authorization || "") === `Bearer ${process.env.CRON_SECRET}`;
  const given = String(hd["x-admin-key"] || q.key || "");
  const byKey = given.length > 0 && secrets.some((sec) => safeEqual(given, sec));
  // Only the admin key stands in for a person: the cron secret is the
  // scheduler's, and jobs that gate destructive overrides check byAdmin.
  const byAdmin = given.length > 0 && !!process.env.ADMIN_KEY && safeEqual(given, process.env.ADMIN_KEY);
  return { ok: byCron || byKey, byCron, byAdmin };
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

// A write the clinic cannot afford to lose quietly.
//
// Saving a lead sat inside an empty catch: if the database refused, the
// enquiry vanished and nothing anywhere said so. The WhatsApp alert to the
// care team still goes out, so a person hears about it — but it would never
// reach the dashboard, and nobody would know why. This says so in the logs
// and reports back, so callers can react instead of assuming.
async function kvWrite(cfg, cmd, what) {
  try {
    const r = await kvCommand(cfg, cmd);
    if (r && r.error) throw new Error(String(r.error).slice(0, 200));
    return true;
  } catch (e) {
    console.error("DATABASE WRITE FAILED —", what || cmd[0], "—", (e && e.message) || e);
    return false;
  }
}

// A hash comes back as a flat array from Redis and as an object from
// Postgres. Everywhere that reads one has to cope with both, so it is said
// once here rather than remembered at each call site.
function hashOf(v) {
  const out = {};
  if (Array.isArray(v)) { for (let i = 0; i + 1 < v.length; i += 2) out[v[i]] = v[i + 1]; }
  else if (v && typeof v === "object") Object.assign(out, v);
  return out;
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
// Counting a request and giving the counter a lifetime were two trips on
// every single request. Asking for the count and the remaining lifetime
// together costs one, and the expiry only has to be set on the first request
// of a window — so the window still runs from when it opened, exactly as
// before, and the extra trip happens once an hour instead of every time.
async function rateLimit(cfg, key, limit, windowSec) {
  if (!cfg) return { allowed: true, count: 0 };
  try {
    const [n, ttl] = await kvPipeline(cfg, [["INCR", key], ["TTL", key]]);
    const count = Number(n || 0);
    if (Number(ttl) < 0) await kvCommand(cfg, ["EXPIRE", key, String(windowSec)]);
    return { allowed: count <= limit, count };
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

module.exports = { cronAuth, kvConfig, kvCommand, kvPipeline, kvWrite, hashOf, getIp, originAllowed, rateLimit, today, safeEqual, phones10, ownerPhones, isOwnerPhone };
