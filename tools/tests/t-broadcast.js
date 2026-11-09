// "broadcast old:" — the owner's WhatsApp command for a factual notice to the
// people who have not written in a fortnight (9 Nov 2026: the clinic moved to
// Rama Mahal on 6 Nov and the old enquiries do not know). Who is in, who is
// out, that the preview waits for "ok", and that nothing with an offer in it
// can go.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API || path.resolve("api");
// The real staff module is not needed here; the harness's stub stands in.
const admin = require(path.join(API, "_admin.js"));
const cfg = { kind: "pg" };
const OWNER = "9010427777";
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const DAY = 86400000, now = Date.now();
const lead = (o) => h.run(["LPUSH", "dl_leads", JSON.stringify(Object.assign({ type: "whatsapp", concern: "Hair fall" }, o))]);
const txt = (r) => (typeof r === "string" ? r : (r && r.text) || "");
const tpls = () => h.sent.filter((s) => s[0] === "tpl" && s[2] === "clinic_update");

(async () => {
  console.log("BROADCAST OLD — the fortnight-silent patients, told a fact\n");
  h.run(["DEL", "dl_leads"]); h.run(["DEL", "appt:q"]); h.run(["DEL", "optout"]); h.sent.length = 0;
  lead({ ts: now - 40 * DAY, name: "Padma Rani", phone: "9876500901" });                                  // old — in
  lead({ ts: now - 20 * DAY, name: "Ravi", phone: "9876500902" });                                        // old — in
  lead({ ts: now - 3 * DAY, name: "Sita", phone: "9876500903" });                                         // wrote this week — out
  lead({ ts: now - 40 * DAY, name: "Tara", phone: "9876500904" }); lead({ ts: now - 2 * DAY, name: "Tara", phone: "9876500904" }); // old AND recent — out
  lead({ ts: now - 30 * DAY, name: "Uma", phone: "9876500905", type: "job" });                            // job seeker — out
  lead({ ts: now - 30 * DAY, name: "Vani", phone: "9876500906", concern: "Academy course enquiry" });     // academy — out
  lead({ ts: now - 30 * DAY, name: "Wasim", phone: "9876500907" });                                       // said STOP — out
  lead({ ts: now - 30 * DAY, name: "Yamini", phone: "9876500908" });                                      // has a slot next week — out
  lead({ ts: now - 30 * DAY, name: "@insta", phone: "", src_id: "ig1", type: "instagram" });              // no number — out
  lead({ ts: now - 25 * DAY, name: "Padma Rani", phone: "9876500901" });                                  // the same person twice — once
  h.run(["SADD", "optout", "9876500907"]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500908", name: "Yamini", at: now + 5 * DAY })]);

  const MSG = "Mana kotha clinic Rama Mahal, R.R. Peta lo 6 November nunchi open ayindi. Mon–Sat 9 AM – 9 PM.";
  const p = await admin.handle(cfg, OWNER, "broadcast old: " + MSG);
  is(/Broadcast preview/.test(txt(p)) && p.confirm === true, true, "the owner gets a preview and is asked for ok");
  is(/\*2\*/.test(txt(p)), true, "two people are in it: " + txt(p).split("\n")[0]);
  const pending = JSON.parse(h.run(["GET", `adm:bc:${OWNER}`]) || "{}");
  is((pending.targets || []).map((t) => t.ph).sort(), ["9876500901", "9876500902"],
    "Padma (once, not twice) and Ravi — not this week's, not the one who wrote again, not the job seeker, academy enquirer, STOP, the one with a slot, or the one with no number");
  is((pending.targets || []).find((t) => t.ph === "9876500901").name, "Padma", "addressed by first name");
  is(h.sent.length, 0, "nothing has gone yet");

  const go = await admin.handle(cfg, OWNER, "ok");
  is(/2 patients ki vellindi/.test(txt(go)), true, "ok sends it: " + txt(go).split("\n")[0]);
  is(tpls().map((s) => s[1]).sort(), ["9876500901", "9876500902"], "two clinic_update templates, one each");
  is(tpls()[0][3][1], MSG, "carrying the owner's words as the update line");
  is(h.run(["GET", `adm:bc:${OWNER}`]), null, "and the pending preview is cleared");

  console.log("\n  — what the gate still refuses —");
  h.sent.length = 0;
  const bad = await admin.handle(cfg, OWNER, "broadcast old: Kotha clinic opening offer — 20% discount ee week");
  is(/pampalemu/.test(txt(bad)) && /8\.1\(x\)/.test(txt(bad)), true, "an offer or a discount is refused with the clause named");
  is(h.run(["GET", `adm:bc:${OWNER}`]), null, "and nothing is left pending");
  h.run(["DEL", "dl_leads"]); lead({ ts: now - 2 * DAY, name: "Only Recent", phone: "9876500911" });
  is(/paata patients evaru leru/.test(txt(await admin.handle(cfg, OWNER, "broadcast old: " + MSG))), true, "with nobody silent for a fortnight it says so instead of sending to the recent ones");
  is(await admin.handle(cfg, "9000000001", "broadcast old: " + MSG), null, "a number that is not the owner's is not an admin at all");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe broadcast behaves");
  process.exit(fails ? 1 : 0);
})();
