// POST /api/send-otp  { phone: "9876543210" }
// Sends an OTP via Twilio Verify. If Twilio env vars are not configured,
// falls back to DEMO mode (fixed code 123456) so the flow can be tested
// before SMS is provisioned.
const guard = require("./_guard.js");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!guard.originAllowed(req)) {
    return res.status(403).json({ error: "Unauthorized request origin" });
  }

  const phone = String((req.body && req.body.phone) || "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: "Invalid Indian mobile number" });
  }

  const cfg = guard.kvConfig();
  const ip = guard.getIp(req);
  const rlIp = await guard.rateLimit(cfg, `rl:so:h:${ip}`, 5, 3600);
  const rlPhone = await guard.rateLimit(cfg, `rl:so:p:${phone}`, 8, 86400);
  if (!rlIp.allowed || !rlPhone.allowed) {
    return res.status(429).json({ error: "Too many OTP requests — try later" });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!sid || !token || !verifySid) {
    // Demo mode — no SMS provider configured yet
    return res.status(200).json({ ok: true, demo: true });
  }

  try {
    const resp = await fetch(
      `https://verify.twilio.com/v2/Services/${verifySid}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: `+91${phone}`, Channel: "sms" }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(502).json({ error: data.message || "Failed to send OTP" });
    }
    return res.status(200).json({ ok: true, status: data.status });
  } catch (e) {
    return res.status(500).json({ error: "OTP service error" });
  }
};
