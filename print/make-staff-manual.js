// The staff app user manual, in Telugu. Re-run:
//   node print/make-staff-manual.js   →  print/staff-manual.pdf
//
// Owner, 13 Nov 2026: "dermaluxe staff app ela use cheyyalo user manual ivvu,
// pdf telugu lo". The words are in print/manual/content.json — one section per
// tab, written in Telugu from the code of staff.html and api/*.js and then
// checked against that code, with every on-screen label left exactly as the
// app shows it. The pictures are phone screenshots from the MOCK server
// (print/manual-shots.js): invented names and numbers, never a real patient.
// When a screen changes, retake the shots and fix the matching section.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");

const DIR = path.join(__dirname, "manual");
const S = JSON.parse(fs.readFileSync(path.join(DIR, "content.json"), "utf8"));
const shot = (f) => "data:image/png;base64," + fs.readFileSync(path.join(DIR, "shots", f + ".png")).toString("base64");
const logo = "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "..", "assets", "logo.png")).toString("base64");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// Labels the app shows are in double quotes in the text; set them as keys.
const fmt = (s) => esc(s).replace(/"([^"]{1,60})"/g, '<b class="k">$1</b>');

const SHOTS = {
  start: [["login", "లాగిన్ స్క్రీన్"], ["more", "ఫోన్‌లో \"More\" — మిగతా టాబ్‌లు"]],
  leads: [["tab-leads", "Leads టాబ్"], ["lead-card", "ఒక లీడ్ కార్డ్"], ["lead-new", "\"+ Kotha lead\" ఫారం"]],
  inbox: [["tab-inbox", "Inbox టాబ్"]],
  appts: [["tab-appts", "Appointments పైభాగం"], ["appts-list", "రోజు అపాయింట్‌మెంట్ల లిస్ట్"]],
  patients: [["tab-patients", "Patients టాబ్"], ["patient-file", "పేషెంట్ ఫైల్"]],
  money: [["tab-money", "Money టాబ్"]],
  stock: [["tab-stock", "Stock టాబ్"]],
  academy: [["tab-academy", "Academy (Seats) టాబ్"]],
  students: [["tab-students", "Students టాబ్"], ["student-card", "స్టూడెంట్ కార్డ్"]],
  attend: [["tab-attend", "Attendance టాబ్"]],
  files: [["tab-files", "Files టాబ్"]],
  today: [["tab-today", "Today's post టాబ్"]],
  team: [["tab-team", "Control panel టాబ్"]],
};
const ORDER = ["start", "leads", "inbox", "appts", "patients", "money", "academy", "students", "attend", "files", "today", "stock", "team", "numbers", "ads", "reviews", "office"];
const secs = ORDER.map((k) => S.find((s) => s.key === k)).filter(Boolean);

const phone = (f, cap) => `<figure class="ph"><div class="frame"><img src="${shot(f)}" alt=""></div><figcaption>${fmt(cap)}</figcaption></figure>`;

const cover = `<section class="cover">
  <img class="lg" src="${logo}" alt="">
  <p class="eb">DermaLuxe by Medicare · Eluru</p>
  <h1>Staff App</h1>
  <p class="h1te">వాడుక గైడ్</p>
  <p class="sub">మీ ఫోన్‌లో DermaLuxe Staff యాప్ ఎలా వాడాలి — లాగిన్ నుంచి లీడ్‌లు, అపాయింట్‌మెంట్‌లు, పేషెంట్లు, డబ్బు, అకాడమీ వరకు, స్టెప్ బై స్టెప్.</p>
  <div class="phones">${phone("login", "లాగిన్")}${phone("tab-leads", "Leads")}${phone("tab-appts", "Appointments")}</div>
  <p class="note">ఈ గైడ్‌లో ఉన్న ఫోటోల్లో పేర్లు, నంబర్లు అన్నీ ఉదాహరణ కోసం పెట్టినవి — నిజమైన పేషెంట్లవి కావు. · యాప్ వెర్షన్ 1.71 · నవంబర్ 2026</p>
</section>`;

const toc = `<section class="toc"><h2>ఈ గైడ్‌లో</h2><ol>${secs.map((s, i) => `<li><b>${i + 1}</b><span>${esc(s.title_en)}</span><i>${esc(s.title_te)}</i></li>`).join("")}</ol>
  <div class="how"><h3>ఈ గైడ్ ఎలా చదవాలి</h3>
  <p>యాప్‌లో కనిపించే బటన్ పేర్లు, పదాలు <b class="k">ఇలా</b> బంగారు రంగు బాక్స్‌లో ఉంటాయి — యాప్‌లో అవి ఎలా ఉన్నాయో అలాగే రాశాం, అలాగే వెతకండి.</p>
  <p><span class="tag ok">పనికొచ్చే అలవాట్లు</span> బాక్స్‌లో మంచి అలవాట్లు, <span class="tag bad">జాగ్రత్త</span> బాక్స్‌లో తప్పులు జరిగే చోట్లు ఉంటాయి.</p>
  <p>మీకు ఏ టాబ్‌లు కనిపిస్తాయి అనేది మీ role బట్టి ఉంటుంది — 1వ భాగంలో లిస్ట్ ఉంది. ఏదైనా అర్థం కాకపోతే Owner / Manager ని అడగండి.</p></div>
</section>`;

const section = (s, i) => {
  const shots = SHOTS[s.key] || [];
  return `<section class="sec">
  <header class="sh"><span class="no">${i + 1}</span><div><h2>${esc(s.title_en)}</h2><p>${esc(s.title_te)}</p></div></header>
  <div class="intro${shots.length ? "" : " noshot"}">
    <div class="it"><p class="who"><span>ఎవరికి</span>${fmt(s.who_te)}</p><p class="pur">${fmt(s.purpose_te)}</p></div>
    ${shots.length ? `<div class="shots n${shots.length}">${shots.map(([f, c]) => phone(f, c)).join("")}</div>` : ""}
  </div>
  ${s.tasks.map((t, j) => `<article class="task"><h3><span>${i + 1}.${j + 1}</span>${fmt(t.title_te)}</h3><ol>${t.steps_te.map((x) => `<li>${fmt(x)}</li>`).join("")}</ol></article>`).join("")}
  ${s.tips_te.length ? `<div class="box ok"><h4>పనికొచ్చే అలవాట్లు</h4><ul>${s.tips_te.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul></div>` : ""}
  ${s.warnings_te.length ? `<div class="box bad"><h4>జాగ్రత్త</h4><ul>${s.warnings_te.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul></div>` : ""}
</section>`;
};

const CSS = `
@page { size: A4; margin: 14mm 15mm 16mm; }
:root { --plum:#4a2232; --mauve:#7b4a5c; --gold:#b8893d; --gold-ink:#8a6220; --ink:#2a1a20; --muted:#6d5560; --rule:#e3cfd3; --blush:#f8ecee; --cream:#fcf8f4; }
html, body { margin:0; background:#fff; }
body { font-family: "Noto Sans Telugu", Jost, sans-serif; color: var(--ink); font-size: 10.2pt; line-height: 1.62; -webkit-print-color-adjust: exact; }
b.k { font-family: Jost, "Noto Sans Telugu", sans-serif; font-weight: 600; color: var(--plum); background: #f6ead2; border: 1px solid #e6cf9c; border-radius: 1mm; padding: 0 1.2mm; white-space: normal; }
.cover { height: 267mm; display:flex; flex-direction:column; align-items:center; text-align:center; background: radial-gradient(circle at 50% 30%, #fff, var(--blush) 75%); border-radius: 4mm; padding: 14mm 12mm 10mm; box-sizing: border-box; page-break-after: always; }
.cover .lg { height: 20mm; background:#1a0f07; border-radius: 3mm; padding: 2mm 4mm; }
.eb { margin: 6mm 0 0; font-family: Jost, sans-serif; letter-spacing: .16em; text-transform: uppercase; font-size: 8.6pt; color: var(--gold-ink); font-weight: 600; }
.cover h1 { margin: 2mm 0 0; font-family: "Cormorant Garamond", serif; font-size: 50pt; color: var(--plum); line-height: 1; }
.h1te { margin: 1mm 0 0; font-family: "Noto Serif Telugu", serif; font-size: 26pt; color: var(--mauve); font-weight: 700; }
.sub { max-width: 140mm; margin: 5mm 0 0; font-size: 11pt; color: var(--ink); }
.phones { display:flex; gap: 7mm; margin-top: 9mm; align-items:flex-start; }
.phones .ph { width: 46mm; } .phones .ph:nth-child(2) { margin-top: -5mm; }
.note { margin-top: auto; font-size: 8.4pt; color: var(--muted); }
.ph { margin:0; }
.frame { background:#1d1418; border-radius: 5mm; padding: 1.6mm; box-shadow: 0 2mm 5mm rgba(74,34,50,.18); }
.frame img { width:100%; display:block; border-radius: 3.6mm; }
.ph figcaption { margin-top: 1.6mm; font-size: 8pt; color: var(--muted); text-align:center; line-height: 1.4; }
.toc { page-break-after: always; }
.toc h2, .sh h2 { font-family: "Cormorant Garamond", serif; color: var(--plum); }
.toc h2 { font-family: "Noto Serif Telugu", serif; font-size: 22pt; margin: 0 0 4mm; }
.toc ol { list-style:none; margin:0; padding:0; columns: 2; column-gap: 8mm; }
.toc li { break-inside: avoid; display:grid; grid-template-columns: 9mm 1fr; padding: 2mm 0; border-bottom: 1px solid var(--rule); }
.toc li b { font-family: "Cormorant Garamond", serif; font-size: 15pt; color: var(--gold-ink); grid-row: span 2; line-height: 1.2; }
.toc li span { font-family: Jost, sans-serif; font-weight: 600; color: var(--plum); font-size: 10.4pt; }
.toc li i { font-style: normal; font-size: 8.8pt; color: var(--muted); line-height: 1.4; }
.how { margin-top: 8mm; background: var(--cream); border: 1px solid var(--rule); border-radius: 3mm; padding: 4mm 6mm; }
.how h3 { margin: 0 0 1mm; color: var(--plum); font-size: 12pt; }
.how p { margin: 1.6mm 0; }
.tag { font-size: 8.6pt; padding: .4mm 2mm; border-radius: 100px; font-weight: 600; }
.tag.ok { background:#e7f4ec; color:#1f6b45; } .tag.bad { background:#fbe6e6; color:#9b2c2c; }
.sec { page-break-before: always; }
.sec.small { page-break-before: auto; margin-top: 10mm; }
.sh { display:flex; gap: 4mm; align-items:center; background: var(--plum); color:#fff; border-radius: 3mm; padding: 3.4mm 5mm; }
.sh .no { font-family: "Cormorant Garamond", serif; font-size: 26pt; color: #d8b56a; line-height: 1; }
.sh h2 { margin:0; color:#fff; font-size: 20pt; line-height: 1.05; }
.sh p { margin: .6mm 0 0; color: #f3d7dc; font-size: 10pt; }
.intro { display:block; margin-top: 5mm; }
.intro.noshot { grid-template-columns: 1fr; }
.shots { display:flex; gap: 8mm; justify-content:center; margin-top: 5mm; padding: 5mm 0 3mm; background: var(--blush); border-radius: 3mm; break-inside: avoid; }
.shots .ph { width: 44mm; } .shots.n3 .ph { width: 42mm; } .shots.n2 .ph { width: 44mm; }
.who { margin:0; font-size: 9.4pt; color: var(--muted); }
.who span { display:inline-block; font-weight: 700; color: var(--gold-ink); margin-right: 2mm; }
.pur { margin: 3mm 0 0; font-size: 10.6pt; }
.task { break-inside: avoid; margin-top: 4.4mm; border: 1px solid var(--rule); border-radius: 2.6mm; padding: 3.4mm 4.4mm 2mm; background:#fff; }
.task h3 { margin: 0; font-size: 11.4pt; color: var(--plum); display:flex; gap: 2.4mm; align-items:baseline; }
.task h3 span { font-family: Jost, sans-serif; font-size: 9pt; color:#fff; background: var(--gold); border-radius: 100px; padding: 0 2mm; flex: 0 0 auto; }
.task ol { margin: 2mm 0 0; padding-left: 6mm; }
.task li { margin: 0 0 1.6mm; padding-left: 1mm; }
.task li::marker { color: var(--gold-ink); font-weight: 700; font-family: Jost, sans-serif; }
.box { break-inside: avoid; margin-top: 4.4mm; border-radius: 2.6mm; padding: 3.2mm 4.4mm 1.6mm; }
.box h4 { margin:0 0 1.4mm; font-size: 10.6pt; }
.box ul { margin:0; padding-left: 5mm; } .box li { margin: 0 0 1.4mm; }
.box.ok { background:#eef7f1; border: 1px solid #cfe7d8; } .box.ok h4 { color:#1f6b45; }
.box.bad { background:#fdf0f0; border: 1px solid #f1cfcf; } .box.bad h4 { color:#9b2c2c; }
`;

const SMALL = new Set(["ads", "reviews", "office"]);   // short ones follow on the same page
const body = cover + toc + secs.map((s, i) => section(s, i).replace('<section class="sec">', `<section class="sec${SMALL.has(s.key) ? " small" : ""}">`)).join("");
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Jost:wght@400;500;600;700&family=Noto+Sans+Telugu:wght@400;500;600;700&family=Noto+Serif+Telugu:wght@700&display=block" rel="stylesheet">
<style>${CSS}</style></head><body>${body}</body></html>`;

(async () => {
  const out = path.join(__dirname, "staff-manual.pdf");
  const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const p = await b.newPage();
  await p.setContent(html, { waitUntil: "networkidle0", timeout: 120000 });
  await p.evaluate(() => document.fonts.ready);
  const missing = await p.evaluate(() => ["Noto Sans Telugu", "Jost", "Cormorant Garamond"].filter((f) => !document.fonts.check(`12px "${f}"`)));
  await p.pdf({ path: out, format: "A4", printBackground: true, displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font:8px Arial;color:#8a7480;padding:0 15mm;display:flex;justify-content:space-between"><span>DermaLuxe Staff App · వాడుక గైడ్</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` });
  await b.close();
  const n = (fs.readFileSync(out).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(path.basename(out), n + " pages", Math.round(fs.statSync(out).size / 1024) + " KB", missing.length ? "⚠ fonts missing: " + missing.join(", ") : "fonts ok");
})();
