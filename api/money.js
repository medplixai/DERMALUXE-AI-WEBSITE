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
const notify = require("./_notify.js");
const pay = require("./_pay.js");

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
  { id: "lhr-face", name: "Laser hair removal — face", price: 2500, sessions: 6, gapDays: 30 },
  { id: "lhr-full", name: "Laser hair removal — full body", price: 12000, sessions: 6, gapDays: 30 },
  { id: "prp-hair", name: "PRP — hair", price: 5000, sessions: 6, gapDays: 30 },
  { id: "gfc-hair", name: "GFC — hair", price: 7000, sessions: 4, gapDays: 21 },
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
  // Somebody who pays more than the bill has given an advance — or somebody
  // typed an extra zero. Either way it must be visible: clamping the balance
  // at zero and saying nothing loses the money from every screen.
  return { total, paid, balance: Math.max(0, total - paid), advance: Math.max(0, paid - total) };
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
  if (req.method === "POST" && await guard.idem(cfg, b, res)) return json(res, 200, { ok: true, dup: true });

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
    const advance = bills.reduce((n, x) => n + (x.advance || 0), 0);
    return json(res, 200, { ok: true, bills, due, advance });
  }

  // The evening number: what came in today, split by how it was paid.
  if (a === "day") {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(q.day || "")) ? String(q.day) : istDay();
    const c = await collection(cfg, day, require("./_branch.js").scope(me, q));
    const close = parse(((await guard.kvCommand(cfg, ["GET", `cash:close:${day}`]).catch(() => ({}))) || {}).result || "", null);
    return json(res, 200, Object.assign({ ok: true, day, close }, c));
  }

  // Patients who say they have paid by UPI, waiting for somebody to check the bank.
  if (a === "claims") {
    const r = await guard.kvCommand(cfg, ["LRANGE", "pay:claims", "0", "99"]).catch(() => ({}));
    const rows = ((r && r.result) || []).map((x) => parse(x, null)).filter(Boolean);
    return json(res, 200, { ok: true, rows, upi: !!process.env.UPI_VPA, razorpay: pay.rzpOn() });
  }

  // The last fortnight of cash counts.
  if (a === "closes") {
    const r = await guard.kvCommand(cfg, ["LRANGE", "cash:closes", "0", "13"]).catch(() => ({}));
    const days = (r && r.result) || [];
    const rows = [];
    for (const d of days) {
      const c = parse(((await guard.kvCommand(cfg, ["GET", `cash:close:${d}`]).catch(() => ({}))) || {}).result || "", null);
      if (c) rows.push(c);
    }
    return json(res, 200, { ok: true, rows });
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
      if (!require("./_branch.js").keep(require("./_branch.js").scope(me, q))(bill)) continue;
      const lastRem = (bill.reminders || []).slice(-1)[0];
      rows.push({ id: bill.id, phone: bill.phone, name: bill.name, ts: bill.ts, total: t.total, paid: t.paid, balance: t.balance, reminded: lastRem ? lastRem.ts : 0 });
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
      gapDays: Number(x.gapDays) > 0 ? Math.min(120, Number(x.gapDays)) : undefined,
    })).filter((x) => x.name).slice(0, 120);
    if (!list.length) return json(res, 400, { error: "Kaneesam oka treatment kavali" });
    await guard.kvCommand(cfg, ["SET", "rate:card", JSON.stringify(list)]);
    return json(res, 200, { ok: true, rates: list });
  }

  if (!allow("money.bill")) return json(res, 403, { error: "Mee role ki bill chese permission ledu" });

  // A link the patient can pay from: the bill, a UPI QR for the balance, and
  // Razorpay when it is set up. Sent on WhatsApp when asked to.
  if (a === "paylink") {
    const bill = await getBill(cfg, clean(b.id, 12));
    if (!bill) return json(res, 404, { error: "Bill dorakaledu" });
    const t = totals(bill);
    if (t.balance <= 0) return json(res, 400, { error: "Ee bill ki baaki emi ledu" });
    if (!process.env.UPI_VPA && !pay.rzpOn()) return json(res, 501, { error: "UPI ID (UPI_VPA) inka set cheyaledu — Vercel lo pettali" });
    const url = pay.link(bill.id);
    let via = null;
    if (b.send) {
      const first = String(bill.name || "").trim().split(" ")[0] || "andi";
      const text = `Namaste ${first} garu 🙏\n\nDermaLuxe bill ${bill.id} — migilinadi *₹${t.balance.toLocaleString("en-IN")}*.\n\nIkkada nundi UPI lo pay cheyochu (GPay / PhonePe / Paytm):\n${url}\n\nDermaLuxe by Medicare, Eluru`;
      via = (await notify.sendWa(bill.phone, text).catch(() => false)) ? "message" : null;
      if (!via) {
        const r = await notify.sendWaTemplate(bill.phone, "clinic_update", [first, `Bill ${bill.id} lo ₹${t.balance.toLocaleString("en-IN")} migilindi. Online pay: ${url}`]).catch(() => ({ ok: false }));
        via = r && r.ok ? "template" : null;
      }
      if (!via) return json(res, 502, { error: "WhatsApp ki vellaledu — link copy chesi pampandi", url });
      bill.reminders = (bill.reminders || []).concat([{ ts: Date.now(), by: me.name, via: "paylink" }]).slice(-10);
      await putBill(cfg, bill).catch(() => {});
    }
    return json(res, 200, { ok: true, url, via, balance: t.balance });
  }

  // A patient's "I have paid" checked against the bank: record it, or turn it down.
  if (a === "claim-ok" || a === "claim-no") {
    const cid2 = clean(b.claim, 24);
    const r = await guard.kvCommand(cfg, ["LRANGE", "pay:claims", "0", "199"]).catch(() => ({}));
    const raw = ((r && r.result) || []).find((x) => (parse(x, {}) || {}).id === cid2);
    if (!raw) return json(res, 404, { error: "Ee claim dorakaledu — evaro ippatike chusaru" });
    const c = parse(raw, {});
    const gone = await guard.kvCommand(cfg, ["LREM", "pay:claims", "1", raw]).catch(() => ({}));
    if (!gone || !gone.result) return json(res, 409, { error: "Evaro ippatike chusaru" });
    if (a === "claim-no") {
      await audit(cfg, me, `UPI claim on ${c.bill} (₹${c.amount}, UTR ${c.ref}) turned down: ${clean(b.why, 80)}`);
      return json(res, 200, { ok: true });
    }
    const bill = await getBill(cfg, c.bill);
    if (!bill) return json(res, 404, { error: "Bill dorakaledu" });
    const amt = money(b.amount || c.amount);
    if (!(amt > 0)) return json(res, 400, { error: "Amount ivvandi" });
    const out = await recordPayment(cfg, bill, { amount: amt, mode: "upi", ref: clean(c.ref, 40), ts: c.ts, by: me.name });
    await audit(cfg, me, `UPI claim on ${c.bill} verified: ₹${amt} (UTR ${c.ref})`);
    return json(res, 200, { ok: true, bill: out });
  }

  // The day's cash, counted. Expected = what the float started at, plus cash
  // taken today, minus cash spent from the drawer. Counted is what is there.
  if (a === "close") {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || "")) ? String(b.day) : istDay();
    const counted = Number(b.counted);
    if (!isFinite(counted) || counted < 0) return json(res, 400, { error: "Drawer lo entha undo ivvandi" });
    const c = await collection(cfg, day);
    const float = money(b.float), spent = money(b.spent);
    const expected = float + c.byMode.cash - spent;
    const rec = { day, float, cashIn: c.byMode.cash, spent, expected, counted: Math.round(counted), diff: Math.round(counted) - expected,
      note: clean(b.note, 160), by: me.name, at: Date.now() };
    const prev = parse(((await guard.kvCommand(cfg, ["GET", `cash:close:${day}`]).catch(() => ({}))) || {}).result || "", null);
    if (prev) rec.redone = (prev.redone || 0) + 1;
    await guard.kvCommand(cfg, ["SET", `cash:close:${day}`, JSON.stringify(rec), "EX", String(400 * 86400)]);
    await guard.kvCommand(cfg, ["LREM", "cash:closes", "0", day]).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", "cash:closes", day]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "cash:closes", "0", "399"]).catch(() => {});
    await audit(cfg, me, `cash close ${day}: expected ₹${expected}, counted ₹${rec.counted}, diff ₹${rec.diff}`);
    if (rec.diff !== 0) {
      for (const ph of guard.ownerPhones()) {
        await notify.sendWa(ph, `💰 *Cash close — ${day}*\n\nUndalsindi ₹${expected.toLocaleString("en-IN")}\nDrawer lo ₹${rec.counted.toLocaleString("en-IN")}\n*Teda ₹${rec.diff.toLocaleString("en-IN")}*${rec.note ? "\n📝 " + rec.note : ""}\n\n— ${me.name}`).catch(() => {});
      }
    }
    return json(res, 200, { ok: true, close: rec });
  }

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
      note: clean(b.note, 200), branch: require("./_branch.js").pick(b.branch, me),
    };
    // who did the treatment — the doctor or therapist it is credited to
    const doneBy = digits10(b.doneBy);
    if (/^[6-9]\d{9}$/.test(doneBy)) { bill.doneBy = doneBy; bill.doneByName = clean(b.doneByName, 40); }
    // money first, paperwork after: an advance given at the desk is recorded
    // as part of the same action rather than a second step someone can forget
    const adv = money(b.paid);
    if (adv > 0) bill.payments.push({ amount: adv, mode: MODES.includes(b.mode) ? b.mode : "cash", ref: clean(b.ref, 40), ts: Date.now(), by: me.name, byPhone: me.phone });
    // An advance paid on WhatsApp to lock the slot (pay-hook) is part of this
    // bill — credited here, once, so the desk never has to remember it.
    try {
      const rows = ((await guard.kvCommand(cfg, ["LRANGE", `adv:${phone}`, "0", "19"]).catch(() => ({}))).result) || [];
      for (const raw of rows) {
        const a = parse(raw, null);
        if (!a || a.used || !(Number(a.amount) > 0)) continue;
        bill.payments.push({ amount: money(a.amount), mode: "upi", ref: `advance razorpay ${a.ref || ""}`.trim().slice(0, 40), ts: Number(a.ts) || Date.now(), by: "Razorpay", advance: true });
        await guard.kvCommand(cfg, ["LREM", `adv:${phone}`, "1", raw]).catch(() => {});
        await guard.kvCommand(cfg, ["LPUSH", `adv:${phone}`, JSON.stringify(Object.assign(a, { used: 1, bill: id }))]).catch(() => {});
      }
    } catch (e) { console.error("bill: advance", e && e.message); }
    await putBill(cfg, bill);
    const day = istDay();
    await guard.kvCommand(cfg, ["LPUSH", `bill:of:${phone}`, id]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", `bill:of:${phone}`, "0", "99"]).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", `bill:day:${day}`, id]).catch(() => {});
    await guard.kvCommand(cfg, ["EXPIRE", `bill:day:${day}`, String(400 * 86400)]).catch(() => {});
    const t = totals(bill);
    if (t.balance > 0) await guard.kvCommand(cfg, ["LPUSH", "bill:open", id]).catch(() => {});
    // A six-sitting laser sold here becomes a package here too, so nobody has
    // to remember a second step and the recall has something to fire from.
    let packages = [];
    try {
      const pkg = require("./package.js");
      packages = await pkg.fromBill(cfg, bill, await rates(cfg));
    } catch (e) { console.error("bill: package", e && e.message); }
    try { await require("./_memory.js").forget(cfg, phone); } catch (e) {}
    // Somebody who paid is the person the ads should be finding.
    try {
      require("./_capi.js").send("Purchase", { phone, eventId: "bill-" + id, custom: { value: t.total, currency: "INR", content_name: items.map((i) => i.name).join(", ").slice(0, 80) } }).catch(() => {});
    } catch (e) {}
    return json(res, 200, { ok: true, bill: Object.assign({}, bill, t), packages: packages.length });
  }

  // Money received against an existing bill.
  if (a === "pay") {
    const id = clean(b.id, 12);
    const bill = await getBill(cfg, id);
    if (!bill) return json(res, 404, { error: "Bill dorakaledu" });
    const amt = money(b.amount);
    if (!(amt > 0)) return json(res, 400, { error: "Amount ivvandi" });
    // taken offline and sent later: it belongs to the day it was taken
    const paidAt = guard.stamp(b.at, 3 * 86400000);
    bill.payments = (bill.payments || []).concat([{
      amount: amt, mode: MODES.includes(b.mode) ? b.mode : "cash",
      ref: clean(b.ref, 40), ts: paidAt, by: me.name, byPhone: me.phone,
    }]);
    await putBill(cfg, bill);
    const day = istDay(paidAt);
    await guard.kvCommand(cfg, ["LPUSH", `bill:day:${day}`, id]).catch(() => {});
    await guard.kvCommand(cfg, ["EXPIRE", `bill:day:${day}`, String(400 * 86400)]).catch(() => {});
    const t = totals(bill);
    if (t.balance <= 0) await guard.kvCommand(cfg, ["LREM", "bill:open", "1", id]).catch(() => {});
    return json(res, 200, { ok: true, bill: Object.assign({}, bill, t),
      warn: t.advance > 0 ? `₹${t.advance.toLocaleString("en-IN")} baaki kanna ekkuva teesukunnaru — advance ga undi` : undefined });
  }

  // Ask for money that is already owed.
  //
  // The balance sat on this screen and the patient was never told. Not a
  // demand — a line saying what is left, and that they can pay at the desk or
  // by UPI. Whoever sends it is recorded on the bill, so two people do not
  // send it twice in an afternoon.
  if (a === "remind") {
    if (!allow("money.bill")) return json(res, 403, { error: "Mee role ki idi chese permission ledu" });
    const id = clean(b.id, 12);
    const bill = await getBill(cfg, id);
    if (!bill) return json(res, 404, { error: "Bill dorakaledu" });
    const t = totals(bill);
    if (t.balance <= 0) return json(res, 400, { error: "Ee bill ki baaki emi ledu" });
    const out = await remindOne(cfg, bill, t, me.name);
    if (!out.sent) return json(res, 502, { error: "Pampaleka poyam — WhatsApp lo direct ga cheppandi" });
    return json(res, 200, { ok: true, via: out.via, bill: Object.assign({}, out.bill, totals(out.bill)) });
  }

  return json(res, 400, { error: "Unknown action" });
};

// What came in on one day, by how it was paid.
async function collection(cfg, day, branchScope) {
  const keepB = require("./_branch.js").keep(branchScope || null);
  const r = await guard.kvCommand(cfg, ["LRANGE", `bill:day:${day}`, "0", "299"]).catch(() => ({}));
  const seen = new Set(), rows = [];
  let collected = 0, billed = 0;
  const byMode = { cash: 0, upi: 0, card: 0, other: 0 };
  for (const id of (r.result || [])) {
    if (seen.has(id)) continue;
    seen.add(id);
    const bill = await getBill(cfg, id);
    if (!bill || !keepB(bill)) continue;
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
  return { collected, billed, byMode, payments: rows, count: rows.length };
}

// One payment onto a bill, filed under the day it was paid.
async function recordPayment(cfg, bill, p) {
  const ts = p.ts ? guard.stamp(p.ts, 7 * 86400000) : Date.now();
  bill.payments = (bill.payments || []).concat([{ amount: money(p.amount), mode: MODES.includes(p.mode) ? p.mode : "other", ref: clean(p.ref, 60), ts, by: p.by || "" }]);
  await putBill(cfg, bill);
  const day = istDay(ts);
  await guard.kvCommand(cfg, ["LPUSH", `bill:day:${day}`, bill.id]).catch(() => {});
  await guard.kvCommand(cfg, ["EXPIRE", `bill:day:${day}`, String(400 * 86400)]).catch(() => {});
  const t = totals(bill);
  if (t.balance <= 0) await guard.kvCommand(cfg, ["LREM", "bill:open", "1", bill.id]).catch(() => {});
  return Object.assign({}, bill, t);
}

async function audit(cfg, me, what) {
  await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({ ts: Date.now(), by: me.name, phone: me.phone, what: clean(what, 200) })]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "staff:audit", "0", "199"]).catch(() => {});
}

// One reminder, and the note on the bill that says it went.
async function remindOne(cfg, bill, t, byName) {
  const first = String(bill.name || "").trim().split(" ")[0] || "andi";
  const payUrl = (process.env.UPI_VPA || pay.rzpOn()) ? pay.link(bill.id) : "";
  const text = `Namaste ${first} garu 🙏\n\nDermaLuxe lo mee bill ${bill.id} — mottam ₹${t.total.toLocaleString("en-IN")}, ippati varaku ₹${t.paid.toLocaleString("en-IN")} chellinchaaru.\n\n*Migilinadi ₹${t.balance.toLocaleString("en-IN")}.*\n\nMeeru clinic ki vachinappudu ivvochu, leda UPI lo kuda pampochu.${payUrl ? "\n\n📲 Online pay: " + payUrl : ""} Emaina doubt unte ee message ki reply cheyandi 😊\n\nDermaLuxe by Medicare, Eluru`;
  let via = "message";
  let sent = await notify.sendWa(bill.phone, text).catch(() => false);
  if (!sent) {
    const r = await notify.sendWaTemplate(bill.phone, "clinic_update", [first,
      `Mee bill ${bill.id} lo ₹${t.balance.toLocaleString("en-IN")} migilindi. Clinic lo leda UPI lo ivvochu.`]).catch(() => ({ ok: false }));
    sent = !!(r && r.ok); via = "template";
  }
  if (!sent) return { sent: false };
  bill.reminders = (bill.reminders || []).concat([{ ts: Date.now(), by: byName || "auto", via }]).slice(-10);
  await putBill(cfg, bill).catch(() => {});
  return { sent: true, via, bill };
}

// Everyone who still owes something and has not been asked lately.
// Deliberately gentle: nothing under a few days old, nothing more than once a
// week, and only a handful a day so it never looks like a debt collector.
async function dueForReminder(cfg, opts) {
  const minAgeDays = Number((opts && opts.minAgeDays) != null ? opts.minAgeDays : 3);
  const everyDays = Number((opts && opts.everyDays) || 7);
  const now = Date.now();
  const r = await guard.kvCommand(cfg, ["LRANGE", "bill:open", "0", "299"]).catch(() => ({}));
  const rows = [];
  for (const id of (r.result || [])) {
    const bill = await getBill(cfg, id);
    if (!bill || !bill.phone) continue;
    const t = totals(bill);
    if (t.balance <= 0) continue;
    if (now - (bill.ts || 0) < minAgeDays * 86400000) continue;
    const last = (bill.reminders || []).slice(-1)[0];
    if (last && now - last.ts < everyDays * 86400000) continue;
    rows.push({ bill, t });
  }
  rows.sort((x, y) => y.t.balance - x.t.balance);
  return rows;
}
module.exports.remindOne = remindOne;
module.exports.dueForReminder = dueForReminder;
module.exports.istDay = istDay;
module.exports.totals = totals;
module.exports.recordPayment = recordPayment;
module.exports.getBill = getBill;
module.exports.collection = collection;
