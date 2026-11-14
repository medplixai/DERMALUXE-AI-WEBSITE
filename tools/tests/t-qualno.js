// "Vaddu" means no — on every screen, in the call queue, and in the follow-ups.
//
// Owner, 14 Nov 2026: "not interested vaddu anna vallani kuda A grade lead lo
// chupistundi". That day 14 of 158 A-grade leads had written "Don't call",
// "Eppudu vadhu naku", "Avasaram ledu", "Stop" or "No thank you", and still
// sat at the top of the Leads screen marked "Ippude call cheyandi 🔥". The
// grade had no way to hear a no: there was no such intent, the desk's "not
// interested" never reached the grade, and STOP never re-scored it. The
// sentences below are the real ones (numbers are invented).
process.env.STAFF_SECRET = "local-test-secret";
process.env.STAFF_OWNERS = "9010427777";
process.env.ADMIN_PHONES = "9010427777";
process.env.WA_WEBHOOK_TOKEN = "hook"; process.env.WA_CLOUD_TOKEN = "cloud"; process.env.WA_PHONE_ID_ALLOWLIST = "111";
process.env.WA_AGENT_ENABLED = "1"; process.env.ANTHROPIC_API_KEY = "test";
const path = require("path"), crypto = require("crypto");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const cfg = { kind: "pg" };
const Q = h.load("_qualify");

(async () => {
  console.log("NO MEANS NO\n");

  console.log("  — what counts as no —");
  for (const t of ["Don't call", "Eppudu vadhu naku", "Sare vadhu le Naku kuda", "Vadhu", "Call cheyakandi e number ki", "Avasaram ledu", "No thank you", "Thank you but not interested", "No mam not interested money antha pettaleymu",
    "Noo thanks", "Naku mee services akkarledhu", "Sorry sir already 65 k tho bhimavaram lo package ga matladukoni advance ichesam madam"])
    is(Q.saysNo(t), true, `"${t}"`);
  for (const t of ["Ala vadhu andi mottam oka sari remove cheyyadam avvadha", "Location vaddu ani cheppaa", "E roju cancel cheyandi please e roju meeting", "Hair fall", "Repu vastanu",
    "Nenu repu ralenu", "Already book chesanu, time enti?", "No cancel"])
    is(Q.saysNo(t), false, `not "${t}"`);

  console.log("\n  — the grade hears it —");
  const keen = { problem: "hair fall", problem_since: "1 year", village: "Eluru", intent: "book_now", urgency: "this_week", asked_price: true, name: "Ravi" };
  const ph = "9876500401";
  const a = await Q.absorb(cfg, ph, keen, { inboundCount: 6, text: "Repu vastanu" });
  is(a.grade, "A", "near, keen, talking: an A");
  const no = await Q.absorb(cfg, ph, { intent: "book_now" }, { inboundCount: 7, text: "Call cheyakandi e number ki" });
  is([no.grade, no.facts.intent], ["D", "not_interested"], "\"Call cheyakandi\" makes it a D, even with the model still saying book_now");
  const ok = await Q.absorb(cfg, ph, { intent: "book_now" }, { inboundCount: 8, text: "Ok" });
  is(ok.grade, "D", "an \"Ok\" afterwards does not bring the old book_now back");
  const back = await Q.absorb(cfg, ph, { intent: "book_now" }, { inboundCount: 9, text: "Sorry, repu evening vastanu" });
  is(back.grade, "A", "their own \"vastanu\" does");
  is(Q.scoreLead(Object.assign({}, keen, { intent: "not_interested", status: "booked" })).grade !== "D", true, "and a booking after a no is not held against them");
  is(Q.scoreLead(Object.assign({}, keen, { intent: "not_interested", status: "visited" })).grade, "D", "a past patient who says \"vaddu\" to more sessions is a D — having visited once is not a yes");
  is(Q.scoreLead(Object.assign({}, keen, { opted_out: true })).grade, "D", "STOP is a D");
  is(Q.extract("Avasaram ledu").intent, "not_interested", "the words alone are read the same way (old leads, other channels)");

  console.log("\n  — the desk's \"not interested\" —");
  delete require.cache[path.join(API, "staff.js")];
  const staff = require(path.join(API, "staff.js"));
  const mk = (o) => { const p = Buffer.from(JSON.stringify(o)).toString("base64url"); return p + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(p).digest("hex"); };
  const OWNER = mk({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: Date.now() + 86400000 });
  const call = (q, body) => new Promise((r) => {
    const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { r({ code: this._c, body: o }); return this; }, end() { r({ code: this._c }); return this; } };
    staff({ method: body ? "POST" : "GET", headers: { authorization: "Bearer " + OWNER }, query: q || {}, body: body || {} }, res);
  });
  h.run(["DEL", "dl_leads"]);
  const ts = Date.now() - 3600000, ph2 = "9876500402";
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts, type: "whatsapp", name: "Kavya", phone: ph2, concern: "Acne" })]);
  await Q.absorb(cfg, ph2, keen, { inboundCount: 6, text: "Repu vastanu" });
  const key = `${ts}|${ph2}`;
  const card = async () => ((await call({ a: "data" })).body.leads || []).find((l) => l.key === key) || {};
  is((await card()).grade, "A", "before the call: an A on the Leads screen");
  await call({ a: "outcome" }, { a: "outcome", key, outcome: "notinterested" });
  is((await card()).grade, "D", "the desk marks \"Not interested\" → a D on the Leads screen");
  is((await Q.read(cfg, ph2)).grade, "D", "and in the record itself, so the follow-ups stop too");
  is(Q.cadenceOf((await Q.read(cfg, ph2)).grade).paid, false, "no paid reminder ladder for them");
  await call({ a: "status" }, { a: "status", key, status: "booked" });
  is((await Q.read(cfg, ph2)).grade, "A", "and if they ring back and book, the grade comes back up");

  console.log("\n  — the call queue —");
  h.run(["HSET", "staff:users", "9000000001", JSON.stringify({ name: "Reception", role: "reception" })]);
  h.run(["DEL", "dl_leads"]); h.run(["DEL", "lead:owner"]);
  const t3 = Date.now() - 1800000, t4 = Date.now() - 1700000;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: t3, type: "whatsapp", name: "Said no", phone: "9876500403", concern: "Acne" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: t4, type: "whatsapp", name: "Keen", phone: "9876500404", concern: "Acne" })]);
  await Q.absorb(cfg, "9876500403", keen, { inboundCount: 6, text: "Repu vastanu" });
  await Q.absorb(cfg, "9876500404", keen, { inboundCount: 6, text: "Repu vastanu" });
  h.run(["SADD", "optout", "9876500403"]);   // sent STOP before this code existed
  await h.load("_queue").assign(cfg, { max: 20 });
  const owners = h.run(["HGETALL", "lead:owner"]) || [];
  const dealt = Array.isArray(owners) ? owners.filter((x, i) => i % 2 === 0) : Object.keys(owners);
  is([dealt.includes(`${t4}|9876500404`), dealt.includes(`${t3}|9876500403`)], [true, false], "reception is dealt the keen one, not the one who sent STOP");

  console.log("\n  — STOP, through WhatsApp —");
  const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
  stub("_admin.js", { isAdmin: (d) => d === "9010427777", handle: async () => null, fmtIst: () => "" });
  stub("_hr.js", { handle: async () => null });
  stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
  stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });
  global.fetch = async (url) => {
    if (String(url).includes("api.anthropic.com")) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ reply: "Sare andi 🙏", lead: null, qual: { intent: "book_now" } }) }] }) };
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  const wa = h.load("whatsapp");
  let mid = 0;
  const say = (from, text) => new Promise((resolve) => {
    const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ code: this._c, body: o }); return this; }, send() { resolve({}); return this; }, end() { resolve({}); return this; } };
    wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: "P" } }],
      messages: [{ id: "wamid.qn" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
  });
  await Q.absorb(cfg, "9876500405", keen, { inboundCount: 6, text: "Repu vastanu" });
  await say("9876500405", "Stop");
  is((await Q.read(cfg, "9876500405")).grade, "D", "STOP takes them off the A list at once");
  await Q.absorb(cfg, "9876500406", keen, { inboundCount: 6, text: "Repu vastanu" });
  await say("9876500406", "Eppudu vadhu naku");
  is((await Q.read(cfg, "9876500406")).grade, "D", "\"Eppudu vadhu naku\" in a live chat makes a D, whatever the model says");

  console.log("\n  — the ones graded before this —");
  h.run(["DEL", "dl_leads"]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 86400000, type: "whatsapp", name: "Old", phone: "9876500407", concern: "Acne" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 86400000, type: "whatsapp", name: "Came back", phone: "9876500408", concern: "Acne" })]);
  for (const p of ["9876500407", "9876500408"]) h.run(["SET", `qual:${p}`, JSON.stringify(Object.assign(Q.scoreLead(keen), { facts: keen }))]);
  const ib = h.load("_inbox");
  await ib.log(cfg, "9876500407", { dir: "in", text: "Hair fall undi" });
  await ib.log(cfg, "9876500407", { dir: "in", text: "Vaddu le" });
  await ib.log(cfg, "9876500408", { dir: "in", text: "Ippudu vaddu" });
  await ib.log(cfg, "9876500408", { dir: "in", text: "Monday vastanu" });
  // A real case from the first version: "Avasaram ledu" to a facial at 9:12,
  // then the Academy, a slot at 12:30 and "Pay chesanu" — lowered by mistake.
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 86400000, type: "whatsapp", name: "Student", phone: "9876500411", concern: "Academy" })]);
  h.run(["SET", "qual:9876500411", JSON.stringify(Object.assign(Q.scoreLead(Object.assign({}, keen, { intent: "not_interested" })), { facts: Object.assign({}, keen, { intent: "not_interested" }), inbound: 9 }))]);
  h.run(["SET", "qual:rs1:9876500411", "1"]);   // version 1 did it
  for (const t of ["Hydrafacial", "Avasaram ledu", "Academy", "Ivala 12:30 PM", "Yes", "Pay chesanu", "Both parts are interested"]) await ib.log(cfg, "9876500411", { dir: "in", text: t });
  // and one whose chat really did end on a no, a message later
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 86400000, type: "whatsapp", name: "Ended no", phone: "9876500412", concern: "Acne" })]);
  h.run(["SET", "qual:9876500412", JSON.stringify(Object.assign(Q.scoreLead(keen), { facts: keen }))]);
  for (const t of ["Hair fall undi", "Avasaram ledu", "Ok"]) await ib.log(cfg, "9876500412", { dir: "in", text: t });
  const rs = await Q.rescan(cfg, 10);
  is([(await Q.read(cfg, "9876500407")).grade, (await Q.read(cfg, "9876500408")).grade], ["D", "A"], "an old A whose last word was \"Vaddu le\" is lowered; one who said yes after is not");
  is((await Q.read(cfg, "9876500412")).grade, "D", "\"Avasaram ledu\" then \"Ok\" — the chat ended on no");
  is([(await Q.read(cfg, "9876500411")).facts.intent, (await Q.read(cfg, "9876500411")).grade !== "D"], [undefined, true], "the student lowered by the first version is put back — her chat did not end on no");
  is([rs.lowered, rs.restored], [2, 1], "two lowered, one put back");
  is((await Q.rescan(cfg, 10)).looked, 0, "and nobody is read twice");

  console.log("\n  — an A is somebody who said when —");
  h.run(["DEL", "dl_leads"]);
  const vague = { problem: "acne", problem_since: "1 year", village: "Eluru", intent: "book_now", asked_price: true, name: "Sita" };
  const whenSaid = Object.assign({}, vague, { prefers: "Monday evening" });
  for (const [p, f] of [["9876500409", vague], ["9876500410", whenSaid]]) {
    h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 7200000, type: "whatsapp", name: f.name, phone: p, concern: "Acne" })]);
    // graded under the old bar, which let any intent through
    h.run(["SET", `qual:${p}`, JSON.stringify({ facts: f, score: 95, grade: "A", inbound: 6, signals: [] })]);
  }
  const rf = await Q.refresh(cfg);
  is([(await Q.read(cfg, "9876500409")).grade, (await Q.read(cfg, "9876500410")).grade], ["B", "A"], "the stored As are re-graded: no day said → B, a day said → stays A");
  is(rf.changed >= 1, true, "written only where it moved");
  is((await Q.refresh(cfg)).changed, 0, "and a second pass changes nothing");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nno means no");
  process.exit(fails ? 1 : 0);
})();
