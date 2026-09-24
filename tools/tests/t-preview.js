// Looking at a poster must not change anything.
//
// The daily job builds one poster a day, queues it, marks the day done and
// writes the topic into the history that decides what comes next. A preview
// runs the same builder, so the danger is not that it looks wrong — it is that
// asking to see tomorrow's poster silently posts it, or uses up the topic, or
// marks the day done so the real 7am run skips.
const path = require("path");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const API = process.env.DL_API;
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };

// The builder is stubbed: a test must never open Chrome or call Gemini. What
// matters is the options it is handed and what the caller does afterwards.
let built = [];
const real = require(path.join(API, "_daily.js"));
stub("_daily.js", Object.assign({}, real, {
  createDailyPost: async (cfg, opts) => {
    built.push(opts);
    // the real one returns early on preview, writing nothing but the image
    if (!opts.preview) {
      h.run(["LPUSH", "adm:queue", JSON.stringify({ imgId: "i1", auto: true })]);
      h.run(["LPUSH", "dp:hist", "acad-seats|2026-09-18"]);
      h.run(["SET", "dp:today", "{}"]);
    }
    return { imgId: "i1", storyId: "s1", caption: "c", topic: { key: "acad-seats", h1: "Ten seats. One batch.", sub: "Only 2 seats left" },
      due: Date.now() + 3600000, by: "Owner", notify: ["9010427777"], hadImage: true, queued: !opts.preview, preview: !!opts.preview };
  },
}));
let publishes = 0;
stub("_admin.js", { publishNow: async () => { publishes++; return { ok: true, link: "l", id: "ig_now" }; }, fmtIst: () => "8:30 AM" });
const boosts = [];
stub("_boost.js", { run: async (cfg, post) => { boosts.push(post); return { boosted: true, rupees: 300 }; } });

const sentWa = [];
global.fetch = async (url, opt) => {
  sentWa.push({ url: String(url), body: opt && opt.body ? JSON.parse(opt.body) : null });
  return { ok: true, json: async () => ({}) };
};

process.env.ADMIN_KEY = "k";
// waImage/waText return false without ever calling out when these are absent,
// so without them the "the owner does see it" case would pass by doing nothing.
process.env.WA_CLOUD_TOKEN = "test-token";
process.env.WA_PHONE_ID_ALLOWLIST = "1237387512796539";
delete process.env.CRON_SECRET;
const cron = h.load("cron-daily");
const C = (q) => h.call(cron, Object.assign({ key: "k" }, q || {}));

(async () => {
  console.log("POSTER PREVIEW\n");

  const p = await C({ preview: "1", topic: "acad-seats" });
  is(p.code, 200, "the preview runs");
  is(p.body.preview, true, "and says that is what it was");
  is(p.body.topic, "acad-seats", "the poster that was asked for");
  is(built[0].preview, true, "the builder is told it is a preview");
  is(built[0].queue, false, "and told not to queue");

  console.log("\n  — and leaves nothing behind —");
  is(publishes, 0, "nothing was published");
  is(h.run(["LRANGE", "adm:queue", "0", "9"]).length, 0, "nothing was queued — not the post, not the story");
  is(h.run(["LRANGE", "dp:hist", "0", "9"]).length, 0, "the topic is not used up");
  is(h.run(["GET", "dp:today"]), null, "and today's topic is untouched");
  is(h.run(["GET", "dp:done:" + real.todayIst()]), null, "the day is not marked done, so 7am still runs");

  console.log("\n  — but the owner does see it —");
  is(sentWa.length >= 1, true, "a WhatsApp went out");
  const first = sentWa[0] || { url: "", body: {} };
  is(/messages$/.test(first.url), true, "to the WhatsApp Cloud API");
  is(first.body.type, "image", "as the picture itself");
  is(/Preview only/.test((first.body.image || {}).caption || ""), true,
    "labelled so nobody thinks it is live: " + String((first.body.image || {}).caption || "").split("\n")[0]);
  is(p.body.sentTo, 1, "and it says how many people got it");

  console.log("\n  — the ordinary run is untouched —");
  built = []; sentWa.length = 0;
  const day = await C({ force: "1" });
  is(day.code, 200, "a normal run still works");
  is(built[0].preview, false, "not marked as a preview");
  is(built[0].queue, true, "and it does queue");
  is(h.run(["LRANGE", "adm:queue", "0", "9"]).length >= 1, true, "so something is waiting to go out");
  is(h.run(["LRANGE", "dp:hist", "0", "9"]).length, 1, "and the topic is recorded this time");
  // The story is its own 1080×1920 drawing. Queuing the feed poster as a
  // story is what cut the WhatsApp number off the right-hand edge.
  const story = h.run(["LRANGE", "adm:queue", "0", "9"]).map((x) => JSON.parse(x)).find((q) => q.story);
  is(story && story.imgId, "s1", "the story queued is the story-shaped picture, not the feed poster");
  is(story && story.quiet, true, "and it goes out without a second 'it is live' message");

  // "daily post now" is the same poster, published at a different hour. Before
  // this it quietly meant "and no ad today" — cron-post put the money behind
  // the 8:30 one, and nothing put it behind this one.
  console.log("\n  — posting it by hand still gets the day's money —");
  built = []; sentWa.length = 0; boosts.length = 0;
  const nowRun = await C({ now: "1" });
  is(nowRun.code, 200, "it publishes");
  is(boosts.length, 1, "and the boost runs once");
  is([boosts[0].id, boosts[0].topic], ["ig_now", "acad-seats"], "against the post that actually went out, named for the day's topic");
  is(nowRun.body.boosted.boosted, true, "and the answer says what the money did");

  console.log("\n  — who may ask —");
  is((await h.call(cron, { preview: "1" })).code, 401, "no key, no preview");
  is((await h.call(cron, { key: "wrong", preview: "1" })).code, 401, "and a wrong one is no better");

  // This endpoint publishes to Instagram on ?now=1. It used to read
  // `CRON_SECRET ? check it : true`, so with that variable missing anybody
  // could have posted to the clinic's account.
  const ak = process.env.ADMIN_KEY;
  delete process.env.ADMIN_KEY; delete process.env.CRON_SECRET;
  publishes = 0;   // count only what THIS call does
  const open = await h.call(cron, { key: "anything", now: "1" });
  is(open.code, 401, "and with no secret configured at all it refuses, rather than standing open");
  is(String(open.body.note || "").includes("unset"), true, "saying why");
  is(publishes, 0, "nothing reached Instagram");
  process.env.ADMIN_KEY = ak;

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe preview behaves");
  process.exit(fails ? 1 : 0);
})();
