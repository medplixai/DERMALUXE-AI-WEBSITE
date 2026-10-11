#!/usr/bin/env node
// A picture on each of the 43 treatment cards on the home page.
//
// The cards are <article class="svc"> with a heading, a Telugu line and a
// description. They carried no picture, so the list read as 43 paragraphs.
//
// Same rules as the treatment pages: the picture shows the CONDITION, never a
// patient, never a result, never a before/after, and the AI source mark 7.2
// requires is stated once for the whole list — forty-three captions under
// forty-three thumbnails would be unreadable, and the clause asks for the
// origin to be stated explicitly, not stated forty-three times.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

// card heading (exactly as it appears in the HTML) → image slug.
// `null`, or a file that does not exist yet, means the card shows no picture.
// It never borrows another card's: the alt text names the condition, so a
// borrowed picture makes the markup state something untrue.
const MAP = {
  "Acne &amp; Acne Scars": "acne-treatment-eluru",
  "Pigmentation &amp; Melasma": "pigmentation-treatment-eluru",
  "Eczema &amp; Dermatitis": "eczema-dry-skin-treatment-eluru",
  "Psoriasis": "psoriasis-treatment-eluru",
  "Vitiligo": "vitiligo-treatment-eluru",
  "Skin Allergies": "skin-allergy-treatment-eluru",
  "Fungal &amp; Skin Infections": "fungal-infection-treatment-eluru",
  "Laser Skin Resurfacing": "card-laser-resurfacing",
  "Skin Cancer Screening": "skin-cancer-screening-eluru",
  "Children's Skin Care": "kids-skin-care-eluru",
  "Leprosy": "card-leprosy",
  "Skin Tuberculosis": "card-skin-tb",
  "HIV/AIDS-related Skin Care": "card-hiv-skin",
  "STD Care &middot; Confidential": "std-intimate-skin-care-eluru",
  "Hair Fall Treatment": "hair-fall-treatment-eluru",
  "Dandruff Management": "dandruff-treatment-eluru",
  "Baldness Solutions": "card-baldness",
  "Alopecia Areata (Patchy)": "alopecia-areata-treatment-eluru",
  "PRP &amp; GFC Hair Therapy": "prp-gfc-hair-therapy-eluru",
  "Hair Transplant (FUE / DHI / Bio-FUE)": "hair-transplant-eluru",
  "Beard &amp; Eyebrow Transplant": "beard-eyebrow-transplant-eluru",
  "Fungal Nail Infections": "nail-problems-treatment-eluru",
  "Ingrown Toenail Treatment": "card-ingrown-nail",
  "Brittle &amp; Discoloured Nails": "card-brittle-nails",
  "Nail Surgery": "card-nail-surgery",
  "Anti-Ageing &amp; Wrinkles": "anti-ageing-treatment-eluru",
  "Botox (Anti-Wrinkle)": "botox-fillers-eluru",
  "Dermal Fillers": "card-fillers",
  "Thread Lift": "thread-lift-eluru",
  "HIFU Skin Tightening": "hifu-face-lift-eluru",
  "MNRF Skin Tightening": "mnrf-treatment-eluru",
  "Chemical Peels": "chemical-peel-eluru",
  "Hydrafacial": "hydrafacial-eluru",
  "Laser Hair Reduction": "laser-hair-removal-eluru",
  "Tattoo &amp; Pigment Removal": "pico-laser-tattoo-removal-eluru",
  "Carbon Laser Facial": "carbon-laser-facial-eluru",
  "Skin Brightening &amp; Glow": "tan-removal-skin-brightening-eluru",
  "Medical Weight Loss Programme": "weight-loss-clinic-eluru",
  "Inch Loss &amp; Body Contouring": "body-contouring-eluru",
  "Non-Surgical Fat Reduction": "card-fat-reduction",
  "Cellulite Reduction": "card-cellulite",
  "Double Chin Reduction": "card-double-chin",
  "Post Weight-Loss Skin Tightening": "card-post-weightloss",
};

// Until the bespoke ones exist, the nearest honest stand-in. A card with no
// picture in a grid of pictures looks broken, and these are not misleading —

const exists = (slug) => slug && fs.existsSync(path.join(ROOT, "assets", "tx", `${slug}.webp`));

function main() {
  const f = path.join(ROOT, "index.html");
  let s = fs.readFileSync(f, "utf8");
  let done = 0, none = [];

  s = s.replace(/<div class="svc__head">\s*(?:<img class="svc__img"[^>]*>)?\s*<div class="svc__htx">([\s\S]*?)<\/div>\s*<\/div>/g, "$1");
  s = s.replace(/<img class="svc__img"[^>]*>/g, "");

  s = s.replace(/(<article class="svc[^"]*"[^>]*>)(<h4>(.*?)<\/h4>)(<span class="te svc__te">[\s\S]*?<\/span>)?/g, (all, open, h4, title, te) => {
    const slug = MAP[title];
    if (!exists(slug)) { none.push(title); return all; }
    done++;
    const alt = `Illustration of ${title.replace(/&amp;/g, "and").replace(/&middot;/g, "·")} — generated, not a patient`;
    return `${open}<div class="svc__head">` +
      `<img class="svc__img" src="assets/tx/${slug}.webp" alt="${alt}" width="1200" height="800" loading="lazy" decoding="async" />` +
      `<div class="svc__htx">${h4}${te || ""}</div></div>`;
  });

  // One source mark for the whole list, placed under the filter row.
  if (!s.includes("svc-ai-note")) {
    const m = s.match(/<div class="svc-tabs[^"]*"[^>]*>[\s\S]*?<\/div>/);
    if (m) {
      s = s.replace(m[0], m[0] + `
          <p class="svc-ai-note">The pictures below illustrate what each condition looks like. They are generated with AI — none is a photograph of a patient, and none shows a result.<span class="te tsub">కింది బొమ్మలు ఆ సమస్య ఎలా ఉంటుందో చూపుతాయి. ఇవి AI తో రూపొందించినవి — ఏదీ రోగి ఫోటో కాదు, ఏదీ ఫలితం కాదు.</span></p>`);
    } else console.error("  ! could not find the filter row to put the AI note under");
  }

  fs.writeFileSync(f, s);
  console.log(`  cards with their own image : ${done}`);
  console.log(`  cards still waiting        : ${none.length}`);
  none.forEach(t => console.log(`      ${t}  ->  ${MAP[t] || "(no subject yet)"}`));
}
main();
