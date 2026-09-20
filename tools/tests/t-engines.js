// The engines around the agent: the owner's own rules, the nudge that
// restarts a chat that went quiet, the rescue when a colleague takes a chat
// and forgets it, the draft the desk sends by hand, who gets dealt which
// calls, and what each grade is actually worth in paid templates.
//
// These run unattended, at night, on real patients' phones. So what matters
// is mostly what they refuse to do: never twice, never to a booked patient,
// never to a D, never over somebody who is actually typing, and never a
// message the desk did not ask for.
const path = require("path");
const crypto = require("crypto");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

// Eluru's clock, held at 11:30 AM: a working hour, and one of the three
// times of day the callers are chased. Everything below dates from here.
let NOW = (() => { const d = new Date(); d.setUTCHours(6, 0, 0, 0); return d.getTime(); })();
const realNow = Date.now;
Date.now = () => NOW;
const MIN = 60000, HOUR = 3600000;

process.env.ADMIN_PHONES = "9010427777";
process.env.WA_WEBHOOK_TOKEN = "hook"; process.env.WA_CLOUD_TOKEN = "cloud"; process.env.WA_PHONE_ID_ALLOWLIST = "111";
process.env.WA_AGENT_ENABLED = "1"; process.env.ANTHROPIC_API_KEY = "test"; process.env.LEAD_NOTIFY_PHONES = "9989325777";
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("_admin.js", { isAdmin: () => false, handle: async () => null, fmtIst: () => "" });
stub("_hr.js", { handle: async () => null });
stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });

let claude = [], lastSystem = "", lastUser = "";
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opt.body);
    if (/You fix one WhatsApp reply/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: body.messages[0].content.split("\n")[1] || "ok" }] }) };
    if (/quality reviewer/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ score: 80, summary: "ok", findings: [] }) }] }) };
    lastSystem = body.system; lastUser = body.messages[body.messages.length - 1].content;
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏 Em problem andi?", lead: null };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(next) }] }) };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

const Q = require(path.join(API, "_qualify.js"));
const IB = require(path.join(API, "_inbox.js"));
const rules = require(path.join(API, "_rules.js"));
const reengage = require(path.join(API, "_reengage.js"));
const rescue = require(path.join(API, "_rescue.js"));
const wa = h.load("whatsapp"), inboxApi = h.load("inbox"), followup = h.load("cron-followup");
const cfg = { kind: "pg" };
let mid = 0;
const say = (from, text, name) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve(o); return this; }, send() { resolve(); return this; } };
  wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: name || "Anu" } }],
    messages: [{ id: "e" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
});
const sentTo = (ph) => h.sent.filter((s) => s[0] === "wa" && s[1] === ph);
// Age a conversation: the thread summary is what every engine reads.
const ageThread = (ph, minsAgo, extra) => {
  const m = JSON.parse(h.run(["GET", `ib:t:${ph}`]));
  m.ts = NOW - minsAgo * MIN;
  if (m.lastIn) m.lastIn = NOW - minsAgo * MIN;
  h.run(["SET", `ib:t:${ph}`, JSON.stringify(Object.assign(m, extra || {}))]);
};
const lead = (o) => h.run(["RPUSH", "dl_leads", JSON.stringify(Object.assign({ ts: NOW, type: "whatsapp" }, o))]);

(async () => {
  console.log("THE ENGINES AROUND THE AGENT\n");

  console.log("  — the owner's own rules —");
  const r1 = await rules.add(cfg, "  Ee   nela laser offer cheppaku  ", "Owner");
  is([r1.ok, r1.rule.text], [true, "Ee nela laser offer cheppaku"], "a rule the owner types is kept, tidied");
  is((await rules.add(cfg, "ee nela LASER offer cheppaku")).ok, false, "the same rule again is refused, not stored twice");
  const blk = await rules.block(cfg);
  is([/OWNER RULES/.test(blk), /laser offer cheppaku/.test(blk), /win over anything above/.test(blk)], [true, true, true], "the agent is told these beat the standing prompt");
  await say("9876502010", "Laser treatment gurinchi cheppandi");
  is(/laser offer cheppaku/.test(lastSystem), true, "and the very next patient message carries them to the model");
  const r2 = await rules.remove(cfg, r1.rule.id);
  is([r2.ok, await rules.block(cfg)], [true, ""], "taking it off leaves nothing behind");
  is((await rules.remove(cfg, "nope")).ok, false, "removing a rule that is not there says so");

  console.log("\n  — the desk asks the agent to write it —");
  const DESK = { name: "Sowmya", phone: "9876500901", role: "reception" };
  h.as(["inbox.view", "inbox.reply"], DESK);
  await say("9876502011", "Pigmentation ki cost entha?");
  h.sent.length = 0;
  const before = h.run(["LLEN", "ib:m:9876502011"]);
  claude.push({ reply: "Pigmentation ki mundu doctor chudali andi 🙏 Repu 11 AM ki vastara?", lead: null });
  const dr = await h.call(inboxApi, {}, { a: "draft", phone: "9876502011" });
  is([dr.code, /doctor/.test(dr.body.text)], [200, true], "the agent writes the next reply for the colleague");
  is(h.sent.length, 0, "and sends nothing — a person presses send");
  is(h.run(["LLEN", "ib:m:9876502011"]), before, "the draft is not in the patient's thread either — until it is really sent");
  h.as(["inbox.view"], DESK);
  is((await h.call(inboxApi, {}, { a: "draft", phone: "9876502011" })).code, 403, "somebody who may only read cannot have one written");
  h.as(["inbox.view", "inbox.reply"], DESK);
  is((await h.call(inboxApi, {}, { a: "draft", phone: "9876509999" })).code, 404, "and a number that never wrote to us has no draft");

  console.log("\n  — a chat that went quiet —");
  await say("9876502020", "Hair fall chala undi, entha avutundi?");
  await Q.absorb(cfg, "9876502020", { problem: "hair fall", village: "Eluru" }, { inboundCount: 2 });
  ageThread("9876502020", 90);                        // we answered, they never came back
  let cand = await reengage.candidates(cfg);
  is(cand.map((c) => c.phone).includes("9876502020"), true, "an hour after our last word, the chat is worth one nudge");
  h.sent.length = 0;
  claude.push({ reply: "Hair fall ki mundu okka question andi — entha kalam nundi? Repu morning slot pettamanta? 😊", lead: null });
  const rg1 = await reengage.run(cfg, 5);
  is([rg1.sent >= 1, sentTo("9876502020").length], [true, 1], "one short message goes, picking up where the chat stopped");
  is(JSON.parse(h.run(["LRANGE", "ib:m:9876502020", "0", "0"])[0]).via, "reengage", "and the thread says why it was sent");
  h.sent.length = 0;
  is((await reengage.run(cfg, 5)).sent, 0, "running again the same minute sends nothing — the next nudge is hours away");
  await say("9876502021", "Ok andi");
  is((await reengage.candidates(cfg)).some((c) => c.phone === "9876502021"), false, "a chat where the patient spoke last is not nudged — the agent already answered");
  await say("9876502022", "Slot book cheyandi");
  ageThread("9876502022", 120);
  await Q.absorb(cfg, "9876502022", { problem: "acne", village: "Eluru" }, { status: "booked" });
  is((await reengage.candidates(cfg)).some((c) => c.phone === "9876502022"), false, "somebody already booked is left alone");
  await say("9876502023", "Nenu patient kaadu, job kavali");
  ageThread("9876502023", 120);
  await Q.absorb(cfg, "9876502023", { intent: "not_patient" }, {});
  is([(await Q.read(cfg, "9876502023")).grade, (await reengage.candidates(cfg)).some((c) => c.phone === "9876502023")], ["D", false], "and a D is not a lead to chase");

  console.log("\n  — somebody took the chat and forgot it —");
  await say("9876502030", "Repu 5 PM ki confirm chesara?", "Lakshmi");
  await IB.setHuman(cfg, "9876502030", true, "Sowmya");
  await IB.log(cfg, "9876502030", { dir: "in", text: "Hello? Confirm ayyindaa?" });
  ageThread("9876502030", 25);
  const w = await rescue.waiting(cfg);
  is([w.length, w[0].by, w[0].mins], [1, "Sowmya", 25], "a patient waiting on a person for twenty minutes is visible");
  h.sent.length = 0;
  const rs1 = await rescue.run(cfg, 5);
  is([rs1.alerted, rs1.resumed], [1, 0], "the team is told, and the chat is still theirs");
  is(sentTo("9989325777").some((s) => /nimishalu nundi reply kosam/.test(s[2])), true, "in words that say who is waiting and how long");
  is(sentTo("9876502030").length, 0, "the patient is not written to yet");
  h.sent.length = 0;
  is((await rescue.run(cfg, 5)).alerted, 0, "and the team is not told again every ten minutes");
  ageThread("9876502030", 65);
  claude.push({ reply: "Lakshmi garu, repu 5 PM slot confirm chesam andi 🙏 Clinic address: Rama Mahal, R.R. Peta.", lead: null });
  const rs2 = await rescue.run(cfg, 5);
  is(rs2.resumed, 1, "an hour on, the agent takes the chat back rather than leaving them there");
  is([sentTo("9876502030").length, h.run(["GET", "ib:human:9876502030"])], [1, null], "the patient gets their answer, and the chat is the agent's again");
  is(JSON.parse(h.run(["LRANGE", "ib:m:9876502030", "0", "0"])[0]).via, "resumed", "the thread records that too");

  console.log("\n  — what each grade is worth —");
  // Day 3 is a paid template. A and B get the whole ladder, C gets day 3 only,
  // D gets nothing — because every one of these costs the clinic money.
  const grade = async (ph, facts, ctx) => (await Q.absorb(cfg, ph, facts, ctx)).grade;
  is(await grade("9876502040", { village: "Eluru", intent: "book_now", problem: "hair fall", problem_since: "6 nelalu" }, { inboundCount: 3 }), "A", "near, ready, and talking — an A");
  is(await grade("9876502041", { village: "Eluru", problem: "acne" }, { inboundCount: 2 }), "B", "a nearby problem with no plans yet — a B");
  is(await grade("9876502042", { problem: "acne" }, { inboundCount: 2 }), "C", "a problem and nothing else — a C");
  is(await grade("9876502043", { intent: "not_patient" }, {}), "D", "not a patient at all — a D");
  const d3 = NOW - 72 * HOUR, d7 = NOW - 168 * HOUR;
  ["9876502040", "9876502041", "9876502042", "9876502043"].forEach((ph, i) => {
    lead({ ts: d3, phone: ph, name: "P" + i, concern: "Hair fall" });
    lead({ ts: d7, phone: ph, name: "P" + i, concern: "Hair fall" });
  });
  h.sent.length = 0;
  await h.call(followup, { key: "local-admin" });
  const tpl = (ph) => h.sent.filter((s) => s[0] === "tpl" && s[1] === ph).map((s) => s[2]);
  is([tpl("9876502040").length > 0, tpl("9876502041").length > 0], [true, true], "an A and a B are followed up");
  is(tpl("9876502042").includes("clinic_update"), true, "a C gets the day-3 message");
  is(tpl("9876502042").includes("lead_checkin"), false, "but not the day-7 one — a C is not worth the whole ladder");
  is(tpl("9876502043").length, 0, "and a D is sent nothing at all");

  console.log("\n  — who calls whom —");
  // The real staff module from here, so the roles that decide who takes calls
  // are the real ones.
  delete require.cache[path.join(API, "staff.js")];
  require(path.join(API, "staff.js"));
  const queue = require(path.join(API, "_queue.js"));
  const user = (ph, name, role) => h.run(["HSET", "staff:users", ph, JSON.stringify({ name, role, added: NOW })]);
  user("9876500901", "Sowmya", "reception");
  user("9876500902", "Ravi", "reception");
  user("9876500903", "Anitha", "accounts");          // accounts may see leads, not work them
  is((await queue.callers(cfg)).map((c) => c.name).sort(), ["Ravi", "Sowmya"], "the callers are the people whose role may work a lead");
  h.run(["DEL", "dl_leads"]);
  for (const ph of ["9876502050", "9876502051"]) {
    await Q.absorb(cfg, ph, { village: "Eluru", intent: "book_now", problem: "acne", problem_since: "2 nelalu" }, { inboundCount: 3 });
    lead({ ts: NOW - 2 * HOUR, phone: ph, name: "Hot " + ph.slice(-2), concern: "Acne" });
  }
  await Q.absorb(cfg, "9876502052", { village: "Eluru", problem: "acne" }, { inboundCount: 2 });
  lead({ ts: NOW - 2 * HOUR, phone: "9876502052", name: "Warm", concern: "Acne" });
  const as1 = await queue.assign(cfg, { max: 10 });
  const owners = h.run(["HGETALL", "lead:owner"]);
  const byPhone = {}; for (let i = 0; i + 1 < owners.length; i += 2) byPhone[owners[i].split("|")[1]] = owners[i + 1];
  is(as1.assigned, 2, "each hot lead is handed to somebody — two A's, two names");
  is(Object.keys(byPhone).sort(), ["9876502050", "9876502051"], "the B is not dealt out — a caller's day is the A's");
  is(new Set(Object.values(byPhone)).size, 2, "and with two callers free, they get one each, not both to the first name");
  is((await queue.assign(cfg, { max: 10 })).assigned, 0, "a lead already on somebody's name is not dealt again");
  const day = await queue.teamDay(cfg);
  is(day.reduce((n, t) => n + t.assigned, 0), 2, "each caller's day shows what they were dealt");
  is(day.every((t) => t.untouched === t.assigned), true, "and that none of it has been touched yet");
  h.sent.length = 0;
  // The cron above already announced this hour's checkpoint, when nobody had
  // any calls — clear it so the announcement itself can be watched.
  h.run(["DEL", "call:alert"]);
  const ov = await queue.alertOverdue(cfg);
  is(ov.behind, 2, "at 11 AM, both callers are behind");
  is(sentTo("9010427777").some((s) => /Calls inka cheyyaledu/.test(s[2])), true, "the owner is told, with the names");
  is(sentTo("9876500901").some((s) => /call cheyyaledu/.test(s[2])), true, "and so is each person, about their own");
  h.sent.length = 0;
  is([(await queue.alertOverdue(cfg)).skipped, h.sent.length], ["already sent", 0], "once per checkpoint, not once per cron run");
  // A note written today counts as the call being made.
  const key = h.run(["HGETALL", "lead:owner"])[0];
  h.run(["HSET", "dl_notes", key, JSON.stringify([{ ts: NOW, by: "Sowmya", text: "Spoke, coming Saturday" }])]);
  const day2 = await queue.teamDay(cfg);
  is(day2.reduce((n, t) => n + t.untouched, 0), 1, "a call note is the proof — that lead is no longer pending");

  Date.now = realNow;
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe engines behave");
  process.exit(fails ? 1 : 0);
})();
