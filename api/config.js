// GET /api/config — public, non-secret site configuration.
// The website reads this to know whether the clinic platform (Medplix) links
// are live yet. Only URLs safe to expose are returned — never keys/ids.
const guard = require("./_guard.js");
const clinic = require("./_clinic.js");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!guard.originAllowed(req)) return res.status(403).json({ error: "Unauthorized request origin" });

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
    },
  });
};
