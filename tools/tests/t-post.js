// Posting to Instagram and Facebook from the app. The engine underneath is
// the one WhatsApp has always used — this only checks the way in.
const path = require("path");
const h = require("./harness.js");
// the publisher is stubbed: a test must never actually post to Instagram
const admPath = path.join(process.env.DL_API, "_admin.js");
const published = [];
require.cache[admPath] = { id: admPath, filename: admPath, loaded: true, exports: {
  publishNow: async (cfg, item) => {
    published.push(item);
    if (item.caption === "FAIL") return { ok: false, transient: false, msg: "image processing error" };
    if (item.caption === "SLOW") return { ok: false, transient: true, msg: "still processing" };
    return { ok: true, link: "https://instagram.com/p/xyz", fb: true, id: "ig_1" };
  },
} };
const post = h.load("post");
const P = (q, b) => h.call(post, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const PIC = "data:image/jpeg;base64," + Buffer.from("x".repeat(600)).toString("base64");

(async () => {
  console.log("POSTING FROM THE APP\n");
  const empty = await P({ a: "list" });
  is(empty.code, 200, "the screen opens with nothing posted yet");
  is(empty.body.queue.length, 0, "empty queue");
  is(empty.body.account, "@dermaluxe.ai", "and it says which account these go to");

  // what must not be accepted
  is((await P({ a: "create" }, { a: "create", caption: "hi" })).code, 400, "a post with no photo is refused");
  is((await P({ a: "create" }, { a: "create", image: PIC })).code, 400, "and one with no caption");
  is((await P({ a: "create" }, { a: "create", image: "data:text/plain;base64,aGk=", caption: "x" })).code, 400, "a file that is not an image is refused");
  const huge = "data:image/jpeg;base64," + "A".repeat(1_500_000);
  is((await P({ a: "create" }, { a: "create", image: huge, caption: "x" })).code, 413, "and one too big for the store");

  // now
  const now = await P({ a: "create" }, { a: "create", image: PIC, caption: "Hydrafacial roju" });
  is(now.code, 200, "a real one goes out");
  is(now.body.link, "https://instagram.com/p/xyz", "with the Instagram link back");
  is(now.body.fb, true, "and it says Facebook got it too");
  is(published.length, 1, "the engine was asked exactly once");
  is(published[0].caption, "Hydrafacial roju", "with the caption");
  is(!!published[0].imgId, true, "and an image it can fetch");
  is(!!h.run(["GET", "adm:img:" + published[0].imgId]), true, "the photo is where /api/media will look for it");

  // failures must not leave rubbish behind
  const bad = await P({ a: "create" }, { a: "create", image: PIC, caption: "FAIL" });
  is(bad.code, 400, "a post Instagram rejects is reported");
  is(/image processing/.test(bad.body.error), true, "with the reason: " + bad.body.error);
  const slow = await P({ a: "create" }, { a: "create", image: PIC, caption: "SLOW" });
  is(slow.code, 503, "and one still processing says try again, not failed");

  // scheduling
  console.log("\n  — later —");
  const soon = Date.now() + 3 * 3600000;
  const sch = await P({ a: "create" }, { a: "create", image: PIC, caption: "Repu podduna", due: soon });
  is(sch.code, 200, "a post can be queued for later");
  is(sch.body.scheduled, true, "and says so");
  is(published.length, 3, "nothing was published — it only went in the queue");
  const q = h.run(["LRANGE", "adm:queue", "0", "9"]).map((x) => JSON.parse(x));
  is(q.length, 1, "the cron will find exactly one");
  is(q[0].due, soon, "at the right time");
  is(q[0].by, "Owner", "knowing who queued it");

  is((await P({ a: "create" }, { a: "create", image: PIC, caption: "x", due: Date.now() - 86400000 })).code, 400,
     "the past cannot be scheduled");
  is((await P({ a: "create" }, { a: "create", image: PIC, caption: "x", due: Date.now() + 90 * 86400000 })).code, 400,
     "nor three months out — a mistyped date should not park a post for a year");

  const listed = await P({ a: "list" });
  is(listed.body.queue.length, 1, "the screen shows the queued one");
  is(listed.body.queue[0].caption, "Repu podduna", "with its caption");

  // cancelling
  const cancelled = await P({ a: "cancel" }, { a: "cancel", imgId: q[0].imgId });
  is(cancelled.code, 200, "it can be taken out again");
  is(h.run(["LRANGE", "adm:queue", "0", "9"]).length, 0, "and the queue is empty");
  is(h.run(["GET", "adm:img:" + q[0].imgId]), null, "the photo goes with it, not left behind");
  is((await P({ a: "cancel" }, { a: "cancel", imgId: q[0].imgId })).code, 404, "cancelling it twice says it is already gone");

  // who may
  console.log("\n  — who may post —");
  h.as(["posts.view"]);
  is((await P({ a: "list" })).code, 200, "somebody who may see posts, sees them");
  is((await P({ a: "list" })).body.canPost, false, "and the app is told not to draw the button");
  is((await P({ a: "create" }, { a: "create", image: PIC, caption: "x" })).code, 403, "but cannot post");
  h.as(["leads.view"]);
  is((await P({ a: "list" })).code, 403, "somebody with no posts permission sees none of it");
  h.as(["*"]);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nposting behaves");
})();
