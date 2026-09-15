// The bridge to the hospital system, and the desk's own lead entry.
process.env.CLINIC_SYNC_URL = "";
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("HOSPITAL BRIDGE — what the owner can see and press\n");
  const hms = h.load("hms");
  const st = await h.call(hms, { a: "status" });
  is(st.body.connected, false, "with nothing configured it says so plainly");
  is(st.body.missing, ["CLINIC_SYNC_URL", "CLINIC_TENANT_ID"], "and names exactly what is missing");
  is(st.body.waiting, 0, "nothing is waiting");
  const t = await h.call(hms, { a: "test" }, { a: "test" });
  is(t.code, 400, "testing before it is configured is refused, not faked");

  h.as(["money.view"]);
  is((await h.call(hms, { a: "status" })).code, 403, "the bridge is the owner's only");
  h.as(["*"]);

  // now with it configured, and the platform refusing
  console.log("\n  — with a URL set, and the hospital refusing —");
  process.env.CLINIC_SYNC_URL = "https://hospital.invalid/ingest";
  process.env.CLINIC_TENANT_ID = "dlx-eluru";
  delete require.cache[require("path").join(process.env.DL_API, "hms.js")];
  const hms2 = h.load("hms");
  const st2 = await h.call(hms2, { a: "status" });
  is(st2.body.connected, true, "it reports connected");
  is(st2.body.host, "hospital.invalid", "with the host, and never the key");
  is(st2.body.hasKey !== undefined && st2.body.apiKey === undefined, true, "the key itself is never sent to the screen");

  const t2 = await h.call(hms2, { a: "test" }, { a: "test" });
  is(t2.code, 502, "a failing platform is reported as failing");
  const after = await h.call(hms2, { a: "status" });
  is(after.body.waiting, 0, "and the test lead does NOT stay in the queue as a fake patient");
  is(!!after.body.last && after.body.last.ok === false, true, "but the failed attempt is remembered");

  // The queue is a list that failures are pushed onto the front of. Reading
  // it and then removing "the first N" are two separate round trips, and a
  // lead that fails in between lands exactly in that gap.
  console.log("\n  — a lead is parked in the gap between reading the queue and clearing it —");
  const clinic = require(require("path").join(process.env.DL_API, "_clinic.js"));
  const guard = require(require("path").join(process.env.DL_API, "_guard.js"));
  h.run(["DEL", clinic.PENDING_KEY]);
  for (const n of ["old-1", "old-2", "old-3"]) h.run(["LPUSH", clinic.PENDING_KEY, JSON.stringify({ ts: Date.now(), name: n })]);

  // The instant the queue has been read, somebody else's lead fails and is
  // parked. This is the window, and nothing else in the test can reach it.
  const realCmd = guard.kvCommand;
  let slipped = false;
  guard.kvCommand = async (cfg2, cmd) => {
    const out = await realCmd(cfg2, cmd);
    if (!slipped && cmd[0] === "LRANGE" && cmd[1] === clinic.PENDING_KEY) {
      slipped = true;
      h.run(["LPUSH", clinic.PENDING_KEY, JSON.stringify({ ts: Date.now(), name: "BRAND NEW" })]);
    }
    return out;
  };
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error("hospital down"); };
  const out = await h.call(hms2, { a: "retry" }, { a: "retry" });
  global.fetch = realFetch;
  guard.kvCommand = realCmd;

  const left = h.run(["LRANGE", clinic.PENDING_KEY, "0", "99"]).map((x) => JSON.parse(x).name);
  is(out.body.sent, 0, "nothing got through");
  is(left.includes("BRAND NEW"), true, "the lead parked in that gap survives");
  is(["old-1", "old-2", "old-3"].every((n) => left.includes(n)), true, "and all three that failed are back");
  is(left.length, 4, "four waiting, none lost and none duplicated");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe bridge behaves");
})();
