// Every piece of stored state is both written and read somewhere.
//
// A key prefix that is written and never read is a feature that records
// something nobody ever looks at — or a reader that was renamed and now looks
// somewhere else. A prefix that is read and never written is a screen that
// can never show anything. Neither throws; both look like "no data yet".
//
// Keys are collected from every [command, key, ...] array literal in api/,
// cut at the first interpolation, so `pv:${id}` and "pv:list" are separate
// prefixes ("pv:" and "pv:list").
const fs = require("fs"), path = require("path");
const API = process.env.DL_API || path.resolve("api");
const WRITE = new Set(["SET", "SETEX", "LPUSH", "RPUSH", "HSET", "HINCRBY", "INCR", "INCRBY", "DECR", "SADD", "ZADD", "HMSET", "SETNX", "APPEND", "ZINCRBY"]);
const READ = new Set(["GET", "MGET", "LRANGE", "LINDEX", "LLEN", "HGET", "HGETALL", "HMGET", "HKEYS", "HVALS", "HLEN", "HEXISTS", "SMEMBERS", "SISMEMBER", "SCARD", "ZRANGE", "ZREVRANGE", "ZRANGEBYSCORE", "ZSCORE", "ZCARD", "EXISTS", "TTL", "LPOP", "RPOP", "KEYS", "SCAN"]);
const w = new Map(), r = new Map();
const add = (m, k, where) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(where); };
for (const f of fs.readdirSync(API).filter((x) => x.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(API, f), "utf8");
  // The whole array literal, so a trailing "NX" can be seen.
  const re = /\[\s*"([A-Z]+)"\s*,\s*(["'`])((?:(?!\2).)*?)\2([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) {
    const cmd = m[1];
    let key = m[3];
    const cut = key.indexOf("${");
    key = cut >= 0 ? key.slice(0, cut) : key;
    if (!key || !/^[a-z_][a-z0-9_:.-]*$/i.test(key)) continue;
    // SET … NX answers "was it already there?" and INCR answers with the new
    // value: each is a write and a read in one command — the once-only
    // markers and the running numbers.
    const both = (cmd === "SET" && /"NX"/.test(m[4])) || /^(INCR|INCRBY|HINCRBY|DECR|SETNX|LPOP|RPOP)$/.test(cmd);
    if (both) { add(w, key, f); add(r, key, f); }
    else if (WRITE.has(cmd)) add(w, key, f);
    else if (READ.has(cmd)) add(r, key, f);
  }
}
// Known and fine, with the reason.
const OK = {
  "rl:": "rate-limit counters — written and read by guard.rateLimit through INCR/TTL",
  // read through a helper or a variable key the literal scan cannot see
  "utm:": "r.js builds the key in a variable (utm:<tag>:<day>) and INCRs it",
  "push:ph:": "read through setMembers() in _push.js",
  "staff:lastlogin": "read through hashAll() in staff.js (the panel)",
  "lead:owner": "read through hashOf() in _queue.js and hashSome() in staff.js (the lead card shows the colleague)",
  "lead:oat": "read through hashOf() in _queue.js (each caller's day)",
  "gplace:reviews:v1": "written by reviews.js through its CACHE_KEY constant; _trust.js reads the same copy",
  // records kept for looking back, deliberately not on a screen
  "office:log": "what staff asked AI Office — kept for the record, 500 entries",
  "acad:dl": "which student opened which material — kept for the record",
  "ref:of:": "the patient's own code, stored beside ref:code:<code> so the pair can be audited; the code is derivable, so it is never read back",
};
const covered = (k, other) => [...other.keys()].some((o) => o === k || o.startsWith(k) || k.startsWith(o));
let bad = 0;
const lines = [];
for (const [k, files] of w) {
  if (Object.keys(OK).some((p) => k.startsWith(p))) continue;
  if (!covered(k, r)) { bad++; lines.push(`  ✗  written, never read   ${k.padEnd(28)} ${[...files].join(", ")}`); }
}
for (const [k, files] of r) {
  if (Object.keys(OK).some((p) => k.startsWith(p))) continue;
  if (!covered(k, w)) { bad++; lines.push(`  ✗  read, never written   ${k.padEnd(28)} ${[...files].join(", ")}`); }
}
lines.sort().forEach((l) => console.log(l));
console.log(`\n${w.size} prefixes written, ${r.size} read — ${bad ? bad + " to look at" : "every one is both written and read"}`);
