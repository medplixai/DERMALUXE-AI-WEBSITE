// The public side: what the website and anybody on the internet can reach.
//
// The OTP that unlocks the AI skin analysis, the smart links on Instagram
// and the clinic's QR standee, the short-lived media Instagram fetches while
// publishing, the academy documents sent on WhatsApp, the marketing
// dashboard, and the two small config endpoints. Each one is either open on
// purpose or guarded; the checks are that the open ones give away nothing
// and the guarded ones stay shut.
const path = require("path");
const crypto = require("crypto");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const site = (ip) => ({ headers: { origin: "https://www.dermaluxe.ai", "x-forwarded-for": ip || "1.1.1.1" } });

let igHits = 0;
global.fetch = async (url) => {
  if (String(url).includes("graph.instagram.com")) { igHits++; return { ok: true, json: async () => ({ username: "dermaluxe.ai", followers_count: 1200, media_count: 80 }) }; }
  return { ok: false, status: 404, json: async () => ({}) };
};

const n = require(path.join(API, "_notify.js"));
const sendOtp = h.load("send-otp"), verifyOtp = h.load("verify-otp");
const r = h.load("r"), media = h.load("media"), doc = h.load("doc");
const appVersion = h.load("app-version"), config = h.load("config"), mk = h.load("marketing-stats");

(async () => {
  console.log("THE PUBLIC SIDE\n");

  console.log("  — the OTP before the AI skin analysis —");
  process.env.WA_CLOUD_TOKEN = "zz-cloud-secret";
  process.env.OTP_TOKEN_SECRET = "otp-secret";
  let code = null;
  const auth = n.sendWaAuthCode;
  n.sendWaAuthCode = async (ph, c) => { code = c; return { ok: true }; };
  is((await h.call(sendOtp, {}, { phone: "9876500201" }, { headers: { origin: "https://evil.example" } })).code, 403, "only from our own site");
  is((await h.call(sendOtp, {}, { phone: "12345" }, site())).code, 400, "not a mobile, no code");
  const s1 = await h.call(sendOtp, {}, { phone: "+91 98765 00201" }, site());
  is([s1.code, s1.body.channel], [200, "whatsapp"], "a code goes out on WhatsApp");
  is(/^\d{6}$/.test(code), true, "six digits");
  is((await h.call(verifyOtp, {}, { phone: "9876500201", code: code === "111111" ? "222222" : "111111" }, site())).code, 401, "a wrong code is refused");
  const v = await h.call(verifyOtp, {}, { phone: "9876500201", code }, site());
  is(v.code, 200, "the right one is accepted");
  const [ph, exp, sig] = Buffer.from(v.body.token, "base64url").toString().split(".");
  is([ph, sig], ["9876500201", crypto.createHmac("sha256", "otp-secret").update(`${ph}.${exp}`).digest("hex")], "and returns a token signed for that number");
  is((await h.call(verifyOtp, {}, { phone: "9876500201", code }, site("1.1.1.2"))).code, 401, "a code works once");
  await h.call(sendOtp, {}, { phone: "9876500202" }, site("2.2.2.2"));
  let lastWrong = 0;
  for (let i = 0; i < 6; i++) lastWrong = (await h.call(verifyOtp, {}, { phone: "9876500202", code: String(100000 + i) === code ? "999998" : String(100000 + i) }, site("2.2.2." + (i + 3)))).code;
  is(lastWrong, 429, "five wrong guesses and the code is thrown away, from any address");
  is((await h.call(verifyOtp, {}, { phone: "9876500202", code }, site("2.2.2.99"))).code, 401, "so even the right one no longer works");
  // WhatsApp failing all three ways, and no SMS configured, must not fall
  // back to the fixed demo code in production.
  n.sendWaAuthCode = async () => ({ ok: false });
  const wa = n.sendWa, tpl = n.sendWaTemplate;
  n.sendWa = async () => false; n.sendWaTemplate = async () => ({ ok: false });
  const none = await h.call(sendOtp, {}, { phone: "9876500203" }, site("3.3.3.3"));
  is(none.code, 503, "when WhatsApp cannot deliver and there is no SMS, it says so");
  is((await h.call(verifyOtp, {}, { phone: "9876500203", code: "123456" }, site("3.3.3.4"))).code, 401, "and the demo code 123456 does not open anything");
  n.sendWa = wa; n.sendWaTemplate = tpl; n.sendWaAuthCode = auth;
  let otpLimited = 0;
  for (let i = 0; i < 9; i++) if ((await h.call(sendOtp, {}, { phone: "9876500204" }, site("4.4.4." + i))).code === 429) otpLimited++;
  is(otpLimited >= 1, true, "one number cannot be sent codes all day, whatever address asks");

  console.log("\n  — smart links —");
  const go = await h.call(r, { tag: "insta" });
  is(go.code, 302, "a link redirects");
  is(go.headers.Location.startsWith("https://wa.me/919959134666?text="), true, "Instagram's link opens the WhatsApp agent");
  h.run(["SET", "dp:today", JSON.stringify({ h1: "Glow before Diwali" })]);
  is(decodeURIComponent((await h.call(r, { tag: "story" })).headers.Location).includes("Glow before Diwali"), true, "and tells the agent which post they saw");
  const web = await h.call(r, { tag: "gbp" });
  is(web.headers.Location, "https://www.dermaluxe.ai/?utm_source=gbp&utm_medium=smartlink&utm_campaign=gbp", "others land on the site with the channel marked");
  is(h.run(["GET", `utm:insta:${new Date().toISOString().slice(0, 10)}`]), "1", "every click is counted");
  is((await h.call(r, { tag: "<script>alert(1)" })).headers.Location.includes("<"), false, "a tag cannot inject anything into the address");

  console.log("\n  — media Instagram fetches —");
  const id = "a".repeat(32);
  h.run(["SET", `adm:img:${id}`, Buffer.from("jpegbytes").toString("base64"), "EX", "3600"]);
  const img = await h.call(media, { id });
  is([img.code, String(img.bin)], [200, "jpegbytes"], "a parked picture is served by its id");
  is((await h.call(media, { id: "../../etc/passwd" })).code, 400, "an id that is not one of ours is refused");
  is((await h.call(media, { id: "b".repeat(32) })).code, 404, "and one that has expired is gone");
  process.env.WA_WEBHOOK_TOKEN = "zz-hook-secret";
  const expAt = String(Date.now() + 3600000);
  is((await h.call(media, { wa: "123456789", exp: expAt, sig: "forged" })).code, 403, "a WhatsApp video link with a forged signature is refused");
  const good = crypto.createHmac("sha256", "zz-hook-secret").update(`123456789.${String(Date.now() - 1000)}`).digest("hex");
  is((await h.call(media, { wa: "123456789", exp: String(Date.now() - 1000), sig: good })).code, 410, "and a real one past its time has expired");
  is((await h.call(media, {}, {})).code, 405, "nothing but GET");

  console.log("\n  — academy documents —");
  const did = "c".repeat(32);
  h.run(["SET", `acad:doc:${did}`, JSON.stringify({ t: "pdf", b: Buffer.from("%PDF-1.4").toString("base64"), n: "Receipt DLA-001.pdf" })]);
  const d = await h.call(doc, { id: did });
  is([d.code, d.headers["Content-Type"]], [200, "application/pdf"], "a receipt opens from its link");
  is(d.headers["Content-Disposition"], 'inline; filename="Receipt_DLA-001.pdf"', "with a filename that cannot break the header");
  is(d.headers["X-Robots-Tag"], "noindex, nofollow", "and kept out of search engines");
  is((await h.call(doc, { id: "d".repeat(32) })).code, 404, "a link that has expired is gone");

  console.log("\n  — the two small config endpoints —");
  const av = await h.call(appVersion, {});
  is([av.code, typeof av.body.versionCode, av.body.url.startsWith("https://www.dermaluxe.ai/")], [200, "number", true], "the app can ask what the newest version is");
  is(av.body.minVersionCode <= av.body.versionCode, true, "and the oldest allowed is never newer than the newest");
  const cf = await h.call(config, {}, null, site());
  is(cf.code, 200, "the site reads its config");
  const flat = JSON.stringify(cf.body);
  is([flat.includes("zz-cloud-secret"), flat.includes("zz-hook-secret"), flat.includes("otp-secret")], [false, false, false], "and not one secret is in it — only yes/no");
  is((await h.call(config, { models: "1", key: "guess" }, null, site())).code, 403, "the model list needs the admin key");

  console.log("\n  — the marketing dashboard —");
  const today = new Date().toISOString().slice(0, 10);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 1000, name: "Asha", type: "instagram", phone: "9876500210" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 40 * 86400000, name: "Old", type: "web", phone: "9876500211" })]);
  h.run(["SADD", "camp:_set", "diwali"]);
  h.run(["SET", `camphit:diwali:${today}`, "4"]);
  is((await h.call(mk, { key: "guess" })).code, 403, "the numbers need the admin key");
  process.env.IG_LOGIN_TOKEN = "ig";
  const m = await h.call(mk, {}, null, { headers: { "x-admin-key": "local-admin" } });
  is(m.body.leads.channels.instagram >= 1 && !m.body.leads.channels.web, true, "leads older than thirty days are left out");
  is(m.body.links.insta >= 1, true, "the smart-link clicks are there");
  is(m.body.campaigns[0], { word: "diwali", hits14: 4 }, "and the campaign words");
  is(m.body.ig.followers, 1200, "and the Instagram numbers");
  is(m.body.recent[0].name, "Asha", "with the newest leads, name only — no phone numbers");
  is(JSON.stringify(m.body.recent).includes("9876500210"), false, "no phone numbers anywhere in the list");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe public side behaves");
  process.exit(fails ? 1 : 0);
})();
