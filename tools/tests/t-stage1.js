// Stage 1 — the engines that bring patients in, not just answer them.
//
// A patient the clinic has treated is greeted as one, with their last visit
// and the sitting that is due. Somebody who tapped an ad is not asked what
// their concern is. Somebody who hesitates is shown the doctor, the rating
// and real results — once. A slot is locked the moment the advance is paid,
// without anyone reading a "PAID" reply. Meta is told who booked and who
// paid. Half an hour after a missed slot the patient is asked, not the desk.
// The weekly report says where the patients came from and what each cost.
// And every night the agent sits an exam on invented patients, so a bad
// prompt is caught before a real one meets it.
const path = require("path");
const crypto = require("crypto");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.ADMIN_PHONES = "9010427777";
process.env.WA_WEBHOOK_TOKEN = "hook"; process.env.WA_CLOUD_TOKEN = "cloud"; process.env.WA_PHONE_ID_ALLOWLIST = "111";
process.env.WA_AGENT_ENABLED = "1"; process.env.ANTHROPIC_API_KEY = "test"; process.env.LEAD_NOTIFY_PHONES = "9989325777";
process.env.META_PIXEL_ID = "px1"; process.env.META_CAPI_TOKEN = "capi";
process.env.RAZORPAY_KEY_ID = "rzp_test"; process.env.RAZORPAY_KEY_SECRET = "s3"; process.env.RAZORPAY_WEBHOOK_SECRET = "wh";
process.env.ADVANCE_AMOUNT = "200";
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("_admin.js", { isAdmin: () => false, handle: async () => null, fmtIst: (ts) => new Date(ts).toISOString().slice(0, 16) });
stub("_hr.js", { handle: async () => null });
stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });

let claude = [], lastUser = "", capi = [], rzp = [], cloudOut = [], patientLines = [], judgeCalls = 0;
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opt.body);
    if (/You fix one WhatsApp reply/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: body.messages[0].content.split("\n")[1] || "ok" }] }) };
    if (/haiku/.test(body.model)) { const next = patientLines.length ? patientLines.shift() : "[END]"; return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: next }] }) }; }
    if (/grade ONE simulated/.test(body.system)) {
      judgeCalls++;
      const booked = /slot_ts/.test(body.messages[0].content);
      // The last message is the prefilled "{", so the model answers with the
      // REST of the object — exactly how the real one is asked now.
      const verdict = JSON.stringify({ score: booked ? 88 : 40, booked, trap_passed: booked, facts: {}, faults: booked ? [] : ["no_next_step"], note: booked ? "baaga close chesindi" : "slot adagaledu" });
      const prefilled = body.messages[body.messages.length - 1].role === "assistant";
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: prefilled ? verdict.slice(1) : verdict }], stop_reason: "end_turn" }) };
    }
    lastUser = body.messages[body.messages.length - 1].content;
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏 Em problem andi?", lead: null };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(next) }] }) };
  }
  if (u.includes("/events?access_token")) { capi.push(JSON.parse(opt.body).data[0]); return { ok: true, json: async () => ({ events_received: 1 }) }; }
  if (u.includes("api.razorpay.com/v1/payment_links")) { const b = JSON.parse(opt.body); rzp.push(b); return { ok: true, json: async () => ({ id: "plink_" + rzp.length, short_url: "https://rzp.io/l/adv" + rzp.length }) }; }
  if (u.includes("graph.facebook.com") && u.includes("/messages")) { cloudOut.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ messages: [{ id: "m" }] }) }; }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

const Q = require(path.join(API, "_qualify.js"));
const memory = require(path.join(API, "_memory.js"));
const trust = require(path.join(API, "_trust.js"));
const exam = require(path.join(API, "_exam.js"));
const weekly = require(path.join(API, "_weekly.js"));
const wa = h.load("whatsapp"), payHook = h.load("pay-hook"), post = h.load("cron-post"), money = h.load("money"), cronExam = h.load("cron-exam");
const cfg = { kind: "pg" };
const DAY = 86400000, MIN = 60000;
let mid = 0;
const hook = (from, text, extra, name) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve(o); return this; }, send() { resolve(); return this; } };
  wa({ method: "POST", headers: { host: "www.dermaluxe.ai" }, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: name || "Patient" } }],
    messages: [Object.assign({ id: "s1" + (++mid), from: "91" + from, type: "text", text: { body: text } }, extra || {})] } }] }] } }, res);
});
const textsTo = (ph) => cloudOut.filter((m) => m.to === "91" + ph && m.text).map((m) => m.text.body);
const sentTo = (ph, kind) => h.sent.filter((s) => s[0] === kind && s[1] === ph);
const slotTs = (daysAhead) => { const d = new Date(Date.now() + daysAhead * DAY + 330 * MIN); return `${d.toISOString().slice(0, 10)} 18:30`; };

(async () => {
  console.log("STAGE 1 — BRINGING PATIENTS IN\n");

  console.log("  — a patient we have treated is not a stranger —");
  const BH = "9876503001";
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: BH, name: "Bhavani", at: Date.now() - 40 * DAY, concern: "PRP hair therapy", status: "done", staffName: "Dr. Nikhitha" })]);
  h.run(["SET", "pkg:p1", JSON.stringify({ id: "p1", phone: BH, treatment: "PRP hair therapy", total: 6, gapDays: 28, ts: Date.now() - 70 * DAY, sessions: [{ at: Date.now() - 70 * DAY }, { at: Date.now() - 40 * DAY }] })]);
  h.run(["LPUSH", `pkg:of:${BH}`, "p1"]);
  h.run(["LPUSH", "rv:log", JSON.stringify({ ts: Date.now() - 39 * DAY, ph: BH, rating: 5 })]);
  const f = await memory.facts(cfg, BH);
  is([f.name, f.came, f.packages[0].done, f.packages[0].total, f.lastRating], ["Bhavani", 1, 2, 6, 5], "the file says who they are, that they came, which sitting they are on, how they rated us");
  const line = memory.line(f);
  is([/KNOWN PATIENT — name Bhavani/.test(line), /last visit .* for PRP hair therapy with Dr\. Nikhitha/.test(line), /2\/6 sittings done, due since .*OVERDUE/.test(line), /rated us 5★/.test(line)], [true, true, true, true], "and the agent is handed one line with all of it");
  is(/[Aa]llerg|₹|baaki|owe/.test(line), false, "nothing about money or allergies goes into a chat");
  is(await memory.contextLine(cfg, "9876503999"), "", "a number we have never seen gets nothing");
  await hook(BH, "Hi, next sitting eppudu?", null, "Bhavani");
  is(/\[KNOWN PATIENT — name Bhavani/.test(lastUser), true, "when she writes, the model is told before it answers");
  is((await Q.read(cfg, BH)).status, "visited", "and she is graded as somebody who has been here, not a cold enquiry");
  h.run(["LPUSH", `pkg:of:${BH}`, "p1"]);   // (a second reference is harmless)
  is(h.run(["GET", `wa:mem:${BH}`]) !== null, true, "the line is cached for the conversation");
  await memory.forget(cfg, BH);
  is(h.run(["GET", `wa:mem:${BH}`]), null, "and dropped after a visit, a sitting or a bill");

  console.log("\n  — somebody who tapped our ad —");
  const AD = "9876503002";
  await hook(AD, "Hello! Can I get more info on this?", { referral: { source_type: "ad", source_id: "ad77", headline: "Hair fall? PRP therapy at DermaLuxe" } });
  is((await Q.read(cfg, AD)).facts.problem, "hair fall", "the ad's headline already says the concern — it is on the record before the first reply");
  is([/\[AD LEAD — concern from the ad: hair fall/.test(lastUser), /own the concern "hair fall"/.test(lastUser)], [true, true], "and the model is told not to ask what the concern is");
  is(/reply in Tenglish and ask what concern they have\]/.test(lastUser), false, "the old 'ask what concern' instruction is gone for ad leads");
  claude.push({ reply: "Ok andi, entakalam nundi?", lead: null, qual: { problem: "hair fall" } });
  await hook(AD, "6 nelala nundi");
  claude.push({ reply: "Ok", lead: null });
  await hook(AD, "Eluru");
  claude.push({ reply: "Ok", lead: null });
  await hook(AD, "repu");
  is(/\[AD LEAD/.test(lastUser), false, "after the opening replies the push for a slot stops being repeated");

  console.log("\n  — the moment they hesitate —");
  const HS = "9876503003";
  h.run(["SET", "gplace:reviews:v1", JSON.stringify({ rating: 4.9, count: 132, mapsUrl: "https://maps.google.com/?cid=1" })]);
  h.sent.length = 0;
  claude.push({ reply: "Doctor garu MD DVL andi 🙏 Eppudu convenient?", lead: null, trust: true, qual: { problem: "acne scars" } });
  await hook(HS, "Doctor evaru andi? results nijam ga vastaya?");
  is(sentTo(HS, "img").length, 1, "the doctor's photo goes out with her degrees");
  is(/Dr\. Nikhitha Priyanka.*MD \(DVL\)/s.test(sentTo(HS, "img")[0][3]), true, "in the caption");
  const pack = sentTo(HS, "btn")[0];
  is([/4\.9.*132 reviews/.test(pack[2]), /Consultation lo em jarugutundi/.test(pack[2]), pack[3].length], [true, true, 3], "then the Google rating, what a consultation is, and three ways to say yes");
  h.sent.length = 0;
  claude.push({ reply: "Ok", lead: null, trust: true });
  await hook(HS, "safe na?");
  is(sentTo(HS, "img").length + sentTo(HS, "btn").length, 0, "the same person does not get the pack again this week");
  is(trust.hesitant("alochistanu, tarvata cheptanu"), true, "and 'I will think about it' counts as hesitation even when the model misses it");
  is(trust.hesitant("repu 6 PM ok"), false, "picking a time does not");

  console.log("\n  — a slot fixed —");
  const BK = "9876503004";
  cloudOut.length = 0; capi.length = 0; rzp.length = 0;
  claude.push({ reply: "Repu 6:30 PM book chesanu andi ✅", lead: { name: "Kiran", concern: "Hair fall", slot: "Repu 6:30 PM", slot_ts: slotTs(1), heat: "hot" } });
  await hook(BK, "Repu 6:30 PM ok");
  is(capi.map((e) => e.event_name), ["Schedule"], "Meta is told a slot was fixed");
  is([capi[0].user_data.ph[0].length, /9876503004/.test(JSON.stringify(capi[0]))], [64, false], "by a hashed phone — the number itself never leaves");
  const ttb = JSON.parse(h.run(["LRANGE", "ttb:log", "0", "0"])[0]);
  is([ttb.turns, ttb.ad], [1, false], "and how many replies the booking took is on the record, ad or organic");
  is(rzp.length, 1, "a Razorpay link for the advance is created");
  is([rzp[0].amount, rzp[0].notes.kind, /^9876503004\|\d+$/.test(rzp[0].notes.appt)], [20000, "advance", true], "for ₹200, tied to this phone and this slot");
  is(textsTo(BK).some((t) => /rzp\.io\/l\/adv1/.test(t) && /automatic ga CONFIRM/.test(t)), true, "the patient gets the link, and is told paying confirms the slot by itself");
  is(textsTo(BK).some((t) => /PAID ani reply/.test(t)), false, "nobody is asked to type PAID any more");
  const at = Number(rzp[0].notes.appt.split("|")[1]);
  const raw = JSON.stringify({ event: "payment_link.paid", payload: { payment: { entity: { id: "pay_1", amount: 20000, notes: { appt: `${BK}|${at}`, kind: "advance" } } }, payment_link: { entity: { notes: { appt: `${BK}|${at}`, kind: "advance" } } } } });
  const sig = (body) => crypto.createHmac("sha256", "wh").update(body).digest("hex");
  h.sent.length = 0;
  is((await h.call(payHook, {}, {}, { rawBody: raw, headers: { "x-razorpay-signature": "forged" } })).code, 401, "Razorpay's word is checked against its signature");
  const paid = await h.call(payHook, {}, {}, { rawBody: raw, headers: { "x-razorpay-signature": sig(raw) } });
  is([paid.code, paid.body.advance, paid.body.locked], [200, 200, true], "paid → the appointment is found and locked");
  const appt = h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).find((a) => a.ph === BK);
  is([appt.adv, appt.cf], [200, 1], "it now carries the advance and counts as confirmed");
  is(sentTo(BK, "wa").some((s) => /₹200 advance vachindi/.test(s[2]) && /CONFIRMED & locked/.test(s[2])), true, "and the patient is told, by name and time");
  is((await h.call(payHook, {}, {}, { rawBody: raw, headers: { "x-razorpay-signature": sig(raw) } })).body.dup, true, "Razorpay retrying the webhook does not lock it twice");
  is(JSON.parse(h.run(["LRANGE", `adv:${BK}`, "0", "0"])[0]).amount, 200, "the money is kept against the phone for the visit bill");

  console.log("\n  — half an hour after the slot —");
  const LT = "9876503005";
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: LT, name: "Sunitha Rao", at: Date.now() - 35 * MIN, concern: "Acne" })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876503006", name: "Early", at: Date.now() - 10 * MIN, concern: "Acne" })]);
  h.sent.length = 0;
  const p1 = await h.call(post, { key: "local-admin" });
  is(p1.body.lateAsked, 1, "the patient who has not turned up is asked — the one ten minutes late is not, yet");
  const ask = sentTo(LT, "btn")[0];
  is([/Sunitha garu/.test(ask[2]), /vastunnara/.test(ask[2]), ask[3]], [true, true, ["✅ Vastunnanu", "⏰ Late avutundi", "📅 Reschedule"]], "by first name, with the three answers that matter");
  h.sent.length = 0;
  is((await h.call(post, { key: "local-admin" })).body.lateAsked, 0, "and only once");
  is(h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x)).find((a) => a.ph === LT).lc, 1, "the record remembers it was asked, so the desk's list can show it");

  console.log("\n  — a bill is the visit Meta should learn from —");
  h.as(["money.bill", "money.view"], { name: "Sowmya", phone: "9876500901", role: "reception" });
  capi.length = 0;
  h.run(["SET", `wa:mem:${BK}`, "stale"]);
  const bill = await h.call(money, { a: "bill" }, { a: "bill", phone: BK, name: "Kiran", items: [{ name: "PRP", price: 6000 }] });
  is(bill.code, 200, "a bill is raised");
  is([bill.body.bill.payments.some((p) => p.advance && p.amount === 200), bill.body.bill.balance], [true, 5800], "the ₹200 advance paid on WhatsApp is already on it — balance ₹5,800");
  is(JSON.parse(h.run(["LRANGE", `adv:${BK}`, "0", "0"])[0]).used, 1, "and cannot be credited a second time");
  is([capi[0] && capi[0].event_name, capi[0] && capi[0].custom_data.value, capi[0] && capi[0].custom_data.currency], ["Purchase", 6000, "INR"], "and Meta hears a Purchase with the amount");
  is(h.run(["GET", `wa:mem:${BK}`]), null, "the agent's memory of this person is refreshed after it");

  console.log("\n  — the weekly scoreboard —");
  h.run(["RPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - DAY, type: "whatsapp", phone: AD, name: "Ad lead", concern: "Hair fall", ad_id: "ad77" })]);
  h.run(["RPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - DAY, type: "instagram", phone: "9876503010", name: "IG", concern: "Acne" })]);
  h.run(["RPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - DAY, type: "web", phone: "9876503011", name: "Web", concern: "PRP", slot: "Sat", date: "2026-09-26" })]);
  const wk = await weekly.buildWeekly(cfg);
  is(/🏁 \*Scoreboard/.test(wk.body), true, "the Monday report opens a scoreboard");
  is([/Meta ads: 1 · /.test(wk.body), /Instagram: 1 · /.test(wk.body), /Website: 1 · /.test(wk.body)], [true, true, true], "per source: enquiries · A · booked · came");
  is(/Booking ki replies: organic 1 \(median, target 3\)/.test(wk.body), true, "how many replies a booking took");
  is(/💳 Advance pay chesina slots: 1\//.test(wk.body), true, "how many slots were locked with an advance");
  is(/🤝 Trust pack .*: 1 mandiki → 0 book chesaru/.test(wk.body), true, "and whether the trust pack turned into bookings");

  console.log("\n  — the nightly exam —");
  is(exam.PERSONAS.length >= 40, true, "forty-odd invented patients, each with a trap");
  is(new Set(exam.PERSONAS.map((p) => p.id)).size, exam.PERSONAS.length, "with distinct ids");
  const a = exam.tonight("2026-09-20", 12).map((p) => p.id), b = exam.tonight("2026-09-21", 12).map((p) => p.id);
  is([a.length, a.some((id) => b.includes(id))], [12, false], "twelve a night, and tomorrow's twelve are different ones");
  patientLines = ["Hair fall chala undi, 6 nelala nundi", "Eluru nundi", "Repu evening ok", "[END]"];
  claude = [{ reply: "Entakalam nundi andi?", lead: null }, { reply: "E ooru?", lead: null }, { reply: "Repu 6:30 PM book chesanu ✅", lead: { name: "Lakshmi", concern: "Hair fall", slot_ts: slotTs(1) } }];
  h.run(["DEL", "lint:log"]);
  const ex = await exam.run(cfg, { ids: ["p01"], turns: 6 });
  is([ex.n, ex.rows[0].turns, ex.rows[0].booked, ex.score], [1, 3, true, 88], "a persona talks to the real agent until it is done, and the chat is judged");
  is(h.run(["LLEN", "lint:log"]), 0, "exam chats are not written into the day's editor record");
  is(h.run(["GET", "exam:latest"]), null, "a spot check of one persona does not overwrite the day's card");
  patientLines = ["Hair fall undi", "[END]", "Hair fall undi", "[END]", "Hair fall undi", "[END]", "Hair fall undi", "[END]"];
  claude = [];
  const night = await exam.run(cfg, { n: 4, turns: 2, width: 1 });   // one at a time, so the stubbed patient's lines land in order
  is([night.n >= 3, JSON.parse(h.run(["GET", "exam:latest"])).n], [true, night.n], "a real sitting is kept for the Inbox card");
  // A verdict the judge mangles must not be scored as a zero — that is how a
  // morning's exam came out at 5/100 with "🔴 Suresh 0 —" under it.
  const realFetch2 = global.fetch;
  global.fetch = async (u, o) => {
    const b2 = o && o.body ? JSON.parse(o.body) : {};
    if (String(u).includes("api.anthropic.com") && /grade ONE simulated/.test(b2.system || "")) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '"score": 8' }], stop_reason: "max_tokens" }) };   // cut off mid-verdict
    }
    return realFetch2(u, o);
  };
  patientLines = ["Hair fall undi", "[END]"];
  claude = [{ reply: "Entakalam nundi andi?", lead: null }];
  const exBad = await exam.run(cfg, { ids: ["p01"], turns: 4, dry: true });
  global.fetch = realFetch2;
  is([exBad.n, exBad.unjudged, exBad.rows[0].judged], [0, 1, false], "a verdict that cannot be read counts as no verdict, not as nought out of a hundred");
  is(/score lekka veyaleka poyam/.test(exam.summary(exBad)), true, "and the owner is told the score could not be worked out, instead of a frightening number");

  patientLines = ["job kavali, therapist experience undi", "[END]"];
  claude = [{ reply: "Careers page chudandi 🙏", lead: null }];
  const ex2 = await exam.run(cfg, { ids: ["p05"], turns: 6 });
  is([ex2.rows[0].booked, ex2.rows[0].faults], [false, ["no_next_step"]], "a chat that goes wrong is scored low with the fault named");
  is(/• Suresh \(40\): slot adagaledu/.test(exam.summary(ex2)), true, "and the owner's line names the worst chat, with what it did wrong");
  is(/Agent exam — .*: \*\d+\/100\*/.test(exam.summary(night)), true, "a real sitting's line leads with the score out of a hundred");
  const ex3 = await exam.run(cfg, { ids: ["p01", "p05"], budgetMs: 0, dry: true });
  is([ex3.n, ex3.skipped, ex3.score], [0, 2, 0], "when the time budget is gone, the rest are skipped rather than the function dying at 300 s");
  h.run(["SET", `exam:${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}`, JSON.stringify({ score: 80 })]);
  is((await h.call(cronExam, { key: "local-admin" })).body.skipped, "already sat today", "the 08:45 retry does nothing on a day that already has its score");
  is((await h.call(cronExam, {})).code, 401, "the exam cannot be started by a stranger");
  h.as(["settings.manage"]);
  is((await h.call(cronExam, { n: "1", ids: "p05", dry: "1" }, null, { headers: { authorization: "Bearer session" } })).code, 200, "but the manager can run it from the app");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nstage 1 behaves");
  process.exit(fails ? 1 : 0);
})();
