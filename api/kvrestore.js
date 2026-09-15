// /api/kvrestore — see the backups, and put one back.
//
// A backup nobody can restore is a story people tell themselves. This is the
// other half: it lists what exists, and on a separate, explicit request it
// writes one night's copy back into the live store.
//
// Restoring is not a thing to do by accident, so it needs the owner, the
// exact date, and that date typed again as confirmation.
//
// What it does, exactly, because the difference matters: a key the backup
// does not mention is left alone — a bill raised this morning survives. But a
// key the backup DOES hold is replaced whole, and the leads live in one key.
// So restoring last night's copy gives back last night's leads and drops any
// that arrived since. That is the right trade when the list is gone and the
// wrong one when it is merely wrong, so the screen says it in those words
// before the owner types the date a second time.
const guard = require("./_guard.js");
const staff = require("./staff.js");
const store = require("./_photo-store.js");
const backup = require("./cron-backup.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const sdk = () => require("@vercel/blob");
const token = () => process.env.BLOB_READ_WRITE_TOKEN || "";

async function readBackup(day) {
  const r = await sdk().get(`${backup.PREFIX}${day}.json`, { access: "private", token: token(), useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) throw new Error("Aa roju backup dorakaledu");
  const parts = [];
  for await (const c of r.stream) parts.push(Buffer.from(c));
  const wrap = JSON.parse(Buffer.concat(parts).toString("utf8"));
  const plain = store.decrypt(Buffer.from(wrap.data, "base64"), wrap);
  return JSON.parse(plain.toString("utf8"));
}

// Turn one stored key back into the commands that recreate it.
function writeCmds(row) {
  const out = [["DEL", row.k]];
  if (row.t === "string") {
    if (row.v == null) return [];
    out.push(["SET", row.k, String(row.v)]);
  } else if (row.t === "list") {
    const items = row.v || [];
    if (!items.length) return [];
    for (let i = 0; i < items.length; i += 200) out.push(["RPUSH", row.k].concat(items.slice(i, i + 200).map(String)));
  } else if (row.t === "hash") {
    const flat = [];
    if (Array.isArray(row.v)) flat.push(...row.v.map(String));
    else for (const [f, v] of Object.entries(row.v || {})) flat.push(String(f), String(v));
    if (!flat.length) return [];
    for (let i = 0; i < flat.length; i += 400) out.push(["HSET", row.k].concat(flat.slice(i, i + 400)));
  } else if (row.t === "set") {
    const items = row.v || [];
    if (!items.length) return [];
    for (let i = 0; i < items.length; i += 200) out.push(["SADD", row.k].concat(items.slice(i, i + 200).map(String)));
  } else return [];
  if (Number(row.pttl) > 0) out.push(["PEXPIRE", row.k, String(Math.floor(Number(row.pttl)))]);
  return out;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  if (!auth.allow("settings.manage")) return json(res, 403, { error: "Idi owner ki matrame" });
  if (!token()) return json(res, 501, { error: "Blob storage set cheyaledu — backups ekkada ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "list");

  if (a === "list") {
    const list = await sdk().list({ prefix: backup.PREFIX, token: token(), limit: 60 }).catch(() => ({ blobs: [] }));
    const rows = (list.blobs || []).map((x) => ({
      day: String(x.pathname).slice(backup.PREFIX.length).replace(/\.json$/, ""),
      bytes: x.size, at: x.uploadedAt,
    })).sort((x, y) => (x.day < y.day ? 1 : -1));
    let last = null;
    const r = await guard.kvCommand(cfg, ["GET", "backup:last"]).catch(() => ({}));
    try { last = JSON.parse(r.result); } catch (e) {}
    return json(res, 200, { ok: true, backups: rows, last });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });

  // Look inside one without changing anything — how many keys, how many
  // leads, when it was taken. Worth seeing before deciding.
  if (a === "peek") {
    const day = String(b.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json(res, 400, { error: "Date ivvandi (YYYY-MM-DD)" });
    let doc;
    try { doc = await readBackup(day); }
    catch (e) { return json(res, 404, { error: String((e && e.message) || e).slice(0, 200) }); }
    const counts = {};
    for (const row of doc.keys) counts[row.t] = (counts[row.t] || 0) + 1;
    const leads = (doc.keys.find((x) => x.k === "dl_leads") || {}).v;
    const live = await guard.kvCommand(cfg, ["LLEN", "dl_leads"]).catch(() => ({}));
    return json(res, 200, {
      ok: true, day, made: doc.made, keys: doc.count, byType: counts,
      leads: Array.isArray(leads) ? leads.length : 0,
      leadsNow: Number((live && live.result) || 0),
    });
  }

  // Take one now rather than waiting for tonight — useful before anything
  // risky, and the only way to know the nightly job works without waiting
  // for the night.
  if (a === "run") {
    const day = backup.istDay();
    try {
      const made = await backup.writeBackup(cfg, day);
      await guard.kvCommand(cfg, ["SET", "backup:last", JSON.stringify({ day, at: Date.now(), keys: made.keys, bytes: made.bytes })]).catch(() => {});
      return json(res, 200, Object.assign({ ok: true, day }, made));
    } catch (e) {
      console.error("backup now", e && e.message);
      return json(res, 500, { error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  if (a === "restore") {
    const day = String(b.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json(res, 400, { error: "Date ivvandi (YYYY-MM-DD)" });
    if (String(b.confirm || "") !== day) {
      return json(res, 400, { error: "Confirm cheyyadaniki aa date ne malli type cheyyandi" });
    }
    let doc;
    try { doc = await readBackup(day); }
    catch (e) { return json(res, 404, { error: String((e && e.message) || e).slice(0, 200) }); }

    const cmds = [];
    for (const row of doc.keys) cmds.push(...writeCmds(row));
    // What the owner is about to lose, counted before it goes.
    const nowLeads = await guard.kvCommand(cfg, ["LLEN", "dl_leads"]).catch(() => ({}));
    const thenLeads = (doc.keys.find((x) => x.k === "dl_leads") || {}).v;
    let done = 0;
    for (let i = 0; i < cmds.length; i += 200) {
      await guard.kvPipeline(cfg, cmds.slice(i, i + 200));
      done += Math.min(200, cmds.length - i);
    }
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
      ts: Date.now(), by: auth.me.name, phone: auth.me.phone,
      what: `RESTORED the database from the ${day} backup (${doc.count} keys)`,
    })]).catch(() => {});
    console.log("RESTORE from", day, doc.count, "keys by", auth.me.phone.slice(-4));
    const lost = Math.max(0, Number((nowLeads && nowLeads.result) || 0) - (Array.isArray(thenLeads) ? thenLeads.length : 0));
    return json(res, 200, { ok: true, day, keys: doc.count, commands: done, leadsLost: lost });
  }

  return json(res, 400, { error: "Unknown action" });
};
