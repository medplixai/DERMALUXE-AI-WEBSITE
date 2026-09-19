// The free AI skin & hair analysis on the website.
//
// Every run is a paid call to the model with one or two photos, open to the
// whole internet. So: only from our own site, a few an hour per address and
// a ceiling per day for everyone; when the OTP is switched on, only with a
// token the OTP step signed for, and not after it expires. Whatever the
// model sends back, the visitor gets a report with the disclaimer — and
// never the provider's own error text.
const path = require("path");
const crypto = require("crypto");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

let answer = { ok: true, text: JSON.stringify({ skin_score: 78, skin_type: "Oily", summary_en: "Good skin." }) };
let calls = 0;
global.fetch = async () => {
  calls++;
  if (!answer.ok) return { ok: false, status: 400, json: async () => ({ error: { message: "Your credit balance is too low (org-abc123)" } }) };
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: answer.text }] }) };
};
process.env.ANTHROPIC_API_KEY = "test";
const analyze = h.load("analyze");
const FACE = "data:image/jpeg;base64," + Buffer.from("face").toString("base64");
let ip = 0;
const from = (o) => Object.assign({ headers: { origin: "https://www.dermaluxe.ai", "x-forwarded-for": "10.0.0." + (++ip) } }, o || {});
const token = (phone, exp, secret) => {
  const sig = crypto.createHmac("sha256", secret).update(`${phone}.${exp}`).digest("hex");
  return Buffer.from(`${phone}.${exp}.${sig}`).toString("base64url");
};

(async () => {
  console.log("THE AI SKIN ANALYSIS\n");

  is((await h.call(analyze, {}, { faceImage: FACE }, { headers: { origin: "https://evil.example" } })).code, 403, "only from our own site");
  is((await h.call(analyze, {}, { faceImage: "not a photo" }, from())).code, 400, "no face photo, no analysis");
  is((await h.call(analyze, {}, { faceImage: "data:image/svg+xml;base64,PHN2Zz4=" }, from())).code, 400, "and nothing that is not a JPEG, PNG or WebP");
  is((await h.call(analyze, {}, { faceImage: FACE }, from({ headers: { origin: "https://www.dermaluxe.ai", "content-length": "5000000" } }))).code, 413, "nothing too large");
  const ok = await h.call(analyze, {}, { faceImage: FACE, patient: { name: "Anu", age: 24 } }, from());
  is([ok.code, ok.body.report.skin_score], [200, 78], "a photo gets a report");
  is(/not a medical diagnosis/.test(ok.body.report.disclaimer), true, "always with the disclaimer");
  answer = { ok: true, text: "Sorry, I can only describe what I see: your skin looks healthy." };
  const loose = await h.call(analyze, {}, { faceImage: FACE }, from());
  is([loose.code, loose.body.report.skin_findings, !!loose.body.report.disclaimer], [200, [], true], "a reply that is not JSON still becomes a report, not an error");
  answer = { ok: false };
  const bad = await h.call(analyze, {}, { faceImage: FACE }, from());
  is(bad.code, 502, "when the model refuses, the visitor is told it failed");
  is(JSON.stringify(bad.body).includes("credit balance"), false, "but not the provider's own error — that is the clinic's business");
  answer = { ok: true, text: "{}" };

  console.log("\n  — how often —");
  calls = 0;
  const same = { headers: { origin: "https://www.dermaluxe.ai", "x-forwarded-for": "20.0.0.1" } };
  let code = 0;
  for (let i = 0; i < 6; i++) code = (await h.call(analyze, {}, { faceImage: FACE }, same)).code;
  is([code, calls], [429, 5], "five an hour from one address, and the sixth never reaches the model");

  console.log("\n  — with the OTP switched on —");
  process.env.REQUIRE_OTP = "1";
  is((await h.call(analyze, {}, { faceImage: FACE, token: "x" }, from())).code, 501, "without a signing secret it refuses, rather than accept a guessable one");
  process.env.OTP_TOKEN_SECRET = "otp-secret";
  const soon = Date.now() + 600000;
  is((await h.call(analyze, {}, { faceImage: FACE }, from())).code, 401, "no token, no analysis");
  is((await h.call(analyze, {}, { faceImage: FACE, token: token("9876500801", soon, "dermaluxe-dev-secret") }, from())).code, 401, "a token signed with the old development secret is refused");
  is((await h.call(analyze, {}, { faceImage: FACE, token: token("9876500801", Date.now() - 1000, "otp-secret") }, from())).code, 401, "an expired one is refused");
  is((await h.call(analyze, {}, { faceImage: FACE, token: token("9876500801", soon, "otp-secret") }, from())).code, 200, "a live one from the OTP step works");
  delete process.env.REQUIRE_OTP;

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe AI skin analysis behaves");
  process.exit(fails ? 1 : 0);
})();
