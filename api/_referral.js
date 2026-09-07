// Word-of-mouth engine: every patient gets a short personal code (DL + 4
// digits). They share it; the friend types it in chat; both sides are tracked
// and the team is told so the reward is honoured at the desk.
//
// KV shape:
//   ref:code:<CODE>   → owner's 10-digit phone (no TTL — codes are for life)
//   ref:of:<phone>    → that patient's CODE
//   ref:list:<phone>  → LIST of {ph, name, ts} they brought in
//   ref:used:<phone>  → the code this patient redeemed (one per patient)
const guard = require("./_guard.js");

// Deterministic, readable, and stable for a given number.
function codeFor(phone) {
  const d = String(phone || "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return "";
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) % 100000;
  return "DL" + String(h).padStart(4, "0").slice(-4);
}

// Issue (or re-issue) the caller's own code.
async function myCode(cfg, phone) {
  const code = codeFor(phone);
  if (!cfg || !code) return code;
  try {
    await guard.kvCommand(cfg, ["SET", `ref:code:${code}`, phone]);
    await guard.kvCommand(cfg, ["SET", `ref:of:${phone}`, code]);
  } catch (e) {}
  return code;
}

// Someone typed a code. Returns {ok, owner, code} | {reason}.
//   self       – their own code
//   already    – this patient already redeemed one
//   unknown    – no such code
async function redeem(cfg, code, phone, name) {
  const c = String(code || "").toUpperCase().trim();
  if (!cfg || !/^DL\d{4}$/.test(c)) return { reason: "unknown" };
  try {
    const r = await guard.kvCommand(cfg, ["GET", `ref:code:${c}`]);
    const owner = r && r.result ? String(r.result) : "";
    if (!owner) return { reason: "unknown" };
    if (owner === phone) return { reason: "self" };
    const used = await guard.kvCommand(cfg, ["GET", `ref:used:${phone}`]).catch(() => ({}));
    if (used && used.result) return { reason: "already", code: String(used.result) };
    await guard.kvCommand(cfg, ["SET", `ref:used:${phone}`, c]);
    await guard.kvCommand(cfg, ["LPUSH", `ref:list:${owner}`, JSON.stringify({ ph: phone, name: String(name || "").slice(0, 40), ts: Date.now() })]);
    await guard.kvCommand(cfg, ["LTRIM", `ref:list:${owner}`, "0", "99"]);
    await guard.kvCommand(cfg, ["SADD", "ref:_owners", owner]).catch(() => {});
    return { ok: true, owner, code: c };
  } catch (e) {
    return { reason: "unknown" };
  }
}

// How many friends this patient has brought in.
async function countFor(cfg, phone) {
  if (!cfg) return 0;
  try {
    const r = await guard.kvCommand(cfg, ["LLEN", `ref:list:${phone}`]);
    return Number(r.result || 0);
  } catch (e) { return 0; }
}

// Leaderboard for the owner's `referrals` command.
async function leaderboard(cfg, limit) {
  if (!cfg) return [];
  try {
    const o = await guard.kvCommand(cfg, ["SMEMBERS", "ref:_owners"]);
    const rows = [];
    for (const ph of (o.result || [])) {
      const l = await guard.kvCommand(cfg, ["LRANGE", `ref:list:${ph}`, "0", "99"]).catch(() => ({}));
      const items = (l.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
      if (items.length) rows.push({ ph, n: items.length, last: items[0], code: codeFor(ph) });
    }
    rows.sort((a, b) => b.n - a.n);
    return rows.slice(0, limit || 10);
  } catch (e) { return []; }
}

module.exports = { codeFor, myCode, redeem, countFor, leaderboard };
