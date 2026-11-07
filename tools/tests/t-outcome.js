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

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ncall outcomes behave");
  process.exit(fails ? 1 : 0);
})();
