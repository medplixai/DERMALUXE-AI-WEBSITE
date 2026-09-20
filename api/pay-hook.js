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
  const notes = Object.assign({}, p.notes || {}, plink.notes || {});
  const billId = String(notes.bill || "").slice(0, 12);
  const pid = String(p.id || "").slice(0, 40);
  // An advance on a booked slot: the appointment is confirmed and locked, the
  // patient is told, the desk sees 💳 on the day's list. The money is kept
  // against the phone so the visit bill can adjust it.
  const appt = String(notes.appt || "").match(/^(\d{10})\|(\d{10,})$/);
  if (appt && pid) {
    const first = await guard.kvCommand(cfg, ["SET", `rzp:paid:${pid}`, "adv", "NX", "EX", String(400 * 86400)]).catch(() => ({}));
    if (!first || !first.result) return res.status(200).json({ ok: true, dup: true });
    const ph = appt[1], at = Number(appt[2]);
    const amount = Math.round(Number(p.amount || 0) / 100);
    let name = "", found = false;
    const q = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "299"]).catch(() => ({}));
    for (const raw of ((q && q.result) || [])) {
      let a; try { a = JSON.parse(raw); } catch (e) { continue; }
      if (!a || a.ph !== ph) continue;
      name = a.name || name;
      if (a.at !== at) continue;
      a.adv = (Number(a.adv) || 0) + amount; a.cf = 1; a.advRef = pid;
      await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
      await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(a)]).catch(() => {});
      found = true;
    }
    await guard.kvCommand(cfg, ["LPUSH", `adv:${ph}`, JSON.stringify({ amount, at, ref: pid, ts: Date.now(), used: 0 })]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", `adv:${ph}`, "0", "19"]).catch(() => {});
    const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at));
    const firstName = String(name || "").trim().split(" ")[0] || "andi";
    const notify = require("./_notify.js");
    const text = `✅ ₹${amount} advance vachindi — thank you ${firstName} garu! 🙏\n\n📅 Mee appointment *${when}* CONFIRMED & locked.\nEe amount mee bill lo adjust avutundi.\n\n📍 Rama Mahal, Kasturi Vari Street, Opp. Happy Mobiles, Eluru\nTime marchali ante ikkade reply cheyandi.`;
    if (!(await notify.sendWa(ph, text).catch(() => false))) await notify.sendWaTemplate(ph, "payment_confirmed", [firstName, String(amount), when]).catch(() => {});
    try { await require("./_inbox.js").log(cfg, ph, { dir: "out", text, by: "ai", via: "advance" }); } catch (e) {}
    try {
      const push = require("./_push.js");
      if (push.enabled()) await push.notifyCap(cfg, "appts.view", { title: `💳 ₹${amount} advance — ${name || ph}`, body: `${when} slot locked${found ? "" : " (appointment list lo dorakaledu — chudandi)"}`, tab: "sch", data: { kind: "advance", phone: ph } });
    } catch (e) {}
    return res.status(200).json({ ok: true, advance: amount, locked: found });
  }
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
