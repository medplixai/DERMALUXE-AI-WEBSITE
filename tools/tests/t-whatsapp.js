// The WhatsApp agent: the clinic's front door, open all night.
//
// It is the one endpoint anybody on earth can write to, and what it does
// with a message ends up as a lead the desk calls, a slot on the doctor's
// day, an alert on the owner's phone, or — from the owner's number — a
// broadcast to every patient. So the checks are: who gets in, what happens
// twice, what a patient cannot do that the owner can, and what survives a
// patient writing again after the desk has already worked the lead.
//
// Claude and the WhatsApp Cloud API are stubbed at the network (fetch); the
// agent's own code, the store, the referral engine and the clinic facts all
// run for real.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const OWNER = "9010427777";
process.env.ADMIN_PHONES = OWNER;
process.env.WA_WEBHOOK_TOKEN = "hook";
process.env.WA_CLOUD_TOKEN = "cloud";
process.env.WA_PHONE_ID_ALLOWLIST = "111";
process.env.WA_AGENT_ENABLED = "1";
process.env.ANTHROPIC_API_KEY = "test";
process.env.LEAD_NOTIFY_PHONES = "9989325777";

const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
const adminCalls = [];
stub("_admin.js", {
  isAdmin: (d) => d === OWNER,
  handle: async (cfg, d, text) => { adminCalls.push(text); return /^report\b/i.test(text) ? "📊 report" : null; },
  fmtIst: () => "Sat 5 PM",
});
stub("_hr.js", { handle: async () => null });
stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });

// The network. Claude answers with whatever the test sets next; every message
// the agent sends to a patient is recorded.
let claude = [];            // queue of replies (objects become the model's JSON text)
let claudeCalls = 0;
const sent = [];
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    claudeCalls++;
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏", lead: null };
    if (next === 500) return { ok: false, status: 500, json: async () => ({}) };
    const text = typeof next === "string" ? next : JSON.stringify(next);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) };
  }
  if (u.includes("graph.facebook.com")) {
    const b = opt && opt.body ? JSON.parse(opt.body) : {};
    sent.push({ to: b.to, text: (b.text && b.text.body) || (b.interactive && b.interactive.body && b.interactive.body.text) || "", type: b.type || "text" });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

const wa = h.load("whatsapp");
let mid = 0;
const msgBody = (from, text, extra) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: Object.assign({
    metadata: { phone_number_id: "111" },
    contacts: [{ profile: { name: "Lakshmi" } }],
    messages: [{ id: "wamid." + (++mid), from: "91" + from, type: "text", text: { body: text } }],
  }, extra || {}) }] }],
});
const post = (body, token) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; },
    json(o) { resolve({ code: this._c, body: o }); return this; }, send(x) { resolve({ code: this._c, body: x }); return this; }, end() { resolve({ code: this._c }); return this; } };
  wa({ method: "POST", headers: {}, query: token === undefined ? { token: "hook" } : (token ? { token } : {}), body }, res);
});
const get = (q) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ code: this._c, body: o }); return this; }, send(x) { resolve({ code: this._c, body: x }); return this; } };
  wa({ method: "GET", headers: {}, query: q, body: {} }, res);
});
const say = (from, text) => post(msgBody(from, text));
const lastTo = (ph) => [...sent].reverse().find((s) => s.to === "91" + ph);
const leads = () => h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x));
const clear = () => { sent.length = 0; h.sent.length = 0; };

(async () => {
  console.log("THE WHATSAPP AGENT\n");

  console.log("  — who gets in —");
  is((await get({ "hub.mode": "subscribe", "hub.verify_token": "hook", "hub.challenge": "42" })).body, "42", "Meta's handshake with the right token is answered");
  is((await get({ "hub.mode": "subscribe", "hub.verify_token": "guess", "hub.challenge": "42" })).code, 403, "and with a wrong one refused");
  is((await post(msgBody("9876500001", "hi"), "guess")).code, 403, "a message posted without the webhook's token is refused");
  clear();
  await post(msgBody("9876500001", "hi", { metadata: { phone_number_id: "999" } }));
  is(sent.length, 0, "an event for somebody else's WhatsApp number is ignored, not answered");

  // Without the token configured, anybody could post a payload "from" the
  // owner's number and run owner commands — a broadcast to every patient.
  // It must refuse, not stand open.
  delete process.env.WA_WEBHOOK_TOKEN;
  clear(); adminCalls.length = 0;
  const open = await post(msgBody(OWNER, "report"), null);
  is(open.code, 403, "with no webhook token configured at all, it refuses rather than standing open");
  is(adminCalls.length, 0, "and no owner command ran");
  process.env.WA_WEBHOOK_TOKEN = "hook";

  console.log("\n  — the same message twice —");
  clear(); claudeCalls = 0;
  const twice = msgBody("9876500002", "Hi, pimples undi");
  await post(twice); await post(twice);
  is(claudeCalls, 1, "Meta redelivering a message does not get it answered twice");

  console.log("\n  — what only the owner may do —");
  clear(); adminCalls.length = 0; claudeCalls = 0;
  await say("9876500003", "report");
  is(adminCalls.length, 0, "a patient typing an owner command does not reach the owner's handler");
  is(/owner number/.test((lastTo("9876500003") || {}).text || ""), true, "and is told it is for the owner");
  is(claudeCalls, 0, "without the model being asked either");
  await say(OWNER, "report");
  is(adminCalls, ["report"], "the owner's own number reaches it");
  is(((lastTo(OWNER) || {}).text || "").includes("report"), true, "and gets the answer");

  console.log("\n  — STOP means stop —");
  await say("9876500004", "STOP");
  is(h.run(["SISMEMBER", "optout", "9876500004"]), 1, "STOP takes them off promotions");
  await say("9876500004", "start");
  is(h.run(["SISMEMBER", "optout", "9876500004"]), 0, "START puts them back");

  console.log("\n  — one number cannot run up the bill —");
  claudeCalls = 0;
  for (let i = 0; i < 16; i++) await say("9876500005", "message " + i);
  is(claudeCalls, 15, "fifteen messages an hour reach the model");
  is(/wait/i.test((lastTo("9876500005") || {}).text || ""), true, "the sixteenth is asked to wait");

  console.log("\n  — a conversation becomes a lead —");
  clear();
  claude.push({ reply: "Thank you Lakshmi garu 🙏 Saturday 5 PM ok na?", lead: { name: "Lakshmi", concern: "Pigmentation", heat: "HOT", call_prep: "wants PICO" } });
  await say("9876500006", "Naa peru Lakshmi, face meeda machalu");
  let L = leads().filter((l) => l.phone === "9876500006");
  is(L.length, 1, "one lead is written");
  is([L[0].name, L[0].concern, L[0].heat], ["Lakshmi", "Pigmentation", "hot"], "with the name, the concern, and the heat in lower case");
  is(h.sent.some((s) => s[0] === "lead"), true, "and the team is alerted");
  claude.push({ reply: "Ok", lead: { name: "", concern: "x" } });
  await say("9876500007", "just asking");
  is(leads().filter((l) => l.phone === "9876500007").length, 0, "no name, no lead");

  console.log("\n  — the patient writes again after the desk has worked the lead —");
  // The desk called and marked it, and wrote a note. The lead is keyed by
  // "<ts>|<phone>"; the agent used to replace the row with a fresh timestamp,
  // so the status went back to New and the note vanished.
  const k = `${L[0].ts}|9876500006`;
  h.run(["HSET", "dl_status", k, "contacted"]);
  h.run(["HSET", "dl_notes", k, JSON.stringify([{ ts: Date.now(), by: "Reception", text: "Spoke — coming Sat 5 PM" }])]);
  await new Promise((r) => setTimeout(r, 5));
  claude.push({ reply: "Done 🙏", lead: { name: "Lakshmi", concern: "Pigmentation + tan", heat: "hot" } });
  await say("9876500006", "tan kuda undi");
  L = leads().filter((l) => l.phone === "9876500006");
  is(L.length, 1, "still one row, now with the fuller concern");
  is(L[0].concern, "Pigmentation + tan", "updated from the new message");
  const k2 = `${L[0].ts}|9876500006`;
  is(h.run(["HGET", "dl_status", k2]), "contacted", "and the desk's status is still on it");
  is(JSON.parse(h.run(["HGET", "dl_notes", k2]) || "[]").length, 1, "and so is the desk's note");

  console.log("\n  — when the model fails —");
  clear();
  claude.push(500);
  const f = await say("9876500008", "hello");
  is(f.code, 200, "a model outage still answers Meta, so it does not retry forever");
  is(((lastTo("9876500008") || {}).text || "").length > 10, true, "and the patient still gets a reply");
  claude.push("sorry I can't format that");
  await say("9876500009", "hello");
  is(((lastTo("9876500009") || {}).text || "").length > 5, true, "a reply that is not JSON is salvaged, not thrown");

  console.log("\n  — an urgent patient —");
  clear();
  const alerts = () => h.sent.filter((s) => s[0] === "wa" && /URGENT/.test(s[2] || "")).length;
  claude.push({ reply: "Please come now 🙏", lead: null, urgent: "Swelling after peel" });
  await say("9876500010", "face vachindi, burning");
  is(alerts() >= 1, true, "the team is woken");
  const first = alerts();
  claude.push({ reply: "…", lead: null, urgent: "Swelling after peel" });
  await say("9876500010", "inka ekkuva ayyindi");
  is(alerts(), first, "and not again for the same patient within two hours");

  console.log("\n  — a confirmed slot goes on the day —");
  const tomorrow = new Date(Date.now() + 330 * 60000 + 86400000).toISOString().slice(0, 10);
  claude.push({ reply: "Booked 🙏", lead: { name: "Ravi", concern: "Hair fall", heat: "hot", slot_ts: tomorrow + " 17:00" } });
  await say("9876500011", "repu 5 ki vastanu");
  const q = h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).filter((x) => x.ph === "9876500011");
  is(q.length, 1, "the booking is queued for its reminders");
  claude.push({ reply: "Booked 🙏", lead: { name: "Ravi", concern: "Hair fall", heat: "hot", slot_ts: "2020-01-01 10:00" } });
  await say("9876500012", "old date");
  is(h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).filter((x) => x.ph === "9876500012").length, 0, "a slot in the past is not");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe whatsapp agent behaves");
  process.exit(fails ? 1 : 0);
})();
