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
  "skin-clinic-eluru":               "A still, dark, luxurious surface of stone and glass with warm gold light pooling softly.",
  "treatments":                      "An arrangement of dark glass and stone forms, warm gold light between them.",
};

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
    // put it on both language editions of the page
    for (const page of [`${slug}.html`, `${slug.replace(/-eluru$/, "")}-eluru-telugu.html`, `${slug}-telugu.html`]) {
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
}
main();
