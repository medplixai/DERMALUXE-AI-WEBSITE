const h = require("./harness.js");
const pkg = h.load("package");
const P = (q, b) => h.call(pkg, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("PACKAGES — a six-sitting laser, one sitting at a time\n");
  const c = await P({ a: "create" }, { a: "create", phone: "9876500031", name: "Sita", treatment: "Laser — full face", total: 6, gapDays: 30, fee: 24000 });
  is(c.code, 200, "package created");
  const id = c.body.pkg.id;
  is(c.body.pkg.total, 6, "six sittings");
  is(c.body.pkg.done, 0, "none done");
  is(c.body.pkg.left, 6, "six left");

  for (let i = 1; i <= 5; i++) await P({ a: "log" }, { a: "log", id, note: "sitting " + i });
  let of1 = await P({ a: "of", phone: "9876500031" });
  is(of1.body.rows[0].done, 5, "five logged");
  is(of1.body.rows[0].left, 1, "one to go");

  const last = await P({ a: "log" }, { a: "log", id });
  is(last.body.pkg.left, 0, "the sixth finishes it");
  const seventh = await P({ a: "log" }, { a: "log", id });
  is(seventh.code, 400, "a seventh sitting is refused");
  is(h.run(["LRANGE", "pkg:open", "0", "9"]).includes(id), false, "a finished package leaves the open list");

  // limits
  const big = await P({ a: "create" }, { a: "create", phone: "9876500032", treatment: "X", total: 999 });
  is(big.body.pkg.total, 24, "an absurd number of sittings is capped at 24");
  const small = await P({ a: "create" }, { a: "create", phone: "9876500033", treatment: "X", total: 1 });
  is(small.body.pkg.total, 2, "one sitting is not a package — floored at 2");
  const noName = await P({ a: "create" }, { a: "create", phone: "9876500034", treatment: "" });
  is(noName.code, 400, "needs a treatment name");

  // dropping
  const d = await P({ a: "create" }, { a: "create", phone: "9876500035", treatment: "Peel", total: 4 });
  await P({ a: "log" }, { a: "log", id: d.body.pkg.id });
  const dr = await P({ a: "drop" }, { a: "drop", id: d.body.pkg.id });
  is(dr.body.pkg.status, "dropped", "a package can be stopped part-way");
  is(h.run(["LRANGE", "pkg:open", "0", "9"]).includes(d.body.pkg.id), false, "and stops being chased");
  const logAfter = await P({ a: "log" }, { a: "log", id: d.body.pkg.id });
  console.log(`  ·   logging a sitting on a dropped package → ${logAfter.code}`);

  // what is due
  const e = await P({ a: "create" }, { a: "create", phone: "9876500036", treatment: "PRP", total: 6, gapDays: 30 });
  await P({ a: "log" }, { a: "log", id: e.body.pkg.id });
  const due0 = await P({ a: "due" });
  is((due0.body.rows || []).some((r) => r.id === e.body.pkg.id), false, "a sitting done today is not due tomorrow");

  // make the last sitting 40 days old
  const raw = JSON.parse(h.run(["GET", "pkg:" + e.body.pkg.id]));
  raw.sessions[0].at = Date.now() - 40 * 86400000;
  h.run(["SET", "pkg:" + e.body.pkg.id, JSON.stringify(raw)]);
  const due1 = await P({ a: "due" });
  is((due1.body.rows || []).some((r) => r.id === e.body.pkg.id), true, "40 days after a 30-day gap, it is due");

  h.as(["leads.view"]);
  const noPerm = await P({ a: "log" }, { a: "log", id: e.body.pkg.id });
  is(noPerm.code, 403, "logging a sitting needs the permission");
  h.as(["*"]);
  console.log(fails ? `\n${fails} FAILURE(S)` : "\npackages behave");
})();
