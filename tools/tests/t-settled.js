// Three things seen in the chats of 26-27 Nov 2026 (owner: "cheyyi"):
//  1. A photo and "Skin brightening and pores" sent together got two
//     replies — the second, the photo's, asking "mee problem cheppandi".
//  2. A patient who said "I'll come today" six times was asked "raagalara?"
//     six times, and two answers went out for "Ok" + "I'll come today".
//  3. A slot booked the day before as "repu 11 AM" was still called "repu"
//     on the morning it fell on.
// Runs the real whatsapp.js with Meta and the model stubbed.
process.env.WA_MERGE_MS = "80";
process.env.WA_PHOTO_WAIT_MS = "1500";
process.env.WA_PHOTO_STEP_MS = "30";
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.ADMIN_PHONES = "9010427777";
process.env.WA_WEBHOOK_TOKEN = "hook";
process.env.WA_CLOUD_TOKEN = "cloud";
process.env.WA_PHONE_ID_ALLOWLIST = "111";
process.env.WA_AGENT_ENABLED = "1";
process.env.ANTHROPIC_API_KEY = "test";

(async () => {
  const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
  stub("_admin.js", { isAdmin: () => false, handle: async () => null, fmtIst: () => "Sat 5 PM" });
  stub("_hr.js", { handle: async () => null });
  stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
  stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });
  stub("_push.js", { enabled: () => false, notifyCap: async () => ({ ok: true }), send: async () => ({ ok: true }) });
  const asked = [];
  let slowVision = 0;
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      const body = String((opt && opt.body) || "");
      if (/You fix one WhatsApp reply/.test(body)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) };
      asked.push(body);
      if (/"image"/.test(body) && slowVision) await new Promise((r) => setTimeout(r, slowVision));
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ reply: "Sare andi 🙏", lead: null }) }] }) };
    }
    if (u.includes("graph.facebook.com/v21.0/img")) return { ok: true, status: 200, json: async () => ({ url: "https://lookaside.example/img", mime_type: "image/jpeg", file_size: 10 }) };
    if (u.includes("lookaside.example")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  const wa = h.load("whatsapp");
  let mid = 0;
  const post = (from, msg) => new Promise((resolve) => {
    const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ code: this._c, body: o }); return this; }, send() { resolve({ code: this._c }); return this; }, end() { resolve({ code: this._c }); return this; } };
    wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: "Lakshmi" } }],
      messages: [Object.assign({ id: "wamid.st" + (++mid), from: "91" + from }, msg)] } }] }] } }, res);
  });
  const say = (from, text) => post(from, { type: "text", text: { body: text } });
  const photo = (from) => post(from, { type: "image", image: { id: "img" + mid } });
  const outs = (ph) => h.run(["LRANGE", `ib:m:${ph}`, "0", "-1"]).map((x) => JSON.parse(x)).filter((m) => m.dir === "out");
  const lastUser = (b) => { try { const m = JSON.parse(b).messages.slice(-1)[0]; return typeof m.content === "string" ? m.content : JSON.stringify(m.content); } catch (e) { return ""; } };

  console.log("  — a photo and words together —");
  asked.length = 0; slowVision = 200;
  const a = photo("9876500401");
  await new Promise((r) => setTimeout(r, 20));
  const b = say("9876500401", "Skin brightening and pores");
  const [ra, rb] = await Promise.all([a, b]);
  is(outs("9876500401").length, 1, "one reply, not two");
  is(!!(rb.body && rb.body.withPhoto), true, "the words stay quiet");
  is(asked.length === 1 && /Skin brightening and pores/.test(lastUser(asked[0])), true, "and the photo's answer reads them");

  asked.length = 0;
  const c = say("9876500402", "Pimples on cheeks");
  await new Promise((r) => setTimeout(r, 20));
  const d = photo("9876500402");
  await Promise.all([c, d]);
  is(outs("9876500402").length, 1, "words first, then the photo: still one reply");
  is(/Pimples on cheeks/.test(lastUser(asked[asked.length - 1])), true, "which knows what they wrote");

  asked.length = 0; slowVision = 0;
  await photo("9876500403");
  await new Promise((r) => setTimeout(r, 200));
  await say("9876500403", "Repu ravacha?");
  is(outs("9876500403").length, 2, "words after the photo was already answered get their own reply, as before");

  console.log("\n  — when it is settled —");
  const src = require("fs").readFileSync(path.join(API, "whatsapp.js"), "utf8");
  is(/WHEN IT IS SETTLED, STOP ASKING/.test(src) && /ask NOTHING more/.test(src), true, "the agent is told: once the time is fixed, an \"ok\" gets one warm line and no question");
  is(/believe them: offer once to cancel it/.test(src), true, "and \"repu avasaram ledu\" is believed, not argued with");
  const drops = (src.match(/await overtaken\(cfg, digits, loggedAt\)/g) || []).length;
  is(drops, 2, "a reply is checked for a newer message twice: after writing it and again just before it goes");

  console.log("\n  — today is today —");
  const now = Date.now();
  const IST = 330 * 60000;
  const dayStart = Math.floor((now + IST) / 86400000) * 86400000 - IST;
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500404", at: Math.min(dayStart + 86400000 - 60000, now + 5 * 60000), name: "Lakshmi" })]);
  asked.length = 0;
  await say("9876500404", "Reschedule chesthara");
  is(/upcoming appointment: [^\]]*TODAY \(ivala\)/.test(asked[0] || ""), true, "a slot later today is marked TODAY beside the patient's appointment");
  h.run(["DEL", "appt:q"]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500405", at: dayStart + 86400000 + 11 * 3600000, name: "Lakshmi" })]);
  asked.length = 0;
  await say("9876500405", "Reschedule chesthara");
  is(/upcoming appointment: [^\]]*TOMORROW \(repu\)/.test(asked[0] || ""), true, "and one tomorrow is marked TOMORROW");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nsettled chats stay settled");
  process.exit(fails ? 1 : 0);
})();
