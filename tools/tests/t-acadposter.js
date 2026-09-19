// The academy campaign: five posters, posted daily, aimed at one word being
// typed into WhatsApp.
//
// Every assertion here pins the clock. The batch dates are real and fixed, so
// a test written against "today" would start failing on its own the week the
// launch offer closes — which is exactly when nobody would be looking.
const path = require("path");
const h = require("./harness.js");
const docs = require(path.join(__dirname, "..", "..", "api", "_docs.js"));
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const daily = h.load("_daily");
const REAL_NOW = Date.now;
const at = (iso) => { Date.now = () => Date.parse(iso); };
const restore = () => { Date.now = REAL_NOW; };

const DURING = "2026-09-18T10:00:00+05:30";           // offer open, batch ahead
const AFTER_OFFER = "2026-10-05T10:00:00+05:30";      // offer closed, batch ahead
const AFTER_BATCH = "2026-11-01T10:00:00+05:30";      // batch has started

const booked = (n) => h.run(["SET", "acad:booked", String(n)]);
const keys = daily.ACADEMY_TOPICS.map((t) => t.key);

(async () => {
  console.log("ACADEMY POSTER CAMPAIGN\n");
  is(daily.ACADEMY_TOPICS.length, 5, "five posters, one per reason somebody does not sign up");
  is(new Set(keys).size, 5, "all with their own key");
  is(daily.ACADEMY_TOPICS.every((t) => t.page === "academy.html"), true, "all pointing at the academy page");

  console.log("\n  — when it runs —");
  at(DURING); booked(3);
  const st = await daily.academyState({ kind: "pg" });
  is(st.on, true, "seats left and the batch ahead: it runs");
  is(st.left, 7, "seven of ten left");
  is(st.offerDays, 12, "twelve days of launch price left — counted by the calendar, not by dividing a duration");
  is(st.batchDays, 32, "and thirty-two to the batch");
  const t1 = await daily.academyTopic({ kind: "pg" });
  is(!!t1 && keys.includes(t1.key), true, "and a poster comes back");

  console.log("\n  — when it must not —");
  booked(10);
  is((await daily.academyState({ kind: "pg" })).on, false, "a full batch stops advertising seats");
  is(await daily.academyTopic({ kind: "pg" }), null, "and no poster is built");
  booked(3);
  at(AFTER_BATCH);
  is((await daily.academyState({ kind: "pg" })).on, false, "and once the batch has started it stops too");
  at(DURING);

  console.log("\n  — the owner's switch —");
  h.run(["SET", "acad:dp", "0"]);
  is((await daily.academyState({ kind: "pg" })).on, false, "off means off");
  h.run(["SET", "acad:dp", "1"]); booked(10);
  is((await daily.academyState({ kind: "pg" })).on, true, "and on means on, even with the batch full");
  h.run(["DEL", "acad:dp"]); booked(3);

  console.log("\n  — what the line under the headline says —");
  const base = daily.ACADEMY_TOPICS[0];
  at(DURING);
  is(daily.academySub(base, { left: 2, offerDays: 12, batchDays: 32 }),
    "Only 2 seats left · Launch price ends in 12 days", "nearly gone, and closing: both, seats first");
  is(daily.academySub(base, { left: 9, offerDays: 12, batchDays: 32 }),
    "Launch price ends in 12 days · Batch 1 — 20 October 2026", "nine left is not scarcity, so it does not pretend");
  is(daily.academySub(base, { left: 2, offerDays: -3, batchDays: 15 }),
    "Only 2 seats left · Starts in 15 days", "once the price has closed it stops promising it");
  is(daily.academySub(base, { left: 9, offerDays: -3, batchDays: 15 }),
    "Starts in 15 days · Batch 1 — 20 October 2026", "and falls back to the date");
  // The last day of an offer is the day it matters most, and "in 0 days" or
  // "in 1 day" on the morning it closes is the classic countdown bug.
  is(daily.academySub(base, { left: 9, offerDays: 1, batchDays: 33 }),
    "Launch price ends tomorrow · Batch 1 — 20 October 2026", "the day before reads as tomorrow");
  is(daily.academySub(base, { left: 9, offerDays: 0, batchDays: 32 }),
    "Launch price ends today · Batch 1 — 20 October 2026", "and the last day reads as today, not as over");
  is(daily.academySub(base, { left: 9, offerDays: -1, batchDays: 1 }),
    "Starts tomorrow · Batch 1 — 20 October 2026", "same for the batch itself");

  console.log("\n  — a poster built after the offer closes —");
  at(AFTER_OFFER); booked(3);
  const t2 = await daily.academyTopic({ kind: "pg" });
  is(/Launch price/.test(t2.sub), false, "says nothing about a launch price that has expired");

  console.log("\n  — not the same one twice —");
  at(DURING);
  h.run(["DEL", "dp:hist"]);
  keys.slice(0, 4).forEach((k) => h.run(["LPUSH", "dp:hist", `${k}|2026-09-17`]));
  const t3 = await daily.academyTopic({ kind: "pg" });
  is(t3.key, keys[4], "with four just posted, the fifth is the one left");

  console.log("\n  — and never by accident on an ordinary day —");
  h.run(["DEL", "dp:hist"]);
  let leaked = 0;
  for (let i = 0; i < 300; i++) { const t = await daily.pickTopic({ kind: "pg" }); if (t.pillar === "academy") leaked++; }
  is(leaked, 0, "300 ordinary picks, not one academy poster among them");
  is((await daily.pickTopic({ kind: "pg" }, "acad-seats")).key, "acad-seats", "but asking for one by name still works");

  console.log("\n  — the caption has to carry the way in —");
  const cap = await daily.writeCaption(Object.assign({}, base, { academy: { left: 2, offerDays: 12, batchDays: 32 } }));
  is(/\bACADEMY\b/.test(cap), true, "the word the WhatsApp agent is listening for");
  is(/wa\.me\/919959134666/.test(cap), true, "and a link that opens the chat");
  is(cap.includes(docs.BATCH.start), true, "the real batch date");
  is(/Only 2 seats left/.test(cap), true, "and the real number of seats");
  // Nobody may be promised money or a job for taking a course.
  is(/guarantee|guaranteed|assured (job|placement)|earn ₹|income of|salary of/i.test(cap), false,
    "no promise of earnings, a job, or placement");

  const capAfter = await daily.writeCaption(Object.assign({}, base, { academy: { left: 9, offerDays: -2, batchDays: 15 } }));
  is(/Launch fees close/.test(capAfter), false, "and once the offer is over the caption drops it");

  console.log("\n  — the picture itself has to say what to type —");
  // Most people on Instagram never open the caption. If the word that starts
  // the conversation is only in the caption, the poster collects nothing.
  const html = daily.posterHtml(Object.assign({}, base, { sub: "Only 3 seats left" }), null);
  is(/WhatsApp &quot;ACADEMY&quot;|WhatsApp "ACADEMY"/.test(html), true, "the pill tells them the word");
  is(/99591 34666/.test(html), true, "beside the number to send it to");
  is(/DermaLuxe Academy · Eluru/.test(html), true, "and it is branded as the academy, not the clinic");
  is(/MD Dermatologists/.test(html), false, "not as a treatment advert");

  const clinicHtml = daily.posterHtml(daily.TOPICS[0], null);
  is(/Eluru · MD Dermatologists/.test(clinicHtml), true, "while an ordinary poster is unchanged");
  is(/ACADEMY/.test(clinicHtml), false, "and says nothing about a course");

  console.log("\n  — a real person is never drawn by a machine —");
  const trainer = daily.ACADEMY_TOPICS.find((t) => t.key === "acad-trainer");
  is(/Meghana/.test(trainer.img), false,
    "the trainer poster asks the image model for a room, not a likeness of a named doctor");
  is(/Meghana/.test(trainer.sub), true, "her name is set in type instead");

  console.log("\n  — the picture is drawn for the headline —");
  const clinic = daily.TOPICS.find((t) => t.key === "hydrafacial");
  const pr = daily.imagePrompt(clinic);
  is(pr.includes(clinic.h1), true, "the image model is told the headline");
  is(pr.includes(clinic.img), true, "as well as the scene");
  is(/Do NOT write the headline or any other words/.test(pr), true, "and told not to letter it into the picture");

  console.log("\n  — the doctor at the foot of the poster —");
  h.run(["DEL", "dp:doctor"]);
  const acadDoc = await daily.pickDoctor({ kind: "pg" }, daily.ACADEMY_TOPICS[0]);
  is(acadDoc && acadDoc.key, "meghana", "an academy poster shows the trainer");
  is(!!(acadDoc && acadDoc.b64.length > 1000), true, "with her real photograph, read from the site's own files");
  const seen = new Set();
  for (const d of ["2026-09-19", "2026-09-20", "2026-09-21"]) { at(d + "T07:00:00+05:30"); seen.add((await daily.pickDoctor({ kind: "pg" }, clinic)).key); }
  is(seen.size, 3, "clinic posters take the three doctors in turn: " + [...seen].join(", "));
  h.run(["SET", "dp:doctor", "sai"]);
  is((await daily.pickDoctor({ kind: "pg" }, daily.ACADEMY_TOPICS[0])).key, "sai", "the owner can pin one");
  h.run(["SET", "dp:doctor", "off"]);
  is(await daily.pickDoctor({ kind: "pg" }, clinic), null, "or take the doctor off");
  h.run(["DEL", "dp:doctor"]);
  at(DURING);

  const withDoc = daily.posterHtml(clinic, null, await daily.pickDoctor({ kind: "pg" }, clinic));
  is(/Your doctor/.test(withDoc) && /MD \(DVL\)/.test(withDoc), true, "the poster names the doctor and her degree");
  is(/Opp\. Happy Mobiles/.test(withDoc), true, "and still carries the address");
  is(/99591 34666/.test(withDoc), true, "and the WhatsApp number");
  const noDoc = daily.posterHtml(clinic, null, null);
  is(/DermaLuxe by Medicare Skin And Hair Clinics/.test(noDoc) && !/Your doctor/.test(noDoc), true,
    "with no doctor it falls back to the clinic's own footer, not a gap");
  const acadHtml = daily.posterHtml(daily.ACADEMY_TOPICS[0], null, acadDoc);
  is(/Your trainer/.test(acadHtml) && /Meghana Valeti/.test(acadHtml), true, "an academy poster calls her the trainer");

  console.log("\n  — not the same dark room every day —");
  // Every picture was told "dark charcoal-black background with warm golden
  // accents", and several briefs were an empty room with a lamp; the feed
  // became one picture posted five times.
  const all = daily.TOPICS.concat(daily.ACADEMY_TOPICS);
  const bare = all.filter((t) => /\bno people\b|\bempty\b/i.test(t.img)).map((t) => t.key);
  is(bare, [], "no brief asks for an empty room any more");
  is(/charcoal-black background/.test(daily.imagePrompt(Object.assign({}, clinic, { look: daily.LOOKS[1] }))), false,
    "and the dark studio is one look among several, not a rule on every picture");
  is(daily.LOOKS.length >= 4, true, "four looks to choose from");
  h.run(["DEL", "dp:looks"]); h.run(["LPUSH", "dp:looks", "studio"]); h.run(["LPUSH", "dp:looks", "daylight"]);
  const drawn = new Set();
  for (let i = 0; i < 60; i++) drawn.add((await daily.pickLook({ kind: "pg" })).key);
  is(drawn.has("studio") || drawn.has("daylight"), false, "the last two days' looks are not used today");
  is(drawn.size, 2, "the other two are: " + [...drawn].join(", "));
  is(/never show a doctor's or clinician's face/.test(daily.imagePrompt(clinic)), true,
    "and no invented doctor's face beside the real doctor's photo");

  restore();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe academy campaign behaves");
  process.exit(fails ? 1 : 0);
})();
