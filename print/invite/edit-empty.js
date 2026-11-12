// The invitation photo with nobody in it, for the one-page poster (the owner asked for
// the woman to be taken out). Takes building-v1-fixed.jpg (evening light, side board's
// real lettering restored) and removes the woman at the steps. Output building-empty-v<N>.jpg.
//   node print/invite/edit-empty.js [variant number]
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

const PROMPT = `Edit this evening photograph of a clinic building. Remove the woman in the maroon saree standing in front of the steps, and fill the space with the empty steps, railing, ground and street that would be behind her, matching the surrounding texture and light. No person anywhere in the picture.

Change nothing else: keep the framing, the building, the lighting, the sky, the glowing "DERMALUXE by MediCare SKIN & HAIR CLINIC" sign letter for letter, and every other sign and board exactly as they are. No added text, no watermark.`;

(async () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing from .env");
  const n = process.argv[2] || "1";
  const src = fs.readFileSync(path.join(__dirname, "building-v1-fixed.jpg")).toString("base64");
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
    const out = path.join(__dirname, `building-empty-v${n}.jpg`);
    fs.writeFileSync(out, Buffer.from(p.inlineData.data, "base64"));
    console.log(model, "->", out);
    return;
  }
  process.exit(1);
})();
