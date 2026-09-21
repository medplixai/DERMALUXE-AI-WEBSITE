// Money behind the day's poster, spent by a cron at eight in the morning.
//
// This is the only thing in the clinic that spends money with nobody in the
// room, so the tests are mostly about what it refuses to do: never twice for
// one poster, never past the day's ceiling, never while it is switched off,
// never without the keys, and never leaving a half-built campaign running
// when Meta refuses the ad. And the poster it promotes alternates — the
// clinic one day, the academy the next.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.ADMIN_PHONES = "9010427777";
process.env.META_ADS_TOKEN = "ads-token"; process.env.META_AD_ACCOUNT_ID = "act_4527414787474363"; process.env.IG_PAGE_ID = "page1";

let calls = [], fail = null;
global.fetch = async (url, opt) => {
  const u = String(url);
  const body = opt && opt.body ? JSON.parse(opt.body) : {};
  if (u.includes("graph.facebook.com")) {
    const what = u.includes("/insights") ? "insights" : u.includes("/adimages") ? "adimages" : u.includes("/campaigns") ? "campaign"
      : u.includes("/adsets") ? "adset" : u.includes("/adcreatives") ? "creative" : u.includes("/ads") ? "ad"
      : /\/(c1|as1)\b/.test(u) ? "edit" : "other";
    calls.push({ what, body, url: u });
    if (fail === what) return { ok: false, status: 400, json: async () => ({ error: { message: "Ad account has no payment method", code: 2635 } }) };
    if (what === "adimages") return { ok: true, json: async () => ({ images: { bytes: { hash: "IMGHASH1" } } }) };
    if (what === "campaign") return { ok: true, json: async () => ({ id: "c1" }) };
    if (what === "adset") return { ok: true, json: async () => ({ id: "as1" }) };
    if (what === "creative") return { ok: true, json: async () => ({ id: "cr1" }) };
    if (what === "ad") return { ok: true, json: async () => ({ id: "ad1" }) };
    if (what === "insights") return { ok: true, json: async () => ({ data: [{ spend: "212", reach: "8421", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "6" }] }] }) };
    return { ok: true, json: async () => ({ success: true }) };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

const boost = require(path.join(API, "_boost.js"));
const daily = require(path.join(API, "_daily.js"));
const cfg = { kind: "pg" };
const post = (n) => ({ id: "ig" + n, imgId: "img" + n, caption: "Hair fall? Doctor ni kalavandi 🙏", topic: "hair-fall", link: "https://instagram.com/p/" + n });
const seedImage = (n) => h.run(["SET", `adm:img:img${n}`, "BASE64POSTERBYTES"]);
const sentTo = (ph) => h.sent.filter((s) => s[0] === "wa" && s[1] === ph).map((s) => s[2]);
const bodyOf = (what) => (calls.find((c) => c.what === what) || {}).body || {};

(async () => {
  console.log("MONEY BEHIND THE DAY'S POSTER\n");

  console.log("  — what it does when it is on —");
  seedImage(1);
  h.sent.length = 0;
  const out = await boost.run(cfg, post(1));
  is([out.boosted, out.rupees, out.days], [true, 300, 3], "the poster is promoted — ₹300 over three days, the owner's numbers");
  is(calls.map((c) => c.what), ["campaign", "adset", "adimages", "creative", "ad"], "one campaign, one ad set, the poster uploaded, one creative, one ad");
  const as = bodyOf("adset");
  is(as.lifetime_budget, 30000, "the budget goes to Meta in paise, as a LIFETIME budget — it cannot overspend");
  is(Math.round((new Date(as.end_time) - new Date(as.start_time)) / 86400000), 3, "and it ends by itself after three days");
  is([as.destination_type, as.optimization_goal, as.promoted_object.page_id], ["WHATSAPP", "CONVERSATIONS", "page1"], "it is a click-to-WhatsApp ad, optimised for conversations started");
  const geo = as.targeting.geo_locations.custom_locations[0];
  is([geo.latitude, geo.longitude, geo.radius, geo.distance_unit], [16.7107, 81.0952, 30, "kilometer"], "aimed at Eluru and 30 km around it");
  is([as.targeting.age_min, as.targeting.age_max, as.targeting.publisher_platforms], [20, 60, ["instagram", "facebook"]], "adults, on Instagram and Facebook");
  const cr = bodyOf("creative").object_story_spec.link_data;
  is([cr.image_hash, cr.link, cr.call_to_action.type], ["IMGHASH1", "https://wa.me/919959134666", "WHATSAPP_MESSAGE"], "the ad is the poster itself, and the button opens our WhatsApp");
  is(/Hair fall/.test(cr.message), true, "with the post's own caption");
  is(sentTo("9010427777").some((t) => /₹300 pettam/.test(t) && /3 rojulu/.test(t) && /30 km/.test(t)), true, "the owner is told what was put behind it");

  console.log("\n  — what it refuses —");
  calls = [];
  is((await boost.run(cfg, post(1))).why, "already boosted", "the same poster is never boosted twice");
  is(calls.length, 0, "nothing is even asked of Meta the second time");
  seedImage(2); seedImage(3); seedImage(4);
  await boost.run(cfg, post(2));
  await boost.run(cfg, post(3));
  calls = [];
  const capped = await boost.run(cfg, post(4));
  is([capped.boosted, /roju limit/.test(capped.why)], [false, true], "the day's ceiling (₹900) stops the fourth poster");
  is(calls.length, 0, "and stops it before a rupee is committed");
  h.run(["DEL", "boost:day:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())]);
  await boost.save(cfg, { on: false }, "Owner");
  calls = [];
  is((await boost.run(cfg, post(5))).why, "off", "switched off, it does nothing");
  is(calls.length, 0, "");
  await boost.save(cfg, { on: true }, "Owner");
  const keep = process.env.META_AD_ACCOUNT_ID; delete process.env.META_AD_ACCOUNT_ID;
  is(/META_AD_ACCOUNT_ID/.test((await boost.run(cfg, post(6))).why), true, "without the ads keys it says so instead of pretending");
  process.env.META_AD_ACCOUNT_ID = keep;

  console.log("\n  — when Meta says no —");
  seedImage(7);
  calls = []; fail = "ad"; h.sent.length = 0;
  const bad = await boost.run(cfg, post(7));
  fail = null;
  is([bad.boosted, /payment method/.test(bad.why)], [false, true], "a refused ad is reported in Meta's own words");
  is(calls.filter((c) => c.what === "edit").map((c) => c.body.status), ["PAUSED", "PAUSED"], "the ad set and campaign it had already made are paused — nothing is left running");
  is(sentTo("9010427777").some((t) => /ad pettaleka poyam/.test(t) && /payment method/.test(t)), true, "and the owner hears why, with what to check");
  is(h.run(["GET", "boost:boost:ig7"]), null, "the poster is not marked done, so tomorrow may try again");
  is(Number(h.run(["GET", "boost:day:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())])), 0, "and the money it had counted is given back to the day");

  console.log("\n  — the owner's numbers —");
  const saved = await boost.save(cfg, { rupees: 500, days: 5, km: 45, maxPerDay: 2000 }, "Owner");
  is([saved.ok, saved.boost.rupees, saved.boost.days, saved.boost.km], [true, 500, 5, 45], "the control panel's numbers are what it uses");
  is((await boost.save(cfg, { rupees: 3000, maxPerDay: 1000 }, "Owner")).error, "Roju limit, okka post budget kanna ekkuva undali", "a per-post budget above the day's ceiling is refused");
  is((await boost.load(cfg)).km, 45, "and a refused save changes nothing");
  seedImage(8); calls = [];
  await boost.run(cfg, post(8));
  is([bodyOf("adset").lifetime_budget, bodyOf("adset").targeting.geo_locations.custom_locations[0].radius], [50000, 45], "₹500 and 45 km reach Meta");
  is((await boost.save(cfg, { km: 5 }, "Owner")).boost.km, 17, "a radius smaller than Meta allows is pulled up to its smallest, not ignored");
  is((await boost.save(cfg, { km: 500 }, "Owner")).boost.km, 80, "and one bigger than it allows, down to its largest");

  console.log("\n  — arithmetic Meta would refuse —");
  // This account will not run a lifetime budget below about ₹95 a day.
  is((await boost.save(cfg, { rupees: 300, days: 5 }, "Owner")).error,
    "₹300 ki 5 rojulu kudarav — Meta roju kaneesam ₹100 adugutundi. 3 rojulu varaku, leda budget ₹500 cheyandi.",
    "₹300 stretched over five days is refused, with both ways out spelled");
  is([(await boost.load(cfg)).rupees, (await boost.load(cfg)).days], [500, 5], "the settings that were already there stand");
  is((await boost.save(cfg, { rupees: 300, days: 3 }, "Owner")).ok, true, "₹300 over three days is fine");
  h.run(["SET", "boost:cfg", JSON.stringify({ on: true, rupees: 200, days: 7, km: 30, maxPerDay: 900 })]);   // as if edited outside the app
  seedImage(9); calls = [];
  const short = await boost.run(cfg, post(9));
  is([short.days, bodyOf("adset").lifetime_budget], [2, 20000], "a stored setting Meta would refuse is shortened, not lost — ₹200 runs two days");

  console.log("\n  — what came of it —");
  const rows = await boost.recent(cfg, 5);
  is([rows[0].spend, rows[0].reach, rows[0].chats], [212, 8421, "6"], "each boost shows what it spent, who it reached and how many chats it started");

  console.log("\n  — the morning it actually runs —");
  // The trigger itself: cron-post publishes the day's poster at 8:30 and the
  // boost has to follow it. A post somebody published by hand must not.
  const stub = (n, e) => { const p2 = path.join(API, n); require.cache[p2] = { id: p2, filename: p2, loaded: true, exports: e }; };
  let publishes = 0;
  stub("_admin.js", {
    isAdmin: () => false, fmtIst: () => "8:30 am", promoParams: (t, n, x) => [n, x],
    publishNow: async () => ({ ok: true, id: "ig-auto-" + (++publishes), link: "https://instagram.com/p/x" }),
  });
  const post9 = h.load("cron-post");
  await boost.save(cfg, { on: true, rupees: 300, days: 3, km: 30, maxPerDay: 900 }, "Owner");
  h.run(["DEL", "boost:day:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())]);
  h.run(["SET", "adm:img:auto1", "POSTERBYTES"]);
  h.run(["LPUSH", "adm:queue", JSON.stringify({ imgId: "auto1", caption: "Hair fall? 🙏", due: Date.now() - 60000, by: "9010427777", auto: true, topic: "hair-fall", quiet: true })]);
  calls = [];
  const cp = await h.call(post9, { key: "local-admin" });
  is([cp.body.boosted && cp.body.boosted.boosted, calls.filter((c) => c.what === "campaign").length], [true, 1], "the poster goes live at 8:30 and the money follows it in the same run");
  is(bodyOf("campaign").name.indexOf("hair-fall") > -1, true, "the campaign is named after the day's topic");
  h.run(["SET", "adm:img:hand1", "POSTERBYTES"]);
  h.run(["LPUSH", "adm:queue", JSON.stringify({ imgId: "hand1", caption: "Ee roju offer", due: Date.now() - 60000, by: "9010427777", quiet: true })]);
  calls = [];
  const cp2 = await h.call(post9, { key: "local-admin" });
  is([cp2.body.published, calls.length], [1, 0], "a post somebody scheduled by hand is published and left alone — no money behind it");

  console.log("\n  — clinic one day, academy the next —");
  const day = (iso) => daily.isAcademyDay(Date.parse(iso + "T06:00:00Z"));
  is([day("2026-09-21"), day("2026-09-22"), day("2026-09-23"), day("2026-09-24")], [!day("2026-09-22"), !day("2026-09-21"), day("2026-09-21"), day("2026-09-22")], "the days alternate, and keep alternating");
  is(day("2026-09-30") !== day("2026-10-01"), true, "across the end of a month too");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe boost behaves");
  process.exit(fails ? 1 : 0);
})();
