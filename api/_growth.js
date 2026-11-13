// Where the leads come from, day by day — and which ad is bringing them.
//
// The Ads screen was built around the clinic's own Meta ad account, and on
// 13 November 2026 that account had spent nothing for thirty days. Half the
// leads were still arriving from ads: Instagram in-app boosts the owner pays
// for from a phone, which live in an account this server cannot see. When one
// of those boosts ran out, leads fell from 14 a day to 3 and nothing on any
// screen said why.
//
// Every one of those chats carries the ad's id (Meta's click-to-WhatsApp
// referral), so the answer is already in our own lead book. This reads it:
// per day, per channel, per ad — and says when an ad that was bringing people
// in has gone quiet. Nothing here needs a Meta token; Meta's spend is laid on
// top when the account is connected.
//
// All pure functions of the leads and their statuses, so the tests can give
// it any shape of week they like.

const DAY = 86400000;
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

// Eluru's calendar day, not UTC's: a chat at 1 AM belongs to the day the desk
// thinks it does.
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" });
const wdFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" });
const dayOf = (ts) => dayFmt.format(new Date(Number(ts)));
const hourOf = (ts) => Number(hourFmt.format(new Date(Number(ts)))) % 24;
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayOf = (ts) => WD.indexOf(wdFmt.format(new Date(Number(ts))));

// What an ad, or a person, was asking about. Shared with the WhatsApp agent,
// which uses it to skip "what is your concern?" for somebody who tapped an
// ad that already said.
const CONCERNS = [
  [/hair\s*transplant|fue|dhi|bald/i, "hair transplant"], [/hair\s*(fall|loss)|prp|gfc|thinning|dandruff|scalp|juttu/i, "hair fall"],
  [/pigment|melasma|dark\s*spot|tan|pico|glow|bright/i, "pigmentation"], [/acne|pimple|scar|motimalu/i, "acne"],
  [/laser\s*hair|hair\s*removal|unwanted\s*hair/i, "laser hair removal"], [/hydra|facial/i, "Hydrafacial"],
  [/wrinkle|botox|filler|anti[-\s]*ag|hifu|thread|tight/i, "anti-ageing"], [/weight|fat|slim|body/i, "weight loss"],
  [/eczema|psoriasis|vitiligo|fungal|allerg|rash|itch/i, "skin disease"], [/wart|mole|skin\s*tag/i, "wart / mole removal"],
  [/academy|course|training/i, "academy"],
];
const concernOf = (text) => { const t = String(text || ""); for (const [re, c] of CONCERNS) if (re.test(t)) return c; return ""; };

// The channels, in the order they are stacked on the chart. "job" is drawn
// apart: somebody asking for work is not a patient, and counting them as
// leads made the busiest ad look like the best one.
const CHANNELS = ["ours", "boost", "post", "insta", "organic", "desk", "job"];
const LABEL = {
  ours: "Mana ad account", boost: "Instagram boost", post: "Post button", insta: "Insta / FB DM",
  organic: "WhatsApp / website", desk: "Phone / walk-in", job: "Patient kaadu (job etc.)",
};

// A job seeker, or somebody the agent marked as not a patient at all.
const isJob = (l) => l.type === "job" || String(l.intent || "") === "not_patient";
function channelOf(l, ours) {
  if (isJob(l)) return "job";
  if (l.ad_id) {
    if (String(l.ad_src || "") === "post") return "post";
    // With no list from Meta, "is this ours" has no answer. A paid ad id we
    // cannot place is a boost — on this clinic that is what they have been.
    return ours && ours.has(String(l.ad_id)) ? "ours" : "boost";
  }
  const t = String(l.type || l.src || "").toLowerCase();
  if (/instagram|ig_|facebook|messenger/.test(t)) return "insta";
  if (/phone|walkin|walk-in|desk/.test(t) || l.manual) return "desk";
  return "organic";
}

const keyOf = (l) => `${l.ts}|${digits10(l.phone) || l.src_id || ""}`;
const statusOf = (st, l) => String((st || {})[keyOf(l)] || "");
const bookedS = (s) => s === "booked" || s === "visited";

// ---- the chart: one bar per day ---------------------------------------------
function flow(leads, st, opts) {
  const o = opts || {};
  const now = o.now || Date.now(), days = Math.max(1, Math.min(60, o.days || 14));
  const ours = o.ours || null, spend = o.spend || {};
  const rows = [];
  const at = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(now - i * DAY);
    if (at[d]) continue;
    const r = { day: d, total: 0, booked: 0, spend: spend[d] == null ? null : Math.round(spend[d]) };
    for (const c of CHANNELS) r[c] = 0;
    at[d] = r; rows.push(r);
  }
  for (const l of leads || []) {
    const r = at[dayOf(l.ts)];
    if (!r) continue;
    const c = channelOf(l, ours);
    r[c]++;
    if (c !== "job") { r.total++; if (bookedS(statusOf(st, l))) r.booked++; }
  }
  return rows;
}

// ---- the leaderboard: one row per ad ----------------------------------------
// "Going quiet" is the alert the owner needed on 13 November. An ad is quiet
// when it was bringing a lead a day or more and has brought none for a day.
const QUIET_H = 24, STOP_H = 48, BUSY = 3;   // BUSY = leads in the 3 days before going quiet

function adRows(leads, st, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const ours = o.ours || null, paid = o.paid || {}, meta = o.meta || {};
  const by = {};
  for (const l of leads || []) {
    if (!l.ad_id) continue;
    const id = String(l.ad_id);
    const r = by[id] || (by[id] = {
      id, kind: channelOf(Object.assign({}, l, { type: "whatsapp" }), ours),
      label: "", body: "", link: "", thumb: "", leads: 0, jobs: 0, booked: 0, came: 0,
      first: Infinity, last: 0, week: Array(7).fill(0), concerns: {}, local: 0, far: 0, towns: 0,
    });
    // The words somebody would recognise the ad by. Meta's "headline" for an
    // Instagram boost is often just "api.whatsapp.com", which is no name.
    const h = String(l.ad_headline || "").trim();
    if (!r.label && h && !/^(api\.)?whatsapp\.com$|^wa\.me/i.test(h)) r.label = h.slice(0, 80);
    if (!r.body && l.ad_body) r.body = String(l.ad_body).slice(0, 140);
    if (!r.link && l.ad_url) r.link = String(l.ad_url).slice(0, 300);
    if (!r.thumb && l.ad_thumb) r.thumb = String(l.ad_thumb).slice(0, 400);
    if (isJob(l)) { r.jobs++; continue; }
    r.leads++;
    const s = statusOf(st, l);
    if (bookedS(s)) r.booked++;
    if (s === "visited") r.came++;
    const ts = Number(l.ts);
    r.first = Math.min(r.first, ts); r.last = Math.max(r.last, ts);
    const ago = Math.floor((now - ts) / DAY);
    if (ago >= 0 && ago < 7) r.week[6 - ago]++;
    const c = concernOf(l.concern) || concernOf(l.ad_headline) || "";
    if (c) r.concerns[c] = (r.concerns[c] || 0) + 1;
    if (l.km != null && l.km !== "") { r.towns++; if (Number(l.km) <= 40) r.local++; else if (Number(l.km) > 80) r.far++; }
  }
  return Object.values(by).map((r) => {
    const m = meta[r.id] || {};
    const spent = r.kind === "ours" ? (m.spend == null ? null : Math.round(m.spend)) : (paid[r.id] ? Math.round(paid[r.id].rupees) : null);
    const sinceH = r.last ? Math.round((now - r.last) / 3600000) : null;
    const before = (leads || []).filter((l) => String(l.ad_id) === r.id && !isJob(l) && Number(l.ts) >= r.last - 3 * DAY).length;
    const state = !r.last ? "none"
      : sinceH < QUIET_H ? "live"
      : sinceH < STOP_H ? (before >= BUSY ? "slow" : "live")
      : "stopped";
    return {
      id: r.id, kind: r.kind, label: r.label || m.name || r.body || "", body: r.body, link: r.link || m.link || "", thumb: r.thumb || m.thumb || "",
      leads: r.leads, jobs: r.jobs, booked: r.booked, came: r.came,
      first: r.first === Infinity ? null : r.first, last: r.last || null, sinceH, state,
      week: r.week,
      concerns: Object.entries(r.concerns).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, n })),
      local: r.local, far: r.far, towns: r.towns,
      spent, paidNote: paid[r.id] ? paid[r.id].note || "" : "",
      perLead: spent && r.leads ? Math.round(spent / r.leads) : null,
      perBooked: spent && r.booked ? Math.round(spent / r.booked) : null,
    };
  }).sort((a, b) => (b.booked - a.booked) || (b.leads - a.leads));
}

// The one to put money behind next: most bookings for the money where the
// money is known, otherwise most bookings, otherwise most leads. Needs enough
// to be more than luck.
function winner(rows) {
  const ok = (rows || []).filter((r) => r.leads >= 5);
  if (!ok.length) return null;
  const priced = ok.filter((r) => r.perBooked);
  if (priced.length >= 2) return priced.sort((a, b) => a.perBooked - b.perBooked)[0].id;
  // A rate over a handful of leads is luck; a count is not.
  const top = ok.slice().sort((a, b) => b.booked - a.booked || b.leads - a.leads)[0];
  return top.booked ? top.id : null;
}

// ---- when people write -------------------------------------------------------
// The hour a lead arrives is the hour the ad should be showing and the desk
// should be answering. Patients only.
function rhythm(leads) {
  const hours = Array(24).fill(0), week = Array(7).fill(0);
  for (const l of leads || []) {
    if (isJob(l)) continue;
    hours[hourOf(l.ts)]++;
    const w = weekdayOf(l.ts); if (w >= 0) week[w]++;
  }
  let most = 0, peakH = null;
  // The best three-hour stretch, because nobody schedules ads by the hour.
  for (let h = 0; h < 24; h++) {
    const n = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
    if (n > most) { most = n; peakH = h; }
  }
  const total = hours.reduce((a, b) => a + b, 0);
  return { hours, week, peak: peakH == null ? null : { from: peakH, to: (peakH + 3) % 24, share: total ? Math.round((most / total) * 100) : 0 } };
}

function concernMix(leads, st, ours) {
  const out = {};
  for (const l of leads || []) {
    if (isJob(l)) continue;
    const ch = channelOf(l, ours);
    const c = concernOf(l.concern) || concernOf(l.ad_headline) || "other";
    const r = out[c] || (out[c] = { name: c, n: 0, ads: 0, booked: 0 });
    r.n++;
    if (ch === "ours" || ch === "boost") r.ads++;
    if (bookedS(statusOf(st, l))) r.booked++;
  }
  return Object.values(out).sort((a, b) => b.n - a.n).slice(0, 8);
}

// ---- what is worth a message to the owner -----------------------------------
function quietAds(rows) {
  return (rows || []).filter((r) => r.state === "slow" || (r.state === "stopped" && r.sinceH < 96 && r.leads >= BUSY))
    .filter((r) => r.kind !== "post");
}

// The comparison the owner made in their head on 13 November: today against
// the days before it, for ad leads only — and at the same hour, because ten
// in the morning is always "fewer than yesterday".
function dropToday(leads, opts) {
  const o = opts || {};
  const now = o.now || Date.now(), ours = o.ours || null;
  const h = hourOf(now);
  if (h < 12) return null;
  const t0 = Date.parse(`${dayOf(now)}T00:00:00+05:30`), into = now - t0;
  const isAd = (l) => { const c = channelOf(l, ours); return c === "ours" || c === "boost"; };
  const ad = (leads || []).filter(isAd).map((l) => Number(l.ts));
  const today = ad.filter((ts) => ts >= t0 && ts <= now).length;
  let sum = 0;
  for (let i = 1; i <= 7; i++) { const a = t0 - i * DAY; sum += ad.filter((ts) => ts >= a && ts <= a + into).length; }
  const avg = sum / 7;
  if (avg < 3) return null;
  const pct = Math.round((1 - today / avg) * 100);
  return pct >= 50 ? { today, avg: Math.round(avg * 10) / 10, pct, by: h } : null;
}

module.exports = { flow, adRows, winner, rhythm, concernMix, quietAds, dropToday, channelOf, concernOf, CONCERNS, CHANNELS, LABEL, dayOf, hourOf, QUIET_H, STOP_H };
