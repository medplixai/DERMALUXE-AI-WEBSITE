// /api/kvmove — copy the clinic's database from one Redis to another.
//
// Everything the clinic runs on has been living in Washington: the functions
// and the database both. From Eluru that is about 450ms of ocean before the
// first byte of any answer comes back — measured, and confirmed to be the
// network rather than the database, since a request that makes four database
// calls returns in the same time as one that makes none. Moving both to
// Mumbai takes that to well under a tenth of a second.
//
// The functions move with a line of configuration. The database has to be
// copied, and this is what copies it.
//
// It runs inside the deployment, where both sets of credentials already live,
// so neither database's password is ever pulled onto anybody's laptop. It
// works in batches with a cursor so it can be called until it says it is
// done, and it copies each key with its own type and its own remaining
// lifetime, so an OTP that had forty seconds left still has forty seconds
// left afterwards.
//
// It is deliberately one-directional and explicit: the source is always the
// original KV_* database and the destination is always the BOM_KV_* one. It
// refuses to run if those turn out to be the same database.
const guard = require("./_guard.js");
const staff = require("./staff.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};

const src = () => {
  const u = process.env.KV_REST_API_URL, t = process.env.KV_REST_API_TOKEN;
  return u && t ? { url: u, token: t } : null;
};
const dst = () => {
  const u = process.env.BOM_KV_REST_API_URL, t = process.env.BOM_KV_REST_API_TOKEN;
  return u && t ? { url: u, token: t } : null;
};

// Upstash takes a whole batch of commands in one request. Copying key by key
// over single calls would be thousands of round trips; this is tens.
async function pipe(cfg, cmds) {
  if (!cmds.length) return [];
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

const one = async (cfg, cmd) => (await pipe(cfg, [cmd]))[0];

// Everything a key needs to be recreated exactly: its contents in whatever
// shape it has, and whatever is left of its life.
function readCmds(key, type) {
  switch (type) {
    case "string": return [["GET", key], ["PTTL", key]];
    case "list": return [["LRANGE", key, "0", "-1"], ["PTTL", key]];
    case "hash": return [["HGETALL", key], ["PTTL", key]];
    case "set": return [["SMEMBERS", key], ["PTTL", key]];
    case "zset": return [["ZRANGE", key, "0", "-1", "WITHSCORES"], ["PTTL", key]];
    default: return null;
  }
}

function writeCmds(key, type, value, pttl) {
  const out = [["DEL", key]];                 // a re-run must not append twice
  if (type === "string") {
    if (value == null) return [];
    out.push(["SET", key, String(value)]);
  } else if (type === "list") {
    const items = value || [];
    if (!items.length) return [];
    for (let i = 0; i < items.length; i += 200) out.push(["RPUSH", key].concat(items.slice(i, i + 200).map(String)));
  } else if (type === "hash") {
    const flat = [];
    if (Array.isArray(value)) flat.push(...value.map(String));
    else for (const [f, v] of Object.entries(value || {})) flat.push(String(f), String(v));
    if (!flat.length) return [];
    for (let i = 0; i < flat.length; i += 400) out.push(["HSET", key].concat(flat.slice(i, i + 400)));
  } else if (type === "set") {
    const items = value || [];
    if (!items.length) return [];
    for (let i = 0; i < items.length; i += 200) out.push(["SADD", key].concat(items.slice(i, i + 200).map(String)));
  } else if (type === "zset") {
    // ZRANGE WITHSCORES comes back as [member, score, member, score, ...]
    const flat = Array.isArray(value) ? value : [];
    const args = [];
    for (let i = 0; i + 1 < flat.length; i += 2) args.push(String(flat[i + 1]), String(flat[i]));
    if (!args.length) return [];
    for (let i = 0; i < args.length; i += 400) out.push(["ZADD", key].concat(args.slice(i, i + 400)));
  } else return [];
  if (Number(pttl) > 0) out.push(["PEXPIRE", key, String(Math.floor(Number(pttl)))]);
  return out;
}

const CURSOR = "kvmove:cursor";
const SKIP = new Set([CURSOR]);

async function copyBatch(s, d, want) {
  const max = Math.max(20, Math.min(400, Number(want) || 200));
  let cursor = String((await one(s, ["GET", CURSOR])) || "0");

  const scan = await one(s, ["SCAN", cursor, "COUNT", String(max)]);
  const next = Array.isArray(scan) ? String(scan[0]) : "0";
  const keys = (Array.isArray(scan) && Array.isArray(scan[1]) ? scan[1] : []).filter((k) => !SKIP.has(k));

  let moved = 0, skipped = 0;
  if (keys.length) {
    const types = await pipe(s, keys.map((k) => ["TYPE", k]));
    // read every key in one batch, then write every key in one batch
    const reads = [];
    const plan = [];
    keys.forEach((k, i) => {
      const t = String(types[i] || "");
      const rc = readCmds(k, t);
      if (!rc) { skipped++; return; }
      plan.push({ key: k, type: t, at: reads.length });
      reads.push(rc[0], rc[1]);
    });
    const got = await pipe(s, reads);
    const writes = [];
    for (const p of plan) {
      const w = writeCmds(p.key, p.type, got[p.at], got[p.at + 1]);
      if (!w.length) { skipped++; continue; }
      writes.push(...w);
      moved++;
    }
    // Upstash caps how much one pipeline may carry; send it in slices.
    for (let i = 0; i < writes.length; i += 300) await pipe(d, writes.slice(i, i + 300));
  }

  await one(s, ["SET", CURSOR, next]);
  return { moved, skipped, cursor: next, done: next === "0" };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  if (!auth.allow("settings.manage")) return json(res, 403, { error: "Idi owner ki matrame" });

  const s = src(), d = dst();
  if (!s) return json(res, 501, { error: "Original database kanipinchatledu" });
  if (!d) return json(res, 501, { error: "Mumbai database inka set cheyaledu" });
  if (s.url === d.url) return json(res, 400, { error: "Rendu okate database — aagipoyam" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "status");

  // How far along it is: how many keys each side holds.
  if (a === "status") {
    const [n1, n2, cur] = await Promise.all([
      one(s, ["DBSIZE"]).catch(() => null),
      one(d, ["DBSIZE"]).catch((e) => ({ error: e.message })),
      one(s, ["GET", CURSOR]).catch(() => null),
    ]);
    return json(res, 200, {
      ok: true, from: Number(n1) || 0, to: typeof n2 === "number" ? n2 : 0,
      cursor: String(cur || "0"),
      live: process.env.KV_PRIMARY === "bom" ? "mumbai" : "america",
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });

  // Start again from the beginning — used for the last pass before the switch.
  if (a === "reset") {
    await one(s, ["SET", CURSOR, "0"]);
    return json(res, 200, { ok: true, cursor: "0" });
  }

  if (a === "copy") {
    let out;
    try { out = await copyBatch(s, d, b.batch); }
    catch (e) { console.error("kvmove", e && e.message); return json(res, 500, { error: String(e.message || e).slice(0, 200) }); }
    return json(res, 200, Object.assign({ ok: true }, out));
  }

  return json(res, 400, { error: "Unknown action" });
};
