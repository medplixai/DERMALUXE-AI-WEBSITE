// POST /api/verify-otp  { phone: "9876543210", code: "123456" }
// Verifies the OTP and returns a short-lived signed token that the
// /api/analyze endpoint requires. In DEMO mode (no Twilio configured),
// the fixed code 123456 is accepted.
const crypto = require("crypto");

function signToken(phone, secret) {
  const exp = Date.now() + 30 * 60 * 1000; // 30 minutes
  const payload = `${phone}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const phone = String((req.body && req.body.phone) || "").replace(/\D/g, "");
  const code = String((req.body && req.body.code) || "").trim();
  if (!/^[6-9]\d{9}$/.test(phone) || !/^\d{4,8}$/.test(code)) {
    return res.status(400).json({ error: "Invalid phone or code" });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const secret = process.env.OTP_TOKEN_SECRET || token || "dermaluxe-dev-secret";

  // Demo mode
  if (!sid || !token || !verifySid) {
    if (code === "123456") {
      return res.status(200).json({ ok: true, demo: true, token: signToken(phone, secret) });
    }
    return res.status(401).json({ error: "Incorrect OTP" });
  }

  try {
    const resp = await fetch(
      `https://verify.twilio.com/v2/Services/${verifySid}/VerificationCheck`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: `+91${phone}`, Code: code }),
      }
    );
    const data = await resp.json();
    if (resp.ok && data.status === "approved") {
      return res.status(200).json({ ok: true, token: signToken(phone, secret) });
    }
    return res.status(401).json({ error: "Incorrect or expired OTP" });
  } catch (e) {
    return res.status(500).json({ error: "OTP verification error" });
  }
};

module.exports.signToken = signToken;
