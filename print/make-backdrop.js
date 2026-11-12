// Stage backdrop for the opening, 6 November 2026: 10 x 8 ft flex behind the stage. Re-run:
//   node print/make-backdrop.js
// stage-backdrop.pdf  120 x 96 in, 10 mm bleed on every side, for the flex printer
// stage-backdrop.jpg  the same without bleed, 8640 x 6912 (72 dpi at full size, what flex presses print at)
// Same black-and-gold as make-invite.js. People stand in front of the lower half, so the logo,
// the title and the date sit in the top 60%; the hosts and the address sit low, where photos crop them least.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const goldify = require("./gold-text");
const data = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(__dirname, f)).toString("base64");
const logo = data("../assets/logo.png", "image/png");
const HOSTS = [
  ["Nagaraju<br>Bandaru", "MBA", "Founder &amp; Managing Director"],
  ["Dr. Meghana<br>Valeti", "MD (DVL)", "Co-Founder &amp; Medical Director"],
  ["Dr. Nikhitha<br>Priyanka", "MD (DVL)", "Chief Dermatologist, DermaLuxe"],
  ["Dr. Kamma<br>Sai Divija", "MD (DVL)", "Chief Dermatologist, Medicare Skin &amp; Hair Clinic"],
];
const W = 3048, H = 2438.4;

// thin gold rings radiating from behind the title, the logo's own arc carried across the whole wall
const rings = `<svg class="rings" viewBox="0 0 3048 2438" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="fade" cx="50%" cy="34%" r="70%"><stop offset="0" stop-color="#d9b56c" stop-opacity=".55"/><stop offset="1" stop-color="#d9b56c" stop-opacity="0"/></radialGradient></defs>
  ${[620, 820, 1040, 1280, 1540, 1820].map((r, i) => `<circle cx="1524" cy="830" r="${r}" fill="none" stroke="url(#fade)" stroke-width="${i % 2 ? 2.5 : 5}"/>`).join("")}
</svg>`;

const page = (bleed) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Jost:wght@400;500&family=Noto+Serif+Telugu:wght@600&display=block" rel="stylesheet">
<style>
  @page { size: ${W + 2 * bleed}mm ${H + 2 * bleed}mm; margin: 0 }
  :root { --ink: #0d0c0b; --gold: #d9b56c; --gold-hi: #f3dfae; --cream: #f4ece0; --muted: #b9ab95; }
  html, body { margin: 0; background: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { position: relative; width: ${W + 2 * bleed}mm; height: ${H + 2 * bleed}mm; overflow: hidden; background: var(--ink); }
  .glow { position: absolute; inset: 0; background: radial-gradient(48% 42% at 50% 34%, #3a2e1b 0%, rgba(13,12,11,0) 100%),
          radial-gradient(60% 30% at 50% 100%, #241c12 0%, rgba(13,12,11,0) 100%); }
  .rings { position: absolute; left: ${bleed}mm; top: ${bleed}mm; width: ${W}mm; height: ${H}mm; }
  .wall { position: absolute; left: ${bleed}mm; top: ${bleed}mm; width: ${W}mm; height: ${H}mm; box-sizing: border-box;
          padding: 170mm 200mm 150mm; display: flex; flex-direction: column; align-items: center; text-align: center;
          color: var(--cream); font-family: Jost, sans-serif; }
  .frame { position: absolute; inset: 60mm; border: 7mm solid var(--gold); }
  .frame::after { content: ""; position: absolute; inset: 22mm; border: 2.5mm solid rgba(217,181,108,.55); }
  .corner { position: absolute; width: 120mm; height: 120mm; background: var(--ink); }
  .corner::before { content: ""; position: absolute; inset: 32mm; transform: rotate(45deg); border: 7mm solid var(--gold); }
  .c1 { left: 13mm; top: 13mm } .c2 { right: 13mm; top: 13mm } .c3 { left: 13mm; bottom: 13mm } .c4 { right: 13mm; bottom: 13mm }
  .wall > :not(.frame) { position: relative; }
  .logo { width: 1000mm; display: block; }
  .te { font-family: "Noto Serif Telugu", serif; font-weight: 600; color: var(--gold-hi); font-size: 140mm; line-height: 1.3; margin-top: 30mm; }
  .title { font-family: "Cormorant Garamond", serif; font-style: italic; font-weight: 500; font-size: 400mm; line-height: .95; margin-top: -10mm;
           background: linear-gradient(180deg, #f6e6bd 0%, #e3c074 45%, #b88d45 100%); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 30mm 25mm; }
  .strip { margin-top: 10mm; display: flex; align-items: center; gap: 45mm; font-size: 92mm; letter-spacing: .2em; text-transform: uppercase; color: var(--gold-hi); }
  .strip i { width: 22mm; height: 22mm; transform: rotate(45deg); background: var(--gold); }
  .lbl { margin-top: auto; font-size: 50mm; letter-spacing: .4em; text-transform: uppercase; color: var(--gold); }
  .hosts { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 50mm; width: 100%; margin-top: 30mm; }
  .h { border-top: 2mm solid rgba(217,181,108,.5); padding-top: 22mm; }
  .h .n { font-family: "Cormorant Garamond", serif; font-weight: 600; font-size: 92mm; line-height: 1.08; color: var(--gold-hi); }
  .h .q { font-size: 46mm; letter-spacing: .12em; margin-top: 10mm; }
  .h .r { font-size: 38mm; line-height: 1.35; color: var(--muted); margin-top: 6mm; }
  .foot { margin-top: 60mm; font-size: 52mm; letter-spacing: .12em; color: var(--muted); }
  .foot b { color: var(--gold); font-weight: 500; }
</style></head><body><section class="sheet"><div class="glow"></div>${rings}
<div class="wall">
  <div class="frame"><i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i></div>
  <img class="logo" src="${logo}" alt="DermaLuxe by Medicare">
  <div class="te">ప్రారంభోత్సవ వేడుక</div>
  <div class="title">Grand Opening</div>
  <div class="strip"><span>Friday</span><i></i><span>6 November 2026</span><i></i><span>10:32 AM</span></div>
  <div class="lbl">Hosted by</div>
  <div class="hosts">${HOSTS.map(([n, q, r]) => `<div class="h"><div class="n">${n}</div><div class="q">${q}</div><div class="r">${r}</div></div>`).join("")}</div>
  <div class="foot">Rama Mahal, R.R. Peta, Eluru &nbsp;·&nbsp; <b>+91 99591 34666</b> &nbsp;·&nbsp; www.dermaluxe.ai</div>
</div></section></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const pg = await browser.newPage();
  const load = async (html) => {
    await pg.setContent(html, { waitUntil: "load", timeout: 90000 });
    await pg.evaluate(async () => { await document.fonts.ready; });
    await pg.evaluate(goldify, ".title");
  };
  await load(page(10));
  await pg.pdf({ path: path.join(__dirname, "stage-backdrop.pdf"), preferCSSPageSize: true, printBackground: true });
  console.log(JSON.stringify(await pg.evaluate(() => { const b = document.querySelector(".wall");
    return { fits: b.scrollHeight <= b.clientHeight + 1 }; })));
  // Chrome will not screenshot a page this size in one piece (it paints the top third and stops),
  // so the JPG comes from a bleed-free PDF: sips rasterises a PDF at 72 dpi, 8640 x 6912 here.
  await load(page(0));
  const tmp = path.join(require("os").tmpdir(), "stage-backdrop-nobleed.pdf");
  await pg.pdf({ path: tmp, preferCSSPageSize: true, printBackground: true });
  await browser.close();
  require("child_process").execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", tmp, "--out", path.join(__dirname, "stage-backdrop.jpg")], { stdio: "ignore" });
})();
