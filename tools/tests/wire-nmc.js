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
const docs = require(path.join(ROOT, "api", "_docs.js"));
let bad = 0;
const ok = (good, what) => { if (!good) bad++; console.log(`  ${good ? "ok " : "✗  "} ${what}`); };

// Pages and modules a patient or a regulator actually reads. The staff app and
// the packaged mobile builds are internal tools, not advertising, and the
// before/after timeline inside them is a clinical record — 6.1 permits that,
// it is 8.1(v) promotion that does not.
const SKIP_DIR = /^(node_modules|\.git|\.vercel|app|tools)$/;
// Blanket-skipping a whole file was a mistake the first time: _admin.js was on
// this list, and it was the file quietly inviting the owner to collect patient
// before/after photographs. Nothing is skipped outright now. _exam.js is the
// weekly test's cast of imaginary patients, whose entire job is to say the
// forbidden thing and see whether the agent repeats it, so only that one keeps
// a blanket pass — and it is named here rather than hidden in a regex.
const SKIP_FILE = /^(staff|privacy|terms)\.html$|^_exam\.js$/;
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP_DIR.test(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    // Not only .html and .js. "Gold Medalist" sat in llms.txt for a day
    // because this line used to read /\.(html|js)$/ — a published file the
    // audit could not see is a published file nobody is checking.
    else if (/\.(html|js|txt|json|md|xml|css)$/.test(e.name) && !SKIP_FILE.test(e.name)) files.push(p);
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
    allow: /your best self|మీ ఉత్తమ రూపాని|>Best for<|\b(let|const|var)\s+best|best(Score|Cost|Day|Img)|\bbest\s*(&&|\|\||[=!<>,);.\]])|[.[]best\b|\bbest\)|Best-effort|best effort|which should I choose|బెస్ట్ ఫలితం కోసం చాలా మంది|NEVER write|binds every word|best topic|\$\{best\}|Best for|best suits|best when|works best|best combined|best control|at its best|బెస్ట్‌గా|బెస్ట్ కంట్రోల్|All the best/i,
    // "Starting early gives the best results" is advice about when to begin,
    // not a claim that this clinic beats another one.
    allowEarly: /\b(early|fresh|starting early|sooner)\b|ముందుగా|ముందే/i },
  { clause: "8.1(vi)", what: "outcomes promised as certainties",
    re: /\bundetectable\b|\bflawless\b|\bcompletely natural\b|\bnever (fades?|returns?)\b|\bforever\b|\u0c17\u0c41\u0c30\u0c4d\u0c24\u0c3f\u0c02\u0c1a\u0c32\u0c47\u0c28\u0c3f/gi,
    // The academy's day-one lesson tells trainees that one overheard joke about
    // hair loss "loses a client forever". That is advice about how to behave,
    // not a promise about a treatment.
    allow: /loses a client forever|colleagues/i },
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
    allow: /NEVER|never|not (a )?guarantee|shall not|guarantee (ledu|levu|ivvaledu)|no guarantee|no "guaranteed"|Guaranteed machine time|no permanent cure|శాశ్వత క్యూర్ లేదు|not miracle promises|గోప్యత/i,
    // Telugu: "హామీ" next to a denial — "అద్భుత హామీలు కాదు", "తప్పుడు హామీలు
    // ఉండవు", "హామీ ఇచ్చేవారు నిజాయితీగా లేరు" — is the clinic refusing to
    // promise, which is what 8.1(vi) wants, not a breach of it.
    allowTe: /హామీ[^.।]{0,60}(కాదు|లేరు|ఉండవు|లేదు)|(తప్పుడు|అద్భుత)\s*హామీ|హామీ ఇచ్చే/ },
  { clause: "8.1(iii)", what: "awards and personal achievements",
    // This one was missing on the first pass and "Gold Medalist" went live in
    // eleven places — the home page, its JSON-LD, the academy page, the agent's
    // briefing, the academy poster and the owner's own summary. The audit said
    // the site was clean; curl said otherwise. Hence the rule.
    re: /gold medal(l?ist)?|medall?ist|\b(award|awarded)\b|rank holder|university (first|topper)|🏅|🥇|🏆/gi,
    // The academy's own certificate is a thing it issues to a student, not a
    // prize a doctor won; the rule that forbids the claim has to name it.
    allow: /educationalCredentialAwarded|Academy Certificate|NEVER write|binds every word|an award\b/i },
  { clause: "8.1(x)", what: "inducements — free procedures, discounts, limited offers, scarcity",
    // 10.1(iv) grades "inducement for patients" as a SERIOUS violation. The
    // academy sells training to students, and 8.1(x) is scoped to inducements
    // that encourage unnecessary medical consultation or solicit PATIENTS, so
    // academy fees and the launch offer are allowed and named below.
    re: /\bfree (consultation|assessment|check.?up|camp|procedure|treatment|session)\b|\bspecial offer\b|\bflash offer\b|\b\d{1,2}% ?off\b|\bslots limited\b|\blimited period\b|\bcashback\b|ఉచిత (కన్సల్టేషన్|పరీక్ష)/gi,
    allow: /NEVER|never|shall not|prohibit|forbid|8\.1\(x\)|academy|Academy|course|batch|trainee|student|used to/i },
  { clause: "3.2 Expl. V", what: "asking a patient for a review or a recommendation",
    re: /review (raas|raay|ivv)|write a review|Google review|review ivvagalara|recommend (cheyandi|chey)|రివ్యూ రాయండి/gi,
    // A rule telling the agent NOT to ask, and the refusal the owner's console
    // now returns, both have to name the thing in order to refuse it.
    // Showing the reviews Google already holds, labelled as Google's, is not
    // the same act as asking for one: Expl. V's second sentence reaches a
    // request, and sharing "for professional promotion on social media" — and
    // 3.6 defines social media as platforms where users create and share, not
    // a clinic's own website. The display is a judgement call flagged to the
    // owner rather than a finding; the ASK is gone everywhere.
    allow: /ADAGAKU|adagakoodadhu|Explanation V|Expl\. V|shall not|NEVER|never|used to|pampalemu|nishedhist|aria-label|reviewsCount|reviews__|as published on Google/i },
  { clause: "8.1(iii)", what: "numbers of patients treated",
    re: /treated (thousands|hundreds|\d[\d,]*)|\b\d[\d,]*\+? (patients|cases) (treated|done)|వేల(ాది)? (కేసులు|రోగులు)/gi },
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
// Checking only api/referral.js was not enough: whatsapp.js read the same
// variable itself and, with it unset, still promised both people "a special
// benefit". So the question is whether ANY file reads it.
const readsOffer = fs.readdirSync(path.join(ROOT, "api")).filter((f) => /\.js$/.test(f))
  .filter((f) => /process\.env\.REFERRAL_OFFER/.test(fs.readFileSync(path.join(ROOT, "api", f), "utf8")));
ok(readsOffer.length === 0, readsOffer.length
  ? `8.1(vii) · still reads REFERRAL_OFFER: ${readsOffer.join(", ")}`
  : "8.1(vii) · nothing anywhere attaches a reward to a referral");

// 8.1(ix)/(iii): the ad planner is told the rules, because it writes the copy.
const plan = read("api/_adplan.js");
ok(/NMC Guidelines/.test(plan) && /"painless"/.test(plan), "8.1 · the ad planner is given the prohibited words");

// 9.2: an RMP's photograph may not be used where the use is solicitation or
// promotional publicity. The two places it was: the daily poster, which is
// boosted into a paid ad, and the pack pushed at a patient who wavered.
ok(!/class="ph"/.test(daily) && !/doc\.b64/.test(daily.split("posterHtml")[1] || ""),
  "9.2 \u00b7 the paid poster carries no photograph of a doctor");
ok(!/sendWaImageLink\(ph, BASE\(\) \+ DOCTOR\.img/.test(read("api/_trust.js")),
  "9.2 \u00b7 no doctor's photograph is pushed at a hesitating patient");

// 8.1(v): a before/after photograph does not have to be linked to be published.
const assetDirs = ["assets", "assets/academy"];
const badAssets = assetDirs.filter((d) => fs.existsSync(path.join(ROOT, d)))
  .flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /before.?after|b4.?after/i.test(f)).map((f) => d + "/" + f));
ok(badAssets.length === 0, badAssets.length
  ? `8.1(v) \u00b7 before/after image files are still served: ${badAssets.join(", ")}`
  : "8.1(v) \u00b7 no before/after image is published in assets");

// 7.2(c): where the artificial nature of the content is material to the
// audience, disclosure is required. A patient asking a "receptionist" about
// their skin plainly qualifies, and the website widget already discloses.
const facts = read("api/_facts.js");
ok(/AI assistant/.test(facts) && /NMC 7\.2\(c\)/.test(facts),
  "7.2(c) \u00b7 the chat agent is told to say it is an AI");
ok(/AI assistant ni/.test(read("api/voice-call.js")),
  "7.2(c) \u00b7 the phone receptionist says it is an AI");

// 8.1(x), last sentence: "Any lawful disclosure of charges, packages or fees
// shall be factual, transparent and not misleading." The consultation fee was
// advertised as free in four places while the rate card billed a different
// number again, so the fee now has to agree wherever it is stated: the desk's
// rate card, the agent's price policy, and both language editions of the page
// that answers "how much does a consultation cost".
const money = read("api/money.js");
const deskFee = (money.match(/\{ id: "consult",[^}]*price: (\d+)/) || [])[1];
const policyFee = (read("api/_prices.js").match(/const DEFAULT = \{[^}]*consult: (\d+)/) || [])[1];
const pageFees = ["skin-clinic-eluru.html", "skin-doctor-eluru-telugu.html"]
  .flatMap((f) => [...read(f).matchAll(/consultation[^.<]{0,40}\u20b9(\d+)|\u0c15\u0c28\u0c4d\u0c38\u0c32\u0c4d\u0c1f\u0c47\u0c37\u0c28\u0c4d \u20b9(\d+)/gi)].map((m) => m[1] || m[2]));
const fees = [...new Set([deskFee, policyFee, ...pageFees].filter(Boolean))];
ok(deskFee && policyFee && pageFees.length >= 2 && fees.length === 1,
  fees.length === 1 && deskFee
    ? `8.1(x) \u00b7 the consultation fee is \u20b9${fees[0]} and says so everywhere \u2014 rate card, agent, both pages`
    : `8.1(x) \u00b7 the consultation fee disagrees between places: desk ${deskFee || "?"}, agent ${policyFee || "?"}, pages ${pageFees.join("/") || "none stated"}`);

// 3.2 Explanations III/IV: name, qualifications, registration status and the
// SMR/NMR number, on everything we publish. The sentence is generated once by
// docs.regDisclosure(); every public page carries a copy of it. Checking the
// copies against the generator — rather than against each other — is what
// catches a number corrected in one place and left stale in ninety others.
const missing = docs.regMissing();
ok(missing.length === 0, missing.length
  ? `3.2 Expl. III · no registration number for: ${missing.join(", ")}`
  : "3.2 Expl. III · every treating doctor has a registration number");

const EN = docs.regDisclosure().replace(/&/g, "&amp;");
const TE = docs.regDisclosure("te").replace(/&/g, "&amp;");
// staff-app.html is the download page for the staff's own app and says so on
// its face; it is not advertising, and it is the only page with a footer that
// is deliberately without the disclosure.
const NOT_ADVERTISING = new Set(["staff-app.html"]);
const pages = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f))
  .filter((f) => /<footer/.test(fs.readFileSync(path.join(ROOT, f), "utf8")))
  .filter((f) => !NOT_ADVERTISING.has(f));
const noDisclosure = [], stale = [];
for (const f of pages) {
  const t = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (!/class="legal-reg"/.test(t)) { noDisclosure.push(f); continue; }
  if (t.indexOf(EN) === -1 && t.indexOf(TE) === -1) stale.push(f);
}
ok(noDisclosure.length === 0, noDisclosure.length
  ? `3.2 Expl. IV · ${noDisclosure.length} public page(s) carry no disclosure: ${noDisclosure.slice(0, 6).join(", ")}`
  : `3.2 Expl. IV · all ${pages.length} public pages carry the disclosure`);
ok(stale.length === 0, stale.length
  ? `3.2 Expl. IV · ${stale.length} page(s) disagree with api/_docs.js: ${stale.slice(0, 6).join(", ")}`
  : "3.2 Expl. IV · every copy of it matches api/_docs.js, word for word");

// The number has to reach the places that are not pages, too.
ok(/docs\.regLine\(doc\.reg\)/.test(daily), "3.2 Expl. IV · the poster's doctor credit carries the number");
ok(/docs\.regLine\("nikhitha"\)/.test(read("api/_trust.js")), "3.2 Expl. III · the WhatsApp doctor card carries it");

console.log("");
console.log(bad ? `${bad} problem(s) — a patient can still read these` : "nothing a patient should not read");
process.exit(bad ? 1 : 0);
