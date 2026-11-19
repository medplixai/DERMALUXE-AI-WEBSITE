// "Hi", and then nothing — one tap-to-answer message, once.
//
// 64 of 211 people in the fortnight to 14 Nov said only hello and were never
// written to again, because every follow-up works off a lead and they had
// given none. Owner, 16 Nov: "ok" to one message with three buttons.
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
process.env.ADMIN_PHONES = "9010427777";
const cfg = { kind: "pg" };

(async () => {
  console.log("HI, AND THEN NOTHING\n");
  const n = h.load("_notify");
  const sentTo = [];
  n.sendWaButtons = async (to, text, btns) => { sentTo.push([to, text, btns]); return true; };
  const ib = h.load("_inbox");
  const N = h.load("_hinudge");
  const SA = h.load("_staffask");

  // A moment, 2-22 hours from now, when the clinic is open.
  let at = 0;
  for (let hrs = 3; hrs <= 22 && !at; hrs++) if (SA.openNow(Date.now() + hrs * 3600000)) at = Date.now() + hrs * 3600000;

  const chat = async (ph, ins, outBy) => {
    for (const t of ins) await ib.log(cfg, ph, { dir: "in", text: t });
    await ib.log(cfg, ph, { dir: "out", text: "Namaste 🙏 — mee problem cheppandi", by: outBy || "ai" });
  };
  await chat("9876500701", ["Hi"]);                                       // the one to write to
  await chat("9876500702", ["Hello! Can I get more info on this?"]);       // Meta's prefill — same
  await chat("9876500703", ["Hi", "Hair fall undi"]);                      // said what it is — the agent's own ladder has them
  await chat("9876500704", ["Hi"], "hemasri");                             // a colleague answered
  await chat("9876500705", ["Hi"]); h.run(["SADD", "optout", "9876500705"]);
  await chat("9876500706", ["Hi"]); h.run(["SET", "hr:st:9876500706", JSON.stringify({ status: "applied" })]);
  await chat("9876500707", ["Hi"]); h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now(), name: "Known", phone: "9876500707", concern: "Acne" })]);
  await chat("9010427777", ["Hi"]);                                       // the owner
  await chat("9876500709", ["Hi"]); await ib.log(cfg, "9876500709", { dir: "out", text: "Clinic Rama Mahal lo undi — e time set avutundi?", by: "ai" });   // already nudged once (18 Nov)

  console.log("  — who gets it —");
  is(N.saidNothing("Hiii mam 🙏"), true, "\"Hiii mam 🙏\" says nothing yet");
  is(N.saidNothing("Hair fall"), false, "\"Hair fall\" does");
  const r = await N.run(cfg, { now: at });
  is(sentTo.map((s) => s[0]).sort(), ["9876500701", "9876500702"], "only the two who said nothing but hello");
  is(sentTo[0][2], ["Skin", "Hair", "📅 Book Now"], "with three buttons, so answering is one tap");
  is(/okka maata/.test(sentTo[0][1]) && !/₹/.test(sentTo[0][1]), true, "a short ask, no offer and no price");
  const t1 = h.run(["LRANGE", "ib:m:9876500701", "0", "0"]).map((x) => JSON.parse(x))[0];
  is([t1.dir, t1.by], ["out", "ai"], "and it is in the staff inbox");

  console.log("\n  — once —");
  sentTo.length = 0;
  await N.run(cfg, { now: at + 3600000 });
  is(sentTo.length, 0, "the next hour sends nothing to them again");

  console.log("\n  — when —");
  await chat("9876500708", ["Hi"]);
  sentTo.length = 0;
  await N.run(cfg, { now: Date.now() + 30 * 60000 });
  is(sentTo.length, 0, "half an hour after their hello is too soon");
  await N.run(cfg, { now: Date.now() + 30 * 3600000 });
  is(sentTo.length, 0, "and after 22 hours the free window is nearly shut — nothing");
  const night = Date.parse("2026-11-16T23:30:00+05:30");
  is((await N.run(cfg, { now: night })).closed, true, "nothing at night, whatever the timing");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\none hello, one follow-up");
  process.exit(fails ? 1 : 0);
})();
