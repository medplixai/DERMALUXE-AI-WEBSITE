// The clinic's file library, for the staff app's Files tab. Re-run after
// regenerating anything:
//   node tools/files-sync.js      →  files/<group>/…  +  files/manifest.json
//
// Owner, 9 Nov 2026: "docs anni staff app lo oka folder petti" — every form,
// poster, video and photo the clinic hands out or posts, in one place, so
// anybody on the team can download it when they need it, without asking.
//
// print/ is the workshop and is never served (.vercelignore). This copies
// the finished pieces from print/ and assets/ into files/, which is served
// as plain static files, and writes the manifest the Files tab reads through
// api/files.js. Nothing private goes here: no patient paper, no study
// material (that stays behind /api/material), nothing with a name in it
// that is not already on the website.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "files");

// [source path, published name, title, Telugu line]
const GROUPS = [
  { key: "forms", title: "Forms & handouts", te: "ఫారాలు", items: [
    ["print/ht-consent-form.pdf", "ht-consent-form.pdf", "Hair transplant consent booklet — 10 pages", "హెయిర్ ట్రాన్స్‌ప్లాంట్ కన్సెంట్ బుక్‌లెట్"],
    ["print/ht-consultation-form.pdf", "ht-consultation-form.pdf", "Consultation form + treatment plan & cost (clinic & patient copy)", "కన్సల్టేషన్ ఫారం"],
    ["print/ht-pre-surgery.pdf", "ht-pre-surgery.pdf", "Pre-surgery protocol — patient handout", "సర్జరీకి ముందు సూచనలు"],
    ["print/ht-post-surgery.pdf", "ht-post-surgery.pdf", "Post-surgery discharge instructions — patient handout", "సర్జరీ తర్వాత సూచనలు"],
    ["print/ht-pre-surgery-te.pdf", "ht-pre-surgery-te.pdf", "Pre-surgery protocol — patient handout (Telugu)", "సర్జరీకి ముందు సూచనలు — తెలుగు"],
    ["print/ht-post-surgery-te.pdf", "ht-post-surgery-te.pdf", "Post-surgery discharge instructions — patient handout (Telugu)", "సర్జరీ తర్వాత సూచనలు — తెలుగు"],
    ["print/rx-qr-label.pdf", "rx-qr-label.pdf", "Prescription pad QR label (print sheet)", "ప్రిస్క్రిప్షన్ QR లేబుల్"],
    ["assets/academy/DermaLuxe-Academy-Course-Catalog.pdf", "academy-course-catalog.pdf", "Academy course catalogue", "అకాడమీ కోర్సు కేటలాగ్"],
  ] },
  { key: "posters", title: "Posters & print", te: "పోస్టర్లు", items: [
    ["print/ht-offer-feed.png", "ht-offer-feed-en.png", "Hair transplant package — Instagram feed (English)", "HT ప్యాకేజీ పోస్టర్ — ఇంగ్లీష్"],
    ["print/ht-offer-status.png", "ht-offer-status-en.png", "Hair transplant package — WhatsApp status / story (English)", "HT ప్యాకేజీ స్టేటస్ — ఇంగ్లీష్"],
    ["print/ht-offer-feed-te.png", "ht-offer-feed-te.png", "Hair transplant package — Instagram feed (Telugu)", "HT ప్యాకేజీ పోస్టర్ — తెలుగు"],
    ["print/ht-offer-status-te.png", "ht-offer-status-te.png", "Hair transplant package — WhatsApp status / story (Telugu)", "HT ప్యాకేజీ స్టేటస్ — తెలుగు"],
    ["print/invite-poster.png", "opening-invite-poster.png", "Grand opening invitation poster", "ఓపెనింగ్ ఆహ్వాన పోస్టర్"],
    ["print/invite-poster.pdf", "opening-invite-poster.pdf", "Grand opening invitation poster — print PDF", "ఓపెనింగ్ ఆహ్వాన పోస్టర్ (ప్రింట్)"],
    ["print/invite-front.png", "opening-invite-card-front.png", "Invitation card — front", "ఆహ్వాన కార్డు — ముందు"],
    ["print/invite-back.png", "opening-invite-card-back.png", "Invitation card — back", "ఆహ్వాన కార్డు — వెనుక"],
    ["print/invite-opening.pdf", "opening-invite-card.pdf", "Invitation card — print PDF", "ఆహ్వాన కార్డు (ప్రింట్)"],
    ["print/team-poster.png", "team-poster.png", "Team poster", "టీమ్ పోస్టర్"],
    ["print/team-poster.pdf", "team-poster.pdf", "Team poster — print PDF", "టీమ్ పోస్టర్ (ప్రింట్)"],
    ["print/welcome-board.jpg", "welcome-board.jpg", "Welcome board", "వెల్‌కమ్ బోర్డు"],
    ["print/welcome-board.pdf", "welcome-board.pdf", "Welcome board — print PDF", "వెల్‌కమ్ బోర్డు (ప్రింట్)"],
    ["print/stage-backdrop.jpg", "stage-backdrop.jpg", "Stage backdrop", "స్టేజ్ బ్యాక్‌డ్రాప్"],
    ["print/stage-backdrop.pdf", "stage-backdrop.pdf", "Stage backdrop — print PDF", "స్టేజ్ బ్యాక్‌డ్రాప్ (ప్రింట్)"],
    ["assets/academy/batch1-poster.jpg", "academy-batch-poster.jpg", "Academy batch poster — feed", "అకాడమీ బ్యాచ్ పోస్టర్"],
    ["assets/academy/batch1-story.jpg", "academy-batch-story.jpg", "Academy batch poster — story", "అకాడమీ బ్యాచ్ స్టోరీ"],
  ] },
  { key: "videos", title: "Videos & reels", te: "వీడియోలు", items: [
    ["print/opening-promo.mp4", "opening-promo.mp4", "Opening promo reel — full quality (Instagram)", "ఓపెనింగ్ ప్రోమో రీల్"],
    ["print/opening-promo-whatsapp.mp4", "opening-promo-whatsapp.mp4", "Opening promo reel — WhatsApp size", "ఓపెనింగ్ ప్రోమో (వాట్సాప్)"],
    ["print/opening-tour.mp4", "opening-tour.mp4", "Clinic tour video — full quality", "క్లినిక్ టూర్ వీడియో"],
    ["print/opening-tour-whatsapp.mp4", "opening-tour-whatsapp.mp4", "Clinic tour video — WhatsApp size", "క్లినిక్ టూర్ (వాట్సాప్)"],
    ["print/opening-reel-fast.mp4", "opening-reel-fast.mp4", "Opening reel, fast cut — full quality", "ఓపెనింగ్ రీల్ (ఫాస్ట్)"],
    ["print/opening-reel-fast-whatsapp.mp4", "opening-reel-fast-whatsapp.mp4", "Opening reel, fast cut — WhatsApp size", "ఓపెనింగ్ రీల్ ఫాస్ట్ (వాట్సాప్)"],
    ["print/dr-meghana-intro.mp4", "dr-meghana-intro.mp4", "Dr. Meghana introduction — full quality (never a paid ad)", "డా. మేఘన పరిచయ వీడియో"],
    ["print/dr-meghana-intro-whatsapp.mp4", "dr-meghana-intro-whatsapp.mp4", "Dr. Meghana introduction — WhatsApp size (never a paid ad)", "డా. మేఘన పరిచయం (వాట్సాప్)"],
  ] },
  { key: "photos", title: "Photos & logo", te: "ఫోటోలు & లోగో", items: [
    ["assets/logo.png", "dermaluxe-logo.png", "DermaLuxe logo — PNG", "లోగో (PNG)"],
    ["assets/logo.webp", "dermaluxe-logo.webp", "DermaLuxe logo — WebP (web)", "లోగో (WebP)"],
    ["assets/founders photos/Dr. Meghana Valleti.png", "dr-meghana-valleti.png", "Dr. Meghana Valleti — portrait, original", "డా. మేఘన వల్లేటి — ఫోటో"],
    ["assets/founders/meghana.jpg", "dr-meghana-valleti-web.jpg", "Dr. Meghana Valleti — portrait, web size", "డా. మేఘన — వెబ్ సైజు"],
    ["assets/dr-nikhitha.jpg", "dr-nikhitha-priyanka.jpg", "Dr. Nikhitha Priyanka — portrait", "డా. నిఖిత ప్రియాంక — ఫోటో"],
    ["assets/dr-sai-divija.jpg", "dr-sai-divija.jpg", "Dr. K. Sai Divija — portrait", "డా. సాయి దివిజ — ఫోటో"],
    ["assets/founders photos/Nagaraju Bandaru.png", "nagaraju-bandaru.png", "Nagaraju Bandaru — portrait, original", "నాగరాజు బండారు — ఫోటో"],
    ["assets/founders/nagaraju.jpg", "nagaraju-bandaru-web.jpg", "Nagaraju Bandaru — portrait, web size", "నాగరాజు — వెబ్ సైజు"],
    ["assets/team-1600.webp", "team-photo.webp", "Team photo", "టీమ్ ఫోటో"],
    ["assets/hero.jpg", "clinic-hero.jpg", "Clinic — website hero photo", "క్లినిక్ ఫోటో"],
    ["assets/about.jpg", "clinic-about.jpg", "Clinic — about photo", "క్లినిక్ ఫోటో (అబౌట్)"],
    ["print/invite/building-empty-final.jpg", "clinic-building-evening.jpg", "Clinic building — evening", "క్లినిక్ బిల్డింగ్ — సాయంత్రం"],
    ["print/invite/building-face-v2-final.jpg", "clinic-building-front.jpg", "Clinic building — front", "క్లినిక్ బిల్డింగ్ — ముందు"],
    ["assets/qr-whatsapp.png", "whatsapp-qr.png", "WhatsApp QR code (99591 34666)", "వాట్సాప్ QR"],
    ["print/rx-qr.png", "rx-qr.png", "Prescription QR (opens the AI analysis form)", "ప్రిస్క్రిప్షన్ QR"],
  ] },
];

const TYPE = { pdf: "pdf", png: "image", jpg: "image", jpeg: "image", webp: "image", svg: "image", mp4: "video" };
const groups = [], missing = [];
let total = 0;
for (const g of GROUPS) {
  const dir = path.join(OUT, g.key);
  fs.mkdirSync(dir, { recursive: true });
  const items = [];
  for (const [src, name, title, te] of g.items) {
    const from = path.join(ROOT, src);
    if (!fs.existsSync(from)) { missing.push(src); continue; }
    const to = path.join(dir, name);
    const st = fs.statSync(from);
    // copy only when the source changed, so a re-run after one poster does not rewrite 130 MB
    const same = fs.existsSync(to) && fs.statSync(to).size === st.size && fs.statSync(to).mtimeMs >= st.mtimeMs;
    if (!same) fs.copyFileSync(from, to);
    const ext = name.split(".").pop().toLowerCase();
    total += st.size;
    items.push({ name, title, te, path: `/files/${g.key}/${name}`, bytes: st.size, ext, kind: TYPE[ext] || "file", mtime: Math.round(st.mtimeMs) });
  }
  groups.push({ key: g.key, title: g.title, te: g.te, items });
}
// anything in files/ that is no longer on the list is removed, so the served
// folder never carries a poster the owner withdrew
for (const g of GROUPS) {
  const dir = path.join(OUT, g.key), keep = new Set(g.items.map((x) => x[1]));
  for (const f of fs.readdirSync(dir)) if (!keep.has(f) && f !== ".DS_Store") { fs.unlinkSync(path.join(dir, f)); console.log("removed", g.key + "/" + f); }
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ generated: Date.now(), groups }, null, 1) + "\n");
console.log(`${groups.reduce((n, g) => n + g.items.length, 0)} files, ${(total / 1048576).toFixed(1)} MB → files/manifest.json`);
if (missing.length) { console.log("⚠ missing sources:\n  " + missing.join("\n  ")); process.exitCode = 1; }
