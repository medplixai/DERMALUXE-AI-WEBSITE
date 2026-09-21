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

// ---- the day, read as a plan instead of a list ------------------------------
// An empty Appointments screen used to say "Ee roju appointments ledu" and
// stop there. The clinic's problem on that morning is not that the list is
// empty — it is that nobody knows who should have been in it. So the day now
// carries: how full it is, which times are actually free, and who is worth
// ringing to fill them, from the records the clinic already keeps.
const DAY_MS = 86400000;
const OPEN_H = 9, CLOSE_H = 21, SLOT_MIN = 30;

// Every half hour the clinic is open that day, minus what is booked to
// capacity and minus the windows the team blocked out.
async function freeSlots(cfg, day, rows) {
  // Midday, not midnight: at 00:00 +05:30 the instant is still the previous
  // day in UTC, so getUTCDay() called a Monday a Sunday and closed the clinic.
  const d = new Date(day + "T12:00:00+05:30");
  if (d.getUTCDay() === 0) return { slots: 0, free: [], closed: true };   // Sunday
  const per = Math.max(1, Number(process.env.APPT_PER_SLOT || 2));
  const taken = {};
  for (const r of rows) {
    if (["cancelled", "noshow"].includes(r.status)) continue;
    taken[istTime(r.at)] = (taken[istTime(r.at)] || 0) + 1;
  }
  let blocks = [];
  try {
    const b = await guard.kvCommand(cfg, ["LRANGE", "blk:q", "0", "49"]).catch(() => ({}));
    blocks = ((b && b.result) || []).map((x) => parse(x, null)).filter((x) => x && x.from && x.to);
  } catch (e) {}
  const out = [];
  let slots = 0;
  const base = Date.parse(day + "T00:00:00+05:30");
  for (let m = OPEN_H * 60; m < CLOSE_H * 60; m += SLOT_MIN) {
    const at = base + m * 60000;
    slots++;
    if (at < Date.now()) continue;                                  // a time that has passed is not free
    if (blocks.some((x) => at >= x.from && at < x.to)) continue;
    if ((taken[istTime(at)] || 0) >= per) continue;
    out.push({ at, time: istTime(at) });
  }
  return { slots, per, free: out, closed: false };
}

// Who the desk could ring to fill them, newest problem first. Each line says
// why this person and nothing more, so it can be acted on without thinking.
async function whoToBook(cfg, day) {
  const seen = new Set(), out = [];
  const add = (row) => {
    const ph = digits10(row.phone);
    if (ph.length !== 10 || seen.has(ph)) return;
    seen.add(ph); out.push(Object.assign({}, row, { phone: ph }));
  };
  const booked = new Set();
  try {
    const q = await guard.kvCommand(cfg, ["LRANGE", Q, "0", "299"]).catch(() => ({}));
    for (const s of ((q && q.result) || [])) { const a = parse(s, null); if (a && a.at > Date.now() - DAY_MS) booked.add(digits10(a.ph)); }
  } catch (e) {}
  // 1. a course of treatment that has stopped part way
  try {
    const rows = await require("./package.js").due(cfg, 3);
    for (const p of rows.slice(0, 6)) {
      if (booked.has(digits10(p.phone))) continue;
      add({ phone: p.phone, name: p.name, kind: "sitting", why: `${p.treatment} ${p.done + 1}/${p.total} sitting`, sub: p.overdueDays ? `${p.overdueDays} rojulu late` : "ippudu due", urgent: p.overdueDays > 7 });
    }
  } catch (e) { console.error("plan: sittings", e && e.message); }
  // 2. a treatment whose next time has come round
  try {
    const rows = await require("./_cycles.js").due(cfg);
    for (const c of rows.slice(0, 6)) {
      if (booked.has(c.phone)) continue;
      add({ phone: c.phone, name: c.name, kind: "cycle", why: `${c.treatment} malli cheyinchukovali`, sub: c.overdueDays ? `${c.overdueDays} rojulu late` : "ee vaaram due" });
    }
  } catch (e) { console.error("plan: cycles", e && e.message); }
  // 3. the hot enquiries nobody has booked
  try {
    const qualify = require("./_qualify.js");
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]).catch(() => ({}));
    const leads = ((r && r.result) || []).map((x) => parse(x, null)).filter((l) => l && l.ts > Date.now() - 21 * DAY_MS);
    const st = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({}))).result) || {};
    const grades = await qualify.forPhones(cfg, leads.map((l) => l.phone));
    const off = new Set((((await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}))) || {}).result) || []);
    for (const l of leads) {
      const ph = digits10(l.phone);
      const status = st[`${l.ts}|${ph || l.src_id || ""}`] || "new";
      if (!["new", "contacted"].includes(status) || booked.has(ph) || off.has(ph)) continue;
      // The same rule the Leads screen uses: the grade when there is one, the
      // agent's hot flag until the qualifier has caught up — otherwise a lead
      // the desk wrote down two minutes ago is invisible here for an hour.
      const g = grades[ph];
      const worth = g ? (g.grade === "A" || g.grade === "B") : l.heat === "hot";
      if (!worth) continue;
      add({ phone: ph, name: l.name || "", kind: "lead", why: `${g ? g.grade + " grade" : "hot"} · ${String(l.concern || "").slice(0, 28)}`, sub: (g && g.facts && g.facts.village) || "", urgent: g ? g.grade === "A" : true });
    }
  } catch (e) { console.error("plan: leads", e && e.message); }
  // 4. somebody who did not turn up and was never rebooked
  try {
    const dq = await guard.kvCommand(cfg, ["LRANGE", DONE, "0", "299"]).catch(() => ({}));
    const rows = ((dq && dq.result) || []).map((x) => parse(x, null)).filter(Boolean);
    const came = new Set(rows.filter((a) => !a.ns && a.status !== "noshow").map((a) => digits10(a.ph)));
    for (const a of rows) {
      if (!(a.ns || a.status === "noshow") || !a.at || a.at < Date.now() - 30 * DAY_MS) continue;
      const ph = digits10(a.ph);
      if (booked.has(ph) || came.has(ph)) continue;
      add({ phone: ph, name: a.name || "", kind: "noshow", why: "raaledu — malli book cheyyandi", sub: istDay(a.at) });
    }
  } catch (e) { console.error("plan: no-shows", e && e.message); }
  // 5. the people who asked to be told when a slot opens
  try {
    for (const w of await waitlist(cfg)) {
      add({ phone: w.ph, name: w.name, kind: "wait", why: "waitlist lo unnaru", sub: w.want || "" });
    }
  } catch (e) {}
  const order = { sitting: 0, lead: 1, cycle: 2, noshow: 3, wait: 4 };
  return out.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || order[a.kind] - order[b.kind]).slice(0, 8);
}

// Up to n of them, evenly spaced over what is free.
function spread(list, n) {
  if (list.length <= n) return list;
  const out = [], step = (list.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(list[Math.round(i * step)]);
  return out.filter((x, i, a2) => a2.indexOf(x) === i);
}

// What could go wrong with the ones that ARE booked.
// Only what the row does not already say. "confirm kaledu" and "doctor
// assign cheyyaledu" are on every row already; repeating them as warnings
// made three chips out of one fact and hid the one that matters.
function riskOf(a, noShowsBy) {
  const out = [];
  const hrs = (a.at - Date.now()) / 3600000;
  if (a.status === "booked" && !a.cf && hrs > 0 && hrs < 24) out.push("konni gantallo — confirm cheyyandi");
  const n = noShowsBy[digits10(a.ph)] || 0;
  if (n) out.push(`mundu ${n} sari${n > 1 ? "lu" : ""} raaledu`);
  return out;
}

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
  adv: Number(a.adv) || 0, lc: !!a.lc,
  pax: Number(a.pax) > 1 ? Number(a.pax) : 1, with: a.with || "",
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
    // one laser, one Hydrafacial machine, one room: two patients cannot be on it at once
    if (next.room && a.room && String(a.room).toLowerCase() === String(next.room).toLowerCase()) return { who: "room", name: a.room, at: istTime(s2), name2: a.name };
    if (digits10(a.ph) === next.ph) return { who: "patient", name: a.name, at: istTime(s2) };
  }
  return null;
}

// The rooms and machines that can only take one patient at a time. The owner
// keeps the list; an appointment on one of them clashes with any other on it.
const ROOMS = "sch:rooms", WAIT = "sch:wait";
const DEFAULT_ROOMS = ["Consultation", "Laser room", "Hydrafacial", "Procedure room"];
async function rooms(cfg) {
  const r = await guard.kvCommand(cfg, ["GET", ROOMS]).catch(() => ({}));
  const v = parse((r && r.result) || "", null);
  return Array.isArray(v) && v.length ? v : DEFAULT_ROOMS;
}

// People who want a slot sooner than there is one. When an appointment is
// cancelled or missed, whoever is waiting for that day (or any day) is who the
// desk should offer it to first.
async function waitlist(cfg) {
  const r = await guard.kvCommand(cfg, ["LRANGE", WAIT, "0", "99"]).catch(() => ({}));
  return ((r && r.result) || []).map((raw) => Object.assign({ raw }, parse(raw, {}))).filter((w) => w.id && w.ph);
}
async function waitFor(cfg, day) {
  return (await waitlist(cfg)).filter((w) => !w.day || w.day === day).map(({ raw, ...w }) => w);
}
async function freedSlot(cfg, a) {
  const day = istDay(a.at);
  const m = await waitFor(cfg, day);
  if (!m.length) return [];
  try {
    const push = require("./_push.js");
    if (push.enabled()) await push.notifyCap(cfg, "appts.edit", {
      title: `🕒 ${istTime(a.at)} slot khali ayindi`,
      body: `Waitlist lo ${m.length} mandi unnaru — ${m.slice(0, 3).map((w) => w.name).join(", ")}. Offer cheyandi.`,
      tab: "appts", data: { kind: "waitlist", day },
    });
  } catch (e) { console.error("schedule: waitlist push", e && e.message); }
  return m;
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
    branch: require("./_branch.js").pick(b.branch, me),
  };
  const rows = await readQ(cfg);
  const cl = clash(rows, next, null);
  if (cl && !b.force) {
    return { code: 409, body: {
      error: cl.who === "doctor"
        ? `${cl.name} ki aa time lo already ${cl.name2 || "oka patient"} undi (${cl.at}). Vere time chudandi.`
        : cl.who === "room"
          ? `${cl.name} aa time lo ${cl.name2 || "vere patient"} tho busy (${cl.at}). Vere time leda vere machine chudandi.`
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
    const brs = require("./_branch.js"), sc = brs.scope(me, q);
    const rows = (await readQ(cfg)).filter((r) => brs.keep(sc)(r.a)).map((r) => shape(r.a));

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
      // How full the day is, which times are free, and who is worth ringing
      // to fill them — with what could go wrong on the ones already booked.
      let plan = null;
      try {
        const cap = await freeSlots(cfg, day, list);
        const noShowsBy = {};
        const dq = await guard.kvCommand(cfg, ["LRANGE", DONE, "0", "299"]).catch(() => ({}));
        for (const x of (((dq && dq.result) || []))) {
          const a2 = parse(x, null);
          if (a2 && (a2.ns || a2.status === "noshow")) noShowsBy[digits10(a2.ph)] = (noShowsBy[digits10(a2.ph)] || 0) + 1;
        }
        list = list.map((r) => Object.assign({}, r, { risk: riskOf(r, noShowsBy) }));
        plan = {
          slots: cap.slots, per: cap.per || 0, closed: cap.closed,
          // no free times can mean two different things, and the screen should
          // not congratulate the clinic for a day that has simply ended
          over: !cap.closed && !cap.free.length && day <= istDay(Date.now()),
          used: list.filter((r) => !["cancelled", "noshow"].includes(r.status)).length,
          // Spread across the day, not the first twelve: a desk offering times
          // needs a morning, an afternoon and an evening, not four 9 o'clocks.
          free: spread(cap.free, 12),
          fill: day >= istDay(Date.now()) ? await whoToBook(cfg, day) : [],
        };
      } catch (e) { console.error("schedule: plan", e && e.message); }
      return json(res, 200, {
        ok: true, day, rows: list, mine: mine.length, team, plan,
        rooms: await rooms(cfg),
        wait: (await waitlist(cfg)).map(({ raw, ...w }) => w),
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
      days.push({ day: d, total: list.length, mine: list.filter((r) => r.staff === me.phone).length,
        unconfirmed: list.filter((r) => r.status === "booked" && !r.cf).length });
    }
    return json(res, 200, { ok: true, days, team });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (!allow("appts.edit")) return json(res, 403, { error: "Mee role ki appointments marche permission ledu" });
  const rl2 = await guard.rateLimit(cfg, `rl:sche:${me.phone}`, 200, 3600);
  if (!rl2.allowed) return json(res, 429, { error: "Too many requests" });

  if (a === "create") {
    const out = await createAppt(cfg, me, b);
    if (out.code === 200 && b.fromWait) {
      const w = (await waitlist(cfg)).find((x) => x.id === clean(b.fromWait, 16));
      if (w) await guard.kvCommand(cfg, ["LREM", WAIT, "1", w.raw]).catch(() => {});
    }
    return json(res, out.code, out.body);
  }

  if (a === "rooms-save") {
    if (!allow("settings.manage")) return json(res, 403, { error: "Rooms list owner matrame marchagalaru" });
    const list = (Array.isArray(b.rooms) ? b.rooms : []).map((x) => clean(x, 30)).filter(Boolean);
    const uniq = Array.from(new Set(list.map((x) => x.toLowerCase()))).map((l) => list.find((x) => x.toLowerCase() === l)).slice(0, 20);
    await guard.kvCommand(cfg, ["SET", ROOMS, JSON.stringify(uniq)]);
    return json(res, 200, { ok: true, rooms: uniq.length ? uniq : DEFAULT_ROOMS });
  }

  if (a === "wait-add") {
    const ph = digits10(b.ph);
    if (!/^[6-9]\d{9}$/.test(ph)) return json(res, 400, { error: "Valid number ivvandi" });
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || "")) ? String(b.day) : "";
    const w = { id: crypto.randomBytes(5).toString("hex"), ph, name: clean(b.name, 60) || "Patient", concern: clean(b.concern, 80), day, when: clean(b.when, 40), ts: Date.now(), by: me.name };
    await guard.kvCommand(cfg, ["RPUSH", WAIT, JSON.stringify(w)]);
    await guard.kvCommand(cfg, ["LTRIM", WAIT, "-100", "-1"]).catch(() => {});
    return json(res, 200, { ok: true, wait: w });
  }
  if (a === "wait-remove" || a === "wait-offer") {
    const w = (await waitlist(cfg)).find((x) => x.id === clean(b.wid, 16));
    if (!w) return json(res, 404, { error: "Waitlist lo ledu — evaro ippatike chusaru" });
    if (a === "wait-remove") {
      await guard.kvCommand(cfg, ["LREM", WAIT, "1", w.raw]).catch(() => {});
      return json(res, 200, { ok: true });
    }
    const at = Number(b.at);
    if (!at) return json(res, 400, { error: "E time offer chestunnaro ivvandi" });
    const first = String(w.name || "").trim().split(" ")[0] || "andi";
    const when = `${istTime(at)}, ${new Date(at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })}`;
    await tellPatient(w.ph, `Namaste ${first} garu 🙏 DermaLuxe lo ${when} ki oka slot khali ayindi${w.concern ? " (" + w.concern + ")" : ""}.\n\nKavalante ee message ki *YES* ani reply cheyandi — mee peru meeda book chestam 😊`);
    const next = Object.assign({}, w, { offered: (w.offered || []).concat([{ at, ts: Date.now(), by: me.name }]).slice(-5) });
    delete next.raw;
    await guard.kvCommand(cfg, ["LREM", WAIT, "1", w.raw]).catch(() => {});
    await guard.kvCommand(cfg, ["RPUSH", WAIT, JSON.stringify(next)]).catch(() => {});
    return json(res, 200, { ok: true, offered: when });
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
      return json(res, 200, { ok: true, cancelled: true, freed: { at: cur.at, mins: cur.mins || 30 }, waitMatches: cur.at > Date.now() ? await freedSlot(cfg, cur) : [] });
    }
    try { await require("./_memory.js").forget(cfg, cur.ph); } catch (e) {}
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
