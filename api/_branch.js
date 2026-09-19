// Branches. DermaLuxe is one clinic today; Medicare runs ten. Every new
// lead, bill, appointment and expense is stamped with the branch it belongs
// to from now on, so that the day a second branch opens its history is
// already separable. Records written before this have no stamp and belong
// to the first branch.
//
// BRANCHES (env) = [{"id":"eluru","name":"DermaLuxe Eluru"}, ...]. With one
// branch nothing is filtered and nothing on screen changes. With more, a
// colleague pinned to a branch sees only theirs; the owner sees all, or picks.
function list() {
  try {
    const v = JSON.parse(process.env.BRANCHES || "null");
    if (Array.isArray(v) && v.length) {
      const out = v.map((b) => ({ id: String(b.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20), name: String(b.name || b.id || "").slice(0, 60) })).filter((b) => b.id);
      if (out.length) return out;
    }
  } catch (e) {}
  return [{ id: "eluru", name: "DermaLuxe Eluru" }];
}
const def = () => list()[0].id;
const multi = () => list().length > 1;
const valid = (id) => list().some((b) => b.id === String(id || ""));
const of = (rec) => (rec && valid(rec.branch) ? rec.branch : def());
// Which branch this person's screens show: null = all.
function scope(me, q) {
  if (!multi()) return null;
  if (me && me.role !== "owner" && valid(me.branch)) return me.branch;
  const want = String((q && q.branch) || "");
  return valid(want) ? want : null;
}
const keep = (sc) => (rec) => !sc || of(rec) === sc;
// The branch a new record gets: what was asked if valid, else the person's, else the first.
const pick = (asked, me) => (valid(asked) ? String(asked) : (me && valid(me.branch) ? me.branch : def()));

module.exports = { list, def, multi, valid, of, scope, keep, pick };
