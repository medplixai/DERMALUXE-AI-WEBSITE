// Getting paid: the patient's bill link, UPI claims the desk checks,
// Razorpay's webhook, and the evening cash count.
//
// The link is public, so: it opens only with the bill's own signature, it
// shows a first name and never a phone number, and "I have paid" is a claim
// for a person to check — never a payment on the patient's word. Razorpay's
// word is only believed with its signature, and once per payment. The cash
// count tells the owner when the drawer does not match.
const crypto = require("crypto");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.UPI_VPA = "dermaluxe@okaxis";
process.env.ADMIN_PHONES = "9010427777";
let rzpCalls = 0;
global.fetch = async (url) => {
  if (String(url).includes("api.razorpay.com")) { rzpCalls++; return { ok: true, json: async () => ({ id: "plink_1", short_url: "https://rzp.io/i/abc" }) }; }
  return { ok: true, json: async () => ({}) };
};
const money = h.load("money"), payApi = h.load("pay"), hook = h.load("pay-hook");
const _pay = require(require("path").join(process.env.DL_API, "_pay.js"));

(async () => {
  console.log("GETTING PAID\n");
  const bill = (await h.call(money, {}, { a: "bill", phone: "9876501201", name: "Sita Rani", items: [{ name: "Hydrafacial", price: 4000 }], paid: 0 })).body.bill;
  const id = bill.id;

  console.log("  — the patient's link —");
  const link = await h.call(money, {}, { a: "paylink", id });
  const t = new URL(link.body.url).searchParams.get("t");
  is(link.body.url.startsWith("https://www.dermaluxe.ai/pay.html?b=" + id + "&t="), true, "the desk gets a link to the bill");
  const page = await h.call(payApi, { b: id, t });
  is([page.code, page.body.bill.name, page.body.bill.balance], [200, "Sita", 4000], "it opens the bill, first name only, with the balance");
  is(JSON.stringify(page.body).includes("9876501201"), false, "and the phone number is nowhere in it");
  is(page.body.upi.url.includes("am=4000") && page.body.upi.url.includes("pa=dermaluxe%40okaxis"), true, "the UPI request is for exactly the balance, to the clinic");
  is(/^<svg/.test(page.body.upi.qr), true, "with a QR to scan");
  is((await h.call(payApi, { b: id, t: "0".repeat(20) })).code, 404, "a made-up signature opens nothing");
  const other = (await h.call(money, {}, { a: "bill", phone: "9876501202", name: "Ravi", items: [{ name: "PRP", price: 6000 }] })).body.bill.id;
  is((await h.call(payApi, { b: other, t })).code, 404, "and one bill's signature does not open the next bill");
  h.sent.length = 0;
  const sent = await h.call(money, {}, { a: "paylink", id, send: true });
  is([sent.body.via, h.sent.some((s) => s[0] === "wa" && s[1] === "9876501201" && s[2].includes("/pay.html?b="))], ["message", true], "and can send it to the patient on WhatsApp");

  console.log("\n  — \"I have paid\" —");
  is((await h.call(payApi, {}, { a: "claim", b: id, t, ref: "12" })).code, 400, "a claim needs the UTR from their UPI app");
  const c = await h.call(payApi, {}, { a: "claim", b: id, t, ref: "426118123456" });
  is(c.code, 200, "a claim with a UTR is taken");
  is(JSON.parse(h.run(["GET", `bill:${id}`])).payments.length, 0, "but nothing is marked paid on the patient's word");
  const claims = (await h.call(money, { a: "claims" })).body.rows;
  is(claims.map((x) => [x.bill, x.amount, x.ref]), [[id, 4000, "426118123456"]], "the desk sees it, to check against the bank");
  h.as(["money.view"]);
  is((await h.call(money, {}, { a: "claim-ok", claim: claims[0].id })).code, 403, "somebody who can only look at money cannot confirm it");
  h.as(["*"]);
  await h.call(money, {}, { a: "claim-ok", claim: claims[0].id, amount: 4000 });
  const paid = JSON.parse(h.run(["GET", `bill:${id}`]));
  is([paid.payments.length, paid.payments[0].mode, paid.payments[0].ref], [1, "upi", "426118123456"], "confirmed, it is recorded as UPI with the UTR");
  is((await h.call(money, {}, { a: "claim-ok", claim: claims[0].id })).code, 404, "and cannot be confirmed twice");
  is((await h.call(payApi, {}, { a: "claim", b: id, t, ref: "426118999999" })).code, 400, "a paid bill takes no more claims");
  const t2 = _pay.sig(other);
  await h.call(payApi, {}, { a: "claim", b: other, t: t2, ref: "999999999999" });
  const c2 = (await h.call(money, { a: "claims" })).body.rows[0];
  await h.call(money, {}, { a: "claim-no", claim: c2.id, why: "not in bank" });
  is([(await h.call(money, { a: "claims" })).body.rows.length, JSON.parse(h.run(["GET", `bill:${other}`])).payments.length], [0, 0], "a claim the bank does not show is turned down, and nothing is recorded");

  console.log("\n  — Razorpay —");
  process.env.RAZORPAY_KEY_ID = "rzp_k"; process.env.RAZORPAY_KEY_SECRET = "rzp_s"; process.env.RAZORPAY_WEBHOOK_SECRET = "whsec";
  const pg = await h.call(payApi, { b: other, t: t2 });
  is(pg.body.razorpay, "https://rzp.io/i/abc", "with Razorpay set up, the page offers its link");
  await h.call(payApi, { b: other, t: t2 });
  is(rzpCalls, 1, "the same link is reused while the balance is the same");
  const ev = JSON.stringify({ event: "payment_link.paid", payload: { payment: { entity: { id: "pay_1", amount: 600000, created_at: Math.floor(Date.now() / 1000) } }, payment_link: { entity: { notes: { bill: other } } } } });
  const sigOk = crypto.createHmac("sha256", "whsec").update(ev).digest("hex");
  is((await h.call(hook, {}, JSON.parse(ev), { rawBody: ev, headers: { "x-razorpay-signature": "forged" } })).code, 401, "a webhook without Razorpay's signature is refused");
  await h.call(hook, {}, JSON.parse(ev), { rawBody: ev, headers: { "x-razorpay-signature": sigOk } });
  await h.call(hook, {}, JSON.parse(ev), { rawBody: ev, headers: { "x-razorpay-signature": sigOk } });
  const rb = JSON.parse(h.run(["GET", `bill:${other}`]));
  is([rb.payments.length, rb.payments[0].amount, rb.payments[0].by], [1, 6000, "Razorpay"], "a signed payment is recorded once, however often Razorpay retries");
  is(h.run(["LRANGE", "bill:open", "0", "-1"]).includes(other), false, "and the bill leaves the dues list");

  console.log("\n  — the evening cash count —");
  const b3 = (await h.call(money, {}, { a: "bill", phone: "9876501203", name: "Kala", items: [{ name: "Peel", price: 2500 }] })).body.bill.id;
  await h.call(money, {}, { a: "pay", id: b3, amount: 2500, mode: "cash" });
  h.sent.length = 0;
  const ok = await h.call(money, {}, { a: "close", float: 1000, spent: 200, counted: 3300 });
  is([ok.body.close.expected, ok.body.close.diff], [3300, 0], "float + cash taken − cash spent = what should be there");
  is(h.sent.filter((s) => s[0] === "wa").length, 0, "when it matches, nobody is bothered");
  const short = await h.call(money, {}, { a: "close", float: 1000, spent: 200, counted: 2800, note: "change ichhamu" });
  is([short.body.close.diff, short.body.close.redone], [-500, 1], "counting again replaces the day's count and says it was redone");
  is(h.sent.some((s) => s[0] === "wa" && s[1] === "9010427777" && s[2].includes("-500")), true, "when it does not, the owner is told on WhatsApp");
  is((await h.call(money, { a: "closes" })).body.rows.length, 1, "one count per day in the history");
  h.as(["money.view"]);
  is((await h.call(money, {}, { a: "close", counted: 100 })).code, 403, "only somebody who takes money can close the drawer");
  h.as(["*"]);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ngetting paid behaves");
  process.exit(fails ? 1 : 0);
})();
