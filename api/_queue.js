// Who calls whom.
//
// A list of hot leads with nobody's name against it is nobody's job. The
// moment a lead becomes an A it is handed to one colleague — the one with the
// fewest open leads, not a rotation, so somebody ten behind is not dealt an
// eleventh — that person is told on their phone, and three times a day
// whoever has not made their calls hears about it, and so does the owner.
//
// KV:
//   lead:owner   hash  leadKey → staff phone
//   lead:oat     hash  leadKey → when it was dealt
//   call:alert   the last checkpoint that was announced
const guard = require("./_guard.js");

const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const leadKey = (l) => `${l.ts}|${ten(l.phone) || l.src_id || ""}`;
const istHour = () => new Date(Date.now() + 330 * 60000).getUTCHours();
const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts || Date.now()));

// Everyone who takes calls: a live login that may edit leads.
async function callers(cfg) {
  const staff = require("./staff.js");
  const users = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "staff:users"]).catch(() => ({}))).result) || {};
  const out = [];
  for (const [phone, raw] of Object.entries(users)) {
    const u = parse(raw, null);
    if (!u || u.off) continue;
    const caps = await staff.capsFor(cfg, Object.assign({ phone }, u)).catch(() => []);
    if (caps.includes("*") || caps.includes("leads.edit")) out.push({ phone, name: u.name || phone, role: u.role || "staff" });
  }
  return out;
}

const hashOf = async (cfg, key) => guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", key]).catch(() => ({}))).result) || {};

// Hand every unassigned A-grade lead to the caller with the fewest open ones.
async function assign(cfg, opts) {
  const res = { assigned: 0, callers: 0 };
  if (!cfg) return res;
  const pool = await callers(cfg);
  res.callers = pool.length;
  if (!pool.length) return res;
  const qualify = require("./_qualify.js");
  const rows = (((await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]).catch(() => ({}))).result) || [])
    .map((x) => parse(x, null)).filter((l) => l && ten(l.phone).length === 10 && Date.now() - l.ts < 7 * 86400000);
  if (!rows.length) return res;
  const [owners, status, grades] = await Promise.all([hashOf(cfg, "lead:owner"), hashOf(cfg, "dl_status"), qualify.forPhones(cfg, rows.map((l) => l.phone))]);
  const load = new Map(pool.map((c) => [c.phone, 0]));
  for (const [k, ph] of Object.entries(owners)) {
    const st = status[k] || "new";
    if (["new", "contacted"].includes(st) && load.has(ph)) load.set(ph, load.get(ph) + 1);
  }
  const open = rows.filter((l) => {
    const k = leadKey(l);
    if (owners[k]) return false;
    if ((status[k] || "new") !== "new") return false;
    const g = grades[ten(l.phone)];
    return g && g.grade === "A";
  }).sort((a, b) => (grades[ten(b.phone)].score - grades[ten(a.phone)].score) || (a.ts - b.ts));

  const dealt = {};
  for (const l of open.slice(0, (opts && opts.max) || 20)) {
    const who = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
    load.set(who, load.get(who) + 1);
    const k = leadKey(l);
    await guard.kvCommand(cfg, ["HSET", "lead:owner", k, who]).catch(() => {});
    await guard.kvCommand(cfg, ["HSET", "lead:oat", k, String(Date.now())]).catch(() => {});
    (dealt[who] = dealt[who] || []).push(l);
    res.assigned++;
  }
  // One push per person, not one per lead.
  try {
    const push = require("./_push.js");
    if (push.enabled()) {
      for (const [who, list] of Object.entries(dealt)) {
        await push.sendToPhone(cfg, who, {
          title: `📞 ${list.length} lead${list.length > 1 ? "s" : ""} mee peru meeda`,
          body: list.slice(0, 3).map((l) => `${l.name || ten(l.phone)} — ${String(l.concern || "").slice(0, 30)}`).join(" · "),
          tab: "leads", urgent: true, data: { kind: "assigned" },
        }).catch(() => {});
      }
    }
  } catch (e) { console.error("queue: push", e && e.message); }
  return res;
}

// Each caller's day: what they were dealt, what they have touched, what is left.
async function teamDay(cfg, day) {
  const d = day || istDay();
  const pool = await callers(cfg);
  const rows = (((await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "399"]).catch(() => ({}))).result) || []).map((x) => parse(x, null)).filter(Boolean);
  const byKey = new Map(rows.map((l) => [leadKey(l), l]));
  const [owners, oat, status, stTs, stBy, notes] = await Promise.all([
    hashOf(cfg, "lead:owner"), hashOf(cfg, "lead:oat"), hashOf(cfg, "dl_status"),
    hashOf(cfg, "dl_status_ts"), hashOf(cfg, "dl_status_by"), hashOf(cfg, "dl_notes"),
  ]);
  const stat = new Map(pool.map((c) => [c.phone, { phone: c.phone, name: c.name, role: c.role, assigned: 0, untouched: 0, called: 0, booked: 0, oldest: 0 }]));
  for (const [k, who] of Object.entries(owners)) {
    const s = stat.get(who);
    if (!s || !byKey.has(k)) continue;
    const st = status[k] || "new";
    const when = Number(oat[k] || 0);
    if (istDay(when) === d) s.assigned++;
    const touchedTs = Number(stTs[k] || 0);
    const noteList = parse(notes[k] || "[]", []) || [];
    const touched = (touchedTs && stBy[k] === who) || noteList.some((n) => istDay(n.ts) === d);
    if (["booked", "visited"].includes(st) && istDay(touchedTs) === d) s.booked++;
    if (touched && istDay(touchedTs || (noteList[0] || {}).ts) === d) s.called++;
    if (["new", "contacted"].includes(st) && !touched) {
      s.untouched++;
      s.oldest = Math.max(s.oldest, Date.now() - (when || byKey.get(k).ts));
    }
  }
  return [...stat.values()].sort((a, b) => b.untouched - a.untouched || b.called - a.called);
}

// Three times a working day: who has not made their calls.
const CHECKPOINTS = [11, 15, 18];
async function alertOverdue(cfg) {
  if (!cfg) return { skipped: "no cfg" };
  const hour = istHour();
  if (!CHECKPOINTS.includes(hour)) return { skipped: "not a checkpoint" };
  const slot = `${istDay()}-${hour}`;
  const nx = await guard.kvCommand(cfg, ["SET", "call:alert", slot, "NX", "EX", "86400"]).catch(() => ({}));
  if (!nx || !nx.result) {
    const cur = ((await guard.kvCommand(cfg, ["GET", "call:alert"]).catch(() => ({}))) || {}).result;
    if (cur === slot) return { skipped: "already sent" };
    await guard.kvCommand(cfg, ["SET", "call:alert", slot, "EX", "86400"]).catch(() => {});
  }
  const team = await teamDay(cfg);
  const behind = team.filter((t) => t.untouched > 0);
  if (!behind.length) return { behind: 0 };
  const notify = require("./_notify.js");
  const when = `${istDay()}, ${hour > 12 ? hour - 12 : hour} ${hour >= 12 ? "PM" : "AM"}`;
  try {
    const push = require("./_push.js");
    if (push.enabled()) for (const b of behind) {
      await push.sendToPhone(cfg, b.phone, { title: "📞 Calls pending", body: `${b.untouched} leads inka call cheyyaledu. Call chesi note raayandi.`, tab: "leads", urgent: true, data: { kind: "overdue" } }).catch(() => {});
    }
  } catch (e) {}
  const lines = behind.map((b) => `• ${b.name}: ${b.untouched} leads${b.oldest > 3600000 ? ` (chala paatavi ${Math.round(b.oldest / 3600000)}h)` : ""}`).join("\n");
  const total = behind.reduce((n, b) => n + b.untouched, 0);
  const text = `📞 *Calls inka cheyyaledu* (${when})\n${lines}\n\nCall chesaka app lo note raayandi — note lekapothe call cheyyanattule lekka.`;
  for (const to of guard.ownerPhones()) {
    if (!(await notify.sendWa(to, text).catch(() => false))) {
      await notify.sendWaTemplate(to, "staff_calls_pending", [when, behind.map((b) => `${b.name} – ${b.untouched}`).join(", ").slice(0, 200), String(total)]).catch(() => {});
    }
  }
  for (const b of behind) {
    const own = `📞 ${b.name} garu, meeku ichchina ${b.untouched} leads inka call cheyyaledu.\n\nApp → Leads → "Ippude call" lo unnaru. Call chesi note raayandi 🙏`;
    if (!(await notify.sendWa(b.phone, own).catch(() => false))) {
      await notify.sendWaTemplate(b.phone, "staff_calls_pending", [when, `${b.name} – ${b.untouched}`, String(b.untouched)]).catch(() => {});
    }
  }
  return { behind: behind.length, total };
}

module.exports = { callers, assign, teamDay, alertOverdue, leadKey, CHECKPOINTS };
