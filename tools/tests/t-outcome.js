// What a call came to (7 Nov staff feedback): the reason, the follow-up date,
// and the location / payment QR sent from the lead card. The real staff.js.
process.env.STAFF_SECRET = "local-test-secret";
process.env.STAFF_OWNERS = "9010427777";
const path = require("path"), crypto = require("crypto");
const h = require("./harness.js");
delete require.cache[path.join(process.env.DL_API, "staff.js")];
const staff = require(path.join(process.env.DL_API, "staff.js"));

let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const mk = (o) => { const p = Buffer.from(JSON.stringify(o)).toString("base64url");
  return p + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(p).digest("hex"); };
const call = (q, body, tok) => new Promise((r) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; },
    json(o) { r({ code: this._c, body: o }); return this; }, end() { r({ code: this._c }); return this; } };
  staff({ method: body ? "POST" : "GET", headers: tok ? { authorization: "Bearer " + tok } : {},
          query: q || {}, body: body || {} }, res);
});
const OWNER = mk({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: Date.now() + 86400000 });
const post = (a, b) => call({ a }, Object.assign({ a }, b), OWNER);

(async () => {
  console.log("CALL OUTCOMES — what the call came to\n");
  h.run(["DEL", "dl_leads"]);
  const ts = Date.now() - 3600000;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts, type: "whatsapp", name: "Kavya", phone: "9876500301", concern: "Acne" })]);
  const key = `${ts}|9876500301`;
  const lead = async () => ((await call({ a: "data" }, null, OWNER)).body.leads || []).find((l) => l.key === key) || {};

  is((await post("outcome", { key, outcome: "followup" })).code, 400, "a follow-up without a date is refused");
  is((await post("outcome", { key, outcome: "maybe" })).code, 400, "a made-up outcome is refused");
  is((await post("outcome", { key, outcome: "followup", fu: "2026-11-09" })).code, 200, "a follow-up with a date is saved");
  let l = await lead();
  is([l.status, l.outcome, l.fu], ["contacted", "followup", "2026-11-09"], "the lead shows contacted, the reason, and the day to ring again");
  await post("outcome", { key, outcome: "notravel" });
  l = await lead();
  is([l.status, l.outcome, l.fu], ["closed", "notravel", undefined], "'not willing to travel' closes it and clears the follow-up date");
  await post("status", { key, status: "new" });
  l = await lead();
  is([l.status, l.outcome], ["new", undefined], "a plain stage change replaces the old reason");
  await post("note", { key, text: "Call — ettaledu" });
  l = await lead();
  is(typeof l.lastCall, "number", "a call note marks when they were last rung");

  console.log("\n  — location and QR from the lead card —");
  h.sent.length = 0;
  is((await post("share", { phone: "9876500301", name: "Kavya", kind: "location" })).code, 200, "the location is sent");
  is(h.sent.some((s) => s[0] === "loc" && s[1] === "9876500301"), true, "as a real map pin, inside the 24-hour window");
  const noUpi = process.env.UPI_VPA; delete process.env.UPI_VPA;
  is((await post("share", { phone: "9876500301", kind: "pay" })).code, 400, "without a UPI ID set, the QR is refused with the reason");
  process.env.UPI_VPA = "dermaluxe@upi";
  h.sent.length = 0;
  is((await post("share", { phone: "9876500301", name: "Kavya", kind: "pay" })).code, 200, "with a UPI ID, the QR goes");
  is(h.sent.some((s) => s[0] === "img" && /\/api\/pay\?qr=300&t=/.test(s[2]) && /₹300/.test(s[3])), true, "as a QR picture for the consultation fee, with the UPI ID written under it");
  if (noUpi === undefined) delete process.env.UPI_VPA; else process.env.UPI_VPA = noUpi;
  is(JSON.parse(h.run(["GET", "wa:h:9876500301"]) || "[]").some((t) => /payment QR/.test(t.a)), true, "and the agent is told, so a 'PAID' reply makes sense to it");
  is((await post("share", { phone: "123", kind: "location" })).code, 400, "a bad number is refused");

  // The picture itself: only for an amount the server signed.
  const payMod = h.load("pay"), sig = require(path.join(process.env.DL_API, "_pay.js")).sig;
  process.env.UPI_VPA = "dermaluxe@upi";
  const png = await new Promise((r) => {
    const res = { _c: 200, _h: {}, setHeader(k, v) { this._h[k] = v; }, status(c) { this._c = c; return this; },
      json(o) { r({ code: this._c, body: o }); return this; }, send(b) { r({ code: this._c, type: this._h["Content-Type"], len: b.length }); return this; }, end() { r({ code: this._c }); return this; } };
    payMod({ method: "GET", headers: {}, query: { qr: "300", t: sig("qr:300") } }, res);
  });
  is([png.code, png.type, png.len > 500], [200, "image/png", true], "the QR link returns a real PNG");
  const forged = await new Promise((r) => {
    const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { r({ code: this._c }); return this; }, send() { r({ code: this._c }); return this; } };
    payMod({ method: "GET", headers: {}, query: { qr: "1", t: sig("qr:300") } }, res);
  });
  is(forged.code, 404, "and a link edited to another amount is refused");
  if (noUpi === undefined) delete process.env.UPI_VPA; else process.env.UPI_VPA = noUpi;

  console.log("\n  — the caller's note, written ahead (owner, 8 Nov) —");
  h.run(["DEL", "dl_leads"]);
  const old = Date.now() - 2 * 3600000;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: old, type: "whatsapp", name: "Ramya", phone: "9876500501", concern: "Pigmentation" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: old + 1000, type: "whatsapp", name: "Kiran", phone: "9876500502", concern: "Acne", slot_ts: "2026-12-01 11:00" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 60000, type: "whatsapp", name: "Fresh", phone: "9876500503", concern: "Hair fall" })]);
  const keepF = global.fetch, keepK = process.env.ANTHROPIC_API_KEY; let asked = 0;
  process.env.ANTHROPIC_API_KEY = "test";
  global.fetch = async (url) => { if (String(url).includes("anthropic")) { asked++; return { ok: true, json: async () => ({ content: [{ type: "text", text: "🗣 Pigmentation\n📞 Namaste Ramya garu" }] }) }; } return keepF(url); };
  const cs = require(path.join(process.env.DL_API, "_callscript.js"));
  const first = await cs.backfill(h.cfg || {}, 5);
  const again = await cs.backfill(h.cfg || {}, 5);
  global.fetch = keepF; if (keepK === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = keepK;
  is([first.made, again.made, asked], [1, 0, 1], "a note is written for the unbooked lead only — not the booked one, not one the agent is still talking to — and only once");
  const ramya = ((await call({ a: "data" }, null, OWNER)).body.leads || []).find((l) => l.name === "Ramya") || {};
  is(/Namaste Ramya garu/.test(ramya.script || ""), true, "and the lead card carries it");

  console.log("\n  — a WhatsApp a moment before the call (owner, 9 Nov: 80 of 121 calls went unanswered) —");
  const n = require(path.join(process.env.DL_API, "_notify.js"));   // the harness's stub, which staff.js also holds
  h.run(["DEL", "dl_leads"]);
  const ts2 = Date.now() - 600000;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: ts2, type: "whatsapp", name: "Lakshmi Devi", phone: "9876500601", concern: "Hair fall" })]);
  const k2 = `${ts2}|9876500601`;
  const toPatient = (ph) => h.sent.filter((s) => s[0] === "wa" && s[1] === ph);
  is((await post("call-notice", { phone: "123", name: "X" })).code, 400, "a bad number is refused");
  h.sent.length = 0;
  const c1 = await post("call-notice", { phone: "9876500601", name: "Lakshmi Devi", key: k2 });
  is([c1.code, c1.body.sent, c1.body.via], [200, true, "text"], "inside the 24-hour window the heads-up goes as plain text");
  const hd = toPatient("9876500601")[0] || [];
  is([/^Lakshmi garu/.test(hd[2] || ""), /Owner/.test(hd[2] || ""), /99491 34666/.test(hd[2] || "")], [true, true, true], "addressed by first name, naming who is calling and from which number");
  is((JSON.parse(h.run(["HGET", "dl_notes", k2]) || "[]")[0] || {}).text, "📲 Call heads-up WhatsApp vellindi", "and the lead card says it went");
  h.sent.length = 0;
  const c2 = await post("call-notice", { phone: "9876500601", name: "Lakshmi Devi", key: k2 });
  is([c2.body.sent, c2.body.why, h.sent.length], [false, "recent", 0], "a second tap inside two hours sends nothing more");
  const realOpen = n.windowOpen; n.windowOpen = async () => false;        // the patient has not written in 24 hours
  const c3 = await post("call-notice", { phone: "9876500602", name: "Ravi Kumar" });
  n.windowOpen = realOpen;
  is([c3.code, c3.body.sent, c3.body.via], [200, true, "template"], "outside the window it goes as the approved clinic_update template");
  is(h.sent.some((s) => s[0] === "tpl" && s[1] === "9876500602" && s[2] === "clinic_update" && s[3][0] === "Ravi"), true, "still addressed by first name");
  h.run(["HSET", "staff:users", "9876500052", JSON.stringify({ name: "Accounts", role: "accounts" })]);
  const ACCOUNTS = mk({ p: "9876500052", n: "Accounts", r: "accounts", e: 0, exp: Date.now() + 86400000 });
  is((await call({ a: "call-notice" }, { a: "call-notice", phone: "9876500603", name: "Z" }, ACCOUNTS)).code, 403, "accounts, who cannot edit leads, cannot send one");

  console.log("\n  — two unanswered calls, then the desk stops ringing and writes —");
  h.sent.length = 0;
  const o1 = await post("outcome", { key: k2, outcome: "noanswer" });
  is([o1.code, o1.body.nudged, toPatient("9876500601").length], [200, undefined, 0], "the first 'no answer' sends the patient nothing");
  const o2 = await post("outcome", { key: k2, outcome: "noanswer" });
  is([o2.body.nudged, toPatient("9876500601").length], [true, 1], "the second sends one WhatsApp asking for a time that suits them");
  is([/^Lakshmi garu/.test(toPatient("9876500601")[0][2]), /rendu sarlu call chesam/.test(toPatient("9876500601")[0][2])], [true, true], "by first name — found from the lead, the app did not send it — and saying why");
  const o3 = await post("outcome", { key: k2, outcome: "noanswer" });
  is([o3.body.nudged, toPatient("9876500601").length], [undefined, 1], "the third sends nothing more — still the one message");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ncall outcomes behave");
  process.exit(fails ? 1 : 0);
})();
