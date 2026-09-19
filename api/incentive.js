// /api/incentive — what each colleague earned on top of their salary.
//
// Three things are credited, each to the person the records already name:
//   * collection — payments collected in the month on bills they raised
//     (the desk that sells and follows up the balance);
//   * treatment — the value of treatments billed in the month that they
//     did (the doctor or therapist named on the bill);
//   * conversions — enquiries they moved to booked or visited in the month.
// The owner sets the rates per role, and may override them for one person.
// Everyone can see their own line; only the owner sees everybody's.
const guard = require("./_guard.js");
const staff = require("./staff.js");
const money = require("./money.js");
const expense = require("./expense.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const num = (v, max) => Math.max(0, Math.min(max, Math.round((Number(v) || 0) * 100) / 100));
const RULES = "inc:rules";

async function rules(cfg) {
  const r = await guard.kvCommand(cfg, ["GET", RULES]).catch(() => ({}));
  const v = parse((r && r.result) || "", null) || {};
  return { roles: v.roles || {}, people: v.people || {} };
}
const clean3 = (x) => ({ collectPct: num(x && x.collectPct, 50), treatPct: num(x && x.treatPct, 50), perConv: num(x && x.perConv, 5000) });
const rateFor = (R, phone, role) => clean3(R.people[phone] || R.roles[role] || {});

async function report(cfg, month) {
  const users = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "staff:users"]).catch(() => ({}))).result) || {};
  const team = Object.keys(users).map((ph) => { const u = parse(users[ph], {}) || {}; return { phone: ph, name: u.name || ph, role: u.role || "staff" }; });
  for (const ph of guard.ownerPhones()) if (!team.find((t) => t.phone === ph)) team.push({ phone: ph, name: "Owner", role: "owner" });
  const row = {};
  for (const t of team) row[t.phone] = Object.assign({}, t, { collected: 0, treated: 0, conversions: 0 });

  const days = expense.daysOfMonth(month), inMonth = new Set(days);
  const lists = await guard.kvPipeline(cfg, days.map((d) => ["LRANGE", `bill:day:${d}`, "0", "299"])).catch(() => []);
  const ids = new Set();
  for (const l of lists) for (const id of (Array.isArray(l) ? l : [])) ids.add(id);
  const bills = ids.size ? (await guard.kvPipeline(cfg, [...ids].map((id) => ["GET", `bill:${id}`])).catch(() => [])).map((x) => parse(x, null)).filter(Boolean) : [];
  for (const b of bills) {
    const got = (b.payments || []).filter((p) => inMonth.has(money.istDay(p.ts))).reduce((n, p) => n + (Number(p.amount) || 0), 0);
    if (got && row[b.byPhone]) row[b.byPhone].collected += got;
    if (b.doneBy && row[b.doneBy] && inMonth.has(money.istDay(b.ts))) {
      row[b.doneBy].treated += (b.items || []).reduce((n, i) => n + (Number(i.price) || 0) * Math.max(1, Number(i.qty || 1)), 0);
    }
  }
  const [st, ts, by] = await Promise.all(["dl_status", "dl_status_ts", "dl_status_by"].map((h) =>
    guard.kvCommand(cfg, ["HGETALL", h]).catch(() => ({})).then((r) => guard.hashOf(r.result) || {})));
  for (const k of Object.keys(by)) {
    if (!["booked", "visited"].includes(st[k])) continue;
    if (!inMonth.has(money.istDay(Number(ts[k]) || 0))) continue;
    if (row[by[k]]) row[by[k]].conversions++;
  }
  const R = await rules(cfg);
  const out = Object.values(row).map((r) => {
    const rate = rateFor(R, r.phone, r.role);
    const amount = Math.round(r.collected * rate.collectPct / 100 + r.treated * rate.treatPct / 100 + r.conversions * rate.perConv);
    return Object.assign(r, { rate, amount });
  }).sort((a, b) => b.amount - a.amount || b.collected - a.collected);
  return { rows: out, rules: R };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });
  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, owner = auth.allow("settings.manage");
  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "report");

  if (a === "report") {
    const rl = await guard.rateLimit(cfg, `rl:inc:${me.phone}`, 60, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const month = /^\d{4}-\d{2}$/.test(String(q.month || "")) ? String(q.month) : expense.istMonth();
    const r = await report(cfg, month);
    if (owner) return json(res, 200, { ok: true, month, rows: r.rows, rules: r.rules, owner: true,
      total: r.rows.reduce((n, x) => n + x.amount, 0) });
    const mine = r.rows.find((x) => x.phone === me.phone) || { phone: me.phone, name: me.name, collected: 0, treated: 0, conversions: 0, amount: 0, rate: clean3({}) };
    return json(res, 200, { ok: true, month, rows: [mine], owner: false });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (a === "rules-save") {
    if (!owner) return json(res, 403, { error: "Incentive rates owner matrame pettagalaru" });
    const roles = {}, people = {};
    for (const [k, v] of Object.entries(b.roles || {})) if (/^[a-z0-9_-]{2,20}$/.test(k)) roles[k] = clean3(v);
    for (const [k, v] of Object.entries(b.people || {})) if (/^[6-9]\d{9}$/.test(k)) people[k] = clean3(v);
    await guard.kvCommand(cfg, ["SET", RULES, JSON.stringify({ roles, people })]);
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({ ts: Date.now(), by: me.name, phone: me.phone, what: "Incentive rates marcharu" })]).catch(() => {});
    return json(res, 200, { ok: true, rules: { roles, people } });
  }
  return json(res, 400, { error: "Unknown action" });
};
