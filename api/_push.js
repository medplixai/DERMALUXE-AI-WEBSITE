// Push notifications to the staff Android app (Firebase Cloud Messaging).
//
// Credentials: FIREBASE_SERVICE_ACCOUNT holds the whole service-account JSON
// (one line). Nothing else is needed — the project id comes out of that JSON.
// Without it every call here is a quiet no-op, so the site behaves exactly as
// it did before push existed.
//
// Who gets what is decided by the same capability model as the dashboard:
// notifyCap(cfg, "leads.view", …) reaches every logged-in device belonging to
// someone who may see leads, and nobody else.
//
// Device registry in KV:
//   push:dev:<token>  → {phone, name, role, platform, ts}
//   push:ph:<phone>   → SET of that person's tokens
//   push:tokens       → SET of every live token (for the Control panel list)
const crypto = require("crypto");
const guard = require("./_guard.js");

const FCM = "https://fcm.googleapis.com/v1/projects";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function account() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j.client_email || !j.private_key || !j.project_id) return null;
    // Vercel's env editor often stores the key with literal \n
    j.private_key = String(j.private_key).replace(/\\n/g, "\n");
    return j;
  } catch (e) {
    console.error("push: FIREBASE_SERVICE_ACCOUNT is not valid JSON");
    return null;
  }
}
const enabled = () => !!account();

const b64url = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

// Google OAuth2 access token, cached in KV until shortly before it expires.
async function accessToken(cfg) {
  const sa = account();
  if (!sa) return null;
  if (cfg) {
    const hit = await guard.kvCommand(cfg, ["GET", "push:tok"]).catch(() => ({}));
    if (hit && hit.result) return hit.result;
  }
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const signingInput = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claim)}`;
  const sig = crypto.createSign("RSA-SHA256").update(signingInput).sign(sa.private_key).toString("base64url");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${signingInput}.${sig}` }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    console.error("push: token exchange failed", d.error_description || d.error || r.status);
    return null;
  }
  if (cfg) await guard.kvCommand(cfg, ["SET", "push:tok", d.access_token, "EX", "3300"]).catch(() => {});
  return d.access_token;
}

// ---- device registry --------------------------------------------------------
async function saveDevice(cfg, token, who) {
  if (!cfg || !token) return false;
  const rec = JSON.stringify({ phone: who.phone, name: who.name || "", role: who.role || "", platform: who.platform || "android", ts: Date.now() });
  await guard.kvCommand(cfg, ["SET", `push:dev:${token}`, rec]);
  await guard.kvCommand(cfg, ["SADD", `push:ph:${who.phone}`, token]).catch(() => {});
  await guard.kvCommand(cfg, ["SADD", "push:tokens", token]).catch(() => {});
  return true;
}
async function dropDevice(cfg, token) {
  if (!cfg || !token) return;
  const r = await guard.kvCommand(cfg, ["GET", `push:dev:${token}`]).catch(() => ({}));
  let rec = null; try { rec = r.result ? JSON.parse(r.result) : null; } catch (e) {}
  if (rec && rec.phone) await guard.kvCommand(cfg, ["SREM", `push:ph:${rec.phone}`, token]).catch(() => {});
  await guard.kvCommand(cfg, ["SREM", "push:tokens", token]).catch(() => {});
  await guard.kvCommand(cfg, ["DEL", `push:dev:${token}`]).catch(() => {});
}
const setMembers = async (cfg, key) => {
  const r = await guard.kvCommand(cfg, ["SMEMBERS", key]).catch(() => ({}));
  return Array.isArray(r.result) ? r.result : [];
};
async function devicesOf(cfg, phone) { return setMembers(cfg, `push:ph:${phone}`); }
async function allDevices(cfg) {
  const tokens = await setMembers(cfg, "push:tokens");
  const out = [];
  for (const t of tokens) {
    const r = await guard.kvCommand(cfg, ["GET", `push:dev:${t}`]).catch(() => ({}));
    let rec = null; try { rec = r.result ? JSON.parse(r.result) : null; } catch (e) {}
    if (rec) out.push(Object.assign({ token: t, short: t.slice(0, 8) + "…" + t.slice(-6) }, rec));
    else await guard.kvCommand(cfg, ["SREM", "push:tokens", t]).catch(() => {});   // orphan
  }
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// ---- sending ----------------------------------------------------------------
// 22:00–07:00 IST. Urgent still rings; everything else is delivered on a
// silent channel and is waiting when they wake up. Nothing is discarded.
function quietNow() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()));
  return h >= 22 || h < 7;
}

async function sendRaw(cfg, tok, token, msg) {
  const sa = account();
  const body = {
    message: {
      token,
      notification: { title: msg.title, body: msg.body },
      data: Object.assign({}, msg.data || {}, msg.tab ? { tab: String(msg.tab) } : {}),
      android: {
        priority: msg.urgent ? "HIGH" : "NORMAL",
        notification: {
          channel_id: msg.urgent ? "dl_urgent" : msg.quiet ? "dl_quiet" : "dl_default",
          color: "#c6a25c",
          icon: "ic_stat_dl",
          click_action: "FCM_PLUGIN_ACTIVITY",
        },
        // a daytime lead alert is worthless tomorrow; a night one must survive
        // until morning, when the person actually looks at their phone
        ttl: (msg.ttlSec || (msg.quiet ? 12 * 3600 : 6 * 3600)) + "s",
      },
    },
  };
  // every data value must be a string
  for (const k of Object.keys(body.message.data)) body.message.data[k] = String(body.message.data[k]);
  const r = await fetch(`${FCM}/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) return { ok: true };
  const d = await r.json().catch(() => ({}));
  const status = (d.error && d.error.status) || String(r.status);
  // the app was uninstalled or the token rotated — forget this device
  if (r.status === 404 || status === "NOT_FOUND" || status === "UNREGISTERED") {
    await dropDevice(cfg, token);
    return { ok: false, dropped: true, msg: status };
  }
  return { ok: false, msg: (d.error && d.error.message) || status };
}

async function sendToTokens(cfg, tokens, msg) {
  if (!enabled() || !cfg) return { ok: false, sent: 0, skipped: "push not configured" };
  const list = Array.from(new Set((tokens || []).filter(Boolean)));
  if (!list.length) return { ok: true, sent: 0 };
  // At night nothing is dropped — it is delivered on a silent channel, so the
  // phone does not ring but the notification is waiting in the morning.
  const quiet = !msg.urgent && quietNow();
  const tok = await accessToken(cfg);
  if (!tok) return { ok: false, sent: 0, skipped: "no access token" };
  let sent = 0, dropped = 0, failed = 0;
  const outgoing = quiet ? Object.assign({}, msg, { quiet: true }) : msg;
  for (const t of list) {
    const r = await sendRaw(cfg, tok, t, outgoing).catch(() => ({ ok: false }));
    if (r.ok) sent++; else if (r.dropped) dropped++; else failed++;
  }
  return { ok: true, sent, dropped, failed, quiet };
}

async function sendToPhone(cfg, phone, msg) {
  return sendToTokens(cfg, await devicesOf(cfg, phone), msg);
}

// The point of the whole file: reach exactly the people allowed to see this.
async function notifyCap(cfg, cap, msg) {
  if (!enabled() || !cfg) return { ok: false, sent: 0 };
  let staff;
  try { staff = require("./staff.js"); } catch (e) { return { ok: false, sent: 0 }; }
  const roles = await staff.loadRoles(cfg).catch(() => null);
  if (!roles) return { ok: false, sent: 0 };
  const devices = await allDevices(cfg);
  const skip = String(msg.exceptPhone || "").replace(/\D/g, "").slice(-10);
  const tokens = [];
  for (const d of devices) {
    if (skip && d.phone === skip) continue;
    const live = await staff.liveUser(cfg, d.phone, roles).catch(() => null);
    if (!live || live.off) { await dropDevice(cfg, d.token); continue; }
    const caps = staff.effCaps(roles, live);
    if (caps.includes("*") || caps.includes(cap)) tokens.push(d.token);
  }
  return sendToTokens(cfg, tokens, msg);
}

module.exports = { enabled, saveDevice, dropDevice, devicesOf, allDevices, sendToTokens, sendToPhone, notifyCap, quietNow };
