// The fifteen people who asked about a fifty thousand rupee course and never
// heard from anybody again.
//
// cron-followup held an academy enquiry out of every rung it had, with a
// comment saying they had their own follow-up. They did not. So most of what
// matters here is who does NOT get a message: somebody already enrolled,
// somebody who said STOP, somebody the desk has closed, somebody who already
// had this rung, and anybody at all at four in the morning.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const fu = require(path.join(API, "_acadfu.js"));
const docs = require(path.join(API, "_docs.js"));
const cfg = { kind: "pg" };
const H = 3600000;

// 12:00 IST on a day well before the batch starts, so the clock is never the
// thing under test.
const NOON = Date.parse("2026-10-05T12:00:00+05:30");
const lead = (o) => h.run(["LPUSH", "dl_leads", JSON.stringify(Object.assign({ type: "whatsapp", concern: "academy course", name: "Lakshmi" }, o))]);
const to = (ph) => h.sent.filter((s) => (s[0] === "wa" || s[0] === "tpl") && s[1] === ph);
// What was said to somebody, or "" if nothing was. Reaching straight into the
// array throws the moment a message stops going out, and a stack trace is a
// worse answer than a failed line saying which promise was broken.
const said = (ph, i) => String(((to(ph)[i || 0] || [])[2]) || "");
const reset = () => { h.run(["DEL", "dl_leads"]); h.run(["DEL", "acad:fu:log"]); h.sent.length = 0; };

(async () => {
  console.log("CHASING THE ACADEMY ENQUIRIES\n");
  h.run(["SET", "acad:booked", "3"]);          // 7 of 10 seats left

  console.log("  — who it is for —");
  is([fu.isAcademyLead({ concern: "academy course" }), fu.isAcademyLead({ concern: " Academy — fees" })], [true, true], "an academy enquiry is recognised");
  is([fu.isAcademyLead({ concern: "hair fall" }), fu.isAcademyLead({})], [false, false], "a treatment enquiry is not, and nor is a lead with no concern");
  // The one place this is decided. cron-followup holds these out of its own
  // rungs with the SAME function, so the two cannot drift apart.
  const src = require("fs").readFileSync(path.join(API, "cron-followup.js"), "utf8");
  is(/acadfu\.isAcademyLead\(l\)/.test(src), true, "and cron-followup asks this very function rather than keeping a second copy");
  is(/\/\^\\s\*academy\/i/.test(src), false, "the old duplicated regex is gone from it");

  console.log("\n  — day 1 —");
  reset();
  lead({ phone: "9876500101", ts: NOON - 24 * H });
  const r1 = await fu.run(cfg, { now: NOON });
  is([r1.rung1, r1.rung3, r1.rung7], [1, 0, 0], "a day-old enquiry gets the first message and only that");
  is(to("9876500101").length, 1, "one message, not two");
  is(/catalog/i.test(said("9876500101")), true, "asking whether the catalog arrived: " + said("9876500101").slice(0, 70));
  h.sent.length = 0;
  is((await fu.run(cfg, { now: NOON })).rung1, 0, "an hour later it is not sent again");
  is(to("9876500101").length, 0, "nothing goes out twice");

  console.log("\n  — day 3 says the numbers —");
  reset();
  lead({ phone: "9876500102", ts: NOON - 72 * H });
  await fu.run(cfg, { now: NOON });
  const d3 = said("9876500102");
  is(/7 seatlu migilayi/.test(d3), true, "how many seats are left, from acad:booked: " + d3.slice(0, 90));
  is(new RegExp(docs.BATCH.start).test(d3), true, "and when the batch starts");

  // A deadline that has already gone is worse than no deadline. This would
  // have gone out on the 1st of October saying "offer till 30 Sep".
  console.log("\n  — the offer, only while it stands —");
  const before = fu.line(3, 7, docs.BATCH.offerEndMs - H);
  const after = fu.line(3, 7, docs.BATCH.offerEndMs + H);
  is(/Launch offer/.test(before), true, "while the offer is live it is named");
  is(/Launch offer|30 Sep/.test(after), false, "once it has passed it is never mentioned again: " + after.slice(0, 80));

  console.log("\n  — day 7 puts a person on it —");
  reset();
  lead({ phone: "9876500103", ts: NOON - 168 * H });
  const r7 = await fu.run(cfg, { now: NOON });
  is(r7.rung7, 1, "the seventh day comes round");
  is(/phone lo/.test(said("9876500103")), true, "and asks to talk rather than sending more text");

  console.log("\n  — who gets nothing —");
  reset();
  lead({ phone: "9876500104", ts: NOON - 24 * H });
  is((await fu.run(cfg, { now: NOON, optout: new Set(["9876500104"]) })).rung1, 0, "somebody who said STOP");
  reset();
  lead({ phone: "9876500105", ts: NOON - 24 * H });
  h.run(["SET", "acad:ph:9876500105", "st_7"]);          // already enrolled
  is((await fu.run(cfg, { now: NOON })).rung1, 0, "somebody already in the batch — this ladder is for getting in");
  h.run(["DEL", "acad:ph:9876500105"]);
  reset();
  const ts = NOON - 24 * H;
  lead({ phone: "9876500106", ts });
  h.run(["HSET", "dl_status", `${ts}|9876500106`, "closed"]);
  is((await fu.run(cfg, { now: NOON })).rung1, 0, "somebody the desk has closed");
  reset();
  lead({ phone: "9876500107", ts: NOON - 24 * H, concern: "hair fall" });
  is((await fu.run(cfg, { now: NOON })).rung1, 0, "and somebody who never asked about the academy at all");

  console.log("\n  — the hours it will not write in —");
  reset();
  lead({ phone: "9876500108", ts: NOON - 24 * H });
  const night = Date.parse("2026-10-05T04:00:00+05:30");
  is((await fu.run(cfg, { now: night, force: false })).skipped, "quiet hours", "four in the morning: nothing at all");
  is(to("9876500108").length, 0, "not one message");
  const dawn = Date.parse("2026-10-05T09:30:00+05:30");
  is((await fu.run(cfg, { now: dawn })).rung1, 1, "half past nine: it writes");

  console.log("\n  — when there is nothing left to sell —");
  reset();
  lead({ phone: "9876500109", ts: NOON - 24 * H });
  h.run(["SET", "acad:booked", "10"]);
  is((await fu.run(cfg, { now: NOON })).skipped, "no seats left", "a full batch is not chased");
  h.run(["SET", "acad:booked", "3"]);
  // Midday on the day after it starts — an hour it WOULD otherwise write in,
  // so this proves the batch check and not the clock.
  const started = Date.parse("2026-10-21T12:00:00+05:30");
  is((await fu.run(cfg, { now: started })).skipped, "batch started", "and once it has begun there is nothing to join");

  console.log("\n  — a cap, so it never reads as chasing —");
  reset();
  for (let i = 0; i < 12; i++) lead({ phone: "98765001" + (20 + i), ts: NOON - 24 * H });
  is((await fu.run(cfg, { now: NOON })).rung1, 8, "eight in one run, whatever is waiting");

  console.log("\n  — what it did, written down —");
  reset();
  lead({ phone: "9876500140", ts: NOON - 24 * H });
  await fu.run(cfg, { now: NOON });
  const log = await fu.recent(cfg, 5);
  is([log.length, log[0].rung, log[0].phone], [1, 1, "9876500140"], "each one is logged with the rung it was");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe academy ladder behaves");
  process.exit(fails ? 1 : 0);
})();
