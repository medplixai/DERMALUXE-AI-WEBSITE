// The two numbers the clinic is chasing: academy seats by a date, and
// appointments in the month.
//
// Every assertion pins the clock. A goal is arithmetic about *today*, so a
// test written against the real now would pass all month and fail on the 1st
// — which is exactly the morning the owner would be reading it.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const goals = h.load("_goals");
const cfg = { kind: "pg" };
const REAL_NOW = Date.now;
const at = (iso) => { Date.now = () => Date.parse(iso); };
const restore = () => { Date.now = REAL_NOW; };

// An appointment as the desk and the agent actually write it.
const appt = (iso, extra) => JSON.stringify(Object.assign({ ph: "9876500001", name: "Lakshmi", at: Date.parse(iso) }, extra || {}));
const book = (list, iso, extra) => h.run(["LPUSH", list, appt(iso, extra)]);

(async () => {
  console.log("GOALS\n");

  console.log("  — what it starts as —");
  at("2026-09-24T09:00:00+05:30");
  const d = await goals.load(cfg);
  is([d.seats, d.seatsBy, d.appts], [10, "2026-10-20", 0], "the batch's own ten seats by the day it starts, and no appointment goal until the owner sets one");

  console.log("  — the owner setting them —");
  is((await goals.save(cfg, { seats: 8, seatsBy: "2026-10-15", appts: 120 }, "Owner")).goals.appts, 120, "both are saved");
  is((await goals.load(cfg)).seats, 8, "and read back");
  is((await goals.save(cfg, { seatsBy: "2026-09-01" }, "Owner")).error,
    "Seat goal date ade poyindi — mundu unna date pettandi", "a date already gone is refused, not stored");
  is((await goals.load(cfg)).seatsBy, "2026-10-15", "and the good one is still there");
  is((await goals.save(cfg, { seats: 99 }, "Owner")).goals.seats, 10, "more seats than the batch has is pulled back to the batch");
  await goals.save(cfg, { seats: 8 }, "Owner");

  console.log("\n  — the seat goal —");
  h.run(["SET", "acad:booked", "3"]);
  let st = await goals.state(cfg);
  is([st.seats.booked, st.seats.left, st.seats.days], [3, 5, 21], "three taken, five to go, twenty-one days");
  is(st.seats.perWeek, 1.7, "which is under two a week");
  is(st.seats.hit, false, "not there yet");
  h.run(["SET", "acad:booked", "8"]);
  is((await goals.state(cfg)).seats.hit, true, "eight of eight is the goal met");
  h.run(["SET", "acad:booked", "3"]);

  // The goal's own date passing is not the same as the goal being met, and
  // the morning message has to say something different about it.
  at("2026-10-16T09:00:00+05:30");
  st = await goals.state(cfg);
  is([st.seats.over, st.seats.days], [true, -1], "once the date is past it says so instead of counting down into minus");
  at("2026-09-24T09:00:00+05:30");

  console.log("\n  — counting the month's appointments —");
  h.run(["DEL", "appt:q"]); h.run(["DEL", "appt:done"]);
  book("appt:done", "2026-09-02T10:00:00+05:30");
  book("appt:done", "2026-09-10T10:00:00+05:30", { ph: "9876500002" });
  book("appt:done", "2026-09-11T10:00:00+05:30", { ph: "9876500003", status: "noshow" });
  book("appt:done", "2026-09-12T10:00:00+05:30", { ph: "9876500004", status: "cancelled" });
  book("appt:done", "2026-08-28T10:00:00+05:30", { ph: "9876500005" });
  book("appt:q", "2026-09-28T10:00:00+05:30", { ph: "9876500006" });
  book("appt:q", "2026-10-02T10:00:00+05:30", { ph: "9876500007" });
  let a = await goals.apptsThisMonth(cfg, Date.now());
  is([a.done, a.ahead, a.total], [2, 1, 3], "two held, one still to come; last month's, the no-show and the cancelled one are not appointments the clinic kept");

  // The same visit sits in appt:q until the cron moves it to appt:done, and
  // for one run it can be in both. Counting it twice would flatter the month.
  book("appt:q", "2026-09-02T10:00:00+05:30");
  is((await goals.apptsThisMonth(cfg, Date.now())).total, 3, "a visit sitting in both lists is one appointment, not two");

  console.log("\n  — am I behind? —");
  st = await goals.state(cfg);
  is([st.appts.total, st.appts.target, st.appts.month], [3, 120, "2026-09"], "three of a hundred and twenty this September");
  is(st.appts.pace, 96, "and by the 24th of a 30-day month it should be ninety-six");
  is(st.appts.behind, true, "so it is behind");
  is([st.appts.left, st.appts.daysLeft, st.appts.perDay], [117, 6, 16.7], "a hundred and seventeen left over the seven days that include today");

  await goals.save(cfg, { appts: 3 }, "Owner");
  st = await goals.state(cfg);
  is([st.appts.hit, st.appts.behind], [true, false], "a goal already met is neither behind nor short");

  // Midnight in Eluru is still yesterday in UTC. A month goal read at 00:30
  // on the 1st must be the new month's, starting at nothing.
  console.log("\n  — the first of the month, in Eluru —");
  at("2026-10-01T00:30:00+05:30");
  is((await goals.apptsThisMonth(cfg, Date.now())).month, "2026-10", "half past midnight on the 1st is October, not September");
  is((await goals.apptsThisMonth(cfg, Date.now())).total, 1, "and only October's own appointment counts");
  at("2026-09-24T09:00:00+05:30");

  console.log("\n  — what the morning message says —");
  await goals.save(cfg, { seats: 8, seatsBy: "2026-10-15", appts: 120 }, "Owner");
  const ls = goals.lines(await goals.state(cfg));
  is(ls.length, 2, "one line each");
  is(/3\/8 seats/.test(ls[0]) && /5/.test(ls[0]), true, "seats: where we are and how many more");
  is(/3\/120/.test(ls[1]) && /96 undali/.test(ls[1]) && /93 venakaunnam/.test(ls[1]), true,
    "appointments: where we are, where we should be, and by how much we are short");
  await goals.save(cfg, { seats: 0, appts: 0 }, "Owner");
  is(goals.lines(await goals.state(cfg)), [], "and a goal switched off says nothing at all");

  console.log("\n  — from the control panel —");
  // The real staff.js, with a real signed session: the stub would prove only
  // that the harness lets everybody in.
  delete require.cache[path.join(API, "staff.js")];
  const staff = require(path.join(API, "staff.js"));
  const crypto = require("crypto");
  const session = (phone, role) => {
    const payload = Buffer.from(JSON.stringify({ p: phone, n: role, r: role, e: 0, exp: Date.now() + 3600000 })).toString("base64url");
    return { headers: { authorization: "Bearer " + payload + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(payload).digest("hex") } };
  };
  const yes = await h.call(staff, { a: "goals-set" }, { seats: 6, seatsBy: "2026-10-15", appts: 50 }, session("9010427777", "owner"));
  is([yes.code, yes.body.goals.seats, yes.body.goals.appts], [200, 6, 50], "the owner can set them");
  is(!!(yes.body.goalState && yes.body.goalState.appts), true, "and gets the new standing back with it, so the screen does not have to reload");
  const no = await h.call(staff, { a: "goals-set" }, { seats: 5 }, session("9876500009", "reception"));
  is(no.code, 403, "a role without settings.manage cannot move the goalposts");
  is((await goals.load(cfg)).seats, 6, "and the goal it tried to change is untouched");
  const pnl = await h.call(staff, { a: "panel" }, null, session("9010427777", "owner"));
  is([pnl.body.goals.appts, pnl.body.goalState.appts.target], [50, 50], "the panel carries both the goals and where they stand");

  restore();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\ngoals behave");
  process.exit(fails ? 1 : 0);
})();
