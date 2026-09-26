// Planning an ad campaign out of what the clinic already knows, and building
// it on Meta.
//
// Ads Manager asks a clinic owner to pick an objective, a radius, an age
// range, a list of interests and a budget, in a language none of that is in.
// The answers are already in this database: which concerns people write in
// about, which towns they write from, what a conversation has cost so far,
// and what the clinic actually treats. So the plan is drafted from those,
// written out in words, and the owner changes what they disagree with.
//
// Two rules hold the whole thing up:
//
//   * A plan is NOT a campaign. Nothing reaches Meta until somebody presses
//     the button, and what is created is PAUSED — so even that press cannot
//     spend. Starting it is a separate, deliberate act on Meta's own screen.
//   * Interests are looked up, never invented. The model proposes them by
//     name, Meta is asked whether each one exists, and anything Meta does not
//     recognise is dropped and said so. A made-up interest id is the kind of
//     thing that silently targets nobody.
//
// KV: adplan:last (the draft, so a reload does not lose it)
const guard = require("./_guard.js");

const ELURU = { lat: 16.7107, lng: 81.0952 };
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

// ---- what Meta knows about a word -----------------------------------------
// Interests and towns are Meta's own vocabulary. Ours is a guess until Meta
// has confirmed it, so every one is looked up before it is used.
async function search(cfg, type, q) {
  const ads = require("./ads.js");
  const conn = await ads.connect(cfg).catch(() => ({ ok: false }));
  if (!conn.ok) return [];
  try {
    const d = await ads.graph("/search", ads.tokenOf(conn.tokenName), {
      type, q: clean(q, 60), limit: 12,
      ...(type === "adgeolocation" ? { location_types: JSON.stringify(["city"]) } : {}),
    });
    return (d.data || []).map((x) => (type === "adinterest"
      ? { id: String(x.id), name: x.name, audience: Number(x.audience_size_upper_bound || x.audience_size || 0), path: (x.path || []).join(" › ") }
      : { key: String(x.key), name: x.name, region: x.region || "", country: x.country_code || "IN", type: x.type || "city" }));
  } catch (e) {
    console.error(`adplan: search ${type}`, e && e.message);
    return [];
  }
}

// ---- what the clinic already knows ----------------------------------------
// Concerns people actually write in about, and the towns they write from.
// This is the part Ads Manager cannot ever have.
async function clinicFacts(cfg) {
  const out = { leads: 0, concerns: [], towns: [], costEach: 0 };
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "599"]).catch(() => ({}));
    const cut = Date.now() - 60 * 86400000;
    const concern = {}, town = {};
    for (const raw of (r.result || [])) {
      const l = parse(raw, null);
      if (!l || l.type === "job" || Number(l.ts) < cut) continue;
      out.leads++;
      const c = clean(l.concern || l.problem, 30).toLowerCase();
      if (c) concern[c] = (concern[c] || 0) + 1;
      const v = clean(l.village || l.town, 30);
      if (v) town[v] = (town[v] || 0) + 1;
    }
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, n: v }));
    out.concerns = top(concern, 8);
    out.towns = top(town, 8);
  } catch (e) {}
  try {
    const acc = await require("./ads.js").spend(cfg, 30);
    if (acc != null) out.spend30 = acc;
  } catch (e) {}
  return out;
}

const SYS = `You plan Meta (Instagram + Facebook) ad campaigns for DermaLuxe by Medicare, a premium skin & hair clinic in Eluru, Andhra Pradesh, India. Patients message the clinic on WhatsApp; every campaign is a click-to-WhatsApp ad, so the only result that counts is a conversation started by somebody near enough to come in.

What you know about this clinic: MD dermatologists, USFDA lasers (PICO, diode, MNRF, HIFU), hydrafacial, PRP/GFC hair therapy, hair transplant, acne and pigmentation treatment, and a training academy. Eluru is a district town; the useful audience is Eluru and the towns within about 40 km. Telugu is the language; ad copy is written in Tenglish (Telugu words in English letters) the way local people actually write.

Rules you must not break:
- NEVER put a price, a discount, a guarantee, or a before/after claim in ad copy. The academy's published fees are the only numbers allowed, and only for academy campaigns.
- Interests must be real Meta interest names — common, broad ones a targeting tool would recognise ("Skin care", "Beauty", "Hair care"). Do not invent niche ones.
- The radius is in kilometres from Eluru, between 10 and 80.
- Budget is a LIFETIME budget in rupees over N days, and Meta refuses anything under ₹100 a day, so rupees / days must be at least 100.

Output ONLY a JSON object, no prose around it:
{"name":"short campaign name","why":"2 sentences: what this is aimed at and why, from the clinic's own numbers","concern":"the one concern this targets","radius_km":30,"age_min":22,"age_max":55,"genders":"all|women|men","interests":["Skin care","Beauty"],"rupees":1500,"days":5,"headline":"max 40 chars","body":"3-5 short Tenglish lines, one idea a line, ends asking them to message","cta":"WHATSAPP_MESSAGE"}`;

// ---- the draft -------------------------------------------------------------
async function plan(cfg, opts) {
  const o = opts || {};
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY ledu" };
  const facts = await clinicFacts(cfg);
  const ask = `Clinic's own numbers, last 60 days:
- ${facts.leads} enquiries
- concerns people wrote in about: ${facts.concerns.map((c) => `${c.name} (${c.n})`).join(", ") || "none recorded yet"}
- towns they wrote from: ${facts.towns.map((t) => `${t.name} (${t.n})`).join(", ") || "not recorded"}
${facts.spend30 != null ? `- spent on ads in the last 30 days: ₹${facts.spend30}` : ""}
${o.ask ? `\nThe owner asks for: ${clean(o.ask, 200)}` : ""}
${o.rupees ? `\nBudget the owner wants: ₹${num(o.rupees, 200, 50000, 1500)}` : ""}

Plan ONE campaign to run next.`;

  let j = null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "claude-opus-5", max_tokens: 900, system: SYS,
        messages: [{ role: "user", content: ask }, { role: "assistant", content: "{" }],
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${String((d.error && d.error.message) || "").slice(0, 100)}`);
    const text = "{" + (((d.content || []).find((c) => c.type === "text") || {}).text || "");
    j = require("./_review.js").extractJson(text);
  } catch (e) {
    console.error("adplan:", e && e.message);
    return { ok: false, error: `Plan ready avvaledu — ${String(e.message || e).slice(0, 80)}` };
  }
  if (!j || !j.name) return { ok: false, error: "Plan chadavaleka poyam — malli try cheyandi" };

  // Interests are checked against Meta, one by one. What Meta does not know
  // is dropped, and the owner is told which — a made-up id targets nobody.
  const wanted = (Array.isArray(j.interests) ? j.interests : []).slice(0, 6).map((x) => clean(x, 40)).filter(Boolean);
  const interests = [], missed = [];
  for (const w of wanted) {
    const hits = await search(cfg, "adinterest", w);
    const hit = hits.find((h) => h.name.toLowerCase() === w.toLowerCase()) || hits[0];
    if (hit && !interests.some((i) => i.id === hit.id)) interests.push(hit); else if (!hit) missed.push(w);
  }

  const rupees = num(o.rupees || j.rupees, 200, 50000, 1500);
  const days = Math.max(1, Math.min(30, Math.min(num(j.days, 1, 30, 5), Math.floor(rupees / 100))));
  const draft = {
    name: clean(j.name, 60), why: clean(j.why, 300), concern: clean(j.concern, 40),
    radius: num(j.radius_km, 10, 80, 30),
    ageMin: num(j.age_min, 18, 60, 22), ageMax: num(j.age_max, 20, 65, 55),
    genders: ["all", "women", "men"].includes(j.genders) ? j.genders : "all",
    interests, missed,
    places: [{ key: "eluru", name: `Eluru + ${num(j.radius_km, 10, 80, 30)} km`, lat: ELURU.lat, lng: ELURU.lng, radius: num(j.radius_km, 10, 80, 30) }],
    rupees, days, perDay: Math.round(rupees / days),
    headline: clean(j.headline, 60), body: clean(j.body, 600).replace(/\\n/g, "\n"),
    at: Date.now(),
  };
  await guard.kvCommand(cfg, ["SET", "adplan:last", JSON.stringify(draft), "EX", "86400"]).catch(() => {});
  return { ok: true, plan: draft, facts };
}

// ---- building it on Meta ---------------------------------------------------
// PAUSED, always. The plan is a plan until a person looks at it on Meta's own
// screen and presses Start; nothing here can begin spending.
async function create(cfg, p, by) {
  const boost = require("./_boost.js");
  if (!boost.ready()) return { ok: false, error: "META_ADS_TOKEN / META_AD_ACCOUNT_ID / IG_PAGE_ID ledu" };
  const rupees = num(p.rupees, 200, 50000, 1500);
  const days = Math.max(1, Math.min(30, Math.min(num(p.days, 1, 30, 5), Math.floor(rupees / 100))));
  if (!clean(p.image, 500)) return { ok: false, error: "Poster kavali" };
  const out = await boost.promote(cfg, {
    mediaId: `plan-${Date.now()}`, imageUrl: clean(p.image, 500),
    caption: clean(p.body, 600), rupees, days,
    name: clean(p.name, 60),
    targeting: {
      radius: num(p.radius, 10, 80, 30), ageMin: num(p.ageMin, 18, 60, 22), ageMax: num(p.ageMax, 20, 65, 55),
      genders: p.genders, interests: (p.interests || []).map((i) => ({ id: String(i.id), name: clean(i.name, 40) })).slice(0, 10),
    },
  });
  if (!out.ok) return out;
  await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
    ts: Date.now(), by: clean(by, 40),
    what: `Ads: AI plan "${clean(p.name, 40)}" — ₹${rupees} × ${days} rojulu, PAUSED ga create chesaru`,
  })]).catch(() => {});
  return out;
}

module.exports = { plan, create, search, clinicFacts, ELURU };
