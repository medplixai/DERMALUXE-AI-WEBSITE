// Who hears about a new lead, and who is handed the call.
//
// On 9 November the lead alerts were going to the two numbers in an env var
// and nobody else — the reception login added on 6 November had never had
// one — and 257 of 289 leads carried the manager's name because the queue
// dealt to whoever had the fewest open leads on the day the feature shipped.
// The real _notify.js and the real staff.js, not the harness's stubs.
process.env.STAFF_SECRET = "local-test-secret";
process.env.STAFF_OWNERS = "9010427777";
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
delete require.cache[path.join(API, "staff.js")];                  // the real one: _queue asks it who may edit leads
require(path.join(API, "staff.js"));
const np = require.resolve(path.join(API, "_notify.js")), stubNotify = require.cache[np];
delete require.cache[np];
const notify = require(np);
require.cache[np] = stubNotify;                                      // everyone else keeps the stub
const queue = require(path.join(API, "_queue.js"));

let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("DESK ALERTS — who hears, and who calls\n");

  console.log("  — who the alerts go to —");
  process.env.LEAD_NOTIFY_PHONES = "9989325777,9949134666";
  h.run(["DEL", "staff:users"]);
  is((await notify.notifyTargets({})).sort(), ["9949134666", "9989325777"], "with no staff on the books, the two env numbers");
  h.run(["HSET", "staff:users", "9876500701", JSON.stringify({ name: "hemasri", role: "reception" })]);
  h.run(["HSET", "staff:users", "9876500702", JSON.stringify({ name: "Sowmya", role: "manager" })]);
  h.run(["HSET", "staff:users", "9876500703", JSON.stringify({ name: "Old desk", role: "reception", off: true })]);
  h.run(["HSET", "staff:users", "9949134666", JSON.stringify({ name: "Hospital", role: "reception" })]);
  is((await notify.notifyTargets({})).sort(), ["9876500701", "9949134666", "9989325777"],
    "every live reception login joins them — not the manager, not a switched-off login, and a number on both lists is there once");

  console.log("\n  — the alert itself —");
  const graph = [], keepFetch = global.fetch;
  global.fetch = async (url, opt) => { graph.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ messages: [{ id: "m" }] }), text: async () => "" }; };
  const keepTok = process.env.WA_CLOUD_TOKEN; process.env.WA_CLOUD_TOKEN = process.env.WA_CLOUD_TOKEN || "test";
  await notify.leadAlert({}, { name: "Ravi", phone: "9876500711", concern: "Hair fall", type: "whatsapp" });
  const plain = graph.splice(0);
  await notify.leadAlert({}, { name: "Sita", phone: "9876500712", concern: "Acne", type: "whatsapp", slot_ts: "2026-11-12 11:00", slot: "Thu 11 AM" });
  const slot = graph.splice(0);
  global.fetch = keepFetch; if (keepTok === undefined) delete process.env.WA_CLOUD_TOKEN; else process.env.WA_CLOUD_TOKEN = keepTok;
  is(plain.map((b) => b.to).sort(), ["919876500701", "919949134666", "919989325777"], "an alert reaches reception and both env numbers");
  is(plain.every((b) => !/30 nimishallo/.test(JSON.stringify(b))), true, "a lead with no slot says nothing about confirming one");
  is(slot.length === 3 && slot.every((b) => /30 nimishallo call chesi slot confirm cheyandi/.test(JSON.stringify(b))), true,
    "a lead holding a slot tells the desk to ring and confirm it within 30 minutes");

  console.log("\n  — who a hot lead is handed to —");
  h.run(["DEL", "dl_leads", "lead:owner", "lead:oat", "dl_status", "staff:users"]);
  const ts = Date.now() - 60000;
  const hot = (ph, name, at) => {
    h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: at, type: "whatsapp", name, phone: ph, concern: "Hair fall" })]);
    h.run(["SET", `qual:${ph}`, JSON.stringify({ grade: "A", score: 80, facts: {} })]);
  };
  h.run(["HSET", "staff:users", "9876500701", JSON.stringify({ name: "hemasri", role: "reception" })]);
  h.run(["HSET", "staff:users", "9876500702", JSON.stringify({ name: "Sowmya", role: "manager" })]);
  for (let i = 0; i < 3; i++) h.run(["HSET", "lead:owner", `1|x${i}`, "9876500701"]);   // reception already holds three
  hot("9876500721", "Anu", ts);
  const r1 = await queue.assign({});
  is([r1.assigned, r1.reception, h.run(["HGET", "lead:owner", `${ts}|9876500721`])], [1, 1, "9876500701"],
    "with a reception login on the books the lead goes to reception, though the manager has fewer open leads");
  h.run(["HDEL", "staff:users", "9876500701"]);                                         // no reception login any more
  h.run(["HSET", "staff:users", "9876500704", JSON.stringify({ name: "Dr Meghana", role: "doctor" })]);
  for (let i = 0; i < 2; i++) h.run(["HSET", "lead:owner", `2|y${i}`, "9876500702"]);   // the manager holds two
  hot("9876500722", "Bhanu", ts + 1);
  const r2 = await queue.assign({});
  is([r2.reception, h.run(["HGET", "lead:owner", `${ts + 1}|9876500722`])], [0, "9876500704"],
    "with no reception login it goes to whoever has the fewest open leads, as before");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ndesk alerts behave");
  process.exit(fails ? 1 : 0);
})();
