// Referral pad, A5, one sheet. Re-run:
//   node print/make-referral-pad.js            →  print/referral-pad.pdf + .png  (Dr. Nikhitha)
//   node print/make-referral-pad.js meghana    →  print/referral-pad-meghana.pdf + .png
//
// Owner, 12 Nov 2026: a pad to hand to doctors in and around Eluru so they
// can refer a patient to the clinic. The layout follows the owner's pen
// sketch on a clipboard — brand on the left, the clinic's dermatologist on
// the right, then address, patient name and mobile, the referring doctor,
// chief complaints, consultation-or-treatment, and a grid of the treatments
// the referring doctor can tick. Added beyond the sketch: a date, age/sex,
// and a signature line, because a slip without those is a slip the desk
// has to phone about. The doctor's registration number sits under the name
// — a letterhead that names a doctor carries it.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const QR = require("../node_modules/qrcode");
// The clinic's own Google Business listing, by its id: the same link the
// website's "directions" button opens, short enough for a small QR.
const MAPS = "https://www.google.com/maps?cid=6720707313608974554";
const WA = "https://wa.me/919959134666"; // the clinic's public WhatsApp number, as on the website
const { B, logo } = require("./ht-forms-lib.js");
const docs = require("../api/_docs.js");

const who = (process.argv[2] || "nikhitha").toLowerCase();
const DOC = docs.DOCTORS[who];
if (!DOC) { console.error("unknown doctor:", who, "— one of", Object.keys(docs.DOCTORS).join(", ")); process.exit(1); }
const suffix = who === "nikhitha" ? "" : "-" + who;

const line = (w) => `<span class="ln" style="width:${w}"></span>`;
const date = () => `<span class="dt"><i></i><i></i></span>`;
const tick = (label) => `<span class="tk"><span class="c"></span>${label}</span>`;

// The twelve treatments from the sketch, in its order, as a tick grid.
const TREATMENTS = [
  "Laser Hair Removal", "HydraFacial", "Pico Laser", "CO<sub>2</sub> Laser",
  "MNRF", "HIFU", "Hair Transplant", "RF",
  "Skin Lightening Treatment", "Chemical Peels", "Medi Facials", "Glow Drips",
];

const PAGE = `<section class="pg">
  <div class="hd">
    <div class="brand"><img src="${logo}" alt=""><div><b>DermaLuxe <small>by</small> Medicare</b><span>Premium Skin &amp; Hair Clinic · Eluru</span></div></div>
    <div class="doc"><b>${DOC.name}</b><span>${DOC.q}</span><span>Dermatologist &amp; Cosmetologist</span><em>Reg. No. ${DOC.reg}</em></div>
  </div>
  <div class="addr">${B.addr}</div>

  <div class="title">Patient Referral</div>

  <div class="row"><span class="lbl">Date:</span>${date()}<span class="lbl r">Ref. No:</span>${line("24mm")}</div>
  <div class="row"><span class="lbl">Patient Name:</span>${line("100%")}</div>
  <div class="row"><span class="lbl">Age:</span>${line("12mm")}<span class="lbl g">Sex:</span>${line("12mm")}<span class="lbl g">Mobile:</span>${line("100%")}</div>
  <div class="row"><span class="lbl">Referred by Dr.:</span>${line("100%")}</div>
  <div class="row"><span class="lbl">Chief Complaints:</span>${line("100%")}</div>
  <div class="row more">${line("100%")}</div>
  <div class="row more">${line("100%")}</div>

  <div class="row for"><span class="lbl">Referred for:</span>${tick("Consultation")}${tick("Treatment")}</div>

  <div class="grid">${TREATMENTS.map((t) => `<div class="cell"><span class="c"></span><span>${t}</span></div>`).join("")}</div>

  <div class="sign"><div class="qrs"><div class="qr">__QR__<div><b>Clinic location</b><span>Scan for Google<br>Maps directions</span></div></div><div class="qr">__WA__<div><b>WhatsApp us</b><span>Scan to chat<br>99591 34666</span></div></div></div><span>Referring Doctor's Signature &amp; Stamp</span></div>

  <div class="ft"><div><b>Call</b> ${B.call.replace("+91 ", "")} · <b>WhatsApp</b> ${B.wa} · www.dermaluxe.ai · ${B.email}</div></div>
</section>`;

const CSS = `
  @page { size: A5; margin: 0; }
  :root { --gold:#b8893d; --brown:#4a2a12; --ink:#2b1a0e; --rule:#cdb48a; --cream:#fbf6ec; }
  html, body { margin:0; background:#fff; }
  body { font-family: Jost, Arial, sans-serif; color: var(--ink); font-size: 9.6pt; line-height: 1.35; }
  .pg { width: 148mm; height: 210mm; box-sizing: border-box; padding: 8mm 9mm 8mm; display: flex; flex-direction: column; position: relative; background:#fff; }
  .pg::before { content:""; position:absolute; inset:4mm; border:1.3px solid var(--gold); border-radius:3mm; pointer-events:none; }
  .hd { display:flex; justify-content:space-between; align-items:center; gap: 4mm; border-bottom: 1.8px solid var(--gold); padding-bottom: 2.4mm; }
  .brand { display:flex; align-items:center; gap: 2.6mm; }
  .brand img { height: 11.5mm; border-radius: 1.8mm; background:#1a0f07; padding: 1mm 2.2mm; box-sizing: content-box; }
  .brand b { display:block; font-size: 11.4pt; color: var(--brown); letter-spacing:.01em; line-height: 1.1; white-space: nowrap; }
  .brand b small { font-size: 8.4pt; font-weight: 500; color: var(--gold); letter-spacing: .06em; }
  .brand span { display:block; margin-top: .8mm; font-size: 6.6pt; letter-spacing: .13em; white-space: nowrap; text-transform: uppercase; color: var(--gold); font-weight: 600; }
  .doc { text-align: right; line-height: 1.22; flex: 0 1 auto; min-width: 0; }
  .doc b { display:block; font-size: 10.4pt; color: var(--brown); }
  .doc span { display:block; font-size: 7.4pt; color: #5b4128; }
  .doc em { display:block; font-style: normal; font-size: 7pt; color: #7a6650; letter-spacing: .03em; margin-top: .5mm; }
  .addr { font-size: 7.1pt; color: #5b4128; text-align: center; padding: 1.8mm 0; border-bottom: 1px solid var(--rule); line-height: 1.3; }
  .title { margin: 3.2mm auto 1.2mm; width: max-content; background: var(--brown); color: #fbe7b0; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; padding: 1.5mm 7mm; border-radius: 100px; font-size: 8.6pt; }
  .row { display: flex; align-items: flex-end; gap: 2mm; margin-top: 5mm; }
  .row.more { margin-top: 5mm; }
  .lbl { white-space: nowrap; font-weight: 500; line-height: 1; padding-bottom: .6mm; }
  .lbl.r { margin-left: auto; } .lbl.g { margin-left: 3mm; }
  .ln { display:inline-block; border-bottom: 1px solid var(--ink); height: 4.6mm; flex: 1 1 auto; min-width: 0; }
  .ln[style*="mm"] { flex: 0 0 auto; }
  .dt { display:inline-flex; width: 28mm; height: 6.4mm; border: 1.1px solid var(--ink); border-radius: 1.6mm; flex: 0 0 auto; }
  .dt i { flex:1; border-right: 1.1px solid var(--ink); } .dt::after { content:""; flex:1.6; }
  .row.for { align-items: center; gap: 7mm; margin-top: 6mm; }
  .tk { display:inline-flex; align-items:center; gap: 2mm; font-weight: 600; font-size: 10pt; }
  .c { width: 5mm; height: 5mm; border: 1.1px solid var(--ink); border-radius: 1.2mm; display:inline-block; flex: 0 0 auto; background:#fff; }
  .grid { display:grid; grid-template-columns: repeat(4, 1fr); gap: 2.2mm; margin-top: 4.6mm; }
  .cell { display:flex; align-items:center; gap: 1.8mm; border: 1px solid var(--rule); border-radius: 1.8mm; padding: 2.2mm 2mm; font-size: 8.6pt; font-weight: 500; line-height: 1.15; min-height: 10mm; box-sizing: border-box; background: var(--cream); }
  .cell .c { width: 4.4mm; height: 4.4mm; }
  .cell sub { font-size: .7em; vertical-align: baseline; position: relative; top: .35em; }
  .sign { margin-top: auto; display:flex; justify-content: space-between; align-items: flex-end; padding-top: 2mm; }
  .sign > span { border-top: 1px solid var(--ink); padding-top: 1.2mm; width: 46mm; text-align:center; font-size: 7.4pt; color:#5b4128; margin-top: 6mm; }
  .qrs { display:flex; gap: 5mm; }
  .qr { display:flex; align-items:center; gap: 2mm; }
  .qr svg { width: 14mm; height: 14mm; display:block; }
  .qr b { display:block; font-size: 7.8pt; color: var(--brown); line-height: 1.2; }
  .qr span { display:block; font-size: 6.8pt; color: #5b4128; line-height: 1.25; }
  .ft { margin-top: 3mm; border-top: 1px solid var(--rule); padding-top: 1.8mm; font-size: 7.4pt; color: #5b4128; text-align: center; }`;

const html0 = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&display=block" rel="stylesheet">
<style>${CSS}</style></head><body>${PAGE}</body></html>`;

(async () => {
  const outPdf = path.join(__dirname, `referral-pad${suffix}.pdf`), outPng = path.join(__dirname, `referral-pad${suffix}.png`);
  const qrSvg = (u) => QR.toString(u, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#2b1a0e", light: "#ffffff" } });
  const html = html0.replace("__QR__", await qrSvg(MAPS)).replace("__WA__", await qrSvg(WA));
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 560, height: 794, deviceScaleFactor: 3 });
  await pg.setContent(html, { waitUntil: "networkidle0", timeout: 90000 });
  await pg.evaluate(() => document.fonts.ready);
  const over = await pg.evaluate(() => { const p = document.querySelector(".pg"), f = document.querySelector(".ft").getBoundingClientRect(), r = p.getBoundingClientRect(); return Math.max(p.scrollHeight - p.clientHeight, Math.round(f.bottom - (r.bottom - 7 * 3.78))); });
  const el = await pg.$(".pg");
  await el.screenshot({ path: outPng });
  await pg.emulateMediaType("print");
  await pg.pdf({ path: outPdf, preferCSSPageSize: true, printBackground: true });
  // The PDF is the proof: one page, and the page is A5 (420 × 595 pt).
  const pdf = fs.readFileSync(outPdf).toString("latin1");
  const n = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length, a5 = /\/MediaBox\s*\[\s*0\s+0\s+4(19|20)(\.\d+)?\s+59[45](\.\d+)?\s*\]/.test(pdf);
  const bad = [over > 1 ? `content overflows by ${over}px` : null, n !== 1 ? `PDF has ${n} pages, not 1` : null, a5 ? null : "paper is not A5"].filter(Boolean);
  console.log(path.basename(outPdf), bad.length ? "⚠ " + bad.join("; ") : "1 page A5, fits", "·", DOC.name);
  await browser.close();
})();
