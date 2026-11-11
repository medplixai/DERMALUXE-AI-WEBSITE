// How many of the batch's seats are taken, from the one place a reserved seat
// actually lives: the student records (acad:st:*). The owner's hand-typed
// count — "academy booked N" on WhatsApp, or the seat board — stays as a
// floor, for a seat reserved outside the app.
//
// 9 Nov 2026: the desk added a student, the Academy tab showed her, and the
// Leads tab still said "Academy seats 0/10". Eight places read the hand-typed
// number and nothing read the students, so the two screens disagreed and the
// WhatsApp agent told people ten seats were open. Every reader now comes here.
const guard = require("./_guard.js");
const docs = require("./_docs.js");

// A student who is enrolled or active holds a seat, paid or still owing —
// the desk created that record on purpose. An "enquiry" record is somebody
// who only asked; "completed" and "dropped" have left.
const holdsSeat = (s) => !!s && !["dropped", "enquiry", "completed"].includes(String(s.status || ""));
// ...and holds it in ONE batch. On 9 Nov the batch number was ignored on
// purpose (the one student was still marked batch 1 while joining batch 2).
// On 11 Nov the owner read the board the other way: "Batch #2 · 10 Nov" showed
// seat 1 Booked, the seat opened Rama, and Rama is Batch #1 — so Batch #2 has
// nobody. A record with no batch number is from before batches were numbered
// and counts for the current one. Moving a student is one tap on the Students
// tab ("Batch N ki marchu").
const inBatch = (s) => !!s && (s.batch == null || s.batch === "" || Number(s.batch) === docs.BATCH.no);

async function fromStudents(cfg) {
  const ids = (((await guard.kvCommand(cfg, ["LRANGE", "acad:st:list", "0", "299"]).catch(() => ({}))) || {}).result) || [];
  if (!ids.length) return 0;
  const r = await guard.kvCommand(cfg, ["MGET"].concat(ids.map((id) => `acad:st:${id}`))).catch(() => ({}));
  let n = 0;
  for (const v of ((r && r.result) || [])) {
    let s = null; try { s = v ? JSON.parse(v) : null; } catch (e) {}
    if (holdsSeat(s) && inBatch(s)) n++;
  }
  return n;
}

async function booked(cfg) {
  if (!cfg) return 0;
  const [m, s] = await Promise.all([
    guard.kvCommand(cfg, ["GET", "acad:booked"]).catch(() => ({})),
    fromStudents(cfg).catch(() => 0),
  ]);
  const manual = Math.max(0, Number((m && m.result) || 0) || 0);
  return Math.max(0, Math.min(docs.BATCH.seats, Math.max(manual, s)));
}

async function left(cfg) { return Math.max(0, docs.BATCH.seats - (await booked(cfg))); }

module.exports = { booked, left, fromStudents, holdsSeat, inBatch };
