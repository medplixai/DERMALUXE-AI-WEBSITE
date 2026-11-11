const h = require("./harness.js");
const sch = h.load("schedule");
const S = (q, b) => h.call(sch, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
// 11:00 tomorrow, by the calendar in Eluru. The obvious version of this —
// add a day to the UTC clock and set the UTC hours — is a different day
// between 18:30 and midnight UTC, because IST is already tomorrow by then.
// The app buckets its day sheet in IST, so the helper that builds the fixture
// has to as well, or this test fails every night after 6pm UTC and passes
// again by morning.
const IST = 330 * 60000;
const tomorrow11 = () => {
  const ist = new Date(Date.now() + IST);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1, 11, 0, 0) - IST;
};

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
  // Filed away, but not gone from the day: the Vachinavi box (11 Nov, point 4).
  const dayCame = await S({ a: "day", day });
  is(dayCame.body.counts.came, 1, "the day says one patient came");
  is(dayCame.body.came.some((r) => r.id === id && r.filed === true && r.status === "done"), true, "and lists the filed visit, marked as filed");
  is(dayCame.body.rows.some((r) => r.id === id), false, "while the expected list no longer has it");

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
  is(w.body.days.length, 60, "two months ahead, for people who ask for a date next month");
  is(w.body.days.some((x) => x.total > 0), true, "with the counts on them");

  // ---- the confirm call ---------------------------------------------------
  // Opening week the agent held 14 slots and the desk rang ONE of them (9 Nov).
  // The list of who still needs the call, oldest booking first, and the one
  // tap that records the call was made.
  console.log("\n  — the confirm call —");
  const H = 3600000;
  const dOf = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  const dayAfterAt = at + 24 * H;
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500101", name: "Oldest Uma", at: dayAfterAt, ts: Date.now() - 5 * H })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500102", name: "Newer Vani", at: dayAfterAt + H, ts: Date.now() - 1 * H })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500103", name: "Confirmed Wali", at: dayAfterAt + 2 * H, ts: Date.now() - 6 * H, cf: true, cfAt: Date.now() })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500104", name: "Yesterday Xavi", at: Date.now() - 20 * H, ts: Date.now() - 30 * H })]);
  const wk = await S({ a: "week" });
  const pend = wk.body.pending.map((r) => r.ph);
  is(pend.indexOf("9876500101") < pend.indexOf("9876500102"), true, "the Confirm-pending list puts the oldest booking first — that patient has waited longest for the call");
  is([pend.includes("9876500103"), pend.includes("9876500104")], [false, false], "a confirmed booking is not on it, nor one whose time has passed");
  is(wk.body.pending.every((r) => r.status === "booked" && !r.cf && r.at > Date.now()), true, "every row on it is a live booking nobody has confirmed");
  const umaRow = (await S({ a: "day", day: dOf(dayAfterAt) })).body.rows.find((r) => r.ph === "9876500101");
  is(umaRow.risk.some((x) => /confirm call pending — 5 gantalu( \d+ nimisha)?/.test(x)), true, "booked five hours ago and nobody rang: the row says so, in hours, not 300 minutes — " + umaRow.risk.join(" / "));
  const vaniBefore = (await S({ a: "day", day: dOf(dayAfterAt) })).body.rows.find((r) => r.ph === "9876500102");
  is(vaniBefore.risk.some((x) => /confirm call pending/.test(x)), true, "an hour is past the forty-five minutes the desk gets");
  const cfm = await S({ a: "confirm" }, { a: "confirm", ph: "9876500101", at: dayAfterAt });
  is([cfm.code, cfm.body.appt.cf, cfm.body.appt.cfBy, cfm.body.appt.cfVia, cfm.body.appt.cfAt > 0], [200, true, "Owner", "desk", true],
    "the desk's call is recorded: confirmed, by whom, over the phone, and when — on a row the agent wrote, found by number and time");
  is((await S({ a: "week" })).body.pending.some((r) => r.ph === "9876500101"), false, "and the row leaves the Confirm-pending list");
  is((await S({ a: "confirm" }, { a: "confirm", id: "nothere" })).code, 404, "confirming one that is not there says so");
  h.as(["appts.view"]);
  is((await S({ a: "confirm" }, { a: "confirm", ph: "9876500102", at: dayAfterAt + H })).code, 403, "somebody who can only look cannot confirm");
  h.as(["*"]);

  // ---- a slot nobody marked -----------------------------------------------
  // 28 of 33 history rows were closed by a timer with nobody saying who came.
  // Such a row is now "unmarked": counted on the day as a question, never as
  // a visit, and it does not hold a chair.
  console.log("\n  — a slot nobody marked —");
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500105", name: "Unmarked Yash", at: dayAfterAt + 3 * H, status: "unmarked", staff: "9876500061", staffName: "Dr Meghana" })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500106", name: "Asked Zoya", at: dayAfterAt + 3 * H, ask: Date.now() })]);
  const dq = await S({ a: "day", day: dOf(dayAfterAt) });
  is([dq.body.counts.unmarked, dq.body.counts.asked], [1, 1], "the day counts the slot nobody marked, and the one the desk is being asked about");
  is(dq.body.rows.find((r) => r.ph === "9876500106").ask > 0, true, "the question is on the row, so the screen can show it");
  const onTop = await S({ a: "create" }, { a: "create", ph: "9876500107", name: "Next", at: dayAfterAt + 3 * H, staff: "9876500061", staffName: "Dr Meghana" });
  is(onTop.code, 200, "an unmarked slot does not hold the doctor: the next patient can be booked over it");
  const twoMore = await S({ a: "create" }, { a: "create", ph: "9876500108", name: "Next2", at: dayAfterAt + 3 * H, staff: "9876500061", staffName: "Dr Meghana" });
  is(twoMore.code, 409, "but a real booking still does");

  // ---- the day as a plan, not a list -------------------------------------
  // An empty morning is not "nothing to do": it is a morning nobody filled.
  console.log("\n  — the day as a plan —");
  const path2 = require("path");
  const Q2 = require(path2.join(process.env.DL_API, "_qualify.js"));
  const dayOf = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  // Tomorrow, unless tomorrow is a Sunday — the clinic is shut then, and a
  // plan for a shut day is legitimately 0 slots. Written as "tomorrow" this
  // test failed every Saturday and nowhere else.
  const open = (t) => new Date(dayOf(t) + "T12:00:00+05:30").getUTCDay() !== 0;
  let tomTs = Date.now() + 86400000;
  while (!open(tomTs)) tomTs += 86400000;
  const tomDay = dayOf(tomTs);
  const plan1 = (await S({ a: "day", day: tomDay })).body.plan;
  is([plan1.slots, plan1.per], [24, 2], "the clinic's day is 24 half-hours, two patients to a slot");
  is([plan1.free.some((f) => /am$/.test(f.time)), plan1.free.some((f) => /[5-8]:\d\d pm$/.test(f.time))], [true, true],
    "and the times offered are spread across the day — a morning and an evening, not twelve nine-o'clocks");
  // a slot filled to capacity is not offered again
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500081", name: "One", at: Date.parse(tomDay + "T16:00:00+05:30") })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500082", name: "Two", at: Date.parse(tomDay + "T16:00:00+05:30") })]);
  h.run(["LPUSH", "blk:q", JSON.stringify({ from: Date.parse(tomDay + "T13:00:00+05:30"), to: Date.parse(tomDay + "T15:00:00+05:30"), note: "doctor leave" })]);
  const plan2 = (await S({ a: "day", day: tomDay })).body.plan;
  is(plan2.free.some((f) => f.time === "4:00 pm"), false, "a slot that is full is not offered");
  is(plan2.free.length <= 12, true, "and the desk is offered a handful, not the whole day");
  is(plan2.free.some((f) => f.time === "1:30 pm" || f.time === "2:00 pm"), false, "nor a time the doctor is away");
  // who the records say to ring
  h.run(["RPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 3600000, type: "whatsapp", phone: "9876500091", name: "Hot Anu", concern: "Hair fall" })]);
  await Q2.absorb({ kind: "pg" }, "9876500091", { village: "Eluru", intent: "book_now", problem: "hair fall", problem_since: "6 nelalu" }, { inboundCount: 3 });
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: "9876500092", name: "Missed Ravi", at: Date.now() - 5 * 86400000, ns: 1, status: "noshow" })]);
  const plan3 = (await S({ a: "day", day: tomDay })).body.plan;
  const kinds = plan3.fill.map((f) => f.kind);
  is([kinds.includes("lead"), kinds.includes("noshow")], [true, true], "the hot enquiry nobody booked, and the patient who never came back, are both on the list");
  is(plan3.fill.find((f) => f.kind === "lead").why, "A grade · Hair fall", "each line says why this person, in a few words");
  is(plan3.fill.filter((f) => f.phone === "9876500091").length, 1, "and nobody appears twice");
  // somebody already booked is not suggested again
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500091", name: "Hot Anu", at: Date.parse(tomDay + "T17:00:00+05:30") })]);
  is((await S({ a: "day", day: tomDay })).body.plan.fill.some((f) => f.phone === "9876500091"), false, "once they are booked they drop off it");
  // what could go wrong with the ones that are booked
  // Three hours out and five days out, so the clock cannot decide the answer.
  const soonAt = Date.now() + 3 * 3600000, farAt = Date.now() + 5 * 86400000;
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500093", name: "Soon", at: soonAt })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500094", name: "Far", at: farAt })]);
  const soonRow = (await S({ a: "day", day: dayOf(soonAt) })).body.rows.find((r) => r.ph === "9876500093");
  const farRow = (await S({ a: "day", day: dayOf(farAt) })).body.rows.find((r) => r.ph === "9876500094");
  is(soonRow.risk.some((x) => /confirm cheyyandi/.test(x)), true, "an unconfirmed appointment a few hours away is flagged");
  is(farRow.risk.some((x) => /confirm cheyyandi/.test(x)), false, "one five days out is not — there is still time");
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: "9876500093", name: "Soon", at: Date.now() - 12 * 86400000, ns: 1, status: "noshow" })]);
  const twice = (await S({ a: "day", day: dayOf(soonAt) })).body.rows.find((r) => r.ph === "9876500093");
  is(twice.risk.includes("mundu 1 sari raaledu"), true, "and a patient who has not turned up before is flagged, in the desk's own words");
  const sun = (await S({ a: "day", day: (function () { for (let i = 0; i < 8; i++) { const d = dayOf(Date.now() + i * 86400000); if (new Date(d + "T12:00:00+05:30").getUTCDay() === 0) return d; } })() })).body.plan;
  is([sun.closed, sun.free.length], [true, 0], "and Sunday is closed — no times are offered at all");

  h.as(["appts.view"]);
  const ro = await S({ a: "create" }, { a: "create", ph: "9876500075", at });
  is(ro.code, 403, "somebody who can only look cannot book");
  is((await S({ a: "day", day })).code, 200, "but can read the day");
  h.as(["leads.view"]);
  is((await S({ a: "day", day })).code, 403, "and somebody with no appointment permission sees nothing");
  h.as(["*"]);

  // Why a booking is still unconfirmed, on the row itself (desk PDF 9 Nov,
  // points 5 and 6): the desk's own record of the number comes first, then
  // the confirm template, then how long the call has been owed.
  console.log("\n  — why 'confirm kaledu' —");
  h.run(["DEL", "appt:q"]);
  const tmr = tomorrow11(), nowMs = Date.now();
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500081", name: "Aruna", at: tmr, ts: nowMs - 5 * 60000, by: "AI agent" })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500082", name: "Bhargavi", at: tmr, ts: nowMs - 3 * 3600000, by: "AI agent" })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500083", name: "Chaitra", at: tmr, ts: nowMs - 20 * 3600000, by: "AI agent", c1: true })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500084", name: "Deepa", at: tmr, ts: nowMs - 2 * 3600000, by: "AI agent" })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500085", name: "Esther", at: tmr, ts: nowMs - 2 * 3600000, by: "hemasri", cf: true, cfAt: nowMs - 3600000 })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500086", name: "Farida", at: tmr, ts: nowMs - 2 * 3600000, by: "AI agent" })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500087", name: "Gita", at: tmr, by: "AI agent" })]);                    // an agent row from before 9 Nov: no booking time
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500088", name: "Hema", at: tmr, ts: nowMs - 2 * 3600000, by: "AI agent" })]);
  // The desk's outcome lives under the LEAD's key — the lead wrote three days
  // ago, the agent booked two hours ago, the desk rang an hour ago. The
  // ringing time is dl_status_ts, and that is what counts (review, 9 Nov).
  const leadTs84 = nowMs - 3 * 86400000;
  h.run(["HSET", "dl_outcome", `${leadTs84}|9876500084`, "noanswer"]);
  h.run(["HSET", "dl_status_ts", `${leadTs84}|9876500084`, String(nowMs - 3600000)]);
  h.run(["HSET", "dl_notes", `${nowMs - 3600000}|9876500086`, JSON.stringify([{ ts: nowMs - 1800000, by: "hemasri", text: "Call chesanu — repu confirm chestanu annaru" }])]);
  // Gita: a "thinking" the desk recorded five months ago on an unrelated enquiry
  h.run(["HSET", "dl_outcome", `${nowMs - 150 * 86400000}|9876500087`, "thinking"]);
  h.run(["HSET", "dl_status_ts", `${nowMs - 150 * 86400000}|9876500087`, String(nowMs - 150 * 86400000)]);
  // Hema: the desk rang BEFORE the agent booked — that call says nothing about this booking
  h.run(["HSET", "dl_outcome", `${nowMs - 3 * 86400000}|9876500088`, "noanswer"]);
  h.run(["HSET", "dl_status_ts", `${nowMs - 3 * 86400000}|9876500088`, String(nowMs - 5 * 3600000)]);
  const wk2 = await S({ a: "week" });
  const whyOf = (ph) => ((wk2.body.pending || []).find((r) => r.ph === ph) || {}).cfWhy || "";
  is(/Ippude book ayindi/.test(whyOf("9876500081")), true, "booked five minutes ago: 'just booked — call'");
  is(/Inka call cheyyaledu — book ayi 3 gantalu/.test(whyOf("9876500082")), true, "three hours and no call: says so, with the hours");
  is(/Confirm message vellindi/.test(whyOf("9876500083")), true, "the day-before confirm template went and nobody answered it");
  is(/Call chesaru — ettaledu/.test(whyOf("9876500084")), true, "the desk rang after the booking and nobody picked up — the desk's own record comes first, read by the time of the call, not of the enquiry");
  is(/Call chesaru — confirm ani cheppaledu/.test(whyOf("9876500086")), true, "a call note without a confirmation reads as 'rang, not confirmed'");
  is(/Inka confirm call cheyyaledu/.test(whyOf("9876500087")), true, "a row with no booking time does not borrow a five-month-old 'thinking' from another enquiry");
  is(/Inka call cheyyaledu — book ayi 2 gantalu/.test(whyOf("9876500088")), true, "a call made before the booking says nothing about it");
  is((wk2.body.pending || []).some((r) => r.ph === "9876500085"), false, "a confirmed row is not in the pending list at all");
  const dayRows = (await S({ a: "day", day: dayOf(tmr) })).body.rows;
  is((dayRows.find((r) => r.ph === "9876500085") || {}).cfWhy, "", "and carries no reason on the day list either");
  is(/ettaledu/.test((dayRows.find((r) => r.ph === "9876500084") || {}).cfWhy || ""), true, "the day list carries the same reason as the week");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nappointments behave");
})();
