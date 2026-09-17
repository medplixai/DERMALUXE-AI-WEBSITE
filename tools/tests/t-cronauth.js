// Who may run the scheduled jobs.
//
// Every cron here was written `if (process.env.CRON_SECRET) { ...check the
// bearer... }`. That reads as a guard and behaves as one only while the
// variable exists: remove it and the check is skipped entirely. These jobs
// publish to Instagram and Facebook, message patients on WhatsApp, and write
// encrypted backups — so the absent-variable case is the one that matters, and
// it is the one nobody would notice, because everything keeps working.
//
// This walks every cron endpoint there is rather than a list somebody has to
// remember to extend: a new cron added tomorrow is tested the day it lands.
const fs = require("fs");
const path = require("path");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const API = process.env.DL_API;
// Nothing may leave the building during this test.
const calls = [];
global.fetch = async (u) => { calls.push(String(u)); return { ok: true, status: 200, json: async () => ({}), text: async () => "" }; };

const CRONS = fs.readdirSync(API).filter((f) => /^cron-.*\.js$/.test(f)).map((f) => f.replace(/\.js$/, "")).sort();

const call = (mod, q, headers) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; },
    json(o) { resolve({ code: this._c, body: o }); return this; },
    send() { resolve({ code: this._c }); return this; },
    end() { resolve({ code: this._c }); return this; } };
  Promise.resolve(mod({ method: "GET", headers: headers || {}, query: q || {}, body: {} }, res))
    .catch((e) => resolve({ code: 500, body: { error: String(e && e.message) } }));
});

(async () => {
  console.log("WHO MAY RUN THE SCHEDULED JOBS\n");
  is(CRONS.length >= 7, true, `every cron endpoint on disk is checked: ${CRONS.join(", ")}`);

  console.log("\n  — with nothing configured, nothing runs —");
  for (const name of CRONS) {
    delete process.env.CRON_SECRET; delete process.env.ADMIN_KEY;
    const mod = h.load(name);
    const r = await call(mod, { key: "anything", now: "1", force: "1" }, { authorization: "Bearer anything" });
    is(r.code, 401, `${name} refuses rather than standing open`);
  }
  is(calls.length, 0, "and not one of them called out to Meta or anywhere else");

  console.log("\n  — with secrets set, the wrong one is still refused —");
  process.env.CRON_SECRET = "cron-secret"; process.env.ADMIN_KEY = "admin-key";
  for (const name of CRONS) {
    const mod = h.load(name);
    const bad = await call(mod, { key: "guess" }, { authorization: "Bearer guess" });
    is(bad.code, 401, `${name} refuses a wrong key`);
  }

  console.log("\n  — and the two who should get in, do —");
  for (const name of CRONS) {
    const mod = h.load(name);
    const byCron = await call(mod, {}, { authorization: "Bearer cron-secret" });
    const byKey = await call(mod, { key: "admin-key" }, {});
    is(byCron.code !== 401, true, `${name}: Vercel's scheduler`);
    is(byKey.code !== 401, true, `${name}: and the owner by hand`);
  }

  console.log("\n  — the override bar on the academy job is still higher —");
  // force/day/dry can mass-message students, so the scheduler's own secret is
  // not enough for those — they need the admin key.
  const acad = h.load("cron-academy");
  is((await call(acad, { force: "1" }, { authorization: "Bearer cron-secret" })).code, 403,
    "the cron secret alone cannot force a re-send");
  is((await call(acad, { force: "1", key: "admin-key" }, {})).code !== 403, true,
    "but the admin key can");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe scheduled jobs are all gated");
  process.exit(fails ? 1 : 0);
})();
