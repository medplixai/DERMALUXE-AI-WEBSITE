// What the clinic is allowed to say, checked against every place it says it.
//
// The NMC's Guidelines on advertising by registered medical practitioners
// (R-13014/01/2024-Ethics, issued 6 October 2026, in force immediately) are
// not a style preference. Clause 10 grades the penalties from a warning up to
// removal from the register for one to three years, and clause 4.4 says that
// publishing through an agency, a platform or an automated system does not
// move the responsibility off the doctor.
//
// Most of this app writes its own copy. The daily poster, the Instagram
// caption, the ad plan and the WhatsApp agent all generate language at
// runtime, and a model that has read the whole internet will reach for "best",
// "painless" and "100% natural" unless something stops it. The rules below
// are therefore checked in two places: the words that are already written
// down, and the instructions that tell a model what to write next.
//
// A finding here is not a lint warning. It is a sentence that should not be
// in front of a patient.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
let bad = 0;
const ok = (good, what) => { if (!good) bad++; console.log(`  ${good ? "ok " : "✗  "} ${what}`); };

// Pages and modules a patient or a regulator actually reads. The staff app and
// the packaged mobile builds are internal tools, not advertising, and the
// before/after timeline inside them is a clinical record — 6.1 permits that,
// it is 8.1(v) promotion that does not.
const SKIP_DIR = /^(node_modules|\.git|\.vercel|app|tools)$/;
// Not advertising, and each for its own reason: the staff console and the
// legal pages are not promotion; _admin.js is the owner's own WhatsApp console;
// _exam.js is the weekly test's cast of imaginary patients, whose whole job is
// to say the forbidden thing and see whether the agent repeats it; consent.js
// is the consent form a patient signs, which states that nothing is guaranteed.
const SKIP_FILE = /^(staff|privacy|terms)\.html$|^(_admin|_exam|consent)\.js$/;
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP_DIR.test(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(html|js)$/.test(e.name) && !SKIP_FILE.test(e.name)) files.push(p);
  }
})(ROOT);
const rel = (p) => path.relative(ROOT, p);

// What a patient could actually read, line by line, with the line numbers the
// file actually has. An earlier version stripped comments out of the whole
// text before splitting it, which quietly shifted every line number after the
// first block comment — and a finding that points at the wrong line is a
// finding the next person cannot check.
//
// Comments go first: a note to the next programmer has never been shown to a
// patient, and several of them necessarily quote the very words they forbid.
function readable(p) {
  const lines = fs.readFileSync(p, "utf8").split("\n");
  let inStyle = false, inBlock = false;
  return lines.map((ln) => {
    if (inBlock) { if (/\*\//.test(ln)) inBlock = false; return ""; }
    if (inStyle) { if (/<\/style>/i.test(ln)) inStyle = false; return ""; }
    if (/<style[\s>]/i.test(ln)) { inStyle = !/<\/style>/i.test(ln); return ""; }
    if (/^\s*\/\*/.test(ln)) { inBlock = !/\*\//.test(ln); return ""; }
    if (/^\s*(\/\/|\*|<!--)/.test(ln)) return "";
    return ln.replace(/<!--.*?-->/g, "");
  });
}

// A line that defines a pattern is machinery, not copy. _lint.js and _trust.js
// have to spell out "guarantee" in order to detect somebody else saying it.
const isPattern = (ln) => /=\s*\/|\.test\(|new RegExp|\breplace\(\//.test(ln);

// An absolute that comes with its own caveat is disclosure, which is what
// 8.1(vi) asks for; the clause is aimed at the claim that stands alone.
const CAVEAT = /\b(mild|usually|most|little|some|can |may |occasion|rare|settles?|few hours|normal)\b|కొద్దిగా|సాధారణంగా|దాదాపు|రావచ్చు|కొన్ని గంట|చాలామందికి|చాలా మందికి/i;

const RULES = [
  { clause: "8.1(iii)", what: "'painless' — the clause names it",
    re: /\bpainless\b|నొప్పి\s*లేదు|నొప్పి\s*లేని/gi,
    // The ad planner's rule has to quote the forbidden words in order to
    // forbid them; that line is an instruction to a model, not ad copy.
    allow: /NEVER write|binds every word/ },
  { clause: "8.1(iii)", what: "patient counts and success rates",
    re: /\d[\d,]*\s*(lakh|lac|lakhs)\+?\s*(happy|satisfied|patients|clients)|happy clients|సంతృప్త\s*క్లయింట్|\b\d{1,3}%\s*success/gi },
  { clause: "8.1(ix)", what: "superiority claims — best / No.1 / leading / world-class",
    re: /\b(best|finest|No\.?\s*1|number one|unmatched|most trusted)\b|world[\s-]?class|five[\s-]?star|ఉత్తమ|బెస్ట్|ప్రపంచ\s*స్థాయి|ఫైవ్-స్టార్/gi,
    // "your best self" is about the patient, not a claim that this clinic beats
    // another one; "Best for" heads a list of who a treatment suits; the rest
    // are ordinary JavaScript identifiers for a highest-scoring item.
    // "your best self" is the patient, not the clinic; "Best for" heads a list
    // of who a treatment suits; "best results when started early" is about
    // timing. The rest are ordinary identifiers for a highest-scoring item.
    allow: /your best self|మీ ఉత్తమ రూపాని|>Best for<|\b(let|const|var)\s+best|best(Score|Cost|Day|Img)|\bbest\s*[=!<>,);.\]]|[.[]best\b|\bbest\)|Best-effort|best effort|which should I choose|బెస్ట్ ఫలితం కోసం చాలా మంది|NEVER write|binds every word|best topic|\$\{best\}|Best for|best suits|best when|works best|best combined|best control|at its best|బెస్ట్‌గా|బెస్ట్ కంట్రోల్|All the best/i,
    // "Starting early gives the best results" is advice about when to begin,
    // not a claim that this clinic beats another one.
    allowEarly: /\b(early|fresh|starting early|sooner)\b|ముందుగా|ముందే/i },
  { clause: "8.1(vi)", what: "absolutes that conceal risk — no downtime / no risk / no side effects",
    re: /\bno (downtime|risk|redness|peeling|side.?effects?|scars)\b|రిస్క్\s*లేదు|డౌన్‌టైమ్\s*లేదు|ఎరుపు\s*లేదు/gi,
    // "No linear scar" is the one absolute that is simply true of FUE, and a
    // question asking whether there is downtime is not a claim that there is
    // none. Everything else has to carry its caveat — see CAVEAT above.
    // "No linear scar" and "no allergy risk with your own blood" are the two
    // absolutes that are simply true of the procedure named, and each rules out
    // one specific risk rather than risk in general.
    allow: /no linear scars?|no allergy risk|అలర్జీ రిస్క్ లేదు|Is there downtime|does it hurt|downtime\?|డౌన్‌టైమ్ ఎంత|డౌన్‌టైమ్ ఉంటుందా/i,
    caveatOk: true },
  { clause: "8.1(vi)", what: "guarantees and miracle claims",
    re: /\bguarantee[ds]?\b|\bmiracle\b|100%\s*(natural|safe|success|results?)|హామీ/gi,
    // What survives is a rule telling a model not to say it, a consent form
    // saying plainly that nothing is guaranteed — which is the disclosure the
    // clause wants, not a breach of it — and the academy's promise of machine
    // time to a student, which is not a treatment outcome.
    allow: /NEVER|never|not (a )?guarantee|shall not|guarantee (ledu|levu)|no guarantee|no "guaranteed"|Guaranteed machine time|no permanent cure|శాశ్వత క్యూర్ లేదు|not miracle promises|గోప్యత/i,
    // Telugu: "హామీ" next to a denial — "అద్భుత హామీలు కాదు", "తప్పుడు హామీలు
    // ఉండవు", "హామీ ఇచ్చేవారు నిజాయితీగా లేరు" — is the clinic refusing to
    // promise, which is what 8.1(vi) wants, not a breach of it.
    allowTe: /హామీ[^.।]{0,60}(కాదు|లేరు|ఉండవు|లేదు)|(తప్పుడు|అద్భుత)\s*హామీ|హామీ ఇచ్చే/ },
  { clause: "8.1(v)", what: "before/after offered to a prospective patient",
    re: /before[\s-]?(and[\s-]?)?after|before\/after/gi,
    // Planning a procedure with the surgeon, a rule forbidding the claim, and
    // the clinical photo timeline in the staff tools are all lawful uses.
    allow: /planning with the surgeon|ముందు-తర్వాత ప్లానింగ్|NEVER|forbids|8\.1\(v\)|used to|pampakoodadhu|before\/after claim/i },
];

console.log("WHAT THE CLINIC IS ALLOWED TO SAY\n");
const hits = [];
for (const p of files) {
  const lines = readable(p);
  for (const r of RULES) {
    lines.forEach((ln, i) => {
      r.re.lastIndex = 0;
      if (!r.re.test(ln)) return;
      if (r.allow && r.allow.test(ln)) return;
      if (r.allowTe && r.allowTe.test(ln)) return;
      if (r.allowEarly && r.allowEarly.test(ln)) return;
      if (isPattern(ln)) return;
      if (r.caveatOk && CAVEAT.test(ln)) return;
      r.re.lastIndex = 0;
      const words = [...new Set((ln.match(r.re) || []).map((w) => w.trim()))].join(" / ");
      // Show the words that tripped it, not just the line: a finding you have
      // to re-read the file to understand is a finding that gets skipped.
      hits.push({ file: rel(p), line: i + 1, clause: r.clause, what: r.what, words, text: ln.trim().slice(0, 78) });
    });
  }
}
const byClause = {};
for (const h of hits) (byClause[`${h.clause} — ${h.what}`] ||= []).push(h);
for (const r of RULES) {
  const k = `${r.clause} — ${r.what}`;
  const list = byClause[k] || [];
  ok(list.length === 0, `${k}  (${list.length})`);
  for (const h of list.slice(0, 10)) console.log(`        ${h.file}:${h.line}  «${h.words}»  ${h.text}`);
  if (list.length > 10) console.log(`        … and ${list.length - 10} more`);
}

// ── the machinery, not the words ────────────────────────────────────────────
console.log("");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// 7.2: an AI-generated promotional image must carry a source mark saying so.
const daily = read("api/_daily.js");
// The mark is deliberately NOT on the artwork — the owner asked for the poster
// to look exactly as it always has — so the disclosure rides in the caption.
// That makes the caption the only thing carrying it, which is why the next
// check insists every caption path adds it and this one insists the artwork
// never quietly grows a second copy that drifts out of step.
ok(!/aimark/.test(daily), "7.2 · the poster artwork is unchanged; the mark is not on it");
ok(/function withDisclosure/.test(daily) && (daily.match(/withDisclosure\(/g) || []).length >= 4,
  "7.2 · every caption path — model, academy fallback, clinic fallback — carries the AI line");

// 3.2 Explanation V: no requesting reviews for promotion.
const vercel = JSON.parse(read("vercel.json"));
ok(!(vercel.crons || []).some((c) => /cron-review/.test(c.path)), "3.2 Expl. V · the review-ask cron has no schedule");
ok(/disabled: true/.test(read("api/cron-review.js")), "3.2 Expl. V · a manual run of cron-review refuses to send");

// 8.1(v) + 6.2: before/after must not go to a prospective patient.
const wa = read("api/whatsapp.js");
ok(!/out\.show_results/.test(wa), "8.1(v) · the agent has no path that sends before/after photos");
ok(!/show_results/.test(read("api/_facts.js")) || /pampakoodadhu/.test(read("api/_facts.js")),
  "8.1(v) · the agent is told to answer results questions in words");
ok(!/o\.gallery/.test(read("api/_trust.js")), "8.1(v) · the trust pack carries no patient photographs");

// 8.1(vii)/(x): nothing may be given for referring a patient.
ok(!/process\.env\.REFERRAL_OFFER/.test(read("api/referral.js")), "8.1(vii) · no reward is attached to a referral");

// 8.1(ix)/(iii): the ad planner is told the rules, because it writes the copy.
const plan = read("api/_adplan.js");
ok(/NMC Guidelines/.test(plan) && /"painless"/.test(plan), "8.1 · the ad planner is given the prohibited words");

// 3.2 Explanations III/IV: name, qualifications, registration status, number.
const idx = read("index.html");
const slots = [...idx.matchAll(/data-reg="([a-z]+)"><\/b>/g)].map((m) => m[1]);
ok(/legal-reg/.test(idx), "3.2 Expl. IV · the site carries a medical registration disclosure");
ok(slots.length === 0, slots.length
  ? `3.2 Expl. IV · registration numbers still blank for: ${slots.join(", ")} — fill the <b data-reg="…"> in index.html`
  : "3.2 Expl. IV · every treating doctor's registration number is published");
const docs = require(path.join(ROOT, "api", "_docs.js"));
const missing = docs.regMissing();
ok(missing.length === 0, missing.length
  ? `3.2 Expl. III · REG_${missing.map((m) => m.toUpperCase()).join(", REG_")} unset — the poster and WhatsApp card omit the number`
  : "3.2 Expl. III · the poster and the doctor card carry the registration number");

console.log("");
console.log(bad ? `${bad} problem(s) — a patient can still read these` : "nothing a patient should not read");
process.exit(bad ? 1 : 0);
