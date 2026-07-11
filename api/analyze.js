// POST /api/analyze
// { token, patient:{name,age,gender,concern}, faceImage:"data:image/jpeg;base64,...", hairImage?:"..." }
// Verifies the OTP token, then asks Claude (vision) for a structured
// skin & hair analysis. Requires ANTHROPIC_API_KEY in Vercel env vars.
const crypto = require("crypto");

function verifyToken(tok, secret) {
  try {
    const raw = Buffer.from(String(tok), "base64url").toString();
    const [phone, exp, sig] = raw.split(".");
    if (!phone || !exp || !sig) return null;
    const expect = crypto.createHmac("sha256", secret).update(`${phone}.${exp}`).digest("hex");
    if (sig !== expect) return null;
    if (Date.now() > Number(exp)) return null;
    return phone;
  } catch {
    return null;
  }
}

function dataUrlToBlock(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: "AI service not configured yet" });

  const { token, patient = {}, faceImage, hairImage } = req.body || {};
  const secret = process.env.OTP_TOKEN_SECRET || process.env.TWILIO_AUTH_TOKEN || "dermaluxe-dev-secret";
  const phone = verifyToken(token, secret);
  if (!phone) return res.status(401).json({ error: "Session expired — please verify OTP again" });

  const faceBlock = dataUrlToBlock(faceImage);
  if (!faceBlock) return res.status(400).json({ error: "A clear face photo is required" });
  const hairBlock = dataUrlToBlock(hairImage);

  const content = [
    { type: "text", text: "Face photo:" },
    faceBlock,
  ];
  if (hairBlock) {
    content.push({ type: "text", text: "Hair / scalp photo:" }, hairBlock);
  }
  content.push({
    type: "text",
    text:
      `Patient: name ${patient.name || "N/A"}, age ${patient.age || "N/A"}, gender ${patient.gender || "N/A"}. ` +
      `Primary concern: ${patient.concern || "general assessment"}.\n\n` +
      "Analyse the photo(s) as a cosmetic skin & hair wellness assessment. Respond with ONLY valid JSON (no markdown) in this exact shape:\n" +
      `{
  "skin_score": <0-100 integer overall skin health impression>,
  "hair_score": <0-100 integer or null if scalp/hair not clearly visible>,
  "skin_findings": [{"name":"...", "severity":"mild|moderate|significant", "note":"one short sentence"}],
  "hair_findings": [{"name":"...", "severity":"mild|moderate|significant", "note":"one short sentence"}],
  "summary_en": "3-4 sentence friendly summary in English",
  "summary_te": "అదే సారాంశం తెలుగులో (3-4 వాక్యాలు)",
  "recommendations": ["4-6 short practical care tips"],
  "suggested_treatments": ["3-5 treatments from: Acne & Scar Treatment, Pigmentation & Melasma, Chemical Peels, Hydrafacial, Laser Skin Resurfacing, MNRF, HIFU, Botox, Dermal Fillers, Skin Boosters, Laser Hair Reduction, Hair Fall Treatment, PRP & GFC Hair Therapy, Hair Transplant (FUE/DHI), Dandruff Management, Medical Weight Loss"]
}\n` +
      "Be encouraging and specific to what is actually visible. This is a wellness pre-assessment, not a diagnosis.",
  });

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "claude-sonnet-5",
        max_tokens: 1500,
        system:
          "You are the AI skin & hair pre-assessment assistant for DermaLuxe by Medicare, a premium medical aesthetic clinic in Eluru, India. " +
          "You analyse photos for cosmetic wellness screening only. You never diagnose disease, never mention cancer or serious pathology — if something needs medical attention, set severity to 'significant' and recommend an in-clinic dermatologist consultation. " +
          "Output strictly the requested JSON, nothing else.",
        messages: [{ role: "user", content }],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(502).json({ error: (data.error && data.error.message) || "AI analysis failed" });
    }

    const text = (data.content || []).map((b) => b.text || "").join("");
    let report;
    try {
      const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      report = JSON.parse(jsonStr);
    } catch {
      report = { summary_en: text, skin_score: null, hair_score: null, skin_findings: [], hair_findings: [], recommendations: [], suggested_treatments: [] };
    }
    report.disclaimer =
      "This AI pre-assessment is for informational purposes only and is not a medical diagnosis. Results may vary — please consult our qualified dermatologists in person. · ఇది వైద్య నిర్ధారణ కాదు — దయచేసి మా చర్మ వైద్యులను సంప్రదించండి.";
    return res.status(200).json({ ok: true, report });
  } catch (e) {
    return res.status(500).json({ error: "AI analysis error" });
  }
};
