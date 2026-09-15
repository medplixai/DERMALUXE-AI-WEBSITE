const h = require("./harness.js");
const money = h.load("money"), expense = h.load("expense"), attend = h.load("attend");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

// A moment expressed in Eluru time
const ist = (s) => new Date(s + "+05:30").getTime();

console.log("THE CLOCK — a day in Eluru, not in London\n");

// istDay across the boundary
const d = money.istDay;
is(d(ist("2026-09-15T23:59:00")), "2026-09-15", "11:59 PM is still the 15th");
is(d(ist("2026-09-16T00:01:00")), "2026-09-16", "12:01 AM is the 16th");
is(d(ist("2026-09-16T00:00:00")), "2026-09-16", "midnight exactly is the new day");
is(d(ist("2026-09-15T05:29:00")), "2026-09-15", "5:29 AM — the hour UTC would get wrong");
is(d(ist("2026-10-01T00:30:00")), "2026-10-01", "the first of the month at half past midnight");
is(d(ist("2026-12-31T23:30:00")), "2026-12-31", "New Year's Eve stays in the old year");
is(d(ist("2027-01-01T00:30:00")), "2027-01-01", "and the new year starts on time");

// the hour the crons gate on
const istHour = (t) => new Date(t + 330 * 60000).getUTCHours();
is(istHour(ist("2026-09-15T09:15:00")), 9, "the 9 AM briefing fires at IST 9");
is(istHour(ist("2026-09-15T00:15:00")), 0, "midnight is hour 0, not 18");
is(istHour(ist("2026-09-15T23:45:00")), 23, "and 11:45 PM is 23");

// the nightly backup: 20:20 UTC
is(d(Date.UTC(2026, 8, 15, 20, 20)), "2026-09-16", "the 20:20 UTC backup is stamped with the Eluru day it runs in (1:50 AM)");
console.log("      — so the file named 2026-09-16 holds the night of the 15th→16th");

// month boundaries in the expense summary
const dom = expense.daysOfMonth;
const firstOfMonth = dom(d(Date.now()).slice(0, 7));
is(firstOfMonth[0].endsWith("-01"), true, "a month starts on the 1st");
is(firstOfMonth[firstOfMonth.length - 1], d(Date.now()), "and stops at today, never the future");
is(dom("2026-02").length <= 28, true, "February is not given 30 days");
is(dom("2024-02").length <= 29, true, "and a leap February is allowed 29");
is(dom("2020-01").length, 31, "a past month is given all of its days");

// attendance: the month key derived from a day string
const am = attend.istDay;
is(am(ist("2026-10-01T00:10:00")), "2026-10-01", "attendance agrees about the 1st");
is(am(ist("2026-09-30T23:50:00")), "2026-09-30", "and about the last night of September");

// a 9 PM shift belongs to the day the person thinks it does
const shift = ist("2026-09-15T21:30:00");
is(am(shift), "2026-09-15", "a 9:30 PM clock-in is that evening, not the next morning UTC");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe clock behaves");
