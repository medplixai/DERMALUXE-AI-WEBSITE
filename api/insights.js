// /api/insights — the numbers, now that there is something real to count.
//
// Before the patient file and the bills there was nothing to compute: leads
// had a status but no revenue behind them, so "which channel actually pays"
// could not be answered. Every figure here comes from data the clinic already
// enters in the course of a normal day; nothing is estimated.
//
// Attribution is first touch: a person's revenue is credited to the source of
// their earliest enquiry. That is the honest simple rule — it does not try to
// split a patient between Instagram and a walk-in, and it is stated on screen
// so nobody reads more into it than it means.
//
// The whole thing is cached in KV for ten minutes; it reads the lead book and
// every bill, which is not something to do on every tab switch.
const guard = require("./_guard.js");
const staff = require("./staff.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const DAY = 86400000;
const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

function hash(r) {
  const a = (r && r.result) || {}, out = {};
  if (Array.isArray(a)) { for (let i = 0; i + 1 < a.length; i += 2) out[a[i]] = a[i + 1]; }
  else Object.assign(out, a);
  return out;
}
const leadKey = (l) => `${l.ts}|${digits10(l.phone) || l.src_id || ""}`;
const srcOf = (l) => String(l.src || l.type || "web").toLowerCase().replace(/[^a-z]/g, "") || "web";

async function build(cfg, days) {
  const since = Date.now() - days * DAY;
  const [lr, st, nt, openR] = await Promise.all([
    guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "799"]).catch(() => ({})),
    guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({})),
    guard.kvCommand(cfg, ["HGETALL", "dl_notes"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "bill:open", "0", "499"]).catch(() => ({})),
  ]);
  const statuses = hash(st), notesBy = hash(nt);
  const leads = (lr.result || []).map((x) => parse(x, null)).filter((l) => l && l.ts);

  // first touch per person, over all time — so a bill today is credited to the
  // channel that first brought them, even if that was months ago
  const firstSrc = new Map();
  for (const l of leads) {
    const ph = digits10(l.phone);
    if (!ph) continue;
    const prev = firstSrc.get(ph);
    if (!prev || l.ts < prev.ts) firstSrc.set(ph, { ts: l.ts, src: srcOf(l) });
  }

  // ---- funnel, for leads that arrived in the window ----
  const inRange = leads.filter((l) => l.ts >= since);
  const bySource = {};
  let firstReplyTotal = 0, firstReplyCount = 0;
  for (const l of inRange) {
    const s = srcOf(l);
    const b = bySource[s] || (bySource[s] = { src: s, leads: 0, contacted: 0, booked: 0, revenue: 0 });
    b.leads++;
    const k = leadKey(l);
    const status = statuses[k] || "new";
    if (status !== "new") b.contacted++;
    if (status === "booked" || status === "visited") b.booked++;
    const notes = parse(notesBy[k] || "[]", []) || [];
    if (notes.length) {
      const firstNote = notes[notes.length - 1];
      if (firstNote && firstNote.ts > l.ts) { firstReplyTotal += firstNote.ts - l.ts; firstReplyCount++; }
    }
  }

  // ---- money in the window ----
  const dayKeys = [];
  for (let i = 0; i < days; i++) dayKeys.push(istDay(Date.now() - i * DAY));
  const billIds = new Set();
  for (const d of dayKeys) {
    const r = await guard.kvCommand(cfg, ["LRANGE", `bill:day:${d}`, "0", "299"]).catch(() => ({}));
    for (const id of (r.result || [])) billIds.add(id);
  }
  let collected = 0, billed = 0;
  const byMode = { cash: 0, upi: 0, card: 0, other: 0 };
  const byDay = {};
  const byTreatment = {};
  const payers = new Set();
  for (const id of billIds) {
    const bill = parse((await guard.kvCommand(cfg, ["GET", `bill:${id}`]).catch(() => ({}))).result || "", null);
    if (!bill) continue;
    if (bill.ts >= since) {
      for (const it of (bill.items || [])) {
        const t = byTreatment[it.name] || (byTreatment[it.name] = { name: it.name, count: 0, value: 0 });
        const qty = Math.max(1, Number(it.qty || 1));
        t.count += qty;
        t.value += (Number(it.price) || 0) * qty;
        billed += (Number(it.price) || 0) * qty;
      }
    }
    for (const p of (bill.payments || [])) {
      if (p.ts < since) continue;
      const amt = Math.max(0, Math.round(Number(p.amount) || 0));
      collected += amt;
      byMode[["cash", "upi", "card"].includes(p.mode) ? p.mode : "other"] += amt;
      const d = istDay(p.ts);
      byDay[d] = (byDay[d] || 0) + amt;
      payers.add(digits10(bill.phone));
      const src = (firstSrc.get(digits10(bill.phone)) || {}).src;
      if (src) {
        const b = bySource[src] || (bySource[src] = { src, leads: 0, contacted: 0, booked: 0, revenue: 0 });
        b.revenue += amt;
      }
    }
  }

  // ---- still owed ----
  let outstanding = 0, openCount = 0;
  for (const id of (openR.result || [])) {
    const bill = parse((await guard.kvCommand(cfg, ["GET", `bill:${id}`]).catch(() => ({}))).result || "", null);
    if (!bill) continue;
    const total = (bill.items || []).reduce((n, i) => n + (Number(i.price) || 0) * Math.max(1, Number(i.qty || 1)), 0);
    const paid = (bill.payments || []).reduce((n, p) => n + (Number(p.amount) || 0), 0);
    const bal = Math.max(0, total - paid);
    if (bal > 0) { outstanding += bal; openCount++; }
  }

  // ---- repeat patients ----
  const visitsPer = new Map();
  for (const l of leads) {
    const ph = digits10(l.phone);
    if (ph) visitsPer.set(ph, (visitsPer.get(ph) || 0) + 1);
  }
  const people = visitsPer.size;
  const repeats = Array.from(visitsPer.values()).filter((n) => n > 1).length;

  const sources = Object.values(bySource).map((b) => Object.assign({}, b, {
    bookRate: b.leads ? Math.round((b.booked / b.leads) * 100) : null,
  })).sort((a, b) => (b.revenue - a.revenue) || (b.leads - a.leads));

  const treatments = Object.values(byTreatment).sort((a, b) => b.value - a.value).slice(0, 12);
  const spark = dayKeys.slice().reverse().map((d) => ({ day: d, amount: byDay[d] || 0 }));

  return {
    days, since,
    money: { collected, billed, outstanding, openCount, byMode, spark, payers: payers.size },
    funnel: {
      leads: inRange.length,
      contacted: inRange.filter((l) => (statuses[leadKey(l)] || "new") !== "new").length,
      booked: inRange.filter((l) => ["booked", "visited"].includes(statuses[leadKey(l)] || "new")).length,
      firstReplyMins: firstReplyCount ? Math.round(firstReplyTotal / firstReplyCount / 60000) : null,
      firstReplyCount,
    },
    sources, treatments,
    patients: { total: people, repeats, repeatRate: people ? Math.round((repeats / people) * 100) : 0 },
  };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("reports.view")) return json(res, 403, { error: "Mee role ki reports chuse permission ledu" });

  const q = req.query || {};
  const days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const rl = await guard.rateLimit(cfg, `rl:ins:${me.phone}`, 60, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

  // Money figures are not for everyone with reports.view — strip them if the
  // person cannot see collection anyway. On the cached copy too: the cache is
  // built with the money in, and handing it back untouched showed the
  // clinic's takings to anyone who opened Insights after the owner.
  const forThem = (out) => {
    if (allow("money.view")) return out;
    return Object.assign({}, out, {
      money: { collected: null, billed: null, outstanding: null, openCount: null, byMode: null, spark: [], payers: out.money.payers },
      sources: out.sources.map((s) => Object.assign({}, s, { revenue: null })),
      treatments: out.treatments.map((t) => Object.assign({}, t, { value: null })),
    });
  };

  // Reading the lead book and every bill is not a per-tap operation.
  const ck = `ins:${days}`;
  const hit = await guard.kvCommand(cfg, ["GET", ck]).catch(() => ({}));
  if (hit && hit.result && q.fresh !== "1") {
    const cached = parse(hit.result, null);
    if (cached) return json(res, 200, Object.assign({ ok: true, cached: true }, forThem(cached)));
  }
  const out = await build(cfg, days);
  await guard.kvCommand(cfg, ["SET", ck, JSON.stringify(out), "EX", "600"]).catch(() => {});
  return json(res, 200, Object.assign({ ok: true, cached: false }, forThem(out)));
};
