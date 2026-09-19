// /api/schedule — the clinic's day.
//
// Appointments already existed, but only as {ph, name, at, concern} pushed
// into a list by the WhatsApp agent: no doctor, no room, no duration, no way
// to reschedule, and no way for one therapist to see just their own day.
//
// The list stays where it is — the agent and the reminder crons keep writing
// to `appt:q` and nothing had to change on their side. This file adds the
// fields those records were missing, edits them in place, and tells the
// patient when something moves.
//
// A record can now carry: id, mins, staff (phone) + staffName, room, status
// (booked | arrived | done | cancelled | noshow) and a note. Records written
// by the agent have none of that and are treated as booked, unassigned.
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");
const notify = require("./_notify.js");

const Q = "appt:q", DONE = "appt:done";
const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const STATUS = ["booked", "arrived", "done", "cancelled", "noshow"];

const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
const istTime = (ts) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ts));

// Read the queue with the raw string kept, because editing a record means
// removing that exact string and pushing the new one.
async function readQ(cfg) {
  const r = await guard.kvCommand(cfg, ["LRANGE", Q, "0", "399"]).catch(() => ({}));
  const out = [];
  for (const raw of (r.result || [])) {
    const a = parse(raw, null);
    if (a && a.at) out.push({ raw, a });
  }
  return out;
}
const shape = (a) => ({
  id: a.id || "", ph: digits10(a.ph), name: a.name || "Patient", at: a.at,
  concern: a.concern || a.treatment || "",
  mins: Number(a.mins) > 0 ? Number(a.mins) : 30,
  staff: digits10(a.staff) || "", staffName: a.staffName || "",
  room: a.room || "", status: STATUS.includes(a.status) ? a.status : "booked",
  cf: !!a.cf, note: a.note || "", day: istDay(a.at), time: istTime(a.at),
});

async function replace(cfg, rawOld, next) {
  await guard.kvCommand(cfg, ["LREM", Q, "1", rawOld]).catch(() => {});
  await guard.kvCommand(cfg, ["LPUSH", Q, JSON.stringify(next)]).catch(() => {});
}
async function findOne(cfg, id, ph, at) {
  const rows = await readQ(cfg);
  const wanted = String(id || "");
  for (const row of rows) {
    if (wanted && row.a.id === wanted) return row;
    // records the agent wrote have no id — match the person and the minute
    if (!wanted && ph && at && digits10(row.a.ph) === digits10(ph) && Math.abs(Number(row.a.at) - Number(at)) < 60000) return row;
  }
  return null;
}

// Two appointments for the same person cannot overlap, and neither can two
// for the same doctor. Reception should hear about it before the patient does.
function clash(rows, next, skipId) {
  const s1 = next.at, e1 = next.at + (next.mins || 30) * 60000;
  for (const { a } of rows) {
    if (skipId && a.id === skipId) continue;
    if (["cancelled", "done", "noshow"].includes(a.status)) continue;
    const s2 = Number(a.at), e2 = s2 + (Number(a.mins) || 30) * 60000;
    if (!(s1 < e2 && s2 < e1)) continue;
    if (next.staff && digits10(a.staff) === next.staff) return { who: "doctor", name: a.staffName || "aa doctor", at: istTime(s2), name2: a.name };
    if (digits10(a.ph) === next.ph) return { who: "patient", name: a.name, at: istTime(s2) };
  }
  return null;
}

// Somebody who did not turn up is not a lost cause, they are a person whose
// morning went wrong. Ask them back rather than filing them away.
async function tellRebook(ph, first) {
  if (!ph) return false;
  try {
    const ok = await notify.sendWa(ph,
      `Hi ${first}! 🙏 Ivala mee DermaLuxe appointment miss ayinattu undi — parledu!\n\nMalli convenient time book chesukovalante ee message ki reply cheyandi 😊 Ee week slots available unnayi.`);
    if (ok) return true;
    const t = await notify.sendWaTemplate(ph, "clinic_update", [first, "Mee appointment miss ayindi — malli book chesukovalante reply cheyandi. Ee week slots unnayi."]);
    return !!(t && t.ok);
  } catch (e) { console.error("schedule: rebook", e && e.message); return false; }
}

async function tellPatient(ph, text) {
  if (!ph) return;
  try {
    if (await notify.sendWa(ph, text)) return;
    await notify.sendWaTemplate(ph, "clinic_update", [String(text).split(" ")[0] || "Hi", String(text).slice(0, 250)]);
  } catch (e) { console.error("schedule: notify", e && e.message); }
}

// Booking, in one place: the AI Office approves through here too, so a
// booking made from a suggestion gets the same clash check and sends the
// same message to the patient as one typed in by hand.
async function createAppt(cfg, me, b) {
  const ph = digits10(b.ph);
  const at = Number(b.at);
  if (!/^[6-9]\d{9}$/.test(ph)) return { code: 400, body: { error: "Valid number ivvandi" } };
  if (!at || at < Date.now() - 86400000) return { code: 400, body: { error: "Sarpaina date & time ivvandi" } };
  const next = {
    id: crypto.randomBytes(6).toString("hex"),
    ph, name: clean(b.name, 60) || "Patient", at,
    concern: clean(b.concern, 80),
    mins: Math.max(10, Math.min(240, Number(b.mins) || 30)),
    staff: digits10(b.staff), staffName: clean(b.staffName, 40),
    room: clean(b.room, 20), status: "booked", cf: false,
    note: clean(b.note, 200), by: me.name, ts: Date.now(),
  };
  const rows = await readQ(cfg);
  const cl = clash(rows, next, null);
  if (cl && !b.force) {
    return { code: 409, body: {
      error: cl.who === "doctor"
        ? `${cl.name} ki aa time lo already ${cl.name2 || "oka patient"} undi (${cl.at}). Vere time chudandi.`
        : `Ee patient ki aa time lo already appointment undi (${cl.at}).`,
      clash: cl,
    } };
  }
  await guard.kvCommand(cfg, ["LPUSH", Q, JSON.stringify(next)]);
  await tellPatient(ph, `📅 ${next.name}, mee appointment book ayindi — ${istTime(at)}, ${new Date(at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}.\nDermaLuxe by Medicare, Eluru.`);
  return { code: 200, body: { ok: true, appt: shape(next) } };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("appts.view")) return json(res, 403, { error: "Mee role ki appointments chuse permission ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "day");
  if (req.method === "POST" && await guard.idem(cfg, b, res)) return json(res, 200, { ok: true, dup: true });

  // ---- the day, or the week ----
  if (a === "day" || a === "week") {
    const rl = await guard.rateLimit(cfg, `rl:sch:${me.phone}`, 300, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const rows = (await readQ(cfg)).map((r) => shape(r.a));

    // who can be assigned an appointment
    const users = await guard.kvCommand(cfg, ["HGETALL", "staff:users"]).catch(() => ({}));
    const uh = {}; const ua = (users && users.result) || {};
    if (Array.isArray(ua)) { for (let i = 0; i + 1 < ua.length; i += 2) uh[ua[i]] = parse(ua[i + 1], {}); }
    else Object.assign(uh, Object.fromEntries(Object.entries(ua).map(([k, v]) => [k, parse(v, {})])));
    const team = Object.keys(uh).map((ph) => ({ phone: ph, name: (uh[ph] || {}).name || ph, role: (uh[ph] || {}).role || "staff" }));

    if (a === "day") {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(q.day || "")) ? String(q.day) : istDay(Date.now());
      let list = rows.filter((r) => r.day === day).sort((x, y) => x.at - y.at);
      const mine = list.filter((r) => r.staff === me.phone);
      return json(res, 200, {
        ok: true, day, rows: list, mine: mine.length, team,
        counts: {
          total: list.length,
          booked: list.filter((r) => r.status === "booked").length,
          arrived: list.filter((r) => r.status === "arrived").length,
          done: list.filter((r) => r.status === "done").length,
          unconfirmed: list.filter((r) => r.status === "booked" && !r.cf).length,
        },
      });
    }
    // seven days from today, for the strip above the day view
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = istDay(Date.now() + i * 86400000);
      const list = rows.filter((r) => r.day === d);
      days.push({ day: d, total: list.length, mine: list.filter((r) => r.staff === me.phone).length });
    }
    return json(res, 200, { ok: true, days, team });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (!allow("appts.edit")) return json(res, 403, { error: "Mee role ki appointments marche permission ledu" });
  const rl2 = await guard.rateLimit(cfg, `rl:sche:${me.phone}`, 200, 3600);
  if (!rl2.allowed) return json(res, 429, { error: "Too many requests" });

  if (a === "create") {
    const out = await createAppt(cfg, me, b);
    return json(res, out.code, out.body);
  }

  // For a reschedule, `at` is where it is going — the record is still found at
  // `oldAt`. Records the agent wrote have no id, so that lookup matters.
  const found = await findOne(cfg, b.id, b.ph, b.oldAt || b.at);
  if (!found) return json(res, 404, { error: "Appointment dorakaledu — refresh chesi malli try cheyandi" });
  const cur = Object.assign({}, found.a);
  if (!cur.id) cur.id = crypto.randomBytes(6).toString("hex");   // give legacy records one

  // move it, and tell the patient
  if (a === "move") {
    const at = Number(b.at);
    if (!at) return json(res, 400, { error: "Kotha time ivvandi" });
    const next = Object.assign({}, cur, { at, r9: false, r2: false, cf: false, movedBy: me.name, movedAt: Date.now() });
    const rows = await readQ(cfg);
    const cl = clash(rows, shape(next), cur.id);
    if (cl && !b.force) return json(res, 409, { error: `Aa time lo already undi (${cl.at}). Vere time chudandi.`, clash: cl });
    await replace(cfg, found.raw, next);
    await tellPatient(cur.ph, `📅 ${cur.name || "Hi"}, mee appointment ${istTime(at)} ki marchamu (${new Date(at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}). Ibbandi unte cheppandi.`);
    return json(res, 200, { ok: true, appt: shape(next) });
  }

  if (a === "assign") {
    const next = Object.assign({}, cur, {
      staff: digits10(b.staff), staffName: clean(b.staffName, 40),
      room: clean(b.room, 20), mins: Math.max(10, Math.min(240, Number(b.mins) || cur.mins || 30)),
    });
    const rows = await readQ(cfg);
    const cl = next.staff ? clash(rows, shape(next), cur.id) : null;
    if (cl && cl.who === "doctor" && !b.force) return json(res, 409, { error: `Aa time lo vaariki already ${cl.name2 || "oka patient"} undi (${cl.at}).`, clash: cl });
    await replace(cfg, found.raw, next);
    return json(res, 200, { ok: true, appt: shape(next) });
  }

  if (a === "status") {
    const st = String(b.status || "").toLowerCase();
    if (!STATUS.includes(st)) return json(res, 400, { error: "bad status" });
    const next = Object.assign({}, cur, { status: st, note: b.note !== undefined ? clean(b.note, 200) : cur.note });
    if (st === "cancelled") {
      await guard.kvCommand(cfg, ["LREM", Q, "1", found.raw]).catch(() => {});
      await guard.kvCommand(cfg, ["LPUSH", DONE, JSON.stringify(next)]).catch(() => {});
      await guard.kvCommand(cfg, ["LTRIM", DONE, "0", "499"]).catch(() => {});
      await tellPatient(cur.ph, `${cur.name || "Hi"}, mee appointment cancel chesamu. Kotha time kavalante ee message ki reply cheyandi 🙏`);
      return json(res, 200, { ok: true, cancelled: true });
    }
    if (st === "done" || st === "noshow") {
      // Marking a no-show over WhatsApp has always invited the patient to
      // rebook. Marking the same thing here did not — it just filed them away
      // and they were never heard from again. Same state, same message.
      let invited = false;
      if (st === "noshow" && !cur.ns) {
        next.ns = 1;
        const first = String(cur.name || "").trim().split(" ")[0] || "andi";
        invited = await tellRebook(cur.ph, first);
      }
      await guard.kvCommand(cfg, ["LREM", Q, "1", found.raw]).catch(() => {});
      await guard.kvCommand(cfg, ["LPUSH", DONE, JSON.stringify(next)]).catch(() => {});
      await guard.kvCommand(cfg, ["LTRIM", DONE, "0", "499"]).catch(() => {});
      return json(res, 200, { ok: true, appt: shape(next), moved: "done", invited });
    }
    await replace(cfg, found.raw, next);
    return json(res, 200, { ok: true, appt: shape(next) });
  }

  return json(res, 400, { error: "Unknown action" });
};

module.exports.createAppt = createAppt;
