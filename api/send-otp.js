// POST /api/send-otp  { phone: "9876543210" }
// Sends a 6-digit code. Preference order:
//   1. WhatsApp AUTHENTICATION template "verification_code" (no SMS cost, instant)
//   2. Twilio Verify, if those env vars are configured
//   3. Demo mode (fixed 123456) — ONLY when ALLOW_DEMO_OTP=1, never in production
const crypto = require("crypto");
const guard = require("./_guard.js");
const notify = require("./_notify.js");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!guard.originAllowed(req)) return res.status(403).json({ error: "Unauthorized request origin" });

  const phone = String((req.body && req.body.phone) || "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "Invalid Indian mobile number" });

  const cfg = guard.kvConfig();
  const ip = guard.getIp(req);
  const rlIp = await guard.rateLimit(cfg, `rl:so:h:${ip}`, 6, 3600);
  const rlPhone = await guard.rateLimit(cfg, `rl:so:p:${phone}`, 8, 86400);
  if (!rlIp.allowed || !rlPhone.allowed) return res.status(429).json({ error: "Too many OTP requests — try later" });

  // ---- 1. WhatsApp ----
  if (process.env.WA_CLOUD_TOKEN && cfg) {
    const code = String(crypto.randomInt(100000, 999999));
    await guard.kvCommand(cfg, ["SET", `otp:wa:${phone}`, JSON.stringify({ code, tries: 0 }), "EX", "300"]).catch(() => {});
    const r = await notify.sendWaAuthCode(phone, code, "verification_code");
    if (r && r.ok) return res.status(200).json({ ok: true, channel: "whatsapp" });
    console.error("send-otp: whatsapp failed", phone.slice(-4), r && r.msg);
    await guard.kvCommand(cfg, ["DEL", `otp:wa:${phone}`]).catch(() => {});
  }

  // ---- 2. Twilio Verify ----
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, verifySid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (sid && token && verifySid) {
    try {
      const resp = await fetch(`https://verify.twilio.com/v2/Services/${verifySid}/Verifications`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: `+91${phone}`, Channel: "sms" }),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(502).json({ error: data.message || "Failed to send OTP" });
      return res.status(200).json({ ok: true, channel: "sms", status: data.status });
    } catch (e) { return res.status(500).json({ error: "OTP service error" }); }
  }

  // ---- 3. Demo (development only) ----
  if (process.env.ALLOW_DEMO_OTP === "1") return res.status(200).json({ ok: true, demo: true, channel: "demo" });
  return res.status(503).json({ error: "OTP service is not available right now — WhatsApp 99591 34666 lo maatladandi" });
};
