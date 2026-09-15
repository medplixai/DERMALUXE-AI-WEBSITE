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
