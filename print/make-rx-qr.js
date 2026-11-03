// The QR printed on the clinic's prescription pad. Re-run to rebuild:
//   node print/make-rx-qr.js
// It encodes https://www.dermaluxe.ai/r/rx, which api/r.js counts (utm:rx:<date>)
// and sends to the AI skin analysis on the home page. That link is now on
// paper: never rename or remove the "rx" tag in api/r.js.
const fs = require("fs"), path = require("path");
const QR = require("../node_modules/qrcode");
const puppeteer = require("../node_modules/puppeteer-core");
const URL = "https://www.dermaluxe.ai/r/rx";
const OUT = __dirname;

(async () => {
  // H = 30% of the code can be smudged or folded and it still reads
  const svg = await QR.toString(URL, { type: "svg", errorCorrectionLevel: "H", margin: 4, color: { dark: "#000000", light: "#ffffff" } });
  fs.writeFileSync(path.join(OUT, "rx-qr.svg"), svg);
  await QR.toFile(path.join(OUT, "rx-qr.png"), URL, { errorCorrectionLevel: "H", margin: 4, width: 1800 });
  const inner = svg.replace(/^<\?xml[^>]*>/, "");
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;600&family=Noto+Sans+Telugu:wght@500&display=block" rel="stylesheet">
<style>
  @page { size: 34mm 47mm; margin: 0 }
  html, body { margin: 0; background: #fff; }
  .l { width: 34mm; height: 47mm; box-sizing: border-box; padding: 1.5mm 2mm; display: flex; flex-direction: column; align-items: center;
       font-family: Jost, "Noto Sans Telugu", sans-serif; color: #000; text-align: center; }
  .q { width: 28mm; height: 28mm; } .q svg { width: 100%; height: 100%; display: block; }
  .t { font-weight: 600; font-size: 9pt; line-height: 1.1; margin-top: .6mm; letter-spacing: .02em; }
  .te { font-family: "Noto Sans Telugu", sans-serif; font-weight: 500; font-size: 7.5pt; line-height: 1.25; }
  .s { font-size: 6.5pt; line-height: 1.2; margin-top: .4mm; }
  .u { font-size: 5.5pt; margin-top: .5mm; letter-spacing: .02em; }
</style></head><body><div class="l">
  <div class="q">${inner}</div>
  <div class="t">AI Skin Analysis</div>
  <div class="te">AI చర్మ విశ్లేషణ</div>
  <div class="s">Camera tho scan cheyandi</div>
  <div class="u">dermaluxe.ai/r/rx</div>
</div></body></html>`;
  const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
  const pg = await b.newPage();
  await pg.setContent(html, { waitUntil: "networkidle0" });
  await pg.evaluate(() => document.fonts.ready);
  await pg.pdf({ path: path.join(OUT, "rx-qr-label.pdf"), width: "34mm", height: "47mm", printBackground: true, pageRanges: "1" });
  // 600 dpi PNG of the same label: 34mm x 47mm = 803 x 1110 px
  await pg.setViewport({ width: 129, height: 178, deviceScaleFactor: 6.25 });
  await pg.screenshot({ path: path.join(OUT, "rx-qr-label.png"), clip: { x: 0, y: 0, width: 128.5, height: 177.6 } });
  await b.close();
  console.log("wrote rx-qr.svg, rx-qr.png, rx-qr-label.pdf, rx-qr-label.png for", URL);
})();
