// Where a patient is in their treatment, and where a student is in the course.
const h = require("./harness.js");
const path = require("path"), fs = require("fs");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  const patient = h.load("patient");
  const PT = (q, b) => h.call(patient, q, b);
  const ph = "9876500301";
  for (const l of [{ ts: Date.now() - 30 * 86400000, name: "Latha", phone: ph, message: "acne", key: "k1" }])
    h.run(["RPUSH", "dl_leads", JSON.stringify(l)]);

  console.log("PATIENT — which stage are they at\n");
  let g = await PT({ a: "get", phone: ph });
  is(g.body.patient.stage, "", "a new patient has no stage — nothing is assumed");

  const s1 = await PT({ a: "stage" }, { a: "stage", phone: ph, stage: "consult" });
  is(s1.body.patient.stage, "consult", "the desk sets consultation");
  is(s1.body.patient.stageBy, "Owner", "with who set it");
  is(s1.body.patient.stageAt > 0, true, "and when");

  const s2 = await PT({ a: "stage" }, { a: "stage", phone: ph, stage: "procedure", note: "Laser, 6 sittings" });
  is(s2.body.patient.stage, "procedure", "they move on to the procedure");
  is(s2.body.patient.stageNote, "Laser, 6 sittings", "with a note about what it is");
  is(s2.body.patient.stageLog.length, 2, "and both moves are written down");
  is(s2.body.patient.stageLog[0].from, "consult", "each one knowing what it came from");

  const same = await PT({ a: "stage" }, { a: "stage", phone: ph, stage: "procedure" });
  is(same.body.patient.stageLog.length, 2, "setting the same stage twice does not pad the history");

  const bad = await PT({ a: "stage" }, { a: "stage", phone: ph, stage: "banana" });
  is(bad.code, 400, "a stage that does not exist is refused");

  const cleared = await PT({ a: "stage" }, { a: "stage", phone: ph, stage: "" });
  is(cleared.body.patient.stage, "", "it can be taken off again");
  is(cleared.body.patient.stageLog.length, 3, "and that is recorded too");

  await PT({ a: "stage" }, { a: "stage", phone: ph, stage: "review" });
  const list = await PT({ a: "list" });
  const row = list.body.rows.find((r) => r.phone === ph);
  is(row.stage, "review", "the patient book shows the stage");
  is(row.stageLabel, "Review / maintenance", "in words, not a code");
  is((list.body.stages.find((x) => x.key === "review") || {}).count, 1, "and the whole book can be counted by stage");

  h.as(["leads.view"]);
  is((await PT({ a: "stage" }, { a: "stage", phone: ph, stage: "consult" })).code, 403, "somebody who cannot edit leads cannot move a patient");
  is((await PT({ a: "get", phone: ph })).code, 200, "but can still see where they are");
  h.as(["*"]);

  console.log("\nACADEMY — how far through the course\n");
  const src = fs.readFileSync(path.join(process.env.DL_API, "academy.js"), "utf8");
  const progressOf = eval("(" + src.match(/function progressOf\(s\) \{[\s\S]*?\n\}/)[0] + ")");
  const iso = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

  const notYet = progressOf({ duration: "1 month", startISO: iso(-15), fee: 50000, paid: 10000, created: Date.now() });
  is(notYet.started, false, "a batch that has not started says so");
  is(notYet.percent, 0, "and is at 0%");
  is(/40,000 balance/.test(notYet.where), true, "and leads with the money still owed: " + notYet.where);

  const mid = progressOf({ duration: "1 month", startISO: iso(12), fee: 50000, paid: 50000, onboarded: true, created: Date.now() });
  is(mid.day, 13, "day 13 of a course that began 12 days ago");
  is(mid.totalDays, 30, "a one-month course is 30 days");
  is(mid.daysLeft, 17, "17 to go");
  is(mid.percent, 43, "43% through");

  const long = progressOf({ duration: "3 months", startISO: iso(40), fee: 90000, paid: 90000, created: Date.now() });
  is(long.totalDays, 90, "a three-month course is 90 days, not 30");

  const done = progressOf({ duration: "1 month", startISO: iso(40), fee: 50000, paid: 50000, onboarded: true, created: Date.now() });
  is(/certificate pending/.test(done.where), true, "a finished course that has no certificate says exactly that");
  const cert = progressOf({ duration: "1 month", startISO: iso(40), fee: 50000, paid: 50000, onboarded: true, certNo: "DLA-C-1", created: Date.now() });
  is(cert.doneCount, 6, "and with the certificate every step is done");
  const dropped = progressOf({ duration: "1 month", startISO: iso(5), fee: 50000, paid: 10000, status: "dropped", created: Date.now() });
  is(dropped.where, "Aagipoyaru", "somebody who stopped is not shown as progressing");

  const silly = progressOf({ duration: "", startISO: "", fee: 0, paid: 0, created: Date.now() });
  is(silly.totalDays, 30, "a student with nothing filled in still gets a sane answer");
  is(silly.percent, 0, "and no invented progress");

  // Recording a payment or issuing a certificate is exactly when somebody is
  // watching the progress line — it must not vanish until a reload.
  console.log("\n  — the progress travels with the student —");
  const acsrc = fs.readFileSync(path.join(process.env.DL_API, "academy.js"), "utf8");
  const returns = acsrc.match(/return json\(res, 200, \{ ok: true, student: [^}]+\}\);/g) || [];
  is(returns.length > 0, true, `${returns.length} places hand a student back`);
  is(returns.every((r) => /withProgress\(s\)/.test(r)), true, "and every one of them attaches the progress");
  is(/progress: progressOf\(s\)/.test(acsrc), true, "the list does too");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nstages and progress behave");
})();
