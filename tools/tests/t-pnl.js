// The month's profit and loss, and the owner's report every night.
//
// Money in is what was collected in the month (a payment in October for a
// September bill is October's money). Money out is what was written down as
// spent. Last month sits beside it. The evening report adds the day up in
// one WhatsApp and says plainly when the drawer was not counted.
const path = require("path");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.ADMIN_PHONES = "9010427777";
const money = h.load("money"), expense = h.load("expense"), followup = h.load("cron-followup");
const DAY = 86400000;
const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

(async () => {
  console.log("PROFIT AND LOSS\n");
  const now = Date.now(), month = istDay(now).slice(0, 7);
  // this month: a ₹8,000 bill, ₹5,000 paid now; last month: a ₹3,000 payment
  const b1 = (await h.call(money, {}, { a: "bill", phone: "9876501501", name: "Anu", items: [{ name: "PICO", price: 8000 }] })).body.bill;
  await h.call(money, {}, { a: "pay", id: b1.id, amount: 5000, mode: "upi" });
  const lastMonthDay = (() => { const d = new Date(month + "-01T12:00:00+05:30"); return d.getTime() - 5 * DAY; })();
  h.run(["SET", "bill:old1", JSON.stringify({ id: "old1", phone: "9876501502", ts: lastMonthDay, items: [{ name: "Peel", price: 3000 }], payments: [{ amount: 3000, mode: "cash", ts: lastMonthDay }] })]);
  h.run(["LPUSH", `bill:day:${istDay(lastMonthDay)}`, "old1"]);
  await h.call(expense, {}, { a: "add", amount: 1200, category: "Consumables", note: "PRP kits" });
  await h.call(expense, {}, { a: "add", amount: 800, category: "Marketing & ads" });

  const p = (await h.call(expense, { a: "pnl" })).body;
  is([p.cur.collected, p.cur.spent, p.cur.profit, p.cur.margin], [5000, 2000, 3000, 60], "this month: ₹5,000 in, ₹2,000 out, ₹3,000 left, 60%");
  is(p.cur.treatments, [{ name: "PICO", count: 1, value: 8000 }], "treatments are what was billed");
  is(p.cur.byCategory.map((x) => x.name), ["Consumables", "Marketing & ads"], "spending by category, biggest first");
  is([p.before.collected, p.change.collected], [3000, 67], "last month beside it, and the change");
  is(p.cur.days.find((d) => d.day === istDay(now)), { day: istDay(now), in: 5000, out: 2000 }, "and today in the day-by-day line");
  const prevMonth = istDay(lastMonthDay).slice(0, 7);
  is((await h.call(expense, { a: "pnl", month: prevMonth })).body.cur.collected, 3000, "any past month can be opened");
  h.as(["money.expense"]);
  is((await h.call(expense, { a: "pnl" })).code, 403, "writing expenses is not enough to see profit — it needs money.view too");
  h.as(["*"]);

  console.log("\n  — the evening report —");
  const Date0 = Date.now;
  const at945 = (() => { const d = new Date(Date0() + 19800000); d.setUTCHours(21, 45, 0, 0); return d.getTime() - 19800000; })();
  Date.now = () => at945;
  h.sent.length = 0;
  await h.call(followup, { key: "local-admin" });
  const rep = h.sent.find((s) => s[0] === "wa" && s[1] === "9010427777" && /ee roju/.test(s[2]));
  is(!!rep, true, "at 9:45 PM the owner gets the day on WhatsApp");
  is([/Vachindi \*₹5,000\*/.test(rep[2]), /Kharchu ₹2,000/.test(rep[2]), /Migilindi \*₹3,000\*/.test(rep[2])], [true, true, true], "money in, out, and left");
  is(/Cash close inka cheyyaledu/.test(rep[2]), true, "and says the drawer has not been counted");
  is(/baaki ₹3,000/.test(rep[2]), true, "with what is still owed");
  h.sent.length = 0;
  await h.call(followup, { key: "local-admin" });
  is(h.sent.filter((s) => /ee roju/.test(s[2] || "")).length, 0, "once a night, not every run");
  Date.now = Date0;

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nprofit and loss behave");
  process.exit(fails ? 1 : 0);
})();
