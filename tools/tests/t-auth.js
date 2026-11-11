// The real staff.js this time — nothing about who you are is stubbed.
process.env.STAFF_SECRET = "local-test-secret";
process.env.STAFF_OWNERS = "9010427777";
const path = require("path"), API = process.env.DL_API;
const real = require(path.join(API, "_guard.js"));
const S = {}; const h = require("./harness.js");   // harness installs the KV stub
delete require.cache[path.join(API, "staff.js")];  // …but we want the REAL staff.js
const staff = require(path.join(API, "staff.js"));

let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const call = (q, body, headers) => new Promise((r) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; },
    json(o) { r({ code: this._c, body: o }); return this; }, end() { r({ code: this._c }); return this; } };
  staff({ method: body ? "POST" : "GET", headers: headers || {}, query: q || {}, body: body || {} }, res);
});
const bearer = (t) => ({ authorization: "Bearer " + t });

(async () => {
  console.log("LOGIN & SESSIONS — the real thing\n");
  const cfg = { kind: "pg" };

  // the owner sets a password for a new person
  const owner = await call({ a: "data" }, null, {});
  is(owner.code, 401, "no token → no data");

  // mint a token the way login does
  const tok = await (async () => {
    const r = await call({ a: "login" }, { a: "login", phone: "9010427777", password: "not-set-yet" });
    return r;
  })();
  console.log(`  ·   logging in before any password exists → ${tok.code} ${tok.body.error || ""}`);

  // set one through the owner path: create the user, then a password
  h.run(["HSET", "staff:users", "9876500081", JSON.stringify({ name: "Sowmya", role: "reception", ts: Date.now() })]);

  // a made-up token
  const junk = await call({ a: "data" }, null, bearer("abc.def"));
  is(junk.code, 401, "a made-up token is refused");

  // a token with a tampered payload
  const good = await call({ a: "login" }, { a: "login", phone: "9010427777", otp: "DEMO" });
  console.log(`  ·   OTP login in this harness → ${good.code}`);

  // build a token the way the server does, then tamper with it
  const crypto = require("crypto");
  const mk = (obj) => {
    const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
    const sig = crypto.createHmac("sha256", process.env.STAFF_SECRET).update(p).digest("hex");
    return p + "." + sig;
  };
  const now = Date.now();
  const okTok = mk({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: now + 86400000 });
  const me1 = await call({ a: "data" }, null, bearer(okTok));
  is(me1.code, 200, "a properly signed token works");
  is(me1.body.me.role, "owner", "and says who it is");
  // The "Dr tho ayina appts" tile (owner PDF 11 Nov, point 2): visits of the
  // last 30 days, from appt:done AND appt:q, deduped, with whether a doctor
  // saw them — never a no-show, a cancellation or an unmarked slot.
  const H = 3600000, D = 86400000, kv = require("./harness.js");
  kv.run(["HSET", "staff:users", "9876500201", JSON.stringify({ name: "Dr. Nikhitha", role: "doctor" }), "9876500202", JSON.stringify({ name: "Latha", role: "therapist" })]);
  const rec = (o) => JSON.stringify(Object.assign({ ph: "9876500301", name: "P", concern: "acne" }, o));
  kv.run(["LPUSH", "appt:done", rec({ id: "v1", at: now - 2 * D, status: "done", v: 1, staff: "9876500201", staffName: "Dr. Nikhitha" })]);
  kv.run(["LPUSH", "appt:done", rec({ id: "v2", ph: "9876500302", at: now - 3 * D, status: "done", v: 1, staff: "9876500202", staffName: "Latha" })]);
  kv.run(["LPUSH", "appt:done", rec({ id: "v3", ph: "9876500303", at: now - 4 * D, status: "noshow", ns: 1 })]);
  kv.run(["LPUSH", "appt:done", rec({ id: "v4", ph: "9876500304", at: now - 5 * D, status: "unmarked" })]);
  kv.run(["LPUSH", "appt:done", rec({ id: "v8", ph: "9876500308", at: now - 7 * D, status: "unmarked", v: 1, staff: "9876500201" })]);   // filed unmarked, then WhatsApp "arrived" set v
  kv.run(["LPUSH", "appt:done", rec({ id: "v5", ph: "9876500305", at: now - 6 * D, status: "cancelled" })]);
  kv.run(["LPUSH", "appt:done", rec({ id: "v6", ph: "9876500306", at: now - 40 * D, status: "done", v: 1, staff: "9876500201" })]);
  kv.run(["LPUSH", "appt:q", rec({ id: "v7", ph: "9876500307", at: now - 2 * H, status: "arrived", arrived: now - 2 * H, staff: "9876500201", staffName: "Dr. Nikhitha" })]);
  kv.run(["LPUSH", "appt:q", rec({ id: "v1", at: now - 2 * D, status: "done", v: 1, staff: "9876500201" })]);   // the same visit twice, as a race could leave it
  const me2 = (await call({ a: "data" }, null, bearer(okTok))).body;
  const ids = (me2.apptsDone || []).map((a) => a.id);
  is(ids, ["v7", "v1", "v2", "v8"], "the tile's list: the arrived one, the two done ones, and the unmarked slot later confirmed by WhatsApp, newest first — no no-show, no unmarked-without-v, no cancelled, nothing older than 30 days, and v1 only once");
  is((me2.apptsDone || []).map((a) => a.doc), [true, true, false, true], "the doctor's three are 'with Dr'; the therapist's is not");
  is((me2.apptsDone || [])[0].staffName, "Dr. Nikhitha", "with the doctor's name on the row");

  const expired = mk({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: now - 1000 });
  is((await call({ a: "data" }, null, bearer(expired))).code, 401, "an expired token is refused");

  const tampered = okTok.split(".")[0].replace(/.$/, "A") + "." + okTok.split(".")[1];
  is((await call({ a: "data" }, null, bearer(tampered))).code, 401, "changing the payload breaks the signature");

  const wrongSig = okTok.split(".")[0] + ".aaaa";
  is((await call({ a: "data" }, null, bearer(wrongSig))).code, 401, "a forged signature is refused");

  // promoting yourself by editing the token
  const selfPromote = mk({ p: "9876500081", n: "Sowmya", r: "owner", e: 0, exp: now + 86400000 });
  const sp = await call({ a: "data" }, null, bearer(selfPromote));
  is(sp.code, 200, "a signed token for a real staff member works");
  is(sp.body.me.role === "owner", false, "but the role in the token is IGNORED — it comes from the server");
  is(sp.body.me.caps.includes("*"), false, "so she does not get owner powers");
  console.log(`      (she is: ${sp.body.me.role}, ${sp.body.me.caps.length} powers)`);

  // signing out of all phones
  h.run(["HSET", "staff:epoch", "9876500081", "5"]);
  const stale = await call({ a: "data" }, null, bearer(selfPromote));
  is(stale.code, 401, "after 'sign out everywhere', the old token stops working");
  const fresh = mk({ p: "9876500081", n: "Sowmya", r: "reception", e: 5, exp: now + 86400000 });
  is((await call({ a: "data" }, null, bearer(fresh))).code, 200, "and a new one works");

  // somebody switched off
  h.run(["HSET", "staff:users", "9876500081", JSON.stringify({ name: "Sowmya", role: "reception", off: true })]);
  const offR = await call({ a: "data" }, null, bearer(fresh));
  is(offR.code === 401 || offR.code === 403, true, "somebody switched off cannot get in");
  console.log("      it says: " + offR.body.error);

  // a number nobody added
  const stranger = mk({ p: "9876511111", n: "X", r: "owner", e: 0, exp: now + 86400000 });
  const strR = await call({ a: "data" }, null, bearer(stranger));
  is(strR.code === 401 || strR.code === 403, true, "a signed token for a number nobody added is refused");
  console.log("      it says: " + strR.body.error);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nlogins behave");
})();
