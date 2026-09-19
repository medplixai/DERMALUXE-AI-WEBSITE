// /api/expense — what the clinic spends, and therefore what it keeps.
//
// Money has only ever counted what comes in. The evening report could say
// what was collected and the dashboard could say what is owed, but nobody
// could answer the question the owner actually has at the end of a month:
// after everything, what is left?
//
// So: the other side of the ledger. Consumables, rent, salaries, ads,
// electricity — whatever was paid out, by whom, under a heading. Nothing is
// estimated and nothing is imported; it is typed in as it happens, the same
// way a bill is.
//
// Staff-only, like the rate card. None of this reaches a patient or the site.
//
// KV:
//   exp:<id>                one expense
//   exp:day:<YYYY-MM-DD>    that day's expense ids
//   exp:m:<YYYY-MM>         that month's expense ids
//   exp:cats                the headings (owner-edited)
//   exp:seq                 running number
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");
const money = require("./money.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const rupees = (v) => Math.max(0, Math.round(Number(v) || 0));
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const MODES = ["cash", "upi", "card", "bank", "other"];

const istDay = money.istDay;
const istMonth = (ts) => istDay(ts).slice(0, 7);

// Headings a skin clinic actually spends under. The owner can change them.
const DEFAULT_CATS = [
  "Consumables", "Medicines & products", "Salaries", "Rent",
  "Electricity & water", "Marketing & ads", "Equipment & repairs",
  "Housekeeping", "Travel", "Government & licences", "Other",
];

async function cats(cfg) {
  const r = await guard.kvCommand(cfg, ["GET", "exp:cats"]).catch(() => ({}));
  const saved = parse((r && r.result) || "", null);
  return Array.isArray(saved) && saved.length ? saved : DEFAULT_CATS;
}

// Read a list of expense ids into the expenses themselves, in one trip.
async function readMany(cfg, ids) {
  if (!ids.length) return [];
  const rows = await guard.kvPipeline(cfg, ids.map((id) => ["GET", `exp:${id}`])).catch(() => []);
  return rows.map((x) => parse(x, null)).filter(Boolean);
}

const sum = (rows) => rows.reduce((n, x) => n + rupees(x.amount), 0);
function byCategory(rows) {
  const out = {};
  for (const x of rows) out[x.category || "Other"] = (out[x.category || "Other"] || 0) + rupees(x.amount);
  return Object.entries(out).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

// What came in over a stretch of days. The bills are already indexed by day,
// so this is that index read in one go rather than a walk.
async function collectedOver(cfg, days) {
  const lists = await guard.kvPipeline(cfg, days.map((d) => ["LRANGE", `bill:day:${d}`, "0", "299"])).catch(() => []);
  const ids = new Set();
  for (const l of lists) for (const id of (Array.isArray(l) ? l : [])) ids.add(id);
  if (!ids.size) return 0;
  const bills = await guard.kvPipeline(cfg, [...ids].map((id) => ["GET", `bill:${id}`])).catch(() => []);
  const inWindow = new Set(days);
  let total = 0;
  for (const raw of bills) {
    const bill = parse(raw, null);
    if (!bill) continue;
    for (const p of (bill.payments || [])) {
      if (inWindow.has(istDay(p.ts))) total += rupees(p.amount);
    }
  }
  return total;
}

function daysOfMonth(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = istDay();
  const out = [];
  for (let i = 1; i <= last; i++) {
    const d = `${month}-${String(i).padStart(2, "0")}`;
    if (d <= today) out.push(d);              // nothing from the future
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("money.expense")) return json(res, 403, { error: "Mee role ki kharchulu chuse permission ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "summary");
  if (req.method === "POST" && await guard.idem(cfg, b, res)) return json(res, 200, { ok: true, dup: true });

  // Today, this month, and what is left after both.
  if (a === "summary") {
    const rl = await guard.rateLimit(cfg, `rl:exp:${me.phone}`, 300, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

    const today = istDay(), month = istMonth();
    const [dayIds, monthIds] = await guard.kvPipeline(cfg, [
      ["LRANGE", `exp:day:${today}`, "0", "199"],
      ["LRANGE", `exp:m:${month}`, "0", "999"],
    ]).catch(() => [[], []]);

    const dayRows = await readMany(cfg, Array.isArray(dayIds) ? dayIds : []);
    const monthRows = await readMany(cfg, Array.isArray(monthIds) ? monthIds : []);

    const [inToday, inMonth] = await Promise.all([
      collectedOver(cfg, [today]),
      collectedOver(cfg, daysOfMonth(month)),
    ]);

    const outToday = sum(dayRows), outMonth = sum(monthRows);
    return json(res, 200, {
      ok: true, today, month,
      day: { collected: inToday, spent: outToday, left: inToday - outToday, rows: dayRows.sort((x, y) => y.ts - x.ts) },
      // "left" is collection minus spending over the same days. It is not
      // accounting profit — no depreciation, no tax, nothing accrued — and
      // the screen says so rather than letting the word do quiet work.
      monthly: { collected: inMonth, spent: outMonth, left: inMonth - outMonth, count: monthRows.length, byCategory: byCategory(monthRows) },
      cats: await cats(cfg),
      canEdit: allow("money.expense"),
    });
  }

  // Profit and loss for a month, beside the month before. Money in is what
  // was collected (not billed); money out is what was written down as spent.
  // Treatments are what was billed that month, by line. It is a cash view —
  // the screen says so — not an accountant's P&L.
  if (a === "pnl") {
    if (!allow("money.view")) return json(res, 403, { error: "Mee role ki idi chuse permission ledu" });
    const rl = await guard.rateLimit(cfg, `rl:pnl:${me.phone}`, 60, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const m = /^\d{4}-\d{2}$/.test(String(q.month || "")) ? String(q.month) : istMonth();
    const [y, mo] = m.split("-").map(Number);
    const prev = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
    const [cur, before] = await Promise.all([monthPnl(cfg, m, true), monthPnl(cfg, prev, false)]);
    const pct = (a2, b2) => (b2 ? Math.round(((a2 - b2) / Math.abs(b2)) * 100) : null);
    return json(res, 200, { ok: true, month: m, prev, cur, before,
      change: { collected: pct(cur.collected, before.collected), spent: pct(cur.spent, before.spent), profit: pct(cur.profit, before.profit) } });
  }

  if (a === "month") {
    const m = /^\d{4}-\d{2}$/.test(String(q.month || "")) ? String(q.month) : istMonth();
    const ids = (await guard.kvCommand(cfg, ["LRANGE", `exp:m:${m}`, "0", "999"]).catch(() => ({}))).result || [];
    const rows = await readMany(cfg, ids);
    return json(res, 200, { ok: true, month: m, rows: rows.sort((x, y) => y.ts - x.ts), total: sum(rows), byCategory: byCategory(rows) });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rl = await guard.rateLimit(cfg, `rl:expw:${me.phone}`, 200, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

  if (a === "add") {
    const amount = rupees(b.amount);
    if (!(amount > 0)) return json(res, 400, { error: "Amount ivvandi" });
    const category = clean(b.category, 40) || "Other";
    const at = Number(b.at) > 0 ? Number(b.at) : Date.now();
    // Yesterday's bill can be entered today; next month's cannot.
    if (at > Date.now() + 86400000) return json(res, 400, { error: "Munduku date ivvalemu" });

    const seq = await guard.kvCommand(cfg, ["INCR", "exp:seq"]).catch(() => ({}));
    const id = "E" + String(1000 + Number((seq && seq.result) || Math.floor(Math.random() * 8999) + 1)).slice(-5) +
      crypto.randomBytes(2).toString("hex");
    const row = {
      id, amount, category,
      note: clean(b.note, 140), vendor: clean(b.vendor, 60),
      mode: MODES.includes(b.mode) ? b.mode : "cash",
      ts: at, by: me.name, byPhone: me.phone, enteredAt: Date.now(),
    };
    const day = istDay(at), month = istMonth(at);
    const ok = await guard.kvWrite(cfg, ["SET", `exp:${id}`, JSON.stringify(row)], "expense");
    if (!ok) return json(res, 500, { error: "Save avvaledu — malli try cheyandi" });
    await guard.kvPipeline(cfg, [
      ["LPUSH", `exp:day:${day}`, id],
      ["EXPIRE", `exp:day:${day}`, String(400 * 86400)],
      ["LPUSH", `exp:m:${month}`, id],
    ]).catch(() => {});
    return json(res, 200, { ok: true, expense: row });
  }

  if (a === "delete") {
    const id = clean(b.id, 24);
    const raw = (await guard.kvCommand(cfg, ["GET", `exp:${id}`]).catch(() => ({}))).result;
    const row = parse(raw, null);
    if (!row) return json(res, 404, { error: "Aa kharchu dorakaledu" });
    const day = istDay(row.ts), month = istMonth(row.ts);
    await guard.kvPipeline(cfg, [
      ["DEL", `exp:${id}`],
      ["LREM", `exp:day:${day}`, "1", id],
      ["LREM", `exp:m:${month}`, "1", id],
    ]).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
      ts: Date.now(), by: me.name, phone: me.phone,
      what: `Deleted an expense: ${row.category} ₹${row.amount} of ${istDay(row.ts)}`,
    })]).catch(() => {});
    return json(res, 200, { ok: true });
  }

  // The headings are the owner's, like the rate card.
  if (a === "cats-save") {
    if (!allow("settings.manage")) return json(res, 403, { error: "Headings marchagaligedi owner matrame" });
    const list = (Array.isArray(b.cats) ? b.cats : []).map((x) => clean(x, 40)).filter(Boolean).slice(0, 40);
    if (!list.length) return json(res, 400, { error: "Kaneesam oka heading kavali" });
    await guard.kvCommand(cfg, ["SET", "exp:cats", JSON.stringify(list)]);
    return json(res, 200, { ok: true, cats: list });
  }

  return json(res, 400, { error: "Unknown action" });
};
async function monthPnl(cfg, m, detail) {
  const days = daysOfMonth(m);
  const lists = await guard.kvPipeline(cfg, days.map((d) => ["LRANGE", `bill:day:${d}`, "0", "299"])).catch(() => []);
  const ids = new Set();
  for (const l of lists) for (const id of (Array.isArray(l) ? l : [])) ids.add(id);
  const bills = ids.size ? (await guard.kvPipeline(cfg, [...ids].map((id) => ["GET", `bill:${id}`])).catch(() => [])).map((x) => parse(x, null)).filter(Boolean) : [];
  const inMonth = new Set(days);
  let collected = 0, billed = 0;
  const byMode = {}, byDay = {}, byTreat = {};
  const payers = new Set();
  for (const bill of bills) {
    for (const p of (bill.payments || [])) {
      const d = istDay(p.ts);
      if (!inMonth.has(d)) continue;
      const amt = rupees(p.amount);
      collected += amt;
      byMode[p.mode || "other"] = (byMode[p.mode || "other"] || 0) + amt;
      byDay[d] = byDay[d] || { day: d, in: 0, out: 0 };
      byDay[d].in += amt;
      payers.add(bill.phone);
    }
    if (inMonth.has(istDay(bill.ts))) {
      for (const it of (bill.items || [])) {
        const v = rupees(it.price) * Math.max(1, Number(it.qty || 1));
        billed += v;
        const t = byTreat[it.name] || (byTreat[it.name] = { name: it.name, count: 0, value: 0 });
        t.count += Math.max(1, Number(it.qty || 1)); t.value += v;
      }
    }
  }
  const eIds = (await guard.kvCommand(cfg, ["LRANGE", `exp:m:${m}`, "0", "999"]).catch(() => ({}))).result || [];
  const exp = await readMany(cfg, eIds);
  for (const x of exp) {
    const d = istDay(x.ts);
    byDay[d] = byDay[d] || { day: d, in: 0, out: 0 };
    byDay[d].out += rupees(x.amount);
  }
  const spent = sum(exp);
  const out = { month: m, collected, billed, spent, profit: collected - spent,
    margin: collected ? Math.round(((collected - spent) / collected) * 100) : null, patients: payers.size };
  if (detail) Object.assign(out, {
    byMode, byCategory: byCategory(exp),
    treatments: Object.values(byTreat).sort((a, b) => b.value - a.value).slice(0, 15),
    days: days.map((d) => byDay[d] || { day: d, in: 0, out: 0 }),
  });
  return out;
}

module.exports.monthPnl = monthPnl;
module.exports.istMonth = istMonth;
module.exports.collectedOver = collectedOver;
module.exports.daysOfMonth = daysOfMonth;
