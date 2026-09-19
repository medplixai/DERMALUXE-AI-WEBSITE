// /api/stock — what is on the shelf, and what is about to run out.
//
// A skin clinic runs on consumables: PRP kits, laser cartridges, needles,
// peels, gloves, creams. Nothing counted any of it, so the only way to learn
// that the last PRP kit had gone was to reach for it with a patient already
// in the chair — and the only way to order in time was for somebody to
// remember.
//
// Deliberately small. Not a warehouse system: a list of things, how many are
// left, and the line below which somebody should be told. Every movement is
// written down with who did it, because "we had six of those" is an argument
// nobody should have to have.
//
// KV:
//   stk:item:<id>   one item
//   stk:list        item ids, newest first
//   stk:log         the last 200 movements
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
// Quantities can be halves — half a vial, half a box — but not nonsense.
const qty = (v) => Math.round((Number(v) || 0) * 100) / 100;
const UNITS = ["pcs", "box", "ml", "vial", "pack", "kit", "tube", "pair"];

const get = async (cfg, id) => parse((await guard.kvCommand(cfg, ["GET", `stk:item:${id}`]).catch(() => ({}))).result || "", null);

async function all(cfg) {
  const r = await guard.kvCommand(cfg, ["LRANGE", "stk:list", "0", "299"]).catch(() => ({}));
  const ids = r.result || [];
  if (!ids.length) return [];
  const rows = await guard.kvPipeline(cfg, ids.map((id) => ["GET", `stk:item:${id}`])).catch(() => []);
  return rows.map((x) => parse(x, null)).filter(Boolean);
}

const isLow = (it) => Number(it.low) > 0 && qty(it.qty) <= Number(it.low);

// Everything that moves is written down, with who moved it.
async function note(cfg, me, item, change, reason) {
  const rec = {
    ts: Date.now(), id: item.id, name: item.name,
    change, left: qty(item.qty), reason: clean(reason, 80),
    by: me.name, byPhone: me.phone,
  };
  await guard.kvPipeline(cfg, [
    ["LPUSH", "stk:log", JSON.stringify(rec)],
    ["LTRIM", "stk:log", "0", "199"],
  ]).catch(() => {});
  return rec;
}

// Who to tell, and only once a day per item, so a shelf that is low all week
// does not become a notification nobody reads.
async function warnIfLow(cfg, item) {
  if (!isLow(item)) return false;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const nx = await guard.kvCommand(cfg, ["SET", `stk:told:${item.id}:${day}`, "1", "NX", "EX", "172800"]).catch(() => ({}));
  if (!nx || !nx.result) return false;
  try {
    const push = require("./_push.js");
    if (push.enabled()) await push.notifyCap(cfg, "stock.edit", {
      title: `📦 ${item.name} aipotondi`,
      body: `${qty(item.qty)} ${item.unit} matrame migilindi. Order cheyyandi.`,
      tab: "stock", data: { kind: "stock" },
    });
  } catch (e) { console.error("stock: warn", e && e.message); }
  return true;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("stock.view")) return json(res, 403, { error: "Mee role ki stock chuse permission ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "list");
  if (req.method === "POST" && await guard.idem(cfg, b, res)) return json(res, 200, { ok: true, dup: true });

  if (a === "list") {
    const rl = await guard.rateLimit(cfg, `rl:stk:${me.phone}`, 300, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const rows = (await all(cfg)).map((it) => Object.assign({}, it, { low: Number(it.low) || 0, isLow: isLow(it) }));
    // Whatever is running out belongs at the top; the rest by name.
    rows.sort((x, y) => (y.isLow - x.isLow) || String(x.name).localeCompare(String(y.name)));
    const log = (await guard.kvCommand(cfg, ["LRANGE", "stk:log", "0", "29"]).catch(() => ({}))).result || [];
    return json(res, 200, {
      ok: true, rows,
      lowCount: rows.filter((r) => r.isLow).length,
      units: UNITS,
      log: log.map((x) => parse(x, null)).filter(Boolean),
      canEdit: allow("stock.edit"),
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (!allow("stock.edit")) return json(res, 403, { error: "Mee role ki stock marche permission ledu" });
  const rl = await guard.rateLimit(cfg, `rl:stkw:${me.phone}`, 300, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

  if (a === "add") {
    const name = clean(b.name, 60);
    if (!name) return json(res, 400, { error: "Peru ivvandi" });
    const it = {
      id: crypto.randomBytes(5).toString("hex"),
      name, unit: UNITS.includes(b.unit) ? b.unit : "pcs",
      qty: Math.max(0, qty(b.qty)), low: Math.max(0, qty(b.low)),
      note: clean(b.note, 120), ts: Date.now(), by: me.name, updatedAt: Date.now(),
    };
    const ok = await guard.kvWrite(cfg, ["SET", `stk:item:${it.id}`, JSON.stringify(it)], "stock item");
    if (!ok) return json(res, 500, { error: "Save avvaledu — malli try cheyandi" });
    await guard.kvCommand(cfg, ["LPUSH", "stk:list", it.id]).catch(() => {});
    await note(cfg, me, it, it.qty, "modati count");
    await warnIfLow(cfg, it);
    return json(res, 200, { ok: true, item: it });
  }

  const item = await get(cfg, clean(b.id, 24));
  if (!item) return json(res, 404, { error: "Aa item dorakaledu" });

  // Used one, received a box, or counted the shelf and found the number wrong.
  if (a === "move") {
    const change = qty(b.change);
    if (!change) return json(res, 400, { error: "Entha ani cheppandi" });
    const next = qty(item.qty + change);
    if (next < 0) return json(res, 400, { error: `Antha lev — ippudu ${qty(item.qty)} ${item.unit} matrame unnayi` });
    item.qty = next; item.updatedAt = Date.now(); item.by = me.name;
    const ok = await guard.kvWrite(cfg, ["SET", `stk:item:${item.id}`, JSON.stringify(item)], "stock move");
    if (!ok) return json(res, 500, { error: "Save avvaledu" });
    await note(cfg, me, item, change, b.reason || (change > 0 ? "vachindi" : "vaadaam"));
    const warned = await warnIfLow(cfg, item);
    return json(res, 200, { ok: true, item: Object.assign({}, item, { isLow: isLow(item) }), warned });
  }

  // A shelf count that disagrees with the number is the shelf being right.
  if (a === "count") {
    const found = qty(b.qty);
    if (found < 0) return json(res, 400, { error: "Sarpaina count ivvandi" });
    const change = qty(found - item.qty);
    item.qty = found; item.updatedAt = Date.now(); item.by = me.name;
    await guard.kvWrite(cfg, ["SET", `stk:item:${item.id}`, JSON.stringify(item)], "stock count");
    await note(cfg, me, item, change, "lekka chesam");
    await warnIfLow(cfg, item);
    return json(res, 200, { ok: true, item: Object.assign({}, item, { isLow: isLow(item) }) });
  }

  if (a === "edit") {
    if (b.name !== undefined) item.name = clean(b.name, 60) || item.name;
    if (b.unit !== undefined && UNITS.includes(b.unit)) item.unit = b.unit;
    if (b.low !== undefined) item.low = Math.max(0, qty(b.low));
    if (b.note !== undefined) item.note = clean(b.note, 120);
    item.updatedAt = Date.now();
    await guard.kvWrite(cfg, ["SET", `stk:item:${item.id}`, JSON.stringify(item)], "stock edit");
    await warnIfLow(cfg, item);
    return json(res, 200, { ok: true, item: Object.assign({}, item, { isLow: isLow(item) }) });
  }

  if (a === "remove") {
    await guard.kvPipeline(cfg, [
      ["DEL", `stk:item:${item.id}`],
      ["LREM", "stk:list", "1", item.id],
    ]).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
      ts: Date.now(), by: me.name, phone: me.phone,
      what: `Removed ${item.name} from the stock list (had ${qty(item.qty)} ${item.unit})`,
    })]).catch(() => {});
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Unknown action" });
};
module.exports.all = all;
module.exports.isLow = isLow;
