// Academy seats: one number, from the students on the books. 9 Nov 2026 the
// Academy tab showed a student and the Leads tab said 0/10, because the tile
// read a hand-typed count nobody had typed.
const h = require("./harness.js");
const docs = require(require("path").join(process.env.DL_API, "_docs.js"));
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const seats = h.load("_seats");
const cfg = { kind: "pg" };
const student = (id, extra) => { h.run(["SET", `acad:st:${id}`, JSON.stringify(Object.assign({ id, name: id, phone: "98765" + id.slice(-5).padStart(5, "0"), status: "active", batch: 1, fee: 49999, paid: 0 }, extra || {}))]); h.run(["LPUSH", "acad:st:list", id]); };

(async () => {
  console.log("SEATS — the students on the books, not a typed number\n");
  is([await seats.booked(cfg), await seats.left(cfg)], [0, docs.BATCH.seats], "nothing on the books, every seat open");

  student("DLA-1001", { paid: 9999, batch: 1 });
  is(await seats.booked(cfg), 1, "a student the desk added holds a seat — whatever batch number her record carries");
  student("DLA-1002", { status: "enrolled", paid: 0 });
  is(await seats.booked(cfg), 2, "a student still to pay holds one too — the desk created her on purpose");
  student("DLA-1003", { status: "dropped", paid: 9999 });
  student("DLA-1004", { status: "enquiry" });
  student("DLA-1005", { status: "completed", paid: 49999 });
  is(await seats.booked(cfg), 2, "dropped, enquiry-only and completed do not");

  h.run(["SET", "acad:booked", "4"]);
  is(await seats.booked(cfg), 4, "the owner's typed count counts when it says more (a seat reserved outside the app)");
  h.run(["SET", "acad:booked", "1"]);
  is(await seats.booked(cfg), 2, "and the students count when they are more — the typed number cannot hide them");
  h.run(["SET", "acad:booked", "99"]);
  is(await seats.booked(cfg), docs.BATCH.seats, "never more seats than the batch has");
  h.run(["DEL", "acad:booked"]);

  h.run(["SET", "acad:st:DLA-1006", "not json"]); h.run(["LPUSH", "acad:st:list", "DLA-1006"]);
  is(await seats.booked(cfg), 2, "a broken record is skipped, not counted and not a crash");

  is(await seats.booked(null), 0, "with no store at all the answer is 0, never a guess");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nseats add up");
})();
