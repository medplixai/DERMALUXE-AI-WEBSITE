// Job seekers' documents reach HR, and nobody is asked the same thing seven times.
//
// 7 Nov: a cosmetologist was asked by the agent for her resume and
// certificates, sent six files, and got "Document analysis cheyalenu" six
// times. 10 Nov: an applicant at the CV step got "CV file attach chesi
// pampandi" seven times in six minutes. The real _hr.js, against the store.
process.env.ADMIN_PHONES = "9010427777";
process.env.HR_PHONES = "9000000011";
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const cfg = { kind: "pg" };

(async () => {
  console.log("JOB SEEKERS' DOCUMENTS\n");
  const n = h.load("_notify");
  const forwarded = [];
  n.sendWaDocument = async (to, id, name, caption) => { forwarded.push([to, id, caption]); return true; };
  const hr = h.load("_hr");

  console.log("  — after the application —");
  await hr.setStatus(cfg, "9876500501", "applied");
  const r1 = await hr.handle(cfg, "9876500501", "", { id: "M1", name: "10th memo.pdf" });
  is(/HR team ki pampanu/.test(r1 && r1.text), true, "a certificate from somebody who applied is taken, not refused");
  is(forwarded.some((f) => f[0] === "9000000011" && f[1] === "M1"), true, "and goes to HR's WhatsApp");
  await hr.handle(cfg, "9876500501", "", { id: "M1", name: "10th memo.pdf" });
  is(forwarded.filter((f) => f[1] === "M1" && f[0] === "9000000011").length, 1, "the same file twice is forwarded once");
  const r2 = await hr.handle(cfg, "9876500502", "", { id: "M2", name: "My Resume.pdf" });
  is(/HR team ki pampanu/.test(r2 && r2.text), true, "a file named like a CV, from somebody who has not applied, also goes to HR");
  is(await hr.handle(cfg, "9876500503", "", { id: "M3", name: "lab report.pdf" }), null, "a patient's lab report is not a job document — left to the agent");

  console.log("\n  — the CV step —");
  for (const [t, d] of [["JOBS"], ["Therapist"], ["Anusha K"], ["Fresher"], ["BSc Cosmetology"], ["Eluru"]]) await hr.handle(cfg, "9876500504", t, d || null);
  const a1 = await hr.handle(cfg, "9876500504", "ok", null);
  is(/CV file attach/.test(a1.text), true, "first time without a file: asked once more");
  const a2 = await hr.handle(cfg, "9876500504", "photo pampanu", null);
  is([/Application received/.test(a2.text), /tarvata ikkade PDF/.test(a2.text)], [true, true], "second time: the application goes in, with the CV to follow — not a seventh ask");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\njob seekers' documents reach HR");
  process.exit(fails ? 1 : 0);
})();
