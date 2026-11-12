// Opening invitation card, 6 November 2026, printed both sides. Re-run to rebuild:
//   node print/make-invite.js
// invite-opening.pdf  5x7 in card, page 1 front, page 2 back, 3 mm bleed on every side, for the press
// invite-front.png, invite-back.png  the same two sides without bleed, 1500x2100, for WhatsApp
// invite-poster.pdf / .png  everything on one page over building-empty-final.jpg (edit-empty.js
// took the woman out, the real side board pasted back, the garbled standee softened)
// Front: the clinic's own photo, edited by print/invite/edit-building.js (evening light;
// building-v1-fixed.jpg has the side board's real lettering pasted back from
// building-original.jpg), then by edit-face.js, which brings the model from the clinic's
// own pamphlet (pamphlet.jpg) forward in a saree, greeting; -final.jpg softens the garbled
// lettering on the standee behind her. Back: the details and the four hosts.
// Portraits are square head-and-shoulders crops in print/invite/, cut from the
// site photos (assets/founders photos, assets/dr-*.jpg), each face at about the same size.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const goldify = require("./gold-text");
const OUT = __dirname;
const data = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(__dirname, f)).toString("base64");
const logo = data("../assets/logo.png", "image/png");
const building = data("invite/building-face-v2-final.jpg", "image/jpeg");
const empty = data("invite/building-empty-final.jpg", "image/jpeg");
const img = (f) => data("invite/" + f, "image/jpeg");
const HOSTS = [
  ["nagaraju.jpg", "Nagaraju<br>Bandaru", "MBA", "Founder &amp; Managing Director"],
  ["meghana.jpg", "Dr. Meghana<br>Valeti", "MD (DVL)", "Co-Founder &amp; Medical Director"],
  ["nikhitha.jpg", "Dr. Nikhitha<br>Priyanka", "MD (DVL)", "Chief Dermatologist, DermaLuxe"],
  ["saidivija.jpg", "Dr. Kamma<br>Sai Divija", "MD (DVL)", "Chief Dermatologist, Medicare Skin &amp; Hair Clinic"],
];

const W = 127, H = 178;
const frame = `<div class="frame"><i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i></div>`;

const front = () => `<section class="sheet front">
  <div class="photo"></div><div class="shade"></div>
  <div class="card">${frame}
    <div class="te kicker">ప్రారంభోత్సవ ఆహ్వానం</div>
    <div class="title">Grand Opening</div>
    <div class="lead">You are cordially invited</div>
    <div class="strip"><span>Friday</span><i></i><span>6 November 2026</span><i></i><span>10:32 AM</span></div>
  </div></section>`;

const back = () => `<section class="sheet back">
  <div class="glow"></div>
  <div class="card">${frame}
  <img class="logo" src="${logo}" alt="DermaLuxe by Medicare">
  <div class="te kicker">ప్రారంభోత్సవ ఆహ్వానం</div>
  <div class="title">Grand Opening</div>
  <div class="lead">We request the honour of your presence and blessings</div>
  <div class="when"><div class="side">Friday</div><div class="mid"><div class="d">06</div><div class="m">Nov 2026</div></div><div class="side">10:32 AM</div></div>
  <div class="te when-te">శుక్రవారం, 6 నవంబర్ 2026 · ఉదయం 10:32 గంటలకు</div>
  <div class="venue"><div class="lbl">Venue</div>
    <div class="addr">Rama Mahal, Door No. 3-12, Ground Floor, Kasturi Vari Street, R.R. Peta,<br>Opp. Happy Mobiles, Near Lakshmi Ganapathi Temple, Eluru 534002</div></div>
  <div class="hosts"><div class="lbl">Invited by</div>
    <div class="grid">${HOSTS.map(([f, n, q, r]) => `<div class="h"><div class="ph"><img src="${img(f)}" alt=""></div><div class="n">${n}</div><div class="q">${q}</div><div class="r">${r}</div></div>`).join("")}</div></div>
  <div class="foot"><b>+91 99591 34666</b> &nbsp;·&nbsp; www.dermaluxe.ai</div>
  </div></section>`;

// One page with everything, for WhatsApp and a wall: the empty building behind, the
// words above the sign, the venue and hosts below it on a dark band.
const poster = () => `<section class="sheet poster">
  <div class="pphoto"></div><div class="pshade"></div>
  <div class="card">${frame}
  <img class="logo" src="${logo}" alt="DermaLuxe by Medicare">
  <div class="te kicker">ప్రారంభోత్సవ ఆహ్వానం</div>
  <div class="title">Grand Opening</div>
  <div class="lead">We request the honour of your presence and blessings</div>
  <div class="strip"><span>Friday</span><i></i><span>6 November 2026</span><i></i><span>10:32 AM</span></div>
  <div class="te when-te">శుక్రవారం, 6 నవంబర్ 2026 · ఉదయం 10:32 గంటలకు</div>
  <div class="gap"></div>
  <div class="venue"><div class="lbl">Venue</div>
    <div class="addr">Rama Mahal, Door No. 3-12, Ground Floor, Kasturi Vari Street, R.R. Peta,<br>Opp. Happy Mobiles, Near Lakshmi Ganapathi Temple, Eluru 534002</div></div>
  <div class="hosts"><div class="lbl">Invited by</div>
    <div class="grid">${HOSTS.map(([f, n, q, r]) => `<div class="h"><div class="ph"><img src="${img(f)}" alt=""></div><div class="n">${n}</div><div class="q">${q}</div><div class="r">${r}</div></div>`).join("")}</div></div>
  <div class="foot"><b>+91 99591 34666</b> &nbsp;·&nbsp; www.dermaluxe.ai</div>
  </div></section>`;

const page = (bleed, sides) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Jost:wght@400;500&family=Noto+Serif+Telugu:wght@500&display=block" rel="stylesheet">
<style>
  @page { size: ${W + 2 * bleed}mm ${H + 2 * bleed}mm; margin: 0 }
  :root { --ink: #0d0c0b; --gold: #d9b56c; --gold-hi: #f3dfae; --cream: #f4ece0; --muted: #b9ab95; }
  html, body { margin: 0; background: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { position: relative; width: ${W + 2 * bleed}mm; height: ${H + 2 * bleed}mm; overflow: hidden; background: var(--ink); break-after: page; }
  .sheet:last-child { break-after: auto; }
  .card { position: absolute; left: ${bleed}mm; top: ${bleed}mm; width: ${W}mm; height: ${H}mm; box-sizing: border-box;
          padding: 10mm 11mm 8mm; display: flex; flex-direction: column; align-items: center; text-align: center; color: var(--cream);
          font-family: Jost, sans-serif; }
  .glow { position: absolute; inset: 0; background: radial-gradient(70% 38% at 50% 14%, #2b2316 0%, rgba(13,12,11,0) 100%),
          radial-gradient(60% 30% at 50% 100%, #1f1a12 0%, rgba(13,12,11,0) 100%); }
  .frame { position: absolute; inset: 4.5mm; border: .35mm solid var(--gold); }
  .frame::after { content: ""; position: absolute; inset: 1.1mm; border: .15mm solid rgba(217,181,108,.55); }
  .corner { position: absolute; width: 7mm; height: 7mm; }
  .back .corner { background: var(--ink); }
  .corner::before { content: ""; position: absolute; inset: 1.9mm; transform: rotate(45deg); border: .35mm solid var(--gold); }
  .front .corner::before { background: var(--ink); }
  .c1 { left: 1.8mm; top: 1.8mm } .c2 { right: 1.8mm; top: 1.8mm } .c3 { left: 1.8mm; bottom: 1.8mm } .c4 { right: 1.8mm; bottom: 1.8mm }
  .card > :not(.frame) { position: relative; }
  .te { font-family: "Noto Serif Telugu", serif; font-weight: 500; color: var(--gold-hi); }
  .title { font-family: "Cormorant Garamond", serif; font-style: italic; font-weight: 500; line-height: 1;
           background: linear-gradient(180deg, #f6e6bd 0%, #e3c074 45%, #b88d45 100%); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 2mm 1mm; }
  .lead { font-family: "Cormorant Garamond", serif; color: var(--cream); }

  /* front: the photo fills the card, dark at the top where the words sit */
  .photo { position: absolute; inset: 0; background: url("${building}") 50% 0% / cover no-repeat; }
  .shade { position: absolute; inset: 0; background:
           linear-gradient(180deg, rgba(10,9,8,.93) 0%, rgba(10,9,8,.8) 22%, rgba(10,9,8,0) 34%),
           linear-gradient(0deg, rgba(10,9,8,.55) 0%, rgba(10,9,8,0) 10%); }
  .front .kicker { font-size: 11pt; margin-top: 0; }
  .front .title { font-size: 42pt; margin-top: 1mm; }
  .front .lead { font-size: 13pt; font-style: italic; letter-spacing: .02em; }
  .strip { margin-top: 3mm; display: flex; align-items: center; gap: 3mm; font-size: 8pt; letter-spacing: .24em; text-transform: uppercase; color: var(--gold-hi); }
  .strip i { width: 1.4mm; height: 1.4mm; transform: rotate(45deg); background: var(--gold); }

  /* back */
  .logo { width: 48mm; display: block; }
  .back .kicker { font-size: 10.5pt; margin-top: 3.5mm; letter-spacing: .02em; }
  .back .title { font-size: 33pt; margin-top: 1mm; }
  .back .lead { font-size: 12.5pt; line-height: 1.3; margin-top: 1mm; }
  .when { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; width: 92mm; margin-top: 5mm; }
  .when .side { font-size: 8pt; letter-spacing: .28em; text-transform: uppercase; color: var(--gold); padding: 2.2mm 0;
                border-top: .2mm solid rgba(217,181,108,.7); border-bottom: .2mm solid rgba(217,181,108,.7); }
  .when .mid { padding: 0 5mm; font-family: "Cormorant Garamond", serif; line-height: .95; font-variant-numeric: lining-nums; }
  .when .d { font-size: 29pt; font-weight: 600; color: var(--gold-hi); }
  .when .m { font-family: Jost, sans-serif; font-size: 8pt; letter-spacing: .3em; text-transform: uppercase; color: var(--cream); margin-top: 1mm; }
  .when-te { font-size: 8.5pt; margin-top: 2.5mm; }
  .lbl { font-size: 6.5pt; letter-spacing: .32em; text-transform: uppercase; color: var(--gold); }
  .venue { margin-top: 4mm; }
  .addr { font-size: 7.6pt; line-height: 1.5; color: var(--cream); margin-top: 1.2mm; }
  .hosts { margin-top: 5.5mm; width: 100%; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 2mm; margin-top: 2.6mm; }
  .h .ph { width: 22mm; height: 22mm; margin: 0 auto 2mm; border-radius: 50%; padding: .7mm; border: .35mm solid var(--gold); box-sizing: border-box; }
  .h .ph img { width: 100%; height: 100%; border-radius: 50%; display: block; object-fit: cover; }
  .h .n { font-family: "Cormorant Garamond", serif; font-weight: 600; font-size: 10.5pt; line-height: 1.1; color: var(--gold-hi); }
  .h .q { font-size: 6.3pt; letter-spacing: .1em; color: var(--cream); margin-top: .7mm; }
  .h .r { font-size: 5.8pt; line-height: 1.35; color: var(--muted); margin-top: .4mm; }
  .foot { margin-top: auto; padding-top: 2.5mm; font-size: 7pt; letter-spacing: .14em; color: var(--muted); }
  .foot b { color: var(--gold); font-weight: 500; }

  /* poster: the sign shows through between the two dark bands */
  .pphoto { position: absolute; inset: 0; background: url("${empty}") 50% 100% / cover no-repeat; }
  .pshade { position: absolute; inset: 0; background:
            linear-gradient(180deg, rgba(10,9,8,.94) 0%, rgba(10,9,8,.86) 30%, rgba(10,9,8,0) 41%),
            linear-gradient(0deg, rgba(10,9,8,.95) 0%, rgba(10,9,8,.9) 37%, rgba(10,9,8,.6) 44%, rgba(10,9,8,0) 51%); }
  .poster .corner::before { background: var(--ink); }
  .poster .logo { width: 34mm; }
  .poster .kicker { font-size: 9.5pt; margin-top: 2mm; }
  .poster .title { font-size: 34pt; margin-top: .5mm; }
  .poster .lead { font-size: 11.5pt; font-style: italic; }
  .poster .strip { margin-top: 3mm; font-size: 7.5pt; }
  .poster .when-te { font-size: 8pt; margin-top: 1.5mm; }
  .poster .gap { flex: 1; }
  .poster .venue { margin-top: 0; }
  .poster .addr { font-size: 7.2pt; }
  .poster .hosts { margin-top: 4mm; }
  .poster .h .ph { width: 19mm; height: 19mm; margin-bottom: 1.6mm; }
  .poster .h .n { font-size: 9.8pt; }
  .poster .foot { margin-top: 0; padding-top: 3mm; }
</style></head><body>${sides.map((s) => s()).join("")}</body></html>`;

(async () => {
  const exe = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await puppeteer.launch({ executablePath: exe, headless: "new" });
  const pg = await browser.newPage();
  const load = async (html) => {
    await pg.setContent(html, { waitUntil: "load", timeout: 90000 });
    await pg.evaluate(async () => { await document.fonts.ready; });
    await pg.evaluate(goldify, ".title");
  };
  await load(page(3, [front, back]));
  await pg.pdf({ path: path.join(OUT, "invite-opening.pdf"), preferCSSPageSize: true, printBackground: true });
  await load(page(3, [poster]));
  await pg.pdf({ path: path.join(OUT, "invite-poster.pdf"), preferCSSPageSize: true, printBackground: true });
  // 127mm at 96 css px/in = 480px wide; scale to 1500px
  const w = W / 25.4 * 96, h = 2100 / (1500 / w);
  await pg.setViewport({ width: Math.round(w), height: Math.ceil(h), deviceScaleFactor: 1500 / w });
  for (const [name, side] of [["front", front], ["back", back], ["poster", poster]]) {
    await load(page(0, [side]));
    await pg.screenshot({ path: path.join(OUT, `invite-${name}.png`), clip: { x: 0, y: 0, width: w, height: h } });
    console.log(name, JSON.stringify(await pg.evaluate(() => { const c = document.querySelector(".card");
      return { fits: c.scrollHeight <= c.clientHeight + 1 }; })));
  }
  await browser.close();
})();
