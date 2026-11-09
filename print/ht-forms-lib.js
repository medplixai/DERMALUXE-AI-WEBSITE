// Shared pieces of the clinic's printed forms — the brand header, the
// footer with the address and the doctors' registration line, boxes, lines,
// date cells, the scalp-zone drawings and the A4 stylesheet — and render(),
// which prints a list of pages to a PDF and names any page that ran past its
// sheet. make-ht-consent.js and make-ht-consult.js both draw from here so the
// consent booklet and the consultation form look like one set.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const ROOT = path.join(__dirname, "..");
const data = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(ROOT, f)).toString("base64");
const logo = data("assets/logo.png", "image/png");
const docs = require(path.join(ROOT, "api", "_docs.js"));
const B = docs.BRAND;
const credit = docs.DOCTORS ? Object.values(docs.DOCTORS).map((d) => `${d.name}, ${d.q || d.qual || "MD (DVL)"} · Reg. No. ${d.reg}`).join("  ·  ") : "";
const CLINIC = "DermaLuxe by Medicare";

const box = (w) => `<span class="bx" style="width:${w}"></span>`;
const line = (w) => `<span class="ln" style="width:${w}"></span>`;
const date = () => `<span class="dt"><i></i><i></i></span>`;
const o = (label) => `<span class="rad">${label}<span class="c"></span></span>`;

// Scalp zones 1–7, the way the surgeon marks them: a side profile and a top
// view, schematic, drawn here so the page needs no picture file.
const HEAD = `<div class="heads">
<svg viewBox="0 0 240 260" width="190" height="206"><g fill="none" stroke="#3b2a1a" stroke-width="2" stroke-linejoin="round">
<path d="M122 18 C176 18 212 54 210 104 C209 140 196 158 192 184 L192 242 M122 18 C72 18 42 50 42 96 C42 108 44 116 46 120 L34 134 L50 138 C50 146 54 154 54 160 C62 164 70 168 64 176 C66 186 82 192 102 190 C110 200 118 220 118 242"/>
<path d="M150 118 C162 112 170 124 162 138 C156 146 148 140 150 128" stroke-width="1.4"/>
<path d="M50 98 C58 70 88 46 124 44 C162 42 196 68 206 104" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M86 60 C94 84 102 100 108 118" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M124 44 C126 70 128 96 128 118" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M162 48 C160 74 158 98 156 116" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M108 118 C124 112 142 112 156 116" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<ellipse cx="186" cy="118" rx="18" ry="22" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M70 110 C100 132 140 160 196 150" stroke="#8b5e2b" stroke-dasharray="4 3"/></g>
<g font-family="Jost, sans-serif" font-size="13" font-weight="600" fill="#2b1a0e" text-anchor="middle">
<text x="68" y="90">1</text><text x="104" y="76">2</text><text x="144" y="72">3</text><text x="182" y="88">4</text><text x="132" y="104">5</text><text x="186" y="123">6</text><text x="150" y="176">7</text></g></svg>
<svg viewBox="0 0 240 260" width="190" height="206"><g fill="none" stroke="#3b2a1a" stroke-width="2">
<ellipse cx="120" cy="130" rx="86" ry="108"/>
<path d="M44 150 C30 160 28 186 40 196" stroke-width="1.4"/><path d="M196 150 C210 160 212 186 200 196" stroke-width="1.4"/>
<path d="M60 58 Q120 30 180 58" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M44 100 Q120 76 196 100" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M40 148 Q120 126 200 148" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<ellipse cx="120" cy="178" rx="30" ry="24" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M50 190 Q120 212 190 190" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M120 58 L120 126" stroke="#8b5e2b" stroke-dasharray="4 3"/></g>
<g font-family="Jost, sans-serif" font-size="13" font-weight="600" fill="#2b1a0e" text-anchor="middle">
<text x="120" y="52">1</text><text x="90" y="92">2</text><text x="150" y="92">3</text><text x="120" y="116">4</text><text x="120" y="140">5</text><text x="120" y="182">6</text><text x="120" y="226">7</text><text x="60" y="176">7</text><text x="180" y="176">7</text></g></svg>
</div>`;
const AREAS = `<div class="areas">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<div><b>Area ${n}</b>${box("100%")}</div>`).join("")}</div>`;

const head = (title) => `<div class="hd"><div class="brand"><img src="${logo}" alt=""><div><b>${CLINIC}</b><span>Premium Skin &amp; Hair Clinic · Eluru</span></div></div><div class="ttl">${title}</div></div>`;
const foot = `<div class="ft"><div>${B.addr}</div><div><b>Call</b> 99491 34666 · <b>WhatsApp</b> 99591 34666 · ${B.email} · www.dermaluxe.ai</div><div class="cr">${credit}</div></div>`;
const page = (title, body, cls) => `<section class="pg">${head(title)}<div class="body ${cls || ""}">${body}</div>${foot}</section>`;
const bar = (t) => `<div class="bar">${t}</div>`;
const sigrow = (who) => `<div class="row"><span class="lbl">Name of the ${who}:</span>${line("58%")}</div><div class="row"><span class="lbl">${who}'s Signature:</span>${line("42%")}<span class="lbl r">Date:</span>${date()}</div>`;

const CSS = `
  @page { size: A4; margin: 0; }
  :root { --gold:#b8893d; --brown:#4a2a12; --ink:#2b1a0e; --rule:#cdb48a; }
  html, body { margin:0; }
  body { font-family: Jost, Arial, sans-serif; color: var(--ink); font-size: 10.2pt; line-height: 1.38; }
  .pg { width: 210mm; height: 297mm; box-sizing: border-box; padding: 11mm 13mm 9mm; page-break-after: always; display: flex; flex-direction: column; position: relative; }
  .pg:last-child { page-break-after: auto; }
  .pg::before { content:""; position:absolute; inset:6mm; border:1.5px solid var(--gold); border-radius:4mm; pointer-events:none; }
  .hd { display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid var(--gold); padding-bottom: 3mm; margin-bottom: 4mm; }
  .brand { display:flex; align-items:center; gap: 3mm; }
  .brand img { height: 15mm; border-radius: 2mm; background:#1a0f07; padding: 1.2mm 2.6mm; box-sizing: content-box; }
  .brand b { display:block; font-size: 13pt; color: var(--brown); letter-spacing:.02em; }
  .brand span { font-size: 7.6pt; letter-spacing: .12em; white-space: nowrap; text-transform: uppercase; color: var(--gold); }
  .ttl { border: 1.5px solid var(--brown); border-radius: 3mm; padding: 2mm 5mm; font-weight: 700; font-size: 9.6pt; white-space: nowrap; letter-spacing: .04em; text-transform: uppercase; color: var(--brown); }
  .body { flex: 1 1 auto; }
  .ft { margin-top: auto; border-top: 1px solid var(--rule); padding-top: 2mm; font-size: 7.6pt; color: #5b4128; text-align: center; line-height: 1.4; }
  .ft .cr { color:#7a6650; }
  .bar { background: var(--brown); color: #fbe7b0; text-align: center; font-weight: 700; letter-spacing: .08em; padding: 1.6mm; border-radius: 1.5mm; margin: 3mm 0; font-size: 10pt; }
  .pill-ttl { margin: 4mm auto; width: max-content; background: var(--brown); color: #fbe7b0; font-weight: 700; letter-spacing: .06em; padding: 2.4mm 9mm; border-radius: 100px; font-size: 12pt; }
  .pill-ttl.sm { font-size: 10.5pt; padding: 2mm 8mm; margin-top: 7mm; }
  .row { display: flex; align-items: center; gap: 2mm; margin: 3.2mm 0; flex-wrap: nowrap; }
  .row.two { justify-content: space-between; font-size: 11pt; }
  .row.gap { gap: 7mm; }
  .lbl { white-space: nowrap; min-width: 0; font-weight: 500; }
  .lbl.r { margin-left: auto; }
  .bx { display:inline-block; height: 7mm; border: 1.2px solid var(--ink); border-radius: 2mm; vertical-align: middle; flex: 0 0 auto; }
  .ln { display:inline-block; border-bottom: 1.2px solid var(--ink); height: 5mm; vertical-align: bottom; flex: 0 0 auto; }
  .dt { display:inline-flex; width: 30mm; height: 7mm; border: 1.2px solid var(--ink); border-radius: 2mm; flex: 0 0 auto; }
  .dt i { flex:1; border-right: 1.2px solid var(--ink); } .dt::after { content:""; flex:1.6; }
  .rad { display:inline-flex; align-items:center; gap: 2mm; white-space: nowrap; }
  .rad .c { width: 5.5mm; height: 5.5mm; border: 1.2px solid var(--ink); border-radius: 50%; display:inline-block; }
  hr { border:0; border-top: 1px solid var(--rule); margin: 3mm 0; }
  h3, h4 { margin: 3mm 0 1.5mm; color: var(--brown); } h3 { font-size: 12pt; } h4 { font-size: 10.5pt; } .c { text-align:center; }
  p { margin: 1.8mm 0; } .note { font-size: 9.4pt; color:#3d2a16; }
  ol.roman { list-style: upper-roman; padding-left: 9mm; margin: 0; font-size: 9pt; line-height: 1.36; text-align: justify; }
  ol.roman li { margin-bottom: 1.4mm; padding-left: 1mm; }
  ol.roman.tight { font-size: 9.8pt; } ol.roman.tight li { margin-bottom: .8mm; }
  ol.alpha { list-style: upper-alpha; padding-left: 8mm; margin: 0; } ol.alpha > li { margin-bottom: 2.4mm; } ol.alpha ol { list-style: decimal; padding-left: 7mm; margin-top: .8mm; }
  ol { padding-left: 7mm; } ol li { margin-bottom: 1.2mm; }
  .cols { display:flex; gap: 8mm; } .cols ul { flex:1; margin: 0; padding-left: 0; list-style: none; font-size: 9.4pt; }
  .cols li::before { content: "› "; color: var(--gold); font-weight: 700; } .cols li { margin-bottom: .9mm; }
  .framed { border: 1.5px solid var(--brown); border-radius: 4mm; padding: 4mm 6mm; margin: 2mm 6mm 4mm; font-size: 9.6pt; }
  .three { display:flex; justify-content: space-around; margin-top: 3mm; font-weight: 600; }
  .areas { display:grid; grid-template-columns: repeat(7, 1fr); gap: 3mm; margin: 2mm 0; text-align:center; font-size: 9.4pt; }
  .areas b { display:block; margin-bottom: 1mm; font-weight: 600; } .areas .bx { width: 100%; height: 6.5mm; box-sizing: border-box; }
  .heads { display:flex; justify-content:center; gap: 14mm; margin: 2mm 0 1mm; }
  .spacer { height: 10mm; }
  .row.wrap { flex-wrap: wrap; row-gap: 3mm; } .row.top { align-items: flex-start; } .bx.tall { height: 26mm; }
  .dense { font-size: 9.4pt; } .dense .row { margin: 2.2mm 0; } .dense ol.roman { font-size: 8.6pt; } .dense .cols ul { font-size: 8.8pt; } .dense .bar { margin: 2mm 0; padding: 1.2mm; } .dense .bx, .dense .dt { height: 6.2mm; }
  .dense .heads svg { width: 160px; height: 174px; } .dense .heads { margin: 1mm 0 0; }`;

const sheet = (pages, extra) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&family=Noto+Sans+Telugu:wght@400;600;700&display=block" rel="stylesheet">
<style>${CSS}${extra || ""}</style></head><body>${pages.join("")}</body></html>`;

// pages: the HTML of each page(); out: the PDF path; extra: CSS a document
// adds on top of the shared sheet (the handouts set their own list style).
// Prints how many pages
// fit, or which one overflows — a page whose content runs past the sheet
// prints onto a blank extra page, and nobody wants to find that out after
// a hundred copies.
async function render(pages, out, extra) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const pg = await browser.newPage();
  await pg.setContent(sheet(pages, extra), { waitUntil: "networkidle0", timeout: 90000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.emulateMediaType("print");
  const over = await pg.evaluate(() => [...document.querySelectorAll(".pg")].map((p, i) => { const room = p.clientHeight, used = p.scrollHeight; return used > room + 1 ? `page ${i + 1} overflows by ${Math.round(used - room)}px` : null; }).filter(Boolean));
  await pg.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  // The PDF itself is the proof: a sheet taller than the paper, or a page
  // that ran long, shows up as extra pages here whatever the DOM said.
  const pdf = fs.readFileSync(out);
  const n = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length, a4 = /\/MediaBox\s*\[\s*0\s+0\s+59[45](\.\d+)?\s+84[12](\.\d+)?\s*\]/.test(pdf.toString("latin1"));
  const bad = [...over, n !== pages.length ? `PDF has ${n} pages, not ${pages.length}` : null, a4 ? null : "paper is not A4"].filter(Boolean);
  console.log(path.basename(out), bad.length ? "⚠ " + bad.join("; ") : `${pages.length} pages A4, all fit`);
  await browser.close();
}

module.exports = { box, line, date, o, HEAD, AREAS, head, foot, page, bar, sigrow, render, CLINIC, B, credit, logo };
