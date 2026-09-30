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
let liveSet = true;          // does Meta still have the standing ad set
let setAds = [];             // what is already in it
global.fetch = async (url, opt) => {
  const u = String(url);
  const body = opt && opt.body ? JSON.parse(opt.body) : {};
  if (u.includes("graph.facebook.com")) {
    const isGet = !opt || !opt.method || String(opt.method).toUpperCase() === "GET";
    // Reads the standing ad set makes: is it still there, and what is in it.
    if (isGet && /\/as1\/ads/.test(u)) { calls.push({ what: "listads", body, url: u }); return { ok: true, json: async () => ({ data: setAds }) }; }
    if (isGet && /\/as1\?/.test(u)) { calls.push({ what: "readset", body, url: u }); return { ok: true, json: async () => (liveSet ? { id: "as1", effective_status: "PAUSED" } : { error: { message: "gone" } }) }; }
    const what = u.includes("/insights") ? "insights" : u.includes("/adimages") ? "adimages" : u.includes("/campaigns") ? "campaign"
      : u.includes("/adsets") ? "adset" : u.includes("/adcreatives") ? "creative" : u.includes("/ads") ? "ad"
      : /graph\.facebook\.com\/v[\d.]+\/[A-Za-z0-9_]+(\?|$)/.test(u) ? ((opt && opt.method) === "DELETE" ? "scrap" : "edit") : "other";
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
const DAYKEY = () => "boost:day:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
// The day's rupee ceiling is a real guard, tested in its own section. In the
// sections below it is only in the way — a run it blocks proves nothing about
// what is being checked there.
const freeDay = () => h.run(["DEL", DAYKEY()]);
const freshHome = () => { h.run(["DEL", "ads:home:clinic"]); h.run(["DEL", "ads:home:academy"]); };
const sentTo = (ph) => h.sent.filter((s) => s[0] === "wa" && s[1] === ph).map((s) => s[2]);
const bodyOf = (what) => (calls.find((c) => c.what === what) || {}).body || {};

(async () => {
  console.log("MONEY BEHIND THE DAY'S POSTER\n");

  console.log("  — what it does when it is on —");
  seedImage(1);
  h.sent.length = 0;
  const out = await boost.run(cfg, post(1));
  is([out.boosted, out.rupees, out.days], [true, 300, 3], "the poster is promoted — ₹300 over three days, the owner's numbers");
  is(calls.map((c) => c.what), ["campaign", "adset", "adimages", "creative", "ad", "listads"],
    "the first poster of a pillar builds its standing campaign and ad set, then its own creative and ad");
  // Meta refuses to publish an ad set that carries its own budget unless the
  // CAMPAIGN has answered this, and it reads like an ad set field: sent there
  // it is ignored, and 22, 23 and 24 September each lost their ₹300.
  is(bodyOf("campaign").is_adset_budget_sharing_enabled, false, "the campaign says the ad set keeps its own budget — on the campaign, where Meta looks for it");
  is("is_adset_budget_sharing_enabled" in bodyOf("adset"), false, "and not on the ad set, where it does nothing");
  const as = bodyOf("adset");
  // A standing set is paid for by the day and never ends. The old per-poster
  // lifetime budget with an end date is what quietly stopped the academy ad
  // set at midnight on the 30th while its campaign still read ACTIVE.
  is(as.daily_budget, 10000, "the standing set has a DAILY budget in paise — ₹300 over 3 days is ₹100 a day");
  is("lifetime_budget" in as, false, "not a lifetime budget");
  is("end_time" in as, false, "and no end date, so it cannot stop on its own without anybody noticing");
  is(as.status, "PAUSED", "and it is built stopped — a cron never starts spending by itself");
  is([as.destination_type, as.optimization_goal, as.promoted_object.page_id], ["WHATSAPP", "CONVERSATIONS", "page1"], "it is a click-to-WhatsApp ad, optimised for conversations started");
  // Left unsaid, Meta picks a strategy that needs a bid cap and then refuses
  // the ad set for not having one — that cost 24 and 25 September their ad.
  is(as.bid_strategy, "LOWEST_COST_WITHOUT_CAP", "bidding is named: spend the budget, get the most chats, no bid cap to supply");
  const geo = as.targeting.geo_locations.custom_locations[0];
  is([geo.latitude, geo.longitude, geo.radius, geo.distance_unit], [16.7107, 81.0952, 30, "kilometer"], "aimed at Eluru and 30 km around it");
  is([as.targeting.age_min, as.targeting.age_max, as.targeting.publisher_platforms], [20, 60, ["instagram", "facebook"]], "adults, on Instagram and Facebook");
  is(/Clinic/.test(bodyOf("campaign").name), true, "the campaign is named for its pillar, not for one day's poster: " + bodyOf("campaign").name);
  // Meta retired Explore and refuses the whole ad set for asking for it.
  is(as.targeting.instagram_positions.includes("explore"), false, "and not in Explore, which Meta no longer accepts at all");
  // Meta will not publish an ad set until this is answered either way.
  is(as.targeting.targeting_automation, { advantage_audience: 0 }, "and it says plainly that Meta may not widen the audience for us");
  const cr = bodyOf("creative").object_story_spec.link_data;
  is([cr.image_hash, cr.link, cr.call_to_action.type], ["IMGHASH1", "https://wa.me/919959134666", "WHATSAPP_MESSAGE"], "the ad is the poster itself, and the button opens our WhatsApp");
  // Meta deprecated the opt-out field and refuses a creative that sends it.
  is("degrees_of_freedom_spec" in bodyOf("creative"), false, "and nothing Meta has retired is sent with it");
  is(/Hair fall/.test(cr.message), true, "with the post's own caption");
  is(sentTo("9010427777").some((t) => /₹300 pettam/.test(t) && /3 rojulu/.test(t) && /30 km/.test(t)), true, "the owner is told what was put behind it");

  // Seven campaigns in seven days, seven learning phases, none finished — the
  // reason not one poster ever delivered properly. The second poster must go
  // INTO the first one's ad set, not build another beside it.
  console.log("\n  — the second poster joins the first one's set —");
  seedImage(2); calls = []; h.sent.length = 0; freeDay();
  const two = await boost.run(cfg, post(2));
  is(two.boosted, true, "it is promoted");
  is(calls.map((c) => c.what), ["readset", "adimages", "creative", "ad", "listads"],
    "no new campaign and no new ad set — it checks the standing one is still there and adds an ad to it");
  is(two.campaign, "c1", "the same campaign as yesterday, not a new one");

  // An ad set the owner deleted in Ads Manager would otherwise swallow every
  // poster from then on.
  console.log("\n  — if somebody deletes the set in Ads Manager —");
  liveSet = false; seedImage(3); calls = []; freeDay();
  await boost.run(cfg, post(3));
  is(calls.map((c) => c.what).slice(0, 3), ["readset", "campaign", "adset"], "it notices, and builds a new standing set rather than posting into a hole");
  liveSet = true;

  // The budget is the SET's. Left alone, every poster ever made would go on
  // sharing it.
  console.log("\n  — yesterday's posters stand down —");
  setAds = [
    { id: "adA", created_time: "2026-09-28T08:30:00+0530", effective_status: "ACTIVE" },
    { id: "adB", created_time: "2026-09-29T08:30:00+0530", effective_status: "ACTIVE" },
    { id: "adC", created_time: "2026-09-30T08:30:00+0530", effective_status: "ACTIVE" },
    { id: "adD", created_time: "2026-10-01T08:30:00+0530", effective_status: "ACTIVE" },
    { id: "adE", created_time: "2026-09-20T08:30:00+0530", effective_status: "PAUSED" },
  ];
  seedImage(4); calls = []; freeDay();
  const four = await boost.run(cfg, post(4));
  is(four.stoodDown, 1, "with four live and three kept, the oldest one is stood down");
  is(calls.filter((c) => c.what === "edit").map((c) => c.url.split("/").pop().split("?")[0]), ["adA"], "and it is the oldest, not whichever came back first — calls: " + JSON.stringify(calls.map((c) => c.what + " " + c.url.split("/").pop().split("?")[0])));
  is(calls.some((c) => c.what === "scrap"), false, "nothing is deleted — a paused ad is still something somebody can look at");
  setAds = [];

  // The old code cleaned up after a failure by deleting made.adset and
  // made.campaign. Those are now the pillar's standing ones, shared with
  // everything already running in them.
  console.log("\n  — a poster that fails must not take the set with it —");
  seedImage(5); calls = []; freeDay(); fail = "ad";
  const hurt = await boost.run(cfg, post(5));
  fail = null;
  is(hurt.boosted, false, "the poster gets no ad");
  is(calls.some((c) => c.what === "scrap" && /\/(c1|as1)\b/.test(c.url)), false, "and the standing campaign and ad set are NOT deleted");
  is(calls.some((c) => c.what === "edit" && /\/(c1|as1)\b/.test(c.url)), false, "nor paused — everything already running in them keeps running");

  // The clinic is in Eluru and the doctor consults in Telugu. Without this,
  // Meta buys whoever is cheapest inside the radius and the chats arrive in
  // Hindi from people who are never going to come.
  h.run(["SET", "ads:locales", JSON.stringify({ at: Date.now(), ids: [92, 6] })]);
  seedImage(21); calls = []; freeDay(); freshHome();
  await boost.run(cfg, post(21));
  is(bodyOf("adset").targeting.locales, [92, 6], "the ad is shown in the languages the clinic can actually answer");
  h.run(["DEL", "ads:locales"]);
  seedImage(22); calls = []; freeDay(); freshHome();
  await boost.run(cfg, post(22));
  is("locales" in bodyOf("adset").targeting, false, "with none looked up yet, nothing is invented — no locales at all rather than a guessed number");

  console.log("\n  — what it refuses —");
  calls = [];
  is((await boost.run(cfg, post(1))).why, "already boosted", "the same poster is never boosted twice");
  is(calls.length, 0, "nothing is even asked of Meta the second time");
  // Posters of its own: the sections above have already boosted the low
  // numbers, and a run skipped as "already boosted" never reaches the ceiling
  // this is about.
  freeDay(); seedImage(31); seedImage(32); seedImage(33); seedImage(34);
  await boost.run(cfg, post(31));
  await boost.run(cfg, post(32));
  await boost.run(cfg, post(33));
  calls = [];
  const capped = await boost.run(cfg, post(34));
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
  // Only what this poster made. The ad set and campaign belong to the pillar
  // now and are shared with whatever is already running in them — deleting
  // them over one refused creative is what the old code did.
  is(calls.filter((c) => c.what === "scrap").length <= 1, true, "at most its own creative is scrapped");
  is(calls.some((c) => c.what === "scrap" && /\/(c1|as1)\b/.test(c.url)), false, "never the standing campaign or ad set");
  is(sentTo("9010427777").some((t) => /ad pettaleka poyam/.test(t) && /payment method/.test(t)), true, "and the owner hears why, with what to check");
  is(h.run(["GET", "boost:boost:ig7"]), null, "the poster is not marked done, so tomorrow may try again");
  is(Number(h.run(["GET", "boost:day:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())])), 0, "and the money it had counted is given back to the day");

  console.log("\n  — the owner's numbers —");
  const saved = await boost.save(cfg, { rupees: 500, days: 5, km: 45, maxPerDay: 2000 }, "Owner");
  is([saved.ok, saved.boost.rupees, saved.boost.days, saved.boost.km], [true, 500, 5, 45], "the control panel's numbers are what it uses");
  is((await boost.save(cfg, { rupees: 3000, maxPerDay: 1000 }, "Owner")).error, "Roju limit, okka post budget kanna ekkuva undali", "a per-post budget above the day's ceiling is refused");
  is((await boost.load(cfg)).km, 45, "and a refused save changes nothing");
  // A standing set is built once and then reused, so the settings only reach
  // Meta when there is a set to build. Clear it and watch the next one.
  seedImage(8); calls = []; freeDay(); freshHome();
  await boost.run(cfg, post(8));
  is([bodyOf("adset").daily_budget, bodyOf("adset").targeting.geo_locations.custom_locations[0].radius], [10000, 45], "₹500 over 5 days is ₹100 a day, and 45 km, reaching Meta");
  is((await boost.save(cfg, { km: 5 }, "Owner")).boost.km, 17, "a radius smaller than Meta allows is pulled up to its smallest, not ignored");
  is((await boost.save(cfg, { km: 500 }, "Owner")).boost.km, 80, "and one bigger than it allows, down to its largest");

  // Two radii, because the two things the clinic sells are not the same
  // journey. Getting this the wrong way round is the exact complaint the
  // owner raised: leads from towns nobody is going to travel in from.
  console.log("\n  — how far each kind of poster goes —");
  // This section makes six ads, which is more than the day's real ceiling.
  // Left as it is, the day limit — not the radius — would decide the answers,
  // and it would starve whatever test ran next.
  const DAYKEY = "boost:day:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await boost.save(cfg, { rupees: 300, days: 3, km: 30, kmAcademy: 80, maxPerDay: 20000 }, "Owner");
  const radiusFor = async (n, topic) => {
    seedImage(n); h.run(["DEL", DAYKEY]); h.run(["DEL", "boost:ig" + n]); freshHome(); calls = []; h.sent.length = 0;
    const r = await boost.run(cfg, Object.assign(post(n), { topic }));
    if (!r.boosted) return `not boosted: ${r.why}`;
    return bodyOf("adset").targeting.geo_locations.custom_locations[0].radius;
  };
  is(await radiusFor(20, "acad-trainer"), 80, "an academy poster goes the whole 80 km — a six-week course is worth the bus");
  is(sentTo("9010427777").some((t) => /80 km/.test(t)), true, "and the owner is told 80, not the number in the other box");
  is(await radiusFor(21, "bridal"), 30, "a clinic poster stays at 30 — nobody drives 80 km for a facial");
  is(await radiusFor(22, "hair-fall"), 30, "and so does a treatment poster");
  // A topic that has been renamed or removed must not silently inherit the
  // wide one: unknown means clinic, the cheaper mistake.
  is(await radiusFor(23, "no-such-topic"), 30, "a topic this build has never heard of falls back to the clinic radius");
  is(await radiusFor(24, ""), 30, "and so does a post with no topic at all");
  // Every academy topic, asked of the list that defines them rather than of a
  // pattern in their names.
  is(daily.ACADEMY_TOPICS.every((t) => boost.kmFor({ km: 30, kmAcademy: 80 }, t.key) === 80), true, "every academy topic, not just the one that was tested");
  is(daily.TOPICS.every((t) => boost.kmFor({ km: 30, kmAcademy: 80 }, t.key) === 30), true, "and no clinic topic leaks into the wide one");
  is((await boost.save(cfg, { kmAcademy: 500 }, "Owner")).boost.kmAcademy, 80, "80 km is Meta's own limit, so a bigger number is pulled back to it");
  is((await boost.save(cfg, { kmAcademy: 2 }, "Owner")).boost.kmAcademy, 17, "and a smaller one up to its smallest");
  // Put the day and the settings back the way the next section expects them.
  h.run(["DEL", DAYKEY]);
  await boost.save(cfg, { rupees: 500, days: 5, km: 45, kmAcademy: 80, maxPerDay: 2000 }, "Owner");

  console.log("\n  — arithmetic Meta would refuse —");
  // This account will not run a lifetime budget below about ₹95 a day.
  is((await boost.save(cfg, { rupees: 300, days: 5 }, "Owner")).error,
    "₹300 ki 5 rojulu kudarav — Meta roju kaneesam ₹100 adugutundi. 3 rojulu varaku, leda budget ₹500 cheyandi.",
    "₹300 stretched over five days is refused, with both ways out spelled");
  is([(await boost.load(cfg)).rupees, (await boost.load(cfg)).days], [500, 5], "the settings that were already there stand");
  is((await boost.save(cfg, { rupees: 300, days: 3 }, "Owner")).ok, true, "₹300 over three days is fine");
  h.run(["SET", "boost:cfg", JSON.stringify({ on: true, rupees: 200, days: 7, km: 30, maxPerDay: 900 })]);   // as if edited outside the app
  seedImage(9); calls = []; freeDay(); freshHome();
  const short = await boost.run(cfg, post(9));
  is([short.days, bodyOf("adset").daily_budget], [2, 10000], "a stored setting Meta would refuse is shortened, not lost — ₹200 over 2 days is ₹100 a day");

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
  is([cp.body.boosted && cp.body.boosted.boosted, calls.filter((c) => c.what === "ad").length], [true, 1],
    "the poster goes live at 8:30 and the money follows it in the same run — as an ad in the standing set, not a campaign of its own");
  is(bodyOf("ad").name.indexOf("hair-fall") > -1, true, "the AD is named after the day's topic; the campaign is named after the pillar and outlives it");
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
