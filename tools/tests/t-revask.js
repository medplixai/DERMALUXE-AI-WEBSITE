// Asking a patient for a Google review is the one message the clinic sends
// that it cannot take back, and the one most easily got wrong: ask the person
// who is still being chased for a bill, or ask the same person every visit,
// and a 5.0 becomes a 4.2.
process.env.REVIEW_LINK = "https://g.page/r/DERMALUXE/review";
delete process.env.CRON_SECRET;
const path = require("path");
const h = require("./harness.js");
const notify = require(path.join(__dirname, "..", "..", "api", "_notify.js"));
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const cron = h.load("cron-review");
const R = (q) => h.call(cron, q || {});

const dayBack = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date(Date.now() - n * 86400000));

// A bill exactly as /api/money writes one.
let seq = 0;
function bill(day, phone, name, price, paid, ts) {
  const id = "B" + (2000 + ++seq);
  h.run(["SET", `bill:${id}`, JSON.stringify({
    id, phone, name, items: [{ name: "HydraFacial", price, qty: 1 }],
    payments: paid > 0 ? [{ amount: paid, mode: "upi", ts: ts || Date.now() }] : [],
    ts: ts || Date.now(),
  })]);
  h.run(["LPUSH", `bill:day:${day}`, id]);
  return id;
}

const waTo = () => h.sent.filter((s) => s[0] === "wa").map((s) => s[1]);
const clear = () => { h.sent.length = 0; };

(async () => {
  console.log("REVIEW ASK\n");
  const day = dayBack(2);

  bill(day, "9876511111", "Lakshmi Devi", 3500, 3500);   // came, paid in full
  bill(day, "9876522222", "Ravi Teja", 40000, 10000);     // still owes ₹30,000
  bill(day, "9876533333", "Suresh", 3500, 0);             // billed, paid nothing
  bill(day, "9876544444", "Anitha", 1500, 1500);          // came, paid in full
  // Same person, two bills, one day. One person, so one message — and the
  // later bill is the one whose name is used.
  bill(day, "9876511111", "Lakshmi", 500, 500, Date.now() - 3600000);

  const r1 = await R();
  is(r1.code, 200, "the job runs");
  is(r1.body.bills, 5, "five bills that day");
  is(r1.body.eligible, 2, "two people actually came and paid in full");
  is(r1.body.sent, 2, "so two are asked");
  is(waTo().sort(), ["9876511111", "9876544444"], "the two who paid, nobody else");

  const msg = h.sent.find((s) => s[1] === "9876511111")[2];
  is(msg.includes("https://g.page/r/DERMALUXE/review"), true, "the link is in the message");
  is(msg.includes("Lakshmi Devi".split(" ")[0]), true, "and their name");

  console.log("\n  — what it must never say —");
  // Asking for a *good* review, or offering anything for one, is against
  // Google's policy and is how a listing gets its reviews wiped.
  is(/good review|5 star|five star|manchi review|discount|free|off\b/i.test(msg), false,
    "no adjective in front of 'review', and nothing offered in return");

  console.log("\n  — once per person —");
  clear();
  const r2 = await R();
  is(r2.body.sent, 0, "running it again asks nobody a second time");
  is(r2.body.skipped, 2, "both are already marked");
  is(waTo().length, 0, "and nothing goes out");

  console.log("\n  — somebody who owes money is left alone —");
  clear();
  h.run(["DEL", "rev:asked:9876522222"]);
  const r3 = await R();
  is(waTo().includes("9876522222"), false, "the ₹30,000 balance is still not asked for stars");

  console.log("\n  — the window has usually closed by now —");
  clear();
  const day3 = dayBack(3);
  bill(day3, "9876555555", "Padma", 2000, 2000);
  const wa = notify.sendWa;
  notify.sendWa = async () => false;              // 24h window shut, as it normally is
  const r4 = await R({ day: day3 });
  is(r4.body.sent, 1, "it still gets there");
  is(h.sent.filter((s) => s[0] === "tpl").length, 1, "through the template instead");
  is(r4.body.rows[0].via, "template", "and says which way it went");

  console.log("\n  — a message that never went does not burn the one ask —");
  clear();
  const tpl = notify.sendWaTemplate;
  notify.sendWaTemplate = async () => ({ ok: false });
  const day5 = dayBack(5);
  bill(day5, "9876566666", "Kiran", 2500, 2500);
  const r5 = await R({ day: day5 });
  is(r5.body.sent, 0, "nothing went out");
  is(r5.body.failed, 1, "and it says so");
  is(h.run(["GET", "rev:asked:9876566666"]), null, "the marker is released, so tomorrow tries again");

  notify.sendWa = wa; notify.sendWaTemplate = tpl;
  clear();
  const r6 = await R({ day: day5 });
  is(r6.body.sent, 1, "and tomorrow it gets there");

  console.log("\n  — no link, no ask —");
  clear();
  const keep = process.env.REVIEW_LINK;
  delete process.env.REVIEW_LINK;
  delete process.env.GOOGLE_PLACE_ID;
  const day7 = dayBack(7);
  bill(day7, "9876577777", "Gopi", 900, 900);
  const r7 = await R({ day: day7 });
  is(r7.body.sent, 0, "with nowhere to send them, it sends nobody");
  is(waTo().length, 0, "rather than a review ask with no link in it");
  process.env.REVIEW_LINK = keep;

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe automatic review ask behaves");
  process.exit(fails ? 1 : 0);
})();
