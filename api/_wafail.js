// Which patients our last WhatsApp did not reach.
//
// 19–20 Nov: Meta billing stopped every template and the desk had no way to
// see it. 40 patients' messages failed — agent replies to people who had just
// written, appointment reminders, "call lift avvaledu" — and the Leads screen
// and the Inbox showed each one as sent. Owner, 21 Nov: "badge cheyyi".
//
// A failed delivery receipt marks the phone; a later delivered or read
// receipt for that phone clears it, because the newest message got through.
// The desk sees "❌ WhatsApp cheraledu" on the lead and in the chat, with the
// reason, and one button to send again (staff.js "wa-retry").
//
// KV: wa:failph:<phone> — {ts, code, title, retried?} for 7 days.
const guard = require("./_guard.js");

const KEEP_S = 7 * 86400;
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const key = (ph) => `wa:failph:${ph}`;

// What the desk is told, in the words they use.
const WHY = {
  131042: "Meta billing problem",
  131047: "24 gantala window close",
  131026: "ee number lo WhatsApp ledu",
  131049: "Meta aapesindi (chala messages)",
  131050: "vaallu marketing messages aapesaru",
  131051: "ee message type velladu",
  131053: "photo/file vellaledu",
  130472: "Meta test lo aapesindi",
  131031: "WhatsApp account lock",
  368: "Meta policy block",
};
function why(code, title) { return WHY[Number(code)] || String(title || "WhatsApp error").slice(0, 60); }

async function mark(cfg, phoneIn, row) {
  const ph = ten(phoneIn);
  if (!cfg || ph.length !== 10) return;
  const rec = { ts: Number(row && row.ts) || Date.now(), code: Number(row && row.code) || 0, title: String((row && row.title) || "").slice(0, 120) };
  await guard.kvCommand(cfg, ["SET", key(ph), JSON.stringify(rec), "EX", String(KEEP_S)]).catch(() => {});
}

async function clear(cfg, phoneIn) {
  const ph = ten(phoneIn);
  if (!cfg || ph.length !== 10) return;
  await guard.kvCommand(cfg, ["DEL", key(ph)]).catch(() => {});
}

async function read(cfg, phoneIn) {
  const ph = ten(phoneIn);
  if (!cfg || ph.length !== 10) return null;
  const r = await guard.kvCommand(cfg, ["GET", key(ph)]).catch(() => ({}));
  try { const f = r && r.result ? JSON.parse(r.result) : null; return f ? Object.assign(f, { why: why(f.code, f.title) }) : null; } catch (e) { return null; }
}

// The desk tried again; the badge says so until a receipt comes back.
async function noteRetry(cfg, phoneIn, by, via) {
  const f = await read(cfg, phoneIn);
  if (!f) return;
  delete f.why;
  f.retried = { ts: Date.now(), by: String(by || "").slice(0, 40), via: String(via || "") };
  await guard.kvCommand(cfg, ["SET", key(ten(phoneIn)), JSON.stringify(f), "EX", String(KEEP_S)]).catch(() => {});
}

// {phone: record} for the phones that have one. One read for a whole list.
async function forPhones(cfg, phones) {
  const list = Array.from(new Set((phones || []).map(ten).filter((p) => p.length === 10)));
  const out = {};
  if (!cfg || !list.length) return out;
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const r = await guard.kvCommand(cfg, ["MGET", ...part.map(key)]).catch(() => ({}));
    const vals = (r && r.result) || [];
    part.forEach((ph, j) => {
      try { const f = vals[j] ? JSON.parse(vals[j]) : null; if (f) out[ph] = Object.assign(f, { why: why(f.code, f.title) }); } catch (e) {}
    });
  }
  return out;
}

module.exports = { mark, clear, read, noteRetry, forPhones, why, WHY };
