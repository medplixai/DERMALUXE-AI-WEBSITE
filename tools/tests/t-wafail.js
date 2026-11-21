// "❌ WhatsApp cheraledu" — the desk can see whose last message failed, and
// send it again in one tap.
//
// 19–20 Nov: Meta billing stopped every template. Forty patients' messages
// failed — replies to people who had just written, appointment reminders,
// "call lift avvaledu" — and the Leads screen and Inbox showed every one as
// sent. Owner, 21 Nov: "badge cheyyi".
process.env.STAFF_SECRET = "local-test-secret";
process.env.STAFF_OWNERS = "9010427777";
const path = require("path"), crypto = require("crypto");
const h = require("./harness.js");
const API = process.env.DL_API || path.resolve("api");
delete require.cache[path.join(API, "staff.js")];
const staff = require(path.join(API, "staff.js"));   // the real one
const notify = require(path.join(API, "_notify.js"));
const wa = h.load("whatsapp");
const W = h.load("_wafail");

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
const cfg = { kind: "pg" };
const fail = (ph, code, title) => ({ id: "w" + ph, status: "failed", recipient_id: "91" + ph, errors: [{ code, title, error_data: { details: title } }] });

(async () => {
  console.log("WHOSE WHATSAPP DID NOT ARRIVE\n");

  console.log("  — the receipt marks it —");
  await wa.recordStatuses(cfg, [fail("9876500931", 131042, "Business eligibility payment issue")]);
  const f1 = await W.read(cfg, "9876500931");
  is([f1 && f1.code, f1 && f1.why], [131042, "Meta billing problem"], "a failed receipt puts the badge on that phone, with the reason in the desk's words");
  await wa.recordStatuses(cfg, [{ id: "x", status: "delivered", recipient_id: "919876500931" }]);
  is(await W.read(cfg, "9876500931"), null, "a delivered receipt for the same phone takes it off — the newest message got through");
  await wa.recordStatuses(cfg, [fail("9876500932", 131047, "Re-engagement message")]);
  await wa.recordStatuses(cfg, [{ id: "y", status: "sent", recipient_id: "919876500932" }]);
  is(!!(await W.read(cfg, "9876500932")), true, "\"sent\" is not \"delivered\" — the badge stays");

  console.log("\n  — the desk sees it —");
  const ts = Date.now() - 3600000;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts, type: "whatsapp", name: "Kavya", phone: "9876500932", concern: "Pigmentation" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: ts - 1000, type: "whatsapp", name: "Ramya", phone: "9876500933", concern: "Acne" })]);
  const list = await call({ a: "leads" }, null, OWNER);
  const kav = (list.body.leads || []).find((l) => l.phone === "9876500932") || {}, ram = (list.body.leads || []).find((l) => l.phone === "9876500933") || {};
  is([kav.wa_fail && kav.wa_fail.why, ram.wa_fail], ["24 gantala window close", undefined], "the lead whose message failed carries the badge; the others do not");

  console.log("\n  — 🔁 Malli pampu —");
  // Inside the window, a failure from this morning: the same words again.
  h.run(["LPUSH", "ib:m:9876500934", JSON.stringify({ dir: "in", text: "Hydrafacial price entha?", ts: Date.now() - 50 * 60000 })]);
  h.run(["RPUSH", "ib:m:9876500934", JSON.stringify({ dir: "out", by: "ai", text: "Hydrafacial 45 nimishalu andi — ee timings lo edi convenient?", ts: Date.now() - 49 * 60000 })]);
  await W.mark(cfg, "9876500934", { ts: Date.now() - 49 * 60000 + 1000, code: 131042, title: "x" });
  h.sent.length = 0;
  const r1 = await post("wa-retry", { phone: "9876500934", name: "Sneha" });
  const sent1 = h.sent.find((x) => x[0] === "wa") || [];
  is([r1.code, r1.body.via, sent1[2]], [200, "same", "Hydrafacial 45 nimishalu andi — ee timings lo edi convenient?"], "inside the window, the message that failed goes again word for word");
  const after = await W.read(cfg, "9876500934");
  is([!!after, !!(after && after.retried), after && after.retried.by], [true, true, "Owner"], "the badge stays, marked as tried, until a receipt comes back");
  is((await post("wa-retry", { phone: "9876500934" })).code, 409, "a second tap within half an hour does nothing");

  // A stale call heads-up is not sent again.
  h.run(["RPUSH", "ib:m:9876500935", JSON.stringify({ dir: "out", by: "Hima", text: "Anu garu 🙏 DermaLuxe nunchi Hima ippudu call chestunnaru — lift cheyandi", ts: Date.now() - 2 * 3600000 })]);
  await W.mark(cfg, "9876500935", { ts: Date.now() - 2 * 3600000 + 1000, code: 131042, title: "x" });
  h.sent.length = 0;
  const r2 = await post("wa-retry", { phone: "9876500935", name: "Anu" });
  const sent2 = h.sent.find((x) => x[0] === "wa") || [];
  is([r2.body.via, /cheraledu/.test(sent2[2] || ""), /call chestunnaru/.test(sent2[2] || "")], ["text", true, false], "\"Hima ippudu call chestunnaru\" from two hours ago is not repeated — they get \"our message did not reach you, reply here\"");

  // Outside the window: the template.
  notify.windowOpen = async () => false;
  h.sent.length = 0;
  const r3 = await post("wa-retry", { key: `${ts}|9876500932`, phone: "9876500932" });
  const tpl = h.sent.find((x) => x[0] === "tpl") || [];
  is([r3.body.via, tpl[2], tpl[3] && tpl[3][0]], ["template", "clinic_update", "Kavya"], "outside the window it goes as the clinic_update template, by her name");
  const notes = JSON.parse(h.run(["HGET", "dl_notes", `${ts}|9876500932`]) || "[]");
  is(/🔁 Cheraledu/.test((notes[0] || {}).text), true, "and the lead's notes say it was sent again");
  notify.windowOpen = async () => true;

  console.log("\n  — what it never does —");
  is((await post("wa-retry", { phone: "9876500936" })).code, 409, "no failure on record, nothing to send");
  await W.mark(cfg, "9876500937", { ts: Date.now(), code: 131042, title: "x" });
  h.run(["SADD", "optout", "9876500937"]);
  is((await post("wa-retry", { phone: "9876500937" })).code, 409, "never to somebody who said STOP");
  const RECEP = mk({ p: "9876500001", n: "Reader", r: "viewer", e: 0, exp: Date.now() + 86400000 });
  is((await call({ a: "wa-retry" }, { a: "wa-retry", phone: "9876500932" }, RECEP)).code, 403, "and not for someone without the right to message patients");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe desk sees what did not arrive");
  process.exit(fails ? 1 : 0);
})();
