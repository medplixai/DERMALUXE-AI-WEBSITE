// The hourly and ten-minute jobs that message patients on the clinic's
// behalf: lead follow-ups, appointment confirmations and reminders, the
// scheduled Instagram queue, broadcasts, and the morning report.
//
// Every one of these spends money (a paid template) or goodwill (a message
// nobody asked for). So the checks are mostly about who does NOT get a
// message: somebody who said STOP, somebody already booked, somebody the
// desk marked closed, somebody who got one yesterday. The clock is set by
// hand to the Eluru time each block runs at.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
const published = [];
let publishAnswer = { ok: true, link: "https://instagram.com/p/x" };
stub("_admin.js", {
  fmtIst: (ms) => new Date(ms + 19800000).toISOString().slice(11, 16),
  promoParams: (tpl, name, text) => [name, text],
  publishNow: async (cfg, it) => { published.push(it.imgId); return publishAnswer; },
});
let digestCalls = 0;
stub("_digest.js", { buildDigest: async () => { digestCalls++; return { body: "📊 Today", oneLine: "3 appts" }; } });
stub("_weekly.js", { buildWeekly: async () => ({ body: "📈 Week", oneLine: "wk" }) });
global.fetch = async () => ({ ok: true, json: async () => 0 });

// Eluru wall-clock → the real Date.now the jobs read.
const realNow = Date.now;
const day0 = (() => { const d = new Date(realNow() + 19800000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 19800000; })();
const at = (hh, mm) => { const t = day0 + (hh * 60 + (mm || 0)) * 60000; Date.now = () => t; return t; };
const HOUR = 3600000;

const followup = h.load("cron-followup"), post = h.load("cron-post"), digest = h.load("cron-digest");
const run = (mod) => h.call(mod, { key: "local-admin" });
const lead = (o) => h.run(["LPUSH", "dl_leads", JSON.stringify(Object.assign({ type: "whatsapp", heat: "warm" }, o))]);
const to = (ph) => h.sent.filter((s) => (s[0] === "wa" || s[0] === "tpl") && s[1] === ph);
process.env.LEAD_NOTIFY_PHONES = "9989325777";

(async () => {
  console.log("THE SCHEDULED JOBS\n");

  console.log("  — the 20-hour nudge, inside WhatsApp's free window —");
  let now = at(15, 45);
  lead({ ts: now - 20 * HOUR, name: "Asha", phone: "9876500701", concern: "Acne" });
  lead({ ts: now - 20 * HOUR, name: "Bindu", phone: "9876500702", concern: "Acne" });      // said STOP
  lead({ ts: now - 20 * HOUR, name: "Chitra", phone: "9876500703", concern: "Acne" });     // desk closed it
  lead({ ts: now - 20 * HOUR, name: "Divya", phone: "9876500704", concern: "Acne" });      // already booked
  lead({ ts: now - 20 * HOUR, name: "Eswar", phone: "9876500705", concern: "Academy course" });
  lead({ ts: now - 20 * HOUR, name: "Farah", phone: "9876500706", concern: "Acne", date: "Sat", slot: "5 PM" });
  lead({ ts: now - 30 * HOUR, name: "Gita", phone: "9876500707", concern: "Acne" });       // window already shut
  h.run(["SADD", "optout", "9876500702"]);
  h.run(["HSET", "dl_status", `${now - 20 * HOUR}|9876500703`, "closed"]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500704", at: now + 30 * HOUR, name: "Divya" })]);
  h.sent.length = 0;
  const f1 = await run(followup);
  is(f1.body.health, "ok", "the database answers its health check");
  is(to("9876500701").length, 1, "an enquiry that never booked gets one friendly nudge");
  is([to("9876500702").length, to("9876500703").length, to("9876500704").length], [0, 0, 0], "not somebody who said STOP, the desk closed, or who is already booked");
  is(to("9876500705").length, 0, "not an academy enquiry — that is not a consultation");
  is([to("9876500706").length, to("9876500707").length], [0, 0], "nor one with a slot, nor one whose free window has shut");
  h.sent.length = 0;
  await run(followup);
  is(to("9876500701").length, 0, "and the next hour, not again");

  console.log("\n  — day 3, a paid template (11:45) —");
  h.run(["DEL", "dl_leads"]); h.sent.length = 0;
  now = at(11, 45);
  lead({ ts: now - 70 * HOUR, name: "Hari Kumar", phone: "9876500711", concern: "Hair fall" });
  lead({ ts: now - 70 * HOUR, name: "Indu", phone: "9876500712", concern: "Hair fall" });
  lead({ ts: now - 70 * HOUR, name: "Job Seeker", phone: "9876500713", type: "job" });
  lead({ ts: now - 70 * HOUR, name: "Jaya", phone: "9876500714", concern: "ACADEMY — skin course" });
  h.run(["HSET", "dl_status", `${now - 70 * HOUR}|9876500712`, "visited"]);
  const f2 = await run(followup);
  is(f2.body.day3, 1, "one day-3 template goes out");
  is(((to("9876500711")[0] || [])[3] || [])[0], "Hari", "to the enquiry, by first name");
  is([to("9876500712").length, to("9876500713").length, to("9876500714").length], [0, 0, 0], "not to one the desk marked visited, a job applicant, or an academy enquiry");

  console.log("\n  — the day before an appointment (6:15 PM) —");
  h.sent.length = 0;
  now = at(18, 15);
  const tomorrow5 = day0 + 24 * HOUR + 17 * HOUR;
  h.run(["DEL", "appt:q"]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500721", name: "Kala Devi", at: tomorrow5 })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500722", name: "Latha", at: tomorrow5 + 24 * HOUR })]);
  await run(followup);
  is(to("9876500721").map((s) => s[2]), ["appointment_confirm"], "tomorrow's patient is asked to confirm");
  is(to("9876500722").length, 0, "the day after's is not asked yet");
  h.sent.length = 0;
  await run(followup);
  is(to("9876500721").length, 0, "and nobody is asked twice");

  console.log("\n  — the Instagram queue (every ten minutes) —");
  now = at(8, 32);
  h.run(["DEL", "adm:queue"]);
  const q = (o) => h.run(["RPUSH", "adm:queue", JSON.stringify(Object.assign({ by: "9010427777" }, o))]);
  q({ imgId: "i1", due: now - 60000 }); q({ imgId: "i2", due: now - 60000 }); q({ imgId: "i3", due: now - 60000 }); q({ imgId: "i4", due: now + HOUR });
  published.length = 0;
  const p1 = await run(post);
  is([p1.body.published, published], [2, ["i1", "i2"]], "at most two go out in one run, oldest first");
  is(h.run(["LRANGE", "adm:queue", "0", "-1"]).map((x) => JSON.parse(x).imgId), ["i3", "i4"], "the rest wait, and the future one is untouched");
  publishAnswer = { ok: false, transient: true, msg: "IG busy", creationId: "c9" };
  h.run(["DEL", "adm:lock:i3"]);
  await run(post);
  const retry = h.run(["LRANGE", "adm:queue", "0", "-1"]).map((x) => JSON.parse(x)).find((x) => x.imgId === "i3");
  is([retry.tries, retry.creationId], [1, "c9"], "Instagram being busy puts it back, resuming the same upload");
  publishAnswer = { ok: true };

  console.log("\n  — two hours before (the same job) —");
  h.run(["DEL", "appt:q"]); h.sent.length = 0;
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500731", name: "Mani", at: now + 100 * 60000 })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500732", name: "Nila", at: now + 5 * 60000 })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500733", name: "Oma", at: now - 3.2 * HOUR })]);
  await run(post); await run(post);
  is(to("9876500731").map((s) => s[2]), ["appointment_reminder"], "a patient two hours out is reminded — once, over two runs");
  is(to("9876500732").length, 0, "one who booked five minutes ago is not");
  is(h.run(["LRANGE", "appt:done", "0", "-1"]).some((x) => JSON.parse(x).ph === "9876500733"), true, "a visit whose time has passed moves to the done list");
  is(h.sent.some((s) => s[0] === "wa" && s[1] === "9989325777" && s[2].includes("9876500733")), true, "and the desk is asked whether they came");

  console.log("\n  — a broadcast draining over hours —");
  h.sent.length = 0;
  for (const ph of ["9876500741", "9876500742", "9876500743"]) h.run(["LPUSH", "bc:q", JSON.stringify({ ph, name: "X", text: "Diwali offer" })]);
  h.run(["SET", "bc:meta", JSON.stringify({ total: 3, by: "9010427777" })]);
  h.run(["SADD", "optout", "9876500742"]);                 // replied STOP after it was queued
  const b = await run(post);
  is(b.body.bsent, 2, "the queue drains");
  is(to("9876500742").length, 0, "but not to somebody who said STOP after it was queued");
  is(h.run(["GET", "bc:meta"]), null, "and it still counts as finished");

  console.log("\n  — the morning report (9 AM) —");
  process.env.DIGEST_PHONES = "9010427777,9876500751";
  const n = require(path.join(API, "_notify.js"));
  const wa = n.sendWa;
  n.sendWa = async (ph, text) => { h.sent.push(["wa", ph, text]); return ph === "9010427777"; };
  h.sent.length = 0;
  now = at(9, 0);
  const d = await run(digest);
  n.sendWa = wa;
  is([d.body.sent, d.body.pinged], [1, 1], "whoever's WhatsApp window is open gets the report; the other gets the template ping");
  is(to("9876500751").some((s) => s[0] === "tpl" && s[2] === "daily_digest_ping"), true, "which asks them to reply 'report'");
  is((await h.call(digest, { key: "guess" })).code, 401, "and nobody else can trigger it");

  Date.now = realNow;
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe scheduled jobs behave");
  process.exit(fails ? 1 : 0);
})();
