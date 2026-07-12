// POST /api/analyze
// { token, patient:{name,age,gender,concern}, faceImage:"data:image/jpeg;base64,...", hairImage?:"..." }
// Verifies the OTP token, then asks Claude (vision) for a structured
// skin & hair analysis. Requires ANTHROPIC_API_KEY in Vercel env vars.
// Protected by origin allowlist + per-IP and global rate limits.
const crypto = require("crypto");
const guard = require("./_guard.js");

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
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Layer 1: only requests from our own site
  if (!guard.originAllowed(req)) {
    return res.status(403).json({ error: "Unauthorized request origin" });
  }

  // Layer 2: payload size limits (protects bandwidth + tokens)
  const clen = Number(req.headers["content-length"] || 0);
  if (clen > 4400000) return res.status(413).json({ error: "Payload too large" });

  // Layer 3: per-IP and global rate limits
  const cfg = guard.kvConfig();
  const ip = guard.getIp(req);
  const hourly = await guard.rateLimit(cfg, `rl:an:h:${ip}`, 5, 3600);
  if (!hourly.allowed) {
    return res.status(429).json({ error: "Hourly limit reached — please try again after some time. · గంట పరిమితి దాటింది, కాసేపటి తర్వాత ప్రయత్నించండి." });
  }
  const daily = await guard.rateLimit(cfg, `rl:an:d:${ip}`, 12, 86400);
  if (!daily.allowed) {
    return res.status(429).json({ error: "Daily limit reached — please visit the clinic or try tomorrow. · రోజు పరిమితి దాటింది." });
  }
  const globalCap = await guard.rateLimit(cfg, `rl:an:g:${guard.today()}`, 300, 90000);
  if (!globalCap.allowed) {
    return res.status(429).json({ error: "AI analysis is very busy today — please try again tomorrow. · ఈరోజు రద్దీ ఎక్కువగా ఉంది, రేపు ప్రయత్నించండి." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: "AI service not configured yet" });

  const { token, patient = {}, faceImage, hairImage } = req.body || {};
  if (String(faceImage || "").length > 3500000 || String(hairImage || "").length > 3500000) {
    return res.status(400).json({ error: "Photo too large — please use a smaller photo" });
  }
  // OTP gating is currently optional — set REQUIRE_OTP=1 in Vercel env to enforce it.
  if (process.env.REQUIRE_OTP === "1") {
    const secret = process.env.OTP_TOKEN_SECRET || process.env.TWILIO_AUTH_TOKEN || "dermaluxe-dev-secret";
    const phone = verifyToken(token, secret);
    if (!phone) return res.status(401).json({ error: "Session expired — please verify OTP again" });
  }

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
  "skin_age": <integer estimated cosmetic skin age in years, or null>,
  "skin_type": <"Oily"|"Dry"|"Combination"|"Normal"|"Sensitive"|null>,
  "metrics": {
    "hydration": <0-100 or null>, "texture": <0-100 or null>, "pigmentation": <0-100 or null>,
    "acne": <0-100 or null>, "wrinkles": <0-100 or null>, "dark_circles": <0-100 or null>,
    "pores": <0-100 or null>, "redness": <0-100 or null>,
    "hair_density": <0-100 or null>, "scalp_health": <0-100 or null>
  },
  "skin_findings": [{"name":"...", "severity":"mild|moderate|significant", "note":"one short sentence"}],
  "hair_findings": [{"name":"...", "severity":"mild|moderate|significant", "note":"one short sentence"}],
  "summary_en": "3-4 sentence friendly summary in English",
  "summary_te": "అదే సారాంశం తెలుగులో (3-4 వాక్యాలు)",
  "recommendations": ["4-6 short practical care tips"],
  "suggested_treatments": ["3-5 treatments from: Acne & Scar Treatment, Pigmentation & Melasma, Chemical Peels, Hydrafacial, Laser Skin Resurfacing, MNRF, HIFU, Botox, Dermal Fillers, Skin Boosters, Laser Hair Reduction, Hair Fall Treatment, PRP & GFC Hair Therapy, Hair Transplant (FUE/DHI), Dandruff Management, Medical Weight Loss"]
}\n` +
      "Metric scale: 100 = excellent/no concern, 0 = severe concern (e.g. acne 90 means almost clear skin). Use null for anything not clearly assessable from the photos. skin_age should feel plausible vs the stated age — never insulting. " +
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
