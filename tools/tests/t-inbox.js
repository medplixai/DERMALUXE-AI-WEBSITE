// The WhatsApp inbox: the agent's conversations, where the desk can read
// them, answer, and take a chat over.
//
// What matters: every patient message and every reply is in the thread;
// owner commands are not (they are not patient conversations); once a
// colleague has a chat the agent says nothing more to that patient; a reply
// outside WhatsApp's 24 hours goes as the approved template instead of
// silently failing; and only people with the inbox powers can read or write.
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

const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("_admin.js", { isAdmin: (d) => d === OWNER, handle: async () => "📊 report", fmtIst: () => "" });
stub("_hr.js", { handle: async () => null });
stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });

let claudeCalls = 0;
global.fetch = async (url) => {
  if (String(url).includes("api.anthropic.com")) { claudeCalls++; return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ reply: "Namaste 🙏 Saturday ok na?", lead: null }) }] }) }; }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

const wa = h.load("whatsapp"), inbox = h.load("inbox");
const n = require(path.join(API, "_notify.js"));
let mid = 0;
const say = (from, text, name) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ code: this._c, body: o }); return this; }, send(x) { resolve({ code: this._c }); return this; } };
  wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: name || "Lakshmi" } }],
    messages: [{ id: "m" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
});
const DESK = { name: "Sowmya", phone: "9876500901", role: "reception" };

(async () => {
  console.log("THE WHATSAPP INBOX\n");

  console.log("  — every message is kept —");
  await say("9876500910", "Pigmentation ki treatment undha?");
  const list = await h.call(inbox, { a: "list" });
  is(list.body.threads.map((t) => [t.phone, t.name, t.unread]), [["9876500910", "Lakshmi", 1]], "the conversation appears, with the patient's WhatsApp name and one unread");
  const th = await h.call(inbox, { a: "thread", phone: "9876500910" });
  is(th.body.msgs.map((m) => [m.dir, m.by || ""]), [["in", ""], ["out", "ai"]], "the thread has what they wrote and what the agent answered");
  is(th.body.open, true, "and WhatsApp's 24-hour window is open");
  is((await h.call(inbox, { a: "list" })).body.threads[0].unread, 0, "opening it marks it read");
  await say(OWNER, "report");
  is((await h.call(inbox, { a: "list" })).body.threads.some((t) => t.phone === OWNER), false, "the owner's own commands are not in the inbox");

  console.log("\n  — a person takes the chat —");
  h.as(["inbox.view", "inbox.reply"], DESK);
  const r = await h.call(inbox, {}, { a: "reply", phone: "9876500910", text: "Lakshmi garu, nenu Sowmya. Saturday 5 PM ki book chestanu." });
  is([r.code, r.body.via], [200, "text"], "a reply inside the window goes as plain WhatsApp");
  is(h.sent.some((s) => s[0] === "wa" && s[1] === "9876500910" && /Sowmya/.test(s[2])), true, "to the patient");
  const t2 = await h.call(inbox, { a: "thread", phone: "9876500910" });
  is([t2.body.msgs[t2.body.msgs.length - 1].by, t2.body.human.by], ["Sowmya", "Sowmya"], "it is in the thread under their name, and the chat is now theirs");
  claudeCalls = 0;
  await say("9876500910", "Ok thanks, discount untunda?");
  is(claudeCalls, 0, "while a person has the chat, the agent does not answer");
  const t3 = await h.call(inbox, { a: "thread", phone: "9876500910" });
  is(t3.body.msgs[t3.body.msgs.length - 1].dir, "in", "but the patient's message still lands in the thread");
  await h.call(inbox, {}, { a: "takeover", phone: "9876500910", on: false });
  claudeCalls = 0;
  await say("9876500910", "Saturday ok");
  is(claudeCalls, 1, "handed back, the agent answers again");
  is(JSON.parse(h.run(["LRANGE", "staff:audit", "0", "0"])[0]).what, "handed back WhatsApp chat 9876500910", "and who did what is in the audit");

  console.log("\n  — after WhatsApp's 24 hours —");
  const meta = JSON.parse(h.run(["GET", "ib:t:9876500910"]));
  meta.lastIn = Date.now() - 25 * 3600000;
  h.run(["SET", "ib:t:9876500910", JSON.stringify(meta)]);
  h.sent.length = 0;
  const late = await h.call(inbox, {}, { a: "reply", phone: "9876500910", text: "Mee report ready andi, eppudu vastaru?" });
  is(late.body.via, "template", "a reply after the window goes as the approved template");
  is(h.sent.filter((s) => s[0] === "wa").length, 0, "free text is not even attempted — Meta would drop it");
  is(h.sent.find((s) => s[0] === "tpl")[3][0], "Lakshmi", "addressed by first name");
  const failTpl = n.sendWaTemplate;
  n.sendWaTemplate = async () => ({ ok: false });
  is((await h.call(inbox, {}, { a: "reply", phone: "9876500910", text: "Hello again" })).code, 502, "if nothing can be delivered, it says so instead of pretending");
  n.sendWaTemplate = failTpl;

  console.log("\n  — who may —");
  h.as(["inbox.view"], DESK);
  is((await h.call(inbox, {}, { a: "reply", phone: "9876500910", text: "hi there" })).code, 403, "somebody who may only read cannot reply");
  is((await h.call(inbox, {}, { a: "takeover", phone: "9876500910" })).code, 403, "or take a chat over");
  h.as(["leads.view"], DESK);
  is((await h.call(inbox, { a: "list" })).code, 403, "and without inbox.view, no inbox at all");
  h.as(["*"]);
  is((await h.call(inbox, {}, { a: "reply", phone: "9876500999", text: "hello there" })).code, 404, "a number that never wrote to us is not a thread");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe inbox behaves");
  process.exit(fails ? 1 : 0);
})();
