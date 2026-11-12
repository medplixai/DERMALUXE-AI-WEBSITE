// The referral guide the field team carries to doctors. A4, eight pages,
// English with Telugu under every heading and line. Re-run:
//   node print/make-doctor-catalog.js   →  print/doctor-catalog.pdf + print/catalog/page-N.png
//
// Owner, 12 Nov 2026: "catalog cheyyali, mana DermaLuxe gurinchi, PRO doctors
// ki explain cheyyadaniki field ki velinappudu, Telugu and English, manchi
// images". A doctor deciding whether to send a patient wants four answers:
// who will see the patient, what we treat, what the place is like, and how to
// send someone. The pages are in that order.
//
// What carries it is real: the clinic's own rooms and machines photographed
// for the opening, and the doctors' own portraits (never the AI-edited invite
// headshots — NMC 7.2(b)). The three anatomy illustrations and the twelve
// treatment icons are AI-drawn and marked ✦ where they appear, with the
// meaning of the mark on the back page (NMC 7.2).
//
// Words follow the NMC advertising rules the website follows: factual and
// verifiable (8.3(i)); no best / leading / painless / guaranteed (8.1(iii),
// (ix)); no before-and-after pictures (8.1(v)); nothing offered to the
// referring doctor for a referral (8.1(vii)); every doctor named with
// qualification and registration number (3.2). Prices: the ₹300 consultation
// only — a doctor's patient asks that first, and nothing else here is priced.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const QR = require("../node_modules/qrcode");
const docs = require("../api/_docs.js");
const { ICONS } = require("./refpad-icons.js");

const ROOT = path.join(__dirname, "..");
const B = docs.BRAND, D = docs.DOCTORS;
const img = (f) => "data:image/jpeg;base64," + fs.readFileSync(path.join(__dirname, "catalog", "img", f)).toString("base64");
const png = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
const logo = png(path.join(ROOT, "assets", "logo.png"));
const icon = (slug) => png(path.join(__dirname, "refpad", "sm", slug + ".png"));
const MAPS = "https://www.google.com/maps?cid=6720707313608974554";   // the clinic's Google listing, as on the referral pad
const WA = "https://wa.me/919959134666";
const te = (s) => `<span class="te" lang="te">${s}</span>`;

// ---------------------------------------------------------------- pieces
const top = (section, sectionTe) => `<header class="top"><div class="mark"><img src="${logo}" alt=""><b>DermaLuxe <small>by</small> Medicare</b></div><div class="sec">${section}${sectionTe ? ` · ${te(sectionTe)}` : ""}</div></header>`;
const foot = (n) => `<footer class="foot"><span>For registered medical practitioners · ${te("రిజిస్టర్డ్ వైద్యుల కోసం")}</span><span>DermaLuxe by Medicare, Eluru · ${n} / 10</span></footer>`;
// Chapter numbers over each title — 01 to 08, the same order as the
// "Inside" list on the cover.
const h1 = (en, tel, n) => `${n ? `<p class="chap">${String(n).padStart(2, "0")}<i></i></p>` : ""}<h1>${en}</h1><p class="h1te">${te(tel)}</p>`;
const svg = (d, cls) => `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  rupee: '<path d="M7 4h11M7 9h11M9 4c4 0 6 2 6 5s-2 5-6 5H8l7 7"/>',
  tick: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  blade: '<path d="M4 20l9-9M13 11c2-4 5-6 7-7-1 2-3 5-7 7z"/>',
};
const photo = (f, en, tel, cls) => `<figure class="ph ${cls || ""}"><img src="${img(f)}" alt=""><figcaption>${en}<br>${te(tel)}</figcaption></figure>`;
const ai = `<i class="ai" title="AI illustration">✦</i>`;

// ---------------------------------------------------------------- 1 · cover
const P1 = `<section class="pg cover">
  <!-- The building on top with its sign in full view (owner, 12 Nov: "hospital
       name kanipinchatledu" — the title and the shade had covered the sign),
       the words on a panel of their own below it. -->
  <div class="cv-photo"><img class="cv-img" src="${img("building.jpg")}" alt=""><div class="cv-shade"></div>
  <div class="cv-top"><img src="${logo}" alt=""><div><b>DermaLuxe <small>by</small> Medicare</b><span>Premium Skin &amp; Hair Clinic · Eluru</span></div></div></div>
  <div class="cv-body"><div class="cv-main">
    <p class="eyebrow">For referring doctors · ${te("రిఫర్ చేసే డాక్టర్ల కోసం")}</p>
    <h1 class="cv-title">A Referral Guide<br>for Doctors</h1>
    <p class="cv-te">${te("డాక్టర్ల కోసం రిఫరల్ గైడ్")}</p>
    <p class="cv-sub">Skin · Hair · Nails · Procedural &amp; Aesthetic Dermatology<br>${te("చర్మం · జుట్టు · గోళ్ళు · ప్రొసీజర్లు &amp; ఈస్థటిక్ డెర్మటాలజీ")}</p></div>
    <div class="cv-in"><p>Inside · ${te("లోపల")}</p><ol>${[["02", "Our doctors", "మా డాక్టర్లు"], ["03", "Conditions we see", "చర్మ సమస్యలు"], ["04", "Procedures", "ప్రొసీజర్లు"], ["05", "Hair &amp; transplant", "జుట్టు &amp; ట్రాన్స్‌ప్లాంట్"], ["07", "Our machines", "మా మెషీన్లు"], ["08", "How to refer", "ఎలా రిఫర్ చేయాలి"]].map(([n, e, t]) => `<li><b>${n}</b><span>${e}<br>${te(t)}</span></li>`).join("")}</ol></div>
  </div>
  <div class="cv-strip"><span>MD (DVL) dermatologists</span><span>Mon–Sat · 9 AM – 9 PM</span><span>Rama Mahal, R.R. Peta, Eluru</span></div>
</section>`;

// ---------------------------------------------------------------- 2 · about
const FACTS = [
  ["3", "MD (DVL) dermatologists", "ముగ్గురు MD (DVL) డెర్మటాలజిస్టులు"],
  ["9–9", "Monday to Saturday", "సోమ నుండి శని · ఉదయం 9 – రాత్రి 9"],
  ["10", "Medicare centres in Andhra Pradesh", "ఆంధ్రప్రదేశ్‌లో 10 మెడికేర్ సెంటర్లు"],
  ["₹300", "Doctor consultation", "డాక్టర్ కన్సల్టేషన్"],
];
const GETS = [
  ["Every consultation is with an MD (DVL) dermatologist.", "ప్రతి కన్సల్టేషన్ MD (DVL) డెర్మటాలజిస్ట్‌తోనే."],
  ["Diagnosis first, then a written prescription and plan.", "ముందు నిర్ధారణ, తర్వాత రాతపూర్వక ప్రిస్క్రిప్షన్ &amp; ప్లాన్."],
  ["Medical, procedural and aesthetic care in one building.", "మెడికల్, ప్రొసీజర్, ఈస్థటిక్ కేర్ — అన్నీ ఒకే భవనంలో."],
  ["Confidential care for sexually transmitted infections.", "సుఖవ్యాధులకు పూర్తి గోప్యతతో చికిత్స."],
  ["Video consultation for patients who cannot travel, and for follow-ups.", "దూరం నుండి రాలేని వారికి, ఫాలో-అప్‌కు వీడియో కన్సల్టేషన్ కూడా ఉంది."],
];
const P2 = `<section class="pg">
  ${top("About the clinic", "క్లినిక్ గురించి")}
  ${h1("Dermatology care for your patients, close to home", "మీ పేషెంట్లకు దగ్గర్లోనే చర్మ వైద్యం", 1)}
  <div class="two">
    <div>
      <p class="lead">DermaLuxe by Medicare opened in Eluru on 6&nbsp;November&nbsp;2026. It is part of Medicare Skin &amp; Hair Clinics, a group of ten centres across Andhra Pradesh. Skin disease, hair and scalp disorders, nail problems, dermatosurgery and aesthetic treatments are all seen here, by dermatologists.</p>
      <p class="leadte">${te("డెర్మాలక్స్ బై మెడికేర్ 6 నవంబర్ 2026న ఏలూరులో ప్రారంభమైంది. ఇది ఆంధ్రప్రదేశ్‌లో పది సెంటర్లు ఉన్న మెడికేర్ స్కిన్ &amp; హెయిర్ క్లినిక్స్‌లో భాగం. చర్మ వ్యాధులు, జుట్టు &amp; తల చర్మ సమస్యలు, గోళ్ళ సమస్యలు, డెర్మటోసర్జరీ, ఈస్థటిక్ చికిత్సలు — అన్నీ డెర్మటాలజిస్టులే చూస్తారు.")}</p>
    </div>
    <ul class="gets">${GETS.map(([e, t]) => `<li>${e}<br>${te(t)}</li>`).join("")}</ul>
  </div>
  <div class="facts">${FACTS.map(([n, e, t]) => `<div><b>${n}</b><span>${e}</span>${te(t)}</div>`).join("")}</div>
  <div class="row3">
    ${photo("c_rec.jpg", "Reception", "రిసెప్షన్")}
    ${photo("c_cons.jpg", "Consultation room", "కన్సల్టేషన్ రూమ్")}
    ${photo("c_lounge.jpg", "Patient lounge", "పేషెంట్ లాంజ్")}
  </div>
  ${foot(2)}
</section>`;

// ---------------------------------------------------------------- 3 · doctors
// Each portrait is cut from the doctor's own photograph to one framing —
// 4:5, the head 48% of the height with its top 4% from the edge, centred —
// so the four faces sit at the same size and the same eye line (owner,
// 12 Nov: "doctor photos proper alignment lo levu"). Measured crops are in
// print/catalog/img/p-*.jpg; sources: assets/dr-nikhitha.jpg, assets/founders
// photos/Dr. Meghana Valleti.png, assets/dr-sai-divija.jpg, assets/dr-jaishree.jpg.
const TEAM = [
  ["p-nik.jpg", D.nikhitha.name, "డా. నిఖితా ప్రియాంక", "MD (DVL) · Consultant Dermatologist", "కన్సల్టెంట్ డెర్మటాలజిస్ట్",
    [["Aesthetics Fellowship (AAAFP), Mumbai", "ఈస్థటిక్స్ ఫెలోషిప్ (AAAFP), ముంబై"], ["Ex. Senior Dermatologist, AIIMS Mangalagiri", "మాజీ సీనియర్ డెర్మటాలజిస్ట్, AIIMS మంగళగిరి"]], `Reg. No. ${D.nikhitha.reg}`],
  ["p-meg.jpg", "Dr. Meghana Valeti", "డా. మేఘన వలేటి", "MD (DVL) · Founder &amp; Medical Director", "వ్యవస్థాపకురాలు &amp; మెడికల్ డైరెక్టర్",
    [["Dermatologist &amp; Cosmetologist", "డెర్మటాలజిస్ట్ &amp; కాస్మటాలజిస్ట్"], ["10+ years in dermatology", "డెర్మటాలజీలో 10+ సంవత్సరాల అనుభవం"]], `Reg. No. ${D.meghana.reg}`],
  ["p-div.jpg", D.divija.name, "డా. కె. సాయి దివిజ", "MD (DVL) · Dermatologist", "డెర్మటాలజిస్ట్",
    [["Medical dermatology, hair &amp; aesthetics", "మెడికల్ డెర్మటాలజీ, జుట్టు &amp; ఈస్థటిక్స్"], ["5+ years in dermatology", "డెర్మటాలజీలో 5+ సంవత్సరాల అనుభవం"]], `Reg. No. ${D.divija.reg}`],
  ["p-jai.jpg", "Dr. Jaishree", "డా. జైశ్రీ", "MDS (OMFS) · Hair Transplant Surgeon", "హెయిర్ ట్రాన్స్‌ప్లాంట్ సర్జన్",
    [["FUE &amp; DHI, hairline design, graft planning", "FUE &amp; DHI, హెయిర్‌లైన్ డిజైన్, గ్రాఫ్ట్ ప్లానింగ్"], ["6+ years of surgical experience", "6+ సంవత్సరాల సర్జికల్ అనుభవం"]], ""],
];
const P3 = `<section class="pg">
  ${top("Who will see your patient", "మీ పేషెంట్‌ను ఎవరు చూస్తారు")}
  ${h1("Our doctors", "మా డాక్టర్లు", 2)}
  <div class="team">${TEAM.map(([f, n, nte, q, qte, lines, reg]) => `<article class="doc">
    <img src="${img(f)}" alt="">
    <div class="who"><h3>${n}</h3><p class="nte">${te(nte)}</p><p class="q">${q}</p><p class="qte">${te(qte)}</p>${reg ? `<p class="reg">${reg}<br>${te(reg.replace("Reg. No.", "రిజి. నం."))}</p>` : ""}</div>
    <ul>${lines.map(([l, lt]) => `<li>${l}<br>${te(lt)}</li>`).join("")}</ul></article>`).join("")}</div>
  <p class="note">Skin, hair and nail consultations are with the MD (DVL) dermatologists. For a hair transplant, the surgeon examines the scalp, then plans and performs the surgery.<br>${te("చర్మం, జుట్టు, గోళ్ళ కన్సల్టేషన్లు MD (DVL) డెర్మటాలజిస్టులతోనే. హెయిర్ ట్రాన్స్‌ప్లాంట్‌కు సర్జన్ తల పరీక్షించి, ప్లాన్ చేసి సర్జరీ చేస్తారు.")}</p>
  ${foot(3)}
</section>`;

// ---------------------------------------------------------------- 4 · medical dermatology
const COND = [
  ["Acne &amp; acne scars", "మొటిమలు &amp; మచ్చలు"],
  ["Pigmentation &amp; melasma", "పిగ్మెంటేషన్ &amp; మంగు (మెలాస్మా)"],
  ["Eczema &amp; dermatitis", "ఎగ్జిమా &amp; డెర్మటైటిస్"],
  ["Psoriasis", "సోరియాసిస్"],
  ["Vitiligo, incl. surgery for stable patches", "బొల్లి (విటిలిగో) — స్థిరమైన మచ్చలకు సర్జరీ కూడా"],
  ["Fungal &amp; bacterial skin infections", "ఫంగల్ &amp; బ్యాక్టీరియల్ చర్మ ఇన్ఫెక్షన్లు"],
  ["Urticaria &amp; skin allergy", "దద్దుర్లు &amp; చర్మ అలర్జీ"],
  ["Warts, moles &amp; skin tags", "పులిపిర్లు, పుట్టుమచ్చలు &amp; స్కిన్ ట్యాగ్స్"],
  ["Hair fall &amp; alopecia areata", "జుట్టు రాలడం &amp; అలోపేసియా ఏరియేటా"],
  ["Nail disorders, incl. minor nail surgery", "గోళ్ళ సమస్యలు — చిన్న గోరు సర్జరీ కూడా"],
  ["Children's skin — scabies, eczema", "పిల్లల చర్మ సమస్యలు — గజ్జి, ఎగ్జిమా"],
  ["Sexually transmitted infections — confidential", "సుఖవ్యాధులు — పూర్తి గోప్యతతో"],
  ["Mole check with dermoscopy", "డెర్మోస్కోపీతో పుట్టుమచ్చల పరీక్ష"],
  ["Leprosy &amp; chronic skin infections", "కుష్టు &amp; దీర్ఘకాలిక చర్మ ఇన్ఫెక్షన్లు"],
];
const WHEN = [
  ["A rash not settling after 2–4 weeks of first-line treatment", "మొదటి చికిత్సతో 2–4 వారాల్లో తగ్గని దద్దుర్లు"],
  ["A suspected drug rash — call us the same day", "మందుల వల్ల దద్దుర్లు అనిపిస్తే — అదే రోజు కాల్ చేయండి"],
  ["A mole or patch that is changing, bleeding or not healing", "మారుతున్న, రక్తం వస్తున్న లేదా మానని పుట్టుమచ్చ / మచ్చ"],
  ["White patches that are spreading", "పెరుగుతున్న తెల్ల మచ్చలు"],
  ["Patchy hair loss, or hair fall for more than 3 months", "మచ్చలుగా జుట్టు ఊడటం, లేదా 3 నెలలు దాటిన జుట్టు రాలడం"],
  ["Acne that is leaving scars", "మచ్చలు వదిలే మొటిమలు"],
  ["Fungal infection that keeps coming back", "మళ్ళీ మళ్ళీ వచ్చే ఫంగల్ ఇన్ఫెక్షన్"],
];
// The condition pictures are the website's own (assets/tx, drawn by
// tools/page-images.js and marked there as AI) — the owner asked for the
// site's images on 12 Nov.
const CPICS = [
  ["acne-treatment-eluru", "Acne", "మొటిమలు"], ["pigmentation-treatment-eluru", "Pigmentation", "పిగ్మెంటేషన్"],
  ["psoriasis-treatment-eluru", "Psoriasis", "సోరియాసిస్"], ["vitiligo-treatment-eluru", "Vitiligo", "బొల్లి"],
  ["fungal-infection-treatment-eluru", "Fungal infection", "ఫంగల్ ఇన్ఫెక్షన్"], ["alopecia-areata-treatment-eluru", "Alopecia areata", "అలోపేసియా"],
];
const P4 = `<section class="pg">
  ${top("Medical dermatology", "మెడికల్ డెర్మటాలజీ")}
  ${h1("Conditions we see", "మేము చూసే చర్మ సమస్యలు", 3)}
  <div class="md">
    <ul class="cond">${COND.map(([e, t]) => `<li>${e}<br>${te(t)}</li>`).join("")}</ul>
    <div class="md-side">
      <div class="mosaic">${CPICS.map(([f, e, t]) => `<figure>${ai}<img src="${img("tx-" + f + ".jpg")}" alt=""><figcaption>${e} · ${te(t)}</figcaption></figure>`).join("")}</div>
      <div class="when"><h2>When to refer</h2><p class="wte">${te("ఎప్పుడు రిఫర్ చేయాలి")}</p>
        <ul>${WHEN.map(([e, t]) => `<li>${e}<br>${te(t)}</li>`).join("")}</ul>
        <div class="when-call">${svg(I.phone)}<div><span>Call or WhatsApp · ${te("కాల్ లేదా WhatsApp చేయండి")}</span><b>+91 ${B.wa}</b></div></div></div>
    </div>
  </div>
  ${foot(4)}
</section>`;

// ---------------------------------------------------------------- 5 · procedures
const LINE = {
  "laser-hair-removal": ["Diode laser for unwanted hair; usually 6–8 monthly sessions.", "డయోడ్ లేజర్‌తో అవాంఛిత రోమాల తగ్గింపు; సాధారణంగా 6–8 నెలవారీ సెషన్లు."],
  "hydrafacial": ["Machine cleansing, exfoliation and hydration; little downtime.", "మెషీన్‌తో క్లెన్సింగ్, ఎక్స్‌ఫోలియేషన్, హైడ్రేషన్; downtime దాదాపు ఉండదు."],
  "pico-laser": ["Picosecond laser for pigmentation, melasma and tattoos.", "పిగ్మెంటేషన్, మంగు, టాటూల కోసం పికోసెకండ్ లేజర్."],
  "co2-laser": ["Fractional resurfacing for acne scars and texture.", "మొటిమల మచ్చలు, చర్మ టెక్స్చర్ కోసం ఫ్రాక్షనల్ రీసర్ఫేసింగ్."],
  "mnrf": ["Microneedling radiofrequency for scars and laxity.", "మచ్చలు, చర్మం వదులు కోసం మైక్రోనీడ్లింగ్ RF."],
  "hifu": ["Focused ultrasound for skin tightening, without incision.", "కోత లేకుండా ఫోకస్డ్ అల్ట్రాసౌండ్‌తో చర్మం బిగుతు."],
  "hair-transplant": ["FUE and DHI in the clinic's procedure theatre.", "క్లినిక్ ప్రొసీజర్ థియేటర్‌లో FUE &amp; DHI."],
  "rf": ["Radiofrequency for mild skin laxity.", "తేలికపాటి చర్మం వదులుకు రేడియోఫ్రీక్వెన్సీ."],
  "skin-lightening": ["Peels, lasers and topicals, planned by the dermatologist.", "డెర్మటాలజిస్ట్ ప్లాన్ చేసే peels, lasers, క్రీములు."],
  "chemical-peel": ["Medical-grade peels for acne, marks and tanning.", "మొటిమలు, మచ్చలు, టానింగ్ కోసం మెడికల్-గ్రేడ్ peels."],
  "medi-facial": ["Facials chosen for the skin condition, doctor-supervised.", "చర్మ సమస్యకు తగ్గ facials — డాక్టర్ పర్యవేక్షణలో."],
  "glow-drip": ["IV nutrient infusions, only after a doctor's assessment.", "డాక్టర్ అసెస్‌మెంట్ తర్వాత మాత్రమే IV న్యూట్రియెంట్ డ్రిప్స్."],
};
// The website's picture for each procedure (assets/tx), matched to the pad's icons.
const TXPIC = {
  "laser-hair-removal": "laser-hair-removal-eluru", "hydrafacial": "hydrafacial-eluru", "pico-laser": "pico-laser-tattoo-removal-eluru",
  "co2-laser": "card-laser-resurfacing", "mnrf": "mnrf-treatment-eluru", "hifu": "hifu-face-lift-eluru",
  "hair-transplant": "hair-transplant-eluru", "rf": "anti-ageing-treatment-eluru", "skin-lightening": "tan-removal-skin-brightening-eluru",
  "chemical-peel": "chemical-peel-eluru", "medi-facial": "open-pores-oily-skin-treatment-eluru", "glow-drip": "glutathione-skin-whitening-eluru",
};
const P5 = `<section class="pg">
  ${top("Procedures &amp; aesthetics", "ప్రొసీజర్లు &amp; ఈస్థటిక్స్")}
  ${h1("Procedures we perform", "మేము చేసే ప్రొసీజర్లు", 4)}
  <p class="lead p5lead">Every procedure follows a dermatologist's consultation; sessions, expected result and risks are explained before starting.<br>${te("ప్రతి ప్రొసీజర్ డెర్మటాలజిస్ట్ కన్సల్టేషన్ తర్వాతే; ఎన్ని సెషన్లు, ఎలాంటి ఫలితం, ఏ రిస్కులు — మొదలుపెట్టే ముందే వివరిస్తారు.")}</p>
  <div class="tx">${ICONS.map(([slug, label, hex]) => `<article style="--h:${hex}"><div class="pic">${ai}<img src="${img("tx-" + TXPIC[slug] + ".jpg")}" alt=""><img class="ic" src="${icon(slug)}" alt=""></div><div class="txt"><h3>${label}</h3><p>${LINE[slug][0]}</p>${te(LINE[slug][1])}</div></article>`).join("")}</div>
  <div class="dsurg"><h3>${svg(I.blade)}Dermatosurgery &amp; injectables · ${te("డెర్మటోసర్జరీ &amp; ఇంజెక్టబుల్స్")}</h3>
    <div class="pills">${[["Mole, wart &amp; skin-tag removal", "పుట్టుమచ్చ, పులిపిర్లు &amp; స్కిన్ ట్యాగ్ తొలగింపు"], ["Vitiligo surgery (stable patches)", "బొల్లి సర్జరీ"], ["Minor nail surgery", "చిన్న గోరు సర్జరీ"], ["PRP / GFC · Mesotherapy", "మెసోథెరపీ"], ["Botox · Fillers · Thread lift", "ఫిల్లర్లు · థ్రెడ్ లిఫ్ట్"]].map(([e, t]) => `<span>${e} · ${te(t)}</span>`).join("")}</div></div>
  <p class="ainote">${ai} The pictures and icons on this page are AI-generated, the same ones the website uses; they show the condition, not a patient of the clinic. ${te("ఈ పేజీలోని ఫోటోలు, ఐకాన్లు AI తో తయారు చేసినవి — వెబ్‌సైట్‌లో ఉన్నవే; ఇవి సమస్యను చూపిస్తాయి, క్లినిక్ పేషెంట్లు కాదు.")}</p>
  ${foot(5)}
</section>`;

// ---------------------------------------------------------------- 6 · hair
const HAIR = [
  ["Hair-fall evaluation", "జుట్టు రాలడంపై పరీక్ష", "Cause found first — nutrition, thyroid, hormones, scalp disease — then treated.", "జుట్టు రాలడానికి కారణం ముందు కనుక్కుంటారు — పోషణ, థైరాయిడ్, హార్మోన్లు, తల చర్మ వ్యాధి — తర్వాత చికిత్స."],
  ["Alopecia areata &amp; scalp disease", "అలోపేసియా ఏరియేటా &amp; తల చర్మ వ్యాధులు", "Patchy loss, dandruff, scalp psoriasis and infections.", "మచ్చలుగా జుట్టు ఊడటం, చుండ్రు, తల సోరియాసిస్, ఇన్ఫెక్షన్లు."],
  ["PRP / GFC &amp; mesotherapy", "PRP / GFC &amp; మెసోథెరపీ", "Growth-factor injections to the scalp, usually 3–6 monthly sittings.", "తలకు గ్రోత్-ఫ్యాక్టర్ ఇంజెక్షన్లు; సాధారణంగా 3–6 నెలవారీ సిట్టింగ్‌లు."],
  ["Hair transplant — FUE &amp; DHI", "హెయిర్ ట్రాన్స్‌ప్లాంట్ — FUE &amp; DHI", "Day procedure under local anaesthesia; the graft count is decided after a scalp assessment.", "లోకల్ అనస్థీషియాతో ఒక్క రోజు ప్రొసీజర్; ఎన్ని గ్రాఫ్ట్‌లు అనేది తల పరీక్ష తర్వాత నిర్ణయిస్తారు."],
  ["Beard &amp; eyebrow transplant", "గడ్డం &amp; కనుబొమ్మల ట్రాన్స్‌ప్లాంట్", "Planned in the same way as a scalp hair transplant.", "తలపై హెయిర్ ట్రాన్స్‌ప్లాంట్ లాగానే ప్లాన్ చేస్తారు."],
];
const P6 = `<section class="pg">
  ${top("Hair &amp; scalp", "జుట్టు &amp; తల చర్మం")}
  ${h1("Hair loss, from diagnosis to transplant", "జుట్టు రాలడం — నిర్ధారణ నుండి ట్రాన్స్‌ప్లాంట్ వరకు", 5)}
  <div class="hair">
    <div class="hair-l"><figure class="art wide">${ai}<img src="${img("art-hair-follicle.jpg")}" alt=""></figure>
    <div class="send"><h3>Sending a hair-fall patient?</h3><p class="sendte">${te("జుట్టు రాలే పేషెంట్‌ను పంపుతున్నారా?")}</p>
      <ul>${[["Ask them to bring any thyroid, iron or vitamin D reports already done", "ఇప్పటికే చేసిన థైరాయిడ్, ఐరన్, విటమిన్ D రిపోర్టులు తీసుకురమ్మని చెప్పండి"], ["and the prescriptions they are using now", "ఇప్పుడు వాడుతున్న ప్రిస్క్రిప్షన్లు కూడా"], ["Note since when — after delivery, after an illness, or with PCOS", "ఎప్పటి నుండి అనేది రాయండి — డెలివరీ తర్వాత, అనారోగ్యం తర్వాత, PCOS తో"]].map(([e, t]) => `<li>${svg(I.tick)}<div>${e}<br>${te(t)}</div></li>`).join("")}</ul></div></div>
    <ol class="steps">${HAIR.map(([h, ht, e, t]) => `<li><h3>${h}</h3><p class="hte">${te(ht)}</p><p>${e}</p>${te(t)}</li>`).join("")}</ol>
  </div>
  <div class="row2">
    ${photo("c_hair.jpg", "Hair treatment station", "హెయిర్ ట్రీట్‌మెంట్ స్టేషన్")}
    ${photo("c_ot.jpg", "Procedure theatre", "ప్రొసీజర్ థియేటర్")}
  </div>
  <p class="note">Results differ between patients; suitability for a transplant is decided after examination.<br>${te("ఫలితాలు ఒక్కొక్కరికి ఒక్కోలా ఉంటాయి; ట్రాన్స్‌ప్లాంట్ సరిపోతుందా అనేది పరీక్ష తర్వాతే చెబుతారు.")}</p>
  ${foot(6)}
</section>`;

// ---------------------------------------------------------------- 7 · facility
// ---------------------------------------------------------------- 7 · hair transplant
// Owner, 12 Nov: "ht ki website lo unna image add chesi matter add cheyyi".
// The words are the website's own (hair-transplant-eluru.html and the offer
// page), in English and Telugu. The picture is the one the website's hair
// transplant module and offer page show: a stock before-and-after photograph,
// put back on the website by the owner's decision of 27 Oct after being told
// that NMC 8.1(v) says such a photograph shall not be used to promote. It
// carries the website's own caption here too. The package box prints only
// while the package runs (to 6 Dec 2026) — re-run this script after that and
// the box is gone.
const HT_PACKAGE = Date.now() < Date.parse("2026-12-07T00:00:00+05:30");
const HT_TECH = [
  ["FUE", "Follicular Unit Extraction", "ఫోలిక్యులర్ యూనిట్ ఎక్స్‌ట్రాక్షన్", "Follicles taken one by one from the back of the scalp — no linear scar.", "తల వెనుక భాగం నుండి మూలాలు ఒక్కొక్కటిగా తీస్తారు — గీత మచ్చ ఉండదు."],
  ["DHI", "Direct Hair Implantation", "డైరెక్ట్ హెయిర్ ఇంప్లాంటేషన్", "Implanter pen for denser packing and a precise hairline.", "ఇంప్లాంటర్ పెన్‌తో దట్టంగా, ఖచ్చితమైన హెయిర్‌లైన్."],
  ["Bio-FUE", "With PRP / GFC", "PRP / GFC తో", "Growth factors during the procedure to support healing.", "ప్రొసీజర్ సమయంలో గ్రోత్ ఫ్యాక్టర్లు — త్వరగా మానడానికి."],
];
const HT_TIME = [
  ["Day 1", "6–8 hours, under local anaesthesia; home the same day", "లోకల్ అనస్థీషియాతో 6–8 గంటలు; అదే రోజు ఇంటికి"],
  ["2–3 days", "Back to routine; mild soreness and swelling are normal", "మామూలు పనులకు; తేలికపాటి నొప్పి, వాపు సాధారణం"],
  ["3–4 months", "New growth starts", "కొత్త జుట్టు రావడం మొదలవుతుంది"],
  ["9–12 months", "Full result", "పూర్తి ఫలితం"],
];
const PHT = `<section class="pg">
  ${top("Hair transplant", "హెయిర్ ట్రాన్స్‌ప్లాంట్")}
  ${h1("Hair transplant — FUE &amp; DHI", "హెయిర్ ట్రాన్స్‌ప్లాంట్ — FUE &amp; DHI", 6)}
  <div class="ht">
    <figure class="ba"><img src="${img("ht-before-after.jpg")}" alt=""><figcaption>Stock photograph, not a patient of this clinic. Results differ from person to person.<br>${te("ఇది స్టాక్ ఫోటో — మా క్లినిక్ పేషెంట్ కాదు. ఫలితాలు ఒక్కొక్కరికి ఒక్కోలా ఉంటాయి.")}</figcaption></figure>
    <div class="ht-txt">
      <p class="lead">Your patient's own follicles are moved from the donor area at the back of the scalp, under local anaesthesia, with no linear scar. The hairline is designed to follow the patient's own growth pattern.</p>
      <p class="leadte">${te("పేషెంట్ సొంత వెంట్రుకల మూలాలను తల వెనుక డోనర్ భాగం నుండి, లోకల్ అనస్థీషియాతో, గీత మచ్చ లేకుండా మారుస్తారు. హెయిర్‌లైన్ పేషెంట్ సహజ జుట్టు పెరిగే తీరును అనుసరించి డిజైన్ చేస్తారు.")}</p>
      <ul class="gets ht-pts">
        <li>Surgeon: Dr. Jaishree, MDS (OMFS) — 6+ years of surgical experience, with our dermatologists<br>${te("సర్జన్: డా. జైశ్రీ, MDS (OMFS) — 6+ సంవత్సరాల సర్జికల్ అనుభవం, మా డెర్మటాలజిస్టులతో కలిసి")}</li>
        <li>For men and women with pattern baldness, a receding hairline or patchy loss<br>${te("బట్టతల, వెనక్కి వెళ్తున్న హెయిర్‌లైన్, మచ్చలుగా జుట్టు ఊడటం ఉన్న పురుషులు, స్త్రీలకు")}</li>
        <li>The surgeon examines the donor area and decides the technique and graft count<br>${te("సర్జన్ డోనర్ భాగాన్ని పరీక్షించి, పద్ధతి &amp; గ్రాఫ్ట్‌ల సంఖ్య నిర్ణయిస్తారు")}</li>
        <li>Transplanted follicles are permanent; the remaining natural hair can still thin and needs care<br>${te("నాటిన మూలాలు శాశ్వతం; మిగిలిన సహజ జుట్టు సన్నబడవచ్చు — దానికి సంరక్షణ అవసరం")}</li>
        <li>Beard, moustache and eyebrow transplant also done<br>${te("గడ్డం, మీసం, కనుబొమ్మల ట్రాన్స్‌ప్లాంట్ కూడా చేస్తారు")}</li>
      </ul>
    </div>
  </div>
  <div class="tech3">${HT_TECH.map(([a, b, bt, e, t]) => `<article><b>${a}</b><h3>${b}</h3><p class="t3te">${te(bt)}</p><p>${e}</p>${te(t)}</article>`).join("")}</div>
  <ol class="tl">${HT_TIME.map(([w, e, t]) => `<li><b>${w}</b><span>${e}</span>${te(t)}</li>`).join("")}</ol>
  ${HT_PACKAGE ? `<div class="pkg"><div class="pkg-l"><span>Grand opening package · 6 Nov – 6 Dec 2026</span><b>₹59,999</b><i>all-inclusive</i></div>
    <div class="pkg-r"><p><b>Up to 3,000 grafts</b> — FUE surgery and medical expenses together. Grafts beyond 3,000 are ₹20 each, told before booking. Hair transplant consultation is free in these dates.</p>
    ${te("3,000 గ్రాఫ్ట్‌ల వరకు — సర్జరీ, మెడికల్ ఖర్చులు అన్నీ కలిపి. 3,000 కు మించి ప్రతి గ్రాఫ్ట్ ₹20, బుకింగ్‌కు ముందే చెబుతారు. ఈ తేదీల్లో హెయిర్ ట్రాన్స్‌ప్లాంట్ కన్సల్టేషన్ ఉచితం.")}</div></div>` : ""}
  ${foot(7)}
</section>`;

// ---------------------------------------------------------------- 10 · back cover
const PBACK = `<section class="pg bcover">
  <div class="bc-photo"><img src="${img("c_sofa.jpg")}" alt=""><div class="bc-fade"></div></div>
  <div class="bc-in"><h2>DermaLuxe <small>by</small> Medicare</h2><p class="bc-tag">Premium Skin &amp; Hair Clinic · Eluru</p>
  <p class="bc-te">${te("ప్రీమియం స్కిన్ &amp; హెయిర్ క్లినిక్ · ఏలూరు")}</p>
  <div class="bc-qrs"><div><div class="bc-qr">__QR2__</div><p>Clinic location<br>${te("క్లినిక్ లొకేషన్")}</p></div><div><div class="bc-qr">__WA2__</div><p>WhatsApp<br>${te("WhatsApp చేయండి")}</p></div></div>
  <p class="bc-ph">+91 ${B.wa} <small>· Call &amp; WhatsApp</small></p>
  <p class="bc-addr">Rama Mahal, Door No. 3-12, Ground Floor, R.R. Peta, Kasturi Vari Street, Opposite Happy Mobiles, Eluru – 534002 · www.dermaluxe.ai</p>
  <p class="bc-h">Mon–Sat, 9 AM – 9 PM · Sunday closed · ${te("సోమ–శని ఉదయం 9 – రాత్రి 9 · ఆదివారం సెలవు")}</p></div>
</section>`;

// The clinic's own machines, photographed in the clinic by the owner on
// 12 Nov and cut out of their backgrounds with Apple Vision on this Mac
// (print/cutout.swift) — a mask, not a redrawing, so each machine is exactly
// as it stands in the room. Where Vision kept a piece of wall or floor
// touching a machine (the hair-regrowth head, under the diode laser) it was
// erased by hand on the mask. Names: from the machine's own label where it
// has one (Q-Beam, Laser Hair Regrowth); the rest by type, for the owner to
// confirm.
const MACH = [
  ["mach-hydrafacial.png", "HydraFacial", "హైడ్రాఫేషియల్", "Cleansing, exfoliation, hydration", "క్లెన్సింగ్, ఎక్స్‌ఫోలియేషన్, హైడ్రేషన్"],
  ["mach-diode.png", "Diode laser", "డయోడ్ లేజర్", "Laser hair reduction", "లేజర్‌తో రోమాల తగ్గింపు"],
  ["mach-qbeam.png", "Q-Beam laser", "Q-Beam లేజర్", "Pigmentation and tattoo removal", "పిగ్మెంటేషన్, టాటూ తొలగింపు"],
  ["mach-co2.png", "Fractional CO₂ laser", "ఫ్రాక్షనల్ CO₂ లేజర్", "Acne scars and skin resurfacing", "మొటిమల మచ్చలు, చర్మ రీసర్ఫేసింగ్"],
  ["mach-hifu.png", "HIFU", "హై-ఇంటెన్సిటీ ఫోకస్డ్ అల్ట్రాసౌండ్", "Skin tightening without incision", "కోత లేకుండా చర్మం బిగుతు"],
  ["mach-lllt.png", "Laser hair regrowth", "లేజర్ హెయిర్ రీగ్రోత్", "Low-level laser therapy for hair", "జుట్టు కోసం లో-లెవల్ లేజర్ థెరపీ"],
];
const pngImg = (f) => "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "catalog", "img", f)).toString("base64");
const P7 = `<section class="pg">
  ${top("Inside the clinic", "క్లినిక్ లోపల")}
  ${h1("Our machines", "మా మెషీన్లు", 7)}
  <p class="lead narrow">Each machine was photographed where it stands in the clinic in Eluru; only the background has been removed.<br>${te("ప్రతి మెషీన్ ఏలూరు క్లినిక్‌లో ఉన్నచోటే ఫోటో తీసింది; బ్యాక్‌గ్రౌండ్ మాత్రమే తీసేశాం.")}</p>
  <div class="machines">${MACH.map(([f, n, nte, w, wte]) => `<figure class="mc"><div class="stage"><img src="${pngImg(f)}" alt=""></div>
    <figcaption><h3>${n}</h3><p class="mte">${te(nte)}</p><p>${w}</p>${te(wte)}</figcaption></figure>`).join("")}</div>
  ${foot(8)}
</section>`;

// ---------------------------------------------------------------- 8 · how to refer
const STEPS = [
  ["Write the referral", "Use the DermaLuxe referral pad, or your own prescription: the patient's name, mobile and the complaint.", "DermaLuxe రిఫరల్ ప్యాడ్ లేదా మీ ప్రిస్క్రిప్షన్ మీద — పేషెంట్ పేరు, మొబైల్, సమస్య రాయండి."],
  ["Send it, or hand it over", `WhatsApp a photo of the slip to ${B.wa}, or ask the patient to bring it. We call the patient to fix a time.`, `స్లిప్ ఫోటో ${B.wa} కి WhatsApp చేయండి, లేదా స్లిప్ పేషెంట్‌కు ఇచ్చి క్లినిక్‌కు తీసుకురమ్మని చెప్పండి. టైమ్ ఫిక్స్ చేయడానికి మేమే పేషెంట్‌కు కాల్ చేస్తాం.`],
  ["We see the patient", "An MD (DVL) dermatologist examines the patient, explains the diagnosis and gives a written prescription and plan.", "MD (DVL) డెర్మటాలజిస్ట్ పేషెంట్‌ను పరీక్షించి, సమస్య ఏమిటో వివరించి, రాతపూర్వక ప్రిస్క్రిప్షన్ &amp; ప్లాన్ ఇస్తారు."],
];
const P8 = `<section class="pg back">
  ${top("How to refer", "ఎలా రిఫర్ చేయాలి")}
  ${h1("Referring a patient takes a minute", "పేషెంట్‌ను రిఫర్ చేయడం ఒక్క నిమిషం పని", 8)}
  <div class="refer">
    <ol class="three">${STEPS.map(([h, e, t], i) => `<li><b>${i + 1}</b><div><h3>${h}</h3><p>${e}</p>${te(t)}</div></li>`).join("")}</ol>
    <figure class="pad"><img src="${img("refpad.jpg")}" alt=""><figcaption>The referral pad ${ai} · ${te("రిఫరల్ ప్యాడ్")}</figcaption></figure>
  </div>
  <div class="tell"><h3>What to tell your patient · ${te("మీ పేషెంట్‌కు ఇలా చెప్పండి")}</h3>
    <div class="chips">${[[I.rupee, "₹300 consultation with an MD (DVL) dermatologist", "₹300 కన్సల్టేషన్ — MD (DVL) డెర్మటాలజిస్ట్‌తో"], [I.clock, "Mon–Sat, 9 AM – 9 PM; we call them to fix the time", "సోమ–శని ఉదయం 9 – రాత్రి 9; టైమ్ కోసం మేమే కాల్ చేస్తాం"], [I.doc, "Bring current prescriptions and reports", "ఇప్పటి ప్రిస్క్రిప్షన్లు, రిపోర్టులు తీసుకురండి"], [I.video, "Video consultation if they cannot travel", "రాలేకపోతే వీడియో కన్సల్టేషన్"]].map(([ic, e, t]) => `<div>${svg(ic)}<span>${e}<br>${te(t)}</span></div>`).join("")}</div></div>
  <div class="contact">
    <div class="qrs"><div class="qr">__QR__<b>Clinic location</b><span>${te("క్లినిక్ లొకేషన్")}</span></div><div class="qr">__WA__<b>WhatsApp</b><span>${B.wa}</span></div></div>
    <div class="addr">
      <h2>DermaLuxe by Medicare</h2>
      <p>${B.addr}</p>
      <p>${te("రామ మహల్, డోర్ నం. 3-12, గ్రౌండ్ ఫ్లోర్, రామచంద్ర రావు పేట, కస్తూరి వారి వీధి, హ్యాపీ మొబైల్స్ ఎదురుగా, ఏలూరు – 534002")}</p>
      <dl><dt>Call &amp; WhatsApp</dt><dd>+91 ${B.wa}</dd><dt>Also</dt><dd>${B.call}</dd><dt>Hours</dt><dd>Mon–Sat, 9 AM – 9 PM · Sunday closed · ${te("ఆదివారం సెలవు")}</dd><dt>Web</dt><dd>www.dermaluxe.ai · ${B.email}</dd></dl>
    </div>
  </div>
  <div class="legal"><p>Treating doctors: ${Object.values(D).map((d) => `${d.name}, ${d.q || "MD (DVL)"}, Reg. No. ${d.reg}`).join(" · ")}. Hair Transplant Surgeon: Dr. Jaishree, MDS (OMFS). ${ai} marks AI-generated pictures, illustrations and icons — the condition pictures are the ones on the website, not patients of the clinic. The hair transplant before-and-after is a stock photograph from the website, not a patient of the clinic. Every other photograph is of the clinic, its machines and its doctors. DermaLuxeAI Private Limited · Part of Medicare Skin &amp; Hair Clinics.</p><p>${te(docs.regDisclosure("te") + ". హెయిర్ ట్రాన్స్‌ప్లాంట్ సర్జన్: డా. జైశ్రీ, MDS (OMFS). " + "✦ గుర్తు ఉన్నవి AI తో తయారు చేసిన ఫోటోలు, బొమ్మలు, ఐకాన్లు — వెబ్‌సైట్‌లో ఉన్నవే, క్లినిక్ పేషెంట్లు కాదు. హెయిర్ ట్రాన్స్‌ప్లాంట్ బిఫోర్-ఆఫ్టర్ ఫోటో వెబ్‌సైట్‌లోని స్టాక్ ఫోటో, మా పేషెంట్ కాదు. మిగతా ఫోటోలు అన్నీ క్లినిక్, మెషీన్లు, మా డాక్టర్లవి.")}</p></div>
  ${foot(9)}
</section>`;

// ---------------------------------------------------------------- styles
const CSS = `
@page { size: A4; margin: 0; }
:root { --gold-ink:#8a6220; --te-ink:#5a2e40; --plum:#4a2232; --mauve:#7b4a5c; --rose:#e9c9ce; --blush:#f8ecee; --cream:#fcf8f4; --gold:#b8893d; --gold2:#d8b56a; --ink:#2a1a20; --muted:#6d5560; --rule:#e3cfd3; }
html, body { margin:0; background:#fff; }
body { font-variant-numeric: lining-nums; font-family: Jost, "Noto Sans Telugu", Arial, sans-serif; color: var(--ink); font-size: 9.4pt; line-height: 1.38; -webkit-print-color-adjust: exact; }
.te { font-family: "Noto Sans Telugu", Jost, sans-serif; font-size: .93em; color: var(--te-ink); line-height: 1.5; }
.pg { width:210mm; height:297mm; box-sizing:border-box; padding: 11mm 14mm 0; position:relative; overflow:hidden; page-break-after: always; display:flex; flex-direction:column; background: var(--cream); }
.pg:last-child { page-break-after: auto; }
.top { display:flex; justify-content:space-between; align-items:center; padding-bottom: 3mm; border-bottom: 1px solid var(--rule); }
.mark { display:flex; align-items:center; gap: 2.4mm; }
.mark img { height: 7mm; background:#1a0f07; border-radius: 1.4mm; padding: .8mm 1.6mm; }
.mark b { font-family: "Cormorant Garamond", serif; font-size: 13pt; color: var(--plum); font-weight: 700; letter-spacing:.01em; }
.mark b small { font-family: Jost, sans-serif; font-size: 7.5pt; color: var(--gold); font-weight: 500; letter-spacing: .08em; }
.sec { font-size: 7.6pt; letter-spacing: .14em; text-transform: uppercase; color: var(--gold-ink); font-weight: 600; }
.sec .te { letter-spacing: 0; text-transform:none; color: var(--gold); font-weight: 500; font-size: 8.4pt; }
h1 { font-family: "Cormorant Garamond", serif; font-weight: 700; font-size: 27pt; line-height: 1.04; color: var(--plum); margin: 6mm 0 0; letter-spacing: -.005em; text-wrap: balance; }
.h1te { margin: 1.4mm 0 0; font-size: 13pt; }
.h1te .te { font-family: "Noto Serif Telugu", serif; color: var(--mauve); font-weight: 600; font-size: 1em; }
h2 { font-family: "Cormorant Garamond", serif; font-size: 16pt; color: var(--plum); margin: 0; }
h3 { font-size: 10pt; margin: 0; color: var(--plum); font-weight: 600; }
.lead { font-size: 10.2pt; line-height: 1.5; margin: 5mm 0 0; color: var(--ink); }
.leadte { margin: 2.4mm 0 0; }
.leadte .te { font-size: 9.6pt; }
.foot { margin-top:auto; display:flex; justify-content:space-between; border-top: 1px solid var(--rule); padding: 2.6mm 0 7mm; font-size: 7.2pt; color: var(--muted); }
.foot .te { color: var(--muted); font-size: 7.6pt; }
.ph { margin:0; position:relative; border-radius: 2.4mm; overflow:hidden; background: var(--rose); }
.ph img { width:100%; height:100%; object-fit: cover; display:block; }
.ph figcaption { position:absolute; left:0; right:0; bottom:0; padding: 6mm 3mm 2.2mm; color:#fff; font-size: 8.4pt; font-weight: 500; background: linear-gradient(transparent, rgba(40,15,25,.78)); line-height: 1.3; }
.ph figcaption .te { color: #f6dfe3; font-size: 8pt; }
.ai { font-style: normal; color: var(--gold); font-size: 9pt; }
figure.art { margin:0; position:relative; border-radius: 2.4mm; overflow:hidden; background:#fbf3ef; }
figure.art img { width:100%; display:block; }
figure.art > .ai { position:absolute; top: 2mm; right: 2.4mm; z-index:1; font-size: 11pt; }

/* cover */
.cover { padding:0; background: var(--plum); color:#fff; }
.cv-photo { position:relative; height: 196mm; flex: 0 0 auto; overflow:hidden; }
.cv-img { position:absolute; inset:0; width:100%; height:100%; object-fit: cover; object-position: 50% 66%; }
.cv-shade { position:absolute; inset:0; background: linear-gradient(180deg, rgba(40,14,24,.82) 0%, rgba(40,14,24,.45) 13%, rgba(40,14,24,0) 24%, rgba(40,14,24,0) 88%, rgba(74,34,50,1) 100%); }
.cv-top { position:relative; display:flex; align-items:center; gap: 3mm; padding: 11mm 14mm 0; }
.cv-top img { height: 13mm; background:#1a0f07; border-radius: 2mm; padding: 1.2mm 2.6mm; }
.cv-top b { display:block; font-family: "Cormorant Garamond", serif; font-size: 19pt; font-weight:700; }
.cv-top b small { font-family: Jost, sans-serif; font-size: 10pt; color: var(--gold2); font-weight: 500; letter-spacing: .08em; }
.cv-top span { display:block; font-size: 7.6pt; letter-spacing: .16em; text-transform: uppercase; color: var(--gold2); font-weight: 600; margin-top: .6mm; }
.cv-body { position:relative; padding: 4mm 14mm 0; }
.eyebrow { font-size: 9pt; letter-spacing: .16em; text-transform: uppercase; color: var(--gold2); font-weight: 600; margin: 0; }
.eyebrow .te { letter-spacing: 0; text-transform:none; color: var(--gold2); font-size: 9.6pt; }
.cv-title { font-family: "Cormorant Garamond", serif; font-size: 44pt; line-height: .98; margin: 3mm 0 0; font-weight: 700; color:#fff; }
.cv-te { margin: 2mm 0 0; }
.cv-te .te { font-family: "Noto Serif Telugu", serif; font-size: 17pt; color: #f3d7dc; font-weight: 600; }
.cv-sub { margin: 3.4mm 0 0; font-size: 10pt; line-height: 1.45; color: #f4e6e9; border-top: 1px solid rgba(216,181,106,.6); padding-top: 3mm; }
.cv-sub .te { color: #ecccd2; font-size: 9.4pt; }
.cv-strip { position:relative; display:flex; justify-content:space-between; gap: 4mm; margin: auto 14mm 10mm; padding: 3.4mm 5mm; border: 1px solid rgba(216,181,106,.7); border-radius: 100px; font-size: 8.6pt; color: #fbeec8; letter-spacing: .02em; }

/* about */
.two { display:grid; grid-template-columns: 1.15fr 1fr; gap: 8mm; align-items:start; }
.gets { list-style:none; margin: 5mm 0 0; padding: 0; display:flex; flex-direction:column; gap: 2.6mm; }
.gets li { padding-left: 5mm; position:relative; font-size: 9.4pt; font-weight: 500; }
.gets li::before { content:""; position:absolute; left:0; top: 1.6mm; width: 2.2mm; height: 2.2mm; border-radius: 50%; background: var(--gold); }
.gets .te { font-weight: 400; }
.facts { display:grid; grid-template-columns: repeat(4, 1fr); margin: 7mm 0 6mm; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.facts div { padding: 4mm 3mm; border-left: 1px solid var(--rule); }
.facts div:first-child { border-left: 0; padding-left: 0; }
.facts b { display:block; font-family: "Cormorant Garamond", serif; font-size: 25pt; color: var(--plum); line-height: 1; }
.facts span { display:block; font-size: 8.6pt; font-weight: 600; margin-top: 1.6mm; }
.facts .te { display:block; font-size: 8pt; margin-top: .6mm; }
.row3 { display:grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; flex: 1 1 auto; min-height: 0; margin-bottom: 5mm; }

/* doctors */
.team { display:grid; grid-template-columns: 1fr; gap: 3.6mm; margin-top: 5mm; }
.doc { background:#fff; border: 1px solid var(--rule); border-radius: 3mm; overflow:hidden; display:flex; flex-direction:column; }
.doc { display:grid; grid-template-columns: 32mm 72mm 1fr; gap: 5mm; align-items:center; padding: 3.4mm; }
.doc > img { width: 32mm; height: 40mm; object-fit: cover; display:block; border-radius: 2.4mm; background: var(--blush); }
.doc .who { align-self: center; }
.doc h3 { font-family: "Cormorant Garamond", serif; font-size: 17pt; line-height: 1.05; }
.doc .nte { margin: .6mm 0 0; } .doc .nte .te { font-size: 9.4pt; font-weight: 600; }
.doc .q { margin: 2mm 0 0; font-size: 8.8pt; font-weight: 600; color: var(--gold-ink); letter-spacing: .02em; }
.doc .qte { margin: .2mm 0 0; } .doc .qte .te { font-size: 8.2pt; }
.doc ul { margin: 0; padding: 0 0 0 4mm; border-left: 1px solid var(--rule); padding-left: 8mm; font-size: 8.8pt; color: var(--ink); display:flex; flex-direction:column; gap: 2.4mm; align-self: center; }
.doc li .te { font-size: 8.2pt; }
.doc .reg { margin: 2mm 0 0; font-size: 8.4pt; color: var(--plum); font-weight: 600; letter-spacing: .03em; }
.note { font-size: 8.2pt; color: var(--muted); margin: 5mm 0 4mm; line-height: 1.45; }
.note .te { font-size: 8pt; color: var(--muted); }

/* medical */
.md { display:grid; grid-template-columns: 1fr 1fr; gap: 7mm; margin-top: 6mm; flex: 1 1 auto; }
.cond { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.cond li { padding: 2.3mm 0 2.3mm 5mm; border-bottom: 1px solid var(--rule); position:relative; font-weight: 500; font-size: 9.2pt; line-height: 1.3; }
.cond li::before { content:""; position:absolute; left: 0; top: 3.6mm; width: 2.2mm; height: 2.2mm; border-radius: 50%; background: var(--gold); }
.cond .te { font-weight: 400; font-size: 8.4pt; }
.md-side { display:flex; flex-direction:column; gap: 5mm; }
.when { background: var(--plum); color:#fff; border-radius: 3mm; padding: 4.6mm 5.4mm; flex: 1 1 auto; }
.when h2 { color:#fff; font-size: 17pt; }
.wte { margin: 0 0 2.4mm; } .wte .te { color: var(--gold2); font-weight: 600; }
.when ul { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap: 2.2mm; }
.when li { font-size: 9.4pt; line-height: 1.32; padding-left: 4.4mm; position:relative; }
.when li::before { content:"›"; position:absolute; left:0; color: var(--gold2); font-weight:700; }
.when .te { color: #efd2d8; font-size: 8.8pt; }

/* condition pictures */
.mosaic { display:grid; grid-template-columns: 1fr 1fr; gap: 2.4mm; }
.mosaic figure { margin:0; position:relative; border-radius: 2mm; overflow:hidden; }
.mosaic img { width:100%; height: 22mm; object-fit: cover; display:block; }
.mosaic .ai { position:absolute; top: 1mm; right: 1.4mm; color:#fff; font-size: 8pt; text-shadow: 0 0 2px rgba(0,0,0,.6); }
.mosaic figcaption { position:absolute; left:0; right:0; bottom:0; padding: 3mm 2mm 1.2mm; font-size: 7.4pt; color:#fff; font-weight: 600; background: linear-gradient(transparent, rgba(40,15,25,.75)); }
.mosaic figcaption .te { color:#f6dfe3; font-size: 7.6pt; font-weight: 500; }

/* chapter numbers, icons */
.chap { margin: 4mm 0 -4mm; display:flex; align-items:center; gap: 3mm; font-family: "Cormorant Garamond", serif; font-weight: 600; font-size: 14pt; color: var(--gold-ink); letter-spacing: .08em; }
.chap i { display:block; width: 12mm; border-top: .4mm solid var(--gold); }
.ico { width: 5mm; height: 5mm; flex: 0 0 auto; }
/* cover: inside */
.cv-body { display:grid; grid-template-columns: 1fr 56mm; gap: 6mm; align-items:end; }
.cv-in { border-left: 1px solid rgba(216,181,106,.5); padding-left: 5mm; }
.cv-in > p { margin: 0 0 2mm; font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: var(--gold2); font-weight: 600; }
.cv-in > p .te { letter-spacing: 0; text-transform: none; color: var(--gold2); }
.cv-in ol { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap: 1.8mm; }
.cv-in li { display:flex; gap: 2.6mm; align-items:baseline; font-size: 8.8pt; color: #fbeec8; line-height: 1.25; }
.cv-in li b { font-family: "Cormorant Garamond", serif; font-size: 13pt; color: var(--gold2); min-width: 7mm; }
.cv-in li .te { color: #ecccd2; font-size: 7.8pt; }
/* page 4 call */
.when { display:flex; flex-direction:column; }
.when-call { margin-top: auto; padding-top: 3.4mm; border-top: .4mm solid rgba(216,181,106,.6); display:flex; gap: 3mm; align-items:center; color: var(--gold2); }
.when-call .ico { width: 7mm; height: 7mm; }
.when-call span { display:block; font-size: 8.6pt; font-weight: 600; } .when-call span .te { color: var(--gold2); }
.when-call b { display:block; font-family: "Cormorant Garamond", serif; font-size: 22pt; color:#fff; line-height: 1; margin-top: .6mm; }
/* page 5 dermatosurgery */
.dsurg { margin-top: 3mm; background: var(--blush); border-radius: 2.4mm; padding: 2.8mm 3.6mm; }
.dsurg h3 { display:flex; align-items:center; gap: 2mm; font-size: 9.6pt; color: var(--plum); } .dsurg h3 .te { font-weight: 600; }
.pills { display:flex; flex-wrap:wrap; gap: 1.8mm; margin-top: 2.4mm; }
.pills > span { border: 1px solid var(--gold); border-radius: 100px; padding: 1mm 3mm; background:#fff; font-size: 8pt; color: var(--plum); }
.pills .te { font-size: 7.8pt; }
/* page 6 checklist */
.hair-l { display:flex; flex-direction:column; gap: 4mm; }
.send { background: var(--blush); border: 1px solid var(--rule); border-radius: 2.4mm; padding: 3.6mm 4mm; }
.send h3 { font-size: 10pt; } .sendte { margin: .2mm 0 2mm; } .sendte .te { font-weight: 600; font-size: 8.6pt; }
.send ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap: 2mm; }
.send li { display:flex; gap: 2mm; font-size: 8.4pt; line-height: 1.32; } .send li .ico { color: var(--gold); width: 4.4mm; height: 4.4mm; margin-top: .4mm; } .send li .te { font-size: 7.9pt; }
/* page 9 tell */
.tell { margin-top: 4mm; }
.tell h3 { font-size: 10pt; color: var(--plum); } .tell h3 .te { font-weight: 600; }
.chips { display:grid; grid-template-columns: 1fr 1fr; gap: 2.4mm 4mm; margin-top: 2.4mm; }
.chips > div { display:flex; gap: 2.4mm; align-items:flex-start; background:#fff; border: 1px solid var(--rule); border-radius: 2mm; padding: 1.8mm 3mm; font-size: 8.4pt; line-height: 1.32; }
.chips .ico { color: var(--plum); margin-top: .3mm; } .chips .te { font-size: 7.9pt; }
/* back cover */
.bc-photo { position:relative; height: 120mm; flex: 0 0 auto; overflow:hidden; }
.bc-photo img { width:100%; height:100%; object-fit: cover; object-position: 50% 47%; display:block; }
.bc-fade { position:absolute; inset:0; background: linear-gradient(transparent 55%, var(--plum) 100%); }
.bcover::after { content:""; position:absolute; inset: 8mm; border: .4mm solid var(--gold2); border-radius: 2mm; pointer-events:none; }
.bc-qrs { display:flex; gap: 10mm; margin-top: 8mm; }
.bc-qrs p { margin: 2mm 0 0; font-size: 8.4pt; color: #f4e6e9; } .bc-qrs p .te { color: #f3d7dc; }

/* hair transplant */
.ht { display:grid; grid-template-columns: 64mm 1fr; gap: 6mm; margin-top: 4mm; align-items:start; }
.ba { margin:0; } .ba img { width:100%; display:block; border-radius: 2.4mm; }
.ba figcaption { margin-top: 1.6mm; font-size: 7pt; color: var(--muted); line-height: 1.35; } .ba figcaption .te { font-size: 7.6pt; color: var(--muted); }
.ht-txt .lead { margin-top: 0; font-size: 9.6pt; }
.ht-txt .leadte .te { font-size: 9pt; }
.ht-pts { margin-top: 3.4mm; gap: 2mm; } .ht-pts li { font-size: 8.8pt; font-weight: 500; } .ht-pts .te { font-size: 8.2pt; }
.tech3 { display:grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-top: 4mm; }
.tech3 article { background:#fff; border: 1px solid var(--rule); border-top: 1.2mm solid var(--gold); border-radius: 2mm; padding: 3mm 3.4mm; }
.tech3 b { font-family: "Cormorant Garamond", serif; font-size: 17pt; color: var(--plum); line-height: 1; }
.tech3 h3 { font-size: 8.6pt; color: var(--gold); margin-top: .6mm; } .tech3 .t3te { margin: 0; } .tech3 .t3te .te { font-size: 7.8pt; font-weight: 600; }
.tech3 p { margin: 1.2mm 0 .4mm; font-size: 8.4pt; } .tech3 article > .te { font-size: 7.8pt; display:block; }
.tl { list-style:none; margin: 4mm 0 0; padding: 0; display:grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; position:relative; }
.tl::before { content:""; position:absolute; left: 2mm; right: 2mm; top: 2.6mm; border-top: 1.2px dashed var(--gold); }
.tl li { position:relative; padding-top: 6.4mm; font-size: 8.2pt; }
.tl li::before { content:""; position:absolute; left: 0; top: 1.2mm; width: 3mm; height: 3mm; border-radius: 50%; background: var(--plum); border: 1px solid var(--gold); }
.tl b { display:block; font-size: 10pt; color: var(--plum); } .tl span { display:block; margin: .6mm 0 .4mm; } .tl .te { font-size: 7.8pt; display:block; }
.pkg { display:grid; grid-template-columns: 52mm 1fr; gap: 5mm; margin: auto 0 4mm; background: var(--plum); color:#fff; border-radius: 3mm; padding: 4.4mm 5mm; align-items:center; }
.pkg-l span { display:block; font-size: 7.6pt; letter-spacing: .08em; text-transform: uppercase; color: var(--gold2); font-weight: 600; }
.pkg-l b { display:block; font-family: "Cormorant Garamond", serif; font-size: 30pt; line-height: 1; margin-top: 1mm; }
.pkg-l i { font-style: normal; font-size: 8.4pt; color: #f3d7dc; }
.pkg-r p { margin: 0 0 1.2mm; font-size: 8.8pt; line-height: 1.4; } .pkg-r .te { color: #efd2d8; font-size: 8.2pt; }

/* back cover */
.bcover { background: var(--plum); color:#fff; text-align:center; padding: 0; }
.bc-in { display:flex; flex-direction:column; align-items:center; margin-top: -10mm; position:relative; }
.bc-in > img { height: 22mm; background:#1a0f07; border-radius: 3mm; padding: 2mm 4mm; }
.bc-in h2 { color:#fff; font-size: 30pt; margin-top: 7mm; } .bc-in h2 small { font-family: Jost, sans-serif; font-size: 13pt; color: var(--gold2); font-weight: 500; }
.bc-tag { margin: 2mm 0 0; font-size: 9pt; letter-spacing: .18em; text-transform: uppercase; color: var(--gold2); font-weight: 600; }
.bc-te { margin: 1.4mm 0 0; } .bc-te .te { color: #f3d7dc; font-size: 10pt; }
.bc-qr { background:#fff; padding: 2.6mm; border-radius: 2.4mm; } .bc-qr svg { width: 30mm; height: 30mm; display:block; }
.bc-scan { margin: 2.4mm 0 0; font-size: 8.4pt; color: #f4e6e9; } .bc-scan .te { color: #f3d7dc; }
.bc-addr { margin: 3mm 0 0; font-size: 8.6pt; color: #f4e6e9; max-width: 140mm; }
.bc-ph { margin: 7mm 0 0; font-size: 14pt; color: #fbeec8; letter-spacing: .02em; }
.bc-h { margin: 1.4mm 0 0; font-size: 8.6pt; color: #f4e6e9; } .bc-h .te { color: #f3d7dc; }

/* procedures */
.p5head { display:grid; grid-template-columns: 1fr 58mm; gap: 6mm; align-items:end; }
.p5head .lead { font-size: 9.4pt; margin-top: 3.4mm; }
.p5head .leadte .te { font-size: 8.8pt; }
.art.small img { height: 44mm; object-fit: cover; }
.p5lead { font-size: 9.2pt; margin-top: 3mm; } .p5lead .te { font-size: 8.6pt; }
.tx { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 2.6mm; margin-top: 4mm; }
.tx article { flex-direction: column; padding: 0 !important; gap: 0 !important; overflow:hidden; }
.tx .pic { position:relative; height: 18mm; align-self: stretch; }
.tx .pic > img:not(.ic) { width:100%; height:100%; object-fit: cover; display:block; border-radius: 0; }
.tx .pic .ai { position:absolute; top: 1mm; right: 1.4mm; color:#fff; font-size: 8pt; text-shadow: 0 0 2px rgba(0,0,0,.6); }
.tx .pic .ic { position:absolute; left: 2mm; bottom: -5mm; width: 10mm !important; height: 10mm !important; border-radius: 2mm; border: 1px solid #fff; box-shadow: 0 .6mm 1.6mm rgba(0,0,0,.18); background:#fff; }
.tx .txt { padding: 5.6mm 2.4mm 2.4mm; }
.tx .txt p { font-size: 8.1pt !important; } .tx .txt .te { font-size: 7.6pt !important; }
.tx article { display:flex; gap: 2.4mm; align-items:flex-start; background:#fff; border: 1px solid var(--rule); border-top: 1.2mm solid var(--gold) !important; border-top: 1.4mm solid var(--h); border-radius: 2mm; padding: 3.6mm 3.2mm 4mm; min-width:0; }
.tx img { width: 13mm; height: 13mm; border-radius: 2mm; flex: 0 0 auto; }
.tx h3 { font-size: 10pt; color: var(--plum); }
.tx p { margin: 1mm 0 .8mm; font-size: 8.6pt; line-height: 1.3; color: var(--ink); }
.tx .te { font-size: 8pt; line-height: 1.42; display:block; }
.also { margin: 4mm 0 0; font-size: 8.8pt; line-height: 1.45; }
.also .te { font-size: 8.2pt; }
.ainote { margin: 2mm 0 2mm; font-size: 7.4pt; color: var(--muted); }
.ainote .te { font-size: 7.6pt; color: var(--muted); }

/* hair */
.hair { display:grid; grid-template-columns: 78mm 1fr; gap: 6mm; margin-top: 6mm; align-items:start; }
.steps { margin:0; padding:0; list-style:none; counter-reset: s; display:flex; flex-direction:column; gap: 2.8mm; }
.steps li { counter-increment: s; padding-left: 8mm; position:relative; }
.steps li:not(:last-child)::after { content:""; position:absolute; left: 2.7mm; top: 5.4mm; bottom: -2.8mm; border-left: 1.2px dashed var(--gold); }
.steps li::before { content: counter(s); position:absolute; left:0; top:0; width: 5.4mm; height: 5.4mm; border-radius: 50%; background: var(--plum); color:#fff; font-size: 7.6pt; font-weight:600; display:flex; align-items:center; justify-content:center; }
.steps .hte { margin: .2mm 0 0; } .steps .hte .te { font-weight: 600; font-size: 8.4pt; }
.steps p { margin: .6mm 0 .4mm; font-size: 8.6pt; line-height: 1.35; }
.steps .te { font-size: 8pt; display:block; }
.row2 { display:grid; grid-template-columns: 1fr 1fr; gap: 3mm; flex: 1 1 auto; min-height: 0; margin-top: 6mm; }

/* facility */
.lead.narrow { font-size: 9.6pt; margin-top: 4mm; }
.lead.narrow .te { font-size: 9pt; }
.machines { display:grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: 1fr 1fr; gap: 4mm; flex: 1 1 auto; min-height: 0; margin: 5mm 0 5mm; }
.mc { margin:0; display:flex; flex-direction:column; background:#fff; border: 1px solid var(--rule); border-radius: 3mm; overflow:hidden; min-height: 0; }
.mc .stage { flex: 1 1 auto; min-height: 0; display:flex; align-items:flex-end; justify-content:center; padding: 4mm 3mm 3mm; background: radial-gradient(ellipse 70% 14% at 50% 94%, rgba(74,34,50,.16), transparent 70%), radial-gradient(circle at 50% 38%, #fff 0%, #f8ecee 70%, #f1dfe3 100%); }
.mc .stage img { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 1.4mm 1.6mm rgba(60,25,40,.22)); }
.mc figcaption { padding: 2.6mm 3.4mm 3mm; border-top: 1px solid var(--rule); height: 25mm; box-sizing: border-box; flex: 0 0 auto; }
.mc h3 { font-size: 10.4pt; }
.mc .mte { margin: .2mm 0 0; } .mc .mte .te { font-weight: 600; font-size: 8.6pt; }
.mc figcaption > p:not(.mte) { margin: 1mm 0 .2mm; font-size: 8.4pt; color: var(--ink); }
.mc figcaption > .te { font-size: 7.9pt; display:block; }
.mach { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm; height: 86mm; margin-top: 5mm; }
.tech { display:flex; flex-wrap:wrap; gap: 1.6mm 2mm; align-items:center; margin: 4.4mm 0 0; font-size: 8.4pt; }
.tech b { width: 100%; color: var(--plum); font-size: 9.6pt; margin-bottom: .6mm; }
.tech > span { border: 1px solid var(--gold); color: var(--plum); border-radius: 100px; padding: 1mm 3mm; background:#fff; }
.rooms { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm; flex: 1 1 auto; min-height: 0; margin: 4.4mm 0 5mm; }
.grid6 { display:grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 3mm; flex: 1 1 auto; min-height: 0; margin: 6mm 0 5mm; }
.grid6 .tall { grid-row: span 2; }
.grid6 .tall img { object-position: 40% 70%; }

/* back */
.refer { display:grid; grid-template-columns: 1fr 52mm; gap: 7mm; margin-top: 5mm; align-items:start; }
.three { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap: 3.6mm; }
.three li { display:flex; gap: 3.6mm; }
.three li > b { flex: 0 0 auto; width: 10mm; height: 10mm; border-radius: 50%; background: var(--plum); border: 1px solid var(--gold); box-sizing: border-box; color:#fff; font-family: "Cormorant Garamond", serif; font-size: 16pt; display:flex; align-items:center; justify-content:center; }
.three h3 { font-size: 11.4pt; }
.three p { margin: .8mm 0 .6mm; font-size: 9pt; line-height: 1.4; }
.three .te { font-size: 8.4pt; display:block; }
.pad { margin:0; }
.pad img { width: 100%; display:block; border-radius: 1.6mm; box-shadow: 0 1.6mm 4mm rgba(74,34,50,.18); transform: rotate(2deg); }
.pad figcaption { margin-top: 3mm; text-align:center; font-size: 8pt; color: var(--muted); }
.contact { display:grid; grid-template-columns: auto 1fr; gap: 6mm; margin-top: 4mm; padding: 4.4mm 5mm; background: var(--plum); color:#fff; border-radius: 3mm; align-items:center; }
.qrs { display:flex; gap: 5mm; }
.qr { background:#fff; color: var(--plum); border-radius: 2mm; padding: 2.2mm; text-align:center; width: 23mm; }
.qr svg { width: 23mm; height: 23mm; display:block; }
.qr b { display:block; margin-top: 1.6mm; font-size: 8pt; }
.qr span, .qr .te { font-size: 7.4pt; color: var(--mauve); }
.addr h2 { color:#fff; font-size: 17pt; }
.addr p { margin: 1mm 0 0; font-size: 8.2pt; line-height: 1.35; color: #f4e6e9; }
.addr .te { color:#efd2d8; font-size: 8pt; }
.addr dl { display:grid; grid-template-columns: auto 1fr; gap: .6mm 3mm; margin: 2mm 0 0; font-size: 8.4pt; }
.addr dt { color: var(--gold2); font-weight: 600; }
.addr dd { margin:0; } .addr dd .te { color: #efd2d8; }
.back .foot { margin-top: auto; }
.legal { margin: 3mm 0 3mm; display:grid; grid-template-columns: 1fr 1fr; column-gap: 6mm; border-top: .4mm solid var(--rule); padding-top: 2mm; font-size: 6.9pt; line-height: 1.38; color: var(--muted); }
.legal p { margin:0; } .legal .te { font-size: 7.1pt; color: var(--muted); line-height: 1.42; }
`;

const PAGES = [P1, P2, P3, P4, P5, P6, PHT, P7, P8, PBACK];
const html0 = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Jost:wght@400;500;600;700&family=Noto+Sans+Telugu:wght@400;500;600&family=Noto+Serif+Telugu:wght@600&display=block" rel="stylesheet">
<style>${CSS}</style></head><body>${PAGES.join("")}</body></html>`;

(async () => {
  const qrSvg = (u) => QR.toString(u, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#4a2232", light: "#ffffff" } });
  const html = html0.replace("__QR__", await qrSvg(MAPS)).replace("__WA__", await qrSvg(WA)).replace("__QR2__", await qrSvg(MAPS)).replace("__WA2__", await qrSvg(WA));
  const out = path.join(__dirname, "doctor-catalog.pdf"), shots = path.join(__dirname, "catalog");
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
  await pg.setContent(html, { waitUntil: "networkidle0", timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  // Every page must fit its sheet: nothing past the bottom, nothing past the
  // right edge, and no Telugu falling back to a face that is not Telugu.
  const bad = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".pg").forEach((p, i) => {
      const r = p.getBoundingClientRect();
      if (p.scrollHeight > p.clientHeight + 1) out.push(`page ${i + 1} runs ${p.scrollHeight - p.clientHeight}px long`);
      p.querySelectorAll("*").forEach((el) => { const b = el.getBoundingClientRect(); if (b.width && (b.right > r.right + 1 || b.bottom > r.bottom + 1) && !el.closest(".cover") && !el.closest(".bcover")) out.push(`page ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> past the edge`); });
      const f = p.querySelector(".foot"); if (f && f.getBoundingClientRect().bottom > r.bottom + 1) out.push(`page ${i + 1}: footer off the sheet`);
    });
    const fams = ["Noto Sans Telugu", "Noto Serif Telugu", "Cormorant Garamond", "Jost"];
    fams.forEach((f) => { if (!document.fonts.check(`12px "${f}"`)) out.push(`font not loaded: ${f}`); });
    return out.slice(0, 12);
  });
  const sections = await pg.$$(".pg");
  for (let i = 0; i < sections.length; i++) await sections[i].screenshot({ path: path.join(shots, `page-${i + 1}.png`) });
  await pg.emulateMediaType("print");
  await pg.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  const pdf = fs.readFileSync(out).toString("latin1");
  const n = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (n !== PAGES.length) bad.push(`PDF has ${n} pages, not ${PAGES.length}`);
  if (!/\/MediaBox\s*\[\s*0\s+0\s+59[45](\.\d+)?\s+84[12](\.\d+)?\s*\]/.test(pdf)) bad.push("paper is not A4");
  console.log(path.basename(out), Math.round(fs.statSync(out).size / 1024) + " KB", bad.length ? "⚠ " + bad.join("; ") : `${PAGES.length} pages A4, all fit`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
