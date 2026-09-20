// What a lead is worth to the clinic, out of facts rather than a feeling.
//
// The agent used to hand the desk one word — hot, warm, cold — that the model
// picked by feel. What actually separates a patient who comes from one who
// does not is: how far they live, whether they mean to be treated or are
// price-shopping, how soon they want it, whether they have sent a photo of
// the problem, and whether they kept talking. Every point here carries the
// sentence that earned it, so the desk can see why a name is at the top.
//
// Nothing is inferred from the ad they clicked — the ad is what WE chose.
//
// KV:
//   qual:<phone>       the facts learned so far, the score and grade (30 days)
//   qual:hot:<phone>   set once the desk has been told this is an A (7 days)
//   qual:capi:<phone>  set once Meta has been told they qualified (30 days)
const guard = require("./_guard.js");
const crypto = require("crypto");

// ---- places: road kilometres from the clinic in Eluru, rounded --------------
const PLACES = [
  ["eluru", "Eluru", 0, ["eluru", "elur", "ఏలూరు", "ఎల్లోరు", "yeluru", "rr peta", "ramachandra rao peta", "powerpet", "power peta", "satrampadu", "vatluru", "tangellamudi"]],
  ["denduluru", "Denduluru", 10, ["denduluru", "దెందులూరు"]],
  ["pedavegi", "Pedavegi", 12, ["pedavegi", "పెదవేగి"]],
  ["pedapadu", "Pedapadu", 12, ["pedapadu", "పెదపాడు"]],
  ["bhimadole", "Bhimadole", 20, ["bhimadole", "bhimadolu", "భీమడోలు"]],
  ["hanuman_junction", "Hanuman Junction", 20, ["hanuman junction", "hanuman jn", "హనుమాన్ జంక్షన్"]],
  ["kalla", "Kalla", 25, ["kalla", "కల్ల"]],
  ["nuzvid", "Nuzvid", 25, ["nuzvid", "nuzividu", "నూజివీడు"]],
  ["unguturu", "Unguturu", 22, ["unguturu", "ఉంగుటూరు"]],
  ["ganapavaram", "Ganapavaram", 28, ["ganapavaram", "గణపవరం"]],
  ["tadepalligudem", "Tadepalligudem", 35, ["tadepalligudem", "tpgudem", "tp gudem", "తాడేపల్లిగూడెం", "తాడేపల్లి గూడెం"]],
  ["gudivada", "Gudivada", 40, ["gudivada", "గుడివాడ"]],
  ["chintalapudi", "Chintalapudi", 45, ["chintalapudi", "చింతలపూడి"]],
  ["jangareddygudem", "Jangareddygudem", 45, ["jangareddygudem", "jangareddy gudem", "జంగారెడ్డిగూడెం"]],
  ["akividu", "Akividu", 45, ["akividu", "akiveedu", "ఆకివీడు"]],
  ["kaikaluru", "Kaikaluru", 50, ["kaikaluru", "kaikalur", "కైకలూరు"]],
  ["undi", "Undi", 50, ["undi", "ఉండి"]],
  ["tanuku", "Tanuku", 55, ["tanuku", "తణుకు"]],
  ["vijayawada", "Vijayawada", 60, ["vijayawada", "bezawada", "vja", "విజయవాడ", "gannavaram", "గన్నవరం", "ibrahimpatnam"]],
  ["bhimavaram", "Bhimavaram", 60, ["bhimavaram", "bheemavaram", "భీమవరం"]],
  ["nidadavolu", "Nidadavolu", 60, ["nidadavolu", "nidadavole", "నిడదవోలు"]],
  ["kovvur", "Kovvur", 75, ["kovvur", "kovvuru", "కొవ్వూరు"]],
  ["palakollu", "Palakollu", 80, ["palakollu", "palakol", "పాలకొల్లు"]],
  ["machilipatnam", "Machilipatnam", 85, ["machilipatnam", "bandar", "మచిలీపట్నం", "బందరు"]],
  ["rajahmundry", "Rajahmundry", 90, ["rajahmundry", "rajamandry", "rajamahendravaram", "రాజమండ్రి", "రాజమహేంద్రవరం"]],
  ["narsapur", "Narsapur", 90, ["narsapur", "narasapuram", "నరసాపురం", "నర్సాపురం"]],
  ["tenali", "Tenali", 90, ["tenali", "తెనాలి"]],
  ["guntur", "Guntur", 95, ["guntur", "గుంటూరు"]],
  ["amalapuram", "Amalapuram", 120, ["amalapuram", "అమలాపురం"]],
  ["khammam", "Khammam", 110, ["khammam", "ఖమ్మం"]],
  ["kakinada", "Kakinada", 140, ["kakinada", "కాకినాడ"]],
  ["ongole", "Ongole", 200, ["ongole", "ఒంగోలు"]],
  ["visakhapatnam", "Visakhapatnam", 320, ["visakhapatnam", "vizag", "vishakapatnam", "విశాఖపట్నం", "వైజాగ్"]],
  ["hyderabad", "Hyderabad", 330, ["hyderabad", "hyd", "secunderabad", "హైదరాబాద్", "హైదరాబాదు"]],
  ["nellore", "Nellore", 320, ["nellore", "నెల్లూరు"]],
  ["tirupati", "Tirupati", 430, ["tirupati", "tirupathi", "తిరుపతి"]],
  ["chennai", "Chennai", 480, ["chennai", "madras", "చెన్నై"]],
  ["bengaluru", "Bengaluru", 700, ["bangalore", "bengaluru", "బెంగళూరు"]],
].map(([key, en, km, aliases]) => ({ key, en, km, aliases }));

// Telugu vowel signs are combining marks (\p{M}); stripping them broke every Telugu name.
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{M}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
function placeOf(village) {
  const v = norm(village);
  if (!v) return { known: false, label: "", km: null };
  for (const p of PLACES) for (const a of p.aliases) if (v === a || v.includes(a)) return { known: true, label: p.en, km: p.km, key: p.key };
  return { known: false, label: String(village || "").slice(0, 40), km: null };
}
const ringOf = (km) => (km == null ? null : km <= 25 ? "local" : km <= 80 ? "district" : km <= 150 ? "region" : "far");

// ---- the score ---------------------------------------------------------------
const INTENTS = ["book_now", "considering", "price_only", "info_only", "not_patient"];
const URGENCY = ["emergency", "this_week", "this_month", "later", "unknown"];
const GRADE_OF = (s) => (s >= 70 ? "A" : s >= 45 ? "B" : s >= 25 ? "C" : "D");
// Treatments where one patient is a course of sittings or a procedure, not a single consult.
const HIGH_VALUE = /(hair transplant|transplant|fue|dhi|laser hair|full body|pico|hifu|mnrf|prp|gfc|botox|filler|thread|weight loss|bridal|academy|course)/i;

function scoreLead(q) {
  const signals = [];
  const add = (key, points, why) => { if (points) signals.push({ key, points, why }); };
  const place = placeOf(q.village);
  const km = place.known ? place.km : null;
  const ring = ringOf(km);

  if (ring === "local") add("near", 25, `${place.label} — ${km} km, daggare`);
  else if (ring === "district") add("district", 14, `${place.label} — ${km} km`);
  else if (ring === "region") add("far", -8, `${place.label} — ${km} km, raavadam kashtam`);
  else if (ring === "far") add("very_far", -20, `${place.label} — ${km} km, video consult matrame`);

  if (q.intent === "book_now") add("intent", 30, "raavadaniki ready");
  else if (q.intent === "considering") add("intent", 16, "alochistunnaru");
  else if (q.intent === "price_only") add("intent", 4, "price matrame adigaru");
  else if (q.intent === "not_patient") add("intent", -45, "patient kaadu (job / sales / wrong number)");

  if (q.urgency === "emergency") add("urgency", 22, "ippude kavali");
  else if (q.urgency === "this_week") add("urgency", 18, "ee vaaram lo");
  else if (q.urgency === "this_month") add("urgency", 9, "ee nela lo");
  else if (q.urgency === "later") add("urgency", -5, "tarvata chustaru");

  if (q.problem) add("problem", 10, `samasya chepparu: ${String(q.problem).slice(0, 40)}`);
  // Somebody counting months has decided to get it treated.
  if (q.problem_since) add("since", 14, `entakalam nundo chepparu: ${String(q.problem_since).slice(0, 30)}`);
  // Asking the price is a buy signal, not an objection.
  if (q.asked_price) add("asked_price", 12, "price adigaru — konalanukunna vaalle adugutaru");
  // A skin clinic's own signal: a photo of the problem is a person who wants it looked at.
  if (q.photo_sent) add("photo", 12, "problem photo pampaaru");
  if (q.problem && HIGH_VALUE.test(String(q.problem))) add("high_value", 6, "course / procedure ayye treatment");
  if (q.prefers) add("prefers", 8, `eppudu raagalaro chepparu: ${String(q.prefers).slice(0, 30)}`);
  if (q.decision_maker === "family") add("family", -4, "intlo vaallu decide cheyyali");
  if (q.name) add("name", 4, "peru chepparu");

  const inbound = Number(q.inboundCount || 0);
  if (inbound >= 5) add("talking", 16, `${inbound} messages raasaru`);
  else if (inbound >= 3) add("talking", 11, `${inbound} messages raasaru`);
  else if (inbound === 2) add("talking", 5, "rendu messages");
  else if (inbound <= 1) add("one_message", -6, "okka message tarvata matladaledu");
  if (q.repliedToNudge) add("replied_nudge", 9, "mana reminder ki reply ichcharu");

  if (q.opted_out) add("opted_out", -100, "messages vaddannaru");
  if (q.status === "booked") add("booked", 30, "appointment book ayindi");
  if (q.status === "visited") add("visited", 40, "clinic ki vachcharu");
  if (q.status === "closed") add("closed", -25, "desk close chesindi");

  const raw = signals.reduce((s, x) => s + x.points, 0);
  let score = Math.max(0, Math.min(100, 20 + raw));
  // An A tells the desk "call now", so it must mean they said they want to come.
  const said = !!q.intent || (q.urgency && q.urgency !== "unknown") || !!q.prefers || q.status === "booked" || q.status === "visited";
  if (!said && score >= 70) { score = 69; signals.push({ key: "no_intent_yet", points: 0, why: "vastanani inka cheppaledu — adigaka A avutundi" }); }
  return { score, grade: GRADE_OF(score), signals, km, ring, place: place.known ? place.label : "" };
}

// ---- reading facts out of what was actually typed ---------------------------
// The model fills "qual" most of the time. A deterministic pass over the raw
// words catches what it forgets, and is the only thing that can grade the
// leads that came in before any of this existed.
const DURATION = /(\d+\s*(?:\+\s*)?(?:nela(?:lu|llu)?|months?|mnths?|years?|yrs?|sam+vatsara(?:lu|alu)?|rojulu|days?|weeks?|vaaram|varam|వారం|నెల(?:లు)?|సంవత్సర(?:ం|ాలు)?|రోజులు)|(?:chaala|చాలా|many|several)\s*(?:years?|nelalu|సంవత్సరాలు|నెలలు))/i;
const PRICE_ASK = /(entha|enta\b|ento|ఎంత|how much|price|cost|fee|charge|rate|ఖర్చు|ఫీజు|free na|ఉచిత|budget)/i;
const BOOK_NOW = /(book|slot|vasta(?:nu|m|ru)?|వస్తాను|వస్తాం|appointment kavali|raavali|confirm cheyandi|ready|ఇప్పుడే|ventane rand)/i;
const CONSIDER = /(alochi|ఆలోచి|thinking|later chuda|maatladi cheptanu|intlo adigi|discuss)/i;
const NOT_PATIENT = /(\bjob\b|ఉద్యోగ|udyoga|vacancy|resume|\bcv\b|hiring|salary entha|marketing executive|\bsales\b|medical rep|business proposal|partnership|promote your|seo|website design)/i;
const EMERGENCY = /(emergency|అత్యవసర|ventane|bleeding|raktam|chemu|swelling ekkuva|burn|కాలిన|allergy ekkuva|severe)/i;
const THIS_WEEK = /(ee vaaram|this week|repu|tomorrow|ee roju|today|రేపు|ఈరోజు|ఈ వారం|saturday|sunday|monday|tuesday|wednesday|thursday|friday)/i;
const THIS_MONTH = /(ee nela|this month|ఈ నెల|next week|vachche vaaram)/i;
const LATER = /(tarvata|later|next month|vachche nela|తర్వాత|konchem time|after \d)/i;
const FAMILY = /(intlo|ఇంట్లో|amma|nanna|husband|wife|family ni adigi|వాళ్ళని అడిగి)/i;

// A town named in the middle of a sentence. Short aliases ("undi", "kalla" are
// ordinary Telugu words) only count next to a "from" word.
function placeIn(text) {
  const t = norm(text);
  if (!t) return null;
  for (const p of PLACES) {
    for (const a of p.aliases) {
      const al = norm(a);
      if (!al) continue;
      const rx = new RegExp(`(^|[^\\p{L}\\p{M}])${al.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{M}]|$)`, "u");
      if (!rx.test(t)) continue;
      if (al.length < 5) {
        const near = new RegExp(`${al}\\s*(nunchi|nundi|nunci|lo\\b|నుంచి|నుండి|లో)`, "u");
        if (!near.test(t)) continue;
      }
      return { village: p.en, km: p.km };
    }
  }
  return null;
}

// Facts a person can read out of the words themselves.
function extract(text) {
  const t = String(text || "");
  if (!t.trim()) return {};
  const f = {};
  const place = placeIn(t);
  if (place) f.village = place.village;
  const d = t.match(DURATION);
  if (d) f.problem_since = d[0].trim().slice(0, 40);
  if (PRICE_ASK.test(t)) f.asked_price = true;
  if (NOT_PATIENT.test(t)) f.intent = "not_patient";
  else if (BOOK_NOW.test(t)) f.intent = "book_now";
  else if (CONSIDER.test(t)) f.intent = "considering";
  else if (PRICE_ASK.test(t)) f.intent = "price_only";
  if (EMERGENCY.test(t)) f.urgency = "emergency";
  else if (THIS_WEEK.test(t)) f.urgency = "this_week";
  else if (THIS_MONTH.test(t)) f.urgency = "this_month";
  else if (LATER.test(t)) f.urgency = "later";
  if (FAMILY.test(t)) f.decision_maker = "family";
  return f;
}

// What the desk should do with this lead next, in one line.
function nextAction(rec, lead) {
  const l = lead || {}, f = (rec && rec.facts) || {};
  const st = l.status || "new";
  if (st === "booked" || st === "visited") return { kind: "done", text: st === "visited" ? "Vachcharu ✅" : "Book ayindi — reminder veltundi" };
  if (st === "closed") return { kind: "done", text: "Close chesaru" };
  if (rec && rec.grade === "D") return { kind: "skip", text: (f.intent === "not_patient" ? "Patient kaadu" : rec.km > 150 ? "Chala dooram" : "Cold") + " — vadileyandi" };
  if (l.optedOut) return { kind: "skip", text: "STOP chesaru — messages vaddu" };
  const noteCount = (l.notes || []).length;
  if (rec && rec.grade === "A" && !noteCount) return { kind: "call", text: "Ippude call cheyandi 🔥" };
  if (rec && rec.km != null && rec.km > 80) return { kind: "video", text: `${rec.km} km — video consultation offer cheyandi` };
  if (!f.problem_since) return { kind: "ask", text: "Adagandi: entakalam nundi undi?" };
  if (!f.village) return { kind: "ask", text: "Adagandi: e ooru nundi?" };
  if (f.prefers && st === "new") return { kind: "book", text: `Slot pettandi — ${String(f.prefers).slice(0, 24)}` };
  if (!f.prefers) return { kind: "ask", text: "Adagandi: eppudu raagalaru?" };
  if (st === "contacted") return { kind: "call", text: "Malli follow-up cheyandi" };
  return { kind: "call", text: "Call chesi slot pettandi" };
}

// Every qual record for a page of leads, in one trip.
async function forPhones(cfg, phones) {
  const list = [...new Set((phones || []).map(ten).filter((p) => p.length === 10))];
  if (!cfg || !list.length) return {};
  const r = await guard.kvCommand(cfg, ["MGET"].concat(list.map((p) => `qual:${p}`))).catch(() => ({}));
  const out = {};
  ((r && r.result) || []).forEach((v, i) => { const rec = parse(v || "", null); if (rec) out[list[i]] = rec; });
  return out;
}

// Grade the leads that came in before any of this existed, a batch at a time.
// Their facts come from what they typed — the enquiry text, the call prep, and
// their WhatsApp thread — never from a guess.
async function backfill(cfg, limit) {
  if (!cfg) return { scanned: 0, graded: 0 };
  const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "399"]).catch(() => ({}));
  const rows = ((r && r.result) || []).map((x) => parse(x, null)).filter((l) => l && ten(l.phone).length === 10);
  const have = await forPhones(cfg, rows.map((l) => l.phone));
  const st = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({}))).result) || {};
  const out = { scanned: 0, graded: 0 };
  for (const l of rows) {
    const ph = ten(l.phone);
    if (have[ph]) continue;
    out.scanned++;
    if (out.graded >= (limit || 25)) break;
    const inb = await require("./_inbox.js").thread(cfg, ph).catch(() => null);
    const chat = inb ? (inb.msgs || []).filter((m) => m.dir === "in").map((m) => m.text).join(" \n ") : "";
    const text = [l.concern, l.message, l.call_prep, chat].filter(Boolean).join(" \n ");
    const f = extract(text);
    if (l.name) f.name = l.name;
    if (l.slot || l.date) f.prefers = [l.date, l.slot].filter(Boolean).join(" ").slice(0, 40);
    if (/^academy/i.test(String(l.concern || ""))) f.problem = f.problem || String(l.concern).slice(0, 120);
    else if (l.concern) f.problem = String(l.concern).slice(0, 120);
    if (/\[📷|photo/i.test(text)) f.photo_sent = true;
    const status = st[`${l.ts}|${ph}`] || "new";
    const inbound = inb ? (inb.msgs || []).filter((m) => m.dir === "in").length : (l.type === "web" || l.type === "lead" ? 1 : 2);
    await absorb(cfg, ph, f, { inboundCount: inbound, status, channel: l.type || "", photo_sent: f.photo_sent });
    out.graded++;
  }
  return out;
}

// ---- the record --------------------------------------------------------------
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const KEEP = String(30 * 86400);
const clean = (v, n) => { const s = String(v == null ? "" : v).trim(); return s ? s.slice(0, n) : null; };

async function read(cfg, phone) {
  const ph = ten(phone);
  if (!cfg || ph.length !== 10) return null;
  return parse(((await guard.kvCommand(cfg, ["GET", `qual:${ph}`]).catch(() => ({}))) || {}).result || "", null);
}

// Merge what the agent just learned into the record and re-score. Facts already
// there survive a call that does not mention them. `ctx` carries what the
// conversation itself shows: inboundCount, status, opted_out, photo_sent.
// Returns the result, plus `line` — one bracketed line for the model's context.
async function absorb(cfg, phone, facts, ctx) {
  const ph = ten(phone);
  if (!cfg || ph.length !== 10) return null;
  const prev = (await read(cfg, ph)) || { facts: {} };
  const f = Object.assign({}, prev.facts || {});
  const F = facts || {};
  if (INTENTS.includes(F.intent)) f.intent = F.intent;
  if (URGENCY.includes(F.urgency)) f.urgency = F.urgency;
  for (const [k, n] of [["problem", 120], ["problem_since", 60], ["village", 80], ["prefers", 80], ["name", 80]]) { const v = clean(F[k], n); if (v) f[k] = v; }
  if (["self", "family"].includes(F.decision_maker)) f.decision_maker = F.decision_maker;
  if (F.asked_price === true) f.asked_price = true;      // once true, always true
  if (F.photo_sent === true || (ctx && ctx.photo_sent)) f.photo_sent = true;
  const c = ctx || {};
  const r = scoreLead(Object.assign({}, f, {
    inboundCount: c.inboundCount != null ? c.inboundCount : prev.inbound,
    repliedToNudge: c.repliedToNudge != null ? c.repliedToNudge : prev.repliedToNudge,
    opted_out: c.opted_out, status: c.status || prev.status,
  }));
  const rec = { facts: f, score: r.score, grade: r.grade, km: r.km, ring: r.ring, place: r.place, signals: r.signals.slice(0, 6), inbound: c.inboundCount != null ? c.inboundCount : prev.inbound,
    status: c.status || prev.status, at: Date.now(), wasGrade: prev.grade || null, channel: c.channel || prev.channel || "" };
  await guard.kvCommand(cfg, ["SET", `qual:${ph}`, JSON.stringify(rec), "EX", KEEP]).catch(() => {});
  return Object.assign({ line: contextLine(rec), changed: prev.grade !== r.grade }, rec);
}

// What the model should know back: how far they are, and therefore what to offer.
function contextLine(rec) {
  if (!rec) return "";
  const bits = [];
  if (rec.km != null) {
    bits.push(`patient is from ${rec.place}, ~${rec.km} km from Eluru`);
    if (rec.ring === "far" || rec.km > 150) bits.push("very far — offer a VIDEO consultation first, never chase clinic slots");
    else if (rec.km > 80) bits.push("far — offer video consultation, or one planned morning visit; say the real km, never guess travel time");
    else if (rec.km > 25) bits.push("offer a morning or afternoon slot so it is one trip; mention video consultation as an option");
  }
  const missing = ["problem", "problem_since", "village", "prefers"].filter((k) => !(rec.facts || {})[k]);
  if (missing.length) bits.push(`still unknown: ${missing.join(", ")} — ask the next one, riding on something useful`);
  bits.push(`lead grade ${rec.grade} (${rec.score})`);
  return `[${bits.join("; ")}] `;
}

// Tell the desk about an A the moment it becomes one — while the patient is
// still typing, which is when a call lands best. Once per number per week.
async function hotAlert(cfg, phone, rec, extra) {
  const ph = ten(phone);
  const nx = await guard.kvCommand(cfg, ["SET", `qual:hot:${ph}`, "1", "NX", "EX", String(7 * 86400)]).catch(() => ({}));
  if (!nx || !nx.result) return false;
  const notify = require("./_notify.js");
  const f = rec.facts || {};
  const top = (rec.signals || []).filter((s) => s.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((s) => `• ${s.why}`).join("\n");
  const text = [
    `🔥 *A-grade lead (${rec.score}/100) — ippude call cheyandi*`,
    "",
    `👤 ${f.name || (extra && extra.name) || "—"}`,
    `📱 ${ph}`,
    f.village ? `📍 ${f.village}${rec.km != null ? ` (${rec.km} km)` : ""}` : null,
    f.problem ? `💬 ${f.problem}` : null,
    f.prefers ? `📅 ${f.prefers}` : null,
    "",
    top,
    "",
    "App → Leads → Ippude call",
  ].filter((l) => l !== null).join("\n");
  const targets = String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666").split(",").map(ten).filter((x) => x.length === 10);
  for (const to of targets) await notify.sendWa(to, text).catch(() => {});
  try {
    const push = require("./_push.js");
    if (push.enabled()) await push.notifyCap(cfg, "leads.view", {
      title: `🔥 A-grade — ${f.name || ph}`,
      body: [f.problem, f.village, `${rec.score}/100`].filter(Boolean).join(" · ").slice(0, 160),
      tab: "leads", urgent: true, data: { kind: "hot", phone: ph },
    });
  } catch (e) { console.error("push: hot", e && e.message); }
  return true;
}

// Everything that follows a new score, in one call: the desk if it is a new A,
// Meta if it is the first A or B (so the ads learn to buy patients, not taps).
async function react(cfg, phone, rec, extra) {
  if (!rec) return;
  const ph = ten(phone);
  if (rec.grade === "A" && rec.wasGrade !== "A") {
    await hotAlert(cfg, ph, rec, extra).catch(() => {});
    // checked again in two hours: an A the desk has not booked gets a second push
    await guard.kvCommand(cfg, ["LPUSH", "qual:calls", JSON.stringify({ ph, ts: Date.now(), name: (rec.facts || {}).name || (extra && extra.name) || "" })]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "qual:calls", "0", "199"]).catch(() => {});
  }
  if ((rec.grade === "A" || rec.grade === "B") && rec.wasGrade !== "A" && rec.wasGrade !== "B") {
    const nx = await guard.kvCommand(cfg, ["SET", `qual:capi:${ph}`, "1", "NX", "EX", KEEP]).catch(() => ({}));
    if (nx && nx.result) {
      require("./_capi.js").send("QualifiedLead", { phone: ph, eventId: `qual-${crypto.createHash("sha256").update(ph).digest("hex").slice(0, 16)}`, custom: { grade: rec.grade, score: rec.score, km: rec.km == null ? undefined : rec.km, concern: (rec.facts || {}).problem || undefined } }).catch(() => {});
    }
  }
}

// What goes onto the lead row the desk reads.
const stamp = (rec) => (rec ? { grade: rec.grade, score: rec.score, km: rec.km == null ? undefined : rec.km, village: (rec.facts || {}).village || undefined,
  since: (rec.facts || {}).problem_since || undefined, prefers: (rec.facts || {}).prefers || undefined, intent: (rec.facts || {}).intent || undefined,
  why: (rec.signals || []).filter((s) => s.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((s) => s.why) } : {});

// How hard the follow-ups chase, by grade. D is left alone.
const CADENCE = { A: { nudges: true, call: true }, B: { nudges: true, call: false }, C: { nudges: true, call: false }, D: { nudges: false, call: false } };
async function chase(cfg, phone) {
  const rec = await read(cfg, phone);
  return CADENCE[(rec && rec.grade) || "C"];
}

module.exports = { PLACES, placeOf, placeIn, ringOf, scoreLead, extract, nextAction, forPhones, backfill, read, absorb, react, stamp, chase, contextLine, INTENTS, URGENCY, GRADE_OF };
