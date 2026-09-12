// api/_docs.js — DermaLuxe Academy document templates (same dark+gold theme as
// the website and course catalog). Renders to PDF (A4 / card) or JPEG with
// puppeteer-core + @sparticuz/chromium, exactly like the daily poster.
const fs = require("fs");
const path = require("path");

const BRAND = { name: "DermaLuxe by Medicare Skin And Hair Clinics", nameTe: "డెర్మాలక్స్ బై మెడికేర్ స్కిన్ అండ్ హెయిర్ క్లినిక్స్",
  academy: "DermaLuxe Academy", legal: "DermaLuxeAI Private Limited",
  addr: "Rama Mahal, Door No. 3-12, Ground Floor, Ramachandra Rao Peta, Kasturi Vari Street, Opposite Happy Mobiles, Eluru – 534002, Andhra Pradesh",
  addrTe: "రామ మహల్, కస్తూరి వారి వీధి, హ్యాపీ మొబైల్స్ ఎదురుగా, ఆర్.ఆర్. పేట, ఏలూరు – 534002",
  wa: "99591 34666", call: "+91 99491 34666", site: "dermaluxe.ai/academy", email: "support@dermaluxe.ai",
  trainer: "Dr. Meghana Valeti", trainerQ: "MD, DVL · Gold Medalist · Dermatologist & Cosmetologist",
  director: "Nagaraju Bandaru", directorQ: "Founder & CEO, DermaLuxeAI Private Limited" };

const COURSES = {
  skin:  { name: "Advanced Skin Care Treatments", te: "అడ్వాన్స్‌డ్ స్కిన్ కేర్ ట్రీట్‌మెంట్స్", fee: 100000, offer: 49999 },
  hair:  { name: "Advanced Hair Care Treatments", te: "అడ్వాన్స్‌డ్ హెయిర్ కేర్ ట్రీట్‌మెంట్స్", fee: 100000, offer: 49999 },
  both:  { name: "Skin + Hair Master Programme",  te: "స్కిన్ + హెయిర్ మాస్టర్ ప్రోగ్రామ్",   fee: 200000, offer: 99999 },
};
const BATCH = { no: 1, start: "20 October 2026", startISO: "2026-10-20", seats: 10, venue: "DermaLuxe Skin & Hair Clinics, Eluru" };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const dmy = (d) => new Date(d || Date.now()).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

let _logo = null;
function logoB64() {
  if (_logo === null) { try { _logo = fs.readFileSync(path.join(__dirname, "..", "assets", "logo.png")).toString("base64"); } catch (e) { _logo = ""; } }
  return _logo;
}
const LOGO = () => (logoB64() ? `<img class="logo" src="data:image/png;base64,${logoB64()}" alt="">` : `<div class="logo logo--txt">DermaLuxe</div>`);

const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Jost:wght@300;400;500;600&family=Noto+Sans+Telugu:wght@400;500;600&family=Great+Vibes&display=swap" rel="stylesheet">';
const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#0b0b0e;--panel:#15151a;--line:rgba(198,162,92,.30);--g1:#f4e2b8;--g2:#e9cf8f;--g3:#c6a25c;--g4:#a87f3c;--text:#ece9e3;--muted:#a9a49b;--muted2:#7c776e}
html,body{background:var(--ink);color:var(--text);font-family:Jost,sans-serif;font-weight:300;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.te{font-family:"Noto Sans Telugu",sans-serif;color:var(--g2)}
h1,h2,h3{font-family:"Cormorant Garamond",serif;font-weight:600;line-height:1.08;color:#f6f1e6}
.glow{position:absolute;inset:0;pointer-events:none;background:radial-gradient(60% 40% at 85% -5%,rgba(201,162,92,.15),transparent 60%),radial-gradient(45% 35% at 0% 45%,rgba(201,162,92,.07),transparent 60%)}
.frame{position:absolute;inset:6mm;border:1px solid rgba(233,207,143,.35);pointer-events:none}
.eyebrow{font-size:8pt;letter-spacing:3.5px;text-transform:uppercase;color:var(--g3);font-weight:500}
.logo{width:46mm;display:block}
.logo--txt{font-family:"Cormorant Garamond",serif;font-size:20pt;color:var(--g1)}
p{font-size:9.2pt;color:var(--muted)}
.rule{height:1px;background:linear-gradient(90deg,var(--g3),transparent);margin:3mm 0}
.sign{font-family:"Great Vibes",cursive;font-size:20pt;color:var(--g1);line-height:1}
.seal{width:26mm;height:26mm;border-radius:50%;border:1.2px solid var(--g3);display:grid;place-items:center;text-align:center;font-size:5.6pt;letter-spacing:1px;color:var(--g2);text-transform:uppercase;line-height:1.5;transform:rotate(-8deg);background:radial-gradient(closest-side,rgba(201,162,92,.14),transparent)}
.seal b{display:block;font-family:"Cormorant Garamond",serif;font-size:8.5pt;letter-spacing:.5px;color:var(--g1)}
.foot{position:absolute;left:14mm;right:14mm;bottom:8mm;display:flex;justify-content:space-between;font-size:7pt;color:var(--muted2);letter-spacing:.5px;border-top:1px solid rgba(255,255,255,.07);padding-top:2mm}
.foot b{color:var(--g3);font-weight:500}
table{width:100%;border-collapse:collapse}
td,th{font-size:9pt;padding:2.2mm 3mm;border-bottom:1px solid rgba(255,255,255,.07);text-align:left;vertical-align:top}
th{color:var(--muted2);font-size:7.5pt;letter-spacing:1.2px;text-transform:uppercase;font-weight:400;width:38mm}
td{color:var(--text);font-weight:400}
.box{background:var(--panel);border:1px solid var(--line);border-radius:3.5mm;padding:4mm 4.5mm}
.tag{font-size:7pt;letter-spacing:2px;text-transform:uppercase;color:var(--g3)}
ul{list-style:none}
li{position:relative;padding-left:4.6mm;font-size:8.6pt;color:var(--muted);margin:1mm 0}
li::before{content:"✦";position:absolute;left:0;top:.2mm;color:var(--g3);font-size:6.5pt}
.line{border-bottom:1px dotted rgba(233,207,143,.5);min-height:5.5mm;display:block}
`;
const page = (css, body) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>@page{margin:0}${BASE_CSS}${css}</style></head><body>${body}</body></html>`;
const A4 = `.page{width:210mm;height:297mm;position:relative;overflow:hidden;background:var(--ink);padding:14mm 14mm 12mm}`;

function head(title, sub, right) {
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>${LOGO()}<div class="te" style="font-size:8pt;margin-top:1mm">ఏలూరు · ELURU</div></div>
    <div style="text-align:right"><div class="eyebrow">${esc(BRAND.academy)}</div>
      <h2 style="font-size:19pt;margin-top:1mm">${esc(title)}</h2>
      <div style="font-size:8pt;color:var(--muted2);letter-spacing:1px">${esc(sub || "")}</div>
      ${right ? `<div style="font-size:8pt;color:var(--g2);margin-top:.8mm">${right}</div>` : ""}</div>
  </div><div class="rule"></div>`;
}
const footer = (l, r) => `<div class="foot"><span><b>${esc(BRAND.legal)}</b> · ${esc(l || BRAND.addr.slice(0, 78))}</span><span>${esc(r || (BRAND.site + " · WhatsApp " + BRAND.wa))}</span></div>`;
function signRow(opts = {}) {
  const seal = `<div class="seal"><div><b>DermaLuxe</b>Academy · Eluru<br>Est. 2026</div></div>`;
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:8mm">
    <div style="text-align:center"><div class="sign">${esc(BRAND.trainer)}</div>
      <div style="border-top:1px solid var(--line);margin-top:1.5mm;padding-top:1.5mm;font-size:8pt;color:var(--text)">${esc(BRAND.trainer)}</div>
      <div style="font-size:7pt;color:var(--muted2)">${esc(opts.trainerRole || "Lead Trainer · " + BRAND.trainerQ)}</div></div>
    ${opts.seal === false ? "" : seal}
    <div style="text-align:center"><div class="sign">${esc(BRAND.director)}</div>
      <div style="border-top:1px solid var(--line);margin-top:1.5mm;padding-top:1.5mm;font-size:8pt;color:var(--text)">${esc(BRAND.director)}</div>
      <div style="font-size:7pt;color:var(--muted2)">${esc(BRAND.directorQ)}</div></div>
  </div>`;
}
const course = (s) => COURSES[String(s.course || "skin").toLowerCase()] || COURSES.skin;
const V = (x, blank = "____________________") => (x ? esc(x) : `<span style="color:var(--muted2)">${blank}</span>`);

// ---------- 1. PAYMENT RECEIPT ------------------------------------------------
function receiptHtml(s, p = {}) {
  const c = course(s), amt = Number(p.amount || 9999), total = Number(s.fee || c.offer);
  const paidTotal = Number(s.paid || amt), bal = Math.max(0, total - paidTotal);
  return page(A4, `<section class="page"><div class="glow"></div><div class="frame"></div>
  ${head("Payment Receipt", "రసీదు", `No. ${esc(p.no || s.id || "—")} · ${esc(dmy(p.ts))}`)}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:3mm">
    <div class="box"><span class="tag">Received from · నుండి</span>
      <h3 style="font-size:15pt;margin-top:1.5mm">${V(s.name)}</h3>
      <p style="margin-top:1mm">📱 ${V(s.phone)}<br>${V(s.email, "")}</p></div>
    <div class="box"><span class="tag">Towards · దేనికి</span>
      <h3 style="font-size:13pt;margin-top:1.5mm">${esc(c.name)}</h3>
      <p class="te" style="font-size:8.5pt">${esc(c.te)}</p>
      <p style="margin-top:1mm">${esc(s.duration || "1 month")} · Batch ${BATCH.no} · starts ${esc(BATCH.start)}</p></div>
  </div>
  <div class="box" style="margin-top:5mm"><table>
    <tr><th>Payment for</th><td>${esc(p.label || "Seat reservation advance")}</td></tr>
    <tr><th>Amount received</th><td style="font-family:'Cormorant Garamond',serif;font-size:20pt;color:var(--g1);font-weight:600">${money(amt)}</td></tr>
    <tr><th>In words</th><td>${esc(p.words || inWords(amt))} only</td></tr>
    <tr><th>Mode</th><td>${esc(p.mode || "UPI")}${p.ref ? " · Ref: " + esc(p.ref) : ""}</td></tr>
    <tr><th>Date</th><td>${esc(dmy(p.ts))}</td></tr>
  </table></div>
  <div class="box" style="margin-top:4mm"><span class="tag">Fee summary · ఫీజు వివరాలు</span><table style="margin-top:1.5mm">
    <tr><th>Course fee (offer)</th><td>${money(total)} <span style="color:var(--muted2);text-decoration:line-through;margin-left:3mm">${money(c.fee)}</span> <span style="color:var(--g3);font-size:7.5pt">Launch offer till 30 Sep 2026</span></td></tr>
    <tr><th>Total paid</th><td style="color:var(--g1)">${money(paidTotal)}</td></tr>
    <tr><th>Balance due</th><td style="color:${bal ? "#ffb3a7" : "var(--g1)"}">${money(bal)}${bal ? " — payable on or before " + esc(BATCH.start) + " (course starting day)" : " — fully paid ✓"}</td></tr>
  </table></div>
  <p style="margin-top:4mm;font-size:8pt">This receipt confirms the amount received towards the above course. Seats are confirmed in order of reservation. Fees once paid are adjustable against the same course only and are not refundable. Please carry a copy of this receipt on the first day.</p>
  <p class="te" style="font-size:8pt;margin-top:1.5mm">ఈ రసీదు పైన తెలిపిన కోర్సుకు చెల్లించిన మొత్తాన్ని ధృవీకరిస్తుంది. మిగిలిన మొత్తం కోర్సు ప్రారంభ రోజున చెల్లించాలి. చెల్లించిన ఫీజు తిరిగి ఇవ్వబడదు.</p>
  ${signRow({ trainerRole: "Lead Trainer · Academy" })}
  ${footer()}</section>`);
}
function inWords(n) {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x) => x < 20 ? a[x] : (b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));
  n = Math.round(Number(n) || 0); if (!n) return "Zero Rupees";
  let out = "";
  const cr = Math.floor(n / 10000000); n %= 10000000;
  const lk = Math.floor(n / 100000); n %= 100000;
  const th = Math.floor(n / 1000); n %= 1000;
  if (cr) out += three(cr) + " Crore ";
  if (lk) out += three(lk) + " Lakh ";
  if (th) out += three(th) + " Thousand ";
  if (n) out += three(n);
  return "Rupees " + out.trim().replace(/\s+/g, " ");
}

// ---------- 2. ADMISSION FORM -------------------------------------------------
function admissionHtml(s = {}) {
  const c = course(s), filled = !!s.name;
  const row = (k, v, te) => `<tr><th>${esc(k)}${te ? `<br><span class="te" style="font-size:7pt;letter-spacing:0;text-transform:none">${esc(te)}</span>` : ""}</th><td>${filled ? V(v) : '<span class="line"></span>'}</td></tr>`;
  return page(A4, `<section class="page"><div class="glow"></div><div class="frame"></div>
  ${head("Admission Form", "అడ్మిషన్ ఫారం", `Batch ${BATCH.no} · ${esc(BATCH.start)}${s.id ? " · ID " + esc(s.id) : ""}`)}
  <div style="display:grid;grid-template-columns:1fr 34mm;gap:5mm;margin-top:2mm">
    <div class="box"><span class="tag">Course applied for · కోర్సు</span>
      <h3 style="font-size:15pt;margin-top:1.5mm">${esc(c.name)}</h3>
      <p class="te" style="font-size:8.5pt">${esc(c.te)}</p>
      <p style="margin-top:1mm">Duration: ${esc(s.duration || "1 month")} · Fee: ${money(s.fee || c.offer)} (launch offer) · Batch ${BATCH.no}, starts ${esc(BATCH.start)} · ${esc(BATCH.venue)}</p></div>
    <div class="box" style="display:grid;place-items:center;text-align:center;padding:2mm">
      ${s.photo ? `<img src="${esc(s.photo)}" style="width:30mm;height:38mm;object-fit:cover;border-radius:2mm">` : `<div style="width:30mm;height:38mm;border:1px dashed var(--line);border-radius:2mm;display:grid;place-items:center;font-size:7pt;color:var(--muted2);line-height:1.4">Paste<br>photo<br>ఫోటో</div>`}</div>
  </div>
  <div class="box" style="margin-top:4mm"><span class="tag">Personal details · వ్యక్తిగత వివరాలు</span><table style="margin-top:1.5mm">
    ${row("Full name", s.name, "పూర్తి పేరు")}${row("Father's / Guardian's name", s.guardian, "తండ్రి పేరు")}
    ${row("Date of birth", s.dob, "పుట్టిన తేదీ")}${row("Gender", s.gender, "లింగం")}
    ${row("Mobile (WhatsApp)", s.phone, "మొబైల్")}${row("Alternate / emergency contact", s.emergency, "ఎమర్జెన్సీ నంబర్")}
    ${row("Email", s.email, "ఇమెయిల్")}
    ${row("Address", s.address, "చిరునామా")}
  </table></div>
  <div class="box" style="margin-top:4mm"><span class="tag">Education &amp; experience · విద్య &amp; అనుభవం</span><table style="margin-top:1.5mm">
    ${row("Highest qualification", s.qualification, "విద్యార్హత")}${row("Current work / background", s.background, "ప్రస్తుత పని")}
    ${row("Years of experience", s.experience, "అనుభవం")}${row("ID proof (Aadhaar last 4 / PAN)", s.idproof, "ఐడీ ప్రూఫ్")}
  </table></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-top:4mm">
    <div class="box"><span class="tag">Documents submitted · డాక్యుమెంట్లు</span>
      <ul style="margin-top:1.5mm">
        <li>Passport photos (2) ${s.docs && s.docs.photo ? "✓" : "☐"}</li>
        <li>Aadhaar / ID proof copy ${s.docs && s.docs.id ? "✓" : "☐"}</li>
        <li>Qualification certificate copy ${s.docs && s.docs.qualification ? "✓" : "☐"}</li>
        <li>Experience certificate (if any) ${s.docs && s.docs.experience ? "✓" : "☐"}</li>
        <li>Signed admission &amp; consent form ${s.docs && s.docs.signed ? "✓" : "☐"}</li>
      </ul></div>
    <div class="box"><span class="tag">Fee status · ఫీజు</span><table style="margin-top:1.5mm">
      <tr><th>Course fee</th><td>${money(s.fee || c.offer)}</td></tr>
      <tr><th>Advance paid</th><td>${money(s.paid || 0)}${s.paidOn ? " · " + esc(dmy(s.paidOn)) : ""}</td></tr>
      <tr><th>Balance</th><td>${money(Math.max(0, (s.fee || c.offer) - (s.paid || 0)))} — due on ${esc(BATCH.start)}</td></tr>
    </table></div>
  </div>
  <div class="box" style="margin-top:4mm"><span class="tag">Declaration &amp; rules · నియమాలు</span>
    <ul style="margin-top:1.5mm">
      <li>I will attend all training days (Mon–Sat, Sundays holiday) and maintain at least 90% attendance.</li>
      <li>I will follow all hygiene, safety, consent and confidentiality rules of the clinic, and will not share client information or photographs.</li>
      <li>I understand training is hands-on on live clients under the supervision of an MD dermatologist, and I will not perform any procedure unsupervised.</li>
      <li>Fees once paid are not refundable; the balance is payable on the course starting day.</li>
      <li>Certificate is issued only after passing the practical exam and viva (70%). Placement is based on performance and available openings.</li>
    </ul>
    <p class="te" style="font-size:8pt;margin-top:1.5mm">నేను పైన ఉన్న నియమాలను చదివి అంగీకరిస్తున్నాను. హాజరు, భద్రత మరియు గోప్యతా నిబంధనలను పాటిస్తాను.</p>
    <div style="display:flex;justify-content:space-between;margin-top:5mm;font-size:8pt;color:var(--muted)">
      <div>Applicant signature<br><span class="line" style="width:55mm;display:inline-block;margin-top:4mm"></span></div>
      <div>Date<br><span class="line" style="width:35mm;display:inline-block;margin-top:4mm"></span></div>
      <div>Academy authorised signatory<br><div class="sign" style="margin-top:1mm">${esc(BRAND.trainer)}</div></div>
    </div>
  </div>
  ${footer()}</section>`);
}

// ---------- 3. ID CARD (front + back, CR80-ish) -------------------------------
function idCardHtml(s = {}) {
  const c = course(s);
  const css = `.card{width:54mm;height:86mm;border-radius:4mm;overflow:hidden;position:relative;background:linear-gradient(170deg,#15151a,#0b0b0e 60%);border:1px solid var(--line)}
  body{background:#0b0b0e;display:flex;gap:6mm;padding:6mm}
  .strip{position:absolute;left:0;right:0;top:0;height:1.2mm;background:linear-gradient(90deg,#f6e6bd,#c79a4e,#a87f3c)}`;
  const front = `<div class="card"><div class="strip"></div><div class="glow"></div>
    <div style="padding:5mm 4mm 0;text-align:center">${LOGO().replace('class="logo"', 'class="logo" style="width:32mm;margin:0 auto"')}
      <div class="te" style="font-size:6pt;margin-top:.8mm">ఏలూరు · ELURU</div>
      <div class="eyebrow" style="font-size:5.4pt;letter-spacing:2px;margin-top:1.5mm">${esc(BRAND.academy)}</div></div>
    <div style="display:grid;place-items:center;margin-top:2.5mm">
      ${s.photo ? `<img src="${esc(s.photo)}" style="width:24mm;height:29mm;object-fit:cover;border-radius:2mm;border:1px solid var(--line)">`
                : `<div style="width:24mm;height:29mm;border:1px dashed var(--line);border-radius:2mm;display:grid;place-items:center;font-size:5.5pt;color:var(--muted2)">PHOTO</div>`}</div>
    <div style="text-align:center;padding:2.5mm 3mm 0">
      <div style="font-family:'Cormorant Garamond',serif;font-size:11pt;color:var(--g1);font-weight:600;line-height:1.1">${V(s.name, "Student Name")}</div>
      <div style="font-size:5.8pt;color:var(--muted);margin-top:.8mm">${esc(c.name)}</div>
      <div style="font-size:5.6pt;color:var(--g3);margin-top:.6mm">Batch ${BATCH.no} · ${esc(s.duration || "1 month")}</div>
      <div style="margin-top:2mm;font-size:6.4pt;color:var(--g2);letter-spacing:1.5px;border:1px solid var(--line);border-radius:100px;padding:.8mm 2mm;display:inline-block">ID ${esc(s.id || "DLA-0000")}</div>
    </div>
    <div style="position:absolute;left:3mm;right:3mm;bottom:3mm;text-align:center;font-size:5pt;color:var(--muted2);border-top:1px solid rgba(255,255,255,.08);padding-top:1.2mm">TRAINEE · Valid till ${esc(s.validTill || "31 Dec 2026")}</div></div>`;
  const back = `<div class="card"><div class="strip"></div>
    <div style="padding:5mm 4mm">
      <div class="eyebrow" style="font-size:5.4pt;letter-spacing:2px">Trainee details</div>
      <table style="margin-top:2mm"><tbody>
        <tr><th style="font-size:5.4pt;width:17mm;padding:1.2mm 0;border:0">Phone</th><td style="font-size:6pt;padding:1.2mm 0;border:0">${V(s.phone, "—")}</td></tr>
        <tr><th style="font-size:5.4pt;padding:1.2mm 0;border:0">Blood group</th><td style="font-size:6pt;padding:1.2mm 0;border:0">${V(s.blood, "—")}</td></tr>
        <tr><th style="font-size:5.4pt;padding:1.2mm 0;border:0">Emergency</th><td style="font-size:6pt;padding:1.2mm 0;border:0">${V(s.emergency, "—")}</td></tr>
        <tr><th style="font-size:5.4pt;padding:1.2mm 0;border:0">Joined</th><td style="font-size:6pt;padding:1.2mm 0;border:0">${esc(dmy(s.joined))}</td></tr>
      </tbody></table>
      <div style="margin-top:3mm;font-size:5.4pt;color:var(--muted);line-height:1.6">
        • This card is the property of ${esc(BRAND.legal)} and must be worn inside the clinic.<br>
        • Not transferable. Report loss immediately.<br>
        • Trainees may not perform any procedure unsupervised.<br>
        • Client information and photographs are strictly confidential.</div>
      <div style="margin-top:3mm;text-align:center"><div class="sign" style="font-size:13pt">${esc(BRAND.trainer)}</div>
        <div style="font-size:5.2pt;color:var(--muted2);border-top:1px solid var(--line);padding-top:1mm;margin:1mm 6mm 0">Authorised signatory</div></div>
    </div>
    <div style="position:absolute;left:3mm;right:3mm;bottom:3mm;text-align:center;font-size:5pt;color:var(--muted2);border-top:1px solid rgba(255,255,255,.08);padding-top:1.2mm">${esc(BRAND.addrTe)}<br>WhatsApp ${esc(BRAND.wa)} · ${esc(BRAND.site)}</div></div>`;
  return page(css, front + back);
}

// ---------- 4. CERTIFICATE (A4 landscape) ------------------------------------
function certificateHtml(s = {}) {
  const c = course(s);
  const css = `.page{width:297mm;height:210mm;position:relative;overflow:hidden;background:var(--ink);padding:16mm 20mm}
  .frame2{position:absolute;inset:9mm;border:1px solid rgba(233,207,143,.22)}`;
  return page(css, `<section class="page"><div class="glow"></div><div class="frame"></div><div class="frame2"></div>
    <div style="text-align:center">${LOGO().replace('class="logo"', 'class="logo" style="width:52mm;margin:0 auto"')}
      <div class="te" style="font-size:9pt;margin-top:1mm">ఏలూరు · ELURU</div>
      <div class="eyebrow" style="margin-top:4mm">${esc(BRAND.academy)} · Advanced Skin &amp; Hair Aesthetics Training Centre</div>
      <h1 style="font-size:40pt;margin-top:3mm;letter-spacing:.5px">Certificate of Completion</h1>
      <div class="te" style="font-size:12pt;margin-top:1mm">కోర్సు పూర్తి చేసినందుకు ధృవీకరణ పత్రం</div>
      <div style="width:60mm;height:1px;background:linear-gradient(90deg,transparent,var(--g2),transparent);margin:5mm auto"></div>
      <p style="font-size:10.5pt">This is to certify that</p>
      <div style="font-family:'Cormorant Garamond',serif;font-size:34pt;color:var(--g1);font-weight:600;margin:2mm 0 1mm">${V(s.name, "Trainee Name")}</div>
      <p style="font-size:10pt;max-width:190mm;margin:0 auto">has successfully completed the <b style="color:var(--text);font-weight:500">${esc(c.name)}</b> programme (${esc(s.duration || "1 month")}, Batch ${BATCH.no}) at ${esc(BRAND.academy)}, Eluru — including hands-on training on live clients with USFDA-approved technology under the supervision of an MD dermatologist, and has passed the practical examination and viva.</p>
      <p class="te" style="font-size:9pt;margin-top:2mm">డాక్టర్ పర్యవేక్షణలో ప్రాక్టికల్ ట్రైనింగ్ పూర్తి చేసి, ప్రాక్టికల్ పరీక్ష &amp; వైవాలో ఉత్తీర్ణులయ్యారు.</p>
      <div style="display:flex;justify-content:center;gap:8mm;margin-top:4mm;font-size:8pt;color:var(--muted2);letter-spacing:1px">
        <span>Certificate No. <b style="color:var(--g2)">${esc(s.certNo || "DLA/2026/0000")}</b></span>
        <span>Grade <b style="color:var(--g2)">${esc(s.grade || "—")}</b></span>
        <span>Issued ${esc(dmy(s.issued))}</span>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:9mm;padding:0 8mm">
      <div style="text-align:center"><div class="sign" style="font-size:22pt">${esc(BRAND.trainer)}</div>
        <div style="border-top:1px solid var(--line);margin-top:1.5mm;padding-top:1.5mm;font-size:9pt;color:var(--text)">${esc(BRAND.trainer)}</div>
        <div style="font-size:7.5pt;color:var(--muted2)">${esc(BRAND.trainerQ)}</div></div>
      <div class="seal" style="width:32mm;height:32mm;font-size:6pt"><div><b style="font-size:10pt">DermaLuxe</b>Academy · Eluru<br>Est. 2026</div></div>
      <div style="text-align:center"><div class="sign" style="font-size:22pt">${esc(BRAND.director)}</div>
        <div style="border-top:1px solid var(--line);margin-top:1.5mm;padding-top:1.5mm;font-size:9pt;color:var(--text)">${esc(BRAND.director)}</div>
        <div style="font-size:7.5pt;color:var(--muted2)">${esc(BRAND.directorQ)}</div></div>
    </div>
    <div style="position:absolute;left:20mm;right:20mm;bottom:11mm;text-align:center;font-size:7pt;color:var(--muted2);letter-spacing:.5px">${esc(BRAND.legal)} · ${esc(BRAND.addr)} · WhatsApp ${esc(BRAND.wa)} · ${esc(BRAND.site)} · Verify this certificate on ${esc(BRAND.site)}</div>
  </section>`);
}

// ---------- renderer ----------------------------------------------------------
async function browser() {
  const pmod = await import("puppeteer-core");
  const puppeteer = pmod.default || pmod;
  let launch;
  if (process.platform === "darwin" || process.env.LOCAL_CHROME) {
    launch = { executablePath: process.env.LOCAL_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] };
  } else {
    const cmod = await import("@sparticuz/chromium");
    const chromium = cmod.default || cmod;
    launch = { args: chromium.args, executablePath: await chromium.executablePath(), headless: true };
  }
  return puppeteer.launch(launch);
}
// kind: "a4" | "a4l" | "card"
async function renderPdf(html, kind = "a4") {
  const b = await browser();
  try {
    const p = await b.newPage();
    await p.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    try { await p.evaluate(() => document.fonts.ready); } catch (e) {}
    await new Promise((z) => setTimeout(z, 350));
    const opt = { printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } };
    if (kind === "card") Object.assign(opt, { width: "120mm", height: "98mm" });
    else Object.assign(opt, { format: "A4", landscape: kind === "a4l" });
    const buf = await p.pdf(opt);
    return Buffer.from(buf).toString("base64");
  } finally { await b.close().catch(() => {}); }
}
async function renderImage(html, w, h) {
  const b = await browser();
  try {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await p.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    try { await p.evaluate(() => document.fonts.ready); } catch (e) {}
    await new Promise((z) => setTimeout(z, 350));
    const buf = await p.screenshot({ type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: w, height: h } });
    return Buffer.from(buf).toString("base64");
  } finally { await b.close().catch(() => {}); }
}

module.exports = { BRAND, COURSES, BATCH, receiptHtml, admissionHtml, idCardHtml, certificateHtml, renderPdf, renderImage, inWords, money, dmy, course };
