#!/usr/bin/env node
// A picture for every treatment page.
//
// 88 of the 92 public pages carry no picture at all, which is the single
// biggest reason the site reads as a wall of text. These are generated with
// Gemini, the same key and the same models the daily poster already uses.
//
// THREE THINGS ARE NEVER GENERATED, and the prompts below are written so the
// model cannot drift into them:
//   · no people — a face on a treatment page reads as a patient and as a
//     result, which is NMC 7.2(b) and 8.1(v) at once;
//   · no clinic, no treatment room, no staff — a generated picture of this
//     clinic's facilities is an unverifiable representation of a healthcare
//     service under 7.2(a), and 9.1 allows only verifiable particulars;
//   · nothing that reads as a before, an after, or a result.
// What is left is atmosphere: light, water, texture, material. Every image
// carries the AI source mark 7.2 makes compulsory, in the figcaption, where a
// reader sees it — not in a file name nobody reads.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

// Node does not read .env by itself, and telling somebody to write one and
// then not reading it is a trap. No dependency: the file is KEY=value lines.
(function loadEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();
const OUT = path.join(ROOT, "assets", "tx");
const MODELS = [process.env.DAILY_IMAGE_MODEL, "gemini-3-pro-image", "gemini-2.5-flash-image"].filter((m, i, a) => m && a.indexOf(m) === i);

const LOOK = "Clinical dermatology reference photograph, extreme macro, filling the whole frame. Indian / South Asian skin. Natural indoor light, honest and unretouched, not beautified, not dramatised. NO face — no eyes, no mouth, no nose, no recognisable portrait, nothing by which a person could be identified. ONE untreated area only: never a treated side, never a comparison, never a split frame, never anything that suggests a result or an improvement. No text, no logos, no instruments, no hands, no clinic, no people posing.";

// page → the thing the picture is ABOUT, kept abstract on purpose.
const SUBJECTS = {
  // What the patient arrives with — the condition, on skin, never a result.
  "acne-treatment-eluru":            "Cheek skin with active inflammatory acne: papules, a few pustules, post-acne marks, visible pores.",
  "pigmentation-treatment-eluru":    "Cheekbone skin with melasma: soft-edged brown patches of uneven pigment.",
  "dark-circles-treatment-eluru":    "The under-eye area only, cropped well below the eye itself: darkened, slightly hollowed skin.",
  "open-pores-oily-skin-treatment-eluru": "Nose and inner-cheek skin with enlarged open pores and an oily sheen.",
  "stretch-marks-treatment-eluru":   "Skin of the flank with fresh reddish-purple stretch marks running in parallel bands.",
  "anti-ageing-treatment-eluru":     "Skin at the outer corner of the eye socket, cropped away from the eye: fine crepey lines and loss of firmness.",
  "chemical-peel-eluru":             "Dull, uneven facial skin with blocked pores, patchy tone and rough texture.",
  "carbon-laser-facial-eluru":       "Oily T-zone skin with congestion, blackheads and visible pores.",
  "hydrafacial-eluru":               "Cheek skin that is dehydrated and dull: fine flaking, blocked pores, warm natural skin colour, clearly living skin and not grey or clay-like.",
  "tan-removal-skin-brightening-eluru": "Forearm skin with a sharp sun-tan line: darkened exposed skin beside untanned skin.",
  "glutathione-skin-whitening-eluru":"Uneven, sun-dulled facial skin with blotchy tone.",
  "skin-allergy-treatment-eluru":    "Skin with an urticarial allergic rash: raised pink weals on normal skin.",
  "eczema-dry-skin-treatment-eluru": "Skin at the inner elbow with eczema: dry, cracked, thickened and scaly.",
  "psoriasis-treatment-eluru":       "Skin at the knee with a psoriasis plaque: thickened red skin under silvery scale.",
  "fungal-infection-treatment-eluru":"Skin with tinea: a ring-shaped scaly patch with a raised active edge.",
  "vitiligo-treatment-eluru":        "Skin with vitiligo: a well-defined patch of depigmented white skin beside normal skin.",
  "warts-moles-skin-tags-removal-eluru": "Skin of the neck with several small skin tags and a raised mole.",
  "nail-problems-treatment-eluru":   "A toenail with onychomycosis: thickened, yellowed, crumbling at the free edge.",
  "skin-cancer-screening-eluru":     "A single asymmetric mole on skin with irregular borders and uneven colour.",
  "kids-skin-care-eluru":            "A child's cheek skin with dry atopic patches, gentle and non-distressing.",
  "mens-skin-hair-clinic-eluru":     "Male jaw skin with razor bumps, ingrown hairs and post-inflammatory marks.",
  "std-intimate-skin-care-eluru":    "Plain healthy skin texture, neutral and non-specific, nothing identifiable or intimate.",
  "pico-laser-tattoo-removal-eluru": "Forearm skin with a small dark amateur tattoo, ink visibly within the skin.",
  "laser-hair-removal-eluru":        "Skin of a forearm with coarse dark unwanted hair and a few ingrown bumps.",
  "beard-eyebrow-transplant-eluru":  "Jawline skin with patchy beard growth: bare areas between sparse coarse hairs.",
  "hair-fall-treatment-eluru":       "A scalp parting with hair fall: the parting widened, loose hairs visible.",
  "female-hair-loss-treatment-eluru":"A woman's centre parting widened by diffuse thinning, scalp showing through.",
  "hair-transplant-eluru":           "Macro of a receded frontal hairline seen from above, cropped to hairline and scalp only with no eyebrows, eyes or face in frame: bare scalp behind, thinner hair at the temples.",
  "prp-hair-treatment-eluru":        "A crown with early thinning: finer, shorter hairs and scalp visible between them.",
  "prp-gfc-hair-therapy-eluru":      "A scalp with reduced density: fine hairs spaced wide apart.",
  "alopecia-areata-treatment-eluru": "A scalp with one smooth round bald patch of alopecia areata, surrounding hair normal.",
  "grey-hair-treatment-eluru":       "Dark hair with early greying: scattered white strands through the dark.",
  "premature-grey-hair-treatment-eluru": "Macro of hair at the temple only, cropped to hair and scalp with no facial features in frame: dark hair with scattered premature grey strands.",
  "dandruff-treatment-eluru":        "A scalp with dandruff: white flakes among the hair at the parting.",
  "mnrf-treatment-eluru":            "Cheek skin with rolling and boxcar acne scars, uneven in depth.",
  "thread-lift-eluru":               "Macro of the jawline and upper neck only, cropped below the mouth with no lips or chin tip in frame: skin with early laxity and softened definition.",
  "hifu-face-lift-eluru":            "Skin under the jaw with mild sagging and loss of contour.",
  "botox-fillers-eluru":             "Forehead skin with dynamic lines across it, at rest.",
  "body-contouring-eluru":           "Skin of the flank with soft localised fullness and mild laxity.",
  "weight-loss-clinic-eluru":        "Skin of the abdomen with mild laxity after weight change.",
  "bridal-skin-hair-package-eluru":  "Dull, uneven facial skin with blocked pores and patchy tone.",
  "online-dermatologist-consultation": "Plain healthy skin texture, neutral, nothing identifiable.",
  "skin-clinic-eluru":               "Facial skin showing several common concerns together: uneven tone, visible pores, a few marks.",
  "treatments":                      "Plain healthy skin texture in close macro, neutral and calm.",
  "blog-why-pimples-keep-coming-back": "Cheek skin with recurring acne: a mix of active spots and older marks.",
};


// The Telugu edition of an English page, read from the page's own link.
function twin(enPage) {
  const f = path.join(ROOT, enPage);
  if (!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, "utf8").match(/href="([a-z0-9-]*telugu[a-z0-9-]*\.html)"/);
  return m && fs.existsSync(path.join(ROOT, m[1])) ? m[1] : null;
}

// Every public page that ought to get a picture, so one with no subject is
// reported rather than quietly left out.
const NOT_A_TREATMENT = new Set(["staff.html", "leads.html", "marketing.html", "my.html", "pay.html",
  "offline.html", "404.html", "academy-join.html", "staff-app.html", "portal.html", "privacy.html",
  "terms.html", "cookies.html", "careers.html", "index.html", "academy.html", "blog.html"]);
function uncovered() {
  return fs.readdirSync(ROOT)
    .filter((f) => f.endsWith(".html") && !/telugu/.test(f) && !NOT_A_TREATMENT.has(f) && !f.startsWith("google"))
    .map((f) => f.replace(/\.html$/, ""))
    .filter((s) => !(s in SUBJECTS));
}

async function gemini(model, body, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
  });
  if (!r.ok) { const e = new Error(`gemini ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 180)}`); e.status = r.status; throw e; }
  return r.json();
}

async function draw(subject, key) {
  const prompt = `${subject}\n\n${LOOK}`;
  for (const model of MODELS) {
    try {
      const d = await gemini(model, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: Object.assign({ aspectRatio: "3:2" }, /pro/.test(model) ? { imageSize: "2K" } : {}) },
      }, key);
      const p = ((((d.candidates || [])[0] || {}).content || {}).parts || []).find((x) => x.inlineData);
      if (p) return Buffer.from(p.inlineData.data, "base64");
    } catch (e) {
      console.error("  !", e.message);
      if (e.status === 429 || e.status >= 500) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  return null;
}

// The <figure> that goes into the page. The AI line is part of the caption,
// not a hidden attribute: 7.2 wants the source mark where the reader sees it.
const figure = (slug, alt) => `
      <figure class="tx-fig">
        <img src="assets/tx/${slug}.webp" alt="${alt}" width="1200" height="800" loading="lazy" decoding="async" />
        <figcaption>Illustration of the condition — not a photograph of a patient, and not a result. Generated with AI.<span class="te">ఇది ఆ సమస్య ఎలా ఉంటుందో చూపే బొమ్మ — ఏ రోగి ఫోటో కాదు, ఫలితం కాదు. AI తో రూపొందించినది.</span></figcaption>
      </figure>`;

async function main() {
  const dry = process.argv.includes("--dry");
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
  // The key is needed only to DRAW. Placing an image that already exists must
  // work without one, or there is no way to check where the figure lands
  // before paying to generate thirty-one of them.
  const key = process.env.DAILY_GEMINI_KEY || process.env.GEMINI_API_KEY;
  fs.mkdirSync(OUT, { recursive: true });
  let made = 0, placed = 0, skipped = 0;

  for (const [slug, subject] of Object.entries(SUBJECTS)) {
    if (only && slug !== only) continue;
    const webp = path.join(OUT, `${slug}.webp`);
    if (!fs.existsSync(webp)) {
      if (dry) { console.log(`  would draw  ${slug}`); skipped++; continue; }
      if (!key) { console.log(`  no key, cannot draw ${slug} — skipping`); skipped++; continue; }
      // Two ways the key is present but not a key, and they need different
      // answers — a message that names the wrong one sends somebody looking in
      // the wrong place.
      const placeholder = /^\[SENSITIVE\]?$/i.test(key) ? "sensitive"
        : /^(mee_key|your_key|…|\.\.\.|xxx+)$/i.test(key) ? "example"
        : key.length < 20 ? "short" : null;
      if (placeholder) {
        if (placeholder === "sensitive") {
          console.error("\n  That is Vercel's [SENSITIVE] placeholder, not a key. Every variable on");
          console.error("  this project is marked Sensitive, which makes it write-only: `vercel env");
          console.error("  pull` reports success and returns [SENSITIVE] for all of them.");
        } else if (placeholder === "example") {
          console.error(`\n  .env still holds the example text (${key}), not a real key.`);
        } else {
          console.error(`\n  The key in .env is ${key.length} characters. A Gemini key is about 39 and starts AIza.`);
        }
        // Do NOT print a copyable command containing a placeholder. Twice now
        // an example line has been run verbatim, which is a fair thing to do
        // with a command somebody hands you — so hand over one that is whole.
        console.error("\n  The key is at aistudio.google.com/apikey — it starts AIza and is about");
        console.error("  39 characters. To put it in, run this (it opens the file, nothing to");
        console.error("  fill in on the command line):");
        console.error("\n      open -e .env\n");
        console.error("  then replace everything after the = with the key, save, and close.");
        console.error("  .env is in .gitignore (line 7, `.env*`), so it cannot be committed.");
        process.exit(3);
      }
      // No format check beyond "not obviously a placeholder". Google issues
      // keys starting AIza and, more recently, AQ. — a pattern test here would
      // have rejected a perfectly good key and sent somebody back to look for
      // one they already had. The API is the only authority on whether a key
      // works, so let it answer.
      process.stdout.write(`  drawing ${slug} … `);
      const buf = await draw(subject, key);
      if (!buf) { console.log("failed"); skipped++; continue; }
      const raw = path.join(OUT, `${slug}.png`);
      fs.writeFileSync(raw, buf);
      execFileSync("magick", [raw, "-resize", "1200x800^", "-gravity", "center", "-extent", "1200x800", raw]);
      execFileSync("cwebp", ["-q", "78", raw, "-o", webp], { stdio: "ignore" });
      fs.unlinkSync(raw);
      console.log(`${Math.round(fs.statSync(webp).size / 1024)} KB`);
      made++;
    }
    // Put it on both language editions. The Telugu file is NOT a predictable
    // transform of the English one — alopecia-areata-treatment-eluru pairs with
    // alopecia-areata-eluru-telugu, glutathione-skin-whitening with
    // glutathione-eluru-telugu — and a guessed name fails silently, leaving
    // half the Telugu site without pictures and nothing to say so. Every
    // English page names its twin in the "ఈ పేజీ తెలుగులో చదవండి" link, so ask
    // the page.
    for (const page of [`${slug}.html`, twin(`${slug}.html`)].filter(Boolean)) {
      const f = path.join(ROOT, page);
      if (!fs.existsSync(f)) continue;
      let s = fs.readFileSync(f, "utf8");
      if (s.includes("tx-fig")) continue;
      const m = s.match(/<\/section>/);
      if (!m) continue;
      const alt = subject.replace(/"/g, "'").slice(0, 150);
      s = s.slice(0, m.index) + figure(slug, alt) + "\n    " + s.slice(m.index);
      if (!dry) fs.writeFileSync(f, s);
      placed++;
    }
  }
  console.log(`\n  drawn ${made} · placed on ${placed} page(s) · skipped ${skipped}${dry ? "  (dry run — nothing written)" : ""}`);
  const gaps = uncovered();
  if (gaps.length) {
    console.log(`\n  ✗ ${gaps.length} public page(s) have no subject and would get nothing:`);
    gaps.forEach((g) => console.log("      " + g));
  } else {
    console.log("  every public treatment page has a subject");
  }
  const noTwin = Object.keys(SUBJECTS).filter((s2) => fs.existsSync(path.join(ROOT, `${s2}.html`)) && !twin(`${s2}.html`));
  if (noTwin.length) console.log(`\n  note — no Telugu edition found for: ${noTwin.join(", ")}`);
}
main();
