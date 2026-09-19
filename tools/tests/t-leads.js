// Leads: where an enquiry comes in, and what the desk does with it.
//
// The website form (/api/lead), the old leads page's status and list
// (/api/lead-status, /api/leads), the retry queue for the clinic platform
// (/api/sync-retry), the website chat (/api/chat) and the AI Office's
// approved actions (/api/act). Every one of them writes to the same lead
// book the desk works from, so the checks are about that book: nothing lost,
// nothing doubled, and the desk's own work never undone behind its back.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const G = require(path.join(API, "_guard.js"));        // the harness's guard, patched per test
const SITE = { headers: { origin: "https://www.dermaluxe.ai", "x-forwarded-for": "5.5.5.5" } };
const FOREIGN = { headers: { origin: "https://evil.example", "x-forwarded-for": "5.5.5.6" } };
const leads = () => h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x));
const clearLeads = () => h.run(["DEL", "dl_leads", "dl_status", "dl_notes", "dl_sync_pending"]);

// The network: Claude for the website chat, the clinic platform for sync.
let claude = [], clinicUp = true, clinicHits = 0;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏", lead: null };
    if (next === 500) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(next) }] }) };
  }
  if (u.includes("clinic.test")) { clinicHits++; return { ok: clinicUp, status: clinicUp ? 200 : 503 }; }
  return { ok: true, status: 200, json: async () => ({}) };
};

const lead = h.load("lead"), leadStatus = h.load("lead-status"), list = h.load("leads");
const syncRetry = h.load("sync-retry"), act = h.load("act"), chat = h.load("chat");

(async () => {
  console.log("LEADS\n");

  console.log("  — the website form —");
  is((await h.call(lead, {}, { name: "Anu", phone: "9876500101" }, FOREIGN)).code, 403, "a form posted from another site is refused");
  is((await h.call(lead, {}, { name: "", phone: "9876500101" }, SITE)).code, 400, "no name, no lead");
  is((await h.call(lead, {}, { name: "Anu", phone: "12345" }, SITE)).code, 400, "nor a number that is not a mobile");
  h.sent.length = 0;
  const ok = await h.call(lead, {}, { name: "Anu", phone: "+91 98765 00101", concern: "Acne", type: "booking" }, SITE);
  is([ok.code, ok.body.stored], [200, true], "a real enquiry is stored");
  is((leads()[0] || {}).phone, "9876500101", "with the number cleaned to ten digits");
  is(h.sent.some((s) => s[0] === "lead"), true, "and the team is alerted");
  // The database refusing the write used to be answered "stored: true".
  const realWrite = G.kvWrite;
  G.kvWrite = async () => false;
  const lost = await h.call(lead, {}, { name: "Ravi", phone: "9876500102" }, SITE);
  G.kvWrite = realWrite;
  is(lost.body.stored, false, "when the database refuses the write, it does not claim the lead was stored");
  let last = 0;
  for (let i = 0; i < 16; i++) last = (await h.call(lead, {}, { name: "Spam", phone: "9876500103" }, { headers: { origin: "https://dermaluxe.ai", "x-forwarded-for": "7.7.7.7" } })).code;
  is(last, 429, "one address cannot fill the book — fifteen an hour");

  console.log("\n  — the old leads page —");
  clearLeads();
  await h.call(lead, {}, { name: "Sita", phone: "9876500104" }, SITE);
  const L0 = leads()[0] || {};
  const K = { headers: Object.assign({ "x-admin-key": "local-admin" }, SITE.headers) };
  is((await h.call(list, { key: "wrong" }, null, SITE)).code, 401, "the list needs the admin key");
  is((await h.call(leadStatus, {}, { key: "wrong", ts: L0.ts, phone: L0.phone, status: "contacted" }, SITE)).code, 401, "and so does changing a status");
  is((await h.call(leadStatus, {}, { key: "local-admin", ts: L0.ts, phone: L0.phone, status: "married" }, SITE)).code, 400, "a status that is not one of the five is refused");
  await h.call(leadStatus, {}, { key: "local-admin", ts: L0.ts, phone: "+91 " + L0.phone, status: "contacted" }, SITE);
  is(h.run(["HGET", "dl_status", `${L0.ts}|${L0.phone}`]), "contacted", "a status set with the +91 still lands on the lead the staff app shows");
  const got = await h.call(list, {}, null, K);
  is([got.body.count, (got.body.leads[0] || {}).status], [1, "contacted"], "and the list shows it");

  console.log("\n  — enquiries the clinic platform missed —");
  clearLeads();
  is((await h.call(syncRetry, {}, { key: "local-admin" }, SITE)).body.reason, "CLINIC_SYNC_URL not set", "with no platform connected, nothing is retried");
  process.env.CLINIC_SYNC_URL = "https://clinic.test/in";
  for (let i = 0; i < 250; i++) h.run(["RPUSH", "dl_sync_pending", JSON.stringify({ ts: 1000 + i, name: "P" + i, phone: "98765" + String(10000 + i), type: "lead" })]);
  clinicHits = 0;
  const r1 = await h.call(syncRetry, {}, { key: "local-admin" }, SITE);
  is([r1.body.retried, r1.body.synced], [200, 200], "a batch of two hundred goes across");
  is(r1.body.remaining, 50, "and the fifty it did not reach this time are still waiting — not thrown away");
  clinicUp = false;
  const r2 = await h.call(syncRetry, {}, { key: "local-admin" }, SITE);
  is([r2.body.retried, r2.body.synced, r2.body.remaining], [50, 0, 50], "when the platform is down, what was tried goes back in the queue");
  clinicUp = true;
  delete process.env.CLINIC_SYNC_URL;

  console.log("\n  — the website chat —");
  clearLeads();
  const SID = { headers: { origin: "https://www.dermaluxe.ai", "x-forwarded-for": "8.8.8.1" } };
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test";
  is((await h.call(chat, {}, { sid: "s1", message: "hi" }, FOREIGN)).code, 403, "only from our own site");
  claude.push({ reply: "Thanks Priya garu 🙏", lead: { name: "Priya", phone: "9876500110", concern: "Hair fall", heat: "warm" }, buttons: ["Saturday", "Sunday", "Monday", "Tuesday"] });
  const c1 = await h.call(chat, {}, { sid: "s1", message: "Priya, 9876500110, hair fall" }, SID);
  is(c1.body.captured, true, "name and mobile given — it becomes a lead");
  is(c1.body.buttons.length, 3, "at most three chips are offered");
  const wk = `${(leads()[0] || {}).ts}|9876500110`;
  h.run(["HSET", "dl_status", wk, "booked"]);
  await new Promise((r) => setTimeout(r, 3));
  claude.push({ reply: "Saturday 5 PM ok 🙏", lead: { name: "Priya", phone: "9876500110", concern: "Hair fall + dandruff", heat: "hot" } });
  await h.call(chat, {}, { sid: "s1", message: "dandruff kuda" }, SID);
  const cl = leads().filter((l) => l.phone === "9876500110");
  is([cl.length, (cl[0] || {}).concern], [1, "Hair fall + dandruff"], "the same chat keeps one lead, with the fuller concern");
  is(h.run(["HGET", "dl_status", `${(cl[0] || {}).ts}|9876500110`]), "booked", "and the desk's status stays on it");
  claude.push({ reply: "Ok", lead: { name: "Priya", phone: "9876500110", concern: "Hair fall, dandruff, itching" } });
  G.kvWrite = async () => false;                                   // the database refuses the new row
  await h.call(chat, {}, { sid: "s1", message: "itching kuda" }, SID);
  G.kvWrite = realWrite;
  is(leads().filter((l) => l.phone === "9876500110").map((l) => l.concern), ["Hair fall + dandruff"], "if the new row cannot be written, the old one is not removed");
  claude.push(500);
  const down = await h.call(chat, {}, { sid: "s2", message: "hello" }, SID);
  is([down.code, down.body.reply.length > 10], [200, true], "the model being down still gets the visitor a reply");
  process.env.ANTHROPIC_API_KEY = saved;

  console.log("\n  — what the AI Office may do, once a person approves —");
  h.as(["ai.use", "leads.edit"]);
  is((await h.call(act, {}, { type: "message", phone: "9876500111", text: "Hello there" })).code, 403, "a message needs msg.send, whoever proposed it");
  is((await h.call(act, {}, { type: "delete", key: "x" })).code, 400, "an action that is not on the list is refused");
  is((await h.call(act, {}, { type: "status", key: wk, status: "paid" })).code, 400, "a made-up status is refused");
  await h.call(act, {}, { type: "note", key: wk, text: "Called — coming Saturday" });
  await h.call(act, {}, { type: "note", key: wk, text: "Reminded" });
  is(JSON.parse(h.run(["HGET", "dl_notes", wk])).map((n) => n.text), ["Reminded", "Called — coming Saturday"], "notes pile up, newest first");
  is(JSON.parse(h.run(["LRANGE", "staff:audit", "0", "0"])[0]).what.startsWith("AI Office:"), true, "and every approval is in the audit");
  h.as(["ai.use", "msg.send"]);
  const realWa = h.sent.length;
  const n = require(path.join(API, "_notify.js"));
  const sendWa = n.sendWa; n.sendWa = async () => false;              // window closed
  const m = await h.call(act, {}, { type: "message", phone: "9876500111", name: "Sita Devi", text: "Mee report ready" });
  n.sendWa = sendWa;
  is([m.code, m.body.via], [200, "template"], "outside WhatsApp's 24 hours, the message goes as the approved template");
  is(h.sent.slice(realWa).some((s) => s[0] === "tpl" && s[3][0] === "Sita"), true, "addressed by first name");
  h.as(["ai.use", "pkg.log"]);
  h.run(["SET", "pkg:p1", JSON.stringify({ id: "p1", phone: "9876500112", total: 3, sessions: [], status: "dropped", ts: Date.now() })]);
  is((await h.call(act, {}, { type: "pkglog", id: "p1" })).code, 400, "a package the clinic has stopped cannot have a sitting logged against it");
  h.run(["SET", "pkg:p2", JSON.stringify({ id: "p2", phone: "9876500112", total: 1, sessions: [], ts: Date.now() })]);
  h.run(["RPUSH", "pkg:open", "p2"]);
  await h.call(act, {}, { type: "pkglog", id: "p2" });
  is(h.run(["LRANGE", "pkg:open", "0", "-1"]), [], "the last sitting closes the package");
  is((await h.call(act, {}, { type: "pkglog", id: "p2" })).code, 400, "and there is no sitting after the last");
  h.as(["*"]);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nleads behave");
  process.exit(fails ? 1 : 0);
})();
