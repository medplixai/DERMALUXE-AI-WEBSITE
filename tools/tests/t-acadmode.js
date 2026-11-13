// Academy chats get the Academy, not a skin consultation.
//
// Owner, 13 Nov 2026: "academy lead ki consultation adugutundi — academy lead
// ki academy cheppali". That day the agent opened a paid student's chat with
// "mee problem cheppandi", and asked a beautician who wrote "Academy details
// kavali" whether her concern was skin or hair fall. Every case below is a
// real message from that week.
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

const AM = h.load("_acadmode");

(async () => {
  console.log("ACADEMY CHATS\n");

  console.log("  — which chats are about the Academy —");
  is(AM.detect({ text: "Academy details kavali" }), "lead", "\"Academy details kavali\"");
  is(AM.detect({ text: "Course nerpisru anaru" }), "lead", "\"Course nerpisru anaru\" — the way people actually write it");
  is(AM.detect({ text: "I need pmu class" }), "lead", "\"I need pmu class\"");
  is(AM.detect({ text: "📅 Book Now", hist: [{ u: "Academy details kavali", a: "Sure 😊" }] }), "lead",
    "\"Book Now\" straight after asking about the Academy is booking a counselling, not a consultation");
  is(AM.detect({ text: "Hello! Can I get more info on this?", ad: { headline: "api.whatsapp.com", body: "Beautician? Nurse? Fresher? DermaLuxe Academy — 1 month hands-on course" } }), "lead",
    "Meta's prefill off an Academy ad is an Academy chat");
  is(AM.detect({ text: "Hello! Can I get more info on this?", ad: { headline: "api.whatsapp.com", body: "Hair fall ki doctor consultation — Eluru" } }), "",
    "the same prefill off a hair-fall ad is not");
  is(AM.detect({ text: "Hi", concern: "Academy callback – Skin (salary & placement)" }), "lead", "a lead the desk already wrote down as Academy");

  console.log("\n  — and which are not —");
  is(AM.detect({ text: "Academy kosam kadhu test cheyinchukovadaniki", hist: [{ u: "Academy details kavali" }] }), "",
    "\"Academy kosam kadhu, test cheyinchukovadaniki\" — they said which they are");
  is(AM.detect({ text: "Inter mphw (anm) nursing years course", hist: [{ u: "Naku job estharaa" }] }), "",
    "a job seeker listing her nursing course is the job flow");
  is(AM.detect({ text: "Tablets course complete ayyindi, inka pimples vastunnayi" }), "", "a course of tablets is a patient");
  is(AM.detect({ text: "Hair fall ekkuva undi" }), "", "and an ordinary patient is an ordinary patient");

  console.log("\n  — a student is a student —");
  const stu = { id: "A1", name: "Sravani", phone: "9876500777", course: "skin", status: "enrolled", fee: 47500, paid: 47500, startISO: "2026-11-10" };
  is(AM.detect({ text: "Hi", student: stu }), "student", "an enrolled student saying hi");
  is(AM.detect({ text: "Hi", student: Object.assign({}, stu, { status: "dropped" }) }), "", "somebody who dropped out is not treated as in the course");
  const sl = AM.line("student", stu);
  is([/already enrolled in the Skin Care course/.test(sl), /fee fully paid/.test(sl), /Do NOT sell the course/.test(sl)], [true, true, true],
    "the student line says who she is, that she has paid, and not to sell to her");
  is(/₹2,000/.test(AM.line("student", Object.assign({}, stu, { paid: 45500 }))), true, "and names a balance when there is one");
  const ll = AM.line("lead");
  is([/NOT a treatment/.test(ll), /do NOT offer a doctor consultation/.test(ll), /counselling call/.test(ll)], [true, true, true],
    "the lead line: not a treatment, no consultation, a counselling call is the next step");

  console.log("\n  — the goal the agent is given —");
  const G = h.load("_goal");
  is(G.goalFor({ concern: "Academy course enquiry" }).next, "peru adugu", "an Academy enquiry starts with the name");
  is(/counselling/.test(G.goalFor({ concern: "Academy course enquiry", name: "Sita" }).next), true, "then the course and a counselling call — never \"2 slots offer cheyyi\"");

  console.log("\n  — through the real agent —");
  const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
  stub("_admin.js", { isAdmin: (d) => d === OWNER, handle: async () => null, fmtIst: () => "Sat 5 PM" });
  stub("_hr.js", { handle: async () => null });
  stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
  stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });
  stub("_push.js", { enabled: () => true, notifyCap: async () => ({ ok: true, sent: 1 }), send: async () => ({ ok: true }) });
  let asked = "";
  const docs = [];
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      if (/You fix one WhatsApp reply/.test(String((opt && opt.body) || ""))) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) };
      asked = String(opt.body || "");
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ reply: "Namaste 🙏 Academy gurinchi cheptanu.", lead: null }) }] }) };
    }
    if (u.includes("graph.facebook.com")) { const b = opt && opt.body ? JSON.parse(opt.body) : {}; if (b.type === "document") docs.push(b.to); }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  // The opener test is on, with the two patient lines the owner wrote.
  const ab = h.load("_abtest");
  await ab.save({ kind: "pg" }, { on: true, a: { label: "A", text: "Namaste 🙏 DermaLuxe by Medicare nunchi — mee problem cheppandi" }, b: { label: "B", text: "Namaste 🙏 MD dermatologist tho modati consultation free." } }, "Owner");
  const wa = h.load("whatsapp");
  let mid = 0;
  const say = (from, text) => new Promise((resolve) => {
    const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ code: this._c, body: o }); return this; }, send(x) { resolve({ code: this._c }); return this; }, end() { resolve({ code: this._c }); return this; } };
    wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: "Sravani" } }],
      messages: [{ id: "wamid.ac" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
  });

  await say("7569600001", "Academy details kavali");
  is(/ACADEMY LEAD/.test(asked), true, "an Academy question reaches the model as an Academy lead");
  is(/OPENER:/.test(asked), false, "with no patient opener in front of it");
  is(/Clinic consultation slot book/.test(asked), false, "and no clinic-consultation goal");

  h.run(["SET", "acad:ph:9876500777", "A1"]);
  h.run(["SET", "acad:st:A1", JSON.stringify(stu)]);
  docs.length = 0;
  await say("9876500777", "Hi");
  is(/ACADEMY STUDENT/.test(asked), true, "A student saying \"Hi\" is a student, by her number");
  is([/OPENER:/.test(asked), /\[ACADEMY SEATS STATUS:/.test(asked)], [false, false], "no opener, and no seat count to sell her");
  await say("9876500777", "Course timings enti?");
  is(docs.length, 0, "and she is not sent the sales catalog for asking about her own course");

  await say("9000000123", "Hair fall ekkuva undi");
  is(/ACADEMY (LEAD|STUDENT)/.test(asked), false, "a patient gets no Academy line");
  is(/OPENER:/.test(asked), true, "and still gets the opener test");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nacademy chats behave");
  process.exit(fails ? 1 : 0);
})();
