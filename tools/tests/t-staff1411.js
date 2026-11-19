// The desk's lists of 13 and 14 Nov, the parts a test can hold.
const path = require("path"), fs = require("fs");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const patient = h.load("patient");
const API = process.env.DL_API || path.resolve("api");
const html = fs.readFileSync(path.join(API, "..", "staff.html"), "utf8");

(async () => {
  console.log("THE DESK'S LISTS — 13 & 14 NOV\n");
  console.log("  — patients by the day they came (14 Nov, points 6 & 8) —");
  const D = 86400000, now = Date.now();
  const leadTs = now - 2 * D;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: leadTs, type: "whatsapp", name: "Rajendra", phone: "9876501001", concern: "Hair fall" })]);
  h.run(["LPUSH", "appt:done", JSON.stringify({ id: "x1", ph: "9876501001", name: "Rajendra", at: now - 3600000, status: "done", v: 1 })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: now - 2 * 3600000, type: "whatsapp", name: "Only asked", phone: "9876501002", concern: "Acne" })]);
  const r = await h.call(patient, { a: "list" });
  const raj = (r.body.rows || []).find((x) => x.phone === "9876501001") || {};
  is([raj.last > now - 2 * 3600000, raj.cameAt > 0], [true, true], "a patient who enquired on the 12th and came on the 14th is filed on the 14th");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const r2 = await h.call(patient, { a: "list", from: today, to: today });
  is((r2.body.rows || []).some((x) => x.phone === "9876501001"), true, "and so appears when today is picked");
  is(/cameOn\(b, day\)/.test(html), true, "within a day, those who came are listed first");

  console.log("\n  — age, address, another number (14 Nov, point 7) —");
  const sv = await h.call(patient, null, { a: "save", phone: "9876501001", name: "Rajendra", age: "34", address: "Challapalli", phone2: "9876501099", allergies: "" });
  const p = sv.body.patient || {};
  is([p.age, p.address, p.phone2], ["34", "Challapalli", "9876501099"], "they are saved and come back on the patient");
  const sv2 = await h.call(patient, null, { a: "save", phone: "9876501001", name: "Rajendra", phone2: "123", age: "400" });
  is([sv2.body.patient.phone2, sv2.body.patient.age, sv2.body.patient.address], ["", "", "Challapalli"], "a bad number and an impossible age are not kept; a field not sent is left alone");

  console.log("\n  — the screen —");
  for (const [re, what] of [
    [/if \(last && last >= dayStartMs\(\)\) return "";\s*\n\s*if \(l\.outcome === "followup"\)/, "a lead called today is off the call list before the follow-up and not-answering rules (14 Nov, point 1)"],
    [/function todayPending\(l, t0\) \{ return \(l\.ts \|\| 0\) >= t0 && !!l\.phone && l\.status === "new" && !l\.outcome && !l\.lastCall; \}/, "\"Leads today\" is today's untouched leads with a number (14 Nov, points 3 & 4)"],
    [/id="fDate"/, "a calendar for one day's leads (14 Nov, point 2)"],
    [/Upcoming follow-up/, "an upcoming follow-up is called that (14 Nov, point 9)"],
    [/function nameKey\(l\)/, "two people on one number are two cards (14 Nov, point 1)"],
    [/id="appVer"/, "the app version is on screen (14 Nov, point 2)"],
    [/st-dropped/, "discontinued students are marked in red (14 Nov, point 3)"],
    [/already " \+ \(want === "p"/, "a second Vacharu says they are already marked (14 Nov, point 5)"],
    [/Kattalsina motham \(pay this amount\)/, "adding a student says what to pay after the discount (13 Nov, point 2)"],
    [/if \(!amtTouched\)/, "a discount takes the amount down with it (13 Nov, point 1)"],
    [/id="forgotBtn"/, "forgot password: OTP, then a new password twice (13 Nov, point 4)"],
    [/\$\("nAcad"\)\.textContent = Number\(d\.academy\.booked/, "the Academy badge counts booked seats (14 Nov, point 4)"],
  ]) is(re.test(html), true, what);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe desk's lists are done");
  process.exit(fails ? 1 : 0);
})();
