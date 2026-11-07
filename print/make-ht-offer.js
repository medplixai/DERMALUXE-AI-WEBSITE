// Hair transplant package poster, owner's decision of 7 Nov 2026. Re-run:
//   node print/make-ht-offer.js
// ht-offer-feed.png    2160 x 2700 (4:5)  Instagram feed, WhatsApp
// ht-offer-status.png  2160 x 3840 (9:16) WhatsApp Status, Instagram story
//
// The owner's own artwork said "Hair transplant FREE — only medical expenses
// ₹59,999". Told that a free procedure is the inducement NMC 10.1(iv) grades
// SERIOUS, and that "free" beside a ₹59,999 charge reads as misleading, they
// chose "₹59,999 all-inclusive" and kept the before/after photograph, the
// "permanent" line, the free hair transplant consultation and both numbers.
// The photograph is the stock picture already on the site, not a patient of
// this clinic, and the poster says so in small type. The doctors' names and
// registration numbers go on the credit line (3.2 Explanations III/IV).
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const ROOT = path.join(__dirname, "..");
const data = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(ROOT, f)).toString("base64");
const logo = data("assets/logo.png", "image/png");
const photo = data("assets/ht-before-after.jpg", "image/jpeg");
const docs = require(path.join(ROOT, "api", "_docs.js"));
const credit = docs.DOCTORS ? Object.values(docs.DOCTORS).map((d) => `${d.name}, ${d.qual || "MD (DVL)"} · ${d.reg}`).join("  ·  ") : "";

const page = (W, H, tall) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=Jost:wght@400;500;600;700&family=Noto+Sans+Telugu:wght@500;700&display=block" rel="stylesheet">
<style>
  :root { --cream:#fbf6ec; --cream2:#f3e8d3; --gold:#b8893d; --gold-hi:#e9c983; --brown:#4a2a12; --maroon:#8e1b1b; --ink:#2b1a0e; }
  html,body { margin:0; }
  .sheet { width:${W}px; height:${H}px; overflow:hidden; position:relative; box-sizing:border-box;
    background: radial-gradient(80% 40% at 80% 0%, #fff 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg, var(--cream) 0%, var(--cream2) 100%);
    color:var(--ink); font-family:Jost, sans-serif; padding:${tall ? 70 : 46}px 54px ${tall ? 60 : 40}px; display:flex; flex-direction:column; align-items:center; ${tall ? "justify-content:space-between;" : ""} }
  ${tall ? ".sheet > * { margin-top:0 !important; } .credit { margin-top:0 !important; }" : ""}
  .frame { position:absolute; inset:18px; border:2px solid var(--gold); border-radius:26px; pointer-events:none; }
  .logo { height:${tall ? 96 : 70}px; display:block; }
  .logobox { background:linear-gradient(180deg,#2a180b,#1a0f07); border-radius:18px; padding:10px 26px; border:2px solid var(--gold); }
  .kicker { font-size:15px; letter-spacing:.28em; text-transform:uppercase; color:var(--gold); margin-top:6px; font-weight:600; }
  .title { font-family:Jost; font-weight:700; color:var(--brown); text-align:center; line-height:.95; margin-top:${tall ? 30 : 16}px; }
  .title .a { font-size:${tall ? 110 : 76}px; letter-spacing:.02em; display:block; }
  .title .b { font-size:${tall ? 68 : 48}px; letter-spacing:.04em; display:block; }
  .tag { margin-top:12px; font-family:"Cormorant Garamond"; font-style:italic; font-weight:600; font-size:${tall ? 40 : 32}px; color:var(--brown); }
  .mid { display:flex; gap:22px; align-items:stretch; width:100%; box-sizing:border-box; margin-top:${tall ? 50 : 18}px; }
  .photo { flex:0 0 42%; border:3px solid var(--gold); border-radius:20px; overflow:hidden; position:relative; background:#fff; box-sizing:border-box; }
  .photo img { height:100%; object-fit:cover; }
  .photo img { width:100%; display:block; }
  .photo .lb { position:absolute; top:12px; padding:5px 14px; border-radius:100px; background:var(--brown); color:#fff; font-size:15px; font-weight:600; letter-spacing:.08em; }
  .photo .l { left:12px } .photo .r { right:12px }
  .photo .note { position:absolute; bottom:0; left:0; right:0; background:rgba(43,26,14,.72); color:#fff; font-size:12px; padding:5px 10px; text-align:center; }
  .offer { flex:1 1 0; min-width:0; box-sizing:border-box; border:3px solid var(--gold); border-radius:24px; background:#fffdf8; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:20px 14px; text-align:center; }
  .ribbon { background:linear-gradient(180deg,#a3262a,#7c1414); color:#fbe7b0; font-weight:700; font-size:${tall ? 30 : 24}px; letter-spacing:.04em; padding:10px 26px; border-radius:14px; }
  .pkg { margin-top:14px; font-weight:700; font-size:${tall ? 30 : 24}px; color:var(--brown); letter-spacing:.03em; }
  .amt { font-family:Jost; font-weight:700; font-size:${tall ? 116 : 96}px; line-height:1; color:var(--maroon); margin-top:6px; }
  .inc { font-size:${tall ? 23 : 19}px; font-weight:600; color:var(--brown); }
  .inc-te { font-family:"Noto Sans Telugu"; font-size:${tall ? 24 : 19}px; color:var(--brown); margin-top:2px; }
  .dates { margin-top:12px; border:2px solid var(--maroon); color:var(--maroon); border-radius:12px; padding:7px 14px; font-weight:700; font-size:${tall ? 23 : 19}px; }
  .free { margin-top:12px; font-weight:600; font-size:${tall ? 24 : 19}px; color:var(--brown); }
  .tc { font-size:12px; color:#7a6650; margin-top:8px; }
  .benefits { display:grid; grid-template-columns:1fr 1fr; gap:6px 22px; width:100%; margin-top:${tall ? 50 : 16}px; }
  .benefits div { font-family:"Noto Sans Telugu"; font-weight:700; font-size:${tall ? 30 : 23}px; color:var(--brown); display:flex; align-items:center; gap:10px; }
  .benefits div::before { content:"✦"; color:var(--gold); font-size:.8em; }
  .feat { display:flex; width:100%; box-sizing:border-box; margin-top:${tall ? 44 : 16}px; border:2px solid var(--gold); border-radius:18px; background:#fffdf8; }
  .feat div { flex:1; text-align:center; font-weight:600; font-size:${tall ? 20 : 16}px; line-height:1.25; color:var(--brown); padding:10px 6px; border-right:1px solid rgba(184,137,61,.5); }
  .feat div:last-child { border-right:0; }
  .clinic { font-family:"Noto Sans Telugu"; font-weight:700; font-size:${tall ? 36 : 27}px; color:var(--brown); margin-top:${tall ? 50 : 14}px; }
  .addr { font-family:"Noto Sans Telugu"; font-size:${tall ? 22 : 18}px; color:#5b4128; margin-top:4px; }
  .cta { margin-top:${tall ? 36 : 12}px; background:linear-gradient(180deg,#5a3418,#3d220f); color:#fbe7b0; border-radius:100px; padding:12px 30px; font-weight:700; font-size:${tall ? 24 : 19}px; letter-spacing:.04em; }
  .phones { display:flex; gap:18px; margin-top:${tall ? 26 : 10}px; }
  .ph { background:linear-gradient(180deg,#5a3418,#3d220f); color:#fff; border-radius:100px; padding:8px 26px; font-weight:700; font-size:${tall ? 40 : 30}px; display:flex; align-items:center; gap:12px; }
  .ph small { font-size:.45em; font-weight:500; color:#f1d9a6; letter-spacing:.06em; }
  .credit { margin-top:auto; font-size:12.5px; color:#6b5640; text-align:center; line-height:1.4; padding-top:10px; }
</style></head><body><div class="sheet">
  <div class="frame"></div>
  <div class="logobox"><img class="logo" src="${logo}" alt=""></div>
  <div class="kicker">Premium Skin &amp; Hair Clinic · Eluru</div>
  <div class="title"><span class="a">HAIR</span><span class="b">TRANSPLANTATION</span></div>
  <div class="tag">Get your hair back… regain your confidence!</div>
  <div class="mid">
    <div class="photo"><img src="${photo}" alt=""><span class="lb l">BEFORE</span><span class="lb r">AFTER</span><div class="note">Stock photo — not a patient of this clinic. Results differ.</div></div>
    <div class="offer">
      <div class="ribbon">GRAND OPENING PACKAGE</div>
      <div class="pkg">FUE HAIR TRANSPLANT</div>
      <div class="amt">₹59,999</div>
      <div class="inc">All-inclusive — surgery + medical expenses</div>
      <div class="inc-te">సర్జరీ, మెడికల్ ఖర్చులు అన్నీ కలిపి</div>
      <div class="dates">6 NOVEMBER – 6 DECEMBER 2026</div>
      <div class="free">Hair transplant consultation FREE</div>
      <div class="tc">T&amp;C apply · graft count &amp; suitability decided by the surgeon</div>
    </div>
  </div>
  <div class="benefits"><div>సహజమైన జుట్టు పెరుగుదల</div><div>నేచురల్ లుక్</div><div>శాశ్వత పరిష్కారం</div><div>మరింత ఆత్మవిశ్వాసం</div></div>
  <div class="feat"><div>FUE<br>Technique</div><div>Natural Hairline<br>Design</div><div>Expert Hair<br>Transplant Team</div><div>Personalised Care<br>&amp; Follow-up</div></div>
  <div class="clinic">డెర్మాలక్స్ స్కిన్ &amp; హెయిర్ క్లినిక్ – ఏలూరు</div>
  <div class="addr">రమా మహల్, కస్తూరి వారి వీధి, R.R పేట, హ్యాపీ మొబైల్స్ ఎదురుగా, ఏలూరు</div>
  <div class="cta">BOOK YOUR HAIR TRANSPLANT CONSULTATION TODAY</div>
  <div class="phones"><div class="ph"><small>CALL</small>99491 34666</div><div class="ph"><small>WHATSAPP</small>99591 34666</div></div>
  <div class="credit">${credit}</div>
</div></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  for (const [name, W, H, tall] of [["ht-offer-feed", 1080, 1350, false], ["ht-offer-status", 1080, 1920, true]]) {
    const pg = await browser.newPage();
    await pg.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
    await pg.setContent(page(W, H, tall), { waitUntil: "networkidle0" });
    await pg.evaluate(() => document.fonts.ready);
    const over = await pg.evaluate(() => { const s = document.querySelector(".sheet"); return s.scrollHeight - s.clientHeight; });
    await pg.screenshot({ path: path.join(__dirname, name + ".png"), clip: { x: 0, y: 0, width: W, height: H } });
    console.log(name + ".png", over > 0 ? `⚠ content overflows by ${over}px` : "fits");
    await pg.close();
  }
  await browser.close();
})();
