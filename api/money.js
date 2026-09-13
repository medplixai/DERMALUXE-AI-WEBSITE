// /api/money — what the clinic charged, what it collected, what is still owed.
//
// Everything here is staff-only. Treatment prices never appear on the website
// or in anything the patient agent says; the rate card exists so reception can
// raise a bill without asking someone, and so the evening report can say a
// real number instead of a guess.
//
// KV:
//   rate:card                 the price list (owner-edited)
//   bill:<id>                 one bill: items, total, payments, balance
//   bill:of:<phone>           that person's bill ids, newest first
//   bill:day:<YYYY-MM-DD>     bill ids touched that day (for the collection)
//   bill:seq                  running number for the bill id
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const money = (v) => Math.max(0, Math.round(Number(v) || 0));
const MODES = ["cash", "upi", "card", "other"];
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

// Day boundaries in IST, because the clinic's day is not UTC's.
function istDay(ts) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ts || Date.now()));
}

const DEFAULT_RATES = [
  { id: "consult", name: "Consultation", price: 500 },
  { id: "skin-analysis", name: "Skin & hair analysis", price: 1000 },
  { id: "hydrafacial", name: "HydraFacial", price: 3500 },
  { id: "peel", name: "Chemical peel", price: 2500 },
  { id: "lhr-face", name: "Laser hair removal — face", price: 2500, sessions: 6 },
  { id: "lhr-full", name: "Laser hair removal — full body", price: 12000, sessions: 6 },
  { id: "prp-hair", name: "PRP — hair", price: 5000, sessions: 6 },
  { id: "gfc-hair", name: "GFC — hair", price: 7000, sessions: 4 },
  { id: "acne", name: "Acne treatment — sitting", price: 2000 },
  { id: "pigmentation", name: "Pigmentation — sitting", price: 3000 },
];

async function rates(cfg) {
  const r = await guard.kvCommand(cfg, ["GET", "rate:card"]).catch(() => ({}));
  const saved = parse((r && r.result) || "", null);
  return Array.isArray(saved) && saved.length ? saved : DEFAULT_RATES;
}
const getBill = async (cfg, id) => parse((await guard.kvCommand(cfg, ["GET", `bill:${id}`]).catch(() => ({}))).result || "", null);
async function putBill(cfg, b) {
  const r = await guard.kvCommand(cfg, ["SET", `bill:${b.id}`, JSON.stringify(b)]);
  if (!r || r.error) throw new Error("Bill save avvaledu — malli try cheyandi");
  return b;
}

function totals(b) {
  const total = (b.items || []).reduce((n, i) => n + money(i.price) * Math.max(1, Number(i.qty || 1)), 0);
  const paid = (b.payments || []).reduce((n, p) => n + money(p.amount), 0);
  return { total, paid, balance: Math.max(0, total - paid) };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "day");

  // ---- reads ----
  if (a === "rates") {
    return json(res, 200, { ok: true, rates: await rates(cfg), canEdit: allow("settings.manage") });
  }

  if (!allow("money.view")) return json(res, 403, { error: "Mee role ki money access ledu" });

  // One person's bills and what they still owe.
  if (a === "of") {
    const phone = digits10(q.phone || b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const r = await guard.kvCommand(cfg, ["LRANGE", `bill:of:${phone}`, "0", "49"]).catch(() => ({}));
    const bills = [];
    for (const id of (r.result || [])) {
      const bill = await getBill(cfg, id);
      if (bill) bills.push(Object.assign({}, bill, totals(bill)));
    }
    const due = bills.reduce((n, x) => n + x.balance, 0);
    return json(res, 200, { ok: true, bills, due });
  }

  // The evening number: what came in today, split by how it was paid.
  if (a === "day") {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(q.day || "")) ? String(q.day) : istDay();
    const r = await guard.kvCommand(cfg, ["LRANGE", `bill:day:${day}`, "0", "299"]).catch(() => ({}));
    const seen = new Set(), rows = [];
    let collected = 0, billed = 0;
    const byMode = { cash: 0, upi: 0, card: 0, other: 0 };
    for (const id of (r.result || [])) {
      if (seen.has(id)) continue;
      seen.add(id);
      const bill = await getBill(cfg, id);
      if (!bill) continue;
      const t = totals(bill);
      if (istDay(bill.ts) === day) billed += t.total;
      for (const p of (bill.payments || [])) {
        if (istDay(p.ts) !== day) continue;
        const amt = money(p.amount);
        collected += amt;
        byMode[MODES.includes(p.mode) ? p.mode : "other"] += amt;
        rows.push({ billId: bill.id, phone: bill.phone, name: bill.name, amount: amt, mode: p.mode, ref: p.ref, by: p.by, ts: p.ts });
      }
    }
    rows.sort((x, y) => y.ts - x.ts);
    return json(res, 200, { ok: true, day, collected, billed, byMode, payments: rows, count: rows.length });
  }

  // Everyone who still owes something, biggest first.
  if (a === "dues") {
    const r = await guard.kvCommand(cfg, ["LRANGE", "bill:open", "0", "299"]).catch(() => ({}));
    const rows = [];
    for (const id of (r.result || [])) {
      const bill = await getBill(cfg, id);
      if (!bill) continue;
      const t = totals(bill);
      if (t.balance <= 0) { await guard.kvCommand(cfg, ["LREM", "bill:open", "1", id]).catch(() => {}); continue; }
      rows.push({ id: bill.id, phone: bill.phone, name: bill.name, ts: bill.ts, total: t.total, paid: t.paid, balance: t.balance });
    }
    rows.sort((x, y) => y.balance - x.balance);
    return json(res, 200, { ok: true, rows, due: rows.reduce((n, x) => n + x.balance, 0) });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rl = await guard.rateLimit(cfg, `rl:mn:${me.phone}`, 300, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

  // The owner keeps the price list; nobody else can move a price.
  if (a === "rates-save") {
    if (!allow("settings.manage")) return json(res, 403, { error: "Prices marchagaligedi owner matrame" });
    const list = (Array.isArray(b.rates) ? b.rates : []).map((x) => ({
      id: clean(x.id, 32).toLowerCase().replace(/[^a-z0-9-]/g, "") || crypto.randomBytes(3).toString("hex"),
      name: clean(x.name, 60),
      price: money(x.price),
      sessions: Number(x.sessions) > 1 ? Math.min(24, Number(x.sessions)) : undefined,
    })).filter((x) => x.name).slice(0, 120);
    if (!list.length) return json(res, 400, { error: "Kaneesam oka treatment kavali" });
    await guard.kvCommand(cfg, ["SET", "rate:card", JSON.stringify(list)]);
    return json(res, 200, { ok: true, rates: list });
  }

  if (!allow("money.bill")) return json(res, 403, { error: "Mee role ki bill chese permission ledu" });

  // A bill: what was done, and what it costs.
  if (a === "bill") {
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({
      name: clean(i.name, 60), price: money(i.price), qty: Math.max(1, Math.min(50, Number(i.qty || 1))),
    })).filter((i) => i.name && i.price >= 0).slice(0, 30);
    if (!items.length) return json(res, 400, { error: "Kaneesam oka item kavali" });

    const seq = await guard.kvCommand(cfg, ["INCR", "bill:seq"]).catch(() => ({}));
    const id = "B" + String(1000 + Number((seq && seq.result) || Math.floor(Math.random() * 8999) + 1)).slice(-5);
    const bill = {
      id, phone, name: clean(b.name, 80) || "Patient",
      items, payments: [], ts: Date.now(), by: me.name, byPhone: me.phone,
      note: clean(b.note, 200),
    };
    // money first, paperwork after: an advance given at the desk is recorded
    // as part of the same action rather than a second step someone can forget
    const adv = money(b.paid);
    if (adv > 0) bill.payments.push({ amount: adv, mode: MODES.includes(b.mode) ? b.mode : "cash", ref: clean(b.ref, 40), ts: Date.now(), by: me.name });
    await putBill(cfg, bill);
    const day = istDay();
    await guard.kvCommand(cfg, ["LPUSH", `bill:of:${phone}`, id]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", `bill:of:${phone}`, "0", "99"]).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", `bill:day:${day}`, id]).catch(() => {});
    await guard.kvCommand(cfg, ["EXPIRE", `bill:day:${day}`, String(400 * 86400)]).catch(() => {});
    const t = totals(bill);
    if (t.balance > 0) await guard.kvCommand(cfg, ["LPUSH", "bill:open", id]).catch(() => {});
    return json(res, 200, { ok: true, bill: Object.assign({}, bill, t) });
  }

  // Money received against an existing bill.
  if (a === "pay") {
    const id = clean(b.id, 12);
    const bill = await getBill(cfg, id);
    if (!bill) return json(res, 404, { error: "Bill dorakaledu" });
    const amt = money(b.amount);
    if (!(amt > 0)) return json(res, 400, { error: "Amount ivvandi" });
    bill.payments = (bill.payments || []).concat([{
      amount: amt, mode: MODES.includes(b.mode) ? b.mode : "cash",
      ref: clean(b.ref, 40), ts: Date.now(), by: me.name,
    }]);
    await putBill(cfg, bill);
    const day = istDay();
    await guard.kvCommand(cfg, ["LPUSH", `bill:day:${day}`, id]).catch(() => {});
    await guard.kvCommand(cfg, ["EXPIRE", `bill:day:${day}`, String(400 * 86400)]).catch(() => {});
    const t = totals(bill);
    if (t.balance <= 0) await guard.kvCommand(cfg, ["LREM", "bill:open", "1", id]).catch(() => {});
    return json(res, 200, { ok: true, bill: Object.assign({}, bill, t) });
  }

  return json(res, 400, { error: "Unknown action" });
};
module.exports.istDay = istDay;
module.exports.totals = totals;
