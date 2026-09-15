const h = require("./harness.js");
const expense = h.load("expense"), money = h.load("money");
const E = (q, b) => h.call(expense, q, b), M = (q, b) => h.call(money, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("KHARCHULU — what goes out, against what came in\n");
  // money in today
  const b = await M({ a: "bill" }, { a: "bill", phone: "9876500021", name: "A", items: [{ name: "Laser", price: 10000 }], paid: 10000, mode: "upi" });
  is(b.body.bill.balance, 0, "₹10,000 collected today");

  await E({ a: "add" }, { a: "add", amount: 2500, category: "Consumables", vendor: "Sri Medical", mode: "cash" });
  await E({ a: "add" }, { a: "add", amount: 1500, category: "Marketing & ads", note: "Meta" });
  const s = await E({ a: "summary" });
  is(s.body.day.collected, 10000, "today's collection");
  is(s.body.day.spent, 4000, "today's spending");
  is(s.body.day.left, 6000, "and what is left");
  is(s.body.monthly.spent, 4000, "the month has the same two so far");
  is(s.body.monthly.byCategory[0].name, "Consumables", "the biggest heading first");
  is(s.body.monthly.byCategory[0].amount, 2500, "with its total");

  const bad = await E({ a: "add" }, { a: "add", amount: 0 });
  is(bad.code, 400, "₹0 is not an expense");
  const neg = await E({ a: "add" }, { a: "add", amount: -100 });
  is(neg.code, 400, "nor is a negative one");
  const fut = await E({ a: "add" }, { a: "add", amount: 100, at: Date.now() + 10 * 86400000 });
  is(fut.code, 400, "cannot book next month's bill today");
  const back = await E({ a: "add" }, { a: "add", amount: 700, at: Date.now() - 2 * 86400000, category: "Rent" });
  is(back.code, 200, "but yesterday's bill can be entered today");

  const s2 = await E({ a: "summary" });
  is(s2.body.day.spent, 4000, "a backdated bill does not land in today");
  is(s2.body.monthly.spent >= 4000, true, "but does count in the month (if the same month)");

  // deleting
  const list = (await E({ a: "summary" })).body.day.rows;
  await E({ a: "delete" }, { a: "delete", id: list[0].id });
  const s3 = await E({ a: "summary" });
  is(s3.body.day.spent, 4000 - list[0].amount, "deleting takes it back out of the day");
  const audit = h.run(["LRANGE", "staff:audit", "0", "5"]);
  is(audit.some((x) => /Deleted an expense/.test(x)), true, "and a deletion is written into the audit");

  const gone = await E({ a: "delete" }, { a: "delete", id: "nope" });
  is(gone.code, 404, "deleting something that is not there says so");

  // headings
  await E({ a: "cats-save" }, { a: "cats-save", cats: ["Consumables", "Rent"] });
  const s4 = await E({ a: "summary" });
  is(s4.body.cats, ["Consumables", "Rent"], "owner can change the headings");
  const none = await E({ a: "cats-save" }, { a: "cats-save", cats: [] });
  is(none.code, 400, "but cannot delete all of them");

  h.as(["money.expense"]);
  const notOwner = await E({ a: "cats-save" }, { a: "cats-save", cats: ["X"] });
  is(notOwner.code, 403, "headings are the owner's");
  h.as(["leads.view"]);
  const noSee = await E({ a: "summary" });
  is(noSee.code, 403, "somebody without the permission sees no spending at all");
  h.as(["*"]);
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nkharchulu behave");
})();
