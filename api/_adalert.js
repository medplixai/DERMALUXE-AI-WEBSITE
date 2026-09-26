// Money going wrong, said out loud, on the owner's phone.
//
// The Ads screen answers when somebody opens it. Nobody opens it on the
// Tuesday a campaign quietly starts eating ₹700 for nothing — and by the time
// they do, the week is spent. So this looks every few minutes and writes to
// the one place the owner always reads.
//
// Three rules about a machine that sends messages by itself:
//
//   * ONCE a week per campaign per problem. The same campaign is still wrong
//     tomorrow; saying so tomorrow is how somebody learns to ignore it.
//   * It changes NOTHING. Every alert names what to do and leaves the doing
//     to a person — an unattended thing that spends or stops money on its own
//     judgement is a different and much larger promise.
//   * When WhatsApp will not take it, that is recorded as plainly as the
//     alert itself. Free-form messages only reach somebody who wrote to us in
//     the last 24 hours; a feed that quietly showed "sent" for messages
//     nobody got would be worse than no feed.
//
// KV: ads:alerts (list, 30) · ads:alert:<campaign>:<kind> (NX 7 d) · ads:alert:run
const guard = require("./_guard.js");
const notify = require("./_notify.js");

const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const EVERY = 15 * 60 * 1000;          // no more often than this, whatever calls it
const WEEK = String(7 * 86400);
const MIN_SPEND = 300;                 // rupees in the window before it is worth a word
const WINDOW = 7;                      // days looked at

// One line per problem, in the words the owner would use.
function problems(account, campaigns, target) {
  const out = [];
  for (const c of campaigns) {
    if (!c.running || c.spend < MIN_SPEND) continue;
    if (!c.results) {
      out.push({ kind: "nochat", id: c.id, name: c.name,
        text: `₹${c.spend.toLocaleString("en-IN")} kharchu, okka WhatsApp chat ledu. Aapandi.` });
      continue;
    }
    if (c.costEach >= target * 3) {
      out.push({ kind: "dear", id: c.id, name: c.name,
        text: `okko chat ₹${c.costEach.toLocaleString("en-IN")} — lakshyam ₹${target.toLocaleString("en-IN")}. Chala kharidu, chudandi.` });
    }
  }
  if (account && account.capLeft != null && account.capLeft > 0 && account.spend > 0) {
    const perDay = account.spend / WINDOW;
    const left = Math.floor(account.capLeft / Math.max(1, perDay));
    if (left <= 3) {
      out.push({ kind: "cap", id: "account", name: "Ad account",
        text: `Spending limit lo ₹${account.capLeft.toLocaleString("en-IN")} migilindi — inka ${left} roju${left === 1 ? "" : "lu"}. Taruvata ads aagipotayi.` });
    }
  }
  return out;
}

async function run(cfg, opts) {
  const res = { checked: 0, alerts: 0, sent: 0, skipped: "" };
  if (!cfg) return Object.assign(res, { skipped: "no kv" });
  const force = !!(opts && opts.force);
  if (!force) {
    const due = await guard.kvCommand(cfg, ["SET", "ads:alert:run", "1", "NX", "PX", String(EVERY)]).catch(() => ({}));
    if (!due || !due.result) return Object.assign(res, { skipped: "too soon" });
  }

  const ads = require("./ads.js");
  const conn = await ads.connect(cfg).catch(() => ({ ok: false }));
  if (!conn.ok) return Object.assign(res, { skipped: "not connected" });
  const tok = ads.tokenOf(conn.tokenName);
  const act = `/act_${conn.accountId}`;
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - (WINDOW - 1) * 86400000).toISOString().slice(0, 10);
  const range = JSON.stringify({ since, until });
  const target = Math.max(10, Math.min(5000, Number(process.env.ADS_TARGET_COST) || 300));

  let account = null, campaigns = [];
  try {
    const [acc, camps] = await Promise.all([
      ads.graph(act, tok, { fields: "amount_spent,spend_cap" }),
      ads.graph(act + "/campaigns", tok, {
        fields: `name,status,effective_status,insights.time_range(${range}){spend,actions}`,
        limit: 50,
      }),
    ]);
    const conv = (actions) => {
      const hit = (actions || []).find((x) => /messaging_conversation_started/.test(x.action_type));
      return hit ? Number(hit.value) || 0 : 0;
    };
    campaigns = (camps.data || []).map((c) => {
      const ci = ((c.insights || {}).data || [])[0] || {};
      const spend = Math.round(Number(ci.spend) || 0);
      const results = conv(ci.actions);
      return { id: String(c.id), name: c.name, spend, results,
        costEach: results ? Math.round(spend / results) : 0,
        running: (c.effective_status || c.status) === "ACTIVE" };
    });
    const cap = Math.round((Number(acc.spend_cap) || 0) / 100);
    const spent = Math.round((Number(acc.amount_spent) || 0) / 100);
    account = { spend: campaigns.reduce((n, c) => n + c.spend, 0), capLeft: cap ? Math.max(0, cap - spent) : null };
  } catch (e) {
    console.error("adalert:", e && e.message);
    return Object.assign(res, { skipped: String(e.message || e).slice(0, 80) });
  }
  res.checked = campaigns.length;

  const to = guard.ownerPhones()[0];
  for (const p of problems(account, campaigns, target)) {
    // Once a week per campaign per problem. It is still wrong tomorrow.
    const once = await guard.kvCommand(cfg, ["SET", `ads:alert:${p.id}:${p.kind}`, "1", "NX", "EX", WEEK]).catch(() => ({}));
    if (!once || !once.result) continue;
    res.alerts++;
    const line = `🔔 *${String(p.name).slice(0, 60)}*\n${p.text}`;
    // Free-form only reaches somebody who wrote to us in the last 24 hours.
    // Whether it landed is written down beside the alert, either way.
    let sent = false;
    if (to) sent = !!(await notify.sendWa(to, `${line}\n\nAds screen lo chudandi: dermaluxe.ai/staff.html#ads`).catch(() => false));
    if (sent) res.sent++;
    await guard.kvCommand(cfg, ["LPUSH", "ads:alerts", JSON.stringify({
      ts: Date.now(), kind: p.kind, id: p.id, name: p.name, text: p.text, sent,
    })]).catch(() => {});
  }
  await guard.kvCommand(cfg, ["LTRIM", "ads:alerts", "0", "29"]).catch(() => {});
  return res;
}

async function recent(cfg, n) {
  const r = await guard.kvCommand(cfg, ["LRANGE", "ads:alerts", "0", String(Math.max(1, Math.min(30, n || 8)) - 1)]).catch(() => ({}));
  return (r.result || []).map((x) => parse(x, null)).filter(Boolean);
}

module.exports = { run, recent, problems, MIN_SPEND, EVERY, WINDOW };
