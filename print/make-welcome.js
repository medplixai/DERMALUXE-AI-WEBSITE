// Welcome board for the opening, 6 November 2026: a 2 x 3 ft standee at the entrance. Re-run:
//   node print/make-welcome.js
// welcome-board.pdf  24 x 36 in, 5 mm bleed on every side, for the flex printer
// welcome-board.jpg  the same without bleed, 3600 x 5400 (150 dpi at full size)
// Same black-and-gold as make-invite.js. The building in the arch is invite/building-empty-final.jpg.
// Hosts by name only: this stands in public, and a board is no place for the doctors' photos.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const goldify = require("./gold-text");
const data = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(__dirname, f)).toString("base64");
const logo = data("../assets/logo.png", "image/png");
const building = data("invite/building-empty-final.jpg", "image/jpeg");
const HOSTS = [
  ["Nagaraju<br>Bandaru", "MBA", "Founder &amp; Managing Director"],
  ["Dr. Meghana<br>Valeti", "MD (DVL)", "Co-Founder &amp; Medical Director"],
  ["Dr. Nikhitha<br>Priyanka", "MD (DVL)", "Chief Dermatologist, DermaLuxe"],
  ["Dr. Kamma<br>Sai Divija", "MD (DVL)", "Chief Dermatologist, Medicare Skin &amp; Hair Clinic"],
];
const W = 609.6, H = 914.4;

const page = (bleed) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Jost:wght@400;500&family=Noto+Serif+Telugu:wght@600&display=block" rel="stylesheet">
<style>
  @page { size: ${W + 2 * bleed}mm ${H + 2 * bleed}mm; margin: 0 }
  :root { --ink: #0d0c0b; --gold: #d9b56c; --gold-hi: #f3dfae; --cream: #f4ece0; --muted: #b9ab95; }
  html, body { margin: 0; background: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { position: relative; width: ${W + 2 * bleed}mm; height: ${H + 2 * bleed}mm; overflow: hidden; background: var(--ink); }
  .glow { position: absolute; inset: 0; background: radial-gradient(75% 30% at 50% 18%, #2e2517 0%, rgba(13,12,11,0) 100%),
          radial-gradient(70% 26% at 50% 100%, #221b12 0%, rgba(13,12,11,0) 100%); }
  .board { position: absolute; left: ${bleed}mm; top: ${bleed}mm; width: ${W}mm; height: ${H}mm; box-sizing: border-box;
           padding: 46mm 48mm 40mm; display: flex; flex-direction: column; align-items: center; text-align: center;
           color: var(--cream); font-family: Jost, sans-serif; }
  .frame { position: absolute; inset: 18mm; border: 1.6mm solid var(--gold); }
  .frame::after { content: ""; position: absolute; inset: 5mm; border: .6mm solid rgba(217,181,108,.55); }
  .corner { position: absolute; width: 30mm; height: 30mm; background: var(--ink); }
  .corner::before { content: ""; position: absolute; inset: 8mm; transform: rotate(45deg); border: 1.6mm solid var(--gold); }
  .c1 { left: 6mm; top: 6mm } .c2 { right: 6mm; top: 6mm } .c3 { left: 6mm; bottom: 6mm } .c4 { right: 6mm; bottom: 6mm }
  .board > :not(.frame) { position: relative; }
  .logo { width: 250mm; display: block; }
  .te { font-family: "Noto Serif Telugu", serif; font-weight: 600; color: var(--gold-hi); font-size: 118pt; line-height: 1.25; margin-top: 12mm; }
  .welcome { font-family: "Cormorant Garamond", serif; font-style: italic; font-weight: 500; font-size: 270pt; line-height: .95; margin-top: -2mm;
             background: linear-gradient(180deg, #f6e6bd 0%, #e3c074 45%, #b88d45 100%); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 8mm 6mm; }
  .lead { font-family: "Cormorant Garamond", serif; font-style: italic; font-size: 62pt; color: var(--cream); margin-top: 0; }
  .arch { width: 400mm; height: 330mm; margin-top: 16mm; border-radius: 200mm 200mm 6mm 6mm; padding: 3.5mm; border: 1.6mm solid var(--gold); box-sizing: border-box; }
  .arch div { width: 100%; height: 100%; border-radius: 196mm 196mm 3mm 3mm; background: url("${building}") 62% 66% / 135% auto no-repeat; }
  .strip { margin-top: 18mm; display: flex; align-items: center; gap: 10mm; font-size: 40pt; letter-spacing: .22em; text-transform: uppercase; color: var(--gold-hi); }
  .strip i { width: 5mm; height: 5mm; transform: rotate(45deg); background: var(--gold); }
  .lbl { margin-top: 20mm; font-size: 26pt; letter-spacing: .4em; text-transform: uppercase; color: var(--gold); }
  .hosts { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 9mm; width: 100%; margin-top: 9mm; }
  .h { border-top: .5mm solid rgba(217,181,108,.5); padding-top: 5mm; }
  .h .n { font-family: "Cormorant Garamond", serif; font-weight: 600; font-size: 44pt; line-height: 1.1; color: var(--gold-hi); }
  .h .q { font-size: 23pt; letter-spacing: .12em; margin-top: 2.5mm; }
  .h .r { font-size: 20pt; line-height: 1.35; color: var(--muted); margin-top: 1.5mm; }
  .foot { margin-top: auto; font-size: 32pt; letter-spacing: .16em; color: var(--muted); }
  .foot b { color: var(--gold); font-weight: 500; }
</style></head><body><section class="sheet"><div class="glow"></div>
<div class="board">
  <div class="frame"><i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i></div>
  <img class="logo" src="${logo}" alt="DermaLuxe by Medicare">
  <div class="te">సుస్వాగతం</div>
  <div class="welcome">Welcome</div>
  <div class="lead">to the Grand Opening</div>
  <div class="arch"><div></div></div>
  <div class="strip"><span>Friday</span><i></i><span>6 November 2026</span><i></i><span>10:32 AM</span></div>
  <div class="lbl">Hosted by</div>
  <div class="hosts">${HOSTS.map(([n, q, r]) => `<div class="h"><div class="n">${n}</div><div class="q">${q}</div><div class="r">${r}</div></div>`).join("")}</div>
  <div class="foot"><b>+91 99591 34666</b> &nbsp;·&nbsp; www.dermaluxe.ai</div>
</div></section></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const pg = await browser.newPage();
  const load = async (html) => {
    await pg.setContent(html, { waitUntil: "load", timeout: 90000 });
    await pg.evaluate(async () => { await document.fonts.ready; });
    await pg.evaluate(goldify, ".welcome");
  };
  await load(page(5));
  await pg.pdf({ path: path.join(__dirname, "welcome-board.pdf"), preferCSSPageSize: true, printBackground: true });
  // 609.6 mm at 96 css px/in = 2304 px wide; scale to 3600
  const w = W / 25.4 * 96, h = H / 25.4 * 96, s = 3600 / w;
  await pg.setViewport({ width: Math.round(w), height: Math.round(h), deviceScaleFactor: s });
  await load(page(0));
  console.log(JSON.stringify(await pg.evaluate(() => { const b = document.querySelector(".board");
    return { fits: b.scrollHeight <= b.clientHeight + 1, free: b.clientHeight - b.scrollHeight }; })));
  await pg.screenshot({ path: path.join(__dirname, "welcome-board.jpg"), type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: w, height: h } });
  await browser.close();
})();
