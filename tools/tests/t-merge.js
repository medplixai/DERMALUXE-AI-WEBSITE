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
  let nextReply = "Sare andi 🙏", cutNext = 0, slow = 0;
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      const body = String((opt && opt.body) || "");
      if (/You fix one WhatsApp reply/.test(body)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) };
      asked.push(body);
      if (slow) await new Promise((r) => setTimeout(r, slow));
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

  console.log("\n  — overtaken while writing —");
  // 16 Nov: "1 year+", then 13 seconds later "How much cost" — while the
  // first reply was still being written. Two replies went, the first asking
  // the town as if the cost had not been asked.
  nextReply = "Hair fall ki doctor scalp chusi plan istaru 🙏 Meeru e ooru nundi andi?"; slow = 250; asked.length = 0;
  const o1 = say("9876500309", "1 year+");
  await new Promise((r) => setTimeout(r, 140));
  const o2 = say("9876500309", "How much cost");
  const [x1, x2] = await Promise.all([o1, o2]);
  const outs9 = h.run(["LRANGE", "ib:m:9876500309", "0", "-1"]).map((x) => JSON.parse(x)).filter((m) => m.dir === "out");
  is([!!(x1.body && x1.body.overtaken), outs9.length], [true, 1], "the first reply stays quiet, and the patient gets one reply");
  is(/1 year\+/.test(lastUser()) && /How much cost/.test(lastUser()), true, "and that one reply is to both messages");
  const o3 = say("9876500310", "Pimples undi");
  await new Promise((r) => setTimeout(r, 140));
  await Promise.all([o3, say("9876500310", "staff")]);
  const outs10 = h.run(["LRANGE", "ib:m:9876500310", "0", "-1"]).map((x) => JSON.parse(x)).filter((m) => m.dir === "out" && m.by === "ai");
  is(outs10.some((m) => /e ooru nundi/.test(m.text)), true, "a \"staff\" request in between does not swallow the answer to the first message");
  slow = 0;

  console.log("\n  — \"don't call, don't message\" is a no —");
  nextReply = "Sare andi 🙏 Ika calls, messages pampamu — kavalante ikkade message cheyandi.";
  await say("9876500311", "Please kavalante nenne vasta ok astamanam cheya kandi call s msg");
  is(h.run(["SMEMBERS", "optout"]).includes("9876500311"), true, "they are opted out, as STOP would do");
  await say("9876500312", "Ippudu call cheyakandi, evening cheyandi");
  is(h.run(["SMEMBERS", "optout"]).includes("9876500312"), false, "\"not now, evening\" is not");

  console.log("\n  — a full slot is not their appointment —");
  const at = Date.now() + 5 * 3600000;
  for (const ph of ["9876500391", "9876500392"]) h.run(["LPUSH", "appt:q", JSON.stringify({ ph, name: "X", at, ts: Date.now() })]);
  asked.length = 0;
  await say("9876500313", "Hi");
  const ctx = asked[0] || "";
  is([/filled by OTHER patients/.test(ctx), /NOT this patient's appointment/.test(ctx), /This patient has NO appointment booked/.test(ctx)], [true, true, true], "the agent is told whose slots are full, and that this patient has none");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe conversation is tidy");
  process.exit(fails ? 1 : 0);
})();
