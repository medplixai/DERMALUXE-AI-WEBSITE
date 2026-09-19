// /api/attend — who is in today.
//
// The schedule could hand an appointment to a doctor who was on leave,
// because nothing in the system knew who had come in. At the end of a month
// there was no record of who worked which days either, so salaries were
// settled from memory and a diary.
//
// Two ideas only. A person marks themselves in and out — that needs no
// permission beyond being staff, the same way setting your own password does.
// And whoever runs the place can mark anybody: present, leave, half day,
// holiday — for the days people forget, which is most days.
//
// A day is a day in Eluru, not in UTC, so a 9 PM shift belongs to the day the
// person thinks it does.
//
// KV:
//   att:<YYYY-MM-DD>   hash of phone → that person's day
//   att:m:<YYYY-MM>    hash of "<phone>|<day>" → status, for the month view
const guard = require("./_guard.js");
const staff = require("./staff.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

const STATUS = ["present", "leave", "half", "holiday"];
const TE = { present: "Vachcharu", leave: "Leave", half: "Half day", holiday: "Selavu" };

const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts || Date.now()));
const istTime = (ts) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ts));
const istMonth = (ts) => istDay(ts).slice(0, 7);

async function dayOf(cfg, day) {
  const r = await guard.kvCommand(cfg, ["HGETALL", `att:${day}`]).catch(() => ({}));
  const raw = guard.hashOf(r && r.result);
  const out = {};
  for (const [ph, v] of Object.entries(raw)) { const x = parse(v, null); if (x) out[ph] = x; }
  return out;
}

async function put(cfg, day, phone, rec) {
  await guard.kvPipeline(cfg, [
    ["HSET", `att:${day}`, phone, JSON.stringify(rec)],
    ["EXPIRE", `att:${day}`, String(400 * 86400)],
    ["HSET", `att:m:${istMonth(Date.parse(day + "T06:00:00+05:30"))}`, `${phone}|${day}`, rec.status],
  ]).catch(() => {});
}

// Everyone who could be in: the team plus the owners, who are not in the team
// list because they come from the environment.
async function people(cfg) {
  const r = await guard.kvCommand(cfg, ["HGETALL", "staff:users"]).catch(() => ({}));
  const raw = guard.hashOf(r && r.result);
  const rows = Object.entries(raw).map(([ph, v]) => {
    const u = parse(v, {}) || {};
    return { phone: ph, name: u.name || ph, role: u.role || "staff", off: !!u.off };
  }).filter((x) => !x.off);
  for (const ph of guard.ownerPhones()) {
    if (!rows.some((x) => x.phone === ph)) rows.push({ phone: ph, name: "Owner", role: "owner" });
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  const manages = allow("attend.manage");

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "day");
  if (req.method === "POST" && await guard.idem(cfg, b, res)) return json(res, 200, { ok: true, dup: true });

  // Today's roster. Everybody can see who is in — that is the point of it.
  if (a === "day") {
    const rl = await guard.rateLimit(cfg, `rl:att:${me.phone}`, 300, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(q.day || "")) ? String(q.day) : istDay();
    const [marks, team] = await Promise.all([dayOf(cfg, day), people(cfg)]);
    const rows = team.map((p) => {
      const m = marks[p.phone];
      return Object.assign({}, p, {
        status: m ? m.status : null,
        in: m && m.in ? m.in : 0, out: m && m.out ? m.out : 0,
        inAt: m && m.in ? istTime(m.in) : "", outAt: m && m.out ? istTime(m.out) : "",
        note: (m && m.note) || "", markedBy: (m && m.by) || "",
      });
    });
    return json(res, 200, {
      ok: true, day, today: istDay(), rows,
      me: { phone: me.phone, status: (marks[me.phone] || {}).status || null, in: (marks[me.phone] || {}).in || 0, out: (marks[me.phone] || {}).out || 0 },
      counts: {
        present: rows.filter((r) => r.status === "present" || r.status === "half").length,
        leave: rows.filter((r) => r.status === "leave").length,
        unmarked: rows.filter((r) => !r.status).length,
      },
      canManage: manages, statuses: STATUS, labels: TE,
    });
  }

  // A month at a glance, for working out salaries without a diary.
  if (a === "month") {
    if (!manages) return json(res, 403, { error: "Idi owner/manager ki matrame" });
    const m = /^\d{4}-\d{2}$/.test(String(q.month || "")) ? String(q.month) : istMonth();
    const r = await guard.kvCommand(cfg, ["HGETALL", `att:m:${m}`]).catch(() => ({}));
    const raw = guard.hashOf(r && r.result);
    const per = {};
    for (const [key, status] of Object.entries(raw)) {
      const ph = key.split("|")[0];
      const p = per[ph] || (per[ph] = { phone: ph, present: 0, half: 0, leave: 0, holiday: 0, days: 0 });
      if (STATUS.includes(status)) { p[status]++; p.days++; }
    }
    const team = await people(cfg);
    const rows = team.map((t) => Object.assign({ name: t.name, role: t.role },
      per[t.phone] || { phone: t.phone, present: 0, half: 0, leave: 0, holiday: 0, days: 0 }));
    return json(res, 200, { ok: true, month: m, rows });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rlw = await guard.rateLimit(cfg, `rl:attw:${me.phone}`, 200, 3600);
  if (!rlw.allowed) return json(res, 429, { error: "Too many requests" });

  // Marking yourself in or out needs nothing but being yourself.
  if (a === "in" || a === "out") {
    // a tap made offline counts at the time it was tapped, not when the line came back
    const when = guard.stamp(b.at, 12 * 3600000);
    const day = istDay(when);
    const marks = await dayOf(cfg, day);
    const cur = marks[me.phone] || { status: "present", by: me.name };
    if (a === "in") {
      if (cur.in) return json(res, 400, { error: "Ippatike vachcharu ani mark ayindi" });
      cur.in = when; cur.status = cur.status === "leave" ? "present" : (cur.status || "present");
    } else {
      if (!cur.in) return json(res, 400, { error: "Mundu 'Vachanu' kottandi" });
      if (cur.out) return json(res, 400, { error: "Ippatike vellaru ani mark ayindi" });
      cur.out = when;
    }
    cur.by = me.name;
    await put(cfg, day, me.phone, cur);
    return json(res, 200, { ok: true, day, me: cur, at: istTime(a === "in" ? cur.in : cur.out) });
  }

  // Marking somebody else is a different thing, and needs the permission.
  if (a === "mark") {
    if (!manages) return json(res, 403, { error: "Inkokari haajaru mark cheyyadaniki permission ledu" });
    const phone = digits10(b.phone);
    const status = String(b.status || "");
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    if (!STATUS.includes(status)) return json(res, 400, { error: "bad status" });
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || "")) ? String(b.day) : istDay();
    if (day > istDay()) return json(res, 400, { error: "Munduku mark cheyyalemu" });
    const marks = await dayOf(cfg, day);
    const cur = Object.assign({}, marks[phone] || {}, { status, note: clean(b.note, 80), by: me.name, at: Date.now() });
    // Leave and a clock-in contradict each other; the newer statement wins.
    if (status === "leave" || status === "holiday") { delete cur.in; delete cur.out; }
    await put(cfg, day, phone, cur);
    return json(res, 200, { ok: true, day, phone, status });
  }

  return json(res, 400, { error: "Unknown action" });
};
module.exports.dayOf = dayOf;
module.exports.people = people;
module.exports.istDay = istDay;
