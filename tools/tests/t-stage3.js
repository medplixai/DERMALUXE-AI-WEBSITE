// Stage 3 — the small things that decide whether somebody comes.
//
// A patient who would rather listen than read hears the reply; a greeting
// or a tapped slot is answered by the quick model, not the big one; a mother
// and daughter get one slot, not two bookings; the agent knows what to do
// with a second opinion and an EMI question; and how long every patient
// waited is on the weekly.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.ADMIN_PHONES = "9010427777";
process.env.WA_WEBHOOK_TOKEN = "hook"; process.env.WA_CLOUD_TOKEN = "cloud"; process.env.WA_PHONE_ID_ALLOWLIST = "111";
process.env.WA_AGENT_ENABLED = "1"; process.env.ANTHROPIC_API_KEY = "test"; process.env.LEAD_NOTIFY_PHONES = "9989325777";
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("_admin.js", { isAdmin: () => false, handle: async () => null, fmtIst: () => "" });
stub("_hr.js", { handle: async () => null });
stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
const realVoice = require(path.join(API, "_voice.js"));
let spoken = [];
stub("_voice.js", Object.assign({}, realVoice, { synthesize: async (script) => { spoken.push(script); return Buffer.from("mp3"); }, transcribe: async () => null }));

let claude = [], models = [], lastUser = "", cloudOut = [];
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opt.body);
    if (/You fix one WhatsApp reply/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: body.messages[0].content.split("\n")[1] || "ok" }] }) };
    models.push(body.model); lastUser = body.messages[body.messages.length - 1].content;
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏 Em problem andi?", lead: null };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(next) }] }) };
  }
  if (u.includes("graph.facebook.com") && u.endsWith("/media")) return { ok: true, status: 200, json: async () => ({ id: "med1" }) };
  if (u.includes("graph.facebook.com") && u.includes("/messages")) { cloudOut.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ messages: [{ id: "m" }] }) }; }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

const wa = h.load("whatsapp");
const weekly = require(path.join(API, "_weekly.js"));
const exam = require(path.join(API, "_exam.js"));
const facts = require(path.join(API, "_facts.js"));
const cfg = { kind: "pg" };
let mid = 0;
const say = (from, text, name) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve(o); return this; }, send() { resolve(); return this; } };
  wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: name || "Patient" } }],
    messages: [{ id: "s3" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
});
const audioTo = (ph) => cloudOut.filter((m) => m.to === "91" + ph && m.type === "audio");
const slotTs = () => { const d = new Date(Date.now() + 86400000 + 330 * 60000); return `${d.toISOString().slice(0, 10)} 18:30`; };

(async () => {
  console.log("STAGE 3 — THE SMALL THINGS\n");

  console.log("  — somebody who would rather listen —");
  const V = "9876505001";
  claude.push({ reply: "Subbamma garu 🙏 itching ki doctor chudali.\n\nRepu 11 AM ki vastara?\nVOICE_SCRIPT: Subbamma garu, itching ki doctor garu chudali. Repu padakondu gantalaki raagalara?", lead: null });
  await say(V, "chadavadam kashtam, voice lo cheppandi", "Subbamma");
  is(/VOICE note|VOICE_SCRIPT/.test(lastUser), true, "asking for voice makes the model write a spoken version");
  is([audioTo(V).length, spoken[0]], [1, "Subbamma garu, itching ki doctor garu chudali. Repu padakondu gantalaki raagalara?"], "and it goes out as a voice note, from the script, not the emoji text");
  is(cloudOut.some((m) => m.to === "91" + V && m.text && /VOICE_SCRIPT/.test(m.text.body)), false, "the script line never appears in the written reply");
  is(h.run(["GET", `wa:voice:${V}`]), "1", "the preference is remembered");
  claude.push({ reply: "Ok andi 🙏 repu 11 AM.\nVOICE_SCRIPT: Sare andi, repu padakondu gantalaki.", lead: null });
  await say(V, "sare");
  is(audioTo(V).length, 2, "so the next reply is spoken too, without being asked again");
  const T = "9876505002";
  claude.push({ reply: "Ok", lead: null, voice: true });
  await say(T, "naaku kallu sarigga kanapadavu, chinna letters chadavalenu", "Ramulamma");
  is([h.run(["GET", `wa:voice:${T}`]), audioTo(T).length], ["1", 1], "when the model notices it (voice:true), the same happens");

  console.log("\n  — the quick model for the small turns —");
  models.length = 0;
  await say("9876505003", "hi");
  await say("9876505003", "Repu 11:00 AM");
  await say("9876505003", "thanks 🙏");
  is(models, ["claude-sonnet-5", "claude-sonnet-5", "claude-sonnet-5"], "a greeting, a tapped slot and a thank-you go to the quick model");
  models.length = 0;
  await say("9876505003", "hair fall 6 nelala nundi, PRP entha avutundi?");
  await say("9876505003", "ok");
  is(models, ["claude-opus-5", "claude-sonnet-5"], "anything with substance goes to the full model; the 'ok' after it does not");
  const lat = h.run(["LRANGE", "wa:lat", "0", "-1"]).map((x) => JSON.parse(x));
  is([lat.length, lat.filter((x) => x.fast).length], [8, 4], "every reply's wait is logged, quick turns marked");
  is(/⏱ Agent reply time: .* s median \(8 replies · 4 quick turns/.test((await weekly.buildWeekly(cfg)).body), true, "and the weekly says how long patients waited");

  console.log("\n  — amma + koothuru, one slot —");
  const F = "9876505004";
  claude.push({ reply: "Sat 6:30 PM ki iddariki book chesanu ✅", lead: { name: "Nagamani", concern: "Pigmentation", slot: "Sat 6:30 PM", slot_ts: slotTs(), heat: "hot", family: [{ name: "Divya", concern: "acne" }] } });
  await say(F, "amma ki kuda, iddaram vastam Saturday", "Nagamani");
  const appt = h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).find((a) => a.ph === F);
  is([appt.pax, appt.with, /Divya \(acne\)/.test(appt.concern)], [2, "Divya", true], "one appointment, two people, both named — not two bookings");
  const leadRow = h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x)).find((l) => l.phone === F);
  is(/Pigmentation \+ Divya \(acne\)/.test(leadRow.concern), true, "and the lead card says who is coming with what");

  console.log("\n  — the agent knows the situations —");
  const sys = facts.clinicFacts("WhatsApp", "");
  is([/SECOND OPINION/.test(sys), /NEVER criticise the other doctor/.test(sys)], [true, true], "a second opinion: never against the other doctor, bring the reports");
  is([/PAYMENT & EMI/.test(sys), /Never invent a scheme/.test(sys)], [true, true], "EMI: no invented scheme");
  is([/FAMILY BOOKING/.test(sys), /VOICE:/.test(sys)], [true, true], "family bookings and voice are in the standing rules");
  is(["p41", "p42", "p43", "p44"].every((id) => exam.PERSONAS.some((p) => p.id === id)), true, "and the nightly exam has a persona for each of them");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nstage 3 behaves");
  process.exit(fails ? 1 : 0);
})();
