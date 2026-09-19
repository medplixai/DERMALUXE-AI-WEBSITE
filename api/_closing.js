// The evening report: the clinic's day in one WhatsApp, to the owner, after
// closing. Worked out from the data, never asked of the AI — it goes every
// night whether or not a key is set, and it cannot invent a number.
const guard = require("./_guard.js");
const money = require("./money.js");
const expense = require("./expense.js");

const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const rs = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

async function build(cfg, day) {
  const c = await money.collection(cfg, day);
  const eIds = ((await guard.kvCommand(cfg, ["LRANGE", `exp:day:${day}`, "0", "199"]).catch(() => ({}))).result) || [];
  const exp = eIds.length ? (await guard.kvPipeline(cfg, eIds.map((id) => ["GET", `exp:${id}`])).catch(() => [])).map((x) => parse(x, null)).filter(Boolean) : [];
  const spent = exp.reduce((n, x) => n + (Number(x.amount) || 0), 0);

  const done = (((await guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "299"]).catch(() => ({}))).result) || [])
    .map((x) => parse(x, null)).filter((a) => a && a.at && money.istDay(a.at) === day);
  const q = (((await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "399"]).catch(() => ({}))).result) || [])
    .map((x) => parse(x, null)).filter((a) => a && a.at && money.istDay(a.at) === day);
  const came = done.filter((a) => a.status !== "cancelled" && a.status !== "noshow" && !a.ns).length + q.filter((a) => a.status === "arrived" || a.status === "done").length;
  const noshow = done.filter((a) => a.status === "noshow" || a.ns).length;
  const cancelled = done.filter((a) => a.status === "cancelled").length;
  const tomorrow = (((await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "399"]).catch(() => ({}))).result) || [])
    .map((x) => parse(x, null)).filter((a) => a && a.at && money.istDay(a.at) === money.istDay(Date.parse(day + "T12:00:00+05:30") + 86400000)).length;

  const leads = (((await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "299"]).catch(() => ({}))).result) || [])
    .map((x) => parse(x, null)).filter((l) => l && l.ts && money.istDay(l.ts) === day);
  const hot = leads.filter((l) => l.heat === "hot").length;

  const open = ((await guard.kvCommand(cfg, ["LRANGE", "bill:open", "0", "299"]).catch(() => ({}))).result) || [];
  let due = 0;
  if (open.length) {
    const bills = (await guard.kvPipeline(cfg, open.map((id) => ["GET", `bill:${id}`])).catch(() => [])).map((x) => parse(x, null)).filter(Boolean);
    for (const b of bills) { const t = money.totals(b); due += t.balance; }
  }
  const close = parse(((await guard.kvCommand(cfg, ["GET", `cash:close:${day}`]).catch(() => ({}))) || {}).result || "", null);
  const mon = await expense.monthPnl(cfg, day.slice(0, 7), false);

  const when = new Date(day + "T12:00:00+05:30").toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
  const m = c.byMode || {};
  const lines = [
    `🌙 *DermaLuxe — ee roju (${when})*`,
    "",
    `💰 Vachindi *${rs(c.collected)}* · ${c.count} payments`,
    `   Cash ${rs(m.cash)} · UPI ${rs(m.upi)} · Card ${rs(m.card)}${m.other ? " · Other " + rs(m.other) : ""}`,
    `🧾 Kotha bills ${rs(c.billed)}`,
    `💸 Kharchu ${rs(spent)}`,
    `➡️ Migilindi *${rs(c.collected - spent)}*`,
    "",
    `🩺 Vachharu ${came}${noshow ? ` · raaledu ${noshow}` : ""}${cancelled ? ` · cancel ${cancelled}` : ""} · repu ${tomorrow} appointments`,
    `📩 Kotha leads ${leads.length}${hot ? ` (🔥 ${hot} hot)` : ""}`,
    `⏳ Mottam baaki ${rs(due)} (${open.length} bills)`,
    close ? `🧮 Cash close ✅ ${close.by}${close.diff ? ` — *teda ${rs(close.diff)}*` : " — sari"}` : "🧮 ⚠️ Cash close inka cheyyaledu",
    "",
    `📆 Ee nela: vachindi ${rs(mon.collected)} · kharchu ${rs(mon.spent)} · migilindi *${rs(mon.profit)}*`,
  ];
  return {
    body: lines.join("\n"),
    oneLine: `Ee roju ${rs(c.collected)} vachindi, kharchu ${rs(spent)}, ${came} patients${close ? "" : " — cash close inka ledu"}`,
  };
}

module.exports = { build };
