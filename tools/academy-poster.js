#!/usr/bin/env node
// Rebuild the Batch 1 academy poster and story.
//
// The first one was made once and only the JPGs were kept, with "30 September
// varaku" baked into the pixels. When the owner moved the launch offer to 15
// October, every other place in the app followed BATCH.offerEnd and the poster
// — the thing actually being shown to people, and paid to show — could not.
//
// So it is built from the same numbers as everything else now. Change the date
// in api/_docs.js and run this; the poster agrees again.
//
//   node tools/academy-poster.js            → writes both JPGs
//   node tools/academy-poster.js --out /tmp → writes them somewhere else first
//
// The photograph is assets/academy/batch1-photo.jpg, the top band of the
// original, kept as its own file on purpose: generating from the previous
// output would re-compress the same picture a little more every time.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const docs = require(path.join(ROOT, "api", "_docs.js"));
const B = docs.BATCH;

const b64 = (p) => fs.readFileSync(path.join(ROOT, p)).toString("base64");
const PHOTO = `data:image/jpeg;base64,${b64("assets/academy/batch1-photo.jpg")}`;
// The story is not the post with more sky: its own crop shows the whole group
// standing, which is why it gets its own band rather than a stretched one.
const PHOTO_STORY = `data:image/jpeg;base64,${b64("assets/academy/batch1-photo-story.jpg")}`;
const TRAINER = `data:image/webp;base64,${b64("assets/academy/trainer-meghana.webp")}`;

const PHOTO_H = 542;          // where the post's photograph stops
const PHOTO_H_STORY = 788;    // and the story's, which runs much further down
const money = (n) => "₹" + Number(n).toLocaleString("en-IN");

// Every number on the poster, from the one place they live.
const FEE = 49999, REGULAR = 100000, HOLD = 9999;

function html(H, story) {
  const photoH = story ? PHOTO_H_STORY : PHOTO_H;
  const img = story ? PHOTO_STORY : PHOTO;
  // Down the page a story has room to give each point its own line; the square
  // post does not, so there it is two columns.
  const bullets = [
    "PICO · Diode laser · MNRF · HIFU · Hydrafacial",
    "Peels, PRP/GFC, acne &amp; pigmentation protocols",
    "Certificate + placement interviews",
    story ? "Beautician · salon/spa · nursing · freshers — andaru join avvachu"
          : "Beautician · salon/spa · nursing · freshers",
  ].map((t) => `<div><i>◆</i><span>${t}</span></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Jost:wght@300;400;500;600&family=Noto+Sans+Telugu:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{--gold:#e6c98a;--ink:#f7f2e8;--mute:#d2cbbd;--bg:#0a0a0c;--box:#17140f}
*{box-sizing:border-box;margin:0}
html,body{width:1080px;height:${H}px;overflow:hidden;background:var(--bg)}
body{color:var(--ink);font-family:Jost,sans-serif;position:relative}
.photo{position:absolute;left:0;right:0;top:0;height:${photoH}px;
  background:#0a0a0c url("${img}") no-repeat top center;background-size:1080px auto}
/* the crop does not end on black, so the join is faded rather than butted */
.fade{position:absolute;left:0;right:0;top:${photoH - 150}px;height:170px;
  background:linear-gradient(180deg,rgba(10,10,12,0) 0%,rgba(10,10,12,.72) 55%,var(--bg) 100%)}
.frame{position:absolute;inset:28px;border:1px solid rgba(230,201,138,.30);pointer-events:none}
.body{position:absolute;left:55px;right:55px;top:${photoH + 8}px}
h1{font-family:"Noto Sans Telugu",sans-serif;font-weight:600;font-size:53px;line-height:1.26;letter-spacing:-.5px}
h1 .g{color:var(--gold)}
.lede{font-family:"Cormorant Garamond",serif;font-weight:600;font-size:${story ? 35 : 37}px;color:var(--gold);margin-top:11px;white-space:${story ? "normal" : "nowrap"};letter-spacing:.2px}
.p{font-weight:300;font-size:24px;line-height:1.48;color:var(--mute);margin-top:11px}
.p b{font-weight:600;color:var(--ink)}
.bul{display:grid;grid-template-columns:${story ? "1fr" : "1fr 1fr"};gap:10px 22px;margin-top:18px}
.bul div{font-weight:300;font-size:${story ? 25 : 22}px;white-space:nowrap;color:var(--ink);display:flex;gap:13px;align-items:flex-start;line-height:1.3}
.bul i{color:var(--gold);font-style:normal;font-size:18px;line-height:1.5}
.offer{margin-top:19px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:0 28px;
  background:linear-gradient(180deg,#1b1812 0%,#141109 100%);border:1px solid rgba(230,201,138,.34);border-radius:15px;padding:18px 26px}
.fee{font-family:"Cormorant Garamond",serif;font-weight:700;font-size:55px;color:var(--gold);line-height:1;letter-spacing:-1px}
.was{font-family:"Cormorant Garamond",serif;font-size:26px;color:#8b8378;text-decoration:line-through;margin-top:4px}
.lines{font-size:23px;line-height:1.5;white-space:nowrap;color:var(--mute);font-weight:300;border-left:1px solid rgba(230,201,138,.20);padding-left:0}
.lines b{color:var(--gold);font-weight:600}
.seats{text-align:center;padding-left:32px;border-left:1px solid rgba(230,201,138,.22)}
.seats .n{font-family:"Cormorant Garamond",serif;font-weight:600;font-size:46px;color:var(--ink);line-height:1}
.seats .l{font-size:18px;letter-spacing:2.4px;white-space:nowrap;color:var(--gold);margin-top:6px}
.dr{display:flex;gap:20px;align-items:flex-start;margin-top:16px;padding-top:15px;border-top:1px solid rgba(230,201,138,.16)}
.dr img{width:72px;height:72px;border-radius:50%;object-fit:cover;border:1px solid rgba(230,201,138,.45);flex:0 0 auto}
.dr .n{font-family:"Cormorant Garamond",serif;font-weight:600;font-size:29px;color:var(--gold)}
.dr .n span{color:var(--mute);font-family:Jost,sans-serif;font-size:22px;font-weight:300}
.dr .t{font-weight:300;font-size:21px;line-height:1.38;color:var(--mute);margin-top:4px}
.foot{position:absolute;left:55px;right:55px;bottom:46px;display:flex;gap:30px;align-items:center}
.wa{flex:0 0 auto;background:linear-gradient(180deg,#f0d9a6,#cdaa68);color:#181206;font-weight:500;font-size:30px;
  padding:19px 34px;border-radius:999px;white-space:nowrap}
.fnote{font-weight:300;font-size:22px;line-height:1.45;color:var(--mute)}
.fnote b{color:var(--ink);font-weight:600}
.fnote .u{color:var(--gold)}
</style></head><body>
<div class="photo"></div><div class="fade"></div><div class="frame"></div>
<div class="body">
  <h1>బ్యూటీ థెరపిస్ట్ లేదా<br><span class="g">కాస్మెటాలజిస్ట్</span> కావాలనుకుంటున్నారా?</h1>
  <p class="lede">Learn it where it is actually done — in a running skin &amp; hair clinic.</p>
  <p class="p">Parlour course kaadu. <b>MD dermatologist</b> daggara, nijamaina patients meeda, nijamaina machines meeda — chethulatho nerchukuntaru.</p>
  <div class="bul">${bullets}</div>
  <div class="offer">
    <div><div class="fee">${money(FEE)}</div><div class="was">${money(REGULAR)}</div></div>
    <div class="lines">Launch offer — <b>${B.offerEndLong} varaku</b><br>Batch ${B.no} modalu: <b>${B.start}</b><br>${money(HOLD)} tho seat book cheskovachu</div>
    <div class="seats"><div class="n">${B.seats}</div><div class="l">SEATS ONLY</div></div>
  </div>
  <div class="dr"><img src="${TRAINER}">
    <div><div class="n">Dr. Meghana Valeti <span>— MD, DVL · Dermatologist &amp; Cosmetologist</span></div>
    <div class="t">Meeru nerchukunedi aame daggara ne. 1 nela course, leda 2 nelalu — internship + placement interviews tho.</div></div>
  </div>
</div>
<div class="foot">
  <div class="wa">WhatsApp: 99591 34666</div>
  <div class="fnote"><b>"ACADEMY"</b> ani pampandi — ${story ? "details ventane vastayi." : "course details, fees, batch plan ventane vastayi."}<br><span class="u">dermaluxe.ai/academy</span> · ${story ? "Eluru" : "DermaLuxe by Medicare, Eluru"}</div>
</div>
</body></html>`;
}

async function render(markup, H) {
  const pmod = await import("puppeteer-core");
  const puppeteer = pmod.default || pmod;
  const browser = await puppeteer.launch({
    defaultViewport: { width: 1080, height: H, deviceScaleFactor: 1 },
    executablePath: process.env.LOCAL_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(markup, { waitUntil: "networkidle0", timeout: 30000 });
    try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
    return await page.screenshot({ type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: 1080, height: H } });
  } finally { await browser.close(); }
}

(async () => {
  const outDir = (process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(ROOT, "assets", "academy"));
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, H, story] of [["batch1-poster.jpg", 1350, false], ["batch1-story.jpg", 1920, true]]) {
    const buf = await render(html(H, story), H);
    fs.writeFileSync(path.join(outDir, name), buf);
    console.log(`✓ ${path.join(outDir, name)}  ${buf.length} bytes  ·  offer till ${B.offerEndLong}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
