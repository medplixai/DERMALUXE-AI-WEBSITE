// Where clinical photographs actually live.
//
// They used to live in Redis, as base64 inside a JSON value — roughly 1.3
// bytes stored for every byte photographed, in the same database that holds
// the lead book and every counter the clinic runs on. At twenty photos a day
// that is a couple of gigabytes a year in a key-value store priced and sized
// for keys and values, and every single view pulled the whole image back
// through a serverless function.
//
// So the bytes go to blob storage and Redis keeps only the small record that
// describes them. Three things stand between a patient's photograph and
// anyone who should not see it:
//
//   * The store is PRIVATE. There is no public URL. Reading a blob requires
//     the store's own credential, which lives in the server's environment and
//     is never sent to a browser.
//   * The bytes are encrypted before they leave this process, AES-256-GCM,
//     a fresh random IV each time, so the file is worthless even to someone
//     who somehow reached the store. The key is derived with HKDF from
//     whichever secret signs staff sessions — STAFF_SECRET, or ADMIN_KEY when
//     that is what the deployment uses — and is never written down anywhere.
//     *** Changing that secret logs everyone out, which is recoverable, AND
//     makes every photo stored before the change unreadable, which is not.
//     Nothing else in the system carries that second cost; this does. ***
//   * /api/photo still checks the session and the capability recorded on the
//     photo before it streams a single byte, exactly as it always has.
//
// If blob storage is not configured, photos are stored in Redis as before —
// encrypted now — so this file works before the store exists, and photos
// written either way keep working afterwards.
const crypto = require("crypto");
const guard = require("./_guard.js");

const token = () => process.env.BLOB_READ_WRITE_TOKEN || "";
const blobOn = () => !!token();
// Required only when a store is configured, so a deployment without one never
// pays for loading it.
const sdk = () => require("@vercel/blob");

// One key for photos, derived from a secret the deployment already has, so
// there is no new credential for anyone to handle, paste or lose. It must be
// the same secret staff.js signs sessions with — see the warning above.
let KEY = null;
function key() {
  if (KEY) return KEY;
  const secret = process.env.STAFF_SECRET || process.env.ADMIN_KEY || "";
  if (!secret) return null;
  KEY = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("dermaluxe-photo-v1"), Buffer.from("clinical-photo"), 32));
  return KEY;
}

function encrypt(buf) {
  const k = key();
  if (!k) return { buf, enc: false };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const out = Buffer.concat([c.update(buf), c.final()]);
  return { buf: out, enc: true, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64") };
}

function decrypt(buf, rec) {
  if (!rec.enc) return buf;
  const k = key();
  if (!k) throw new Error("photo key unavailable");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(rec.iv, "base64"));
  d.setAuthTag(Buffer.from(rec.tag, "base64"));
  return Buffer.concat([d.update(buf), d.final()]);
}

async function blobPut(id, buf) {
  // A random suffix on top of a random id: the pathname is not derivable from
  // anything the clinic stores, even before the store's own access control.
  const r = await sdk().put(`ph/${id}.bin`, buf, {
    access: "private",
    addRandomSuffix: true,
    contentType: "application/octet-stream",
    cacheControlMaxAge: 0,
    token: token(),
  });
  if (!r || !r.pathname) throw new Error("blob put returned no pathname");
  return { url: r.url, path: r.pathname };
}

async function blobGet(rec) {
  const where = rec.path || rec.url;
  const r = await sdk().get(where, { access: "private", token: token(), useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) throw new Error("blob get " + ((r && r.statusCode) || "no body"));
  const parts = [];
  for await (const chunk of r.stream) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

async function blobDel(rec) {
  await sdk().del(rec.path || rec.url, { token: token() });
  return true;
}

// Store the bytes and hand back the part of the record that says where they
// went. A blob failure is never allowed to lose a photograph: it falls back to
// Redis and says so, and the storage panel shows how many landed which way.
async function put(cfg, id, buf, meta) {
  const e = encrypt(buf);
  // In practice unreachable: the same secret signs staff sessions, so without
  // it nobody can log in far enough to take a photo. Said out loud anyway,
  // because quietly storing a patient's photograph in the clear after
  // promising otherwise is not a thing to find out later. The storage panel
  // shows the same fact as "Encrypt ayyaya: Ledu".
  if (!e.enc) console.error("photo: NO ENCRYPTION KEY — storing in the clear");
  const base = { enc: e.enc, iv: e.iv, tag: e.tag, bytes: buf.length };
  if (blobOn()) {
    try {
      const at = await blobPut(id, e.buf);
      return Object.assign({ store: "blob" }, at, base);
    } catch (err) {
      console.error("photo: blob put failed, keeping it in kv —", err && err.message);
    }
  }
  await guard.kvCommand(cfg, ["SET", `ph:b:${id}`, e.buf.toString("base64"), "EX", String((meta && meta.ttl) || 400 * 86400)]);
  return Object.assign({ store: "kv" }, base);
}

// Read the bytes back, whichever of the three shapes the record is in: blob,
// the new Redis form, or the original record that carried its own base64.
async function get(cfg, id, rec) {
  if (rec.store === "blob" && (rec.path || rec.url)) return decrypt(await blobGet(rec), rec);
  if (rec.store === "kv") {
    const r = await guard.kvCommand(cfg, ["GET", `ph:b:${id}`]).catch(() => ({}));
    if (!r || !r.result) throw new Error("photo bytes missing");
    return decrypt(Buffer.from(r.result, "base64"), rec);
  }
  if (rec.b64) return Buffer.from(rec.b64, "base64");      // written before this file existed
  throw new Error("photo bytes missing");
}

async function del(cfg, id, rec) {
  if (rec && rec.store === "blob" && (rec.path || rec.url)) await blobDel(rec).catch(() => {});
  await guard.kvCommand(cfg, ["DEL", `ph:b:${id}`]).catch(() => {});
}

module.exports = { put, get, del, blobOn, encrypt, decrypt };

// ---- moving what is already in Redis -------------------------------------
// Photos written before blob storage existed carry their own base64 inside the
// record. This walks them a batch at a time and moves the bytes out, leaving
// the record — consent, who took it, when — exactly where it was. It is safe
// to run repeatedly: a record that has already moved is skipped, and a record
// is only rewritten after the new copy is readable back.
async function migrate(cfg, limit) {
  if (!blobOn()) return { ok: false, note: "blob storage not configured" };
  const max = Math.max(1, Math.min(50, Number(limit) || 20));
  let cursor = (await guard.kvCommand(cfg, ["GET", "ph:migrate:cursor"]).catch(() => ({})));
  cursor = (cursor && cursor.result) || "0";
  let moved = 0, skipped = 0, failed = 0, freed = 0;

  const scan = await guard.kvCommand(cfg, ["SCAN", cursor, "MATCH", "ph:img:*", "COUNT", "120"]).catch(() => ({}));
  const r = (scan && scan.result) || [];
  const next = Array.isArray(r) ? String(r[0]) : "0";
  const keys = Array.isArray(r) && Array.isArray(r[1]) ? r[1] : [];

  let stoppedEarly = false;
  for (const k of keys) {
    if (moved >= max) { stoppedEarly = true; break; }
    const id = String(k).slice("ph:img:".length);
    const got = await guard.kvCommand(cfg, ["GET", k]).catch(() => ({}));
    let rec = null; try { rec = JSON.parse((got && got.result) || ""); } catch (e) {}
    if (!rec) { skipped++; continue; }
    if (rec.store || !rec.b64) { skipped++; continue; }
    try {
      const raw = Buffer.from(rec.b64, "base64");
      const where = await put(cfg, id, raw, { ttl: 400 * 86400 });
      const check = await get(cfg, id, Object.assign({}, rec, where));
      if (!check.equals(raw)) throw new Error("read-back mismatch");
      const ttl = await guard.kvCommand(cfg, ["TTL", k]).catch(() => ({}));
      const secs = Number((ttl && ttl.result) || 0);
      const next2 = Object.assign({}, rec, where);
      delete next2.b64;
      const args = ["SET", k, JSON.stringify(next2)];
      if (secs > 0) args.push("EX", String(secs));
      await guard.kvCommand(cfg, args);
      freed += rec.b64.length;
      moved++;
    } catch (e) {
      console.error("photo migrate", id, e && e.message);
      failed++;
    }
  }
  // Only move the cursor on when this batch was finished. Stopping at the
  // limit and advancing anyway would walk past photos nobody ever comes back
  // for; re-scanning the same page costs a few skips instead.
  const save = stoppedEarly ? cursor : next;
  await guard.kvCommand(cfg, ["SET", "ph:migrate:cursor", save]).catch(() => {});
  return { ok: true, moved, skipped, failed, freedBytes: freed, cursor: save, done: !stoppedEarly && next === "0" };
}

// What the clinic is holding, for the storage card in the control panel.
const STAT_CAP = 900;                 // a panel figure is not worth a long walk
async function stats(cfg) {
  let cursor = "0", photos = 0, inKv = 0, inBlob = 0, legacy = 0, bytes = 0, rounds = 0;
  do {
    const scan = await guard.kvCommand(cfg, ["SCAN", cursor, "MATCH", "ph:img:*", "COUNT", "300"]).catch(() => ({}));
    const r = (scan && scan.result) || [];
    cursor = Array.isArray(r) ? String(r[0]) : "0";
    const keys = Array.isArray(r) && Array.isArray(r[1]) ? r[1] : [];
    for (const k of keys) {
      const got = await guard.kvCommand(cfg, ["GET", k]).catch(() => ({}));
      let rec = null; try { rec = JSON.parse((got && got.result) || ""); } catch (e) {}
      if (!rec) continue;
      photos++;
      if (rec.store === "blob") { inBlob++; bytes += Number(rec.bytes || 0); }
      else if (rec.store === "kv") { inKv++; bytes += Number(rec.bytes || 0); }
      else if (rec.b64) { legacy++; bytes += Math.floor(rec.b64.length * 0.75); }
    }
    rounds++;
  } while (cursor !== "0" && rounds < 40 && photos < STAT_CAP);
  return { photos, inBlob, inKv, legacy, bytes, blobOn: blobOn(), encrypted: !!key(), partial: cursor !== "0" };
}

module.exports.migrate = migrate;
module.exports.stats = stats;
