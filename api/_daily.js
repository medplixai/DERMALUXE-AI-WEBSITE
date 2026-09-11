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

const IST_MS = 330 * 60000;
const SITE = "https://www.dermaluxe.ai";
const STYLE = "Premium editorial photograph for a luxury dermatology clinic's Instagram. Cinematic soft lighting, dark charcoal-black background with warm golden accents, shallow depth of field, ultra-realistic, tasteful, South Indian people when a person is shown, no text, no logos, no watermarks, no medical gore, portrait orientation 4:5.";

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
  { key: "doctor", pillar: "trust", h1: "Every treatment by an MD dermatologist", te: "ప్రతి చికిత్స MD చర్మ వైద్యులచే", sub: "Not a parlour · Medical-grade products · USFDA machines", page: "skin-clinic-eluru.html", img: "Elegant modern dermatology clinic consultation room with a gold-accented desk lamp and soft warm light, empty chair, dark luxurious tones, no people." },
  { key: "tech", pillar: "trust", h1: "USFDA-approved lasers in Eluru", te: "ఏలూరులో USFDA ఆమోదిత లేజర్లు", sub: "PICO · Diode · Carbon laser · HIFU · MNRF", page: "skin-clinic-eluru.html", img: "Sleek modern aesthetic laser device in a dark luxurious treatment room, soft golden accent lighting, no people, no visible brand names." },
  { key: "glutathione", pillar: "tx", h1: "Glutathione skin brightening", te: "గ్లూటాథయోన్ స్కిన్ బ్రైటనింగ్", sub: "Even tone & glow · Doctor-supervised · Honest expectations", page: "glutathione-skin-whitening-eluru.html", img: "Radiant glowing skin close-up of a South Indian woman, soft golden light, dark background, serene beauty." },
  { key: "carbon", pillar: "tx", h1: "Carbon laser facial before the event", te: "ఈవెంట్ ముందు కార్బన్ లేజర్ ఫేషియల్", sub: "Instant glow · Tighter pores · Zero downtime", page: "carbon-laser-facial-eluru.html", img: "Close-up of a South Indian woman's glowing cheek with soft golden light, party-ready look, dark elegant background." },
  { key: "anti-ageing", pillar: "tx", h1: "Fine lines? Start early, stay natural", te: "సన్నని గీతలు — ముందే మొదలుపెట్టండి", sub: "Botox · Fillers · HIFU · Skin boosters — subtle, never overdone", page: "anti-ageing-treatment-eluru.html", img: "Elegant South Indian woman in her late 30s with smooth natural skin, soft smile, golden rim light, dark background." },
  { key: "beard", pillar: "tx", h1: "Patchy beard? Beard transplant", te: "గడ్డం పాచెస్ — గడ్డం ట్రాన్స్‌ప్లాంట్", sub: "Natural density · Doctor-performed · Eyebrows too", page: "beard-eyebrow-transplant-eluru.html", img: "South Indian man with a full dense well-shaped beard, close portrait, moody golden studio light, dark background." },
  { key: "vitiligo", pillar: "edu", h1: "White patches: treatable, not contagious", te: "బొల్లి — చికిత్స ఉంది, అంటువ్యాధి కాదు", sub: "Early treatment gives the best repigmentation", page: "vitiligo-treatment-eluru.html", img: "Two hands gently holding each other in warm golden light, dark background, compassion mood, no visible skin condition." },
  { key: "warts", pillar: "tx", h1: "Warts, moles & skin tags removal", te: "పులిపిర్లు, పుట్టుమచ్చలు తొలగింపు", sub: "RF / laser · 10 minutes · Minimal marks", page: "warts-moles-skin-tags-removal-eluru.html", img: "Elegant close-up of smooth clear skin on a neck and collarbone in soft golden light, dark background." },
  { key: "weight", pillar: "tx", h1: "Medical weight loss, doctor-supervised", te: "డాక్టర్ పర్యవేక్షణలో బరువు తగ్గడం", sub: "Body contouring · Diet plan · No crash diets", page: "weight-loss-clinic-eluru.html", img: "Fit South Indian woman in elegant dark activewear, confident posture, golden rim light, dark background." },
  { key: "psoriasis", pillar: "edu", h1: "Psoriasis flares can be controlled", te: "సోరియాసిస్ — అదుపులో ఉంచొచ్చు", sub: "Modern treatments · Long remissions · Stop the itch cycle", page: "psoriasis-treatment-eluru.html", img: "Calm South Indian person's relaxed hands resting on a dark surface in warm golden light, serene mood." },
  { key: "monsoon", pillar: "season", h1: "Monsoon skin & hair care", te: "వర్షాకాలం చర్మం & జుట్టు సంరక్షణ", sub: "Fungal infections · Frizz & hair fall · Sticky skin", page: "fungal-infection-treatment-eluru.html", img: "Rain drops on a dark window with warm golden bokeh lights behind, moody monsoon evening, no people." },
  { key: "festive", pillar: "season", h1: "Festival-ready glow in 2 weeks", te: "పండుగకు 2 వారాల్లో గ్లో", sub: "Hydrafacial · Peel · Carbon laser — plan it early", page: "hydrafacial-eluru.html", img: "Elegant South Indian woman in a silk saree with glowing skin beside warm golden diya lights, dark background." },
  { key: "review", pillar: "trust", h1: "3 lakh+ happy clients, 10 branches", te: "3 లక్షలకు పైగా సంతృప్త క్లయింట్లు", sub: "Medicare Skin & Hair family · Now in Eluru", page: "index.html", img: "Warm luxurious clinic reception with soft pink sofas and golden accent light, empty, dark elegant tones." },
];

const PILLAR_BY_DAY = ["tips", "edu", "tx", "myth", "trust", "cta", "season"]; // Sun..Sat

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
    const t = TOPICS.find((x) => x.key === forceKey);
    if (t) return t;
  }
  let recent = [];
  if (cfg) { try { const r = await guard.kvCommand(cfg, ["LRANGE", "dp:hist", "0", "19"]); recent = (r.result || []).map((s) => String(s).split("|")[0]); } catch (e) {}
  }
  const pillar = PILLAR_BY_DAY[istDow()];
  let pool = TOPICS.filter((t) => t.pillar === pillar && recent.indexOf(t.key) === -1);
  if (!pool.length) pool = TOPICS.filter((t) => recent.indexOf(t.key) === -1);
  if (!pool.length) pool = TOPICS;
  // seasonal nudges
  const m = new Date(Date.now() + IST_MS).getUTCMonth() + 1;
  const boost = (k) => { const t = pool.find((x) => x.key === k); return t && Math.random() < 0.5 ? t : null; };
  if (m >= 6 && m <= 9) { const t = boost("monsoon") || boost("fungal"); if (t) return t; }
  if (m === 10 || m === 11) { const t = boost("festive") || boost("bridal"); if (t) return t; }
  if (m >= 3 && m <= 5) { const t = boost("tan") || boost("sunscreen"); if (t) return t; }
  if (m === 12 || m === 1 || m === 2) { const t = boost("bridal"); if (t) return t; }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- 2. Caption (Claude) ---------------------------------------------------
async function writeCaption(topic) {
  const sys = `You write Instagram captions for DermaLuxe by Medicare — premium skin/hair/aesthetics clinic in Eluru, Andhra Pradesh (MD dermatologists, USFDA technology, part of Medicare Skin & Hair, 10 branches). Style: premium yet warm, patient-first, educational; 4-7 short lines; English with ONE Telugu line; NEVER prices, NEVER "guaranteed" or "permanent cure", no emojis in the first line, max 3 emojis total. End with exactly these 3 lines:\n"📲 WhatsApp: 99591 34666 · wa.me/919959134666\nFree AI skin & hair analysis — link in bio 👆\n📍 Opposite Happy Mobiles, R.R. Peta, Eluru"\nthen 7-9 hashtags mixing #DermaLuxeEluru #SkinClinicEluru #DermatologistEluru #Eluru plus topic tags. Output ONLY JSON: {"caption":"..."}`;
  const user = `Today's poster: headline "${topic.h1}" · Telugu line "${topic.te}" · sub-line "${topic.sub}". Website page: ${SITE}/${topic.page}. Write the caption.`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.DAILY_CAPTION_MODEL || process.env.AI_MODEL || "claude-sonnet-5", max_tokens: 700, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) throw new Error("claude HTTP " + resp.status);
    const data = await resp.json();
    const t = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
    const m = t.match(/\{[\s\S]*\}/);
    const p = JSON.parse(m ? m[0] : t);
    if (p && p.caption) {
      let c = String(p.caption).slice(0, 1900);
      if (!/wa\.me\/919959134666/.test(c)) c += "\n\n📲 WhatsApp: 99591 34666 · wa.me/919959134666";
      return c;
    }
  } catch (e) { console.error("daily: caption", e && e.message); }
  return `${topic.h1}\n${topic.te}\n\n${topic.sub}.\nEvery treatment at DermaLuxe is planned by MD dermatologists with USFDA-approved technology.\n\n📲 WhatsApp: 99591 34666 · wa.me/919959134666\nFree AI skin & hair analysis — link in bio 👆\n📍 Opposite Happy Mobiles, R.R. Peta, Eluru\n\n#DermaLuxeEluru #SkinClinicEluru #DermatologistEluru #Eluru #HairClinicEluru #SkinCare #AndhraPradesh`;
}

// ---- 3. Background image (Gemini) ---------------------------------------
async function genImage(topic) {
  const key = process.env.DAILY_GEMINI_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.DAILY_IMAGE_MODEL || "gemini-2.5-flash-image";
  const body = { contents: [{ parts: [{ text: STYLE + " Subject: " + topic.img }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5" } } };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
      });
      if (!r.ok) { console.error("daily: gemini HTTP", r.status, (await r.text()).slice(0, 200)); if (r.status === 429 || r.status >= 500) { await new Promise((z) => setTimeout(z, 4000)); continue; } return null; }
      const d = await r.json();
      const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
      const p = parts.find((x) => x.inlineData);
      if (p) return { b64: p.inlineData.data, mime: p.inlineData.mimeType || "image/png" };
      return null;
    } catch (e) { console.error("daily: gemini", e && e.message); }
  }
  return null;
}

// ---- 4. Poster HTML ---------------------------------------------------------
let LOGO_B64 = null;
function logoB64() {
  if (LOGO_B64) return LOGO_B64;
  try { LOGO_B64 = fs.readFileSync(path.join(__dirname, "..", "assets", "logo.png")).toString("base64"); } catch (e) { LOGO_B64 = ""; }
  return LOGO_B64;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function posterHtml(topic, img) {
  const bg = img ? `url("data:${img.mime};base64,${img.b64}") center top/cover no-repeat` : "radial-gradient(60% 40% at 50% 22%,rgba(198,162,92,.30),transparent 70%)";
  const h1size = topic.h1.length <= 26 ? 80 : 68;
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Jost:wght@300;400;500&family=Noto+Sans+Telugu:wght@400;500&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:1080px;height:1350px;overflow:hidden}
body{background:#0b0b0e ${bg};color:#ece9e3;font-family:Jost,sans-serif;position:relative}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,11,14,.55) 0%,rgba(11,11,14,0) 22%,rgba(11,11,14,0) 42%,rgba(11,11,14,.85) 64%,#0b0b0e 100%)}
.frame{position:absolute;inset:34px;border:1px solid rgba(233,207,143,.45)}
.logo{position:absolute;top:70px;left:0;right:0;margin:auto;width:300px;filter:drop-shadow(0 2px 10px rgba(0,0,0,.6))}
.city{position:absolute;top:212px;left:0;right:0;text-align:center;font-family:"Noto Sans Telugu",sans-serif;font-size:30px;color:#e9cf8f;letter-spacing:.08em;text-shadow:0 2px 12px rgba(0,0,0,.8)}
.txt{position:absolute;left:90px;right:90px;bottom:212px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:18px}
.eyebrow{font-size:21px;letter-spacing:.32em;text-transform:uppercase;color:#e9cf8f;font-weight:500}
h1{font-family:"Cormorant Garamond",serif;font-weight:600;font-size:${h1size}px;line-height:1.06;margin:0;color:#f6f1e6;text-wrap:balance;text-shadow:0 2px 18px rgba(0,0,0,.7)}
.te{font-family:"Noto Sans Telugu",sans-serif;font-size:42px;line-height:1.5;color:#e9cf8f;text-shadow:0 2px 14px rgba(0,0,0,.8)}
.rule{width:110px;height:1px;background:linear-gradient(90deg,transparent,#e9cf8f,transparent)}
.sub{font-size:26px;font-weight:300;color:#cfc9bd;line-height:1.5;max-width:820px}
.foot{position:absolute;left:0;right:0;bottom:44px;text-align:center}
.site{font-size:34px;letter-spacing:.12em;color:#e9cf8f;font-weight:500;display:flex;align-items:center;justify-content:center;gap:12px}
.wa{width:34px;height:34px}
.name{font-size:24px;color:#f6f1e6;letter-spacing:.04em;margin-top:8px;font-weight:400}
.namete{font-family:"Noto Sans Telugu",sans-serif;font-size:19px;color:#cfc9bd;margin-top:2px}
.addr{font-size:17px;color:#a39e95;letter-spacing:.04em;margin-top:6px}
</style></head><body><div class="shade"></div><div class="frame"></div>
<img class="logo" src="data:image/png;base64,${logoB64()}" alt="">
<div class="city">ఏలూరు</div>
<div class="txt"><div class="eyebrow">Eluru · MD Dermatologists</div><h1>${esc(topic.h1)}</h1><div class="te">${esc(topic.te)}</div><div class="rule"></div><div class="sub">${esc(topic.sub)}</div></div>
<div class="foot"><div class="site"><svg class="wa" viewBox="0 0 448 512" aria-hidden="true"><path fill="#e9cf8f" d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>WhatsApp &nbsp;99591 34666</div><div class="name">DermaLuxe by Medicare Skin And Hair Clinics</div><div class="namete">డెర్మాలక్స్ బై మెడికేర్ స్కిన్ అండ్ హెయిర్ క్లినిక్స్</div><div class="addr">Free AI skin &amp; hair analysis · dermaluxe.ai · Opposite Happy Mobiles, R.R. Peta, Eluru</div></div>
</body></html>`;
}

// ---- 5. Render (headless Chromium) ---------------------------------------
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
  const browser = await puppeteer.launch(Object.assign({ defaultViewport: { width: 1080, height: 1350, deviceScaleFactor: 1 } }, launch));
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 25000 });
    try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
    await new Promise((z) => setTimeout(z, 400));
    const buf = await page.screenshot({ type: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
    return Buffer.from(buf).toString("base64");
  } finally { await browser.close().catch(() => {}); }
}

// ---- 6. Orchestrator ---------------------------------------------------------
// opts: {topic?: key, dueMs?: epoch ms (default today 8:30 IST), by?: digits}
// Returns {imgId, caption, topic, due, queued}
async function createDailyPost(cfg, opts = {}) {
  const topic = await pickTopic(cfg, opts.topic);
  const [img, caption] = await Promise.all([genImage(topic), writeCaption(topic)]);
  const b64 = await renderPoster(posterHtml(topic, img));
  const imgId = crypto.randomBytes(16).toString("hex");
  const due = opts.dueMs || todayAtIst(8, 30);
  const admins = phones(process.env.ADMIN_PHONES);
  const by = opts.by || admins[0] || "";
  const notifyList = Array.from(new Set(phones(process.env.DAILY_POST_PHONES).length ? phones(process.env.DAILY_POST_PHONES) : admins.concat(phones(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666"))));
  if (cfg) {
    await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, b64, "EX", "259200"]);
    if (opts.queue !== false) {
      await guard.kvCommand(cfg, ["LPUSH", "adm:queue", JSON.stringify({ imgId, caption, due, by, tries: 0, auto: true, topic: topic.key, notify: notifyList })]);
    }
    await guard.kvCommand(cfg, ["LPUSH", "dp:hist", `${topic.key}|${todayIst()}`]);
    await guard.kvCommand(cfg, ["LTRIM", "dp:hist", "0", "59"]);
  }
  return { imgId, caption, topic, due, by, notify: notifyList, hadImage: !!img, queued: opts.queue !== false };
}

module.exports = { TOPICS, createDailyPost, pickTopic, posterHtml, renderPoster, genImage, writeCaption, todayAtIst, todayIst, phones };
