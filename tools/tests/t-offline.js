// Writes that arrive twice, or late.
//
// The clinic's line drops. A payment can reach the server while the answer
// never reaches the phone; the phone keeps it in its offline queue and sends
// it again. That must not become two payments. And a payment taken at 8 PM
// that syncs at 9 the next morning belongs to the day it was taken — or the
// day's collection is wrong on both days.
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const money = h.load("money"), attend = h.load("attend"), stock = h.load("stock");
const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

(async () => {
  console.log("WRITES THAT ARRIVE TWICE, OR LATE\n");

  const b = await h.call(money, {}, { a: "bill", phone: "9876501101", name: "Sita", items: [{ name: "Peel", price: 3000 }], cid: "bill-cid-0001" });
  const again = await h.call(money, {}, { a: "bill", phone: "9876501101", name: "Sita", items: [{ name: "Peel", price: 3000 }], cid: "bill-cid-0001" });
  is(again.body.dup, true, "a bill sent again with the same id is recognised");
  is(h.run(["LRANGE", "bill:of:9876501101", "0", "-1"]).length, 1, "and only one bill exists");

  const id = b.body.bill.id;
  await h.call(money, {}, { a: "pay", id, amount: 1000, mode: "cash", cid: "pay-cid-00001" });
  await h.call(money, {}, { a: "pay", id, amount: 1000, mode: "cash", cid: "pay-cid-00001" });
  let bill = JSON.parse(h.run(["GET", `bill:${id}`]));
  is(bill.payments.length, 1, "a payment retried by the offline queue is recorded once");
  await h.call(money, {}, { a: "pay", id, amount: 500, mode: "upi", cid: "pay-cid-00002" });
  bill = JSON.parse(h.run(["GET", `bill:${id}`]));
  is(bill.payments.length, 2, "a genuinely second payment still goes through");
  const bad = await h.call(money, {}, { a: "pay", id, amount: 0, cid: "pay-cid-00003" });
  const fixed = await h.call(money, {}, { a: "pay", id, amount: 200, cid: "pay-cid-00003" });
  is([bad.code, fixed.code, fixed.body.dup], [400, 200, undefined], "a write that was refused is not remembered — it can be corrected and sent");

  console.log("\n  — late —");
  const yesterday8pm = (() => { const d = new Date(Date.now() + 19800000); d.setUTCHours(20, 0, 0, 0); return d.getTime() - 19800000 - 86400000; })();
  await h.call(money, {}, { a: "pay", id, amount: 300, mode: "cash", at: yesterday8pm, cid: "pay-cid-00004" });
  bill = JSON.parse(h.run(["GET", `bill:${id}`]));
  is(istDay(bill.payments[bill.payments.length - 1].ts), istDay(yesterday8pm), "a payment taken offline last night counts for last night");
  is(h.run(["LRANGE", `bill:day:${istDay(yesterday8pm)}`, "0", "-1"]).includes(id), true, "and is in that day's collection");
  await h.call(money, {}, { a: "pay", id, amount: 50, mode: "cash", at: Date.now() - 30 * 86400000, cid: "pay-cid-00005" });
  bill = JSON.parse(h.run(["GET", `bill:${id}`]));
  is(Date.now() - bill.payments[bill.payments.length - 1].ts <= 3 * 86400000 + 1000, true, "but a phone clock a month wrong cannot file it last month");
  await h.call(money, {}, { a: "pay", id, amount: 50, mode: "cash", at: Date.now() + 86400000, cid: "pay-cid-00006" });
  bill = JSON.parse(h.run(["GET", `bill:${id}`]));
  is(bill.payments[bill.payments.length - 1].ts <= Date.now(), true, "nor in the future");

  const twoHoursAgo = Date.now() - 2 * 3600000;
  const inn = await h.call(attend, {}, { a: "in", at: twoHoursAgo, cid: "att-cid-00001" });
  is(inn.body.me.in, twoHoursAgo, "an arrival tapped offline counts at the time it was tapped");
  is((await h.call(attend, {}, { a: "in", at: twoHoursAgo, cid: "att-cid-00001" })).body.dup, true, "and sending it again is not an error");

  const add = await h.call(stock, {}, { a: "add", name: "PRP kit", qty: 5, unit: "kit", low: 2, cid: "stk-cid-00001" });
  const itemId = add.body.item.id;
  await h.call(stock, {}, { a: "move", id: itemId, change: -1, cid: "stk-cid-00002" });
  await h.call(stock, {}, { a: "move", id: itemId, change: -1, cid: "stk-cid-00002" });
  is(JSON.parse(h.run(["GET", `stk:item:${itemId}`])).qty, 4, "one kit used, sent twice, is one kit off the shelf");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nretries and late writes behave");
  process.exit(fails ? 1 : 0);
})();
