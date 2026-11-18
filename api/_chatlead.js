// A good chat is a lead, whether or not the agent wrote one down.
//
// 15–17 Nov: 84 new people wrote on WhatsApp and 25 reached the Leads screen.
// 34 of the rest were graded A or B — the agent had their problem, often
// their name, their town, how long, when they could come ("Hydrafacial, 10
// rojula lopu, Tadepalligudem"; "hair fall, 1 year+, ee vaaram") — and the
// desk never saw them. A lead was written only when the model's own reply
// carried one with a name and a concern, and a lead with no name was thrown
// away unless a slot had been picked. The grading kept everything; the list
// the desk works from kept a third of it. Owner, 18 Nov: "chat lo manchi
// manchi leads unnai kani avi leads loki ravatledhu — vachelaa cheyyi".
//
// So: the moment a chat is graded A or B and the problem is known, it goes on
// the Leads screen — once, built from what the grading learned. A name the
// patient never typed is shown as their WhatsApp label, marked so, and never
// used to greet them. Left alone: a STOP, a job seeker, an Academy student,
// the owners, and anybody already on the list in the last 30 days.
//
// KV: chatlead:<phone> — this phone is on the list, or was put there (30 days).
const guard = require("./_guard.js");
const qualify = require("./_qualify.js");
const leadstore = require("./_leadstore.js");

const GOOD = new Set(["A", "B"]);
const KEEP_S = 30 * 86400;
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

// The row the desk sees, from the grading record. Null when it is not a lead yet.
function fromQual(rec, phone, o) {
  const opts = o || {};
  if (!rec || !GOOD.has(rec.grade)) return null;
  const f = rec.facts || {};
  const problem = String(f.problem || "").trim();
  if (!problem) return null;
  const name = String(f.name || "").trim().slice(0, 80);
  const label = name || (opts.profile ? `${String(opts.profile).slice(0, 40)} (WhatsApp peru)` : "(peru cheppaledu)");
  const lead = {
    ts: opts.at || Date.now(),   // when they last wrote — a catch-up row is not today's lead
    type: "whatsapp",
    name: label,
    phone,
    age: "", gender: "",
    concern: (problem + (f.problem_since ? ` — ${f.problem_since}` : "")).slice(0, 120),
    message: String(opts.last || "").slice(0, 400),
    mode: "", date: "", slot: "",
    skin_score: null, hair_score: null, skin_age: null, skin_type: "",
    treatments: [],
    page: "whatsapp-agent",
    heat: rec.grade === "A" ? "hot" : "warm",
    lang: "",
    call_prep: [f.prefers ? `Eppudu: ${f.prefers}` : "", f.asked_price ? "Price adigaru" : ""].filter(Boolean).join(" · ").slice(0, 220),
    src_id: phone,
    from_chat: true,
  };
  return Object.assign(lead, qualify.stamp(rec));
}

async function onList(cfg, phone) {
  const r = await guard.kvCommand(cfg, ["LRANGE", leadstore.LIST_KEY, "0", "499"]).catch(() => ({}));
  const cut = Date.now() - KEEP_S * 1000;
  for (const s of ((r && r.result) || [])) {
    try { const l = JSON.parse(s); if (ten(l.phone || l.src_id) === phone && Number(l.ts) > cut) return true; } catch (e) {}
  }
  return false;
}

// Put this phone on the Leads screen if its chat has become a lead.
// opts: {profile, last, alert, at}. Returns {saved} / {had} / {} (not a lead).
async function ensure(cfg, phoneIn, opts) {
  const o = opts || {};
  const phone = ten(phoneIn);
  if (!cfg || phone.length !== 10) return {};
  const mark = await guard.kvCommand(cfg, ["GET", `chatlead:${phone}`]).catch(() => ({}));
  if (mark && mark.result) return { had: true };
  const rec = await qualify.read(cfg, phone).catch(() => null);
  if (!rec || !GOOD.has(rec.grade) || !(rec.facts && rec.facts.problem)) return {};
  if (guard.ownerPhones().includes(phone)) return {};
  if (await guard.setHas(cfg, "optout", phone).catch(() => false)) return {};
  const [hrS, hrSt, acad] = await Promise.all(["hr:s:", "hr:st:", "acad:ph:"].map((k) => guard.kvCommand(cfg, ["GET", k + phone]).catch(() => ({}))));
  if ((hrS && hrS.result) || (hrSt && hrSt.result) || (acad && acad.result)) return {};
  if (await onList(cfg, phone)) {
    await guard.kvCommand(cfg, ["SET", `chatlead:${phone}`, "1", "EX", String(KEEP_S)]).catch(() => {});
    return { had: true };
  }
  const lead = fromQual(rec, phone, o);
  if (!lead) return {};
  // Which ad brought them, as the agent's own leads carry it.
  try {
    const ar = await guard.kvCommand(cfg, ["GET", `ad:ref:${phone}`]).catch(() => ({}));
    const ref = ar && ar.result ? JSON.parse(ar.result) : null;
    if (ref && ref.ad) {
      lead.ad_id = ref.ad; if (ref.headline) lead.ad_headline = ref.headline; if (ref.src) lead.ad_src = ref.src;
      if (ref.body) lead.ad_body = ref.body; if (ref.url) lead.ad_url = ref.url; if (ref.thumb) lead.ad_thumb = ref.thumb;
    }
  } catch (e) {}
  const nx = await guard.kvCommand(cfg, ["SET", `chatlead:${phone}`, "1", "NX", "EX", String(KEEP_S)]).catch(() => ({}));
  if (!(nx && nx.result)) return { had: true };
  try { const sync = await require("./_clinic.js").forwardLead(cfg, lead); if (sync && sync.attempted) lead.synced = sync.synced; } catch (e) {}
  const saved = await leadstore.saveLead(cfg, lead, (l) => ten(l.src_id || l.phone) === phone && l.type === lead.type && lead.ts - l.ts < 21600000);
  if (!saved) { await guard.kvCommand(cfg, ["DEL", `chatlead:${phone}`]).catch(() => {}); return {}; }
  if (o.alert) await require("./_notify.js").leadAlert(cfg, lead).catch(() => {});
  return { saved: true, lead };
}

// The hourly pass: every WhatsApp chat active in the last `hours` that has
// become a lead and is not on the list. The desk is alerted only for chats
// from the last two hours — the first run, catching up on days, stays quiet.
async function sweep(cfg, opts) {
  const o = opts || {};
  const res = { looked: 0, saved: 0 };
  if (!cfg) return res;
  const now = o.now || Date.now();
  const rows = (o.rows) || await require("./_inbox.js").threads(cfg, 300);
  for (const t of rows) {
    if (res.saved >= (o.max || 60)) break;
    const ph = ten(t.phone);
    if (ph.length !== 10 || !t.lastIn || now - Number(t.lastIn) > (o.hours || 72) * 3600000) continue;
    res.looked++;
    const r = await ensure(cfg, ph, { profile: t.name || "", alert: now - Number(t.lastIn) < 2 * 3600000, at: Math.min(Number(t.lastIn), now) });
    if (r.saved) res.saved++;
  }
  return res;
}

module.exports = { ensure, sweep, fromQual, GOOD };
