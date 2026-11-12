// Opening poster built on the clinic's own team photo at the reception (a real photograph: only
// cropped, brightened and warmed in invite/team-edited.jpg, nobody's face touched). Re-run:
//   node print/make-team-poster.js
// team-poster.png  2160 x 2700 (4:5), for WhatsApp and Instagram
// team-poster.pdf  8 x 10 in, 3 mm bleed, if it is printed
// Doctors are in the photo, so: send it, never boost it as an ad (NMC 9.2).
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const goldify = require("./gold-text");
const data = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(__dirname, f)).toString("base64");
const photo = data("invite/team-edited.jpg", "image/jpeg");
const W = 203.2, H = 254;

const page = (bleed) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Jost:wght@400;500&family=Noto+Serif+Telugu:wght@500&display=block" rel="stylesheet">
<style>
  @page { size: ${W + 2 * bleed}mm ${H + 2 * bleed}mm; margin: 0 }
  :root { --ink: #0d0c0b; --gold: #d9b56c; --gold-hi: #f3dfae; --cream: #f4ece0; --muted: #b9ab95; }
  html, body { margin: 0; background: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { position: relative; width: ${W + 2 * bleed}mm; height: ${H + 2 * bleed}mm; overflow: hidden; background: var(--ink); }
  .glow { position: absolute; inset: 0; background: radial-gradient(70% 30% at 50% 10%, #2e2517 0%, rgba(13,12,11,0) 100%),
          radial-gradient(70% 26% at 50% 100%, #221b12 0%, rgba(13,12,11,0) 100%); }
  .card { position: absolute; left: ${bleed}mm; top: ${bleed}mm; width: ${W}mm; height: ${H}mm; box-sizing: border-box;
          padding: 15mm 13mm 11mm; display: flex; flex-direction: column; align-items: center; text-align: center;
          color: var(--cream); font-family: Jost, sans-serif; }
  .frame { position: absolute; inset: 6mm; border: .45mm solid var(--gold); }
  .frame::after { content: ""; position: absolute; inset: 1.5mm; border: .2mm solid rgba(217,181,108,.55); }
  .corner { position: absolute; width: 9mm; height: 9mm; background: var(--ink); }
  .corner::before { content: ""; position: absolute; inset: 2.4mm; transform: rotate(45deg); border: .45mm solid var(--gold); }
  .c1 { left: 2.3mm; top: 2.3mm } .c2 { right: 2.3mm; top: 2.3mm } .c3 { left: 2.3mm; bottom: 2.3mm } .c4 { right: 2.3mm; bottom: 2.3mm }
  .card > :not(.frame) { position: relative; }
  .te { font-family: "Noto Serif Telugu", serif; font-weight: 500; color: var(--gold-hi); }
  .kicker { font-size: 13pt; }
  .title { font-family: "Cormorant Garamond", serif; font-style: italic; font-weight: 500; font-size: 56pt; line-height: 1; margin-top: 1mm;
           background: linear-gradient(180deg, #f6e6bd 0%, #e3c074 45%, #b88d45 100%); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 3mm 1.5mm; }
  .lead { font-family: "Cormorant Garamond", serif; font-style: italic; font-size: 16pt; color: var(--cream); }
  .photo { width: 100%; margin-top: 6mm; padding: 1.2mm; border: .45mm solid var(--gold); box-sizing: border-box; }
  .photo img { display: block; width: 100%; }
  .team { margin-top: 5mm; font-family: "Cormorant Garamond", serif; font-weight: 600; font-size: 21pt; color: var(--gold-hi); }
  .team-te { font-size: 11.5pt; margin-top: 1mm; }
  .strip { margin-top: 5mm; display: flex; align-items: center; gap: 4mm; font-size: 11pt; letter-spacing: .22em; text-transform: uppercase; color: var(--gold-hi);
           padding: 2.6mm 0; border-top: .25mm solid rgba(217,181,108,.7); border-bottom: .25mm solid rgba(217,181,108,.7); }
  .strip i { width: 1.8mm; height: 1.8mm; transform: rotate(45deg); background: var(--gold); }
  .addr { font-size: 9.5pt; line-height: 1.5; margin-top: 4mm; }
  .foot { margin-top: auto; font-size: 10pt; letter-spacing: .14em; color: var(--muted); }
  .foot b { color: var(--gold); font-weight: 500; }
</style></head><body><section class="sheet"><div class="glow"></div>
<div class="card">
  <div class="frame"><i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i></div>
  <div class="te kicker">ప్రారంభోత్సవ ఆహ్వానం</div>
  <div class="title">Grand Opening</div>
  <div class="lead">You are cordially invited</div>
  <div class="photo"><img src="${photo}" alt="The DermaLuxe team at the reception"></div>
  <div class="team">Our team welcomes you</div>
  <div class="te team-te">మా బృందం మీకు సాదర స్వాగతం పలుకుతోంది</div>
  <div class="strip"><span>Friday</span><i></i><span>6 November 2026</span><i></i><span>10:32 AM</span></div>
  <div class="addr">Rama Mahal, Kasturi Vari Street, R.R. Peta, Opp. Happy Mobiles, Eluru 534002</div>
  <div class="foot"><b>+91 99591 34666</b> &nbsp;·&nbsp; www.dermaluxe.ai</div>
</div></section></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const pg = await browser.newPage();
  const load = async (html) => {
    await pg.setContent(html, { waitUntil: "load", timeout: 90000 });
    await pg.evaluate(async () => { await document.fonts.ready; });
    await pg.evaluate(goldify, ".title");
  };
  await load(page(3));
  await pg.pdf({ path: path.join(__dirname, "team-poster.pdf"), preferCSSPageSize: true, printBackground: true });
  const w = W / 25.4 * 96, h = H / 25.4 * 96, s = 2160 / w;
  await pg.setViewport({ width: Math.round(w), height: Math.ceil(h), deviceScaleFactor: s });
  await load(page(0));
  console.log(JSON.stringify(await pg.evaluate(() => { const c = document.querySelector(".card");
    return { fits: c.scrollHeight <= c.clientHeight + 1 }; })));
  await pg.screenshot({ path: path.join(__dirname, "team-poster.png"), clip: { x: 0, y: 0, width: w, height: 2700 / s } });
  await browser.close();
})();
