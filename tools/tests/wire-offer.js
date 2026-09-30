// One date, written in nine places and two languages.
//
// The launch offer's end date lives in api/_docs.js as BATCH.offerEnd. Most of
// the app reads it from there. The website does not — academy.html is written
// by hand, in English AND Telugu, and says the date fourteen times. The AI
// sales playbook in _facts.js had it typed out three more times.
//
// Moving the offer to 15 October meant changing all of them. Miss one and the
// site quietly sells a deadline that has gone, or the agent tells a patient a
// different date from the page they are reading.
//
// So this walks every place a date is promised and checks it against the one
// in _docs.js. It also watches the Telugu, which is the half most likely to be
// forgotten — and was the half nothing would have caught.
const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "..", "..");
const docs = require(path.join(ROOT, "api", "_docs.js"));
const B = docs.BATCH;
let bad = 0;
const ok = (good, what) => { if (!good) bad++; console.log(`  ${good ? "ok " : "✗  "} ${what}`); };

// Every spelling of the same day that the copy is allowed to use.
const shortNoYear = B.offerEnd.replace(/\s+\d{4}$/, "");          // "15 Oct"
const longNoYear = B.offerEndLong.replace(/\s+\d{4}$/, "");        // "15 October"
const ALLOWED = new Set([B.offerEnd, B.offerEndLong, B.offerEndISO, shortNoYear, longNoYear]);

const TE_MONTHS = { "01": "జనవరి", "02": "ఫిబ్రవరి", "03": "మార్చి", "04": "ఏప్రిల్", "05": "మే", "06": "జూన్",
  "07": "జూలై", "08": "ఆగస్టు", "09": "సెప్టెంబర్", "10": "అక్టోబర్", "11": "నవంబర్", "12": "డిసెంబర్" };
const [oy, om, od] = B.offerEndISO.split("-");
const teDay = String(Number(od));
const teMonth = TE_MONTHS[om];

console.log("OFFER DATE, EVERYWHERE IT IS PROMISED\n");
console.log(`  the one in _docs.js: ${B.offerEnd} · ${B.offerEndLong} · ${B.offerEndISO} · ${teDay} ${teMonth}\n`);

const html = fs.readFileSync(path.join(ROOT, "academy.html"), "utf8");

// English: anything the page says an offer runs "till" / "closes on", plus the
// machine-readable priceValidUntil that Google reads.
const EN = /(?:valid till|till|closes on|priceValidUntil"\s*:\s*")\s*(\d{1,2} [A-Z][a-z]+(?: \d{4})?|\d{4}-\d{2}-\d{2})/g;
const found = [];
for (const m of html.matchAll(EN)) found.push(m[1]);
ok(found.length > 0, `the page promises the date ${found.length} time(s) in English`);
const wrongEn = [...new Set(found.filter((d) => !ALLOWED.has(d)))];
ok(wrongEn.length === 0, wrongEn.length ? `these disagree with _docs.js: ${wrongEn.join(" · ")}` : "every one of them is the date in _docs.js");

// Google reads this one directly, and a stale one keeps showing a dead price.
const iso = [...html.matchAll(/priceValidUntil"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
ok(iso.length > 0 && iso.every((d) => d === B.offerEndISO),
  iso.length ? `priceValidUntil: ${[...new Set(iso)].join(", ")}` : "no priceValidUntil found at all");

// Telugu: "<day> <month> వరకు" — the half nobody remembers to change.
const TE = new RegExp("(\\d{1,2})\\s*(" + Object.values(TE_MONTHS).join("|") + ")[^<]{0,14}వరకు", "g");
const teFound = [...html.matchAll(TE)].map((m) => `${Number(m[1])} ${m[2]}`);
ok(teFound.length > 0, `and ${teFound.length} time(s) in Telugu`);
const wrongTe = [...new Set(teFound.filter((d) => d !== `${teDay} ${teMonth}`))];
ok(wrongTe.length === 0, wrongTe.length ? `Telugu still says: ${wrongTe.join(" · ")} (should be ${teDay} ${teMonth})` : `every Telugu mention says ${teDay} ${teMonth}`);

// Every page, not only the academy one. priceValidUntil is unambiguous and it
// is what Google reads: a second page growing its own offer block later, with
// a date nobody remembers to move, would show a dead price in search results
// long after the page itself was corrected.
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const strayIso = [];
for (const f of pages) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(/priceValidUntil"\s*:\s*"([^"]+)"/g)) {
    if (m[1] !== B.offerEndISO) strayIso.push(`${f}: ${m[1]}`);
  }
}
ok(strayIso.length === 0, strayIso.length ? `a page promises Google a different date — ${strayIso.join(" · ")}` : `every priceValidUntil on all ${pages.length} pages says ${B.offerEndISO}`);

// The API side must never type the date out; it has _docs.js for that.
const skip = new Set(["_docs.js"]);
const typed = [];
for (const f of fs.readdirSync(path.join(ROOT, "api")).filter((x) => x.endsWith(".js") && !skip.has(x))) {
  const src = fs.readFileSync(path.join(ROOT, "api", f), "utf8");
  for (const m of src.matchAll(/(?:offer[^\n]{0,40}?)(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4})/gi)) {
    if (!ALLOWED.has(m[1])) typed.push(`${f}: ${m[1]}`);
  }
}
ok(typed.length === 0, typed.length ? `an offer date typed into the API instead of read from _docs.js — ${typed.join(" · ")}` : "no api file types the offer date out; they all read _docs.js");

console.log(bad ? `\n${bad} PROBLEM(S)` : "\nthe offer date agrees everywhere");
process.exit(bad ? 1 : 0);
