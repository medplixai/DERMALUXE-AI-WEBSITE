const h = require("./harness.js");
const attend = h.load("attend");
const A = (q, b) => h.call(attend, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const month = today.slice(0, 7);

(async () => {
  console.log("HAAJARU — who came in, and the month that pays salaries\n");
  // a team
  h.run(["HSET", "staff:users", "9876500051", JSON.stringify({ name: "Sowmya", role: "reception" })]);
  h.run(["HSET", "staff:users", "9876500052", JSON.stringify({ name: "Latha", role: "therapist" })]);
  h.run(["HSET", "staff:users", "9876500053", JSON.stringify({ name: "Gone", role: "reception", off: true })]);

  let d = await A({ a: "day" });
  is(d.body.rows.length, 3, "two staff + the owner are listed");
  is(d.body.rows.some((r) => r.name === "Gone"), false, "somebody switched off is not asked to come in");
  is(d.body.counts.unmarked, 3, "nobody marked yet");

  // mark yourself in
  const i1 = await A({ a: "in" }, { a: "in" });
  is(i1.code, 200, "I came in");
  const twice = await A({ a: "in" }, { a: "in" });
  is(twice.code, 400, "cannot come in twice");
  const out1 = await A({ a: "out" }, { a: "out" });
  is(out1.code, 200, "and out");
  const out2 = await A({ a: "out" }, { a: "out" });
  is(out2.code, 400, "cannot leave twice");

  d = await A({ a: "day" });
  const me = d.body.rows.find((r) => r.phone === "9010427777");
  is(me.status, "present", "marking in counts as present");
  is(!!me.inAt && !!me.outAt, true, "both times are shown in Eluru time");

  // somebody who never marked, marked by the manager
  await A({ a: "mark" }, { a: "mark", phone: "9876500052", status: "leave", note: "fever" });
  d = await A({ a: "day" });
  const latha = d.body.rows.find((r) => r.phone === "9876500052");
  is(latha.status, "leave", "manager can mark leave");
  is(latha.note, "fever", "with the reason");
  is(latha.markedBy, "Owner", "and who said so");
  is(d.body.counts.leave, 1, "the leave count moves");
  is(d.body.counts.present, 1, "and the present count is only who is actually in");

  // leave wipes a stale clock-in
  await A({ a: "mark" }, { a: "mark", phone: "9010427777", status: "leave" });
  d = await A({ a: "day" });
  const me2 = d.body.rows.find((r) => r.phone === "9010427777");
  is(me2.in, 0, "a later 'on leave' clears the clock-in that contradicts it");

  // marking the future
  const fut = await A({ a: "mark" }, { a: "mark", phone: "9876500051", status: "present", day: "2099-01-01" });
  is(fut.code, 400, "cannot mark a day that has not happened");
  const bad = await A({ a: "mark" }, { a: "mark", phone: "9876500051", status: "nonsense" });
  is(bad.code, 400, "cannot invent a status");
  const badph = await A({ a: "mark" }, { a: "mark", phone: "123", status: "present" });
  is(badph.code, 400, "needs a real number");

  // the month view
  const m = await A({ a: "month", month });
  const row = m.body.rows.find((r) => r.name === "Latha");
  is(row.leave, 1, "Latha's one leave day is in the month");
  const owner = m.body.rows.find((r) => r.name === "Owner");
  is(owner.days, 1, "a day only counts once however many times it was changed");

  // permissions: marking yourself needs nothing, marking others does
  h.as(["leads.view"], { name: "Sowmya", phone: "9876500051", role: "reception" });
  const selfIn = await A({ a: "in" }, { a: "in" });
  is(selfIn.code, 200, "anybody can mark themselves in");
  const other = await A({ a: "mark" }, { a: "mark", phone: "9876500052", status: "present" });
  is(other.code, 403, "but not somebody else");
  const mm = await A({ a: "month", month });
  is(mm.code, 403, "and the month view is the owner's");
  const dd = await A({ a: "day" });
  is(dd.code, 200, "everyone can see who is in today");
  h.as(["*"], { name: "Owner", phone: "9010427777", role: "owner" });
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nhaajaru behaves");
})();
