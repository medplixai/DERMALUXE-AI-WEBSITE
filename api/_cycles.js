// The patient who should be back by now.
//
// A Hydrafacial is monthly. A peel is every three weeks. Laser hair removal
// is every five or six. Nobody writes that on the bill, so the clinic has
// never known that Lakshmi's glow facial from 12 August is due again — and
// the patient who is reminded at the right time books; the one who is not
// drifts to whichever salon messages first. Multi-sitting packages already
// have their recall (package.js); this is for every other treatment on a
// bill that has a natural next time.
//
// The intervals are defaults the owner can change per treatment in the
// control panel (agent:cycles — days per key, 0 switches one off). Each bill
// records the latest date per (patient, treatment); once a day, whoever is
// due gets one message with slots, once per occurrence, never after STOP,
// never while they already have an appointment.
//
// KV: cyc:last (hash) phone|key → {at, name, treatment, bill}
//     cyc:sent:<phone>|<key>:<at>  one recall per occurrence (45 d)
//     cyc:log                      what went out
const guard = require("./_guard.js");

const DAY = 86400000;
const DEFAULTS = [
  { key: "hydrafacial", match: /hydra/i, label: "Hydrafacial", days: 30 },
  { key: "carbon", match: /carbon/i, label: "Carbon laser facial", days: 30 },
  { key: "peel", match: /peel/i, label: "Chemical peel", days: 21 },
  { key: "lhr", match: /laser hair|lhr|hair removal|hair reduction/i, label: "Laser hair removal", days: 35 },
  { key: "prp", match: /\bprp\b/i, label: "PRP hair therapy", days: 30 },
  { key: "gfc", match: /\bgfc\b/i, label: "GFC hair therapy", days: 21 },
  { key: "meso", match: /meso/i, label: "Mesotherapy", days: 21 },
  { key: "mnrf", match: /mnrf|microneedl/i, label: "MNRF", days: 35 },
  { key: "pico", match: /pico|pigmentation/i, label: "Pigmentation sitting", days: 30 },
  { key: "acne", match: /acne/i, label: "Acne sitting", days: 21 },
  { key: "botox", match: /botox/i, label: "Botox", days: 150 },
  { key: "filler", match: /filler/i, label: "Dermal filler", days: 300 },
  { key: "hifu", match: /hifu/i, label: "HIFU", days: 365 },
  { key: "review", match: /consult|review|follow/i, label: "Doctor review", days: 90 },
];
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (ms) => { const d = new Date(ms + 330 * 60000); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

// The intervals in force: defaults, with the owner's changes on top.
async function table(cfg) {
  const over = cfg ? parse(((await guard.kvCommand(cfg, ["GET", "agent:cycles"]).catch(() => ({}))) || {}).result || "", {}) || {} : {};
  return DEFAULTS.map((c) => ({ key: c.key, label: c.label, days: over[c.key] != null ? Math.max(0, Math.min(730, Number(over[c.key]) || 0)) : c.days, dflt: c.days }));
}
async function setDays(cfg, changes, by) {
  const cur = parse(((await guard.kvCommand(cfg, ["GET", "agent:cycles"]).catch(() => ({}))) || {}).result || "", {}) || {};
  for (const [k, v] of Object.entries(changes || {})) {
    if (!DEFAULTS.some((c) => c.key === k)) continue;
    cur[k] = Math.max(0, Math.min(730, Number(v) || 0));
  }
  cur._by = String(by || "").slice(0, 40); cur._ts = Date.now();
  const r = await guard.kvCommand(cfg, ["SET", "agent:cycles", JSON.stringify(cur)]);
  return !r || r.error ? { ok: false, error: "Save avvaledu" } : { ok: true, cycles: await table(cfg) };
}
const cycleOf = (name) => DEFAULTS.find((c) => c.match.test(String(name || "")));

// A bill: remember the latest date of each cycle treatment on it. Items that
// are multi-sitting packages on the rate card are package.js's job.
async function touchBill(cfg, bill, rates) {
  if (!cfg || !bill || !bill.phone) return 0;
  const ph = ten(bill.phone);
  let n = 0;
  for (const item of (bill.items || [])) {
    const rate = (rates || []).find((r) => r.name === item.name);
    if (rate && Number(rate.sessions) >= 2) continue;
    const c = cycleOf(item.name);
    if (!c) continue;
    const field = `${ph}|${c.key}`;
    const prev = parse(((await guard.kvCommand(cfg, ["HGET", "cyc:last", field]).catch(() => ({}))) || {}).result || "", null);
    const at = Number(bill.ts) || Date.now();
    if (prev && prev.at >= at) continue;
    await guard.kvCommand(cfg, ["HSET", "cyc:last", field, JSON.stringify({ at, name: bill.name || "", treatment: item.name, bill: bill.id || "" })]).catch(() => {});
    n++;
  }
  return n;
}

// The bills already raised before this existed: read the last 120 days once.
async function backfill(cfg) {
  const done = await guard.kvCommand(cfg, ["SET", "cyc:backfilled", "1", "NX"]).catch(() => ({}));
  if (!done || !done.result) return 0;
  const rates = await require("./money.js").rates(cfg).catch(() => []);
  const days = [];
  for (let d = 0; d < 120; d++) days.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - d * DAY)));
  const lists = await guard.kvPipeline(cfg, days.map((d) => ["LRANGE", `bill:day:${d}`, "0", "199"])).catch(() => []);
  const ids = [...new Set([].concat(...(Array.isArray(lists) ? lists : []).map((l) => (Array.isArray(l) ? l : []))))];
  if (!ids.length) return 0;
  const raws = await guard.kvPipeline(cfg, ids.map((id) => ["GET", `bill:${id}`])).catch(() => []);
  let n = 0;
  for (const raw of (Array.isArray(raws) ? raws : [])) { const b = parse(raw, null); if (b) n += await touchBill(cfg, b, rates); }
  return n;
}

// Everyone whose next time is here: due in the next two days, up to three
// weeks overdue — after that the moment has passed and the next bill starts it again.
async function due(cfg) {
  const t = await table(cfg);
  const daysOf = Object.fromEntries(t.map((c) => [c.key, c.days]));
  const labelOf = Object.fromEntries(t.map((c) => [c.key, c.label]));
  const all = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "cyc:last"]).catch(() => ({}))).result) || {};
  const now = Date.now(), out = [];
  for (const [field, raw] of Object.entries(all)) {
    const [ph, key] = field.split("|");
    const rec = parse(raw, null);
    if (!rec || !daysOf[key]) continue;
    const dueAt = rec.at + daysOf[key] * DAY;
    if (dueAt > now + 2 * DAY || dueAt < now - 21 * DAY) continue;
    out.push({ phone: ph, key, field, at: rec.at, dueAt, name: rec.name || "", treatment: labelOf[key] || rec.treatment, overdueDays: Math.max(0, Math.floor((now - dueAt) / DAY)) });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

// For the agent's memory line: what this person is due for.
async function dueLine(cfg, phone) {
  const ph = ten(phone);
  const t = await table(cfg);
  const bits = [];
  for (const c of t) {
    if (!c.days) continue;
    const rec = parse(((await guard.kvCommand(cfg, ["HGET", "cyc:last", `${ph}|${c.key}`]).catch(() => ({}))) || {}).result || "", null);
    if (!rec) continue;
    const dueAt = rec.at + c.days * DAY;
    if (dueAt > Date.now() + 14 * DAY) continue;
    bits.push(`${c.label} last ${fmt(rec.at)}, next due ${fmt(dueAt)}${dueAt < Date.now() ? " (due now — offer this week's slots)" : ""}`);
  }
  return bits.slice(0, 2).join("; ");
}

async function run(cfg, max) {
  const res = { due: 0, sent: 0, skipped: 0, backfilled: 0 };
  if (!cfg) return res;
  res.backfilled = await backfill(cfg).catch(() => 0);
  const notify = require("./_notify.js");
  const rows = await due(cfg);
  res.due = rows.length;
  const opt = new Set((((await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}))) || {}).result) || []);
  const booked = new Set();
  for (const s of ((((await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "299"]).catch(() => ({}))) || {}).result) || [])) { const a = parse(s, null); if (a && a.at > Date.now()) booked.add(ten(a.ph)); }
  for (const r of rows) {
    if (res.sent >= (max || 25)) break;
    if (opt.has(r.phone) || booked.has(r.phone)) { res.skipped++; continue; }
    const nx = await guard.kvCommand(cfg, ["SET", `cyc:sent:${r.field}:${r.at}`, "1", "NX", "EX", String(45 * 86400)]).catch(() => ({}));
    if (!nx || !nx.result) continue;
    const first = String(r.name || "").trim().split(" ")[0] || "andi";
    const text = `${first} garu 🙏 mee last *${r.treatment}* ${fmt(r.at)} na — next session ki time ayindi ✨\n\nResults continue avvalante ee vaaram lo cheyinchukovadam best. Eppudu convenient?`;
    let ok = await notify.sendWaButtons(r.phone, text, ["📅 Ee vaaram", "📅 Next week", "❓ Doubt undi"]).catch(() => false);
    if (!ok) ok = !!((await notify.sendWaTemplate(r.phone, "session_reminder", [first, String(r.treatment).slice(0, 60)]).catch(() => null)) || {}).ok;
    if (!ok) { await guard.kvCommand(cfg, ["DEL", `cyc:sent:${r.field}:${r.at}`]).catch(() => {}); continue; }
    await guard.kvCommand(cfg, ["LPUSH", "cyc:log", JSON.stringify({ ts: Date.now(), phone: r.phone, key: r.key, treatment: r.treatment, overdue: r.overdueDays })]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "cyc:log", "0", "999"]).catch(() => {});
    try { await require("./_memory.js").forget(cfg, r.phone); } catch (e) {}
    res.sent++;
  }
  return res;
}

module.exports = { DEFAULTS, table, setDays, cycleOf, touchBill, backfill, due, dueLine, run };
