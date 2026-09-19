const fs = require("fs");
const files = fs.readdirSync("api").filter((f) => f.endsWith(".js") && !f.startsWith("_"));
const PUBLIC_ON_PURPOSE = {
  "app-version.js": "version + download link, needed before login",
  "r.js": "the /r/:tag short links",
  "send-otp.js": "login step 1 — rate limited",
  "verify-otp.js": "login step 2 — rate limited",
  "lead.js": "the website's own enquiry form",
  "config.js": "public site config",
  "whatsapp.js": "Meta webhook — verified by signature",
  "instagram.js": "Meta webhook — verified by signature",
  "messenger.js": "Meta webhook — verified by signature",
  "exotel.js": "Exotel callback — verified by token",
  "voice-call.js": "Exotel callback",
  "material.js": "student material links — signed token",
  "doc.js": "student documents — signed token",
  "chat.js": "the website chat widget — origin allowlist + per-IP and daily caps",
  "reviews.js": "the homepage's Google rating — read-only, cached, rate limited",
  "pay.js": "the patient's bill link — HMAC-signed per bill, no phone number in it, rate limited",
  "pay-hook.js": "Razorpay webhook — HMAC signature over the raw body",
};
console.log("how each endpoint decides who may call it\n");
let bad = 0;
for (const f of files.sort()) {
  const s = fs.readFileSync("api/" + f, "utf8");
  const how = [];
  if (/requireStaff\(/.test(s)) how.push("staff login");
  if (/requireAdmin|ADMIN_KEY|adminKey/.test(s)) how.push("admin key");
  // guard.cronAuth is the shared gate the scheduled jobs use; before it, each
  // of them tested CRON_SECRET itself, so both spellings count as gated.
  if (/cronAuth\(|CRON_SECRET|x-vercel-cron|isCron\(/.test(s)) how.push("cron only");
  if (/verifySignature|X-Hub-Signature|appSecret|hmac/i.test(s)) how.push("signature");
  if (/signedToken|verifyToken|sign\(/.test(s)) how.push("signed link");
  const pub = PUBLIC_ON_PURPOSE[f];
  if (!how.length && !pub) { bad++; console.log(`  ✗  ${f.padEnd(20)} NOTHING GUARDS THIS`); }
  else console.log(`  ok  ${f.padEnd(20)} ${how.join(" + ") || "public — " + pub}`);
}
console.log(bad ? `\n${bad} ungated` : "\nnothing is ungated by accident");
