// The other doors: Instagram DMs and comments, Facebook Messenger, and the
// phone line (the Twilio receptionist and the Exotel missed-call bridge).
//
// Each is a webhook anybody could post to, so first: without the shared
// secret, nothing gets in — and with no secret configured, still nothing.
// Then the same promises the WhatsApp agent keeps: a redelivered message is
// answered once, a conversation keeps one lead, and the desk's status and
// notes survive the patient writing again. A missed call gets one WhatsApp,
// not one per ring.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.WA_WEBHOOK_TOKEN = "hook";
process.env.IG_PAGE_TOKEN = "page";
process.env.IG_AGENT_ENABLED = "1";
process.env.ANTHROPIC_API_KEY = "test";
process.env.LEAD_NOTIFY_PHONES = "9989325777";

let claude = [], claudeCalls = 0;
const dms = [], comments = [];
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    if (/You fix one WhatsApp reply/.test(String((opt && opt.body) || ""))) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.parse(opt.body).messages[0].content.split("\n")[1] || "ok" }] }) };   // the editor's rewrite is not a patient turn
    claudeCalls++;
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏", lead: null };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(next) }] }) };
  }
  if (u.includes("/me/messages")) { const b = JSON.parse(opt.body); dms.push({ to: b.recipient.id, text: (b.message || {}).text || "" }); return { ok: true, json: async () => ({}) }; }
  if (u.includes("/private_replies") || u.includes("/replies")) { comments.push(u); return { ok: true, json: async () => ({}) }; }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};
const n = require(path.join(API, "_notify.js"));
n.waHandoff = async () => ({ ok: true });

const ig = h.load("instagram"), fb = h.load("messenger");
const exotel = h.load("exotel"), call = h.load("voice-call");
const leads = () => h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x));
let mid = 0;
const igDm = (from, text) => ({ object: "instagram", entry: [{ id: "ourpage", messaging: [{ sender: { id: from }, message: { mid: "ig." + (++mid), text } }] }] });
const fbDm = (from, text) => ({ object: "page", entry: [{ id: "ourpage", messaging: [{ sender: { id: from }, message: { mid: "fb." + (++mid), text } }] }] });
const hook = { token: "hook" };

(async () => {
  console.log("THE OTHER DOORS\n");

  console.log("  — who gets in —");
  for (const [name, mod, body] of [["Instagram", ig, igDm("u1", "hi")], ["Messenger", fb, fbDm("u1", "hi")]]) {
    is((await h.call(mod, { token: "guess" }, body)).code, 403, `${name}: a message without the webhook's token is refused`);
    delete process.env.WA_WEBHOOK_TOKEN;
    is((await h.call(mod, {}, body)).code, 403, `${name}: and with no token configured at all, it still refuses`);
    process.env.WA_WEBHOOK_TOKEN = "hook";
    is((await h.call(mod, { "hub.mode": "subscribe", "hub.verify_token": "hook", "hub.challenge": "7" })).bin, "7", `${name}: Meta's handshake is answered`);
  }
  is((await h.call(ig, { setup: "1", key: "guess" })).code, 401, "the Instagram setup helper needs the admin key");

  console.log("\n  — Instagram —");
  claudeCalls = 0;
  const twice = igDm("ig-anu", "hi, pimples");
  await h.call(ig, hook, twice); await h.call(ig, hook, twice);
  is(claudeCalls, 1, "a redelivered DM is answered once");
  is(dms.filter((d) => d.to === "ig-anu").length, 1, "one reply, not two");
  const ourOwn = { object: "instagram", entry: [{ id: "ourpage", messaging: [{ sender: { id: "ourpage" }, message: { mid: "x1", text: "hi", is_echo: true } }] }] };
  claudeCalls = 0;
  await h.call(ig, hook, ourOwn);
  is(claudeCalls, 0, "our own sent messages coming back are not answered");
  claude.push({ reply: "Thanks Anu 🙏", lead: { name: "Anu", phone: "9876500401", concern: "Acne", heat: "warm" } });
  await h.call(ig, hook, igDm("ig-anu", "Anu, 9876500401"));
  let L = leads().filter((l) => l.src_id === "ig-anu");
  is([L.length, L[0].type, L[0].phone], [1, "instagram", "9876500401"], "a DM with a name becomes an Instagram lead");
  const k1 = `${L[0].ts}|9876500401`;
  h.run(["HSET", "dl_status", k1, "contacted"]);
  h.run(["HSET", "dl_notes", k1, JSON.stringify([{ ts: Date.now(), by: "Desk", text: "Called" }])]);
  await new Promise((r) => setTimeout(r, 3));
  claude.push({ reply: "Ok 🙏", lead: { name: "Anu", phone: "9876500401", concern: "Acne scars", heat: "hot" } });
  await h.call(ig, hook, igDm("ig-anu", "scars kuda"));
  L = leads().filter((l) => l.src_id === "ig-anu");
  const k2 = `${L[0].ts}|9876500401`;
  is([L.length, L[0].concern], [1, "Acne scars"], "writing again keeps one lead, with the fuller concern");
  is([h.run(["HGET", "dl_status", k2]), JSON.parse(h.run(["HGET", "dl_notes", k2]) || "[]").length], ["contacted", 1], "and the desk's status and note stay on it");
  const cmt = (id, from) => ({ object: "instagram", entry: [{ id: "ourpage", changes: [{ field: "comments", value: { id, text: "price entha?", from: { id: from, username: "someone" } } }] }] });
  claude.push({ dm: "Hi! DM lo details pampam 🙏", public_reply: "Check your DMs 😊" });
  claudeCalls = 0;
  await h.call(ig, hook, cmt("c1", "fan1")); await h.call(ig, hook, cmt("c1", "fan1"));
  is(claudeCalls, 1, "a comment is answered once, however often Meta sends it");
  claudeCalls = 0;
  await h.call(ig, hook, cmt("c2", "ourpage"));
  is(claudeCalls, 0, "and our own replies are not answered");

  console.log("\n  — Messenger —");
  claudeCalls = 0;
  const fbTwice = fbDm("fb-ravi", "hello");
  await h.call(fb, hook, fbTwice); await h.call(fb, hook, fbTwice);
  is(claudeCalls, 1, "a redelivered message is answered once");
  claude.push({ reply: "Thanks Ravi 🙏", lead: { name: "Ravi", phone: "9876500402", concern: "Hair fall" } });
  await h.call(fb, hook, fbDm("fb-ravi", "Ravi 9876500402 hair fall"));
  let F = leads().filter((l) => l.src_id === "fb-ravi");
  const f1 = `${F[0].ts}|9876500402`;
  h.run(["HSET", "dl_status", f1, "booked"]);
  await new Promise((r) => setTimeout(r, 3));
  claude.push({ reply: "Ok", lead: { name: "Ravi", phone: "9876500402", concern: "Hair fall, dandruff" } });
  await h.call(fb, hook, fbDm("fb-ravi", "dandruff kuda"));
  F = leads().filter((l) => l.src_id === "fb-ravi");
  is([F.length, h.run(["HGET", "dl_status", `${F[0].ts}|9876500402`])], [1, "booked"], "one lead, and the desk's status survives");
  claudeCalls = 0;
  for (let i = 0; i < 16; i++) await h.call(fb, hook, fbDm("fb-spam", "m" + i));
  is(claudeCalls, 15, "fifteen messages an hour reach the model, not more");

  console.log("\n  — a missed call (Exotel) —");
  process.env.EXOTEL_TOKEN = "exo";
  is((await h.call(exotel, { token: "hook", event: "missed", CallFrom: "09876500403" })).code, 403, "the telephony vendor's own secret, not the Meta one");
  h.sent.length = 0;
  const m1 = await h.call(exotel, { token: "exo", event: "missed", CallFrom: "09876500403" });
  is([m1.code, m1.body.sent], [200, true], "a missed call gets a WhatsApp");
  is(h.sent.some((s) => s[0] === "wa" && s[1] === "9876500403"), true, "to the caller's ten-digit number");
  is(h.sent.some((s) => s[0] === "wa" && s[1] === "9989325777" && /Missed call/.test(s[2])), true, "and the team hears about it");
  h.sent.length = 0;
  const m2 = await h.call(exotel, { token: "exo", event: "missed", CallFrom: "09876500403" });
  is([m2.body.why, h.sent.length], ["deduped", 0], "calling back three times does not get three messages");
  h.sent.length = 0;
  const ans = await h.call(exotel, { token: "exo", event: "passthru", CallFrom: "09876500404", DialCallStatus: "completed", DialCallDuration: "95" });
  is([ans.body.note, h.sent.length], ["answered — no message", 0], "an answered call gets nothing");
  const busy = await h.call(exotel, { token: "exo", event: "passthru", CallFrom: "09876500404", DialCallStatus: "busy" });
  is(busy.body.sent, true, "a busy line does");
  const ivr = await h.call(exotel, { token: "exo", event: "ivr", CallFrom: "09876500405", d: "2" });
  is(/Kasturi Vari Street/.test((h.sent.find((s) => s[1] === "9876500405") || [])[2] || ""), true, "pressing 2 sends the address");

  console.log("\n  — the phone receptionist (Twilio) —");
  delete process.env.TWILIO_AUTH_TOKEN;
  is((await h.call(call, { token: "guess" }, { From: "+919876500406" })).code, 403, "without the secret, no call is answered");
  const greet = await h.call(call, hook, { From: "+919876500406", CallSid: "CA1" }, { headers: { host: "www.dermaluxe.ai" } });
  is([greet.code, /<Gather input="speech"/.test(String(greet.bin))], [200, true], "a call is greeted and listened to");
  is(String(greet.bin).includes("&step=turn"), false, "and the XML it returns is well formed (no bare &)");
  process.env.TWILIO_AUTH_TOKEN = "twilio";
  is((await h.call(call, hook, { From: "+919876500406" }, { headers: { host: "www.dermaluxe.ai", "x-twilio-signature": "forged" }, url: "/api/voice-call?token=hook" })).code, 403, "once Twilio's key is set, a forged signature is refused");
  delete process.env.TWILIO_AUTH_TOKEN;
  claude.push({ reply: "Saturday 5 ki book chesanu andi.", lead: { name: "Kiran", concern: "Hair fall", heat: "hot" }, end: true });
  const turn = await h.call(call, { token: "hook", step: "turn" }, { From: "+919876500406", SpeechResult: "Naa peru Kiran, hair fall, Saturday 5" }, { headers: { host: "www.dermaluxe.ai" } });
  is(/<Hangup\/>/.test(String(turn.bin)), true, "a finished booking ends the call");
  const C = leads().filter((l) => l.type === "phone_call");
  is([C.length, C[0] && C[0].phone, C[0] && C[0].heat], [1, "9876500406", "hot"], "and the caller is a lead, with the number they rang from");
  h.sent.length = 0;
  await h.call(call, { token: "hook", step: "status" }, { From: "+919876500407", CallStatus: "no-answer" });
  await h.call(call, { token: "hook", step: "status" }, { From: "+919876500407", CallStatus: "no-answer" });
  is(h.sent.filter((s) => s[0] === "wa" && s[1] === "9876500407").length, 1, "a call nobody answered gets one WhatsApp, not one per attempt");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe other doors behave");
  process.exit(fails ? 1 : 0);
})();
