// GET /api/cron-backup — a copy of everything, every night.
//
// The clinic's whole working memory — leads, appointments, bills, packages,
// students, staff logins, the conversation state the WhatsApp agent depends
// on — is one schema in one database. It has been that way since the start,
// first in Redis and now in Postgres, and at no point has there been a second
// copy anywhere. A dropped table, a bad migration, a rotated key: any of them
// and there is nothing to go back to.
//
// So once a night the whole store is read out, encrypted, and written to blob
// storage, where the running system cannot reach it by accident. Each night
// is its own file, kept for two weeks.
//
// It is encrypted with the same key the clinical photos use, derived from the
// secret that signs staff sessions — so a backup is only readable by this
// deployment, and changing that secret makes old backups unreadable along
// with old photos.
//
// Restoring is deliberately not automatic: /api/kvrestore lists what exists
// and puts one back only when asked by name.
const guard = require("./_guard.js");
const store = require("./_photo-store.js");

const PREFIX = "backup/";
const KEEP_DAYS = 14;
const MAX_KEYS = 20000;

const sdk = () => require("@vercel/blob");
const token = () => process.env.BLOB_READ_WRITE_TOKEN || "";
const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts || Date.now()));

// Read every key out of the live store, whatever shape each one is in, with
// whatever is left of its life. Same shapes the migration understood.
async function dumpAll(cfg) {
  const out = [];
  let cursor = "0", rounds = 0;
  do {
    const [scan] = await guard.kvPipeline(cfg, [["SCAN", cursor, "COUNT", "300"]]);
    cursor = Array.isArray(scan) ? String(scan[0]) : "0";
    const keys = (Array.isArray(scan) && Array.isArray(scan[1]) ? scan[1] : []);
    if (keys.length) {
      const types = await guard.kvPipeline(cfg, keys.map((k) => ["TYPE", k]));
      const reads = [];
      const plan = [];
      keys.forEach((k, i) => {
        const t = String(types[i] || "");
        const read = t === "string" ? ["GET", k]
          : t === "list" ? ["LRANGE", k, "0", "-1"]
          : t === "hash" ? ["HGETALL", k]
          : t === "set" ? ["SMEMBERS", k] : null;
        if (!read) return;
        plan.push({ k, t, at: reads.length });
        reads.push(read, ["PTTL", k]);
      });
      const got = await guard.kvPipeline(cfg, reads);
      for (const p of plan) out.push({ k: p.k, t: p.t, v: got[p.at], pttl: Number(got[p.at + 1]) || -1 });
    }
    rounds++;
  } while (cursor !== "0" && rounds < 200 && out.length < MAX_KEYS);
  return out;
}

async function writeBackup(cfg, day) {
  const keys = await dumpAll(cfg);
  const doc = JSON.stringify({ made: Date.now(), day, count: keys.length, keys });
  const e = store.encrypt(Buffer.from(doc, "utf8"));
  const body = Buffer.from(JSON.stringify({
    enc: e.enc, iv: e.iv, tag: e.tag, bytes: Buffer.byteLength(doc), count: keys.length,
    data: e.buf.toString("base64"),
  }), "utf8");
  const r = await sdk().put(`${PREFIX}${day}.json`, body, {
    access: "private",
    addRandomSuffix: false,     // one file per night, overwritten if it re-runs
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
    token: token(),
  });
  return { path: r.pathname, keys: keys.length, bytes: body.length };
}

// Two weeks is enough to notice a problem and go back past it.
async function sweepOld() {
  const cutoff = istDay(Date.now() - KEEP_DAYS * 86400000);
  let removed = 0;
  const list = await sdk().list({ prefix: PREFIX, token: token(), limit: 200 });
  for (const b of (list.blobs || [])) {
    const day = String(b.pathname).slice(PREFIX.length).replace(/\.json$/, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff) {
      await sdk().del(b.pathname, { token: token() }).catch(() => {});
      removed++;
    }
  }
  return removed;
}

module.exports = async (req, res) => {
  const gate = guard.cronAuth(req);
  if (!gate.ok) return res.status(401).json({ error: "unauthorized", note: gate.note });
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(200).json({ ok: true, note: "no store configured" });
  if (!token()) return res.status(200).json({ ok: false, note: "blob storage not configured — nowhere to put a backup" });

  const t0 = Date.now();
  const day = istDay();
  try {
    const made = await writeBackup(cfg, day);
    let removed = 0;
    try { removed = await sweepOld(); } catch (e) { console.error("backup: sweep", e && e.message); }
    // so the control panel can say when the last good one was
    await guard.kvCommand(cfg, ["SET", "backup:last", JSON.stringify({ day, at: Date.now(), keys: made.keys, bytes: made.bytes })]).catch(() => {});
    console.log("backup", day, made.keys, "keys", made.bytes, "bytes", Date.now() - t0, "ms");
    return res.status(200).json({ ok: true, day, ...made, removed, ms: Date.now() - t0 });
  } catch (e) {
    console.error("BACKUP FAILED —", e && e.message);
    // A backup that quietly stops happening is worse than none, because it is
    // believed in. Tell somebody.
    try {
      const notify = require("./_notify.js");
      for (const ph of guard.ownerPhones()) {
        await notify.sendWa(ph, `⚠️ DermaLuxe: ee raatri backup avvaledu.\n\n${String(e.message || e).slice(0, 200)}\n\nOkasari chudandi.`).catch(() => {});
      }
    } catch (x) {}
    return res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};

module.exports.dumpAll = dumpAll;
module.exports.writeBackup = writeBackup;
module.exports.sweepOld = sweepOld;
module.exports.istDay = istDay;
module.exports.PREFIX = PREFIX;
