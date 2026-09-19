// Daily posters made in the app: saved, and put out from there.
//
// The first version showed a poster and forgot it — two hours later the
// picture was gone and nothing listed it. The owner made one, liked it, and
// could do nothing with it. The builder is stubbed here (a test must never
// call Gemini or open Chrome) and so is the publisher; what is checked is that
// a poster is kept, and that every way of putting it out — now, tomorrow at
// 8:30, or not at all — leaves the queue and the automatic poster right.
const path = require("path");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const API = process.env.DL_API;
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
const real = require(path.join(API, "_daily.js"));
const asked = [];
let n = 0;
stub("_daily.js", Object.assign({}, real, {
  createDailyPost: async (cfg, opts) => {
    asked.push(opts);
    const t = real.ACADEMY_TOPICS.concat(real.TOPICS).find((x) => x.key === (opts.topic || "acad-seats"));
    const imgId = String(++n).padStart(32, "0");
    h.run(["SET", `adm:img:${imgId}`, "img", "EX", String(opts.keepSec || 7200)]);
    return { imgId, caption: "cap " + n, topic: Object.assign({}, t, { look: { key: "daylight" } }), hadImage: true, preview: true, doctor: "Dr. Meghana Valeti" };
  },
}));
const published = [];
stub("_admin.js", { publishNow: async (cfg, item) => { published.push(item); return { ok: true, link: "https://instagram.com/p/x", fb: true }; }, fmtIst: () => "" });

const poster = h.load("poster");
const P = (q, b) => h.call(poster, q, b);
const queue = () => h.run(["LRANGE", "adm:queue", "0", "99"]).map((x) => JSON.parse(x));

(async () => {
  console.log("DAILY POSTERS MADE IN THE APP\n");
  const t = await P({ a: "topics" });
  is(t.body.topics.length, real.ACADEMY_TOPICS.length + real.TOPICS.length, "every poster in the library is offered");

  const c1 = await P({ a: "create" }, { a: "create", note: "navvutunna ammayi" });
  is(c1.code, 200, "a poster is made");
  is(asked[0].preview, true, "as a preview — building it queues nothing");
  is(asked[0].keepSec, 14 * 86400, "and its picture is kept a fortnight, not two hours");
  is(asked[0].note, "navvutunna ammayi", "with what the owner asked for passed to the picture");
  is(c1.body.poster.status, "draft", "it starts as a draft");
  const c2 = await P({ a: "create" }, { a: "create", topic: "hydrafacial" });

  console.log("\n  — it is still there afterwards —");
  const l1 = await P({ a: "list" });
  is(l1.body.posters.map((p) => p.topic), ["hydrafacial", "acad-seats"], "both are listed, newest first");
  is(l1.body.posters[1].note, "navvutunna ammayi", "with the owner's words kept on the card");
  is(queue().length, 0, "and nothing has gone to the queue");

  console.log("\n  — redo it —");
  const id1 = c1.body.poster.id, old = c1.body.poster.imgId;
  const r = await P({ a: "regenerate" }, { a: "regenerate", id: id1, note: "more light" });
  is(r.body.poster.imgId !== old, true, "a new picture");
  is(asked[2].topic, "acad-seats", "of the same poster");
  is(asked[2].note, "more light", "with the new instruction");
  is(h.run(["GET", `adm:img:${old}`]), null, "and the picture it replaced is thrown away");

  console.log("\n  — tomorrow at 8:30 —");
  const s = await P({ a: "schedule" }, { a: "schedule", id: id1 });
  is(s.body.poster.status, "scheduled", "it is scheduled");
  const q = queue();
  is(q.length, 2, "the post and its story are queued");
  is(q.every((x) => x.imgId === s.body.poster.imgId), true, "with this poster's picture");
  const ist = new Date(s.body.poster.due + 330 * 60000);
  is([ist.getUTCHours(), ist.getUTCMinutes()], [8, 30], "at 8:30 in Eluru");
  const day = ist.toISOString().slice(0, 10);
  is(h.run(["GET", `dp:done:${day}`]), "app", "and that morning's automatic poster is stood down, so two do not go out");
  is((await P({ a: "schedule" }, { a: "schedule", id: c2.body.poster.id })).code, 409, "a second poster cannot take the same slot");

  const r2 = await P({ a: "regenerate" }, { a: "regenerate", id: id1 });
  is(queue().filter((x) => x.imgId === r2.body.poster.imgId).length, 2, "redoing a scheduled poster swaps the new picture into the queue — post and story");
  is(queue().some((x) => x.imgId === s.body.poster.imgId), false, "and nothing still points at the old one");
  is(r2.body.poster.status, "scheduled", "and it stays scheduled");

  console.log("\n  — changed my mind —");
  const rm = await P({ a: "remove" }, { a: "remove", id: id1 });
  is(rm.code, 200, "a scheduled poster can be removed");
  is(queue().length, 0, "it comes back out of the queue — post and story");
  is(h.run(["GET", `dp:done:${day}`]), null, "and the automatic poster gets its morning back");

  console.log("\n  — now —");
  const p = await P({ a: "post" }, { a: "post", id: c2.body.poster.id });
  is(p.body.poster.status, "posted", "posted");
  is(published[0].imgId, c2.body.poster.imgId, "the saved picture is what went to Instagram");
  is((await P({ a: "post" }, { a: "post", id: c2.body.poster.id })).code, 400, "and it cannot be posted twice");

  console.log("\n  — a scheduled one that has since gone out —");
  const c3 = await P({ a: "create" }, { a: "create" });
  await P({ a: "schedule" }, { a: "schedule", id: c3.body.poster.id });
  h.run(["LPUSH", "post:log", JSON.stringify({ imgId: c3.body.poster.imgId, kind: "post", link: "https://instagram.com/p/y", at: Date.now() })]);
  const l2 = await P({ a: "list" });
  const got = l2.body.posters.find((x) => x.id === c3.body.poster.id);
  is([got.status, got.link], ["posted", "https://instagram.com/p/y"], "the card says it went, with its link");

  console.log("\n  — who may, and how often —");
  is((await P({ a: "create" }, { a: "create", topic: "../x" })).code, 400, "an unknown topic is refused");
  is((await P({ a: "post" }, { a: "post", id: "nope" })).code, 404, "an unknown poster is not found");
  h.as(["posts.view"]);
  is((await P({ a: "list" })).code, 403, "somebody who may only look at posts cannot make them");
  h.as(["*"]);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await P({ a: "create" }, { a: "create" })).code;
  is(last, 429, "each build is an image bill, so a dozen an hour is the ceiling");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ndaily posters behave");
  process.exit(fails ? 1 : 0);
})();
