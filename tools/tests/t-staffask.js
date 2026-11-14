// "Staff" gets a person, not a lock.
//
// Every first reply says "staff tho matladali ante *staff* ani type cheyandi".
// From 5 to 14 November eight patients did exactly that and were told
// "🔒 Ee command owner number nunchi matrame pani chestundi", and nobody at
// the clinic heard about any of them. The messages below are the ones they
// sent.
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
process.env.LEAD_NOTIFY_PHONES = "9000000001";

const SA = h.load("_staffask");

(async () => {
  console.log("STAFF, PLEASE\n");

  console.log("  — what counts as asking for a person —");
  for (const t of ["Staff", "staff", "Staff tho matladali", "staff please", "Human", "I want to talk to a person", "Staff?"])
    is(SA.isAsk(t), true, `"${t}"`);
  for (const t of ["Staff vecancy", "staff vacancy undha", "Mee staff chala manchiga matladaru, thank you so much for everything", "Hair fall", "Someone told me about your clinic"])
    is(SA.isAsk(t), false, `not "${t}"`);

  console.log("\n  — clinic hours, Eluru time —");
  is(SA.openNow(Date.parse("2026-11-14T10:00:00+05:30")), true, "Saturday 10 AM — open");
  is(SA.openNow(Date.parse("2026-11-14T00:44:00+05:30")), false, "12:44 AM — closed");
  is(SA.openNow(Date.parse("2026-11-15T11:00:00+05:30")), false, "Sunday — closed");
  is(SA.openNow(Date.parse("2026-11-13T20:59:00+05:30")), true, "8:59 PM — still open");
  is(/close/.test(SA.reply(false)) && /9 AM/.test(SA.reply(false)), true, "at night they are told when somebody will call");

  console.log("\n  — through the real WhatsApp handler —");
  const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
  stub("_admin.js", { isAdmin: (d) => d === OWNER, handle: async () => null, fmtIst: () => "Sat 5 PM" });
  stub("_hr.js", { handle: async () => null });
  stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
  stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });
  const pushes = [];
  stub("_push.js", { enabled: () => true, notifyCap: async (cfg, cap, m) => { pushes.push(Object.assign({ cap }, m)); return { ok: true }; }, send: async () => ({ ok: true }) });
  let modelCalls = 0;
  const outs = [];
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      modelCalls++;
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ reply: "Chin area ki diode laser chestam andi.", lead: null }) }] }) };
    }
    if (u.includes("graph.facebook.com")) { const b = opt && opt.body ? JSON.parse(opt.body) : {}; if (b.text) outs.push(b.text.body); }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  const wa = h.load("whatsapp");
  let mid = 0;
  const say = (from, text) => new Promise((resolve) => {
    const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ code: this._c, body: o }); return this; }, send() { resolve({ code: this._c }); return this; }, end() { resolve({ code: this._c }); return this; } };
    wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: "Lakshmi" } }],
      messages: [{ id: "wamid.st" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
  });

  await say("9876500111", "Chin area hair removal cost entha");
  const before = h.sent.length, mc = modelCalls;
  outs.length = 0;
  await say("9876500111", "Staff");
  const last = outs[outs.length - 1] || "";
  is(/owner number/.test(last), false, "no \"owner number\" lock any more");
  is(/Owner numbers/.test(last), false, "and the owners' numbers are not printed to a stranger");
  is(/staff ki cheppanu/.test(last), true, "they are told the staff have been told: " + last.split("\n")[0]);
  is(modelCalls - mc, 0, "answered without a model call — it works even when the AI is down");
  is(pushes.length, 1, "the team's phones get one push");
  is(/Chin area hair removal cost entha/.test(pushes[0] && pushes[0].body), true, "with what they had asked before");
  const now = new Date();
  const openHere = SA.openNow(now.getTime());
  is(h.sent.length - before, openHere ? 1 : 0, openHere ? "and a WhatsApp to the lead phone (clinic is open)" : "and no WhatsApp at night (clinic is closed)");
  const thread = h.run(["LRANGE", "ib:m:9876500111", "0", "-1"]).map((x) => JSON.parse(x));
  is(thread.some((m) => m.dir === "out" && /staff ki cheppanu/.test(m.text)), true, "the reply is in the staff inbox");

  await say("9876500111", "Staff please");
  is(pushes.length, 1, "asking again a minute later does not ring everyone twice");

  await say("9876500111", "Chin ki entha time padutundi?");
  is(modelCalls - mc, 1, "and the agent goes on answering what they ask next");

  outs.length = 0;
  await say("9876500222", "Staff vecancy");
  is((outs[outs.length - 1] || "").includes("owner number"), false, "a job seeker writing \"Staff vecancy\" is not locked out either");
  is(pushes.length, 1, "and is not a staff call request");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\n\"staff\" reaches a person");
  process.exit(fails ? 1 : 0);
})();
