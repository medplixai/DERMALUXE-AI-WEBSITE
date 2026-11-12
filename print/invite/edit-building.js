// The clinic's own front photo, brightened, with a guest on the steps, for the
// opening invitation. Input building-original.jpg (the owner's phone photo),
// output building-v<N>.jpg. The building, the sign and the street are the real
// ones; the woman on the steps is generated. Re-run:
//   node print/invite/edit-building.js [variant number]
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
(function loadEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const PROMPT = `Edit this photograph of a clinic building. Keep the building, its shape, every window, the glass facade, the steps, the railings and the street exactly as they are. Keep the illuminated "DERMALUXE by MediCare SKIN & HAIR CLINIC" sign exactly as it is, letter for letter, and leave every other sign and board unchanged.

1. Lighting: make it the warm golden hour just after sunset. A soft blue-violet evening sky with a little warm glow instead of the flat grey cloud. All the building's lights on and glowing warmly: the gold strip lights along the roof and the edges, the ceiling spotlights over the entrance, the sign glowing bright, and warm light pouring out through the glass doors. The facade lit evenly so it looks premium and inviting. Natural photograph, not a render.

2. Remove the bicycle in front of the steps and the elderly man standing on the right; replace them with clean empty steps and street.

3. Add one elegant, beautiful Indian woman in her late twenties standing on the middle of the entrance steps, turned slightly towards the camera with a warm, welcoming smile, as if greeting guests at the opening. She wears a rich silk saree in deep maroon and gold with a gold border, simple gold jewellery, hair neatly tied back with jasmine flowers. Full figure visible, natural proportions, lit by the warm light from the entrance. She is a guest, not a patient: nothing about her skin or face suggests a treatment or a result.

Keep the original framing and vertical composition. No added text, no watermark.`;

(async () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing from .env");
  const n = process.argv[2] || "1";
  const src = fs.readFileSync(path.join(__dirname, "building-original.jpg")).toString("base64");
  for (const model of ["gemini-3-pro-image-preview", "gemini-3-pro-image"]) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: "image/jpeg", data: src } }, { text: PROMPT }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: "2K" } },
      }),
    });
    if (!r.ok) { console.error(model, r.status, (await r.text()).slice(0, 200)); continue; }
    const d = await r.json();
    const p = ((((d.candidates || [])[0] || {}).content || {}).parts || []).find((x) => x.inlineData);
    if (!p) { console.error(model, "no image", JSON.stringify(d.candidates?.[0]?.finishReason)); continue; }
    const out = path.join(__dirname, `building-v${n}.jpg`);
    fs.writeFileSync(out, Buffer.from(p.inlineData.data, "base64"));
    console.log(model, "->", out);
    return;
  }
  process.exit(1);
})();
