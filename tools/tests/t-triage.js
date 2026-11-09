// What the inbox says each chat needs — a table of situations the desk
// actually meets, run through the one pure function that decides.
//
// The order matters as much as the verdicts: the chat a colleague is holding
// while the patient waits comes before the agent's silence, which comes
// before a request for a call, which comes before a closing window.
const path = require("path");
const T = require(path.join(process.env.DL_API, "_triage.js"));
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const NOW = Date.parse("2026-11-09T11:00:00+05:30"), MIN = 60000, HOUR = 3600000;
const kind = (t, lead) => { const r = T.triage(t, lead, NOW); return r.need ? r.need.kind : null; };
const chat = (o) => Object.assign({ phone: "9876500001", name: "Lakshmi", ts: NOW - 2 * MIN, lastDir: "out", lastBy: "ai", lastIn: NOW - 3 * MIN, lastInText: "Pigmentation ki treatment undha?", aiRep: 0 }, o);

console.log("THE INBOX TRIAGE\n");
console.log("  — fine: the agent has it —");
is(kind(chat()), null, "patient asked, agent answered a minute later — nobody needed");
is(T.triage(chat(), {}, NOW).stage.kind, "ai", "and the stage reads 'AI matladutondi'");
is(T.triage(chat(), {}, NOW).bucket, "ai", "in the AI bucket");
is(kind(chat({ lastDir: "in", lastIn: NOW - 2 * MIN, ts: NOW - 2 * MIN })), null, "patient wrote two minutes ago and the agent is still typing — not yet a problem");

console.log("\n  — a person must act —");
is(kind(chat({ human: { by: "Sowmya", ts: NOW - HOUR }, lastDir: "in", lastIn: NOW - 25 * MIN, ts: NOW - 25 * MIN })), "human_wait", "Sowmya holds the chat, the patient wrote back 25 minutes ago, the agent is silent — Sowmya must answer");
const hw = T.triage(chat({ human: { by: "Sowmya Rani", ts: NOW - HOUR }, lastDir: "in", lastIn: NOW - 25 * MIN }), {}, NOW).need;
is(/Sowmya/.test(hw.text) && /25 nimishalu/.test(hw.text), true, "and the line names her and the wait");
is(kind(chat({ lastDir: "in", lastIn: NOW - 15 * MIN, ts: NOW - 15 * MIN })), "stuck", "no human, patient wrote 15 minutes ago, no reply — the agent failed");
is(kind(chat({ lastInText: "Chey meeda bleeding aagatledu" })), "emergency", "bleeding is an emergency even though the agent replied");
is(kind(chat({ lastInText: "Doctor tho matladali, call cheyandi", lastHuman: 0 })), "ask_call", "'call cheyandi' asks for a person");
is(kind(chat({ lastInText: "call cheyandi", lastHuman: NOW - MIN, lastDir: "out", lastBy: "Sowmya" })), null, "but once a colleague has answered since, the ask is handled");
is(kind(chat({ grade: "A", lastIn: NOW - 22 * HOUR, lastInText: "Saturday ok" })), "hot_window", "an A-grade lead's 24-hour window closes in two hours and nobody has booked them");
is(kind(chat({ grade: "A", lastIn: NOW - 22 * HOUR }), { status: "booked" }), null, "unless they are already booked");
is(kind(chat({ aiRep: 2 })), "loop", "the agent sent the same line three times running");
is(kind(chat({ lastInText: "[📷] idi chudandi" })), "photo", "a photo came in — worth a doctor's glance");
is(kind(chat({ lastInText: "[📷 photo]" })), "photo", "a photo with no caption is still a photo");
is(kind(chat({ grade: "A", lastIn: NOW - 22 * HOUR, lastInText: "Saturday ok" }), { status: "new", slot_ts: "2026-11-14 18:30" }), null, "an A-grade lead whose slot the agent already fixed needs nobody");
is(T.triage(chat({ grade: "A", lastIn: NOW - 22 * HOUR }), { status: "new", slot_ts: "2026-11-14 18:30" }, NOW).bucket, "booked", "and sits under booked");
is(kind(chat({ lastDir: "in", lastIn: NOW - 40 * 86400000, ts: NOW - 40 * 86400000 })), null, "a chat nobody answered forty days ago is old, not an alarm");
is(T.triage(chat({ lastDir: "in", lastIn: NOW - 40 * 86400000, ts: NOW - 40 * 86400000 }), {}, NOW).bucket, "quiet", "it is folded with the quiet ones");
is(kind(chat({ lastDir: "in", lastIn: NOW - 2 * 86400000, ts: NOW - 2 * 86400000 }), { status: "booked" }), null, "a booked patient's unanswered 'ok thank you' is nothing");

console.log("\n  — the clinic's everyday words are not emergencies —");
["Severe hair fall undi, treatment undha?", "Fungal infection ki treatment undha?", "Urgent ga appointment kavali repu", "Hospital address pampandi", "Mee hospital ekkada undi?",
 "Pustules on face, acne", "Blood test cheyyala mundu?", "Sunburn ki cream undha?", "Allergy test chestara?", "Naku dust allergy undi", "Pimples, mantalu kooda undi", "Hi, nenu Pushpa",
 "Video call consultation undha?", "I speak Telugu only", "Missed call vachindi", "Repu call back chestanu"].forEach(function (s) {
  is(kind(chat({ lastInText: s })), null, "'" + s + "' — the agent answered, nobody needed");
});
is(kind(chat({ lastInText: "Peel chesaka face motham blisters, mantalu" })), "emergency", "but a reaction after a treatment is");
is(kind(chat({ lastInText: "Oopiri aadatledu, breathing problem" })), "emergency", "and trouble breathing is");
is(kind(chat({ lastInText: "[📷] idi chudandi", lastIn: NOW - 30 * HOUR, ts: NOW - 30 * HOUR })), null, "but not a photo from yesterday");

console.log("\n  — the most urgent one wins —");
is(kind(chat({ human: { by: "Sowmya" }, lastDir: "in", lastIn: NOW - 25 * MIN, lastInText: "call cheyandi" })), "human_wait", "held chat + call request → the held chat (a person is already on it)");
is(kind(chat({ lastDir: "in", lastIn: NOW - 15 * MIN, lastInText: "call cheyandi" })), "stuck", "silent agent + call request → the silence is the bigger problem");
is(kind(chat({ lastDir: "in", lastIn: NOW - 15 * MIN, lastInText: "severe pain, bleeding" })), "emergency", "silent agent + emergency → emergency");

console.log("\n  — where it stands —");
const stage = (t, lead) => T.triage(t, lead, NOW).stage.kind;
is(stage(chat(), { status: "booked", slot: "Mon 10 AM" }), "booked", "a booked lead shows booked");
is(/Mon 10 AM/.test(T.triage(chat(), { status: "booked", slot: "Mon 10 AM" }, NOW).stage.text), true, "with the slot");
is(stage(chat(), { status: "new", slot_ts: "2026-11-10 18:30" }), "booked", "a slot the agent fixed counts as booked even before the desk moved the stage");
is(stage(chat(), { status: "visited" }), "visited", "visited");
is(stage(chat({ human: { by: "Sowmya" } }), {}), "human", "a held chat shows who holds it");
is(T.triage(chat({ human: { by: "Sowmya" }, lastDir: "out", lastBy: "Sowmya", lastHuman: NOW - 30 * MIN }), {}, NOW).bucket, "human", "and is grouped with the staff's chats, not the agent's");
is(stage(chat({ ts: NOW - 3 * 86400000, lastIn: NOW - 3 * 86400000 }), {}), "quiet", "three days of silence is quiet");
is(T.triage(chat({ ts: NOW - 3 * 86400000, lastIn: NOW - 3 * 86400000 }), {}, NOW).bucket, "quiet", "and folded away");
is(T.triage(chat(), { status: "closed" }, NOW).bucket, "quiet", "closed ones too");

console.log("\n  — the order of the list —");
const rows = [
  Object.assign(chat({ phone: "1" }), T.triage(chat(), {}, NOW)),
  Object.assign(chat({ phone: "2", lastDir: "in", lastIn: NOW - 15 * MIN }), T.triage(chat({ lastDir: "in", lastIn: NOW - 15 * MIN }), {}, NOW)),
  Object.assign(chat({ phone: "3", lastDir: "in", lastIn: NOW - 40 * MIN }), T.triage(chat({ lastDir: "in", lastIn: NOW - 40 * MIN }), {}, NOW)),
  Object.assign(chat({ phone: "4", human: { by: "Sowmya" }, lastDir: "in", lastIn: NOW - 5 * MIN }), T.triage(chat({ human: { by: "Sowmya" }, lastDir: "in", lastIn: NOW - 5 * MIN }), {}, NOW)),
  Object.assign(chat({ phone: "5", ts: NOW - 30 * MIN }), T.triage(chat({ ts: NOW - 30 * MIN }), {}, NOW)),
].sort(T.order).map((r) => r.phone);
is(rows, ["4", "3", "2", "1", "5"], "held chat first, then the two stuck ones longest wait first, then the fine ones newest first");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe triage behaves");
process.exit(fails ? 1 : 0);
