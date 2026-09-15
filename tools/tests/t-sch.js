const h = require("./harness.js");
const sch = h.load("schedule");
const S = (q, b) => h.call(sch, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const tomorrow11 = () => { const d = new Date(Date.now() + 86400000); d.setUTCHours(5, 30, 0, 0); return d.getTime(); };

(async () => {
  console.log("APPOINTMENTS — booking, clashes, and the day sheet\n");
  h.run(["HSET", "staff:users", "9876500061", JSON.stringify({ name: "Dr Meghana", role: "doctor" })]);
  const at = tomorrow11();

  const c = await S({ a: "create" }, { a: "create", ph: "9876500071", name: "Sita", at, mins: 30, staff: "9876500061", staffName: "Dr Meghana", concern: "acne" });
  is(c.code, 200, "booked");
  const id = c.body.appt.id;

  // same doctor, same time, different patient
  const clash = await S({ a: "create" }, { a: "create", ph: "9876500072", name: "Ravi", at, mins: 30, staff: "9876500061", staffName: "Dr Meghana" });
  is(clash.code, 409, "the same doctor cannot be in two places");
  is(/Dr Meghana/.test(clash.body.error), true, "and it says who is already busy");
  const forced = await S({ a: "create" }, { a: "create", ph: "9876500072", name: "Ravi", at, mins: 30, staff: "9876500061", staffName: "Dr Meghana", force: true });
  is(forced.code, 200, "unless the desk insists");

  // same patient, same time
  const dup = await S({ a: "create" }, { a: "create", ph: "9876500071", name: "Sita", at, mins: 30 });
  is(dup.code, 409, "and one patient cannot be booked twice at once");

  // the past
  const past = await S({ a: "create" }, { a: "create", ph: "9876500073", at: Date.now() - 5 * 86400000 });
  is(past.code, 400, "last week cannot be booked");
  const yst = await S({ a: "create" }, { a: "create", ph: "9876500073", at: Date.now() - 3600000 });
  is(yst.code, 200, "an hour ago can be — somebody walked in and it is being written up");

  // a different doctor at the same time is fine
  const other = await S({ a: "create" }, { a: "create", ph: "9876500074", at, staff: "9876500062", staffName: "Dr B" });
  is(other.code, 200, "a second doctor at the same time is fine");

  // the day sheet
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  const d = await S({ a: "day", day });
  is(d.body.counts.total, 3, "the day sheet has exactly tomorrow's three");
  is(d.body.rows.every((r) => r.day === day), true, "and nothing from another day leaks in");
  is(d.body.counts.unconfirmed >= 1, true, "and flags the ones nobody has confirmed");
  is(d.body.team.some((t) => t.name === "Dr Meghana"), true, "the team is offered for assigning");

  // moving
  const mv = await S({ a: "move" }, { a: "move", id, at: at + 3600000 });
  is(mv.code, 200, "an appointment can be moved");
  is(mv.body.appt.cf, false, "and needs confirming again after a move");
  const gone = await S({ a: "move" }, { a: "move", id: "nope", at: at + 7200000 });
  is(gone.code, 404, "moving one that is not there says so");

  // assign
  const asg = await S({ a: "assign" }, { a: "assign", id, staff: "9876500062", staffName: "Dr B", room: "2" });
  is(asg.body.appt.staffName, "Dr B", "a different doctor can be put on it");
  is(asg.body.appt.room, "2", "with a room");

  // status
  const ar = await S({ a: "status" }, { a: "status", id, status: "arrived" });
  is(ar.body.appt.status, "arrived", "marking somebody arrived");
  const dn = await S({ a: "status" }, { a: "status", id, status: "done" });
  is(dn.body.appt.status, "done", "and done");
  is(dn.body.moved, "done", "a finished appointment is filed away");
  const after = await S({ a: "assign" }, { a: "assign", id, staff: "9876500061" });
  is(after.code, 404, "and cannot be edited afterwards");

  // cancelling
  const c2 = await S({ a: "create" }, { a: "create", ph: "9876500076", name: "Z", at: at + 4 * 3600000 });
  const cx = await S({ a: "status" }, { a: "status", id: c2.body.appt.id, status: "cancelled" });
  is(cx.body.cancelled, true, "an appointment can be cancelled");
  const dayAfter = await S({ a: "day", day });
  is(dayAfter.body.rows.some((r) => r.id === c2.body.appt.id), false, "and leaves the day sheet");
  const badst = await S({ a: "status" }, { a: "status", id: c2.body.appt.id, status: "banana" });
  is(badst.code === 400 || badst.code === 404, true, "an invented status is refused");

  // the week strip
  const w = await S({ a: "week" });
  is(w.body.days.length, 7, "seven days ahead");
  is(w.body.days.some((x) => x.total > 0), true, "with the counts on them");

  h.as(["appts.view"]);
  const ro = await S({ a: "create" }, { a: "create", ph: "9876500075", at });
  is(ro.code, 403, "somebody who can only look cannot book");
  is((await S({ a: "day", day })).code, 200, "but can read the day");
  h.as(["leads.view"]);
  is((await S({ a: "day", day })).code, 403, "and somebody with no appointment permission sees nothing");
  h.as(["*"]);
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nappointments behave");
})();
