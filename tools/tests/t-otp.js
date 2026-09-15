// Getting in, and being stopped from getting in.
process.env.STAFF_SECRET = "local-test-secret";
process.env.STAFF_OWNERS = "9010427777";
const path = require("path");
const h = require("./harness.js");
delete require.cache[path.join(process.env.DL_API, "staff.js")];
// the real rate limiter, over the harness store
const staff = require(path.join(process.env.DL_API, "staff.js"));
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const call = (body, ip) => new Promise((r) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; },
    json(o) { r({ code: this._c, body: o }); return this; }, end() { r({ code: this._c }); return this; } };
  staff({ method: "POST", headers: { "x-forwarded-for": ip || "1.2.3.4" }, query: { a: body.a }, body }, res);
});

(async () => {
  console.log("OTP LOGIN — the ways in, and the ways they are held shut\n");
  h.run(["HSET", "staff:users", "9876500051", JSON.stringify({ name: "Sowmya", role: "reception" })]);
  const PH = "9876500051";

  const first = await call({ a: "send", phone: PH });
  is(first.code, 200, "the first OTP is sent");

  // five an hour to one number, then no more — from ANY address
  let blocked = 0;
  for (let i = 0; i < 8; i++) {
    const r = await call({ a: "send", phone: PH }, "9.9.9." + i);   // a different address each time
    if (r.code === 429) blocked++;
  }
  is(blocked > 0, true, "asking again and again for one number is stopped even from new addresses");
  const msg = (await call({ a: "send", phone: PH }, "9.9.9.99")).body.error;
  is(/aagandi/.test(msg || ""), true, "and it says so in words the desk reads: " + msg);

  // a different person is unaffected
  h.run(["HSET", "staff:users", "9876500052", JSON.stringify({ name: "Latha", role: "therapist" })]);
  is((await call({ a: "send", phone: "9876500052" }, "9.9.9.99")).code, 200, "somebody else can still log in");

  // guessing the code
  console.log("\n  — guessing a code —");
  h.run(["SET", "staff:otp:9876500052", JSON.stringify({ code: "123456", tries: 0 })]);
  let lastCode = 0;
  for (let i = 0; i < 6; i++) lastCode = (await call({ a: "verify", phone: "9876500052", code: "000000" })).code;
  is(lastCode, 429, "five wrong codes and that OTP is dead");
  is(h.run(["GET", "staff:otp:9876500052"]), null, "the code is thrown away, not left to guess at");

  // the right code still works
  h.run(["SET", "staff:otp:9876500052", JSON.stringify({ code: "654321", tries: 0 })]);
  const good = await call({ a: "verify", phone: "9876500052", code: "654321" });
  is(good.code, 200, "and the right code gets you in");
  is(!!good.body.token, true, "with a token");
  is(good.body.me.role, "therapist", "as who you actually are");

  // somebody not on the staff list
  is((await call({ a: "send", phone: "9876511111" })).code, 403, "a number nobody added gets no OTP at all");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe door behaves");
})();
