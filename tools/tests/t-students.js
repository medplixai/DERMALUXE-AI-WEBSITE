// Where a student stands, set by hand (owner PDF 12 Nov, point 2): active,
// training, inactive with a reason, discontinued with a reason. Rama booked
// a seat, paid ₹9,999 and stopped coming — the desk needed one place to say
// so, and why, and a filter that finds everyone in that state.
const crypto = require("crypto");
const h = require("./harness.js");
const academy = h.load("academy");
const seats = h.load("_seats");
const docs = require(require("path").join(process.env.DL_API, "_docs.js"));
const mk = (o) => { const p = Buffer.from(JSON.stringify(o)).toString("base64url");
  return p + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(p).digest("hex"); };
const OWNER = mk({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: Date.now() + 86400000 });
const A = (q, b) => h.call(academy, q, b, { headers: { authorization: "Bearer " + OWNER } });
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("STUDENT STATUS — active, training, inactive, discontinued, with the reason\n");
  const cfg = { kind: "pg" };
  const add = await A({ a: "create" }, { a: "create", name: "Rama Lakshmi", phone: "9876500071", course: "skin", paid: 9999 });
  is(add.code, 200, "a student is admitted");
  const id = add.body.student.id;
  is(add.body.student.status, "enrolled", "and starts as a booked seat");
  is(await seats.booked(cfg), 1, "which takes one seat of batch " + docs.BATCH.no);

  const noWhy = await A({ a: "status" }, { a: "status", id, status: "inactive" });
  is(noWhy.code, 400, "inactive without a reason is refused");
  is(/Reason/.test(noWhy.body.error), true, "and the error asks for one");

  const idle = await A({ a: "status" }, { a: "status", id, status: "inactive", reason: "Classes ki raavadam ledu — interest ledu annaru" });
  is(idle.code, 200, "inactive with a reason is set");
  is([idle.body.student.status, idle.body.student.statusReason, idle.body.student.statusBy], ["inactive", "Classes ki raavadam ledu — interest ledu annaru", "Owner"], "the reason and who set it stay on the record");
  is(/^Inactive — /.test(idle.body.student.progress.where), true, "the one-line progress says inactive and why");
  is(await seats.booked(cfg), 1, "she paid for the seat, so inactive still holds it");

  const list = await A({ a: "list" });
  is(list.body.students[0].statusReason, "Classes ki raavadam ledu — interest ledu annaru", "the Students tab gets the reason with the list");

  const tr = await A({ a: "status" }, { a: "status", id, status: "training" });
  is([tr.code, tr.body.student.status, tr.body.student.statusReason], [200, "training", ""], "training needs no reason, and the old reason does not linger");
  is((await A({ a: "status" }, { a: "status", id, status: "paused" })).code, 400, "a status that is not on the list is refused");

  const gone = await A({ a: "status" }, { a: "status", id, status: "dropped", reason: "Job vachindi, Hyderabad vellipoyaru" });
  is(gone.body.student.status, "dropped", "discontinued, with a reason");
  is(await seats.booked(cfg), 0, "frees the seat");
  const rec = JSON.parse(h.run(["GET", "acad:st:" + id]));
  is(rec.statusLog.length, 3, "every change is logged, nothing overwritten without a trace");
  is([rec.statusLog[0].from, rec.statusLog[0].to, rec.statusLog[0].reason], ["training", "dropped", "Job vachindi, Hyderabad vellipoyaru"], "newest first, with from, to and why");

  // The course keeps reaching a student the desk marked "training" — the
  // cron's daily material and the owner's broadcast read the same rule.
  const inCourse = seats.inCourse;
  is([inCourse({ status: "enrolled" }), inCourse({ status: "active" }), inCourse({ status: "training" }), inCourse({}), inCourse({ status: "inactive" }), inCourse({ status: "dropped" }), inCourse({ status: "completed" })],
     [true, true, true, true, false, false, false], "material and notices go to booked, active and training students — not inactive, discontinued or finished ones");
  const src = (f) => require("fs").readFileSync(require("path").join(process.env.DL_API, f), "utf8");
  is([/inCourse\(s\)/.test(src("cron-academy.js")), /inCourse\(st\)/.test(src("_admin.js"))], [true, true], "and the daily cron and 'academy notify' both use that rule, not a list of their own");

  // The front desk takes the fee at the counter (owner, 12 Nov: "reception
  // ki record payment power ivvu"). Read from the real role table.
  // The harness stubs staff.js for the endpoints; borrow the real one for a
  // moment and put the stub back, so the permission checks below still bite.
  const sp = require("path").join(process.env.DL_API, "staff.js"), stub = require.cache[sp];
  delete require.cache[sp];
  const realStaff = require(sp);
  require.cache[sp] = stub;
  is([realStaff.can({ role: "reception" }, "academy.money"), realStaff.can({ role: "reception" }, "academy.certify"), realStaff.can({ role: "reception" }, "academy.delete")], [true, false, false],
     "reception can record an academy payment — but still not certify or delete a student");
  h.as(realStaff.capsOf("reception"));   // exactly the reception role's powers
  const paid = await A({ a: "pay" }, { a: "pay", id, amount: 45000, ref: "UPI" });
  is([paid.code, (paid.body.student || {}).paid], [200, 54999], "with that power the payment goes on the student's record");
  h.as(["*"]);

  h.as(["academy.view"]);
  is((await A({ a: "status" }, { a: "status", id, status: "active" })).code, 403, "a role that can only look cannot change it");
  h.as(["*"]);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nstudent status behaves");
  process.exit(fails ? 1 : 0);
})();
