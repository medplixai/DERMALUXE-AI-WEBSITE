// A tidy conversation: one answer to one breath, no "what is your problem?"
// to somebody who just said it, and no "slot hold chesanu" without a booking.
//
// 14 Nov 2026, owner: "agent neat ga patient tho matladi clinic ki
// tisukuravali". In the fortnight before, 177 pairs of messages sent a second
// apart got two replies each; first questions got "mee problem cheppandi"
// glued in front of the answer; and six patients were told their slot was
// held when nothing had been booked.
process.env.WA_MERGE_MS = "80";
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

(async () => {
  console.log("A TIDY CONVERSATION\n");
  const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
  stub("_admin.js", { isAdmin: (d) => d === OWNER, handle: async () => null, fmtIst: () => "Sat 5 PM" });
  stub("_hr.js", { handle: async () => null });
  stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
  stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });
  stub("_push.js", { enabled: () => false, notifyCap: async () => ({ ok: true }), send: async () => ({ ok: true }) });
  const asked = [];
  let nextReply = "Sare andi 🙏", cutNext = 0;
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      const body = String((opt && opt.body) || "");
      if (/You fix one WhatsApp reply/.test(body)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) };
      asked.push(body);
      if (cutNext > 0) { cutNext--; return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"reply":"Hi 🙏' }], stop_reason: "max_tokens", usage: { output_tokens: 2000 } }) }; }
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ reply: nextReply, lead: null }) }] }) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  const ab = h.load("_abtest");
  await ab.save({ kind: "pg" }, { on: false, a: { label: "A", text: "Namaste 🙏 DermaLuxe by Medicare nunchi — mee problem cheppandi, manam tappakunda help chestam 😊" }, b: { label: "B", text: "Namaste 🙏 B line" } }, "Owner");
  const wa = h.load("whatsapp");
  let mid = 0;
  const say = (from, text) => new Promise((resolve) => {
    const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ code: this._c, body: o }); return this; }, send() { resolve({ code: this._c }); return this; }, end() { resolve({ code: this._c }); return this; } };
    wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: "Lakshmi" } }],
      messages: [{ id: "wamid.mg" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
  });
  const lastUser = () => { try { const b = JSON.parse(asked[asked.length - 1]); const m = b.messages[b.messages.length - 1]; return typeof m.content === "string" ? m.content : JSON.stringify(m.content); } catch (e) { return ""; } };

  console.log("  — two messages in one breath —");
  asked.length = 0;
  const p1 = say("9876500301", "Hair fall");
  await new Promise((r) => setTimeout(r, 15));
  const p2 = say("9876500301", "Dandruff kuda undi");
  const [r1, r2] = await Promise.all([p1, p2]);
  is(asked.length, 1, "one answer, not two");
  is([!!(r1.body && r1.body.merged), !!(r2.body && r2.body.merged)], [true, false], "the first waits and stays quiet, the second answers");
  is(/Hair fall/.test(lastUser()) && /Dandruff kuda undi/.test(lastUser()), true, "and the answer is to both of them together");
  const out = h.run(["LRANGE", "ib:m:9876500301", "0", "-1"]).map((x) => JSON.parse(x));
  is([out.filter((m) => m.dir === "in").length, out.filter((m) => m.dir === "out").length], [2, 1], "the staff inbox shows both messages and the one reply");

  asked.length = 0;
  await say("9876500301", "Eluru");
  await new Promise((r) => setTimeout(r, 120));
  await say("9876500301", "Repu ravacha?");
  is(asked.length, 2, "messages a while apart are answered one by one, as before");

  console.log("\n  — the first line —");
  asked.length = 0;
  await say("9876500302", "Hi");
  is(asked[0].includes("mee problem cheppandi"), true, "\"Hi\" gets the opener that asks what the problem is");
  await say("9876500303", "How many sessions are required for upper lip laser?");
  is([asked[1].includes("mee problem cheppandi"), /do not ask what their problem is/.test(asked[1])], [false, true],
    "a real first question gets \"Namaste\" and its answer, not \"mee problem cheppandi\"");
  const q1 = say("9876500304", "Dermaluxe");
  await new Promise((r) => setTimeout(r, 15));
  await Promise.all([q1, say("9876500304", "?")]);
  is([asked.length, asked[2].includes("mee problem cheppandi")], [3, true], "\"Dermaluxe\" + \"?\" — one greeting, not two");

  console.log("\n  — \"slot hold chesanu\" means a booking —");
  // The time was picked a message earlier; the patient's last words were
  // "Location ekda", and the model sent no slot_ts.
  nextReply = "Super andi 😊 *Monday 11:30 AM* slot meeku hold chesanu — mana team call chesi confirm chestundi 🙏";
  await say("9876500305", "Location ekda");
  const q = h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).filter((a) => a.ph === "9876500305");
  is(q.length, 1, "the slot the reply names is on the desk's list");
  is(q[0] && new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(new Date(q[0].at)), "Mon 11:30", "Monday, 11:30 AM, Eluru time");
  nextReply = "Ivala 6:30 PM leda Monday 11:00 AM — edi convenient? Select cheste team call chesi confirm chestundi 🙏";
  await say("9876500306", "Ok");
  is(h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).filter((a) => a.ph === "9876500306").length, 0, "two times on offer is not a booking");
  nextReply = "Monday 11:00 AM kudurutunda andi? Cheppandi, team call chesi confirm chestundi.";
  await say("9876500307", "Ok");
  is(h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).filter((a) => a.ph === "9876500307").length, 0, "and a question about one time is not either");

  console.log("\n  — a reply cut off half-way —");
  // 14 Nov: a new patient's "Hi" got the fixed "team twaralo reply chestundi"
  // card because the model's answer ran out of room before the JSON closed.
  nextReply = "Namaste 🙏 Skin aa leda hair aa, cheppandi?"; cutNext = 1; asked.length = 0;
  const outsBefore = h.run(["LRANGE", "ib:m:9876500308", "0", "-1"]).length;
  await say("9876500308", "Hi");
  const lastOut = h.run(["LRANGE", "ib:m:9876500308", "0", "0"]).map((x) => JSON.parse(x))[0] || {};
  is([asked.length, /Skin aa leda hair aa/.test(lastOut.text || ""), /twaralo/.test(lastOut.text || "")], [2, true, false], "it is asked once more, and the patient gets the real answer, not the fallback card");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe conversation is tidy");
  process.exit(fails ? 1 : 0);
})();
