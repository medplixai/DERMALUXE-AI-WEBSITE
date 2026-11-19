// Three things the desk could not do in one tap (owner, 19 Nov: "staff app lo
// action buttons emaina kavalemo — deep ga chusi add cheyyi").
//
//   ⏰ Slots pampu  — 97 of 133 A/B chats that never booked (fortnight to
//                    18 Nov) stopped right after "e time convenient?".
//   🔕 Calls/msgs vaddu — a patient asked on 18 Nov not to be called or
//                    messaged; the desk had only "not interested", which
//                    stopped nothing.
//   ✅/❌ due marks — 22 of 35 past appointments were never marked, so
//                    no-shows never got the rebook message.
process.env.STAFF_SECRET = "local-test-secret";
process.env.STAFF_OWNERS = "9010427777";
const path = require("path"), crypto = require("crypto");
const h = require("./harness.js");
const API = process.env.DL_API || path.resolve("api");
const schedule = h.load("schedule");                 // with the harness's staff stub
delete require.cache[path.join(API, "staff.js")];
const staff = require(path.join(API, "staff.js"));   // the real one
const notify = require(path.join(API, "_notify.js"));

let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const mk = (o) => { const p = Buffer.from(JSON.stringify(o)).toString("base64url");
  return p + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(p).digest("hex"); };
const call = (q, body, tok) => new Promise((r) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; },
    json(o) { r({ code: this._c, body: o }); return this; }, end() { r({ code: this._c }); return this; } };
  staff({ method: body ? "POST" : "GET", headers: tok ? { authorization: "Bearer " + tok } : {}, query: q || {}, body: body || {} }, res);
});
const OWNER = mk({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: Date.now() + 86400000 });
const post = (a, b) => call({ a }, Object.assign({ a }, b), OWNER);

(async () => {
  console.log("THE DESK'S NEW BUTTONS\n");
  const ts = Date.now() - 3600000;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts, type: "whatsapp", name: "Lakshmi", phone: "9876500901", concern: "Hydrafacial" })]);
  const key = `${ts}|9876500901`;

  console.log("  — ⏰ Slots pampu —");
  h.sent.length = 0;
  const r1 = await post("send-slots", { key, phone: "9876500901", name: "Lakshmi" });
  const list = h.sent.find((x) => x[0] === "list");
  is([r1.code, r1.body.via], [200, "list"], "inside the 24-hour window the times go as a tap list");
  is(!!list && list[3].length >= 3 && list[3].every((t) => /^(Ivala|Repu|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2} (AM|PM)$/.test(t)), true, "real free times, in words the agent reads back (\"Repu 11:00 AM\")");
  is(/Lakshmi garu/.test(list && list[2]), true, "greeting her by the name she gave");
  is(/Sun /.test((list && list[3] || []).join(",")), false, "never a Sunday");
  const thread = h.run(["LRANGE", "ib:m:9876500901", "0", "0"]).map((x) => JSON.parse(x))[0] || {};
  is([thread.dir, thread.by], ["out", "Owner"], "it shows in the chat, sent by the person who tapped");
  const notes = JSON.parse(h.run(["HGET", "dl_notes", key]) || "[]");
  is(/⏰ Slots pampanu/.test((notes[0] || {}).text), true, "and as a note on the lead");
  is((await post("send-slots", { key, phone: "9876500901" })).code, 409, "a second tap within two hours does not send them again");

  notify.windowOpen = async () => false;
  h.sent.length = 0;
  const r2 = await post("send-slots", { phone: "9876500902", name: "Ravi K (WhatsApp peru)" });
  const tpl = h.sent.find((x) => x[0] === "tpl");
  is([r2.body.via, tpl && tpl[2], /Ivala|Repu|Mon|Tue|Wed|Thu|Fri|Sat/.test(tpl && tpl[3][1])], ["template", "clinic_update", true], "after 24 hours it goes as the template, with the times written out");
  is(tpl && tpl[3][0], "Namaste", "and a WhatsApp label is never used as a name");
  notify.windowOpen = async () => true;

  h.run(["SADD", "optout", "9876500903"]);
  is((await post("send-slots", { phone: "9876500903" })).code, 409, "nothing goes to somebody who sent STOP");

  console.log("\n  — a tap on one of them is a booking —");
  const offer = JSON.parse(h.run(["GET", "slots:sent:9876500901"]));
  is(Array.isArray(offer.slots) && typeof offer.slots[0].at === "number", true, "what was offered is kept for the agent to recognise the tap");

  console.log("\n  — 🔕 Calls/msgs vaddu —");
  const r3 = await post("outcome", { key, outcome: "dnd" });
  is([r3.code, r3.body.status, r3.body.optedOut], [200, "closed", true], "the lead closes");
  is(h.run(["SMEMBERS", "optout"]).includes("9876500901"), true, "and the number joins the opt-out list every nudge and broadcast reads");
  is((await post("send-slots", { key, phone: "9876500901" })).code, 409, "after which no slots go either");

  console.log("\n  — ✅/❌ for appointments whose time has passed —");
  const now = Date.now();
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876500911", name: "Came?", at: now - 3 * 3600000, ts: now - 86400000, by: "AI agent" })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ id: "a1", ph: "9876500912", name: "Marked", at: now - 3 * 3600000, status: "done" })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ id: "a2", ph: "9876500913", name: "Later", at: now + 3 * 3600000, status: "booked" })]);
  const dm = await h.call(schedule, { a: "due-marks" });
  is((dm.body.list || []).map((r) => r.name), ["Came?"], "only the passed and unmarked one is asked about");
  const st = await h.call(schedule, null, { a: "status", ph: "9876500911", at: now - 3 * 3600000, status: "done" });
  is(st.code, 200, "and the agent's own booking (no id) can be marked from it");
  is(((await h.call(schedule, { a: "due-marks" })).body.list || []).length, 0, "after which it is not asked again");

  console.log("\n  — no call heads-up to somebody who said stop —");
  h.sent.length = 0;
  const cn = await post("call-notice", { phone: "9876500901", name: "Lakshmi" });
  is([cn.body.sent, cn.body.why, h.sent.length], [false, "optout", 0], "\"ippudu call chestunnaru\" does not go to an opted-out number");

  console.log("\n  — delivery receipts —");
  const wa = h.load("whatsapp");
  await wa.recordStatuses({ kind: "pg" }, [
    { id: "wamid.A", status: "sent", recipient_id: "919876500921" },
    { id: "wamid.A", status: "delivered", recipient_id: "919876500921" },
    { id: "wamid.B", status: "failed", recipient_id: "919876500922", errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Receiver is incapable of receiving this message" } }] },
  ]);
  const dayK = "wa:dlv:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  is([h.run(["HGET", dayK, "sent"]), h.run(["HGET", dayK, "delivered"]), h.run(["HGET", dayK, "failed"])].map(Number), [1, 1, 1], "every receipt is counted for the day");
  const fl = JSON.parse(h.run(["LRANGE", "wa:fail", "0", "0"])[0] || "{}");
  is([fl.ph, fl.code, /undeliverable/i.test(fl.title)], ["9876500922", 131026, true], "a failure is kept with the number and Meta's own code and reason");

  const push = require(path.join(API, "_push.js")), pushed = [];
  push.enabled = () => true; push.notifyCap = async (c, cap, m) => { pushed.push([cap, m.title, m.urgent]); return { ok: true }; };
  const billing = { status: "failed", recipient_id: "919876500923", errors: [{ code: 131042, title: "Business eligibility payment issue" }] };
  await wa.recordStatuses({ kind: "pg" }, [billing, Object.assign({}, billing, { recipient_id: "919876500924" })]);
  is([pushed.length, pushed[0] && pushed[0][0], pushed[0] && pushed[0][2]], [1, "settings.manage", true], "a billing failure (19 Nov, 131042) rings the owners' phones at once — once, not per message");

  console.log("\n  — wired into the screen —");
  const html = require("fs").readFileSync(path.join(API, "..", "staff.html"), "utf8");
  is([/data-act="send-slots"/.test(html), /"o:dnd"/.test(html), /schapi\("due-marks"\)/.test(html)], [true, true, true], "the lead card, the status list and the Leads screen carry them");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe desk's new buttons work");
  process.exit(fails ? 1 : 0);
})();
