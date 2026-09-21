// Daily auto-poster for DermaLuxe — plan → Gemini image → poster (HTML in
// headless Chromium) → KV image → adm:queue (8:30 AM IST) → WhatsApp preview.
// The existing cron-post.js publishes the queued item to Instagram (+ FB
// crosspost) and pings the owner + clinic numbers with the live link.
//
// Topic rotation is deterministic (weekday pillar + "not used in the last 20
// posts"); Claude only writes the caption, so a Claude outage never blocks
// the poster. Gemini paints the background; if it fails we fall back to a
// pure gold-on-black text poster so the day is never skipped.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const guard = require("./_guard.js");
const docs = require("./_docs.js");

const IST_MS = 330 * 60000;
const SITE = "https://www.dermaluxe.ai";
// What every picture must be, whatever it looks like.
const STYLE = "Premium editorial photograph for a luxury dermatology clinic's Instagram. Ultra-realistic, tasteful, South Indian people when a person is shown, no text, no logos, no watermarks, no medical gore, portrait orientation 4:5. The poster already carries a real photograph of the clinic's doctor, so never show a doctor's or clinician's face — if a clinician is in the picture, show only gloved hands or a figure from behind.";

// How it looks, which changes. Every picture used to be told "dark
// charcoal-black background with warm golden accents", and with several
// briefs that were an empty room and a lamp the feed became the same dark
// room day after day. Four looks now, and the one used yesterday or the day
// before is not used today. The lower part is always allowed to fall dark,
// because the words sit there.
const LOOKS = [
  { key: "studio", text: "Look: dark studio, deep charcoal background, warm golden rim light, cinematic and luxurious." },
  { key: "daylight", text: "Look: soft natural daylight from a large window, airy warm-neutral tones, fresh and real, like a bright modern clinic in the morning." },
  { key: "macro", text: "Look: close-up detail, very shallow depth of field, rich warm skin tones and texture, tactile and intimate." },
  { key: "golden", text: "Look: warm lifestyle photograph, candid real moment, golden-hour sunlight, natural colour." },
];
async function pickLook(cfg) {
  let recent = [];
  if (cfg) { try { recent = ((await guard.kvCommand(cfg, ["LRANGE", "dp:looks", "0", "1"])).result || []).map(String); } catch (e) {} }
  const pool = LOOKS.filter((l) => recent.indexOf(l.key) === -1);
  const from = pool.length ? pool : LOOKS;
  return from[Math.floor(Math.random() * from.length)];
}

// pillar: edu (education) · tx (treatment spotlight) · myth · trust (doctors/tech) · cta (free AI analysis / booking) · season · tips
const TOPICS = [
  { key: "acne", pillar: "tx", h1: "Acne & acne scar treatment", te: "మొటిమలు & మచ్చల చికిత్స", sub: "Graded by MD dermatologists · Peels · MNRF · PICO laser", page: "acne-treatment-eluru.html", img: "Clear, calm, smooth skin close-up of a young South Indian woman's cheek and jaw, soft golden light, dark background." },
  { key: "pimples-back", pillar: "edu", h1: "Why pimples keep coming back", te: "మొటిమలు మళ్ళీ మళ్ళీ ఎందుకు వస్తాయి?", sub: "4 causes · 1 cream fixes only one · Dermatologist plan fixes all", page: "blog-why-pimples-keep-coming-back.html", img: "Young South Indian woman looking at her reflection in a small gold hand mirror, calm hopeful expression, warm golden light, dark background." },
  { key: "hair-fall", pillar: "edu", h1: "Hair fall? Find the cause first", te: "జుట్టు రాలడం — కారణం తెలుసుకోండి", sub: "Thyroid · Iron · PCOS · Dandruff · Genetics — then the right treatment", page: "hair-fall-treatment-eluru.html", img: "Close-up of a young South Indian woman gently running fingers through long thick healthy dark hair, seen from behind, golden rim light." },
  { key: "hair-transplant", pillar: "tx", h1: "FUE / DHI hair transplant", te: "హెయిర్ ట్రాన్స్‌ప్లాంట్ — సహజ ఫలితం", sub: "Natural hairline · Doctor-performed · Beard & eyebrow too", page: "hair-transplant-eluru.html", img: "Confident South Indian man in his 30s with a full natural hairline and neatly styled dark hair, half-turned profile, warm golden key light, dark background." },
  { key: "lhr", pillar: "tx", h1: "Laser hair removal", te: "లేజర్ హెయిర్ రిమూవల్", sub: "USFDA-approved laser · Safe for Indian skin · Women & men", page: "laser-hair-removal-eluru.html", img: "Elegant close-up of a South Indian woman's smooth bare shoulder and arm, skin glowing under soft golden light, minimal luxury spa mood." },
  { key: "hydrafacial", pillar: "tx", h1: "Hydrafacial glow in 30 minutes", te: "హైడ్రాఫేషియల్ — వెంటనే గ్లో", sub: "Cleanse · Exfoliate · Extract · Hydrate · Zero downtime", page: "hydrafacial-eluru.html", img: "Close-up of dewy hydrated glowing facial skin of a young South Indian woman with eyes closed, tiny water droplets on cheek, soft golden light." },
  { key: "pigmentation", pillar: "tx", h1: "Pigmentation & melasma", te: "పిగ్మెంటేషన్ & మెలాస్మా చికిత్స", sub: "Prescription care · Medical peels · PICO laser", page: "pigmentation-treatment-eluru.html", img: "Radiant even-toned face of a South Indian woman in her 30s, calm expression, soft side lighting on smooth clear cheeks, dark elegant background." },
  { key: "dandruff", pillar: "edu", h1: "Dandruff that keeps coming back", te: "చుండ్రు మళ్ళీ మళ్ళీ వస్తోందా?", sub: "It's a scalp condition, not a shampoo problem", page: "dandruff-treatment-eluru.html", img: "Healthy clean scalp and shiny dark hair being parted gently, extreme close-up macro detail, warm golden lighting, dark background." },
  { key: "prp", pillar: "tx", h1: "PRP & GFC hair therapy", te: "జుట్టు కోసం PRP & GFC థెరపీ", sub: "Your own growth factors · 30-minute sessions · No downtime", page: "prp-gfc-hair-therapy-eluru.html", img: "Abstract luxurious macro shot of glossy dark hair strands with golden light streaks and soft bokeh, dark background." },
  { key: "peel", pillar: "tx", h1: "Medical chemical peels", te: "కెమికల్ పీల్ — డెర్మటాలజిస్ట్ చేత", sub: "Acne · Tan · Pigmentation · Dull skin", page: "chemical-peel-eluru.html", img: "Serene South Indian woman with eyes closed receiving a gentle facial treatment, a gloved hand applying a soft brush to her cheek, clinical yet luxurious, dark warm tones." },
  { key: "mnrf", pillar: "tx", h1: "MNRF for acne scars", te: "MNRF — మొటిమల మచ్చలు, ఓపెన్ పోర్స్", sub: "Rebuilds collagen under the scar · Safe on Indian skin", page: "mnrf-treatment-eluru.html", img: "Macro close-up of smooth refined poreless skin texture on a cheek, soft gold light raking across the surface, dark background." },
  { key: "hifu", pillar: "tx", h1: "HIFU non-surgical face lift", te: "HIFU — సర్జరీ లేకుండా ఫేస్ లిఫ్ట్", sub: "Jawline · Double chin · Cheeks · No cuts, no downtime", page: "hifu-face-lift-eluru.html", img: "Elegant profile silhouette of a South Indian woman in her 40s with a defined jawline, chin slightly raised, dramatic golden rim light on dark background." },
  { key: "bridal", pillar: "season", h1: "Bridal skin & hair programme", te: "బ్రైడల్ స్కిన్ & హెయిర్ ప్యాకేజీ", sub: "Start 6 months early · Groom packages too", page: "bridal-skin-hair-package-eluru.html", img: "Glowing South Indian bride in a subtle gold-and-maroon silk saree, flawless skin, soft smile, close portrait, warm golden light, dark backdrop, minimal jewellery." },
  { key: "mens", pillar: "tx", h1: "Men's skin & hair clinic", te: "పురుషుల స్కిన్ & హెయిర్ క్లినిక్", sub: "Hair loss · Beard · Acne marks · Quick, private, doctor-led", page: "mens-skin-hair-clinic-eluru.html", img: "Well-groomed South Indian man in his 30s with a full beard and clear skin, looking slightly off camera, dark moody studio portrait with golden key light." },
  { key: "kids", pillar: "edu", h1: "Children's skin care", te: "పిల్లల చర్మ సంరక్షణ", sub: "Eczema · Rashes · Warts · Teen acne — gentle, child-safe care", page: "kids-skin-care-eluru.html", img: "Happy South Indian child around 6 years old with healthy skin, laughing, gently held by a mother's hands, warm soft light, dark cosy background." },
  { key: "online", pillar: "cta", h1: "Consult our dermatologist online", te: "ఆన్‌లైన్ డెర్మటాలజిస్ట్ కన్సల్టేషన్", sub: "Video or WhatsApp · Prescription & care plan from home", page: "online-dermatologist-consultation.html", img: "South Indian woman at home holding a smartphone on a video call, smiling, warm lamp light, cosy dark interior with golden tones." },
  { key: "tan", pillar: "season", h1: "Tan removal & skin brightening", te: "టాన్ రిమూవల్ & స్కిన్ బ్రైటనింగ్", sub: "Medical peels · Carbon laser · Sunscreen plan", page: "tan-removal-skin-brightening-eluru.html", img: "Luminous even bright complexion of a South Indian woman, close portrait with soft golden light and dark background, radiant clear skin." },
  { key: "ai", pillar: "cta", h1: "Free AI skin & hair analysis", te: "ఉచిత AI స్కిన్ & హెయిర్ అనాలిసిస్", sub: "Send a photo on WhatsApp · Instant pre-analysis · 24x7", page: "index.html#ai-analysis", img: "Futuristic yet elegant close-up of a South Indian woman's face with faint golden light scan lines gently tracing across her skin, dark background." },
  { key: "sunscreen", pillar: "tips", h1: "Sunscreen is the real anti-ageing", te: "సన్‌స్క్రీన్ — నిజమైన యాంటీ-ఏజింగ్", sub: "SPF 30+ · Reapply every 3 hours · Indoors too", page: "anti-ageing-treatment-eluru.html", img: "Close-up of a South Indian woman's hand applying a drop of sunscreen on her cheek, soft morning golden light, dark elegant background." },
  { key: "steroid-cream", pillar: "myth", h1: "That fairness cream may be a steroid", te: "ఆ ఫెయిర్‌నెస్ క్రీమ్ స్టెరాయిడ్ కావచ్చు", sub: "Works in days, then rebound acne & dark patches — ask a dermatologist", page: "skin-doctor-eluru.html", img: "Elegant still life of an unlabeled white cream tube and a small gold mirror on a dark marble surface, warm golden light, moody." },
  { key: "myth-oil", pillar: "myth", h1: "Coconut oil does not stop hair fall", te: "కొబ్బరి నూనె జుట్టు రాలడం ఆపదు", sub: "It conditions the hair shaft — the root needs a diagnosis", page: "hair-fall-treatment-eluru.html", img: "Close-up of healthy dark hair and a small glass bottle of golden oil on a dark surface, warm golden light, luxurious mood." },
  { key: "dark-circles", pillar: "tx", h1: "Dark circles under the eyes", te: "కళ్ళ కింద నలుపు — చికిత్స ఉంది", sub: "Pigment, hollows or thin skin — each needs a different fix", page: "dark-circles-treatment-eluru.html", img: "Close-up of bright rested eyes of a South Indian woman, smooth under-eye skin, soft golden lighting, dark background." },
  { key: "pores", pillar: "tx", h1: "Open pores & oily skin", te: "ఓపెన్ పోర్స్ & జిడ్డు చర్మం", sub: "Salicylic peels · Carbon laser · MNRF", page: "open-pores-oily-skin-treatment-eluru.html", img: "Macro close-up of smooth matte refined skin on a nose and cheek, golden light, dark background." },
  { key: "stretch", pillar: "tx", h1: "Stretch marks can be treated", te: "స్ట్రెచ్ మార్క్స్ చికిత్స", sub: "MNRF · Fractional laser · Best when marks are still red", page: "stretch-marks-treatment-eluru.html", img: "Elegant close-up of smooth skin on a woman's waist and hip in soft golden light, tasteful, dark background." },
  { key: "fungal", pillar: "season", h1: "Ringworm keeps coming back?", te: "తామర మళ్ళీ మళ్ళీ వస్తోందా?", sub: "Steroid creams make it worse — get the right antifungal course", page: "fungal-infection-treatment-eluru.html", img: "Clean folded cotton towels and a bar of soap on a dark surface with warm golden light, hygiene mood, no skin shown." },
  { key: "grey-hair", pillar: "edu", h1: "Grey hair in your 20s?", te: "20ల లోనే తెల్ల జుట్టు?", sub: "B12 · Thyroid · Stress · Genetics — check before you dye", page: "premature-grey-hair-treatment-eluru.html", img: "Close-up of thick glossy dark hair with a few silver strands catching golden light, dark background." },
  { key: "female-hair", pillar: "edu", h1: "Hair thinning after delivery or PCOS", te: "డెలివరీ, PCOS తర్వాత జుట్టు పలుచబడటం", sub: "Very common, very treatable — don't wait a year", page: "female-hair-loss-treatment-eluru.html", img: "South Indian woman gently tying her long thick hair, calm expression, warm golden light, dark background." },
  { key: "doctor", pillar: "trust", h1: "Every treatment by an MD dermatologist", te: "ప్రతి చికిత్స MD చర్మ వైద్యులచే", sub: "Not a parlour · Medical-grade products · USFDA machines", page: "skin-clinic-eluru.html", img: "Close-up of a dermatologist's gloved hands holding a dermatoscope near a smiling young South Indian woman's cheek, the patient relaxed, the clinician out of frame except the hands." },
  { key: "tech", pillar: "trust", h1: "USFDA-approved lasers in Eluru", te: "ఏలూరులో USFDA ఆమోదిత లేజర్లు", sub: "PICO · Diode · Carbon laser · HIFU · MNRF", page: "skin-clinic-eluru.html", img: "A gloved hand guiding a sleek laser handpiece that gives off a soft beam of light over a young South Indian woman's forearm, the patient calm, no brand names, clinician's face out of frame." },
  { key: "glutathione", pillar: "tx", h1: "Glutathione skin brightening", te: "గ్లూటాథయోన్ స్కిన్ బ్రైటనింగ్", sub: "Even tone & glow · Doctor-supervised · Honest expectations", page: "glutathione-skin-whitening-eluru.html", img: "Radiant glowing skin close-up of a South Indian woman, soft golden light, dark background, serene beauty." },
  { key: "carbon", pillar: "tx", h1: "Carbon laser facial before the event", te: "ఈవెంట్ ముందు కార్బన్ లేజర్ ఫేషియల్", sub: "Instant glow · Tighter pores · Zero downtime", page: "carbon-laser-facial-eluru.html", img: "Close-up of a South Indian woman's glowing cheek with soft golden light, party-ready look, dark elegant background." },
  { key: "anti-ageing", pillar: "tx", h1: "Fine lines? Start early, stay natural", te: "సన్నని గీతలు — ముందే మొదలుపెట్టండి", sub: "Botox · Fillers · HIFU · Skin boosters — subtle, never overdone", page: "anti-ageing-treatment-eluru.html", img: "Elegant South Indian woman in her late 30s with smooth natural skin, soft smile, golden rim light, dark background." },
  { key: "beard", pillar: "tx", h1: "Patchy beard? Beard transplant", te: "గడ్డం పాచెస్ — గడ్డం ట్రాన్స్‌ప్లాంట్", sub: "Natural density · Doctor-performed · Eyebrows too", page: "beard-eyebrow-transplant-eluru.html", img: "South Indian man with a full dense well-shaped beard, close portrait, moody golden studio light, dark background." },
  { key: "vitiligo", pillar: "edu", h1: "White patches: treatable, not contagious", te: "బొల్లి — చికిత్స ఉంది, అంటువ్యాధి కాదు", sub: "Early treatment gives the best repigmentation", page: "vitiligo-treatment-eluru.html", img: "Two hands gently holding each other in warm golden light, dark background, compassion mood, no visible skin condition." },
  { key: "warts", pillar: "tx", h1: "Warts, moles & skin tags removal", te: "పులిపిర్లు, పుట్టుమచ్చలు తొలగింపు", sub: "RF / laser · 10 minutes · Minimal marks", page: "warts-moles-skin-tags-removal-eluru.html", img: "Elegant close-up of smooth clear skin on a neck and collarbone in soft golden light, dark background." },
  { key: "weight", pillar: "tx", h1: "Medical weight loss, doctor-supervised", te: "డాక్టర్ పర్యవేక్షణలో బరువు తగ్గడం", sub: "Body contouring · Diet plan · No crash diets", page: "weight-loss-clinic-eluru.html", img: "Fit South Indian woman in elegant dark activewear, confident posture, golden rim light, dark background." },
  { key: "psoriasis", pillar: "edu", h1: "Psoriasis flares can be controlled", te: "సోరియాసిస్ — అదుపులో ఉంచొచ్చు", sub: "Modern treatments · Long remissions · Stop the itch cycle", page: "psoriasis-treatment-eluru.html", img: "Calm South Indian person's relaxed hands resting on a dark surface in warm golden light, serene mood." },
  { key: "monsoon", pillar: "season", h1: "Monsoon skin & hair care", te: "వర్షాకాలం చర్మం & జుట్టు సంరక్షణ", sub: "Fungal infections · Frizz & hair fall · Sticky skin", page: "fungal-infection-treatment-eluru.html", img: "A young South Indian woman laughing under a big umbrella in light rain, droplets on her glowing skin and glossy hair, warm street lights behind." },
  { key: "festive", pillar: "season", h1: "Festival-ready glow in 2 weeks", te: "పండుగకు 2 వారాల్లో గ్లో", sub: "Hydrafacial · Peel · Carbon laser — plan it early", page: "hydrafacial-eluru.html", img: "Elegant South Indian woman in a silk saree with glowing skin beside warm golden diya lights, dark background." },
  { key: "review", pillar: "trust", h1: "3 lakh+ happy clients, 10 branches", te: "3 లక్షలకు పైగా సంతృప్త క్లయింట్లు", sub: "Medicare Skin & Hair family · Now in Eluru", page: "index.html", img: "A South Indian mother and her grown-up daughter laughing together, both with healthy glowing skin, a warm candid moment at home." },
];

const PILLAR_BY_DAY = ["tips", "edu", "tx", "myth", "trust", "cta", "season"]; // Sun..Sat

// ---- DermaLuxe Academy campaign --------------------------------------------
// The clinic teaches as well as treats, and Batch 1 has ten seats and a launch
// price with an end date. A seat is worth far more than a consultation, so for
// the run-up these get their own daily poster rather than one turn in the
// ordinary rotation.
//
// Five angles, because five different things stop somebody signing up: they do
// not know it is closing, they do not think they qualify, they assume it is
// slides and theory, they cannot picture what it leads to, and they do not
// know who is teaching. One poster each.
//
// The seat count and the days left are filled in at build time from what the
// owner has actually recorded — never guessed. The trainer poster deliberately
// asks for a room and not a person: an AI likeness of a named real doctor is
// not something to put on a poster.
const ACADEMY_TOPICS = [
  { key: "acad-seats", pillar: "academy",
    h1: "Ten seats. One batch.", te: "పది సీట్లు మాత్రమే",
    sub: "Batch 1 · Eluru · Skin · Hair · Skin+Hair", page: "academy.html",
    img: "A small group of young South Indian women trainees in crisp white coats gathered around a treatment couch, one holding a skin-analysis device, attentive and hands-on, seen mostly from the side and behind." },
  { key: "acad-who", pillar: "academy",
    h1: "Beautician? Nurse? Fresher?", te: "మీరు చేరవచ్చా? — అవును",
    sub: "Cosmetologists · Therapists · Salon & spa · Nursing · Freshers", page: "academy.html",
    img: "Three South Indian women in crisp clinical white coats standing together in a modern aesthetics clinic, warm confident expressions, golden key light, dark elegant background." },
  { key: "acad-hands", pillar: "academy",
    h1: "On the machines, not slides", te: "స్లైడ్స్ కాదు — నిజమైన మెషీన్లు",
    sub: "PICO · Diode · MNRF · HIFU · Hydrafacial · Supervised, on real cases", page: "academy.html",
    img: "Close-up of gloved hands holding an aesthetic laser handpiece over a treatment couch in a dark luxurious clinic room, golden accent light, no faces, no brand names." },
  { key: "acad-career", pillar: "academy",
    h1: "Learn it, then run it", te: "నేర్చుకోండి — సొంతంగా చేయండి",
    sub: "Certificate · Written protocols · Consultation skills · Setup guidance", page: "academy.html",
    img: "Confident South Indian woman in her late 20s in a white clinic coat standing in the doorway of her own small treatment room, warm golden light, dark background." },
  { key: "acad-trainer", pillar: "academy",
    h1: "Taught by an MD dermatologist", te: "MD డెర్మటాలజిస్ట్ చేత శిక్షణ",
    sub: "Dr. Meghana Valeti · MD DVL, Gold Medalist · Not a parlour course", page: "academy.html",
    img: "Over-the-shoulder view of an instructor's gloved hand guiding a young trainee's hand as she positions a laser handpiece, both faces out of frame, focused hands-on teaching." },
];

// Whole days between two moments, counted the way a person counts them: by the
// calendar date in Eluru, not by dividing a duration. The deadline is 23:59 on
// its day, so ceil() of the gap reads one day too many all morning — and the
// poster that should say "ends today" would be saying "ends in 1 day".
const istDateOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const daysUntilIst = (targetMs, nowMs) =>
  Math.round((Date.parse(istDateOf(targetMs) + "T00:00:00Z") - Date.parse(istDateOf(nowMs) + "T00:00:00Z")) / 86400000);

// On while there are seats left and the batch has not started. The owner can
// force it either way: "acad:dp" = "1" or "0".
async function academyState(cfg) {
  let booked = 0, forced = null;
  if (cfg) {
    const [b, f] = await guard.kvPipeline(cfg, [["GET", "acad:booked"], ["GET", "acad:dp"]]).catch(() => [null, null]);
    booked = Math.max(0, Math.min(docs.BATCH.seats, Number(b) || 0));
    if (f === "0" || f === "1") forced = f;
  }
  const left = Math.max(0, docs.BATCH.seats - booked);
  const now = Date.now();
  const offerDays = daysUntilIst(docs.BATCH.offerEndMs, now);
  const batchDays = daysUntilIst(docs.BATCH.startMs, now);
  const natural = left > 0 && batchDays >= 0;
  return { on: forced === "1" || (forced !== "0" && natural), left, booked, offerDays, batchDays, forced };
}

// The one line under the headline, rewritten with what is true today. Seats
// first when they are nearly gone, the closing price while it is still open,
// and the start date once it is not.
function academySub(t, st) {
  const bits = [];
  if (st.left > 0 && st.left <= 4) bits.push(`Only ${st.left} seat${st.left > 1 ? "s" : ""} left`);
  // Zero is the last day, not a day that has passed: the offer runs to 23:59.
  if (st.offerDays > 1) bits.push(`Launch price ends in ${st.offerDays} days`);
  else if (st.offerDays === 1) bits.push("Launch price ends tomorrow");
  else if (st.offerDays === 0) bits.push("Launch price ends today");
  else if (st.batchDays > 1) bits.push(`Starts in ${st.batchDays} days`);
  else if (st.batchDays === 1) bits.push("Starts tomorrow");
  else if (st.batchDays === 0) bits.push("Starts today");
  bits.push(`Batch ${docs.BATCH.no} — ${docs.BATCH.start}`);
  // The poster has room for one line; keep the truest two fragments.
  const line = bits.slice(0, 2).join(" · ");
  return line.length >= 10 ? line.slice(0, 80) : t.sub;
}

async function academyTopic(cfg) {
  const st = await academyState(cfg);
  if (!st.on) return null;
  let recent = [];
  if (cfg) {
    try { const r = await guard.kvCommand(cfg, ["LRANGE", "dp:hist", "0", "9"]); recent = (r.result || []).map((x) => String(x).split("|")[0]); } catch (e) {}
  }
  // Round-robin, so the same poster does not land twice in a week.
  let pool = ACADEMY_TOPICS.filter((t) => recent.indexOf(t.key) === -1);
  if (!pool.length) pool = ACADEMY_TOPICS;
  const t = pool[Math.floor(Math.random() * pool.length)];
  return Object.assign({}, t, { sub: academySub(t, st), academy: st });
}


function todayIst() {
  const d = new Date(Date.now() + IST_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function istDow() { return new Date(Date.now() + IST_MS).getUTCDay(); }
function todayAtIst(h, m) {
  const d = new Date(Date.now() + IST_MS);
  d.setUTCHours(h, m, 0, 0);
  return d.getTime() - IST_MS;
}
function phones(list) { return String(list || "").split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter(Boolean); }

// ---- 1. Topic ------------------------------------------------------------
async function pickTopic(cfg, forceKey) {
  if (forceKey) {
    const t = TOPICS.concat(ACADEMY_TOPICS).find((x) => x.key === forceKey);
    if (t) return t;
  }
  let recent = [];
  if (cfg) { try { const r = await guard.kvCommand(cfg, ["LRANGE", "dp:hist", "0", "19"]); recent = (r.result || []).map((s) => String(s).split("|")[0]); } catch (e) {}
  }
  const pillar = PILLAR_BY_DAY[istDow()];
  // The academy posters run as their own campaign and must never fall out of
  // the ordinary rotation by chance — a seats-are-going poster on a random
  // Tuesday after the batch has started would be a lie.
  const ordinary = TOPICS.filter((t) => t.pillar !== "academy");
  let pool = ordinary.filter((t) => t.pillar === pillar && recent.indexOf(t.key) === -1);
  if (!pool.length) pool = ordinary.filter((t) => recent.indexOf(t.key) === -1);
  if (!pool.length) pool = ordinary;
  // seasonal nudges
  const m = new Date(Date.now() + IST_MS).getUTCMonth() + 1;
  const boost = (k) => { const t = pool.find((x) => x.key === k); return t && Math.random() < 0.5 ? t : null; };
  if (m >= 6 && m <= 9) { const t = boost("monsoon") || boost("fungal"); if (t) return t; }
  if (m === 10 || m === 11) { const t = boost("festive") || boost("bridal"); if (t) return t; }
  if (m >= 3 && m <= 5) { const t = boost("tan") || boost("sunscreen"); if (t) return t; }
  if (m === 12 || m === 1 || m === 2) { const t = boost("bridal"); if (t) return t; }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- 1b. Intelligent planner (Claude) --------------------------------------
// Looks at the date/season/festivals, what patients asked about this month
// (dl_leads concerns), and the last 20 posts, then picks a library topic AND
// rewrites the headline / Telugu line / hook for today. Falls back to the
// plain rotation on any failure so the daily post never stops.
const SEASONS = [
  [1, "Sankranti (mid-Jan), wedding season, cool dry weather → dry skin, dandruff, winter itch"],
  [2, "wedding season, Valentine's week, Maha Shivaratri → bridal/groom glow, couple offers"],
  [3, "Women's Day (Mar 8), Ugadi (Mar/Apr), exam season, heat starts → tan, sweat acne, stress hair fall"],
  [4, "Ugadi/summer holidays, peak heat → tan, sunscreen, fungal, hair fall, kids skin"],
  [5, "peak summer, wedding muhurtams → tan removal, laser hair removal, hydrafacial, sweat rashes"],
  [6, "monsoon starts, school reopens → fungal/ringworm, frizz, dandruff, acne flare"],
  [7, "monsoon, Sravana masam (festive Fridays) → fungal, hair fall, glow for pujas"],
  [8, "Raksha Bandhan, Varalakshmi, Independence Day, Vinayaka Chavithi prep → festive glow, hair fall (monsoon peak)"],
  [9, "Vinayaka Chavithi, end of monsoon, Bathukamma/Dasara prep → pigmentation, tan, pre-festival glow"],
  [10, "Bathukamma, Dasara, Diwali prep, wedding season restarts → bridal packages, hydrafacial, laser hair removal"],
  [11, "Diwali, Karthika masam, wedding peak → bridal/groom, anti-ageing, hair transplant planning"],
  [12, "Christmas, New Year, wedding peak, winter → dry skin, lips, dandruff, glow for events"],
];

async function leadInsights(cfg) {
  if (!cfg) return "";
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "299"]);
    const cutoff = Date.now() - 30 * 86400000;
    const counts = {};
    let n = 0;
    for (const raw of (r.result || [])) {
      let l; try { l = JSON.parse(raw); } catch (e) { continue; }
      if (!l || (l.ts && l.ts < cutoff) || l.type === "job") continue;
      n++;
      const txt = [l.concern, l.message, (l.treatments || []).join(" ")].join(" ").toLowerCase();
      for (const [k, re] of Object.entries({ acne: /acne|pimpl|motim/, hairfall: /hair ?fall|hair ?loss|juttu|bald/, pigmentation: /pigment|melasma|dark spot|machal|nallaga/, lhr: /laser hair|hair remov|unwanted hair/, hairtransplant: /transplant/, dandruff: /dandruff|chundru/, tan: /tan|glow|bright|fair/, wedding: /wedding|bridal|marriage|pelli/, fungal: /fungal|ringworm|tamara|itch/, antiageing: /wrinkle|aging|ageing|botox|filler|hifu/, kids: /baby|child|kid|pilla/, weight: /weight|fat|slim/ })) {
        if (re.test(txt)) counts[k] = (counts[k] || 0) + 1;
      }
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(", ");
    return n ? `${n} leads in the last 30 days; top concerns → ${top || "n/a"}` : "";
  } catch (e) { return ""; }
}

async function planTopic(cfg) {
  // The campaign takes the day when it is on. Its copy is written against real
  // seat numbers and real dates, so it is not handed to the planner to reword.
  const acad = await academyTopic(cfg).catch(() => null);
  if (acad) return acad;
  const base = await pickTopic(cfg);
  if (!process.env.ANTHROPIC_API_KEY || process.env.DAILY_PLANNER === "0") return base;
  let recent = [];
  try { const r = await guard.kvCommand(cfg, ["LRANGE", "dp:hist", "0", "19"]); recent = (r.result || []).map((x) => String(x).split("|")[0]); } catch (e) {}
  const d = new Date(Date.now() + IST_MS);
  const dow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()];
  const month = d.getUTCMonth() + 1;
  const season = (SEASONS.find((x) => x[0] === month) || [0, ""])[1];
  const insights = await leadInsights(cfg);
  const lib = TOPICS.filter((t) => recent.indexOf(t.key) === -1).map((t) => `${t.key} [${t.pillar}] — ${t.h1}`).join("\n");
  const sys = `You are the content strategist for DermaLuxe by Medicare — premium skin, hair & aesthetics clinic in Eluru, Andhra Pradesh (MD dermatologists, USFDA lasers, part of Medicare Skin & Hair, 10 branches). Goal of every post: make a local Telugu patient message the clinic on WhatsApp today. Rules: no prices, no "guaranteed"/"permanent cure", no before/after claims, medically accurate, warm not salesy. Output ONLY JSON.`;
  const user = `Today: ${d.toISOString().slice(0, 10)} (${dow}, IST). Season/context for this month: ${season}.
Patient demand signal: ${insights || "no lead data yet"}.
Last 20 posts (do not repeat these keys): ${recent.join(", ") || "none"}.
Weekday pillar hint: ${PILLAR_BY_DAY[d.getUTCDay()]} (edu=education, tx=treatment spotlight, myth=myth-buster, trust=doctors/tech, cta=free AI analysis/booking, season=seasonal, tips=daily tips).
Available library topics:
${lib}

Pick the single best topic key for today (prefer what patients are asking about, the season, and the pillar hint) and write today's poster copy — fresh, specific, scroll-stopping, not generic:
- h1: English headline, max 34 characters, no emoji, no exclamation
- te: Telugu line (Telugu script, natural spoken Telugu, max 30 characters)
- sub: one English support line, max 72 characters, 3-5 fragments separated by " · "
- img: one-sentence photo brief for an AI image that illustrates h1 (South Indian subject if a person, tasteful, no text). Prefer a person, a real moment or a close detail — never an empty room, and never a doctor's face (the poster shows the real doctor's photo); a clinician may appear only as gloved hands or from behind
- why: 10-word reason
JSON: {"key":"...","h1":"...","te":"...","sub":"...","img":"...","why":"..."}`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.DAILY_PLANNER_MODEL || process.env.AI_MODEL || "claude-sonnet-5", max_tokens: 600, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) throw new Error("claude HTTP " + resp.status);
    const data = await resp.json();
    const t = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
    const p = JSON.parse((t.match(/\{[\s\S]*\}/) || [t])[0]);
    const lib2 = TOPICS.find((x) => x.key === String(p.key || "").toLowerCase());
    if (!lib2) throw new Error("planner picked unknown key " + p.key);
    const clean = (v, max) => String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
    const h1 = clean(p.h1, 34), te = clean(p.te, 32), sub = clean(p.sub, 80), img = clean(p.img, 300);
    return Object.assign({}, lib2, {
      h1: h1.length >= 8 ? h1 : lib2.h1,
      te: /[ఀ-౿]/.test(te) ? te : lib2.te,
      sub: sub.length >= 10 ? sub : lib2.sub,
      img: img.length >= 20 ? img : lib2.img,
      planned: true, why: clean(p.why, 120),
    });
  } catch (e) {
    console.error("daily: planner fallback", e && e.message);
    return base;
  }
}

// ---- 2. Caption (Claude) ---------------------------------------------------
// The academy caption is a different job from the clinic's. Course fees may be
// named — the clinic's own rule is that treatment prices are never posted and
// academy fees are the one exception — and the whole caption exists to get one
// word typed into WhatsApp, because that word is what the agent is waiting for.
function academyCaptionSys(st) {
  const seats = st && st.left > 0 && st.left <= 4 ? `Only ${st.left} seat${st.left > 1 ? "s" : ""} are left — say so plainly, once.` : `Ten seats in the batch — say so, without inventing a number that is left.`;
  const when = st && st.offerDays >= 0
    ? `The launch price closes on ${docs.BATCH.offerEndLong} — ${st.offerDays === 0 ? "today" : st.offerDays === 1 ? "tomorrow" : st.offerDays + " days away"}. Give that date.`
    : `The launch price has closed. Do not mention it. The batch starts ${docs.BATCH.start}.`;
  return `You write Instagram captions for DERMALUXE ACADEMY — the training centre of DermaLuxe by Medicare, Eluru, Andhra Pradesh. This is a course for people who want to DO these treatments, not receive them: cosmetologists, beauty therapists, salon and spa staff, nurses and paramedics, and freshers who are serious.

Facts you may use, and nothing beyond them:
- Batch ${docs.BATCH.no} starts ${docs.BATCH.start}, at ${docs.BATCH.venue}. ${docs.BATCH.seats} seats.
- Courses: Advanced Skin Care, Advanced Hair Care, or Skin + Hair Master Programme.
- Launch fees: Skin ₹49,999 and Hair ₹49,999 (regular ₹1,00,000 each); Skin + Hair ₹99,999 (regular ₹2,00,000). ₹9,999 reserves a seat.
- Trained by Dr. Meghana Valeti, MD DVL, Gold Medalist. Hands-on, on USFDA-approved machines, on real supervised cases.
- ${seats}
- ${when}

Style: confident and warm, 5-8 short lines, English with ONE natural Telugu line, no hype, max 3 emojis, no emoji in the first line. Never promise an income, a job, or "guaranteed placement" — say what they will be able to do, not what they will earn.

The second line from the end must be exactly:
"📲 WhatsApp *ACADEMY* to 99591 34666 · wa.me/919959134666"
and the last line before the hashtags exactly:
"📍 DermaLuxe Academy, R.R. Peta, Eluru"
then 7-9 hashtags including #DermaLuxeAcademy #CosmetologyCourse #Eluru #AndhraPradesh.
Output ONLY the caption text — no JSON, no quotes, no preamble.`;
}

function academyCaptionFallback(topic, st) {
  const closing = st && st.offerDays >= 0
    ? `Launch fees close ${docs.BATCH.offerEnd}.\n`
    : "";
  const seats = st && st.left > 0 && st.left <= 4 ? `Only ${st.left} seat${st.left > 1 ? "s" : ""} left.\n` : `${docs.BATCH.seats} seats in the batch.\n`;
  return `${topic.h1}\n${topic.te}\n\nDermaLuxe Academy, Eluru — Advanced Skin & Hair Aesthetics training.\nHands-on, on USFDA-approved machines, with Dr. Meghana Valeti (MD DVL).\nFor cosmetologists, therapists, salon & spa staff, nurses and serious freshers.\n\nBatch ${docs.BATCH.no} starts ${docs.BATCH.start}.\n${seats}${closing}\n📲 WhatsApp *ACADEMY* to 99591 34666 · wa.me/919959134666\n📍 DermaLuxe Academy, R.R. Peta, Eluru\n\n#DermaLuxeAcademy #CosmetologyCourse #Eluru #AndhraPradesh #SkinCareTraining #HairCareTraining #AestheticsCourse #DermaLuxeEluru`;
}

async function writeCaption(topic) {
  const acad = topic && topic.pillar === "academy";
  const sys = acad ? academyCaptionSys(topic.academy) : `You write Instagram captions for DermaLuxe by Medicare — premium skin/hair/aesthetics clinic in Eluru, Andhra Pradesh (MD dermatologists, USFDA technology, part of Medicare Skin & Hair, 10 branches). Style: premium yet warm, patient-first, educational; 4-7 short lines; English with ONE Telugu line; NEVER prices, NEVER "guaranteed" or "permanent cure", no emojis in the first line, max 3 emojis total. End with exactly these 3 lines:\n"📲 WhatsApp: 99591 34666 · wa.me/919959134666\nFree AI skin & hair analysis — link in bio 👆\n📍 Opposite Happy Mobiles, R.R. Peta, Eluru"\nthen 7-9 hashtags mixing #DermaLuxeEluru #SkinClinicEluru #DermatologistEluru #Eluru plus topic tags. Output ONLY the caption text itself — no JSON, no quotes, no preamble.`;
  const user = `Today's poster: headline "${topic.h1}" · Telugu line "${topic.te}" · sub-line "${topic.sub}". Website page: ${SITE}/${topic.page}. Write the caption.`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.DAILY_CAPTION_MODEL || process.env.AI_MODEL || "claude-sonnet-5", max_tokens: 700, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) throw new Error("claude HTTP " + resp.status);
    const data = await resp.json();
    let t = (((data.content || []).find((b) => b.type === "text") || {}).text || "").trim();
    // tolerate a model that still wraps the caption in JSON
    if (/^\s*\{/.test(t)) { try { const p = JSON.parse(t.match(/\{[\s\S]*\}/)[0]); if (p && p.caption) t = String(p.caption); } catch (e) { t = t.replace(/^[\s\S]*?"caption"\s*:\s*"/, "").replace(/"\s*\}\s*$/, "").replace(/\\n/g, "\n"); } }
    t = t.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (t.length > 40) {
      let c = t.slice(0, 1900);
      if (!/wa\.me\/919959134666/.test(c)) c += "\n\n📲 WhatsApp: 99591 34666 · wa.me/919959134666";
      // The academy poster is only worth posting if the word that triggers the
      // agent is in the caption. A model that drifted off the instruction gets
      // the line added rather than the post going out with no way in.
      if (acad && !/\bACADEMY\b/.test(c)) c += "\n\n📲 WhatsApp *ACADEMY* to 99591 34666 · wa.me/919959134666";
      return c;
    }
  } catch (e) { console.error("daily: caption", e && e.message); }
  if (acad) return academyCaptionFallback(topic, topic.academy);
  return `${topic.h1}\n${topic.te}\n\n${topic.sub}.\nEvery treatment at DermaLuxe is planned by MD dermatologists with USFDA-approved technology.\n\n📲 WhatsApp: 99591 34666 · wa.me/919959134666\nFree AI skin & hair analysis — link in bio 👆\n📍 Opposite Happy Mobiles, R.R. Peta, Eluru\n\n#DermaLuxeEluru #SkinClinicEluru #DermatologistEluru #Eluru #HairClinicEluru #SkinCare #AndhraPradesh`;
}

// ---- 3. Background image (Gemini) ---------------------------------------
// The poster lays its logo over the top of the photo and its words over the
// bottom, so the photo has to leave those bands empty. Asking is not enough –
// the model often puts a face right under the logo – so every image is
// measured by a vision check and redrawn once when a face lands where text goes.
const COMPOSITION = " Composition (important): one continuous photograph edge to edge – no borders, bands, bars, frames or split panels. Give the subject generous headroom: nothing but plain background above the top of the head, and the face in the middle third of the frame, never near the top edge. The lower third of the picture falls gently into shadow.";
const IMAGE_MODELS = [process.env.DAILY_IMAGE_MODEL, "gemini-3-pro-image", "gemini-2.5-flash-image"].filter((m, i, a) => m && a.indexOf(m) === i);

async function gemini(model, body, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
  });
  if (!r.ok) { const err = new Error(`gemini ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`); err.status = r.status; throw err; }
  return r.json();
}

// The photograph is drawn for the headline, not beside it. The library brief
// alone describes a scene; with only that, the picture and the words above it
// could be about two different things. So the model is told what the poster
// says and asked to illustrate exactly that — and told, in as many words, not
// to letter it, because a quoted headline in a prompt is an open invitation to
// paint the words in. The vision check still catches any that slip through.
function imagePrompt(topic) {
  const says = `This photograph is the background of a poster whose headline reads: "${topic.h1}"` +
    (topic.sub ? ` (supporting line: "${topic.sub}")` : "") +
    ". The picture must illustrate that headline directly, so that anybody seeing the two together connects them at a glance. Do NOT write the headline or any other words, letters or numbers anywhere in the image.";
  const look = (topic.look && topic.look.text) || LOOKS[0].text;
  // A change the owner asked for when regenerating: their own words, placed
  // last so they override anything above them (the no-text and no-doctor's-
  // face rules are restated after it, because those are not the owner's to
  // waive by accident in a one-line note).
  const note = String(topic.note || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const owner = note ? ` Owner's change request for this picture (follow it): "${note}". Still no words in the image and no doctor's face.` : "";
  return STYLE + " " + look + " " + says + " Subject: " + topic.img + COMPOSITION + owner;
}

async function drawImage(topic, key) {
  const prompt = imagePrompt(topic);
  for (const model of IMAGE_MODELS) {
    const imageConfig = Object.assign({ aspectRatio: "4:5" }, /pro/.test(model) ? { imageSize: "2K" } : {});
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const d = await gemini(model, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig } }, key);
        const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
        const p = parts.find((x) => x.inlineData);
        if (p) return { b64: p.inlineData.data, mime: p.inlineData.mimeType || "image/png", model };
        break;
      } catch (e) {
        console.error("daily:", e && e.message);
        if (e && (e.status === 429 || e.status >= 500)) { await new Promise((z) => setTimeout(z, 4000)); continue; }
        break; // model not available on this key → next model
      }
    }
  }
  return null;
}

// Where the face is, as fractions of the image height, and whether the model painted any text.
async function measureImage(img, key) {
  try {
    const d = await gemini(process.env.DAILY_CHECK_MODEL || "gemini-3.5-flash", {
      contents: [{ parts: [
        { inlineData: { mimeType: img.mime, data: img.b64 } },
        { text: 'Look at this portrait-format image. Reply ONLY JSON: {"face":true|false,"faceTop":0-1,"faceBottom":0-1,"text":true|false,"band":true|false}. faceTop/faceBottom = top and bottom edge of the main human face (forehead to chin) as a fraction of image height, 0 = top. text = any letters, words, logos or watermarks visible. band = a hard-edged horizontal strip, letterbox bar, border or split panel (a sharp straight line where the background changes).' },
      ] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }, key);
    const t = ((((d.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || "").join("");
    const j = JSON.parse((t.match(/\{[\s\S]*\}/) || [t])[0]);
    return { face: !!j.face, top: Number(j.faceTop) || 0, bottom: Number(j.faceBottom) || 0, text: !!j.text, band: !!j.band };
  } catch (e) { console.error("daily: measure", e && e.message); return null; }
}

// Close-ups often put the chin where the headline goes. Instead of redrawing, lift the
// photo: scale it up from its top edge and slide it up, so the face ends above the
// headline while the logo band stays clear. k = scale, lift = fraction of the height.
function framing(m) {
  if (!m || !m.face || m.bottom <= 0.56) return { k: 1, lift: 0 };
  const k = Math.min(1.32, Math.max(1, 0.44 / Math.max(0.01, 1 - m.bottom)));
  const lift = Math.max(0, Math.min(k - 1, m.bottom * k - 0.56, m.top * k - 0.17));
  return { k, lift };
}

// 0 = perfect. A face under the logo (top 17%) or under the headline (below 58%) costs the most.
function layoutPenalty(m) {
  if (!m) return 1;
  let p = (m.text ? 5 : 0) + (m.band ? 3 : 0);
  if (m.face) {
    const { k, lift } = framing(m);
    p += Math.max(0, 0.17 - (m.top * k - lift)) * 20 + Math.max(0, m.bottom * k - lift - 0.58) * 20;
  }
  return p;
}

async function genImage(topic) {
  const key = process.env.DAILY_GEMINI_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  let best = null;
  for (let round = 0; round < 3; round++) {
    const img = await drawImage(topic, key);
    if (!img) break;
    img.measure = await measureImage(img, key);
    img.penalty = layoutPenalty(img.measure);
    if (!best || img.penalty < best.penalty) best = img;
    // no measurement (check model unavailable on this key) → keep the photo rather than pay for blind redraws
    if (!img.measure || img.penalty < 0.6) break;
  }
  return best;
}

// ---- 4. Poster HTML ---------------------------------------------------------
// ---- the doctor on the poster ---------------------------------------------
// A real photograph and a real name, never a generated face. fx/fy is where the
// face sits in each photograph (as a fraction of width/height), so the round
// crop is centred on the face rather than on a white coat. The credentials are
// the ones the WhatsApp agent is allowed to quote (see _facts.js) — nothing
// here is embellished.
const DOCTORS = {
  nikhitha: { name: "Dr. Nikhitha Priyanka", cred: "MD (DVL) · Senior Dermatologist",
    file: ["dr-nikhitha.webp"], aspect: 1050 / 1400, fx: 0.53, fy: 0.33 },
  meghana: { name: "Dr. Meghana Valeti", cred: "MD (DVL) · Gold Medalist · Medical Director",
    file: ["founders", "meghana.webp"], aspect: 600 / 720, fx: 0.51, fy: 0.31 },
  sai: { name: "Dr. Sai Divija", cred: "MD (DVL) · Dermatologist",
    file: ["dr-sai-divija.webp"], aspect: 880 / 1100, fx: 0.47, fy: 0.30 },
};
const DOCTOR_ROTA = ["nikhitha", "meghana", "sai"];
const _docPhoto = {};
function doctorPhoto(key) {
  if (key in _docPhoto) return _docPhoto[key];
  const d = DOCTORS[key];
  // Spelled out per file so Vercel's file tracer bundles each photograph.
  const at = key === "nikhitha" ? path.join(__dirname, "..", "assets", "dr-nikhitha.webp")
    : key === "meghana" ? path.join(__dirname, "..", "assets", "founders", "meghana.webp")
    : key === "sai" ? path.join(__dirname, "..", "assets", "dr-sai-divija.webp") : "";
  try { _docPhoto[key] = d && at ? fs.readFileSync(at).toString("base64") : ""; } catch (e) { _docPhoto[key] = ""; }
  return _docPhoto[key];
}
// Academy posters show the trainer. Clinic posters take the three doctors in
// turn, a different one each day. The owner can pin one with KV dp:doctor
// (nikhitha / meghana / sai) or take the doctor off with dp:doctor = "off".
async function pickDoctor(cfg, topic) {
  let pin = "";
  if (cfg) { try { pin = String((await guard.kvCommand(cfg, ["GET", "dp:doctor"])).result || "").toLowerCase(); } catch (e) {} }
  if (pin === "off") return null;
  let key = DOCTORS[pin] ? pin
    : topic && topic.pillar === "academy" ? "meghana"
    : DOCTOR_ROTA[Math.floor((Date.now() + IST_MS) / 86400000) % DOCTOR_ROTA.length];
  const b64 = doctorPhoto(key);
  if (!b64) return null;
  return Object.assign({ key, b64 }, DOCTORS[key]);
}

let LOGO_B64 = null;
function logoB64() {
  if (LOGO_B64) return LOGO_B64;
  try { LOGO_B64 = fs.readFileSync(path.join(__dirname, "..", "assets", "logo.png")).toString("base64"); } catch (e) { LOGO_B64 = ""; }
  return LOGO_B64;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Layout, top to bottom: logo + ఏలూరు (top ~16%) · the photo's face (18–56%) ·
// headline block · footer (clinic name EN + TE, address, WhatsApp pill).
// __fit() sits the headline block just above the footer and shrinks the type
// until the block starts below the face band, so long copy never climbs onto it.
function posterHtml(topic, img, doc) {
  // A course poster and a treatment poster are not the same advert. The line
  // across the top and the word on the WhatsApp pill both change, because on
  // Instagram most people never open the caption — if the picture does not say
  // what to type, the poster collects nothing.
  const acad = topic && topic.pillar === "academy";
  const eyebrow = acad ? "DermaLuxe Academy · Eluru" : "Eluru · MD Dermatologists";
  const waLabel = acad ? 'WhatsApp "ACADEMY"' : "WhatsApp";
  const brandName = acad ? "DermaLuxe Academy — Skin & Hair Aesthetics Training" : "DermaLuxe by Medicare Skin And Hair Clinics";
  const brandTe = acad ? "డెర్మాలక్స్ అకాడమీ — స్కిన్ & హెయిర్ శిక్షణ" : "డెర్మాలక్స్ బై మెడికేర్ స్కిన్ అండ్ హెయిర్ క్లినిక్స్";
  // The doctor's round photo: the image is scaled so the face fills about half
  // the circle, then moved so the face sits in its middle.
  const D = 116, BH = D * 2.5, BW = doc ? BH * doc.aspect : 0;
  const docCss = doc ? `background:#1b1812 url("data:image/webp;base64,${doc.b64}") no-repeat;background-size:${BW.toFixed(0)}px ${BH.toFixed(0)}px;background-position:${(D / 2 - doc.fx * BW).toFixed(1)}px ${(D / 2 - doc.fy * BH).toFixed(1)}px` : "";
  const photo = img ? `url("data:${img.mime};base64,${img.b64}") center top/cover no-repeat` : "radial-gradient(70% 45% at 50% 32%,rgba(198,162,92,.30),transparent 70%)";
  const frame = img ? framing(img.measure) : { k: 1, lift: 0 };
  const h1size = topic.h1.length <= 22 ? 92 : topic.h1.length <= 30 ? 82 : 74;
  const tesize = topic.te.length <= 22 ? 46 : 40;
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Jost:wght@300;400;500&family=Noto+Sans+Telugu:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--gold:#e6c98a;--ink:#f7f2e8;--mute:#d2cbbd;--bg:#0a0a0c}
*{box-sizing:border-box}
html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:var(--bg)}
body{color:var(--ink);font-family:Jost,sans-serif;position:relative}
/* a literal colour: a var() in the same declaration drops the huge data-URL background */
.photo{position:absolute;inset:0;background:#0a0a0c ${photo};transform-origin:50% 0;transform:translateY(${-(frame.lift * 1350).toFixed(1)}px) scale(${frame.k.toFixed(3)})}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,10,12,.86) 0%,rgba(10,10,12,.45) 11%,rgba(10,10,12,0) 22%,rgba(10,10,12,0) 44%,rgba(10,10,12,.62) 58%,rgba(10,10,12,.95) 72%,#0a0a0c 100%)}
.vign{position:absolute;inset:0;background:radial-gradient(130% 95% at 50% 38%,transparent 58%,rgba(0,0,0,.55) 100%)}
.frame{position:absolute;inset:30px;border:1px solid rgba(230,201,138,.32)}
.cn{position:absolute;width:44px;height:44px;border:0 solid var(--gold)}
.c1{top:22px;left:22px;border-width:2px 0 0 2px}.c2{top:22px;right:22px;border-width:2px 2px 0 0}.c3{bottom:22px;left:22px;border-width:0 0 2px 2px}.c4{bottom:22px;right:22px;border-width:0 2px 2px 0}
.head{position:absolute;top:60px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:4px}
.logo{width:268px;filter:drop-shadow(0 3px 14px rgba(0,0,0,.75))}
.city{font-family:"Noto Sans Telugu",sans-serif;font-size:25px;font-weight:500;color:var(--gold);text-shadow:0 2px 10px rgba(0,0,0,.9)}
.txt{position:absolute;left:80px;right:80px;bottom:300px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px}
.eyebrow{display:flex;align-items:center;gap:18px;font-size:19px;letter-spacing:.34em;text-transform:uppercase;color:var(--gold);font-weight:500}
.eyebrow i{display:block;width:60px;height:1px;background:linear-gradient(90deg,transparent,var(--gold))}
.eyebrow i.r{background:linear-gradient(270deg,transparent,var(--gold))}
h1{font-family:"Cormorant Garamond",serif;font-weight:600;font-size:${h1size}px;line-height:1.02;margin:0;color:var(--ink);text-wrap:balance;text-shadow:0 2px 22px rgba(0,0,0,.8)}
.te{font-family:"Noto Sans Telugu",sans-serif;font-weight:500;font-size:${tesize}px;line-height:1.45;color:var(--gold);text-shadow:0 2px 14px rgba(0,0,0,.85)}
.sub{font-size:25px;font-weight:300;color:var(--mute);line-height:1.45;max-width:880px;text-wrap:balance}
.foot{position:absolute;left:66px;right:66px;bottom:52px;display:flex;align-items:center;justify-content:space-between;gap:24px;padding-top:24px;border-top:1px solid rgba(230,201,138,.38)}
.foot.withdoc{bottom:92px}
.dr{display:flex;align-items:center;gap:20px;min-width:0}
.dr .ph{flex:none;width:${D}px;height:${D}px;border-radius:50%;${docCss};box-shadow:0 0 0 3px #0a0a0c,0 0 0 5px rgba(230,201,138,.9),0 8px 26px rgba(0,0,0,.6)}
.dr .t{min-width:0}
.dr .k{font-size:14px;letter-spacing:.26em;text-transform:uppercase;color:var(--gold);font-weight:500}
.dr .dn{font-family:"Cormorant Garamond",serif;font-weight:600;font-size:36px;line-height:1.08;color:var(--ink);white-space:nowrap;margin-top:3px}
.dr .dc{font-size:18px;color:var(--mute);margin-top:4px;white-space:nowrap;letter-spacing:.01em}
.addr{position:absolute;left:66px;right:66px;bottom:50px;text-align:center;font-size:17px;color:#aaa396;letter-spacing:.03em;white-space:nowrap}
.brand{min-width:0}
.brand .n{font-size:25px;color:var(--ink);letter-spacing:.02em;white-space:nowrap}
.brand .nt{font-family:"Noto Sans Telugu",sans-serif;font-size:19px;color:var(--mute);margin-top:1px;white-space:nowrap}
.brand .a{font-size:17px;color:#aaa396;margin-top:5px;letter-spacing:.03em;white-space:nowrap}
.wa{flex:none;display:flex;align-items:center;gap:13px;padding:13px 26px 13px 20px;border-radius:999px;background:linear-gradient(135deg,#f3dea9,#c39a56);color:#15120d;box-shadow:0 6px 24px rgba(0,0,0,.45)}
.wa svg{width:38px;height:38px}
.wa .l{font-size:13px;letter-spacing:.24em;text-transform:uppercase;font-weight:500;line-height:1.1}
.wa .num{font-size:31px;font-weight:500;letter-spacing:.03em;line-height:1.1;white-space:nowrap}
</style></head><body><div class="photo"></div><div class="shade"></div><div class="vign"></div><div class="frame"></div><div class="cn c1"></div><div class="cn c2"></div><div class="cn c3"></div><div class="cn c4"></div>
<div class="head"><img class="logo" src="data:image/png;base64,${logoB64()}" alt=""><div class="city">ఏలూరు</div></div>
<div class="txt"><div class="eyebrow"><i></i>${esc(eyebrow)}<i class="r"></i></div><h1>${esc(topic.h1)}</h1><div class="te">${esc(topic.te)}</div><div class="sub">${esc(topic.sub)}</div></div>
${doc
  ? `<div class="foot withdoc"><div class="dr"><div class="ph"></div><div class="t"><div class="k">${acad ? "Your trainer" : "Your doctor"}</div><div class="dn">${esc(doc.name)}</div><div class="dc">${esc(doc.cred)}</div></div></div>`
  : `<div class="foot"><div class="brand"><div class="n">${esc(brandName)}</div><div class="nt">${esc(brandTe)}</div><div class="a">Opp. Happy Mobiles, R.R. Peta, Eluru · dermaluxe.ai</div></div>`}
<div class="wa"><svg viewBox="0 0 448 512" aria-hidden="true"><path fill="#15120d" d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg><div><div class="l">${esc(waLabel)}</div><div class="num">99591 34666</div></div></div></div>
${doc ? `<div class="addr">${acad ? "DermaLuxe Academy" : "DermaLuxe by Medicare"} · Opp. Happy Mobiles, R.R. Peta, Eluru · dermaluxe.ai</div>` : ""}
<script>
window.__fit = function () {
  var txt = document.querySelector(".txt"), foot = document.querySelector(".foot"), h1 = document.querySelector("h1"), te = document.querySelector(".te"), sub = document.querySelector(".sub");
  var brand = document.querySelector(".brand"), dr = document.querySelector(".dr .t");
  // footer: keep the name on one line next to the pill
  if (brand) {
    var n = parseFloat(getComputedStyle(brand.querySelector(".n")).fontSize);
    while (brand.scrollWidth > brand.clientWidth + 1 && n > 18) { n -= 1; brand.querySelector(".n").style.fontSize = n + "px"; brand.querySelector(".nt").style.fontSize = (n * 0.76) + "px"; brand.querySelector(".a").style.fontSize = (n * 0.68) + "px"; }
  }
  if (dr) {
    var dn = dr.querySelector(".dn"), dc = dr.querySelector(".dc"), a = parseFloat(getComputedStyle(dn).fontSize), c = parseFloat(getComputedStyle(dc).fontSize);
    while (dr.scrollWidth > dr.clientWidth + 1 && a > 24) { a -= 1; dn.style.fontSize = a + "px"; if (c > 14) { c -= 0.5; dc.style.fontSize = c + "px"; } }
  }
  var addr = document.querySelector(".addr");
  if (addr) { var af = 17; while (addr.scrollWidth > addr.clientWidth + 1 && af > 12) { af -= 0.5; addr.style.fontSize = af + "px"; } }
  txt.style.bottom = (1350 - foot.offsetTop + 46) + "px";
  var floor = 1350 * 0.555, h = parseFloat(getComputedStyle(h1).fontSize), t = parseFloat(getComputedStyle(te).fontSize), s = 25;
  for (var i = 0; i < 30 && txt.offsetTop < floor; i++) {
    if (h > 62) { h -= 3; h1.style.fontSize = h + "px"; }
    if (t > 34) { t -= 1; te.style.fontSize = t + "px"; }
    if (s > 21 && i % 3 === 2) { s -= 1; sub.style.fontSize = s + "px"; }
  }
  return { top: txt.offsetTop, h1: h };
};
</script>
</body></html>`;
}

// ---- 5. Render (headless Chromium) ---------------------------------------
// Rendered at 4/3 scale: 1440 × 1800 is Instagram's full 4:5 size, so the gold
// hairlines and the Telugu glyphs stay crisp instead of being upscaled by the app.
async function renderPoster(html) {
  // puppeteer-core 25 / @sparticuz/chromium 152 ship as ES modules — load
  // them with import() so this CommonJS file works on Vercel's Node 24.
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
  const browser = await puppeteer.launch(Object.assign({ defaultViewport: { width: 1080, height: 1350, deviceScaleFactor: 4 / 3 } }, launch));
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 25000 });
    try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
    try { await page.evaluate(() => window.__fit && window.__fit()); } catch (e) {}
    await new Promise((z) => setTimeout(z, 300));
    const buf = await page.screenshot({ type: "jpeg", quality: 90, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
    return Buffer.from(buf).toString("base64");
  } finally { await browser.close().catch(() => {}); }
}

// ---- 6. Orchestrator ---------------------------------------------------------
// opts: {topic?: key, dueMs?: epoch ms (default today 8:30 IST), by?: digits}
// Returns {imgId, caption, topic, due, queued}
// Clinic one day, academy the next — the owner's rotation. On an academy
// day with no live batch (seats gone, or the batch over) it falls back to the
// clinic, so a day is never skipped and a seats poster is never a lie.
const isAcademyDay = (ts) => Math.floor((Number(ts || Date.now()) + IST_MS) / 86400000) % 2 === 1;

async function createDailyPost(cfg, opts = {}) {
  const picked = opts.topic
    ? await pickTopic(cfg, opts.topic)
    : ((!opts.noAlternate && isAcademyDay() && await academyTopic(cfg).catch(() => null)) || await planTopic(cfg));
  const topic = Object.assign({}, picked, { look: await pickLook(cfg).catch(() => LOOKS[0]), note: opts.note || "" });
  const [img, caption] = await Promise.all([genImage(topic), writeCaption(topic)]);
  const doc = await pickDoctor(cfg, topic).catch(() => null);
  const b64 = await renderPoster(posterHtml(topic, img, doc));
  const imgId = crypto.randomBytes(16).toString("hex");
  const due = opts.dueMs || todayAtIst(8, 30);
  const admins = guard.ownerPhones();
  const by = opts.by || admins[0] || "";
  const notifyList = Array.from(new Set(phones(process.env.DAILY_POST_PHONES).length ? phones(process.env.DAILY_POST_PHONES) : admins.concat(phones(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666"))));
  if (cfg) {
    // A preview is shown and then forgotten: the picture is kept just long
    // enough to reach WhatsApp, and nothing else is written. Without this the
    // act of looking at a poster would mark its topic as already used and
    // change what tomorrow posts.
    const keep = opts.preview ? String(Math.max(600, Math.min(1209600, Number(opts.keepSec) || 7200))) : "259200";
    await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, b64, "EX", keep]);
    if (opts.preview) return { imgId, caption, topic, due, by, notify: notifyList, hadImage: !!img, queued: false, preview: true, doctor: doc ? doc.name : "" };
    if (opts.queue !== false) {
      await guard.kvCommand(cfg, ["LPUSH", "adm:queue", JSON.stringify({ imgId, caption, due, by, tries: 0, auto: true, topic: topic.key, notify: notifyList })]);
    }
    await guard.kvCommand(cfg, ["LPUSH", "dp:hist", `${topic.key}|${todayIst()}`]);
    await guard.kvCommand(cfg, ["LPUSH", "dp:looks", topic.look.key]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "dp:looks", "0", "13"]).catch(() => {});
    // today's topic → api/r.js prefills the WhatsApp message for /r/insta & /r/story
    await guard.kvCommand(cfg, ["SET", "dp:today", JSON.stringify({ key: topic.key, h1: topic.h1, te: topic.te, page: topic.page, at: Date.now() }), "EX", "172800"]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "dp:hist", "0", "59"]);
  }
  return { imgId, caption, topic, due, by, notify: notifyList, hadImage: !!img, queued: opts.queue !== false };
}

module.exports = { isAcademyDay, LOOKS, pickLook, DOCTORS, pickDoctor, imagePrompt, TOPICS, ACADEMY_TOPICS, academyTopic, academyState, academySub, createDailyPost, pickTopic, planTopic, leadInsights, posterHtml, renderPoster, genImage, writeCaption, todayAtIst, todayIst, phones };
