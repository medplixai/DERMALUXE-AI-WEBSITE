// Second pass on the invitation photo: the owner wanted the model from the clinic's
// own pamphlet (pamphlet.jpg, the woman at the top right) welcoming guests, with her
// face clearly seen, not the small generated figure at the steps. Takes
// building-v1-fixed.jpg (lighting done, side board already restored) plus two
// references cut from the pamphlet: pamphlet-model.jpg (head and shoulders) and
// pamphlet-face.jpg (the face alone). Output building-face-v<N>.jpg. Re-run:
//   node print/invite/edit-face.js [variant number]
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

const PROMPT = `The first image is an evening photograph of a clinic building. The second and third images show the model from the clinic's own brochure (a head-and-shoulders picture and a close-up of her face).

Edit the first image. Keep the building, the lighting, the sky, the glowing "DERMALUXE by MediCare SKIN & HAIR CLINIC" sign letter for letter, every other sign and board, the steps and the street exactly as they are.

Replace the small woman standing at the foot of the steps with this same brochure model — her face must match the reference closely: the same face shape, eyes, brows, nose, lips, smile and complexion. Place her much closer to the camera in the lower centre of the frame, seen from about the knees up, so her face is large, sharp and the clear focal point of the picture. She wears a rich deep maroon silk saree with a broad gold zari border, an elegant gold necklace, jhumka earrings and bangles, glossy dark hair in a soft bun with jasmine flowers, soft elegant makeup and her warm smile, one hand raised in a gentle welcoming namaste. Lit by the warm golden light from the entrance and a soft front light, natural skin texture. The building and the glowing sign stay fully visible behind her; her head sits below the sign, not covering it.

Natural photograph, correct proportions and hands, not a render. Keep the vertical composition. No added text, no watermark.`;

(async () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing from .env");
  const n = process.argv[2] || "1";
  const part = (f) => ({ inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(path.join(__dirname, f)).toString("base64") } });
  for (const model of ["gemini-3-pro-image-preview", "gemini-3-pro-image"]) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [part("building-v1-fixed.jpg"), part("pamphlet-model.jpg"), part("pamphlet-face.jpg"), { text: PROMPT }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: "2K" } },
      }),
    });
    if (!r.ok) { console.error(model, r.status, (await r.text()).slice(0, 200)); continue; }
    const d = await r.json();
    const p = ((((d.candidates || [])[0] || {}).content || {}).parts || []).find((x) => x.inlineData);
    if (!p) { console.error(model, "no image", JSON.stringify(d.candidates?.[0]?.finishReason)); continue; }
    const out = path.join(__dirname, `building-face-v${n}.jpg`);
    fs.writeFileSync(out, Buffer.from(p.inlineData.data, "base64"));
    console.log(model, "->", out);
    return;
  }
  process.exit(1);
})();
