// Build the academy study material PDFs — white pages, printer-friendly.
//
//   node tools/academy-material/render.mjs            → assets/academy/material/*.pdf (63 files)
//   node tools/academy-material/render.mjs skin-day-05 → just that one, for a quick look
//   python3 tools/academy-material/verify.py           → proves every sentence survived
//
// content.json is the source of truth for all 60 days (30 skin + 30 hair):
// title, Telugu title, objectives, three theory blocks, hands-on, safety,
// key points, homework, tip, self-check. Edit it and re-run; nothing else
// to change. It was recovered from the first-edition PDFs with extract.py
// (kept beside this for the record) after the original generator was lost
// with a scratch folder — which is why this build lives in the repo.
//
// The first edition (Sep 2026) used the clinic's dark-and-gold poster theme:
// black pages, gold type, a team photo on every day. Fine on a phone, a
// disaster on an A4 printer. The owner asked (10 Nov 2026) for material that
// prints on white pages: same text, same two pages per day, white paper,
// dark ink, gold only for rules and labels, ruled lines for the student's
// own notes where the dark edition had empty black.
//
// Fonts come from Google once and are cached in fonts/ beside this script,
// so the build works offline afterwards and does not wait on the network
// 63 times. Chrome is the local Google Chrome, driven by puppeteer-core.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

// fileURLToPath, not URL.pathname: the repo lives in iCloud Drive and its
// path has spaces, which .pathname leaves percent-encoded.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(PROJECT, "package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = process.env.LOCAL_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const ONLY = process.argv[2] || "";
const OUT = process.env.MATERIAL_OUT || path.join(PROJECT, "assets", "academy", "material");
const C = JSON.parse(fs.readFileSync(path.join(HERE, "content.json"), "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = (n) => String(n).padStart(2, "0");

const TRACK = {
  skin: { en: "Skin Care Treatments", te: "స్కిన్ కేర్ ట్రీట్‌మెంట్స్", kick: "SKIN CARE TREATMENTS" },
  hair: { en: "Hair Care Treatments", te: "హెయిర్ కేర్ ట్రీట్‌మెంట్స్", kick: "HAIR CARE TREATMENTS" },
};
const BRAND = { line: "DermaLuxe Academy, Eluru · WhatsApp 99591 34666", site: "dermaluxe.ai/academy",
  trainer: "Trainer: Dr. Meghana Valeti, MD DVL" };

const FONTDIR = path.join(HERE, "fonts");
async function fontsCss() {
  const cssPath = path.join(FONTDIR, "fonts.css");
  if (fs.existsSync(cssPath)) return cssPath;
  fs.mkdirSync(FONTDIR, { recursive: true });
  // A browser user-agent gets woff2 with unicode-range subsets; the default
  // curl-like one gets a single ttf per family.
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  const url = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Jost:wght@400;500;600&family=Noto+Sans+Telugu:wght@400;500;600&display=swap";
  let css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
  for (const u of urls) {
    const f = path.basename(new URL(u).pathname);
    fs.writeFileSync(path.join(FONTDIR, f), Buffer.from(await (await fetch(u)).arrayBuffer()));
    css = css.split(u).join(f);
  }
  fs.writeFileSync(cssPath, css);
  console.log(`fonts: ${urls.length} files cached in ${FONTDIR}`);
  return cssPath;
}
const FONTS = `<link rel="stylesheet" href="${pathToFileURL(await fontsCss()).href}">`;

const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Jost, "Helvetica Neue", Arial, sans-serif; color: #1d1a16; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.te { font-family: "Noto Sans Telugu", "Kohinoor Telugu", sans-serif; }
.page { width: 210mm; height: 297mm; padding: 13mm 15mm 11mm; position: relative; page-break-after: always; break-after: page; overflow: hidden; display: flex; flex-direction: column; }
.page:last-child { page-break-after: auto; break-after: auto; }
.top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #a77e3c; padding-bottom: 3mm; }
.kick { font-size: 8pt; letter-spacing: .22em; text-transform: uppercase; color: #8a6a2f; font-weight: 500; }
.kick .te { letter-spacing: 0; text-transform: none; display: block; font-size: 9.5pt; color: #5d5648; margin-top: 1mm; font-weight: 400; }
.daynum { text-align: right; }
.daynum b { font-family: "Cormorant Garamond", Georgia, serif; font-size: 30pt; font-weight: 700; line-height: 1; display: block; color: #1d1a16; }
.daynum span { font-size: 8.5pt; color: #8a6a2f; }
h1 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 600; font-size: 25pt; line-height: 1.12; margin: 6mm 0 1mm; color: #1d1a16; }
.tsub { font-size: 12pt; color: #4e4840; }
.label { font-size: 8pt; letter-spacing: .2em; text-transform: uppercase; color: #8a6a2f; font-weight: 500; margin: 6.5mm 0 2.2mm; display: flex; gap: 7px; align-items: baseline; border-bottom: 1px solid #e0d6c2; padding-bottom: 1.4mm; }
.label .te { letter-spacing: 0; text-transform: none; font-size: 9pt; color: #6d6456; font-weight: 400; }
ul { list-style: none; margin: 0; padding: 0; }
li { position: relative; padding-left: 5.5mm; font-size: 11pt; line-height: 1.45; margin: 1.5mm 0; }
li::before { content: "✦"; position: absolute; left: 0; top: .15em; color: #a77e3c; font-size: 8pt; }
.block { margin-top: 5mm; }
.block h3 { font-family: "Cormorant Garamond", Georgia, serif; font-size: 15.5pt; font-weight: 600; margin: 0 0 1.4mm; }
.block p, .card p { margin: 0; font-size: 11pt; line-height: 1.55; }
/* ruled lines for the student's own notes — plain borders, not a gradient
   (Chrome rasterises print gradients into image tiles and triples the size) */
.notes { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; margin-top: 4mm; min-height: 0; overflow: hidden; }
.notes i { display: block; border-bottom: 1px solid #ddd3bd; height: 8.5mm; }
.notes .label { margin: 0 0 1mm; border: 0; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin-top: 5mm; }
.card { border: 1px solid #ddd3bd; border-radius: 2.5mm; padding: 4mm 4.5mm 4.5mm; }
.card.warn { border-color: #d9a79b; }
.card h3 { font-family: "Cormorant Garamond", Georgia, serif; font-size: 14pt; font-weight: 600; margin: 0 0 2mm; }
.card.warn h3 { color: #9a3d2b; }
.card li { font-size: 10.2pt; }
.cols { columns: 2; column-gap: 7mm; }
.cols li { break-inside: avoid; }
.sign { display: flex; gap: 14mm; font-size: 10pt; margin-top: 6mm; color: #3a352e; }
.foot { margin-top: auto; display: flex; justify-content: space-between; font-size: 8pt; color: #6d675c; border-top: 1px solid #e5dcc8; padding-top: 2.2mm; }
.foot b { font-weight: 500; color: #4a443b; }
/* covers */
.cover .word { font-family: "Cormorant Garamond", Georgia, serif; font-size: 22pt; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; }
.cover .word small { display: block; font-size: 10pt; letter-spacing: .3em; color: #8a6a2f; margin-top: 1mm; }
.cover .word .te { display: block; letter-spacing: 0; text-transform: none; font-size: 10pt; color: #5d5648; margin-top: 2mm; font-weight: 400; }
.cover h1 { font-size: 38pt; margin: 22mm 0 2mm; line-height: 1.05; }
.cover .tsub { font-size: 15pt; }
.cover .desc { font-size: 11pt; line-height: 1.6; max-width: 150mm; margin-top: 6mm; color: #3a352e; }
.chips { display: flex; gap: 4mm; margin-top: 8mm; flex-wrap: wrap; }
.chip { border: 1px solid #a77e3c; color: #8a6a2f; border-radius: 10mm; padding: 1.6mm 5mm; font-size: 8.5pt; letter-spacing: .18em; text-transform: uppercase; font-weight: 500; }
.plan { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; margin-top: 3mm; }
.plan div { display: flex; gap: 3.5mm; padding: 1.9mm 0; border-bottom: 1px solid #efe9db; font-size: 10pt; line-height: 1.35; align-items: baseline; }
.plan b { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 700; color: #8a6a2f; min-width: 7mm; font-size: 12.5pt; }
`;

const LBL = {
  obj: ["Today's objectives", "ఈ రోజు లక్ష్యాలు"], theory: ["Theory", "థియరీ"], prac: ["Practical & revision", "ప్రాక్టికల్"],
  keys: ["Key points to remember", "గుర్తుంచుకోవలసినవి"], self: ["Self-check", "సెల్ఫ్ చెక్"], plan: ["Day plan", "రోజువారీ ప్రణాళిక"],
  notes: ["My notes", "నా నోట్స్"],
};
const label = (k) => `<div class="label"><span>${esc(LBL[k][0])}</span><span>·</span><span class="te">${esc(LBL[k][1])}</span></div>`;
const list = (xs, cls = "") => `<ul class="${cls}">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

function dayPages(track, d) {
  const T = TRACK[track];
  const p1 = `<section class="page">
  <div class="top"><div class="kick">DermaLuxe Academy · ${esc(T.kick)}<span class="te">${esc(T.te)}</span></div>
    <div class="daynum"><b>Day ${pad(d.n)}</b><span>${d.n} of 30 · Sundays holiday</span></div></div>
  <h1>${esc(d.title)}</h1><div class="tsub te">${esc(d.te)}</div>
  ${label("obj")}${list(d.objectives)}
  ${label("theory")}
  ${d.theory.map((b) => `<div class="block"><h3>${esc(b.h)}</h3><p>${esc(b.p)}</p></div>`).join("")}
  <div class="foot"><span><b>${esc(T.en)}</b> · Day ${pad(d.n)}</span><span>${esc(BRAND.line)}</span></div>
</section>`;
  const p2 = `<section class="page">
  <div class="top"><div class="kick">Day ${pad(d.n)} · ${esc(LBL.prac[0])}<span class="te">${esc(LBL.prac[1])}</span></div>
    <div class="daynum"><span>${esc(d.title)}</span></div></div>
  <div class="two"><div class="card"><h3>Hands-on today</h3>${list(d.hands)}</div>
    <div class="card warn"><h3>Safety &amp; contraindications</h3>${list(d.safety)}</div></div>
  ${label("keys")}${list(d.keys, "cols")}
  <div class="two"><div class="card"><h3>Homework</h3><p>${esc(d.homework)}</p></div>
    <div class="card"><h3>Grooming &amp; professional tip</h3><p>${esc(d.tip)}</p></div></div>
  ${label("self")}${list(d.selfcheck)}
  <div class="sign"><span>Trainer sign: ______________________</span><span>Trainee sign: ______________________</span></div>
  <div class="notes">${label("notes")}${"<i></i>".repeat(6)}</div>
  <div class="foot"><span><b>DermaLuxe Academy</b> · Advanced Skin &amp; Hair Aesthetics Training, Eluru</span><span>Day ${pad(d.n)} · ${esc(BRAND.site)}</span></div>
</section>`;
  return p1 + p2;
}

const wordmark = `<div class="word">DermaLuxe<small>by Medicare · Skin &amp; Hair Clinics</small><span class="te">ఏలూరు · Eluru</span></div>`;

// One page: the track's title block and the 30-day plan — no dates, so the
// same book serves every batch.
function planPage(track, kickLine) {
  const T = TRACK[track], days = C[track];
  const col = (xs) => xs.map((d) => `<div><b>${pad(d.n)}</b><span>${esc(d.title)}</span></div>`).join("");
  return `<section class="page cover">
  ${wordmark}
  <div class="kick" style="margin-top:12mm">${esc(kickLine)}</div>
  <h1 style="margin-top:3mm;font-size:30pt">${esc(T.en)}</h1>
  <div class="tsub te">${esc(T.te)} — 30 రోజుల స్టడీ మెటీరియల్</div>
  <p class="desc" style="margin-top:3mm">30 training days · Sundays holiday · daily theory, hands-on, safety, key points, homework and a professional tip. ${esc(BRAND.trainer)}.</p>
  ${label("plan")}
  <div class="plan"><div style="display:block;padding:0;border:0">${col(days.slice(0, 15))}</div><div style="display:block;padding:0;border:0">${col(days.slice(15))}</div></div>
  <div class="foot"><span><b>DermaLuxe by Medicare Skin And Hair Clinics</b> · Eluru</span><span>WhatsApp 99591 34666 · ${esc(BRAND.site)}</span></div>
</section>`;
}

function fullCover() {
  return `<section class="page cover">
  ${wordmark}
  <div class="kick" style="margin-top:28mm">Complete study material</div>
  <h1>Skin &amp; Hair<br>30-Day Study Material</h1>
  <div class="tsub te">స్కిన్ &amp; హెయిర్ — 30 రోజుల పూర్తి స్టడీ మెటీరియల్</div>
  <p class="desc">Both specialisations in one book — 60 training days of theory, hands-on practicals, safety, key points, homework and professional tips. ${esc(BRAND.trainer)} · Sundays holiday.</p>
  <div class="chips"><span class="chip">Part 1 · Skin care · Days 1–30</span><span class="chip">Part 2 · Hair care · Days 1–30</span></div>
  <div class="foot"><span><b>DermaLuxe by Medicare Skin And Hair Clinics</b> · Eluru</span><span>WhatsApp 99591 34666 · ${esc(BRAND.site)}</span></div>
</section>`;
}

const doc = (body) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${CSS}</style></head><body>${body}</body></html>`;

// 60 days, 2 trainer manuals, 1 full book — the file names api/material.js
// already serves, so nothing else changes when these are rebuilt.
const jobs = [];
for (const track of ["skin", "hair"]) for (const d of C[track]) jobs.push({ name: `${track}-day-${pad(d.n)}.pdf`, html: doc(dayPages(track, d)), pages: 2 });
for (const track of ["skin", "hair"]) jobs.push({ name: `${track}-trainer-manual.pdf`, pages: 61,
  html: doc(planPage(track, "Study material · Trainer manual") + C[track].map((d) => dayPages(track, d)).join("")) });
jobs.push({ name: "full-30-day-study-material.pdf", pages: 123,
  html: doc(fullCover() + planPage("skin", "Part 1 · Skin care") + C.skin.map((d) => dayPages("skin", d)).join("") +
    planPage("hair", "Part 2 · Hair care") + C.hair.map((d) => dayPages("hair", d)).join("")) });

const pick = jobs.filter((j) => !ONLY || (ONLY === "days" && j.pages === 2) || (ONLY === "books" && j.pages > 2) || j.name.startsWith(ONLY));
if (!pick.length) { console.error(`nothing matches "${ONLY}" — try skin-day-05, days, books`); process.exit(2); }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const htmlPath = path.join(OUT, "_doc.html");
let bad = 0;
for (const j of pick) {
  // Written to disk and opened as a file: a file:// page may load the
  // cached file:// fonts, which a setContent() page may not.
  fs.writeFileSync(htmlPath, j.html);
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 120000 });
  await page.evaluateHandle("document.fonts.ready");
  // A page that overflows its A4 box is clipped silently — say so instead.
  const over = await page.evaluate(() => [...document.querySelectorAll(".page")].map((p, i) => [i + 1, p.scrollHeight - p.clientHeight]).filter((x) => x[1] > 0));
  const fontsMissing = await page.evaluate(() => [["Cormorant Garamond", 600], ["Jost", 400], ["Noto Sans Telugu", 400]].filter(([f, w]) => !document.fonts.check(`${w} 12px "${f}"`)).map((x) => x[0]));
  const buf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  fs.writeFileSync(path.join(OUT, j.name), buf);
  if (over.length || fontsMissing.length) bad++;
  console.log(`${j.name.padEnd(36)} ${String(Math.round(buf.length / 1024)).padStart(6)} KB` +
    (over.length ? `  ✗ OVERFLOW ${JSON.stringify(over)}` : "") + (fontsMissing.length ? "  ✗ fonts missing: " + fontsMissing.join(", ") : ""));
}
await browser.close();
fs.rmSync(htmlPath, { force: true });
console.log(bad ? `${bad} document(s) need attention` : `${pick.length} documents: all pages fit, all fonts loaded`);
process.exit(bad ? 1 : 0);
