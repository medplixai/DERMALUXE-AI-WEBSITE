#!/usr/bin/env node
// A picture for the "About DermaLuxe" panel on the home page.
//
// The one there now is a stock photograph of a woman having a mask applied by
// a gloved hand. tools/page-images.js — this site's own generator — refuses to
// make that kind of picture, and says why: a face reads as a patient and as a
// result (NMC 7.2(b), 8.1(v)), and a generated clinic or treatment room is an
// unverifiable representation of a healthcare service (7.2(a), 9.1). Those
// reasons do not stop applying because the panel is called "About".
//
// So: no people, no room, no staff, no instruments, nothing that reads as a
// result. What is left is what the section is actually claiming — clinical
// exactness and quiet luxury — said in light, material and texture. Three to
// look at, 4:5 to match the frame the CSS gives it.
//
//   node tools/about-image.js            → writes assets/about-ai-1..3.webp
//   node tools/about-image.js --one=2    → just that one, again
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");

(function loadEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();
const MODELS = [process.env.DAILY_IMAGE_MODEL, "gemini-3-pro-image", "gemini-2.5-flash-image"]
  .filter((m, i, a) => m && a.indexOf(m) === i);

// The owner asked for a picture with presence, not a still life, and the panel
// has carried a stock photograph of a woman having a mask applied since the
// site went up. So: a person is allowed here. Two things are not, and they are
// not house style, they are the things that would mislead a patient — a before
// or an after or anything that reads as a result, and anything presented as a
// photograph of this clinic's own rooms or staff. What is left is a brand
// portrait: somebody at rest, in this site's own black and gold.
const RULES_ABOUT = "Editorial beauty photography for a premium skin clinic's brand page. South Asian / Indian woman, mid twenties to thirties, calm, eyes closed or looking away, at rest. Warm near-black background, one soft directional light, champagne-gold rim light, deep shadow, shallow depth of field, expensive and quiet. Natural skin with its own texture, not airbrushed to plastic. NO treatment happening, no mask, no cream, no gloved hands, no instruments, no lasers, no machines, no needles, no products, no bottles. NO clinic interior, no treatment couch, no cabinets, no signage. NO text, no letters, no numbers, no logos, no watermark. Nothing that reads as a before, an after, or a result, and no second person. One person alone. Photographic, not an illustration or a render. Vertical 4:5, composed with room at the lower right where a small dark card sits over the picture.";

// The careers page says "join our team". A generated doctor in a white coat
// would be a member of staff this clinic does not have, which is the one thing
// a careers page must not invent. So: the work, not the worker — the coat on
// its hook, the light in a corridor, the instruments laid out. Nobody in frame.
const RULES_CAREERS = "Editorial still life for a medical clinic's careers page. Warm near-black background, one soft directional light, champagne-gold highlights, deep shadow, shallow depth of field, quiet and expensive. Absolutely NO people: no face, no hands, no body, no silhouette, no reflection of a person. NO text, no letters, no numbers, no logos, no signage, no name badges, no watermark. Nothing that reads as a patient, a treatment or a result. Photographic, not an illustration or a render. ONE single photograph filling the whole frame: no collage, no grid, no split frame, no second picture, no borders, no white margins, no colour chart, no film strip. Vertical 4:5.";

const CAREERS = [
  ["c1", "A crisp white cotton jacket on a wooden hanger against a near-black wall, warm gold light grazing one shoulder, the weave of the cloth and one pressed fold sharp. Empty, nobody wearing it, nothing written on it."],
  ["c2", "Looking down a quiet corridor at the end of the day: dark polished floor, warm light spilling from one open doorway on the left and reflecting along the floor, everything beyond falling into black. Empty, nobody, nothing written anywhere."],
  ["c3", "A clean dark worktop with a folded white towel, an unmarked steel tray and a closed notebook laid out in a row, warm low light raking across them from the left. No instruments, no labels, nobody."],
];

const IDEAS = [
  ["4", "Head-and-shoulders portrait, three-quarter turn away from the camera, eyes closed, chin slightly lifted. Hair drawn back simply. Bare shoulders against darkness, a plain ivory wrap. The gold rim light runs down the line of the cheek and the neck."],
  ["5", "Seated, seen from the side, wrapped in a heavy ivory robe, head tilted back and resting, eyes closed, hands out of frame. Almost the whole frame is shadow; the light finds only the forehead, the cheekbone and the collarbone."],
  ["6", "Close portrait, face filling the upper two thirds, eyes closed, perfectly still. A single soft light from the upper left. The background falls away to near black. Skin reads as healthy and real, pores visible, no gloss."],
];

async function gemini(model, body, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
  });
  if (!r.ok) { const e = new Error(`gemini ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); e.status = r.status; throw e; }
  return r.json();
}

async function draw(subject, key, rules) {
  for (const model of MODELS) {
    try {
      const d = await gemini(model, {
        contents: [{ parts: [{ text: `${subject}\n\n${rules}` }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: Object.assign({ aspectRatio: "4:5" }, /pro/.test(model) ? { imageSize: "2K" } : {}) },
      }, key);
      const p = ((((d.candidates || [])[0] || {}).content || {}).parts || []).find((x) => x.inlineData);
      if (p) return { buf: Buffer.from(p.inlineData.data, "base64"), model };
    } catch (e) {
      console.error("  !", e.message);
      if (e.status === 429 || e.status >= 500) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  return null;
}

(async () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { console.error("No GEMINI_API_KEY — put one in .env and run again."); process.exit(1); }
  const only = (process.argv.find((a) => a.startsWith("--one=")) || "").split("=")[1];
  const set = process.argv.includes("--careers") ? CAREERS : IDEAS;
  const rules = process.argv.includes("--careers") ? RULES_CAREERS : RULES_ABOUT;
  for (const [n, idea] of set) {
    if (only && only !== n) continue;
    process.stdout.write("  " + n + " … ");
    const got = await draw(idea, key, rules);
    if (!got) { console.log("nothing came back"); continue; }
    const png = path.join(ROOT, "assets", `about-ai-${n}.png`);
    const webp = path.join(ROOT, "assets", `about-ai-${n}.webp`);
    fs.writeFileSync(png, got.buf);
    try {
      execFileSync("cwebp", ["-q", "82", png, "-o", webp], { stdio: "ignore" });
      fs.unlinkSync(png);
      console.log((fs.statSync(webp).size / 1024).toFixed(0) + " KB  (" + got.model + ")");
    } catch (e) {
      console.log((fs.statSync(png).size / 1024).toFixed(0) + " KB as png — cwebp not here (" + got.model + ")");
    }
  }
})();
