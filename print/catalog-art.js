// Illustrations for the doctors' catalog (print/make-doctor-catalog.js).
//   node print/catalog-art.js           →  print/catalog/art/<slug>.png (skips ones that exist)
//   node print/catalog-art.js --force   →  draws them all again
//
// Owner, 12 Nov 2026: a catalog the field team carries to doctors, "manchi
// images create chesi". The clinic itself is photographed — real rooms, real
// machines, real doctors — and those photos carry the catalog. These three
// are the pictures a photograph cannot be: inside the skin, inside a hair
// follicle, light entering tissue. Anatomy, never a person: no faces, no
// patients (NMC 7.2(b)), and the catalog marks them as AI illustrations
// (NMC 7.2). Colours are the clinic's own interior — blush, mauve, gold.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
(function loadEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();
const OUT = path.join(__dirname, "catalog", "art");
const MODELS = ["gemini-3-pro-image", "gemini-2.5-flash-image"];

const STYLE = `Refined medical illustration for a premium dermatology clinic's printed brochure for doctors. Soft 3D render, scientifically accurate anatomy, gentle studio lighting, shallow depth, clean and calm. Palette strictly: blush pink (#f3d6da), dusty rose, deep mauve (#6e3b4b), warm cream, with fine metallic gold (#b8893d) accents. Plain warm-white background that fades to pure white at the edges, no frame, no border. ABSOLUTELY NO text, NO letters, NO labels, NO numbers, NO arrows, NO logos, NO watermark, NO people, NO faces, NO hands.`;
const ART = [
  ["skin-layers", "4:3", "A clean cross-section block of human skin, seen at a three-quarter angle: the thin epidermis on top, the thicker dermis with fine collagen fibres and small blood vessels, the soft subcutaneous fat lobules at the bottom; one hair follicle with its shaft rising through the surface and a small sebaceous gland beside it."],
  ["hair-follicle", "4:3", "A cross-section of scalp showing three healthy hair follicles side by side, each with its bulb, root sheath and shaft emerging through the skin surface, a fine network of capillaries around the bulbs; elegant and precise, like a premium textbook plate."],
  ["light", "4:3", "The same style of clean skin cross-section block seen at a three-quarter angle, with a neat row of very fine parallel beams of warm golden light coming straight down from above and entering the surface, each beam leaving a thin glowing micro-column in the dermis; the beams start in empty space at the top of the image, no device, no machine, no hand."],
];

async function gemini(model, body, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
  });
  if (!r.ok) { const e = new Error(`gemini ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 180)}`); e.status = r.status; throw e; }
  return r.json();
}
async function draw([slug, ratio, what], key) {
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const d = await gemini(model, { contents: [{ parts: [{ text: `${what}\n\n${STYLE}` }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratio } } }, key);
        const p = ((((d.candidates || [])[0] || {}).content || {}).parts || []).find((x) => x.inlineData);
        if (p) return Buffer.from(p.inlineData.data, "base64");
      } catch (e) {
        console.error("  !", slug, e.message);
        if (e.status === 429 || e.status >= 500) await new Promise((r) => setTimeout(r, 5000)); else break;
      }
    }
  }
  return null;
}
if (require.main === module) (async () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { console.error("GEMINI_API_KEY missing in .env"); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const force = process.argv.includes("--force");
  const todo = ART.filter(([slug]) => force || !fs.existsSync(path.join(OUT, slug + ".png")));
  console.log(`${todo.length} of ${ART.length} to draw`);
  const res = await Promise.all(todo.map(async (a) => { const b = await draw(a, key); if (b) { fs.writeFileSync(path.join(OUT, a[0] + ".png"), b); console.log("  ✓", a[0], Math.round(b.length / 1024) + " KB"); } return !!b; }));
  process.exit(res.every(Boolean) ? 0 : 1);
})();
module.exports = { ART };
