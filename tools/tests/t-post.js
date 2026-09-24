// Posting to Instagram and Facebook from the app. The engine underneath is
// the one WhatsApp has always used — this only checks the way in.
const path = require("path");
const h = require("./harness.js");
// the publisher is stubbed: a test must never actually post to Instagram
const admPath = path.join(process.env.DL_API, "_admin.js");
const published = [];
const deleted = [];
let refuse = "";
require.cache[admPath] = { id: admPath, filename: admPath, loaded: true, exports: {
  publishNow: async (cfg, item) => {
    published.push(item);
    if (item.caption === "FAIL") return { ok: false, transient: false, msg: "image processing error" };
    if (item.caption === "SLOW") return { ok: false, transient: true, msg: "still processing" };
    return { ok: true, link: "https://instagram.com/p/xyz", fb: true, fbId: "fb_1", id: "ig_1" };
  },
  deletePost: async (cfg, entry) => {
    deleted.push(entry);
    if (refuse === "GONE") return { ok: true, ig: false, fb: false, gone: true, error: "" };
    if (refuse) return { ok: false, ig: false, fb: false, error: refuse };
    return { ok: true, ig: true, fb: !!entry.fbId, error: "" };
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

  // ---- taking one back down ----------------------------------------------
  // A post already on the account. Instagram has to agree first: if Meta
  // refuses, the row must stay in the list rather than vanishing from the app
  // while it is still live for everybody else.
  console.log("\n  — taking one back down —");
  h.run(["DEL", "post:log"]);
  h.run(["SET", "adm:img:pic1", "PICBYTES"]);
  h.run(["LPUSH", "post:log", JSON.stringify({ id: "ig_live", imgId: "pic1", fbId: "fb_live", caption: "Laser", kind: "post", at: Date.now() })]);
  is((await P({ a: "remove" }, { a: "remove" })).code, 400, "no id, nothing happens");
  is((await P({ a: "remove" }, { a: "remove", id: "not_ours" })).code, 404, "and an id we never posted is not ours to delete");

  refuse = "Requires instagram_manage_contents";
  const no = await P({ a: "remove" }, { a: "remove", id: "ig_live" });
  is(no.code, 502, "when Meta refuses, the app says so");
  is(/instagram_manage_contents/.test(no.body.error), true, "with Meta's own reason: " + no.body.error);
  is(h.run(["LRANGE", "post:log", "0", "9"]).length, 1, "and the post is still in the list, because it is still on the account");

  refuse = "";
  const gone = await P({ a: "remove" }, { a: "remove", id: "ig_live" });
  is([gone.code, gone.body.ig, gone.body.fb], [200, true, true], "when it works, Instagram and the Facebook copy both go");
  is(deleted[deleted.length - 1].fbId, "fb_live", "the Facebook post id was carried through, so half of it is not left standing");
  is(h.run(["LRANGE", "post:log", "0", "9"]).length, 0, "the row goes from the list");
  is(h.run(["GET", "adm:img:pic1"]), null, "and the picture with it");
  is((await P({ a: "remove" }, { a: "remove", id: "ig_live" })).code, 404, "deleting it twice says it is already gone");

  // Somebody deletes it from the phone instead. The row must still be
  // clearable, or the list keeps a post nobody can ever get rid of.
  h.run(["LPUSH", "post:log", JSON.stringify({ id: "ig_byhand", imgId: "", caption: "Laser", kind: "post", at: Date.now() })]);
  refuse = "GONE";
  const byHand = await P({ a: "remove" }, { a: "remove", id: "ig_byhand" });
  is([byHand.code, byHand.body.gone], [200, true], "one already deleted from the phone still clears from the list");
  is(h.run(["LRANGE", "post:log", "0", "9"]).length, 0, "and the row goes");
  refuse = "";

  // who may
  console.log("\n  — who may post —");
  h.as(["posts.view"]);
  is((await P({ a: "list" })).code, 200, "somebody who may see posts, sees them");
  is((await P({ a: "list" })).body.canPost, false, "and the app is told not to draw the button");
  is((await P({ a: "create" }, { a: "create", image: PIC, caption: "x" })).code, 403, "but cannot post");
  is((await P({ a: "remove" }, { a: "remove", id: "ig_live" })).code, 403, "and cannot take one down either");
  h.as(["leads.view"]);
  is((await P({ a: "list" })).code, 403, "somebody with no posts permission sees none of it");
  h.as(["*"]);

  // ---- which post brought somebody in -------------------------------------
  // Until now a post went out and the clinic never found out whether anybody
  // came of it. The join is by time, so the rules around the edges are the
  // whole thing: the right post, only social leads, and money counted once.
  console.log("\n  — what each post actually did —");
  h.run(["DEL", "post:log"]); h.run(["DEL", "dl_leads"]); h.run(["DEL", "dl_status"]);
  const H = 3600000, now2 = Date.now();
  const older = now2 - 10 * 24 * H,  newer = now2 - 2 * 24 * H;
  h.run(["RPUSH", "post:log", JSON.stringify({ id: "p_new", caption: "Laser reel", kind: "reel", at: newer })]);
  h.run(["RPUSH", "post:log", JSON.stringify({ id: "p_old", caption: "Acne post", kind: "post", at: older })]);

  const lead = (ts, phone, src) => h.run(["RPUSH", "dl_leads", JSON.stringify({ ts, phone, name: "L" + phone.slice(-2), src })]);
  lead(newer + 2 * H, "9000000011", "instagram");       // 2h after the reel
  lead(newer + 30 * H, "9000000012", "facebook");       // next day, still the reel
  lead(older + 1 * H, "9000000013", "instagram");       // the older post
  lead(older + 96 * H, "9000000014", "instagram");      // four days later — neither
  lead(newer + 3 * H, "9000000015", "walk-in");         // not from social at all
  lead(newer - 5 * H, "9000000016", "instagram");       // before the reel went up
  h.run(["HSET", "dl_status", (newer + 2 * H) + "|9000000011", "visited"]);
  h.run(["HSET", "dl_status", (newer + 30 * H) + "|9000000012", "booked"]);
  h.run(["HSET", "dl_status", (older + 1 * H) + "|9000000013", "visited"]);
  // the one who came, paid
  h.run(["RPUSH", "bill:of:9000000011", "BX1"]);
  h.run(["SET", "bill:BX1", JSON.stringify({ id: "BX1", phone: "9000000011",
    items: [{ name: "Laser", price: 12000 }], payments: [{ amount: 12000, ts: newer + 26 * H }] })]);

  const credited = await P({ a: "list" });
  const byId = {}; credited.body.posted.forEach((x) => { byId[x.id] = x; });
  is(byId.p_new.leads, 2, "the reel gets the two who wrote in after it");
  is(byId.p_new.came, 1, "one of them actually turned up");
  is(byId.p_new.revenue, 12000, "and what that one paid");
  is(byId.p_old.leads, 1, "the older post keeps its own");
  is(byId.p_old.came, 1, "who also came");
  is(byId.p_old.revenue, 0, "but paid nothing");
  is(credited.body.creditHours, 72, "and the screen is told the window it is being shown");

  console.log("\n  — and what it must not count —");
  is(byId.p_new.leads + byId.p_old.leads, 3,
    "a walk-in, somebody four days later, and somebody who wrote in BEFORE the post are all left out");

  // Money paid before the post existed is not the post's doing.
  h.run(["RPUSH", "bill:of:9000000013", "BX2"]);
  h.run(["SET", "bill:BX2", JSON.stringify({ id: "BX2", phone: "9000000013",
    items: [{ name: "Peel", price: 4000 }], payments: [{ amount: 4000, ts: older - 5 * H }] })]);
  const again = await P({ a: "list" });
  is(again.body.posted.find((x) => x.id === "p_old").revenue, 0,
    "a payment made before the post went out is not credited to it");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nposting behaves");
})();
