// The calendar: machines and rooms that take one patient at a time, and the
// waitlist that fills a cancelled slot.
//
// Two patients on the one laser at the same moment is the clash reception
// most needs to hear about, and it was not checked. A cancellation leaves a
// slot the clinic has already lost money on unless somebody who wanted an
// earlier one is offered it. And a cancelled appointment is not a visit: it
// must not get "how was your visit?" the next morning.
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const sch = h.load("schedule"), followup = h.load("cron-followup");
const tomorrow = (hh, mm) => { const d = new Date(Date.now() + 19800000 + 86400000); d.setUTCHours(hh, mm || 0, 0, 0); return d.getTime() - 19800000; };
const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

(async () => {
  console.log("THE CALENDAR\n");

  console.log("  — one machine, one patient —");
  const a1 = await h.call(sch, {}, { a: "create", ph: "9876501301", name: "Anu", at: tomorrow(11), mins: 45, room: "Laser room" });
  is(a1.code, 200, "a laser appointment is booked");
  const a2 = await h.call(sch, {}, { a: "create", ph: "9876501302", name: "Bindu", at: tomorrow(11, 30), mins: 30, room: "laser room" });
  is([a2.code, /Laser room/.test(a2.body.error)], [409, true], "a second patient on the same laser at the same time is stopped, whatever the capitals");
  is((await h.call(sch, {}, { a: "create", ph: "9876501302", name: "Bindu", at: tomorrow(11, 45), mins: 30, room: "Laser room" })).code, 200, "right after it is fine");
  is((await h.call(sch, {}, { a: "create", ph: "9876501303", name: "Chitra", at: tomorrow(11), mins: 30, room: "Hydrafacial" })).code, 200, "and another machine at the same time is fine");
  const day = (await h.call(sch, { a: "day", day: istDay(tomorrow(11)) })).body;
  is(day.rooms.includes("Laser room"), true, "the day comes with the list of rooms and machines");
  h.as(["appts.view", "appts.edit"]);
  is((await h.call(sch, {}, { a: "rooms-save", rooms: ["X"] })).code, 403, "only the owner changes that list");
  h.as(["*"]);
  const rs = await h.call(sch, {}, { a: "rooms-save", rooms: ["Laser room", "laser room", "PRP room", ""] });
  is(rs.body.rooms, ["Laser room", "PRP room"], "the owner's list, without duplicates or blanks");

  console.log("\n  — the waitlist —");
  const dayT = istDay(tomorrow(11));
  await h.call(sch, {}, { a: "wait-add", ph: "9876501310", name: "Devi", concern: "PICO", day: dayT });
  await h.call(sch, {}, { a: "wait-add", ph: "9876501311", name: "Esha", concern: "Peel" });
  await h.call(sch, {}, { a: "wait-add", ph: "9876501312", name: "Farah", concern: "PRP", day: istDay(tomorrow(11) + 3 * 86400000) });
  is((await h.call(sch, { a: "day", day: dayT })).body.wait.map((w) => w.name), ["Devi", "Esha", "Farah"], "people waiting are on the day's screen");
  const c = await h.call(sch, {}, { a: "status", id: a1.body.appt.id, status: "cancelled" });
  is(c.body.waitMatches.map((w) => w.name), ["Devi", "Esha"], "a cancellation names who wants that day (or any day) — not someone who wants another day");
  is(c.body.freed.at, tomorrow(11), "and which slot came free");
  h.sent.length = 0;
  const off = await h.call(sch, {}, { a: "wait-offer", wid: c.body.waitMatches[0].id, at: c.body.freed.at });
  is(off.code, 200, "the slot is offered");
  is(h.sent.some((s) => s[0] === "wa" && s[1] === "9876501310" && /YES/.test(s[2])), true, "to the patient on WhatsApp, asking them to reply YES");
  const bk = await h.call(sch, {}, { a: "create", ph: "9876501310", name: "Devi", at: tomorrow(11), mins: 30, room: "Laser room", fromWait: c.body.waitMatches[0].id });
  is(bk.code, 200, "the freed laser slot can be booked for them");
  is((await h.call(sch, { a: "day", day: dayT })).body.wait.map((w) => w.name), ["Esha", "Farah"], "and they leave the waitlist");
  const w2 = (await h.call(sch, { a: "day", day: dayT })).body.wait[0];
  await h.call(sch, {}, { a: "wait-remove", wid: w2.id });
  is((await h.call(sch, {}, { a: "wait-offer", wid: w2.id, at: tomorrow(15) })).code, 404, "somebody taken off the list cannot be offered a slot");

  console.log("\n  — a cancelled appointment is not a visit —");
  const Date0 = Date.now;
  const yesterday = Date0() - 86400000;
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: "9876501320", name: "Gita", at: yesterday, status: "cancelled" })]);
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: "9876501321", name: "Hema", at: yesterday, status: "done" })]);
  const d0 = (() => { const d = new Date(Date0() + 19800000); d.setUTCHours(10, 45, 0, 0); return d.getTime() - 19800000; })();
  Date.now = () => d0;
  h.sent.length = 0;
  await h.call(followup, { key: "local-admin" });
  Date.now = Date0;
  const toGita = h.sent.filter((s) => s[1] === "9876501320").length, toHema = h.sent.filter((s) => s[1] === "9876501321").length;
  is([toGita, toHema > 0], [0, true], "the morning after, the patient who came is asked how it went — the one who cancelled is not");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe calendar behaves");
  process.exit(fails ? 1 : 0);
})();
