// Staff incentives: each colleague credited for what the records already
// say they did — the bills they raised and collected on, the treatments
// they did, the enquiries they turned into bookings — at rates the owner
// sets. Everyone sees their own line; only the owner sees everyone's.
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.STAFF_OWNERS = "9010427777";
const money = h.load("money"), inc = h.load("incentive");
const DESK = { name: "Sowmya", phone: "9876501601", role: "reception" };
const DOC = { name: "Dr. Sai", phone: "9876501602", role: "doctor" };
const OWNER = { name: "Owner", phone: "9010427777", role: "owner" };

(async () => {
  console.log("STAFF INCENTIVES\n");
  h.run(["HSET", "staff:users", DESK.phone, JSON.stringify({ name: DESK.name, role: "reception" }), DOC.phone, JSON.stringify({ name: DOC.name, role: "doctor" })]);

  h.as(["*"], DESK);
  const b = (await h.call(money, {}, { a: "bill", phone: "9876501610", name: "Anu", items: [{ name: "PICO", price: 10000 }], paid: 4000, mode: "upi", doneBy: DOC.phone, doneByName: DOC.name })).body.bill;
  await h.call(money, {}, { a: "pay", id: b.id, amount: 6000, mode: "cash" });
  const k = `${Date.now() - 1000}|9876501611`;
  h.run(["HSET", "dl_status", k, "booked"]); h.run(["HSET", "dl_status_ts", k, String(Date.now())]); h.run(["HSET", "dl_status_by", k, DESK.phone]);
  const k2 = `${Date.now() - 2000}|9876501612`;
  h.run(["HSET", "dl_status", k2, "visited"]); h.run(["HSET", "dl_status_ts", k2, String(Date.now())]); h.run(["HSET", "dl_status_by", k2, DESK.phone]);

  h.as(["*", "settings.manage"], OWNER);
  await h.call(inc, {}, { a: "rules-save", roles: { reception: { collectPct: 1, perConv: 50, visitTarget: 20 }, doctor: { treatPct: 5 } } });
  const r = (await h.call(inc, { a: "report" })).body;
  const desk = r.rows.find((x) => x.phone === DESK.phone), doc = r.rows.find((x) => x.phone === DOC.phone);
  is([desk.collected, desk.conversions, desk.amount], [10000, 2, 200], "the desk: ₹10,000 collected on their bill × 1% + a booking and a visit × ₹50 = ₹200");
  // The visit target (11 Nov, point 9): shown beside the money, never paid.
  is([desk.visits, desk.rate.visitTarget], [1, 20], "one of the two is a visit, against the owner's target of 20 a month");
  is([doc.visits, doc.rate.visitTarget], [0, 0], "the doctor has no target set, so nothing to chase");
  is([doc.treated, doc.amount], [10000, 500], "the doctor who did the ₹10,000 treatment × 5% = ₹500");
  is(r.total, 700, "and the owner sees the month's total");

  h.as(["leads.view"], DESK);
  const mine = (await h.call(inc, { a: "report" })).body;
  is([mine.owner, mine.rows.length, mine.rows[0].amount, mine.rows[0].visits], [false, 1, 200, 1], "a colleague sees only their own line, visits included");
  is((await h.call(inc, {}, { a: "rules-save", roles: { reception: { collectPct: 50 } } })).code, 403, "and cannot set their own rate");
  h.as(["*", "settings.manage"], OWNER);
  const capped = (await h.call(inc, {}, { a: "rules-save", roles: { reception: { collectPct: 900, perConv: -5, visitTarget: 9999.6 } } })).body.rules.roles.reception;
  is([capped.collectPct, capped.perConv, capped.visitTarget], [50, 0, 500], "rates are kept sensible — at most 50%, never negative, a target of at most 500 and whole");
  h.as(["*"]);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nincentives behave");
  process.exit(fails ? 1 : 0);
})();
