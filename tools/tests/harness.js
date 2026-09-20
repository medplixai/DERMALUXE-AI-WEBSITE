// A real in-memory Redis-shaped store, so the endpoints run their own logic
// against data instead of stubs. Whatever this gets wrong, the tests will
// blame the code for — so it implements the commands properly.
process.env.STAFF_SECRET = "local-test-secret";
process.env.ADMIN_KEY = "local-admin";
const path = require("path");
const API = process.env.DL_API || path.resolve("api");
const real = require(path.join(API, "_guard.js"));

const S = { str: new Map(), list: new Map(), hash: new Map(), set: new Map(), exp: new Map() };
const alive = (k) => { const e = S.exp.get(k); if (e && e <= Date.now()) { S.str.delete(k); S.list.delete(k); S.hash.delete(k); S.set.delete(k); S.exp.delete(k); return false; } return true; };
const L = (k) => { alive(k); if (!S.list.has(k)) S.list.set(k, []); return S.list.get(k); };
const H = (k) => { alive(k); if (!S.hash.has(k)) S.hash.set(k, new Map()); return S.hash.get(k); };
const T = (k) => { alive(k); if (!S.set.has(k)) S.set.set(k, new Set()); return S.set.get(k); };

function run(c) {
  const op = String(c[0]).toUpperCase(), k = c[1];
  switch (op) {
    case "GET": return alive(k) && S.str.has(k) ? S.str.get(k) : null;
    case "SET": {
      const nx = c.includes("NX"), xx = c.includes("XX");
      const i = c.findIndex((x) => String(x).toUpperCase() === "EX");
      if (nx && alive(k) && S.str.has(k)) return null;
      if (xx && !(alive(k) && S.str.has(k))) return null;
      S.str.set(k, String(c[2]));
      if (i > 0) S.exp.set(k, Date.now() + Number(c[i + 1]) * 1000); else S.exp.delete(k);
      return "OK";
    }
    case "SETEX": S.str.set(k, String(c[3])); S.exp.set(k, Date.now() + Number(c[2]) * 1000); return "OK";
    case "DEL": { let n = 0; for (const key of c.slice(1)) { if (S.str.delete(key) | S.list.delete(key) | S.hash.delete(key) | S.set.delete(key)) n++; S.exp.delete(key); } return n; }
    case "EXISTS": return alive(k) && (S.str.has(k) || S.list.has(k) || S.hash.has(k) || S.set.has(k)) ? 1 : 0;
    case "INCR": { const v = Number(S.str.get(k) || 0) + 1; S.str.set(k, String(v)); return v; }
    case "INCRBY": { const v = Number(S.str.get(k) || 0) + Number(c[2]); S.str.set(k, String(v)); return v; }
    case "EXPIRE": S.exp.set(k, Date.now() + Number(c[2]) * 1000); return 1;
    case "PEXPIRE": S.exp.set(k, Date.now() + Number(c[2])); return 1;
    case "TTL": { const e = S.exp.get(k); return e ? Math.ceil((e - Date.now()) / 1000) : -1; }
    case "PTTL": { const e = S.exp.get(k); return e ? e - Date.now() : -1; }
    case "LPUSH": { const l = L(k); for (const v of c.slice(2)) l.unshift(String(v)); return l.length; }
    case "RPUSH": { const l = L(k); for (const v of c.slice(2)) l.push(String(v)); return l.length; }
    case "LRANGE": { const l = L(k); let a = Number(c[2]), b = Number(c[3]);
      if (a < 0) a = Math.max(0, l.length + a); if (b < 0) b = l.length + b;
      return l.slice(a, b + 1); }
    case "LLEN": return L(k).length;
    case "RPOP": { const l = L(k); return l.length ? l.pop() : null; }
    case "LPOP": { const l = L(k); return l.length ? l.shift() : null; }
    case "MGET": return c.slice(1).map((key) => (alive(key) && S.str.has(key) ? S.str.get(key) : null));
    case "DBSIZE": return new Set([...S.str.keys(), ...S.list.keys(), ...S.hash.keys(), ...S.set.keys()].filter(alive)).size;
    case "LTRIM": { const l = L(k); let a = Number(c[2]), b = Number(c[3]); if (b < 0) b = l.length + b;
      S.list.set(k, l.slice(a, b + 1)); return "OK"; }
    case "LREM": { const l = L(k); const want = String(c[3]); let n = Math.abs(Number(c[2])) || l.length, out = [], removed = 0;
      for (const v of l) { if (v === want && removed < n) { removed++; continue; } out.push(v); }
      S.list.set(k, out); return removed; }
    case "HSET": { const h = H(k); let added = 0;
      for (let i = 2; i < c.length; i += 2) { if (!h.has(String(c[i]))) added++; h.set(String(c[i]), String(c[i + 1])); }
      return added; }
    case "HGET": { const h = H(k); return h.has(String(c[2])) ? h.get(String(c[2])) : null; }
    case "HMGET": { const h = H(k); return c.slice(2).map((f) => (h.has(String(f)) ? h.get(String(f)) : null)); }
    case "HGETALL": { const h = H(k); const out = []; for (const [f, v] of h) out.push(f, v); return out; }
    case "HDEL": { const h = H(k); let n = 0; for (const f of c.slice(2)) if (h.delete(String(f))) n++; return n; }
    case "HLEN": return H(k).size;
    case "HINCRBY": { const h = H(k); const v = Number(h.get(String(c[2])) || 0) + Number(c[3]); h.set(String(c[2]), String(v)); return v; }
    case "SADD": { const s = T(k); let n = 0; for (const v of c.slice(2)) { if (!s.has(String(v))) n++; s.add(String(v)); } return n; }
    case "SREM": { const s = T(k); let n = 0; for (const v of c.slice(2)) if (s.delete(String(v))) n++; return n; }
    case "SMEMBERS": return [...T(k)];
    // The real store (Redis-shaped over Postgres) answers this with
    // {"message":"unsupported command SISMEMBER"} — it went unnoticed in
    // production for a day because every caller read the error as "no".
    // Use guard.setHas (SMEMBERS) instead.
    case "SISMEMBER": throw new Error("unsupported command SISMEMBER — use guard.setHas()");
    case "SCARD": return T(k).size;
    case "SCAN": { const keys = [...new Set([...S.str.keys(), ...S.list.keys(), ...S.hash.keys(), ...S.set.keys()])].filter(alive);
      const mi = c.findIndex((x) => String(x).toUpperCase() === "MATCH");
      const pat = mi > 0 ? String(c[mi + 1]) : "*";
      const rx = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      return ["0", keys.filter((x) => rx.test(x))]; }
    case "TYPE": return S.str.has(k) ? "string" : S.list.has(k) ? "list" : S.hash.has(k) ? "hash" : S.set.has(k) ? "set" : "none";
    case "PING": return "PONG";
    default: throw new Error("harness: unimplemented " + op);
  }
}

const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
const sent = [];
stub("_guard.js", Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
  kvConfig: () => ({ kind: "pg" }),
  // The real algorithm, over this store. Inheriting the real rateLimit does
  // not work: it calls _guard's own internal kvPipeline, which tries a
  // database that is not there, fails, and returns "allowed" — so every limit
  // in the app silently passed in every test.
  rateLimit: async (cfg, key, limit, windowSec) => {
    const n = Number(run(["INCR", key]) || 0);
    if (Number(run(["TTL", key])) < 0) run(["EXPIRE", key, String(windowSec)]);
    return { allowed: n <= limit, count: n };
  },
  kvCommand: async (cfg, c) => ({ result: run(c) }),
  kvPipeline: async (cfg, cs) => cs.map(run),
  kvWrite: async (cfg, c) => { run(c); return true; },
}));
stub("_notify.js", {
  sendWa: async (...a) => { sent.push(["wa", ...a]); return true; },   // the real one returns a boolean
  sendWaAuthCode: async (...a) => { sent.push(["otp", ...a]); return { ok: true }; },
  sendWaDocLink: async (...a) => { sent.push(["doc", ...a]); return { ok: true }; },
  leadAlert: async (...a) => { sent.push(["lead", ...a]); return true; },
  sendWaTemplate: async (...a) => { sent.push(["tpl", ...a]); return { ok: true }; },
  sendWaButtons: async (...a) => { sent.push(["btn", ...a]); return true; },       // boolean, like sendWa
  sendWaImageLink: async (...a) => { sent.push(["img", ...a]); return true; },
  notifyOwner: async (...a) => { sent.push(["owner", ...a]); return { ok: true }; },
  waOwner: async (...a) => { sent.push(["owner", ...a]); return { ok: true }; },
});
stub("_push.js", { enabled: () => false, notifyCap: async () => ({ ok: true }), send: async () => ({ ok: true }) });
// The blob store is in memory, but the encryption is the real one — a
// backup test that encrypts with a stub proves nothing.
const realStore = require(path.join(API, "_photo-store.js"));
stub("_photo-store.js", (() => {
  const blobs = new Map();
  return {
    put: async (cfg, id, buf, opts) => { const r = realStore.encrypt(Buffer.from(buf)); blobs.set(id, r); return Object.assign({ store: "blob", path: "mem/" + id, id, bytes: r.buf.length }, r, { buf: undefined }); },
    get: async (cfg, id, rec) => { if (!blobs.has(id)) throw new Error("gone"); const r = blobs.get(id); return realStore.decrypt(r.buf, r); },
    del: async (cfg, id) => blobs.delete(id),
    encrypt: realStore.encrypt, decrypt: realStore.decrypt,
    blobOn: realStore.blobOn, migrate: realStore.migrate, stats: realStore.stats,
    blobs,
  };
})());

let CAPS = ["*"], ME = { name: "Owner", phone: "9010427777", role: "owner" };
stub("staff.js", {
  requireStaff: async () => ({ ok: true, me: ME, allow: (c) => CAPS.includes("*") || CAPS.includes(c) }),
});

const load = (n) => require(path.join(API, n + ".js"));
// req: optional extra request fields — headers, method, url.
const call = (mod, q, body, req) => new Promise((resolve) => {
  const res = { _c: 200, _h: {}, statusCode: 200, setHeader(k, v) { this._h[k] = v; }, getHeader(k) { return this._h[k]; },
    status(c) { this._c = c; this.statusCode = c; return this; },
    json(o) { resolve({ code: this._c, body: o, headers: this._h }); return this; },
    send(x) { resolve({ code: this._c, bin: x, headers: this._h }); return this; },
    write() { return true; },
    end(x) { resolve({ code: this.statusCode !== 200 ? this.statusCode : this._c, bin: x, headers: this._h }); return this; } };
  mod(Object.assign({ method: body ? "POST" : "GET", headers: {}, query: q || {}, body: body || {} }, req || {}), res);
});
const as = (caps, me) => { CAPS = caps; if (me) ME = me; };
module.exports = { run, load, call, as, sent, S, store: require(path.join(API, "_photo-store.js")) };
