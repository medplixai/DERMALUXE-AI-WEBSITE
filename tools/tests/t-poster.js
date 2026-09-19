// Looking at a poster in the app, before it exists anywhere else.
//
// The builder is the real one in production; here it is stubbed, because a
// test must never call Gemini or open Chrome. What matters is who may ask,
// that it is always asked for a PREVIEW (a real build would queue a post),
// and that a runaway button cannot run up the image bill.
const path = require("path");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const API = process.env.DL_API;
const real = require(path.join(API, "_daily.js"));
const asked = [];
const p = path.join(API, "_daily.js");
require.cache[p] = { id: p, filename: p, loaded: true, exports: Object.assign({}, real, {
  createDailyPost: async (cfg, opts) => {
    asked.push(opts);
    const t = real.ACADEMY_TOPICS.concat(real.TOPICS).find((x) => x.key === (opts.topic || "acad-seats"));
    return { imgId: "a".repeat(32), caption: "cap", topic: Object.assign({}, t, { look: { key: "daylight" } }), hadImage: true, preview: true, doctor: "Dr. Meghana Valeti" };
  },
}) };
const poster = h.load("poster");
const P = (q, b) => h.call(poster, q, b);

(async () => {
  console.log("POSTER PREVIEW IN THE APP\n");
  const t = await P({ a: "topics" });
  is(t.code, 200, "the list of posters opens");
  is(t.body.topics.length, real.ACADEMY_TOPICS.length + real.TOPICS.length, "every poster in the library is offered");
  is(t.body.topics[0].pillar, "academy", "academy ones first");

  const r = await P({ a: "preview" }, { a: "preview" });
  is(r.code, 200, "a preview is built");
  is(asked[0].preview, true, "and the builder is told it is only a preview — nothing queued, nothing posted");
  is(r.body.imgId.length, 32, "the app gets the picture to show");
  is([r.body.h1.length > 0, r.body.look, r.body.doctor], [true, "daylight", "Dr. Meghana Valeti"], "with its headline, look and doctor");

  const one = await P({ a: "preview" }, { a: "preview", topic: "hydrafacial" });
  is(asked[1].topic, "hydrafacial", "a particular poster can be asked for");
  is(one.body.topic, "hydrafacial", "and that is the one that comes back");
  is((await P({ a: "preview" }, { a: "preview", topic: "../../etc" })).code, 400, "an unknown topic is refused");

  console.log("\n  — who may —");
  h.as(["posts.view"]);
  is((await P({ a: "preview" }, { a: "preview" })).code, 403, "somebody who may only look at posts cannot build one");
  h.as(["*"]);

  console.log("\n  — and not without limit —");
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await P({ a: "preview" }, { a: "preview" })).code;
  is(last, 429, "each build is an image bill, so a dozen an hour is the ceiling");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe poster preview behaves");
  process.exit(fails ? 1 : 0);
})();
