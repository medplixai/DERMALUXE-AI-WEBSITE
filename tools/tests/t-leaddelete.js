// Deleting one lead must delete that lead — and nothing else.
//
// The old way read the list, deleted the whole of it, and wrote back what
// should stay. Each case below is a way that lost leads without a word.
const path = require("path");
const h = require("./harness.js");
process.env.ADMIN_KEY = "k";
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const guard = require(path.join(process.env.DL_API, "_guard.js"));
const del = h.load("lead-delete");
// leads.html calls this from the site itself, so the origin check must see the site.
const call = (body) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve({ code: this._c, body: o }); return this; } };
  del({ method: "POST", headers: { origin: "https://www.dermaluxe.ai" }, query: {}, body }, res);
});
const D = (b) => call(Object.assign({ key: "k" }, b));
const lead = (i, extra) => JSON.stringify(Object.assign({ ts: 1000 + i, phone: "98765" + String(10000 + i), name: "L" + i }, extra));
const reset = (n) => { h.run(["DEL", "dl_leads"]); for (let i = 0; i < n; i++) h.run(["RPUSH", "dl_leads", lead(i)]); };
const count = () => h.run(["LLEN", "dl_leads"]);

(async () => {
  console.log("DELETING A LEAD\n");
  is((await call({ ts: 1, phone: "1" })).code, 401, "no key, no delete");

  reset(5);
  h.run(["HSET", "dl_status", "1002|9876510002", "booked"]);
  const r = await D({ ts: 1002, phone: "9876510002" });
  is([r.code, r.body.removed], [200, 1], "the one lead goes");
  is(count(), 4, "and only that one");
  is(h.run(["HGET", "dl_status", "1002|9876510002"]), null, "its status goes with it");

  console.log("\n  — what the old way lost —");
  // A lead that arrives while the delete is working.
  reset(5);
  const orig = guard.kvCommand; let armed = true;
  guard.kvCommand = async (cfg, c) => {
    const out = await orig(cfg, c);
    if (armed && c[0] === "LRANGE" && c[1] === "dl_leads") { armed = false; h.run(["LPUSH", "dl_leads", lead(99, { name: "Arrived mid-delete" })]); }
    return out;
  };
  await D({ ts: 1001, phone: "9876510001" });
  guard.kvCommand = orig;
  is(h.run(["LRANGE", "dl_leads", "0", "-1"]).some((x) => x.includes("Arrived mid-delete")), true, "a lead that came in during the delete is still there");

  // More than 5000 leads.
  reset(6000);
  await D({ ts: 1003, phone: "9876510003" });
  is(count(), 5999, "with 6000 leads, deleting one leaves 5999 — not the first 5000");

  // An entry that will not parse.
  reset(3);
  h.run(["RPUSH", "dl_leads", "{not json"]);
  await D({ ts: 1000, phone: "9876510000" });
  is(h.run(["LRANGE", "dl_leads", "0", "-1"]).includes("{not json"), true, "an entry that cannot be read is left alone, not thrown away");

  console.log("\n  — test cleanup —");
  reset(3);
  h.run(["RPUSH", "dl_leads", lead(50, { name: "Setup Test 1" })]);
  h.run(["RPUSH", "dl_leads", lead(51, { name: "Spam Bot x" })]);
  const c = await D({ testCleanup: true });
  is([c.body.removed, count()], [2, 3], "removes the test leads and only those");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ndeleting a lead behaves");
  process.exit(fails ? 1 : 0);
})();
