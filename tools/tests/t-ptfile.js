// The patient file, whole: past visits and no-shows, ratings, the WhatsApp
// conversation, and what they have paid — each shown only to those whose
// role covers it. A receptionist without money.view must not see a
// patient's spend through the file; somebody without inbox.view must not
// read the chat through it.
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const patient = h.load("patient");
const inbox = require(require("path").join(process.env.DL_API, "_inbox.js"));
const PH = "9876501001", DAY = 86400000, now = Date.now();

(async () => {
  console.log("THE PATIENT FILE\n");
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: now - 40 * DAY, name: "Sita Rani", phone: PH, type: "whatsapp", concern: "Acne scars" })]);
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: PH, at: now - 30 * DAY, concern: "MNRF 1" })]);
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: PH, at: now - 10 * DAY, concern: "MNRF 2", ns: true })]);
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: "9876501002", at: now - 10 * DAY, concern: "someone else" })]);
  h.run(["LPUSH", "rv:log", JSON.stringify({ ph: PH, rating: 5, concern: "MNRF", ts: now - 29 * DAY })]);
  h.run(["SET", "bill:x1", JSON.stringify({ id: "x1", phone: PH, items: [{ name: "MNRF", price: 6000, qty: 2 }], payments: [{ amount: 9000, ts: now }] })]);
  h.run(["LPUSH", `bill:of:${PH}`, "x1"]);
  await inbox.log({ kind: "pg" }, PH, { dir: "in", text: "Repu vastanu", name: "Sita" });
  await inbox.log({ kind: "pg" }, PH, { dir: "out", text: "Super 🙏", by: "ai" });

  const full = (await h.call(patient, { a: "get", phone: PH })).body.patient;
  is(full.past.map((v) => [v.concern, v.noShow]), [["MNRF 2", true], ["MNRF 1", false]], "past visits are there, newest first, with the one they missed marked");
  is([full.counts.came, full.counts.noShows], [1, 1], "counted: came once, missed once");
  is(full.past.some((v) => v.concern === "someone else"), false, "and nobody else's");
  is(full.ratings.map((r) => r.rating), [5], "their rating is there");
  is(full.spent, { bills: 1, billed: 12000, paid: 9000, due: 3000 }, "the owner sees what they were billed, paid and still owe");
  is(full.chat.last.map((m) => m.text), ["Repu vastanu", "Super 🙏"], "and the WhatsApp conversation");

  h.as(["leads.view"]);
  const desk = (await h.call(patient, { a: "get", phone: PH })).body.patient;
  is([desk.spent, desk.chat], [null, null], "without money.view and inbox.view, neither the money nor the chat comes back");
  is(desk.past.length, 2, "but the visits do");
  h.as(["leads.view", "leads.edit"]);
  const saved = (await h.call(patient, {}, { a: "note", phone: PH, text: "Prefers evening slots" })).body.patient;
  is([saved.spent, saved.chat], [null, null], "nor after saving a note, which returns the file again");
  h.as(["*"]);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe patient file behaves");
  process.exit(fails ? 1 : 0);
})();
