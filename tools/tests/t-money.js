const h = require("./harness.js");
const money = h.load("money");
const M = (q, b) => h.call(money, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("MONEY — a bill, part payments, and what is left\n");
  const b1 = await M({ a: "bill" }, { a: "bill", phone: "9876500011", name: "Latha", items: [
    { name: "Laser — face", price: 5000 }, { name: "Peel", price: 2000 }] });
  is(b1.code, 200, "bill created");
  const id = b1.body.bill.id;
  is(b1.body.bill.total, 7000, "two items add up");
  is(b1.body.bill.balance, 7000, "nothing paid yet");

  await M({ a: "pay" }, { a: "pay", id, amount: 2000, mode: "upi" });
  let of1 = await M({ a: "of", phone: "9876500011" });
  is(of1.body.bills[0].paid, 2000, "part payment recorded");
  is(of1.body.bills[0].balance, 5000, "balance drops");
  is(of1.body.due, 5000, "the patient's total due");

  // pay more than is owed
  const over = await M({ a: "pay" }, { a: "pay", id, amount: 9999, mode: "cash" });
  const of2 = await M({ a: "of", phone: "9876500011" });
  console.log(`  ·   overpaying ₹9,999 on a ₹5,000 balance → ${over.code} ${over.body.error || ""}`);
  is(of2.body.bills[0].balance >= 0, true, "balance never goes negative");

  // a zero or negative payment
  const zero = await M({ a: "pay" }, { a: "pay", id, amount: 0 });
  is(zero.code, 400, "a ₹0 payment is refused");
  const neg = await M({ a: "pay" }, { a: "pay", id, amount: -500 });
  is(neg.code, 400, "a negative payment is refused");

  // day totals only count that day's money
  const day = await M({ a: "day" });
  is(day.body.collected, of2.body.bills[0].paid, "today's collection = what was actually paid today");

  // dues list
  const b2 = await M({ a: "bill" }, { a: "bill", phone: "9876500012", name: "Ravi", items: [{ name: "PRP", price: 8000 }] });
  await M({ a: "pay" }, { a: "pay", id: b2.body.bill.id, amount: 3000, mode: "cash" });
  const dues = await M({ a: "dues" });
  const ravi = (dues.body.rows || []).find((r) => r.phone === "9876500012");
  is(ravi && ravi.balance, 5000, "Ravi shows ₹5,000 outstanding");
  const settled = (dues.body.rows || []).some((r) => r.phone === "9876500011" && r.balance === 0);
  is(settled, false, "a fully-paid bill is not in the dues list");

  // a bill with no items
  const empty = await M({ a: "bill" }, { a: "bill", phone: "9876500013", name: "X", items: [] });
  is(empty.code, 400, "a bill with no items is refused");

  // a bad phone
  const badph = await M({ a: "bill" }, { a: "bill", phone: "12345", name: "X", items: [{ name: "a", price: 100 }] });
  is(badph.code, 400, "a bill needs a real number");

  // rates
  const r = await M({ a: "rates" });
  is(r.code, 200, "rate card reads");
  await M({ a: "rates-save" }, { a: "rates-save", rates: [{ name: "Laser — face", price: 5500 }] });
  const r2 = await M({ a: "rates" });
  is(r2.body.rates[0].price, 5500, "rate card saves");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nmoney behaves");
})();
