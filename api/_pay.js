// Getting paid for a bill without the patient having to come back to the desk.
//
// Two ways, depending on what the clinic has set up:
//
//  * UPI (needs only UPI_VPA): the patient opens a link, sees the bill and a
//    UPI QR / "Pay with UPI" button for exactly the balance, pays in their
//    own app, and taps "I have paid" with the UTR. That lands with the desk
//    as a claim to check against the bank app — nothing is marked paid on
//    the patient's word alone.
//
//  * Razorpay (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET + RAZORPAY_WEBHOOK_SECRET):
//    the same page offers a Razorpay payment link, and Razorpay's webhook
//    records the payment on the bill by itself. Dormant until those three
//    are set.
//
// A bill's public link carries an HMAC of its id, so bill numbers (which are
// sequential) cannot be walked. The page shows a first name and the items,
// never the phone number.
const crypto = require("crypto");
const guard = require("./_guard.js");

const secret = () => process.env.STAFF_SECRET || process.env.ADMIN_KEY || "";
const sig = (id) => crypto.createHmac("sha256", secret()).update("pay:" + id).digest("hex").slice(0, 20);
const okSig = (id, t) => !!secret() && !!id && guard.safeEqual(String(t || ""), sig(id));
const base = () => String(process.env.PUBLIC_BASE || "https://www.dermaluxe.ai").replace(/\/+$/, "");
const link = (id) => `${base()}/pay.html?b=${encodeURIComponent(id)}&t=${sig(id)}`;

function upi(amount, billId) {
  const vpa = String(process.env.UPI_VPA || "").trim();
  if (!vpa || !(amount > 0)) return null;
  const payee = process.env.UPI_PAYEE || "DermaLuxe by Medicare";
  const url = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payee)}&am=${amount}&cu=INR&tn=${encodeURIComponent("DermaLuxe bill " + billId)}`;
  return { vpa, payee, url };
}

const rzpOn = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

// A Razorpay payment link for exactly this balance. Reused while the amount
// is unchanged, so the patient does not get a new link every reminder.
async function razorpayLink(cfg, bill, balance) {
  if (!rzpOn() || !(balance > 0)) return null;
  const prev = bill.rzp;
  if (prev && prev.amount === balance && prev.url && Date.now() - prev.at < 20 * 86400000) return prev.url;
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  try {
    const r = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(balance * 100), currency: "INR",
        reference_id: `${bill.id}-${Date.now().toString(36)}`,
        description: `DermaLuxe bill ${bill.id}`,
        customer: { name: String(bill.name || "Patient").slice(0, 50), contact: "+91" + bill.phone },
        notify: { sms: false, email: false }, reminder_enable: false,
        notes: { bill: bill.id },
        expire_by: Math.floor(Date.now() / 1000) + 25 * 86400,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.short_url) { console.error("razorpay link", r.status, JSON.stringify(d).slice(0, 200)); return null; }
    bill.rzp = { id: d.id, url: d.short_url, amount: balance, at: Date.now() };
    await guard.kvCommand(cfg, ["SET", `bill:${bill.id}`, JSON.stringify(bill)]);
    return d.short_url;
  } catch (e) { console.error("razorpay link", e && e.message); return null; }
}

// A payment link for the advance on a booked slot. Paid → the webhook marks
// the appointment confirmed and locked; nobody has to read a "PAID" reply.
// One link per booking (the same slot re-confirmed mid-chat reuses it).
async function advanceLink(cfg, o) {
  const amount = Math.round(Number(o.amount || 0));
  if (!rzpOn() || !(amount > 0) || !o.phone || !o.at) return null;
  const key = `adv:link:${o.phone}`;
  const prev = JSON.parse(((await guard.kvCommand(cfg, ["GET", key]).catch(() => ({}))) || {}).result || "null");
  if (prev && prev.at === o.at && prev.amount === amount && prev.url) return prev.url;
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  try {
    const r = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amount * 100, currency: "INR",
        reference_id: `adv-${o.phone}-${Date.now().toString(36)}`,
        description: "DermaLuxe appointment advance (adjusted in your bill)",
        customer: { name: String(o.name || "Patient").slice(0, 50), contact: "+91" + o.phone },
        notify: { sms: false, email: false }, reminder_enable: false,
        notes: { appt: `${o.phone}|${o.at}`, kind: "advance" },
        expire_by: Math.floor(Math.min(o.at, Date.now() + 2 * 86400000) / 1000),
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.short_url) { console.error("razorpay advance", r.status, JSON.stringify(d).slice(0, 200)); return null; }
    await guard.kvCommand(cfg, ["SET", key, JSON.stringify({ id: d.id, url: d.short_url, at: o.at, amount, ts: Date.now() }), "EX", "172800"]).catch(() => {});
    return d.short_url;
  } catch (e) { console.error("razorpay advance", e && e.message); return null; }
}

function webhookOk(raw, signature) {
  const s = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!s || !raw || !signature) return false;
  const want = crypto.createHmac("sha256", s).update(raw).digest("hex");
  return guard.safeEqual(String(signature), want);
}

module.exports = { sig, okSig, link, upi, rzpOn, razorpayLink, advanceLink, webhookOk };
