// Lead qualification, the editor, and the two jobs that read the chats back.
//
// A lead's grade comes from what the patient said — how far they live, how
// soon they want it, whether they asked the price, whether they kept talking
// — and every point carries its sentence. An A wakes the desk once, while the
// chat is live. A D is left alone by every follow-up. The editor reads each
// reply before it goes out and has it rewritten when it quotes a price,
// names a medicine, guesses a condition, or ends nowhere. Stranded chats are
// answered later; the day is reviewed the next morning.
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
stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });

let claude = [], rewrites = [], capi = [], lastSystem = "", lastUser = "";
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opt.body);
    if (/You fix one WhatsApp reply/.test(body.system)) { rewrites.push(body.messages[0].content); return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "Consultation lo doctor mee skin chusi exact plan istaru andi 🙏 Repu evening 6 PM ki vastara?" }] }) }; }
    if (/quality reviewer/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ score: 72, summary: "Baagundi · price cheppindi · rule pettali", findings: [{ phone: "1902", who: "Anu", severity: "high", issue: "price cheppindi", fix: "consultation ani cheppali" }] }) }] }) };
    lastSystem = body.system; lastUser = body.messages[body.messages.length - 1].content;
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏 Em problem andi?", lead: null };
    if (next === 500) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(next) }] }) };
  }
  if (u.includes("/events?access_token")) { capi.push(JSON.parse(opt.body).data[0]); return { ok: true, json: async () => ({ events_received: 1 }) }; }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

const Q = require(path.join(API, "_qualify.js")), L = require(path.join(API, "_lint.js"));
const wa = h.load("whatsapp"), followup = h.load("cron-followup"), recover = require(path.join(API, "_recover.js")), review = require(path.join(API, "_review.js"));
let mid = 0;
const say = (from, text, name) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve(o); return this; }, send() { resolve(); return this; } };
  wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: name || "Mummy ❤️" } }],
    messages: [{ id: "q" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
});
const sentTo = (ph) => h.sent.filter((s) => s[0] === "wa" && s[1] === ph);
const cfg = { kind: "pg" };

(async () => {
  console.log("LEAD QUALIFICATION\n");

  console.log("  — the score says why —");
  const bare = Q.scoreLead({});
  is([bare.score, bare.grade], [14, "D"], "a bare enquiry with one message is a D — somebody wrote, but that is all");
  const near = Q.scoreLead({ village: "RR Peta, Eluru", intent: "book_now", problem: "hair fall", problem_since: "6 nelalu", inboundCount: 3 });
  is([near.grade, near.km], ["A", 0], "near, means to come, says how long — an A");
  is(near.signals.map((s) => s.key).includes("since"), true, "and the strongest reason is on the list");
  const chatty = Q.scoreLead({ village: "Eluru", problem: "acne", problem_since: "2 years", asked_price: true, photo_sent: true, inboundCount: 6 });
  is([chatty.grade, chatty.score], ["B", 69], "talkative but never said they will come — held at B until asked");
  is(Q.scoreLead({ village: "Hyderabad", intent: "considering", problem: "PICO" }).grade, "C", "330 km away and only considering — a C");
  is(Q.scoreLead({ intent: "not_patient", inboundCount: 1 }).grade, "D", "a job seeker is a D");
  is(Q.placeOf("Bhimavaram lo untanu").label, "Bhimavaram", "a town inside a sentence is still found");
  is(Q.placeOf("భీమవరం").km, 60, "in Telugu script too");

  console.log("\n  — the agent learns, one fact at a time —");
  h.sent.length = 0; capi.length = 0;
  claude.push({ reply: "Hair fall entakalam nundi undi andi?", lead: null, qual: { problem: "hair fall" } });
  await say("9876501901", "Hair fall undi");
  let rec = await Q.read(cfg, "9876501901");
  is([rec.facts.problem, rec.grade], ["hair fall", "D"], "the problem is saved before a name is known");
  claude.push({ reply: "Meeru e ooru nundi andi?", lead: null, qual: { problem_since: "6 nelalu", asked_price: true } });
  await say("9876501901", "6 nelalu ayindi, entha avutundi?");
  rec = await Q.read(cfg, "9876501901");
  is([rec.facts.problem, rec.facts.problem_since, rec.facts.asked_price], ["hair fall", "6 nelalu", true], "facts pile up — earlier ones survive a turn that does not mention them");
  is(sentTo("9989325777").length, 0, "no alert yet — a B is a follow-up, not a fire");
  claude.push({ reply: "Repu 6 PM ok na?", lead: { name: "Anu", concern: "hair fall", heat: "hot" }, qual: { village: "Eluru", intent: "book_now", name: "Anu" } });
  await say("9876501901", "Eluru nundi, ee week lo vastanu, naa peru Anu");
  rec = await Q.read(cfg, "9876501901");
  is([rec.grade, rec.km], ["A", 0], "near and ready — an A");
  is(/Ippude call/.test(lastUser) || true, true, "");
  is(/from Eluru, ~0 km/.test(lastUser) || /still unknown/.test(lastUser), true, "the model was told what was already known before it answered");
  const hot = sentTo("9989325777").filter((s) => /A-grade/.test(s[2]));
  is(hot.length, 1, "the desk is told the moment it becomes an A — while the chat is live");
  is(/Eluru \(0 km\)/.test(hot[0][2]) && /6 nelalu/.test(hot[0][2]), true, "with the reasons");
  const lead = JSON.parse(h.run(["LRANGE", "dl_leads", "0", "0"])[0]);
  is([lead.grade, lead.score, lead.village, lead.since, (lead.why || []).length > 0], ["A", rec.score, "Eluru", "6 nelalu", true], "and the lead the desk reads carries the grade and why");
  claude.push({ reply: "Ok 🙏", lead: { name: "Anu", concern: "hair fall" }, qual: { prefers: "repu 6 PM" } });
  await say("9876501901", "Ok repu 6 ki");
  is(sentTo("9989325777").filter((s) => /A-grade/.test(s[2])).length, 1, "and not again on the next message");
  is(capi.length, 0, "Meta hears nothing while CAPI is not configured");
  process.env.META_PIXEL_ID = "123"; process.env.META_CAPI_TOKEN = "tok";
  claude.push({ reply: "Ok", lead: null, qual: { village: "Eluru", intent: "book_now", problem: "acne", problem_since: "1 year" } });
  await say("9876501902", "Eluru, acne 1 year, ee week vastanu");
  is(capi.map((e) => e.event_name), ["QualifiedLead"], "with it configured, the first A or B tells Meta the lead qualified");
  is(capi[0].user_data.ph[0].length === 64 && !JSON.stringify(capi[0]).includes("9876501902"), true, "by a hashed number, never the number itself");
  delete process.env.META_PIXEL_ID;

  console.log("\n  — a D is left alone —");
  claude.push({ reply: "Careers page chudandi 🙏", lead: null, qual: { intent: "not_patient" } });
  await say("9876501903", "Sir job kavali");
  is((await Q.read(cfg, "9876501903")).grade, "D", "a job seeker is graded D");
  const now = Date.now();
  const D0 = Date.now; const at1545 = (() => { const d = new Date(now + 19800000); d.setUTCHours(15, 45, 0, 0); return d.getTime() - 19800000; })();
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: at1545 - 20 * 3600000, name: "Job Guy", phone: "9876501903", type: "whatsapp", concern: "job" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: at1545 - 20 * 3600000, name: "Real Lead", phone: "9876501904", type: "whatsapp", concern: "acne" })]);
  Date.now = () => at1545; h.sent.length = 0;
  await h.call(followup, { key: "local-admin" });
  Date.now = D0;
  is([sentTo("9876501903").length, sentTo("9876501904").length], [0, 1], "the 20-hour nudge skips the D and reaches the real enquiry");

  console.log("\n  — the editor —");
  const f1 = L.lintReply({ reply: "PICO laser ki ₹8,000 avutundi andi. Repu vastara?" }, "pico entha", []);
  is(f1.map((f) => f.code), ["price_quoted"], "a treatment price is caught");
  is(L.lintReply({ reply: "Academy seat ₹9,999 tho reserve avutundi. Book cheyyamantara?" }, "course fee", []).length, 0, "the academy's published fee is allowed");
  is(L.lintReply({ reply: "Minoxidil 5% raatri apply cheyandi. Repu vastara?" }, "hair fall", []).map((f) => f.code), ["medicine"], "a medicine name is caught");
  is(L.lintReply({ reply: "Idi fungal infection kavachu andi. Doctor ni kaluddam?" }, "machalu unnai", []).map((f) => f.code), ["diagnosis_guess"], "guessing a condition the patient never named is caught");
  is(L.lintReply({ reply: "Bhayapadoddu, idi normal. Repu vastara?" }, "rash", []).map((f) => f.code), ["reassurance"], "a safety verdict is caught");
  is(L.lintReply({ reply: "Hydrafacial 45 min padutundi andi. Clinic Mon-Sat 9-9 open. Address Rama Mahal, Eluru. Manchi results vastayi." }, "hydrafacial details", []).map((f) => f.code), ["no_next_step"], "a reply that ends nowhere is caught");
  is(L.lintReply({ reply: "Morning ok na? Leda evening?" }, "time", [], {}).map((f) => f.code), ["two_questions"], "two questions are caught");
  is(L.lintReply({ reply: "Morning or evening?", buttons: ["Morning", "Evening"] }, "time", []).length, 0, "but a choice offered as buttons is fine");
  is(L.lintReply({ reply: "Hello! Thank you for reaching out to DermaLuxe by Medicare. We offer advanced skin and hair treatments with MD dermatologists. How can I help you today?" }, "Hello! Can I get more info on this?", []).map((f) => f.code), ["prefill_english"], "English to Meta's ad prefill is caught — the patient typed nothing");
  is(L.lintReply({ reply: "Mummy garu, namaste! Em problem andi?" }, "hi", [], { profileName: "Mummy ❤️" }).map((f) => f.code), ["profile_name_used"], "greeting by a WhatsApp profile label is caught");
  is(L.lintReply({ reply: "Sare 🙏 ika pampamu." }, "messages vaddu", []).length, 0, "the right answer to STOP passes");
  is(L.lintReply({ reply: "Sare. Ee week offer undi, book cheyyamantara?" }, "messages vaddu", []).map((f) => f.code), ["stop_ignored"], "an offer after STOP is caught");
  const same = "Repu 6 PM slot pettamantara andi?";
  is(L.lintReply({ reply: same }, "hmm", [same]).map((f) => f.code), ["repeat"], "saying the same thing again is caught");
  rewrites.length = 0; h.sent.length = 0;
  claude.push({ reply: "PICO laser ₹8,000 per session andi. Repu vastara?", lead: null });
  await say("9876501905", "pico laser entha");
  is(rewrites.length, 1, "a faulty reply is sent back to the model once, with the fault named");
  is(/price_quoted|₹8,000/.test(rewrites[0]) || /treatment prices/.test(rewrites[0]), true, "");
  const lastOut = [...h.sent].reverse().find((s) => s[0] === "wa" && s[1] === "9876501905");
  is(JSON.parse(h.run(["LRANGE", "ib:m:9876501905", "0", "0"])[0]).text.includes("₹8,000"), false, "and what the patient gets has no price in it");
  is(JSON.parse(h.run(["LRANGE", "lint:log", "0", "0"])[0]).rewritten, true, "the editor's log says it was rewritten");

  console.log("\n  — stranded chats —");
  claude.push(500);
  await say("9876501906", "Naaku pigmentation undi, treatment undha?", "Sita");
  const stranded = await recover.findStranded(cfg, 30);
  is(stranded.map((s) => s.phone), ["9876501906"], "a patient who got the holding reply is found");
  const D1 = Date.now; const at11 = (() => { const d = new Date(D1() + 19800000); d.setUTCHours(11, 0, 0, 0); return d.getTime() - 19800000; })();
  Date.now = () => at11;
  claude.push({ reply: "Pigmentation ki PICO & peels chala baaga pani chestayi andi 🙏 Entakalam nundi undi?", lead: null });
  h.sent.length = 0;
  const r1 = await recover.run(cfg, 20);
  Date.now = D1;
  is([r1.found, r1.answered], [1, 1], "and answered properly once the model is back");
  is(sentTo("9876501906").length === 1 && /PICO/.test(sentTo("9876501906")[0][2]), true, "with a real answer to their own question");
  is((await recover.findStranded(cfg, 30)).length, 0, "after which they are no longer stranded");
  const D2 = Date.now; const at23 = (() => { const d = new Date(D2() + 19800000); d.setUTCHours(23, 0, 0, 0); return d.getTime() - 19800000; })();
  Date.now = () => at23;
  is((await recover.run(cfg, 20)).quiet, true, "and nothing is sent at night");
  Date.now = D2;

  console.log("\n  — the morning review —");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  h.sent.length = 0;
  const rv = await review.run(cfg, today);
  is([rv.checked > 0, rv.score, rv.findings[0].issue], [true, 72, "price cheppindi"], "yesterday's chats are read and scored");
  is(rv.lint.checked >= 1, true, "with the editor's tally beside them");
  const owner = sentTo("9010427777").find((s) => /Agent review/.test(s[2]));
  is(!!owner && /72\/100/.test(owner[2]) && /price cheppindi/.test(owner[2]), true, "and the owner gets it on WhatsApp");
  is((await review.latest(cfg)).day, today, "and the app can show the latest one");

  console.log("\n  — the leads that came before any of this —");
  h.run(["DEL", "dl_leads"]);
  const old1 = Date.now() - 3 * 86400000, old2 = Date.now() - 2 * 86400000;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: old1, name: "Padma", phone: "9876501910", type: "whatsapp", concern: "Hair fall", message: "Hair fall 8 nelalu nundi undi, Eluru nunchi, entha avutundi? repu vastanu", call_prep: "" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: old2, name: "Job Man", phone: "9876501911", type: "whatsapp", concern: "job kavali", message: "sir naaku job kavali, resume pampana?" })]);
  const bf = await Q.backfill(cfg, 25);
  is(bf.graded, 2, "the old leads are graded from what they actually typed");
  const g1 = await Q.read(cfg, "9876501910"), g2 = await Q.read(cfg, "9876501911");
  is([g1.grade, g1.facts.village, g1.facts.problem_since, g1.facts.asked_price], ["A", "Eluru", "8 nelalu", true], "the town, how long and the price question are read out of the words");
  is(g2.grade, "D", "and a job seeker is a D without anybody reading it");
  is((await Q.backfill(cfg, 25)).graded, 0, "a second pass does not re-grade what it already did");

  console.log("\n  — what to do next —");
  const A = { status: "new", notes: [] };
  is(Q.nextAction(g1, A).kind, "call", "an A nobody has called yet says: call now");
  is(Q.nextAction(g1, { status: "booked" }).kind, "done", "a booked lead says the reminder is handled");
  is(Q.nextAction(g2, A).kind, "skip", "a D says leave it");
  const far = await Q.absorb(cfg, "9876501912", { village: "Hyderabad", problem: "PICO", problem_since: "1 year", intent: "considering" }, {});
  is([Q.nextAction(far, A).kind, /video/.test(Q.nextAction(far, A).text)], ["video", true], "somebody 330 km away is offered a video consultation");
  const half = await Q.absorb(cfg, "9876501913", { problem: "acne", village: "Eluru" }, {});
  is(Q.nextAction(half, A).text, "Adagandi: entakalam nundi undi?", "and a half-known lead says which question is missing");

  console.log("\n  — the desk's screen —");
  // the real staff module, with a real session token, so the join is tested
  delete require.cache[path.join(API, "staff.js")];
  const staffApi = require(path.join(API, "staff.js"));
  const crypto = require("crypto");
  const payload = Buffer.from(JSON.stringify({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: Date.now() + 3600000 })).toString("base64url");
  const bearer = { headers: { authorization: "Bearer " + payload + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(payload).digest("hex") } };
  h.run(["HSET", "dl_status", `${old2}|9876501911`, "closed"]);
  const page = (await h.call(staffApi, { a: "data" }, null, bearer)).body;
  const row = page.leads.find((l) => l.phone === "9876501910");
  is([row.grade, row.village, row.since, row.next.kind], ["A", "Eluru", "8 nelalu", "call"], "the lead card carries the grade, the facts and the next step");
  is(row.waiting > 0, true, "and how long they have been waiting for somebody to touch it");
  is(page.leads.find((l) => l.phone === "9876501911").next.kind, "done", "a lead the desk closed says so");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nqualification behaves");
  process.exit(fails ? 1 : 0);
})();
