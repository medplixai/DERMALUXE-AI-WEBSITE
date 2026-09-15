// A lead typed in at the desk. The real staff.js, not the stub.
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

(async () => {
  console.log("DESK LEAD ENTRY — somebody walked in\n");
  const add = (b) => call({ a: "lead-add" }, Object.assign({ a: "lead-add" }, b), OWNER);

  is((await add({ name: "", phone: "9876500201" })).code, 400, "a lead needs a name");
  is((await add({ name: "X", phone: "12345" })).code, 400, "and a real number");
  is((await add({ name: "X", phone: "1234567890" })).code, 400, "a number that cannot be an Indian mobile is refused");

  const r = await add({ name: "Padma Rani", phone: "9876500201", src: "phone",
    concern: "Hair fall", message: "Saturday 5pm ki randi annanu", heat: "hot", status: "contacted" });
  is(r.code, 200, "a real one is accepted");
  is(r.body.lead.src, "phone", "the source is kept");
  is(r.body.lead.manual, true, "and it is marked as typed in, not scraped from a channel");
  is(r.body.lead.by, "Owner", "with who entered it");


  const raw = h.run(["LRANGE", "dl_leads", "0", "9"]).map((x) => JSON.parse(x));
  is(raw.length, 1, "it is in the same list every other lead lives in");
  is(raw[0].phone, "9876500201", "with the number");
  is(h.run(["HGET", "dl_status", r.body.key]), "contacted", "the status the desk chose is set");
  const notes = JSON.parse(h.run(["HGET", "dl_notes", r.body.key]) || "[]");
  is(notes[0] && notes[0].text, "Saturday 5pm ki randi annanu", "and what they said became the first note");

  // the same number again
  const dupe = await add({ name: "Padma Rani", phone: "9876500201" });
  is(dupe.code, 409, "the same number this week is questioned, not silently doubled");
  is(/already vachindi/.test(dupe.body.error), true, "and it says when it came before");
  const anyway = await add({ name: "Padma Rani", phone: "9876500201", anyway: true });
  is(anyway.code, 200, "but the desk can insist");
  is(h.run(["LRANGE", "dl_leads", "0", "9"]).length, 2, "and then there are two");

  // an unknown source cannot be invented
  const odd = await add({ name: "Y", phone: "9876500202", src: "magic" });
  is(odd.body.lead.src, "walkin", "an unknown source falls back to walk-in");

  // The hospital system wants a patient, not just a name and a number.
  const full = await add({ name: "Lakshmi Devi", phone: "9876500210", src: "walkin",
    age: "34", gender: "female", concern: "Hydrafacial" });
  is(full.body.lead.age, "34", "age is kept");
  is(full.body.lead.gender, "female", "and gender");
  const payload = require(require("path").join(process.env.DL_API, "_clinic.js")).toClinicPayload(full.body.lead);
  is(payload.patient.age, "34", "and both reach the hospital payload");
  is(payload.patient.gender, "female", "so the record there is not half empty");
  is(payload.patient.phone, "+919876500210", "with the number in the shape they expect");

  // permissions
  h.run(["HSET", "staff:users", "9876500051", JSON.stringify({ name: "Sowmya", role: "reception" })]);
  h.run(["HSET", "staff:users", "9876500052", JSON.stringify({ name: "Accounts", role: "accounts" })]);
  const RECEPTION = mk({ p: "9876500051", n: "Sowmya", r: "reception", e: 0, exp: Date.now() + 86400000 });
  const ACCOUNTS = mk({ p: "9876500052", n: "Accounts", r: "accounts", e: 0, exp: Date.now() + 86400000 });
  is((await call({ a: "lead-add" }, { a: "lead-add", name: "Z", phone: "9876500203" }, RECEPTION)).code, 200,
     "reception can add a lead — that is the whole point");
  is((await call({ a: "lead-add" }, { a: "lead-add", name: "Z", phone: "9876500204" }, ACCOUNTS)).code, 403,
     "accounts, who cannot edit leads, cannot add one");
  is((await call({ a: "lead-add" }, { a: "lead-add", name: "Z", phone: "9876500205" })).code, 401,
     "and nobody without a login can add one at all");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ndesk lead entry behaves");
})();
