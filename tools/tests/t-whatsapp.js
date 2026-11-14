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
// What the agent would have SPOKEN, so the voice path can be checked too.
const spoken = [];
stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async (s) => { spoken.push(String(s)); return null; }, transcribe: async () => null });
// Pushes to the staff phones, recorded as [capability, message].
const pushes = [];
stub("_push.js", { enabled: () => true, notifyCap: async (cfg, cap, msg) => { pushes.push([cap, msg]); return { ok: true, sent: 1 }; }, send: async () => ({ ok: true }) });

// The network. Claude answers with whatever the test sets next; every message
// the agent sends to a patient is recorded.
let claude = [];            // queue of replies (objects become the model's JSON text)
let claudeCalls = 0;
let claudeBody = null;      // what was actually asked of the model, last time
const sent = [];
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    if (/You fix one WhatsApp reply/.test(String((opt && opt.body) || ""))) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.parse(opt.body).messages[0].content.split("\n")[1] || "ok" }] }) };   // the editor's rewrite is not a patient turn
    claudeCalls++;
    try { claudeBody = JSON.parse(opt.body); } catch (e) { claudeBody = null; }
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏", lead: null };
    if (next === 500) return { ok: false, status: 500, json: async () => ({}) };
    const text = typeof next === "string" ? next : JSON.stringify(next);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) };
  }
  if (u.includes("graph.facebook.com")) {
    const b = opt && opt.body ? JSON.parse(opt.body) : {};
    const act = (b.interactive && b.interactive.action) || {};
    sent.push({ to: b.to, text: (b.text && b.text.body) || (b.interactive && b.interactive.body && b.interactive.body.text) || "", type: b.type || "text",
      buttons: Array.isArray(act.buttons) ? act.buttons.map((x) => x.reply.title) : undefined });
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
// The last words sent to a phone — a catalog PDF or a map pin that follows the reply is not the reply.
const lastText = (ph) => [...sent].reverse().find((s) => s.to === "91" + ph && (s.type === "text" || s.type === "interactive"));
const sentTo = (ph) => sent.filter((s) => s.to === "91" + ph).length;
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
  await say("9876500003", "staff add 9000000009 Ravi reception");
  is(adminCalls.length, 0, "a patient typing an owner command does not reach the owner's handler");
  is(/owner number/.test((lastTo("9876500003") || {}).text || ""), true, "and is told it is for the owner");
  is(claudeCalls, 0, "without the model being asked either");
  // "Report" alone is what a patient types about their own blood report —
  // that goes to the agent, not to a lock.
  await say("9876500004", "Report");
  is(/owner number/.test((lastTo("9876500004") || {}).text || ""), false, "a patient's \"Report\" is answered, not locked");
  await say(OWNER, "report");
  is(adminCalls, ["report"], "the owner's own number reaches it");
  is(((lastTo(OWNER) || {}).text || "").includes("report"), true, "and gets the answer");

  console.log("\n  — STOP means stop —");
  await say("9876500004", "STOP");
  // SMEMBERS, not SISMEMBER: the real store has no SISMEMBER, so a test that
  // used it was asking a question production cannot ask.
  const optedOut = () => (h.run(["SMEMBERS", "optout"]) || []).includes("9876500004");
  is(optedOut(), true, "STOP takes them off promotions");
  await say("9876500004", "start");
  is(optedOut(), false, "START puts them back");

  // A voice note that would not transcribe, a sticker, a shared location: each
  // leaves a turn with no words in it. Sent as-is the API answers 400 and the
  // patient gets nothing — it happened twice on the live number.
  console.log("\n  — a message with no words in it —");
  claude = [{ reply: "Namaste 🙏 em kavali?", lead: null }];
  const blank = await wa.askClaude([{ u: "juttu ralutondi", a: "Ela unnaru?" }, { u: "", a: "" }, { u: "photo", a: "" }], "", "Lakshmi");
  const blocks = (claudeBody.messages || []).map((m) => (typeof m.content === "string" ? m.content : ""));
  is(blocks.filter((c) => !String(c).trim()).length, 0, "nothing empty is sent to the model");
  is(blocks.length, 3, "the two half-turns are dropped, the good one and the new question stay");
  is(typeof blank.reply === "string" && blank.reply.length > 0, true, "and the patient still gets an answer");

  claude = [{ reply: "Cheppandi 🙏", lead: null }];
  await wa.askClaude([], "   ", "");
  is(String(claudeBody.messages[0].content).length > 0, true, "a message that is only spaces is replaced, not sent blank");

  console.log("\n  — one number cannot run up the bill —");
  claudeCalls = 0;
  for (let i = 0; i < 16; i++) await say("9876500005", "message " + i);
  is(claudeCalls, 15, "fifteen messages an hour reach the model");
  is(/wait/i.test((lastTo("9876500005") || {}).text || ""), true, "the sixteenth is asked to wait");
  // 7 Nov: one patient read "please wait" eight times in a row.
  const beforeMore = sentTo("9876500005");
  const muted = await say("9876500005", "message 17");
  is([muted.code, muted.body && muted.body.muted, sentTo("9876500005") - beforeMore], [200, true, 0], "the seventeenth gets a silent 200 — the wait message goes once per two hours, not on every message");
  is(h.run(["GET", "wa:wait:9876500005"]), "1", "because a two-hour marker remembers it was said");

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
  // 7 Nov, 15:28–16:50: the AI account was empty and four patients got the
  // same clinic card for every message they sent.
  const cardsBefore = sentTo("9876500008");
  claude.push(500);
  const again = await say("9876500008", "hello?");
  is([again.code, again.body && again.body.muted, sentTo("9876500008") - cardsBefore], [200, true, 0], "a second failure within two hours answers Meta silently — the card is not repeated");
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
  // Opening week: 14 slots held by the agent, 1 confirm call made. The desk's
  // phones are told the moment a slot is held.
  const confirmPush = () => pushes.filter((p) => p[0] === "appts.edit" && p[1].data && p[1].data.kind === "confirm" && p[1].data.ph === "9876500011");
  is(confirmPush().length, 1, "the desk gets exactly one confirm-call push for the held slot");
  is([confirmPush()[0][1].tab, confirmPush()[0][1].urgent, confirmPush()[0][1].data.at === q[0].at, /Confirm call — Ravi/.test(confirmPush()[0][1].title)], ["appts", true, true, true],
    "on the Appointments tab, urgent, carrying the slot time and the patient's name");
  claude.push({ reply: "Repu 5 PM slot hold lo undi 🙏", lead: { name: "Ravi", concern: "Hair fall", heat: "hot", slot_ts: tomorrow + " 17:00" } });
  await say("9876500011", "ok repu 5 PM");
  is(confirmPush().length, 1, "the same slot said again mid-chat does not push the desk a second time");
  claude.push({ reply: "Booked 🙏", lead: { name: "Ravi", concern: "Hair fall", heat: "hot", slot_ts: "2020-01-01 10:00" } });
  await say("9876500012", "old date");
  is(h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).filter((x) => x.ph === "9876500012").length, 0, "a slot in the past is not");

  // 7 Nov: the agent said "slot hold chesanu" and sent no time — the patient's
  // own words are read instead, so the booking still reaches the desk.
  const sp = require(path.join(process.env.DL_API, "_slotparse.js"));
  const sat = Date.parse("2026-11-07T23:22:00+05:30");
  is([sp.parseSlot("Monday 6:00 PM", sat), sp.parseSlot("Somavaram 11:00 AM", sat), sp.parseSlot("Repu 11:00 AM", sat), sp.parseSlot("hello", sat)],
    ["2026-11-09 18:00", "2026-11-09 11:00", "", ""], "a picked slot is read from the words, Sunday is never one");
  const slotWord = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.now() + 330 * 60000 + 2 * 86400000).getUTCDay() - 1] || "Monday";
  claude.push({ reply: `${slotWord} 6:00 PM slot meeku hold chesanu — mana team call chesi confirm chestundi 🙏`, lead: null });
  await say("9876500015", `${slotWord} 6:00 PM`);
  is(h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).filter((x) => x.ph === "9876500015").length, 1,
    "a slot the agent said it held reaches the reminder queue even when the model sent no time");

  // 6 Nov: a patient picked 4 PM before giving a name.
  h.sent.length = 0;
  claude.push({ reply: "4 PM ki book chesanu ✅ Mee peru cheppandi?", lead: { name: "", concern: "Hair fall", heat: "hot", slot: "Ivala 4 PM", slot_ts: tomorrow + " 16:00" } });
  await say("9876500013", "4 PM ki vastanu");
  const nq = h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).filter((x) => x.ph === "9876500013");
  const nl = h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x)).filter((x) => x.phone === "9876500013");
  is([nq.length, nq[0] && nq[0].name, nl.length, nl[0] && nl[0].name, h.sent.some((s) => s[0] === "lead")], [1, "", 1, "Lakshmi (WhatsApp peru)", true],
    "a slot picked before the name still books, reaches the desk and alerts the team — the reminder greets them without a borrowed name");
  is(h.run(["GET", "wa:p:9876500013"]), null, "and the WhatsApp profile name is never remembered as their own");
  claude.push({ reply: "Mee concern enti?", lead: { name: "", concern: "Hair fall" } });
  await say("9876500014", "hi");
  is(h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x)).filter((x) => x.phone === "9876500014").length, 0, "with no name and no slot, it is not a lead yet");

  // 9 Nov: 10 of 40 chats stopped at the first reply, which asked which
  // language the patient wanted. The first reply now asks about the concern.
  console.log("\n  — the first hello —");
  clear();
  claude.push({ reply: "Namaste 🙏 Skin leda hair — e concern gurinchi matladali?", lead: null });   // the model forgot the buttons
  await say("9876500021", "Hi");
  const hello = lastText("9876500021") || {};
  is(hello.buttons, ["Skin", "Hair", "📅 Book Now"], "a bare 'Hi' is answered with Skin / Hair / Book Now buttons even when the model left them out");
  const brief = String((claudeBody.system || [])[0] && claudeBody.system[0].text || "");
  is([/हिंदी/.test(brief), /"buttons": \["Skin", "Hair", "📅 Book Now"\]/.test(brief), /OFFER SLOTS THE MOMENT YOU CAN/.test(brief)], [false, true, true],
    "the brief no longer asks for the language buttons, asks for the concern buttons, and tells the agent to offer slots once the town is known");
  claude.push({ reply: "Pimples entakalam nundi unnayi?", lead: null, buttons: ["6 nelala lopu", "1 year+"] });
  await say("9876500022", "pimples unnayi");
  is((lastText("9876500022") || {}).buttons, ["6 nelala lopu", "1 year+"], "a first message that names the concern keeps the model's own buttons instead of the quick menu");

  // 7–8 Nov: the agent quoted the hair transplant package price in chat; the
  // daily review marked it down. A treatment price now never leaves the file.
  console.log("\n  — no treatment price leaves the chat —");
  const lintMod = require(path.join(API, "_lint.js"));
  const CONSULT = lintMod.CONSULT_LINE, NO_FEE = lintMod.consultLine(0);
  claude.push({ reply: "Hair transplant gurinchi cheppandi — entakalam nundi hair fall undi?", lead: null });
  await say("9876500023", "hair transplant kavali");
  claude.push({ reply: "FUE package ₹59,999 all-inclusive andi, 3,000 grafts varaku. Surgeon garu scalp chusi cheptaru. Assessment ki eppudu ravagalaru?", lead: null });
  await say("9876500023", "cost entha?");
  const priced = (lastText("9876500023") || {}).text || "";
  is([/59,999/.test(priced), priced.endsWith(NO_FEE), /₹300/.test(priced), /Surgeon garu scalp chusi cheptaru/.test(priced)], [false, true, false, true],
    "₹59,999 and its sentence are gone, the rest stays, and a hair transplant chat ends with the consultation line WITHOUT a ₹300 clause (the owner's HT assessment is its own offer)");
  claude.push({ reply: "Pigmentation ki PICO laser sessions ₹18,000 avutayi andi. Eppudu ravagalaru?", lead: null });
  await say("9876500026", "pigmentation laser cost?");
  const pico = (lastText("9876500026") || {}).text || "";
  is([/18,000/.test(pico), pico.includes(CONSULT)], [false, true], "any other treatment price is struck and the line names the ₹300 consultation (a first chat also carries the AI line after it)");
  // The spoken reply is cut out of the text before the editor runs; the
  // review of 9 Nov found the voice note could still say the price.
  spoken.length = 0;
  claude.push({ reply: "Package ₹59,999 andi, surgeon garu chustaru.\nVOICE_SCRIPT: Package yaabhai tommidi vela tommidi vandala tommidi rupayalu, ante ₹59,999 andi. Surgeon garu scalp chusi cheptaru.", lead: null });
  await say("9876500027", "voice lo cheppandi, hair transplant cost entha?");
  const spokenText = (lastText("9876500027") || {}).text || "";
  is([spoken.length, /59,999/.test(spoken[0] || ""), /59,999/.test(spokenText), /Surgeon garu scalp chusi cheptaru/.test(spoken[0] || "")], [1, false, false, true],
    "the voice note is spoken from a script with the price struck as well — the patient neither reads nor hears it");
  claude.push({ reply: "Consultation ₹300 matrame andi. Repu eppudu ravagalaru?", lead: null });
  await say("9876500023", "consultation fee?");
  const fee = (lastText("9876500023") || {}).text || "";
  is([/₹300 matrame andi/.test(fee), fee.includes(CONSULT)], [true, false], "the ₹300 consultation fee passes untouched, with no line added");
  claude.push({ reply: "Skin Care course launch offer ₹49,999 andi (regular ₹1,00,000). Mee background cheppandi?", lead: null, send_catalog: true });
  await say("9876500024", "academy course fees entha?");
  is(/₹49,999/.test((lastText("9876500024") || {}).text || ""), true, "an academy fee in an academy chat survives — those fees are published");
  h.run(["SET", "agent:prices", JSON.stringify({ mode: "bands", consult: 300, bands: [{ name: "Laser hair removal", from: 2500, to: 4000 }] })]);
  claude.push({ reply: "Laser hair removal ₹2,500 nunchi start avutundi, exact plan consultation lo. Repu slot chuddama?", lead: null });
  await say("9876500025", "laser hair removal cost?");
  is(/₹2,500/.test((lastText("9876500025") || {}).text || ""), true, "under the owner's 'bands' policy a listed range stands");
  h.run(["DEL", "agent:prices"]);
  claude.push({ reply: "Package 60k varaku avutundi. Repu ravagalara?", lead: null });
  await say("9876500026", "[📷 photo] hair transplant cost?");
  is(/60k/.test((lastText("9876500026") || {}).text || ""), false, "and a figure written as '60k' is caught too");

  // 8 Nov: the agent learned the town and asked another question instead of a time.
  console.log("\n  — slots the moment the town is known —");
  claude.push({ reply: "Hair fall entakalam nundi undi?", lead: null, qual: { problem: "hair fall" } });
  await say("9876500027", "hair fall undi");
  claude.push({ reply: "Nuzvid nunchi aithe morning slot one trip lo ayipotundi. E roju convenient?", lead: null, qual: { village: "Nuzvid" } });
  await say("9876500027", "Nuzvid nunchi");
  is(/OFFER SLOTS NOW/.test(String(claudeBody.messages.slice(-1)[0].content)), false, "the turn that brings the town is not yet told — the agent has not had two turns to learn");
  claude.push({ reply: "Ee slots lo okati select cheyandi 🙏", lead: null, slots: ["Repu 10:00 AM", "Repu 11:00 AM"] });
  await say("9876500027", "ok eppudu ravali?");
  is(/OFFER SLOTS NOW/.test(String(claudeBody.messages.slice(-1)[0].content)), true, "with the concern and the town known and no appointment, the next turn is told to offer slots");
  is((lastText("9876500027") || {}).type, "interactive", "and the slot list reaches the phone as a tappable list");

  // 13 Nov: a job seeker finished her application, said "Ok", and was offered
  // a consultation slot she took for an interview.
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now(), name: "Applicant", phone: "9876500028", type: "job", concern: "Other Role" })]);
  claude.push({ reply: "HR team chusi call chestaru 🙏", lead: null, qual: { problem: "job", village: "Eluru" } });
  await say("9876500028", "Eluru");
  claude.push({ reply: "Sare andi 🙏", lead: null });
  await say("9876500028", "Fresher");
  claude.push({ reply: "Sare andi 🙏", lead: null });
  await say("9876500028", "Ok");
  is(/OFFER SLOTS NOW/.test(String(claudeBody.messages.slice(-1)[0].content)), false, "a job seeker with a town known is not told to offer consultation slots");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe whatsapp agent behaves");
  process.exit(fails ? 1 : 0);
})();
