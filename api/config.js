// GET /api/config — public, non-secret site configuration.
// The website reads this to know whether the clinic platform (Medplix) links
// are live yet. Only URLs safe to expose are returned — never keys/ids.
const guard = require("./_guard.js");
const clinic = require("./_clinic.js");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!guard.originAllowed(req)) return res.status(403).json({ error: "Unauthorized request origin" });

  // Admin diagnostic: ?models=1&key=<ADMIN_KEY> — Gemini model ids this key can
  // call (names/methods only, never the key), to pick working STT/TTS defaults.
  if ((req.query || {}).models === "1") {
    if (!process.env.ADMIN_KEY || !guard.safeEqual(String((req.query || {}).key || ""), process.env.ADMIN_KEY)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const gk = process.env.GEMINI_API_KEY;
    if (!gk) return res.status(200).json({ models: [], note: "GEMINI_API_KEY unset" });
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(gk)}`);
      const d = await r.json().catch(() => ({}));
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        status: r.status,
        error: d.error && d.error.message,
        models: (d.models || []).map((m) => ({
          name: String(m.name || "").replace(/^models\//, ""),
          methods: m.supportedGenerationMethods || [],
        })),
      });
    } catch (e) {
      return res.status(200).json({ models: [], error: String(e && e.message) });
    }
  }

  const c = clinic.clinicConfig();
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  return res.status(200).json({
    portalUrl: c.portalUrl || null,
    bookingUrl: c.bookingUrl || null,
    clinicConnected: !!c.syncUrl,
    // booleans only — never the secrets themselves
    waAgent: {
      enabled: process.env.WA_AGENT_ENABLED === "1",
      webhookSecured: !!process.env.WA_WEBHOOK_TOKEN,
      cloudTokenSet: !!process.env.WA_CLOUD_TOKEN,
      voiceEnabled: !!process.env.GEMINI_API_KEY,
      voiceReplies: !!process.env.GEMINI_API_KEY, // TTS voice notes back to voice senders
    },
    igAgent: {
      enabled: process.env.IG_AGENT_ENABLED === "1",
      pageTokenSet: !!(process.env.IG_PAGE_TOKEN || (process.env.IG_SYSTEM_TOKEN && process.env.IG_PAGE_ID)),
    },
    fbAgent: {
      enabled: process.env.FB_AGENT_ENABLED !== "0" &&
        !!(process.env.IG_PAGE_TOKEN || (process.env.IG_SYSTEM_TOKEN && process.env.IG_PAGE_ID)),
    },
  });
};
