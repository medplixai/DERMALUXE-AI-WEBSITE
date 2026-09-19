// Branches. With one branch nothing changes. With two, every new record
// knows its branch, a colleague pinned to a branch sees only its day and its
// money, and the owner sees everything or picks one. Records from before
// branches existed belong to the first one.
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const sch = h.load("schedule"), money = h.load("money");
const br = require(require("path").join(process.env.DL_API, "_branch.js"));
const tmr = (hh) => { const d = new Date(Date.now() + 19800000 + 86400000); d.setUTCHours(hh, 0, 0, 0); return d.getTime() - 19800000; };
const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

(async () => {
  console.log("BRANCHES\n");
  is([br.multi(), br.def()], [false, "eluru"], "with nothing configured there is one branch, Eluru");
  const a0 = (await h.call(sch, {}, { a: "create", ph: "9876501801", name: "Old", at: tmr(10) })).body.appt;
  is(JSON.parse(h.run(["LRANGE", "appt:q", "0", "0"])[0]).branch, "eluru", "new records are stamped with it already");

  process.env.BRANCHES = JSON.stringify([{ id: "eluru", name: "DermaLuxe Eluru" }, { id: "bhimavaram", name: "DermaLuxe Bhimavaram" }]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ id: "legacy", ph: "9876501802", name: "Legacy", at: tmr(11) })]);   // written before branches
  const BHV = { name: "Bhavya", phone: "9876501810", role: "reception", branch: "bhimavaram" };
  h.as(["*"], BHV);
  await h.call(sch, {}, { a: "create", ph: "9876501803", name: "Bhim patient", at: tmr(12) });
  is(JSON.parse(h.run(["LRANGE", "appt:q", "0", "0"])[0]).branch, "bhimavaram", "a booking made by a Bhimavaram colleague belongs to Bhimavaram");
  const theirs = (await h.call(sch, { a: "day", day: istDay(tmr(10)) })).body.rows.map((r) => r.name);
  is(theirs, ["Bhim patient"], "and they see only Bhimavaram's day");
  const bill = (await h.call(money, {}, { a: "bill", phone: "9876501803", name: "Bhim patient", items: [{ name: "Peel", price: 2000 }], paid: 2000, mode: "cash" })).body.bill;
  is(bill.branch, "bhimavaram", "their bill too");

  h.as(["*"], { name: "Owner", phone: "9010427777", role: "owner" });
  await h.call(money, {}, { a: "bill", phone: "9876501804", name: "Eluru patient", items: [{ name: "PRP", price: 5000 }], paid: 5000, mode: "upi" });
  const all = (await h.call(sch, { a: "day", day: istDay(tmr(10)) })).body.rows.map((r) => r.name).sort();
  is(all, ["Bhim patient", "Legacy", "Old"], "the owner sees every branch");
  const eluru = (await h.call(sch, { a: "day", day: istDay(tmr(10)), branch: "eluru" })).body.rows.map((r) => r.name).sort();
  is(eluru, ["Legacy", "Old"], "or one — and records from before branches belong to the first");
  is((await h.call(money, { a: "day", branch: "bhimavaram" })).body.collected, 2000, "each branch's collection is its own");
  is((await h.call(money, { a: "day" })).body.collected, 7000, "and together it is the clinic's");
  h.as(["*"], { name: "Sneaky", phone: "9876501811", role: "reception", branch: "bhimavaram" });
  is((await h.call(money, { a: "day", branch: "eluru" })).body.collected, 2000, "a pinned colleague cannot ask for another branch's money");
  delete process.env.BRANCHES;
  h.as(["*"]);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nbranches behave");
  process.exit(fails ? 1 : 0);
})();
