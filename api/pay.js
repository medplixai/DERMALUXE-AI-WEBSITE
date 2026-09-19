// /api/pay — the patient's side of a bill link. Public on purpose: the
// patient has no login. The link carries an HMAC of the bill id (see
// _pay.js), so bill numbers cannot be guessed and walked, and what comes
// back is a first name, the items and the balance — never the phone number.
//
//   GET  ?b=<bill>&t=<sig>                        the bill, a UPI QR, Razorpay link if set up
//   POST {a:"claim", b, t, ref}                   "I have paid" + UTR → the desk checks the bank
const guard = require("./_guard.js");
const pay = require("./_pay.js");
const money = require("./money.js");
const crypto = require("crypto");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });
  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const id = clean(q.b || b.b, 12), t = String(q.t || b.t || "");
  const ip = guard.getIp(req);
  const rl = await guard.rateLimit(cfg, `rl:pay:${ip}`, 60, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Konchem sepu aagi try cheyandi" });
  if (!pay.okSig(id, t)) return json(res, 404, { error: "Ee link sarigga ledu — clinic ni adagandi" });
  const bill = await money.getBill(cfg, id);
  if (!bill) return json(res, 404, { error: "Bill dorakaledu" });
  const tot = money.totals(bill);

  if (req.method === "GET") {
    const u = pay.upi(tot.balance, bill.id);
    let qr = null;
    if (u) { try { qr = await require("qrcode").toString(u.url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }); } catch (e) {} }
    const rzp = await pay.razorpayLink(cfg, bill, tot.balance).catch(() => null);
    return json(res, 200, {
      ok: true,
      bill: {
        id: bill.id, name: String(bill.name || "").trim().split(" ")[0] || "",
        date: bill.ts, items: (bill.items || []).map((i) => ({ name: i.name, qty: i.qty || 1, price: i.price })),
        payments: (bill.payments || []).map((p) => ({ amount: p.amount, mode: p.mode, ts: p.ts })),
        total: tot.total, paid: tot.paid, balance: tot.balance,
      },
      upi: u ? { vpa: u.vpa, payee: u.payee, url: u.url, qr } : null,
      razorpay: rzp,
    });
  }

  if (req.method !== "POST" || b.a !== "claim") return json(res, 405, { error: "POST claim" });
  if (tot.balance <= 0) return json(res, 400, { error: "Ee bill ippatike full ga pay ayindi 🙏" });
  const ref = clean(b.ref, 30).replace(/[^A-Za-z0-9]/g, "");
  if (ref.length < 6) return json(res, 400, { error: "UPI app lo kanipinche UTR / reference number ivvandi (12 ankelu)" });
  const perBill = await guard.rateLimit(cfg, `rl:payc:${bill.id}`, 3, 86400);
  if (!perBill.allowed) return json(res, 429, { error: "Ee bill ki ippatike chepparu — clinic check chestundi 🙏" });
  const claim = { id: crypto.randomBytes(6).toString("hex"), bill: bill.id, name: bill.name, phone: bill.phone, amount: tot.balance, ref, ts: Date.now() };
  await guard.kvCommand(cfg, ["LPUSH", "pay:claims", JSON.stringify(claim)]);
  await guard.kvCommand(cfg, ["LTRIM", "pay:claims", "0", "199"]).catch(() => {});
  try {
    const push = require("./_push.js");
    if (push.enabled()) await push.notifyCap(cfg, "money.bill", {
      title: `💳 ${String(bill.name || "Patient").split(" ")[0]} UPI lo pay chesaru ani chepparu`,
      body: `Bill ${bill.id} · ₹${tot.balance.toLocaleString("en-IN")} · UTR ${ref} — bank lo check chesi Money lo confirm cheyandi`,
      tab: "money", urgent: false, data: { kind: "payclaim", bill: bill.id },
    });
  } catch (e) { console.error("pay: push", e && e.message); }
  return json(res, 200, { ok: true, msg: "Thank you 🙏 Clinic bank lo check chesi confirm chestundi." });
};
