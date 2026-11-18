// A good chat reaches the Leads screen, whether or not the agent wrote it down.
//
// 15–17 Nov: 84 new WhatsApp chats, 25 on the Leads screen, and 34 graded A
// or B that the desk never saw. Owner, 18 Nov: "chat lo manchi manchi leads
// unnai kani avi leads loki ravatledhu — vachelaa cheyyi".
process.env.ADMIN_PHONES = "9010427777";
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const cfg = { kind: "pg" };

(async () => {
  console.log("GOOD CHATS ARE LEADS\n");
  const n = h.load("_notify");
  const alerts = [];
  n.leadAlert = async (c, lead) => { alerts.push(lead.phone); };
  const q = h.load("_qualify");
  const ib = h.load("_inbox");
  const C = h.load("_chatlead");
  const leads = () => h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x));
  const of = (ph) => leads().filter((l) => String(l.phone).slice(-10) === ph);
  const chat = async (ph, facts, text, name) => {
    await ib.log(cfg, ph, { dir: "in", text: text || "Hi", name: name || "" });
    await q.absorb(cfg, ph, facts, { inboundCount: 6, channel: "whatsapp", text: text || "" });
  };

  console.log("  — the chat is a lead —");
  await chat("9876500801", { name: "Lakshmi", problem: "Hydrafacial — face & neck", intent: "book_now", urgency: "this_week", village: "Tadepalligudem", prefers: "10 rojula lopu", asked_price: true }, "10 days lo vastanu");
  const r1 = await C.ensure(cfg, "9876500801", { profile: "Lucky", last: "10 days lo vastanu", alert: true });
  const l1 = of("9876500801")[0] || {};
  is([!!r1.saved, l1.name, l1.heat], [true, "Lakshmi", "hot"], "an A with a name goes on the list, by the name she typed, as hot");
  is([/Hydrafacial/.test(l1.concern), l1.grade, l1.village, /10 rojula lopu/.test(l1.call_prep)], [true, "A", "Tadepalligudem", true], "with her problem, grade, town and when she can come for the caller");
  is(alerts.includes("9876500801"), true, "and the desk is told");

  await chat("9876500802", { problem: "Hair fall", problem_since: "1 year+", intent: "considering", village: "Eluru" }, "1 year+");
  await C.ensure(cfg, "9876500802", { profile: "Ravi K" });
  const l2 = of("9876500802")[0] || {};
  is([l2.name, l2.concern], ["Ravi K (WhatsApp peru)", "Hair fall — 1 year+"], "no name typed yet: shown by the WhatsApp label, marked so");

  console.log("\n  — not a lead, or not ours to list —");
  await chat("9876500803", { intent: "considering" }, "Hi");
  is((await C.ensure(cfg, "9876500803", {})).saved, undefined, "no problem said yet — not a lead");
  await chat("9876500804", { problem: "Pimples", intent: "not_interested" }, "Vaddu andi");
  is((await C.ensure(cfg, "9876500804", {})).saved, undefined, "a \"vaddu\" is not listed");
  await chat("9876500805", { problem: "Dark spots", intent: "book_now", urgency: "this_week", village: "Eluru" }, "Repu vastanu");
  h.run(["SADD", "optout", "9876500805"]);
  is((await C.ensure(cfg, "9876500805", {})).saved, undefined, "a STOP is not listed");
  await chat("9876500806", { problem: "Therapist job", intent: "book_now", urgency: "this_week", village: "Eluru" }, "Job kavali");
  h.run(["SET", "hr:st:9876500806", JSON.stringify({ status: "applied" })]);
  is((await C.ensure(cfg, "9876500806", {})).saved, undefined, "a job seeker is not a patient lead");
  await chat("9010427777", { problem: "test", intent: "book_now", urgency: "this_week", village: "Eluru" }, "test");
  is((await C.ensure(cfg, "9010427777", {})).saved, undefined, "nor the owner");

  console.log("\n  — once —");
  const before = leads().length;
  await C.ensure(cfg, "9876500801", { alert: true });
  is(leads().length, before, "the same chat is not listed twice");
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 86400000, type: "whatsapp", name: "Sita", phone: "9876500807", concern: "Acne" })]);
  await chat("9876500807", { name: "Sita", problem: "Acne", intent: "book_now", urgency: "this_week", village: "Eluru" }, "Repu");
  is([(await C.ensure(cfg, "9876500807", {})).had, of("9876500807").length], [true, 1], "a patient the agent already listed stays one row");

  console.log("\n  — the hourly catch-up —");
  await chat("9876500808", { name: "Old", problem: "Melasma", intent: "considering", village: "Eluru", problem_since: "Chala kalam" }, "Chala kalam");
  await chat("9876500809", { name: "New", problem: "Hair fall", intent: "considering", village: "Eluru", problem_since: "6 nelala lopu" }, "6 nelala lopu");
  alerts.length = 0;
  const rows = [
    { phone: "9876500808", name: "Old", lastIn: Date.now() - 30 * 3600000 },
    { phone: "9876500809", name: "New", lastIn: Date.now() - 20 * 60000 },
    { phone: "9876500810", name: "Gone", lastIn: Date.now() - 5 * 86400000 },
  ];
  const s = await C.sweep(cfg, { rows, hours: 72 });
  is([s.saved, of("9876500808").length, of("9876500809").length], [2, 1, 1], "chats from the last three days are caught up");
  is(alerts, ["9876500809"], "and only the one from the last two hours rings the desk — the catch-up stays quiet");
  is(new Date(of("9876500808")[0].ts).getTime() < Date.now() - 29 * 3600000, true, "a caught-up row keeps the time they wrote, not today");

  console.log("\n  — a label is not a name to greet —");
  const G = h.load("_greet");
  is([G.greetName("Ravi K (WhatsApp peru)"), G.greetName("(peru cheppaledu)"), G.greetName("Lakshmi Devi")], ["", "", "Lakshmi"], "follow-ups never call them by their WhatsApp label");

  console.log("\n  — wired in —");
  const fs = require("fs"), path = require("path"), API = process.env.DL_API || path.resolve("api");
  is(/_chatlead\.js"\)\.ensure\(/.test(fs.readFileSync(path.join(API, "whatsapp.js"), "utf8")), true, "the agent lists a good chat as it happens");
  is(/_chatlead\.js"\)\.sweep\(/.test(fs.readFileSync(path.join(API, "cron-followup.js"), "utf8")), true, "and the hourly follow-up catches up the rest");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ngood chats are leads");
  process.exit(fails ? 1 : 0);
})();
