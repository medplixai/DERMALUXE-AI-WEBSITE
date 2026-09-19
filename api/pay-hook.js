// /api/pay-hook — Razorpay tells us a payment link was paid. Public on
// purpose (Razorpay has no login), but nothing is believed without the
// X-Razorpay-Signature HMAC over the raw body, made with
// RAZORPAY_WEBHOOK_SECRET. Each Razorpay payment id is recorded once, however
// often the webhook is retried.
const guard = require("./_guard.js");
const pay = require("./_pay.js");
const money = require("./money.js");

async function rawBody(req) {
  if (typeof req.rawBody === "string" || Buffer.isBuffer(req.rawBody)) return String(req.rawBody);
  if (req.readable && !req.readableEnded) {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks).toString("utf8");
  }
  return typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST" });
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(501).json({ error: "not configured" });
  const raw = await rawBody(req);
  if (!pay.webhookOk(raw, req.headers["x-razorpay-signature"])) return res.status(401).json({ error: "bad signature" });
  let ev = {}; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).json({ error: "bad body" }); }
  if (ev.event !== "payment_link.paid") return res.status(200).json({ ok: true, ignored: ev.event || "" });
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(501).json({ error: "Storage not configured" });
  const p = ((ev.payload || {}).payment || {}).entity || {};
  const plink = ((ev.payload || {}).payment_link || {}).entity || {};
  const billId = String(((plink.notes || {}).bill) || ((p.notes || {}).bill) || "").slice(0, 12);
  const pid = String(p.id || "").slice(0, 40);
  if (!billId || !pid) return res.status(200).json({ ok: true, ignored: "no bill" });
  const first = await guard.kvCommand(cfg, ["SET", `rzp:paid:${pid}`, billId, "NX", "EX", String(400 * 86400)]).catch(() => ({}));
  if (!first || !first.result) return res.status(200).json({ ok: true, dup: true });
  const bill = await money.getBill(cfg, billId);
  if (!bill) return res.status(200).json({ ok: true, ignored: "bill gone" });
  const amount = Math.round(Number(p.amount || 0) / 100);
  const out = await money.recordPayment(cfg, bill, { amount, mode: "upi", ref: "razorpay " + pid, ts: Number(p.created_at) * 1000 || Date.now(), by: "Razorpay" });
  try {
    const push = require("./_push.js");
    if (push.enabled()) await push.notifyCap(cfg, "money.view", {
      title: `✅ ₹${amount.toLocaleString("en-IN")} online vachindi`,
      body: `${bill.name || "Patient"} · bill ${bill.id}${out.balance > 0 ? " · inka ₹" + out.balance + " baaki" : " · full ga ayipoyindi"}`,
      tab: "money", data: { kind: "paid", bill: bill.id },
    });
  } catch (e) {}
  return res.status(200).json({ ok: true });
};
