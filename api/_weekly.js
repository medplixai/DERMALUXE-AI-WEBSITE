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

  // ---- the scoreboard: per source, enquiries → A → booked → came ---------
  // The same leads, cut by where they came from, with the grade the qualifier
  // gave them and where the desk moved them. Then the things Stage 1 changed:
  // how many replies a booking took, advances paid, no-shows, and whether the
  // trust pack turned hesitation into a slot.
  try {
    const st = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({}))).result) || {};
    const grades = await require("./_qualify.js").forPhones(cfg, leads.map((l) => l.phone)).catch(() => ({}));
    const keyOf = (l) => `${l.ts}|${ph10(l.phone) || l.src_id || ""}`;
    const srcOf = (l) => l.ad_id ? "Meta ads" : ({ whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", messenger: "Facebook", web: "Website", website: "Website", phone_call: "Phone", missed_call: "Missed call", exotel: "Missed call", walkin: "Walk-in" })[String(l.type || l.src || "").toLowerCase()] || "Other";
    const rows = {};
    for (const l of leads) {
      const r = rows[srcOf(l)] || (rows[srcOf(l)] = { enq: new Set(), a: new Set(), booked: new Set(), came: new Set() });
      const p = ph10(l.phone) || l.src_id || String(l.ts);
      r.enq.add(p);
      const g = grades[ph10(l.phone)];
      if (g && g.grade === "A") r.a.add(p);
      const s = st[keyOf(l)] || "";
      if (s === "booked" || s === "visited" || (l.slot && l.date)) r.booked.add(p);
      if (s === "visited") r.came.add(p);
    }
    const order = Object.keys(rows).sort((x, y) => rows[y].enq.size - rows[x].enq.size);
    if (order.length) {
      lines.push("", "🏁 *Scoreboard — source → enquiries · A · booked · vachharu*");
      for (const k of order) { const r = rows[k]; lines.push(`   ${k}: ${r.enq.size} · ${r.a.size} · ${r.booked.size} · ${r.came.size}`); }
      const ads = rows["Meta ads"];
      if (ads) {
        const spend = await require("./ads.js").spend(cfg, 7).catch(() => null);
        if (spend != null) lines.push(`   Meta kharchu ₹${spend.toLocaleString("en-IN")}${ads.came.size ? ` → ₹${Math.round(spend / ads.came.size).toLocaleString("en-IN")} per patient vachchina` : ads.booked.size ? ` → ₹${Math.round(spend / ads.booked.size).toLocaleString("en-IN")} per booking` : " — inka evaru raaledu"}`);
      }
    }
    // replies to a booking, ad vs organic, this week
    const ttb = (((await guard.kvCommand(cfg, ["LRANGE", "ttb:log", "0", "499"]).catch(() => ({}))).result) || []).map(parse).filter((x) => x && x.ts >= since);
    const med = (arr) => { if (!arr.length) return 0; const s = arr.map((x) => x.turns).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const adT = ttb.filter((x) => x.ad), orT = ttb.filter((x) => !x.ad);
    if (ttb.length) lines.push(`⚡ Booking ki replies: ${adT.length ? `ads ${med(adT)}` : ""}${adT.length && orT.length ? " · " : ""}${orT.length ? `organic ${med(orT)}` : ""} (median, target 3)${ttb.filter((x) => x.known).length ? ` · ${ttb.filter((x) => x.known).length} paata patients malli book chesaru` : ""}`);
    // advances and no-shows among this week's visits
    let adv = 0, advCame = 0, advNs = 0, total = 0;
    for (const key of ["appt:done", "appt:q"]) {
      const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "299"]).catch(() => ({}));
      for (const s of (q.result || [])) {
        const a = parse(s); if (!a || !a.at || a.at < since || a.at > now + 7 * 86400000) continue;   // this week's slots, past and coming
        total++;
        if (a.adv) { adv++; if (a.v || a.arrived || a.status === "done" || a.status === "arrived") advCame++; if (a.ns || a.status === "noshow") advNs++; }
      }
    }
    if (adv) lines.push(`💳 Advance pay chesina slots: ${adv}/${total} · vachharu ${advCame} · raaledu ${advNs}`);
    // the trust pack: sent → booked afterwards
    const tl = (((await guard.kvCommand(cfg, ["LRANGE", "trust:log", "0", "499"]).catch(() => ({}))).result) || []).map(parse).filter((x) => x && x.ts >= since && x.n);
    if (tl.length) {
      const bookedAfter = tl.filter((x) => leads.some((l) => ph10(l.phone) === x.phone && (["booked", "visited"].includes(st[keyOf(l)] || "") || (l.slot && l.date)))).length;
      lines.push(`🤝 Trust pack (doctor + rating + results): ${tl.length} mandiki → ${bookedAfter} book chesaru`);
    }
    // recalls (treatment due) → booked after; campaigns → replied / booked
    const cyc = (((await guard.kvCommand(cfg, ["LRANGE", "cyc:log", "0", "499"]).catch(() => ({}))).result) || []).map(parse).filter((x) => x && x.ts >= since);
    if (cyc.length) {
      let bk2 = 0;
      for (const key of ["appt:q", "appt:done"]) {
        const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "399"]).catch(() => ({}));
        for (const s of (q.result || [])) { const a = parse(s); if (a && a.at > since && cyc.some((c) => c.phone === ph10(a.ph) && a.at > c.ts)) bk2++; }
      }
      lines.push(`🔁 Treatment due recalls: ${cyc.length} mandiki → ${bk2} book chesaru`);
    }
    const cmps = (await require("./_campaign.js").list(cfg, 10).catch(() => [])).filter((c) => c.ts >= since);
    for (const c of cmps) lines.push(`📣 ${c.name}: ${c.sent}/${c.n} vellindi · ${c.replied} reply · ${c.booked} booked`);
  } catch (e) { console.error("weekly: scoreboard", e && e.message); }

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
