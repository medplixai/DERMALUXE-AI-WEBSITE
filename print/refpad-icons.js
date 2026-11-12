// Twelve treatment icons for the referral pad, one per tick cell. Re-run:
//   node print/refpad-icons.js            →  print/refpad/<slug>.png (skips ones that exist)
//   node print/refpad-icons.js --force    →  draws them all again
//
// Owner, 12 Nov 2026: "multicolour design, images add". The clinic's own
// treatment photos are close-ups of skin conditions — right for a treatment
// page, wrong for a pad a doctor keeps on the desk. So these are drawn:
// flat icons, one colour each, no people and no faces (a face on clinic
// print reads as a patient, NMC 7.2(b)), no text, white background so they
// sit on a tinted cell. Same key, same models, same request shape as
// tools/page-images.js.
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
const OUT = path.join(__dirname, "refpad");
const MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image"];

// slug, label, hex colour, what the icon shows. Order = the sketch's order.
const ICONS = [
  ["laser-hair-removal", "Laser Hair Removal", "#d9455a", "a sleek handheld laser device tip sending a soft red light beam downward onto a smooth curved surface, a few tiny hair strands fading away"],
  ["hydrafacial", "HydraFacial", "#1f9fd6", "a large glossy water droplet with a swirling vortex inside and small sparkles, a tiny spiral suction tip beside it"],
  ["pico-laser", "Pico Laser", "#7a4fd6", "a bright star-burst laser pulse shattering a dark round ink spot into tiny fading fragments"],
  ["co2-laser", "CO₂ Laser", "#f2892a", "a grid of fine glowing dots of fractional laser light falling onto a smooth rounded layer, a gentle beam from above"],
  ["mnrf", "MNRF", "#15a58a", "a cluster of fine microneedles on a round tip with concentric radio-frequency wave rings glowing around them"],
  ["hifu", "HIFU", "#3273e0", "curved ultrasound waves focusing down to one bright point, with a small upward lifting arrow"],
  ["hair-transplant", "Hair Transplant", "#b8893d", "an implanter pen placing a hair follicle into a row of neatly planted follicles with new short hairs"],
  ["rf", "RF Skin Tightening", "#ea6a4d", "an abstract radio-frequency symbol only: a small rounded probe tip at the bottom sending three nested warm glowing arcs upward, plus a tiny lightning-bolt energy mark — purely abstract, NO body, NO torso, NO skin, NO figure, NO anatomy of any kind"],
  ["skin-lightening", "Skin Lightening", "#e8b422", "a radiant sparkle with soft glow rays and a small shield against a sun, bright and luminous"],
  ["chemical-peel", "Chemical Peels", "#5aa643", "a glass dropper releasing one drop onto a fresh leaf, with a thin translucent layer lifting away at the edge"],
  ["medi-facial", "Medi Facials", "#e2559c", "a soft facial mask brush with a swirl of cream and a small botanical leaf and petals"],
  ["glow-drip", "Glow Drips", "#9b59d6", "an IV drip bag hanging from a hook filled with a glowing golden liquid, a tube, and sparkles around it"],
];

const STYLE = (hex) => `Flat modern vector icon illustration, app-icon style: simple rounded shapes, smooth soft gradients, slight depth, clean edges. Single subject centred, filling about 70% of the frame, on a PURE WHITE background with no border, no frame, no shadow box. Main colour ${hex} with lighter and darker tints of the same colour and small white highlights; at most one small accent in warm gold. ABSOLUTELY NO people, NO faces, NO eyes, NO hands, NO body parts, NO text, NO letters, NO numbers, NO logos, NO watermark.`;

async function gemini(model, body, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
  });
  if (!r.ok) { const e = new Error(`gemini ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 180)}`); e.status = r.status; throw e; }
  return r.json();
}

async function draw([slug, label, hex, what], key) {
  const prompt = `Icon for "${label}": ${what}.\n\n${STYLE(hex)}`;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const d = await gemini(model, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
        }, key);
        const p = ((((d.candidates || [])[0] || {}).content || {}).parts || []).find((x) => x.inlineData);
        if (p) return Buffer.from(p.inlineData.data, "base64");
      } catch (e) {
        console.error("  !", slug, e.message);
        if (e.status === 429 || e.status >= 500) await new Promise((r) => setTimeout(r, 5000));
        else break;
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
  const todo = ICONS.filter(([slug]) => force || !fs.existsSync(path.join(OUT, slug + ".png")));
  console.log(`${todo.length} of ${ICONS.length} to draw`);
  // Three at a time: fast enough, and under the per-minute quota.
  let i = 0, done = 0, failed = [];
  await Promise.all([0, 1, 2].map(async () => {
    while (i < todo.length) {
      const ic = todo[i++];
      const buf = await draw(ic, key);
      if (buf) { fs.writeFileSync(path.join(OUT, ic[0] + ".png"), buf); done++; console.log("  ✓", ic[0], Math.round(buf.length / 1024) + " KB"); }
      else failed.push(ic[0]);
    }
  }));
  console.log(`${done} drawn${failed.length ? ", FAILED: " + failed.join(", ") : ""}`);
  process.exit(failed.length ? 1 : 0);
})();

module.exports = { ICONS };
