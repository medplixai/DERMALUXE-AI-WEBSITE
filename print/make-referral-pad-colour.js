// Referral pad, A5, the multicolour version with treatment icons. Re-run:
//   node print/make-referral-pad-colour.js            →  print/referral-pad-colour.pdf + .png  (Dr. Nikhitha)
//   node print/make-referral-pad-colour.js meghana    →  print/referral-pad-colour-meghana.pdf + .png
// Icons come from print/refpad-icons.js (run that first if print/refpad/ is empty).
//
// Owner, 12 Nov 2026, after seeing the gold-and-brown pad: "multicolour
// design, images add". Same sheet as make-referral-pad.js — brand left,
// dermatologist right, address, patient and referring doctor, chief
// complaints, consultation-or-treatment, twelve treatments to tick — but
// every treatment now has its own colour and its own icon, and the colours
// run as a stripe under the header so the sheet reads as one set. The
// icons are drawn, not photographed: no people, no faces, no results.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const QR = require("../node_modules/qrcode");
// The clinic's own Google Business listing, by its id: the same link the
// website's "directions" button opens, short enough for a small QR.
const MAPS = "https://www.google.com/maps?cid=6720707313608974554";
const WA = "https://wa.me/919959134666"; // the clinic's public WhatsApp number, as on the website
const { B, logo } = require("./ht-forms-lib.js");
const { ICONS } = require("./refpad-icons.js");
const docs = require("../api/_docs.js");

const who = (process.argv[2] || "nikhitha").toLowerCase();
const DOC = docs.DOCTORS[who];
if (!DOC) { console.error("unknown doctor:", who, "— one of", Object.keys(docs.DOCTORS).join(", ")); process.exit(1); }
const suffix = who === "nikhitha" ? "" : "-" + who;

const icon = (slug) => {
  const f = path.join(__dirname, "refpad", "sm", slug + ".png");
  if (!fs.existsSync(f)) { console.error("icon missing:", f, "— run node print/refpad-icons.js"); process.exit(1); }
  return "data:image/png;base64," + fs.readFileSync(f).toString("base64");
};
const line = (w) => `<span class="ln" style="width:${w}"></span>`;
const date = () => `<span class="dt"><i></i><i></i></span>`;
const tick = (label, hex) => `<span class="tk" style="--h:${hex}"><span class="c"></span>${label}</span>`;

const stripe = `<div class="stripe">${ICONS.map(([, , hex]) => `<i style="background:${hex}"></i>`).join("")}</div>`;
const cells = ICONS.map(([slug, label, hex]) => `<div class="cell" style="--h:${hex}"><img src="${icon(slug)}" alt=""><span class="c"></span><span class="t">${label.replace("CO₂", "CO<sub>2</sub>")}</span></div>`).join("");

const PAGE = `<section class="pg">
  <div class="hd">
    <div class="brand"><img src="${logo}" alt=""><div><b>DermaLuxe <small>by</small> Medicare</b><span>Premium Skin &amp; Hair Clinic · Eluru</span></div></div>
    <div class="doc"><b>${DOC.name}</b><span>${DOC.q}</span><span>Dermatologist &amp; Cosmetologist</span><em>Reg. No. ${DOC.reg}</em></div>
  </div>
  ${stripe}
  <div class="addr">${B.addr}</div>

  <div class="title">Patient Referral</div>

  <div class="row"><span class="lbl">Date:</span>${date()}<span class="lbl r">Ref. No:</span>${line("24mm")}</div>
  <div class="row"><span class="lbl">Patient Name:</span>${line("100%")}</div>
  <div class="row"><span class="lbl">Age:</span>${line("12mm")}<span class="lbl g">Sex:</span>${line("12mm")}<span class="lbl g">Mobile:</span>${line("100%")}</div>
  <div class="row"><span class="lbl">Referred by Dr.:</span>${line("100%")}</div>
  <div class="row"><span class="lbl">Chief Complaints:</span>${line("100%")}</div>
  <div class="row more">${line("100%")}</div>
  <div class="row more">${line("100%")}</div>

  <div class="row for"><span class="lbl">Referred for:</span>${tick("Consultation", "#15a58a")}${tick("Treatment", "#d9455a")}</div>

  <div class="grid">${cells}</div>

  <div class="sign"><div class="qrs"><div class="qr">__QR__<div><b>Clinic location</b><span>Scan for Google<br>Maps directions</span></div></div><div class="qr">__WA__<div><b>WhatsApp us</b><span>Scan to chat<br>99591 34666</span></div></div></div><span>Referring Doctor's Signature &amp; Stamp</span></div>

  <div class="ft"><div><b>Call</b> ${B.call.replace("+91 ", "")} · <b>WhatsApp</b> ${B.wa} · www.dermaluxe.ai · ${B.email}</div></div>
</section>`;

const CSS = `
  @page { size: A5; margin: 0; }
  :root { --gold:#b8893d; --brown:#4a2a12; --ink:#2b1a0e; --rule:#d9c9ae; }
  html, body { margin:0; background:#fff; }
  body { font-family: Jost, Arial, sans-serif; color: var(--ink); font-size: 9.6pt; line-height: 1.35; }
  .pg { width: 148mm; height: 210mm; box-sizing: border-box; padding: 7.5mm 9mm 8mm; display: flex; flex-direction: column; position: relative; background:#fff; }
  .pg::before { content:""; position:absolute; inset:4mm; border:1.3px solid var(--gold); border-radius:3mm; pointer-events:none; }
  .hd { display:flex; justify-content:space-between; align-items:center; gap: 4mm; padding-bottom: 2.2mm; }
  .brand { display:flex; align-items:center; gap: 2.6mm; }
  .brand img { height: 11.5mm; border-radius: 1.8mm; background:#1a0f07; padding: 1mm 2.2mm; box-sizing: content-box; }
  .brand b { display:block; font-size: 11.4pt; color: var(--brown); letter-spacing:.01em; line-height: 1.1; white-space: nowrap; }
  .brand b small { font-size: 8.4pt; font-weight: 500; color: var(--gold); letter-spacing: .06em; }
  .brand span { display:block; margin-top: .8mm; font-size: 6.6pt; letter-spacing: .13em; white-space: nowrap; text-transform: uppercase; color: var(--gold); font-weight: 600; }
  .doc { text-align: right; line-height: 1.22; flex: 0 1 auto; min-width: 0; }
  .doc b { display:block; font-size: 10.4pt; color: var(--brown); }
  .doc span { display:block; font-size: 7.4pt; color: #5b4128; }
  .doc em { display:block; font-style: normal; font-size: 7pt; color: #7a6650; letter-spacing: .03em; margin-top: .5mm; }
  .stripe { display:flex; height: 1.7mm; flex: 0 0 auto; border-radius: 1mm; overflow:hidden; } .stripe i { flex:1; display:block; }
  .addr { font-size: 7.1pt; color: #5b4128; text-align: center; padding: 1.4mm 0; border-bottom: 1px solid var(--rule); line-height: 1.3; }
  .title { margin: 3mm auto 1mm; width: max-content; color: #fff; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; padding: 1.6mm 8mm; border-radius: 100px; font-size: 8.6pt;
    background: linear-gradient(90deg, #d9455a, #f2892a 30%, #15a58a 60%, #3273e0 80%, #7a4fd6); }
  .row { display: flex; align-items: flex-end; gap: 2mm; margin-top: 4mm; }
  .row.more { margin-top: 4.3mm; }
  .lbl { white-space: nowrap; font-weight: 600; line-height: 1; padding-bottom: .6mm; color: var(--brown); }
  .lbl.r { margin-left: auto; } .lbl.g { margin-left: 3mm; }
  .ln { display:inline-block; border-bottom: 1px solid #6b5640; height: 4.6mm; flex: 1 1 auto; min-width: 0; }
  .ln[style*="mm"] { flex: 0 0 auto; }
  .dt { display:inline-flex; width: 28mm; height: 6.4mm; border: 1.1px solid #6b5640; border-radius: 1.6mm; flex: 0 0 auto; }
  .dt i { flex:1; border-right: 1.1px solid #6b5640; } .dt::after { content:""; flex:1.6; }
  .row.for { align-items: center; gap: 7mm; margin-top: 4.8mm; }
  .tk { display:inline-flex; align-items:center; gap: 2mm; font-weight: 600; font-size: 10pt; color: color-mix(in srgb, var(--h) 70%, black); }
  .c { width: 5mm; height: 5mm; border: 1.3px solid var(--h, var(--ink)); border-radius: 1.2mm; display:inline-block; flex: 0 0 auto; background:#fff; }
  .grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.8mm; margin-top: 3.6mm; }
  .cell { display:flex; align-items:center; gap: 1.6mm; border: 1.2px solid var(--h); border-radius: 2.2mm; padding: 1.6mm 1.6mm 1.6mm 1.4mm; font-size: 8.4pt; font-weight: 600; line-height: 1.12; min-height: 10mm; box-sizing: border-box; min-width: 0; overflow: hidden;
    background: color-mix(in srgb, var(--h) 11%, white); color: color-mix(in srgb, var(--h) 72%, black); }
  .cell img { width: 8.4mm; height: 8.4mm; object-fit: contain; border-radius: 1.6mm; background: #fff; flex: 0 0 auto; }
  .cell .c { width: 4.2mm; height: 4.2mm; }
  .cell .t { flex: 1 1 auto; min-width: 0; }
  .cell sub { font-size: .7em; vertical-align: baseline; position: relative; top: .35em; }
  .sign { margin-top: auto; display:flex; justify-content: space-between; align-items: flex-end; padding-top: 1mm; }
  .sign > span { border-top: 1px solid #6b5640; padding-top: 1.2mm; width: 46mm; text-align:center; font-size: 7.4pt; color:#5b4128; margin-top: 5mm; }
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
  const outPdf = path.join(__dirname, `referral-pad-colour${suffix}.pdf`), outPng = path.join(__dirname, `referral-pad-colour${suffix}.png`);
  const qrSvg = (u) => QR.toString(u, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#2b1a0e", light: "#ffffff" } });
  const html = html0.replace("__QR__", await qrSvg(MAPS)).replace("__WA__", await qrSvg(WA));
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 560, height: 794, deviceScaleFactor: 3 });
  await pg.setContent(html, { waitUntil: "networkidle0", timeout: 90000 });
  await pg.evaluate(() => document.fonts.ready);
  // Overflow is measured at the footer: it must end at least 7mm above the
  // sheet's bottom edge, which keeps it clear of the gold frame at 4mm.
  const over = await pg.evaluate(() => { const p = document.querySelector(".pg"), f = document.querySelector(".ft").getBoundingClientRect(), r = p.getBoundingClientRect(); return Math.max(p.scrollHeight - p.clientHeight, Math.round(f.bottom - (r.bottom - 7 * 3.78))); });
  const el = await pg.$(".pg");
  await el.screenshot({ path: outPng });
  await pg.emulateMediaType("print");
  await pg.pdf({ path: outPdf, preferCSSPageSize: true, printBackground: true });
  const pdf = fs.readFileSync(outPdf).toString("latin1");
  const n = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length, a5 = /\/MediaBox\s*\[\s*0\s+0\s+4(19|20)(\.\d+)?\s+59[45](\.\d+)?\s*\]/.test(pdf);
  const bad = [over > 1 ? `content overflows by ${over}px` : null, n !== 1 ? `PDF has ${n} pages, not 1` : null, a5 ? null : "paper is not A5"].filter(Boolean);
  console.log(path.basename(outPdf), bad.length ? "⚠ " + bad.join("; ") : "1 page A5, fits", "·", DOC.name, "·", Math.round(fs.statSync(outPdf).size / 1024) + " KB");
  await browser.close();
})();
