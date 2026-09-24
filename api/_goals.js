// Two numbers the clinic is actually trying to hit, and whether today is on
// the way to them.
//
// Everything else in this app reports what happened. A goal is the other
// direction: it says what has to happen, and it says it every morning while
// there is still time to do something about it. Two of them, because these
// are the two the owner names:
//
//   * academy seats  — N of the batch's seats taken, by the day it starts
//   * appointments   — N appointments in the month
//
// Nothing new is recorded for this. Seats come from acad:booked, which the
// academy engine already keeps; appointments are counted out of appt:q and
// appt:done, which the desk and the agent already write. So the goal cannot
// drift away from the truth — there is only one copy of the truth.
//
// The useful part is not the total, it is the pace: "12 of 40, and we should
// be at 18 by now" is a morning somebody can still fix. A month-end total is
// a post-mortem.
//
// KV: goal:cfg
const guard = require("./_guard.js");
const docs = require("./_docs.js");

const IST = "Asia/Kolkata";
const DAY = 86400000;
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const num = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return isFinite(n) && n >= lo ? Math.min(hi, n) : dflt; };

// The calendar in Eluru, not in UTC: at 00:30 IST the UTC date is still
// yesterday, and a month goal that changes month half a day early is wrong
// on the first and the last of every month.
function istParts(ts) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = f.format(new Date(ts || Date.now())).split("-").map(Number);
  return { y, m, d };
}
const istMonth = (ts) => { const p = istParts(ts); return `${p.y}-${String(p.m).padStart(2, "0")}`; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// Whole days from today to a date, counted by the calendar: the day itself is
// 0, not "less than one".
function daysTo(iso, now) {
  const a = istParts(now), b = String(iso || "").split("-").map(Number);
  if (!b[0]) return 0;
  const A = Date.UTC(a.y, a.m - 1, a.d), B = Date.UTC(b[0], b[1] - 1, b[2]);
  return Math.round((B - A) / DAY);
}

const DEFAULTS = { seats: docs.BATCH.seats, seatsBy: docs.BATCH.startISO, appts: 0 };

async function load(cfg) {
  const v = cfg ? parse(((await guard.kvCommand(cfg, ["GET", "goal:cfg"]).catch(() => ({}))) || {}).result || "", null) : null;
  const c = Object.assign({}, DEFAULTS, v || {});
  return {
    seats: num(c.seats, 0, docs.BATCH.seats, DEFAULTS.seats),   // 0 = not chasing seats
    seatsBy: /^\d{4}-\d{2}-\d{2}$/.test(String(c.seatsBy)) ? String(c.seatsBy) : DEFAULTS.seatsBy,
    appts: num(c.appts, 0, 5000, DEFAULTS.appts),               // per month; 0 = off
    by: String(c.by || "").slice(0, 40), ts: Number(c.ts) || 0,
  };
}

async function save(cfg, input, by) {
  const cur = await load(cfg);
  const next = Object.assign({}, cur, {
    seats: input.seats !== undefined ? num(input.seats, 0, docs.BATCH.seats, cur.seats) : cur.seats,
    seatsBy: input.seatsBy !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(input.seatsBy)) ? String(input.seatsBy) : cur.seatsBy,
    appts: input.appts !== undefined ? num(input.appts, 0, 5000, cur.appts) : cur.appts,
    by: String(by || "").slice(0, 40), ts: Date.now(),
  });
  // A date in the past is not a goal, it is a typo — and it would make every
  // morning report say "0 rojulu" for ever.
  if (next.seats > 0 && daysTo(next.seatsBy, Date.now()) < 0) {
    return { ok: false, error: "Seat goal date ade poyindi — mundu unna date pettandi" };
  }
  const r = await guard.kvCommand(cfg, ["SET", "goal:cfg", JSON.stringify(next)]);
  if (!r || r.error) return { ok: false, error: "Save avvaledu — malli try cheyandi" };
  return { ok: true, goals: next };
}

// Every appointment the clinic holds this IST month, out of the two lists the
// desk already writes. Cancelled and no-show do not count as an appointment
// kept; one that has not happened yet does, because it is booked.
async function apptsThisMonth(cfg, now) {
  const month = istMonth(now);
  const seen = new Set();
  let done = 0, ahead = 0;
  for (const key of ["appt:q", "appt:done"]) {
    const r = await guard.kvCommand(cfg, ["LRANGE", key, "0", "499"]).catch(() => ({}));
    for (const raw of (r.result || [])) {
      const a = parse(raw, null);
      if (!a || !a.at || !a.ph) continue;
      if (istMonth(a.at) !== month) continue;
      if (["cancelled", "noshow"].includes(a.status) || a.ns) continue;
      const id = `${String(a.ph).slice(-10)}|${a.at}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (a.at <= (now || Date.now())) done++; else ahead++;
    }
  }
  return { done, ahead, total: done + ahead, month };
}

// Where the two goals stand right now. `pace` is what the count should be by
// today if the month were spread evenly — the number that turns a total into
// a decision.
async function state(cfg, nowMs) {
  const now = nowMs || Date.now();
  const g = await load(cfg);
  const out = { seats: null, appts: null, ts: now };

  if (g.seats > 0) {
    const b = cfg ? await guard.kvCommand(cfg, ["GET", "acad:booked"]).catch(() => ({})) : {};
    const booked = Math.max(0, Math.min(docs.BATCH.seats, Number((b && b.result) || 0)));
    const left = Math.max(0, g.seats - booked);
    const days = daysTo(g.seatsBy, now);
    out.seats = {
      target: g.seats, by: g.seatsBy, booked, left, days,
      hit: left === 0,
      over: days < 0 && left > 0,
      // Once a week is how the clinic actually thinks about admissions.
      perWeek: left > 0 && days > 0 ? Math.round((left / Math.max(1, days / 7)) * 10) / 10 : 0,
    };
  }

  if (g.appts > 0) {
    const p = istParts(now);
    const total = daysInMonth(p.y, p.m);
    const a = await apptsThisMonth(cfg, now);
    const pace = Math.round((g.appts * p.d) / total);
    const left = Math.max(0, g.appts - a.total);
    const daysLeft = total - p.d;
    out.appts = {
      target: g.appts, month: a.month, done: a.done, ahead: a.ahead, total: a.total,
      pace, left, daysLeft, dayOfMonth: p.d, daysInMonth: total,
      behind: a.total < pace,
      hit: left === 0,
      // What the rest of the month has to look like. The day itself still
      // counts — it is morning when this is read.
      perDay: left > 0 ? Math.round((left / Math.max(1, daysLeft + 1)) * 10) / 10 : 0,
    };
  }
  return out;
}

// One line each for the morning message. Written the way the owner reads it:
// where we are, where we should be, and what today has to do.
function lines(st) {
  const out = [];
  const s = st && st.seats;
  if (s) {
    if (s.hit) out.push(`🎓 Academy: ${s.booked}/${s.target} seats — goal ayipoyindi ✅`);
    else if (s.over) out.push(`🎓 Academy: ${s.booked}/${s.target} seats · goal date dati poyindi — kotha date pettandi`);
    else out.push(`🎓 Academy: ${s.booked}/${s.target} seats · inka ${s.left} · ${s.days} rojulu${s.perWeek ? ` (vaaraniki ~${s.perWeek})` : ""}`);
  }
  const a = st && st.appts;
  if (a) {
    if (a.hit) out.push(`📅 Appointments: ${a.total}/${a.target} ee nela — goal ayipoyindi ✅`);
    else out.push(`📅 Appointments: ${a.total}/${a.target} ee nela · ippatiki ${a.pace} undali — ${a.behind ? `${a.pace - a.total} venakaunnam` : "track lo unnam"} · roju ~${a.perDay} kavali`);
  }
  return out;
}

module.exports = { load, save, state, lines, apptsThisMonth, istMonth, daysTo, DEFAULTS };
