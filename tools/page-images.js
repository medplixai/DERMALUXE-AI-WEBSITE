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

const LOOK = "Dark, luxurious, editorial still life on a near-black background (#0d0d0f) with warm champagne-gold light. Soft shadows, shallow depth of field, fine grain, nothing clinical, nothing medical, no instruments. ABSOLUTELY NO PEOPLE, no faces, no hands, no skin, no body parts. No text, no letters, no numbers, no logos, no watermark. Photographic, 3:2 landscape.";

// page → the thing the picture is ABOUT, kept abstract on purpose.
const SUBJECTS = {
  "acne-treatment-eluru":            "A single clear water droplet resting on a matte dark stone, lit from one side with a thin gold rim.",
  "chemical-peel-eluru":             "Several sheets of translucent frosted glass, stacked and slightly offset, warm gold light passing through the edges.",
  "laser-hair-removal-eluru":        "Fine parallel threads of warm gold light crossing a dark field, like a beam split into strands.",
  "pigmentation-treatment-eluru":    "A drop of warm sepia ink dispersing in still dark water, caught mid-bloom.",
  "hydrafacial-eluru":               "A slow vortex in dark water, gold light catching the spiral, tiny bubbles suspended.",
  "hifu-face-lift-eluru":            "Concentric ripples converging to one point on a dark liquid surface, gold light along each ring.",
  "prp-hair-treatment-eluru":        "Warm amber liquid in motion inside dark glass, caught spinning, light through the fluid.",
  "botox-fillers-eluru":             "A single ribbon of smooth silk suspended in dark air, one gold highlight running along the fold.",
  "carbon-laser-facial-eluru":       "Fine black carbon powder on a dark surface, a sweep of gold light lifting it.",
  "open-pores-oily-skin-treatment-eluru": "Macro of dark volcanic stone with fine pores, raking gold light across the surface.",
  "anti-ageing-treatment-eluru":     "A length of heavy dark silk drawn taut, the folds smoothing out, gold light along the grain.",
  "dark-circles-treatment-eluru":    "Soft shadow dissolving into warm gold light across a dark gradient, like dawn on a matte surface.",
  "stretch-marks-treatment-eluru":   "Fine cracks in dark glazed ceramic, filled with warm gold in the manner of kintsugi.",
  "tan-removal-skin-brightening-eluru": "Warm gold light breaking through dark cloud texture, soft and diffused.",
  "psoriasis-treatment-eluru":       "Calm still water meeting dark stone, a soft gold reflection, nothing disturbed.",
  "vitiligo-treatment-eluru":        "Pale and dark marble meeting in a soft natural boundary, warm gold light across the join.",
  "alopecia-areata-treatment-eluru": "A dark field of fine soft fibres, a small clearing within it catching gold light.",
  "glutathione-skin-whitening-eluru":"Clear liquid in dark glass, light refracting into a warm gold line.",
  "thread-lift-eluru":               "Fine gold threads drawn taut in parallel across a dark field, slight tension visible.",
  "nail-problems-treatment-eluru":   "Smooth polished dark shell with a gold sheen along its curve, macro.",
  "grey-hair-treatment-eluru":       "Dark and silver fibres interleaved, warm gold light along a few of them.",
  "skin-cancer-screening-eluru":     "A fine gold ring of light on dark stone, as if a single point were being examined.",
  "pico-laser-tattoo-removal-eluru": "Dark ink breaking into fine particles in still water, gold light behind.",
  "weight-loss-clinic-eluru":        "Smooth dark pebbles balanced in a quiet stack, warm gold light from one side.",
  "kids-skin-care-eluru":            "Soft dark cotton folds with warm gold light, gentle and calm.",
  "mens-skin-hair-clinic-eluru":     "Dark brushed metal with a warm gold edge light, clean and spare.",
  "bridal-skin-hair-package-eluru":  "Dark silk with a few gold threads woven through, soft folds.",
  "beard-eyebrow-transplant-eluru":  "Fine dark fibres of varying length on a dark ground, gold rim light.",
  "prp-gfc-hair-therapy-eluru":      "Warm amber fluid suspended in dark glass, a single slow swirl.",
  "hair-fall-treatment-eluru":       "A dark field of fine soft fibres thinning towards one side, warm gold rim light.",
  "female-hair-loss-treatment-eluru":"Long dark fibres falling in a soft curve, a few gold threads among them.",
  "dandruff-treatment-eluru":        "Fine pale flakes suspended in dark air, caught in a shaft of warm gold light.",
  "premature-grey-hair-treatment-eluru": "Dark and silver fibres side by side on a dark ground, warm light along the parting.",
  "hair-transplant-eluru":           "Fine dark fibres rising from a dark ground in even rows, gold rim light along each.",
  "eczema-dry-skin-treatment-eluru": "Dry cracked dark clay softening where water has touched it, warm gold light.",
  "skin-allergy-treatment-eluru":    "Soft dark fabric with a faint warm bloom spreading across it, then fading.",
  "fungal-infection-treatment-eluru":"Still dark water with a single clean ring spreading outward, gold light on the ring.",
  "warts-moles-skin-tags-removal-eluru": "A smooth dark stone with one raised bead on its surface, lit from the side in gold.",
  "std-intimate-skin-care-eluru":    "A closed dark envelope of heavy paper with a single gold seal, private and quiet.",
  "mnrf-treatment-eluru":            "A grid of fine gold points of light on dark velvet, evenly spaced, receding into shadow.",
  "body-contouring-eluru":           "Smooth dark sculpted forms in soft shadow, one gold edge light following the curve.",
  "online-dermatologist-consultation": "A single warm gold light in a dark room, as if a lamp were left on for someone.",
  "blog-why-pimples-keep-coming-back": "A dark surface with a repeating pattern that fades and returns, gold light across it.",
  "skin-clinic-eluru":               "A still, dark, luxurious surface of stone and glass with warm gold light pooling softly.",
  "treatments":                      "An arrangement of dark glass and stone forms, warm gold light between them.",
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
const figure = (slug, alt, te) => `
      <figure class="tx-fig">
        <img src="assets/tx/${slug}.webp" alt="${alt}" width="1200" height="800" loading="lazy" decoding="async" />
        <figcaption>🖼️ Image generated with AI.<span class="te"> AI తో రూపొందించిన చిత్రం.</span></figcaption>
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
      if (!/^AIza[\w-]{30,}$/.test(key)) {
        console.error(`\n  That does not look like a Gemini key (starts "${key.slice(0, 4)}", ${key.length} chars).`);
        console.error("  Expected AIza… and about 39 characters. Check aistudio.google.com/apikey.");
        process.exit(3);
      }
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
