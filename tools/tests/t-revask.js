// The clinic no longer asks anybody for a Google review.
//
// This file used to check that the right people were asked and the wrong ones
// were left alone — that somebody still being chased for a bill was never
// asked, that nobody was asked twice in six months. All of that was careful,
// and all of it is now beside the point: the NMC's advertising guidelines of
// 6 October 2026, clause 3.2 Explanation V, say that "an RMP shall not request
// or share patient testimonials, recommendations, endorsements or reviews for
// professional promotion".
//
// Our ask was genuine, unpaid and offered nothing in return, which answers the
// first sentence of that Explanation. It does not answer the second. So the
// schedule is gone and the endpoint refuses, and what is worth testing now is
// that it refuses — including when somebody with a valid key runs it by hand,
// which is exactly how a disabled job comes back to life.
process.env.REVIEW_LINK = "https://g.page/r/DERMALUXE/review";
const path = require("path");
const h = require("./harness.js");
process.env.ADMIN_KEY = "test-admin-key";
process.env.CRON_SECRET = "test-cron-secret";
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const cron = h.load("cron-review");
const R = (q) => h.call(cron, Object.assign({ key: "test-admin-key" }, q || {}));
const asScheduler = (auth) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; },
    json(o) { resolve({ code: this._c, body: o }); return this; } };
  cron({ method: "GET", headers: { authorization: auth }, query: {}, body: {} }, res);
});
const dayBack = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date(Date.now() - n * 86400000));

(async () => {
  console.log("THE REVIEW ASK — switched off, and staying off\n");

  // A paid-up bill from two days ago is exactly the case that used to trigger
  // an ask. It is the strongest test that nothing goes out now.
  const day2 = dayBack(2);
  h.run(["SADD", `bill:day:${day2}`, "b1"]);
  h.run(["SET", "bill:b1", JSON.stringify({ id: "b1", phone: "9876511111", name: "Lakshmi", total: 2000, paid: 2000, day: day2 })]);
  h.sent.length = 0;

  const run = await R({ day: day2 });
  is(run.code, 200, "the endpoint still answers, so nothing 404s");
  is(run.body.disabled, true, "it says plainly that it is disabled");
  is(run.body.sent, 0, "and sends nobody");
  is(/Explanation V/.test(String(run.body.note || "")), true, "naming the clause, so the next person knows why");
  is(h.sent.length, 0, "a patient who paid in full two days ago is not asked");

  // force=1 was the owner's own override. A disabled job that an override can
  // restart is not disabled.
  h.sent.length = 0;
  const forced = await R({ day: day2, force: "1" });
  is([forced.body.sent, h.sent.length], [0, 0], "and force=1 does not bring it back");

  // The schedule is gone from vercel.json, but a scheduler that still had the
  // old path must not get a different answer from a manual run.
  const sched = await asScheduler("Bearer test-cron-secret");
  is([sched.code, sched.body.sent, sched.body.disabled], [200, 0, true], "the scheduler gets the same refusal");

  // Being switched off is not a reason to stop checking who may call it.
  const stranger = await h.call(cron, { key: "wrong-key" });
  is(stranger.code, 401, "and a stranger still cannot call it at all");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nnobody is asked for a review");
  process.exit(fails ? 1 : 0);
})();
