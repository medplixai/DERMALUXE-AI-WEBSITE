// Weekly marketing report — Monday 9 AM IST via cron-digest, and on demand
// with the 'weekly' admin command. Read-only. Pulls smart-link clicks per
// placement (utm:*), leads by channel, the booking funnel, top concerns,
// patient ratings (rv:log) and template volume/cost (tpl:sent:*).
// Does NOT require _admin.js (it requires us).
const guard = require("./_guard.js");

const TAGS = {
  fab: "site chat button", book: "site hero button", assistant: "site assistant", topbar: "site top bar",
  footer: "site footer", mbar: "site mobile bar", webchat: "website chat", qr: "clinic QR",
  insta: "Instagram bio", story: "IG story", wa: "WhatsApp link", fb: "Facebook", gbp: "Google profile",
  jobs: "careers", hiring: "careers", careers: "careers", clinic: "clinic link",
};
const MARKETING = new Set(["clinic_update", "service_followup", "session_reminder", "insta_lead_followup", "festival_offer",
  "flash_offer", "new_service", "daily_digest_ping", "birthday_wish", "seasonal_tips", "free_camp", "lead_checkin", "we_miss_you"]);
const UTILITY = ["appointment_reminder", "appointment_confirm", "visit_followup", "visit_rating", "review_reminder",
  "preop_instructions", "aftercare_instructions", "payment_confirmed"];
const COST = { marketing: 0.78, utility: 0.115 }; // approx ₹/message, Meta India — estimate only

const IST = 330 * 60000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (ms) => { const d = new Date(ms + IST); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
// Same day basis as guard.today() so the utm:/tpl: keys line up.
const dayKey = (ms) => new Date(ms + 0).toISOString().slice(0, 10);

async function mget(cfg, keys) {
  if (!keys.length) return [];
  const r = await guard.kvCommand(cfg, ["MGET"].concat(keys)).catch(() => ({}));
  return (r && r.result) || [];
}

async function buildWeekly(cfg) {
  const now = Date.now();
  const since = now - 7 * 86400000, prev = now - 14 * 86400000;
  const lines = [`📈 *DermaLuxe Weekly — ${fmtDay(since)} to ${fmtDay(now - 86400000)}*`, ""];
  const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  const ph10 = (v) => String(v || "").replace(/\D/g, "").slice(-10);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const trend = (a, b) => (b ? ` (${a >= b ? "▲ +" : "▼ "}${Math.round(((a - b) / b) * 100)}% vs last week)` : "");

  // Leads + funnel — this week vs last
  const leads = [], prevLeads = [];
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "699"]);
    for (const s of (r.result || [])) {
      const l = parse(s); if (!l || l.type === "job" || !l.ts) continue;
      if (l.ts >= since) leads.push(l); else if (l.ts >= prev) prevLeads.push(l);
    }
  } catch (e) {}
  const uniq = (arr) => new Set(arr.map((l) => ph10(l.phone)).filter((p) => p.length === 10)).size;
  const byType = {};
  leads.forEach((l) => { const k = l.type || "other"; byType[k] = (byType[k] || 0) + 1; });
  const booked = new Set(), prevBooked = new Set();
  leads.forEach((l) => { const p = ph10(l.phone); if (l.slot && l.date && p.length === 10) booked.add(p); });
  prevLeads.forEach((l) => { const p = ph10(l.phone); if (l.slot && l.date && p.length === 10) prevBooked.add(p); });
  let arrived = 0, noshow = 0, upcoming = 0, confirmed = 0;
  try {
    const seen = new Set();
    for (const key of ["appt:done", "appt:q"]) {
      const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "299"]).catch(() => ({}));
      for (const s of (q.result || [])) {
        const a = parse(s); if (!a || !a.at) continue;
        const k = `${a.ph}:${a.at}`; if (seen.has(k)) continue; seen.add(k);
        if (a.at >= since) {
          if (a.ph) booked.add(a.ph);
          if (a.v) arrived++; else if (a.ns) noshow++; else if (key === "appt:q") { upcoming++; if (a.cf) confirmed++; }
        } else if (a.at >= prev && a.ph) prevBooked.add(a.ph);
      }
    }
  } catch (e) {}
  const enq = uniq(leads), penq = uniq(prevLeads), bk = booked.size;
  lines.push(`💬 Enquiries: *${enq}*${trend(enq, penq)}`);
  const chan = Object.keys(byType).sort((x, y) => byType[y] - byType[x]).map((k) => `${k} ${byType[k]}`).join(" · ");
  if (chan) lines.push(`   ${chan}`);
  lines.push(`📅 Booked: *${bk}* (${Math.min(100, pct(bk, enq))}% of enquiries)${trend(bk, prevBooked.size)}`);
  lines.push(`✅ Vachharu: *${arrived}* · ❌ Raaledu: *${noshow}* · ⏳ Upcoming: *${upcoming}*${upcoming ? ` (${confirmed} confirmed)` : ""}`);
  lines.push(`📈 Enquiry → chair: *${pct(arrived, enq)}%*`);

  // Smart-link clicks by placement (last 7 full days), with last-week trend
  try {
    const tags = Object.keys(TAGS);
    const keys = [], pkeys = [];
    for (let d = 1; d <= 7; d++) for (const t of tags) keys.push(`utm:${t}:${dayKey(now - d * 86400000)}`);
    for (let d = 8; d <= 14; d++) for (const t of tags) pkeys.push(`utm:${t}:${dayKey(now - d * 86400000)}`);
    const vals = await mget(cfg, keys), pvals = await mget(cfg, pkeys);
    const per = {}; let total = 0;
    vals.forEach((v, i) => { const n = Number(v || 0); if (!n) return; const lab = TAGS[tags[i % tags.length]]; per[lab] = (per[lab] || 0) + n; total += n; });
    const ptotal = pvals.reduce((a, v) => a + Number(v || 0), 0);
    lines.push("", `🔗 Link clicks: *${total}*${trend(total, ptotal)}`);
    const top = Object.keys(per).sort((x, y) => per[y] - per[x]).slice(0, 6).map((k) => `${k} ${per[k]}`).join(" · ");
    lines.push(top ? `   ${top}` : "   (inka clicks levu — IG bio lo dermaluxe.ai/r/insta pettandi)");
  } catch (e) {}

  // Top concerns (first two words of each lead's concern)
  try {
    const cnt = {};
    leads.forEach((l) => {
      const c = String(l.concern || "").toLowerCase().replace(/[^a-z\s]/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");
      if (c.length > 2) cnt[c] = (cnt[c] || 0) + 1;
    });
    const top = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x]).slice(0, 5).map((k) => `${k} ${cnt[k]}`).join(" · ");
    if (top) lines.push("", `🔥 Top concerns: ${top}`);
  } catch (e) {}

  // Patient ratings this week
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "rv:log", "0", "199"]);
    const rs = (r.result || []).map(parse).filter((x) => x && x.ts >= since);
    if (rs.length) {
      const avg = (rs.reduce((a, x) => a + Number(x.rating || 0), 0) / rs.length).toFixed(1);
      const low = rs.filter((x) => Number(x.rating) <= 3).length;
      lines.push("", `⭐ Ratings: *${rs.length}* · avg *${avg}*${low ? ` · ⚠️ low ${low} (reviews tho chudandi)` : " · 👏"}`);
    }
  } catch (e) {}

  // Template volume + cost estimate
  try {
    const names = Array.from(MARKETING).concat(UTILITY);
    const keys = [];
    for (let d = 1; d <= 7; d++) for (const n of names) keys.push(`tpl:sent:${dayKey(now - d * 86400000)}:${n}`);
    const vals = await mget(cfg, keys);
    let m = 0, u = 0;
    vals.forEach((v, i) => { const n = Number(v || 0); if (!n) return; if (MARKETING.has(names[i % names.length])) m += n; else u += n; });
    if (m + u) lines.push("", `📨 Templates: *${m + u}* (marketing ${m} · utility ${u}) ≈ ₹${Math.round(m * COST.marketing + u * COST.utility)} est.`);
  } catch (e) {}

  const tips = [];
  if (!enq) tips.push("Ee week enquiries levu — IG post + *broadcast:* try cheyandi");
  if (enq && pct(bk, enq) < 40) tips.push("Booking % thakkuva — *reactivate* tho cold leads push cheyandi");
  if ((arrived + noshow) >= 4 && pct(noshow, arrived + noshow) > 25) tips.push("No-shows ekkuva — day-before confirm replies chudandi, raani vaallaki *noshow <phone>*");
  if (enq >= 5 && pct(arrived, enq) >= 30) tips.push("Enquiry → chair baaga undi 👏 — ads tho volume penchochu");
  if (tips.length) lines.push("", "💡 " + tips.slice(0, 2).join("\n💡 "));
  lines.push("", "Details: *funnel* · *reviews* · *report*");
  return {
    body: lines.join("\n").slice(0, 3200),
    oneLine: `Weekly: ${enq} enquiries · ${bk} booked · ${arrived} vachharu — reply 'weekly'`.slice(0, 200),
  };
}

module.exports = { buildWeekly };
