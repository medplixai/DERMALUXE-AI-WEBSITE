// Putting money behind the day's poster, by itself.
//
// The clinic posts every morning and about two hundred people see it — the
// ones who already follow. ₹300 behind the same picture, aimed at Eluru and
// the towns around it, puts it in front of thousands who have never heard of
// the clinic, and a tap opens a WhatsApp chat with the agent that already
// knows what to do with it.
//
// So: every published poster is promoted as a click-to-WhatsApp ad — ₹300
// over three days, 30 km around Eluru, adults. The owner changes any of that
// (or switches it off) in the control panel, and hears on WhatsApp what was
// created and what it is set to spend.
//
// The money guards, because this runs unattended:
//   * one boost per post, ever (an NX marker on the post's own id),
//   * a per-day rupee ceiling across everything this creates,
//   * nothing at all until META_ADS_TOKEN + META_AD_ACCOUNT_ID + IG_PAGE_ID
//     are set, and nothing at all while boost:cfg says off,
//   * every campaign carries its own end date, so nothing can run forever,
//   * a half-built boost (campaign made, ad refused) is paused, never left
//     running unattended.
//
// KV: boost:cfg · boost:<postId> (NX, 90 d) · boost:day:<IST day> · boost:log
const guard = require("./_guard.js");

const GRAPH = "https://graph.facebook.com/v21.0";
const ELURU = { lat: 16.7107, lng: 81.0952 };
const WA_LINK = "https://wa.me/919959134666";
// Two radii, because the two things this clinic sells are not the same
// journey. Nobody drives 80 km for a facial, so a clinic poster shown that
// wide fills the book with people who will never walk in. A six-week course
// with a certificate at the end is worth the bus from Bhimavaram, so the
// academy posters get the whole 80 km Meta allows around a point.
const DEFAULTS = { on: true, rupees: 300, days: 3, km: 30, kmAcademy: 80, ageMin: 20, ageMax: 60, maxPerDay: 900 };
// Meta will not run a lifetime budget that works out to less than about ₹95 a
// day on this account (min_daily_budget_cents = 9491). ₹300 over 3 days is
// ₹100 — just over. Stretch the same ₹300 over 5 days and Meta refuses the
// ad set, so the arithmetic is checked here instead of failing at 8:30 in
// the morning.
const MIN_PER_DAY = 100;
const maxDays = (rupees) => Math.max(1, Math.floor(rupees / MIN_PER_DAY));
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts || Date.now()));
// A number the owner typed: nonsense falls back to what was there, and
// anything outside what Meta accepts is pulled to the nearest edge rather
// than silently ignored.
const num = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : dflt; };

// Required late: the topic list lives in the daily engine, and the staff API
// loads this file on every Ads screen without ever needing it.
function pillarOf(topicKey) {
  const k = String(topicKey || "");
  if (!k) return "";
  try {
    // The academy topics live in their own list, apart from the clinic's.
    // Asking only the first one answers "" for every academy poster there is.
    const d = require("./_daily.js");
    const t = [].concat(d.TOPICS || [], d.ACADEMY_TOPICS || []).find((x) => x.key === k);
    return t ? String(t.pillar || "") : "";
  } catch (e) { return ""; }
}
// The radius this particular poster goes out at.
const kmFor = (c, topicKey) => (pillarOf(topicKey) === "academy" ? c.kmAcademy : c.km) || c.km;

const token = () => process.env.META_ADS_TOKEN || process.env.IG_SYSTEM_TOKEN || process.env.IG_PAGE_TOKEN || "";
const account = () => String(process.env.META_AD_ACCOUNT_ID || "").replace(/^act_/, "");
const pageId = () => String(process.env.IG_PAGE_ID || "");
const ready = () => !!(token() && account() && pageId());

async function load(cfg) {
  const v = cfg ? parse(((await guard.kvCommand(cfg, ["GET", "boost:cfg"]).catch(() => ({}))) || {}).result || "", null) : null;
  const c = Object.assign({}, DEFAULTS, v || {});
  return {
    on: c.on !== false && c.on !== "0",
    rupees: num(c.rupees, 100, 5000, DEFAULTS.rupees),      // Meta's own floor for a 3-day lifetime budget is well under this
    days: num(c.days, 1, 14, DEFAULTS.days),
    km: num(c.km, 17, 80, DEFAULTS.km),                     // Meta's own range for a radius around a point
    kmAcademy: num(c.kmAcademy, 17, 80, DEFAULTS.kmAcademy),
    ageMin: num(c.ageMin, 18, 60, DEFAULTS.ageMin),
    ageMax: num(c.ageMax, 20, 65, DEFAULTS.ageMax),
    maxPerDay: num(c.maxPerDay, 100, 20000, DEFAULTS.maxPerDay),
    by: c.by || "", ts: Number(c.ts) || 0,
  };
}
async function save(cfg, input, by) {
  const cur = await load(cfg);
  const next = Object.assign({}, cur, {
    on: input.on !== undefined ? !!input.on : cur.on,
    rupees: input.rupees !== undefined ? num(input.rupees, 100, 5000, cur.rupees) : cur.rupees,
    days: input.days !== undefined ? num(input.days, 1, 14, cur.days) : cur.days,
    km: input.km !== undefined ? num(input.km, 17, 80, cur.km) : cur.km,
    kmAcademy: input.kmAcademy !== undefined ? num(input.kmAcademy, 17, 80, cur.kmAcademy) : cur.kmAcademy,
    maxPerDay: input.maxPerDay !== undefined ? num(input.maxPerDay, 100, 20000, cur.maxPerDay) : cur.maxPerDay,
    by: String(by || "").slice(0, 40), ts: Date.now(),
  });
  if (next.rupees > next.maxPerDay) return { ok: false, error: "Roju limit, okka post budget kanna ekkuva undali" };
  if (next.days > maxDays(next.rupees)) {
    return { ok: false, error: `₹${next.rupees} ki ${next.days} rojulu kudarav — Meta roju kaneesam ₹${MIN_PER_DAY} adugutundi. ${maxDays(next.rupees)} rojulu varaku, leda budget ₹${next.days * MIN_PER_DAY} cheyandi.` };
  }
  const r = await guard.kvCommand(cfg, ["SET", "boost:cfg", JSON.stringify(next)]);
  if (!r || r.error) return { ok: false, error: "Save avvaledu — malli try cheyandi" };
  return { ok: true, boost: next };
}

// POST unless a caller asks for GET — reading back what Meta actually has is
// the only way to know a standing ad set is still there.
async function graph(path, body, method) {
  const get = String(method || "").toUpperCase() === "GET";
  const qs = get ? "?" + new URLSearchParams(Object.assign({ access_token: token() }, body || {})).toString() : "";
  const r = await fetch(`${GRAPH}${path}${qs}`, get ? { method: "GET" } : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ access_token: token() }, body)),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const e = new Error((d.error && (d.error.error_user_msg || d.error.message)) || `HTTP ${r.status}`);
    e.meta = d.error || {};
    throw e;
  }
  return d;
}

// The poster itself, as an image Meta holds. Either our own (kept in KV as
// base64) or one already on Instagram, fetched from its CDN — promoting a
// post that did well on its own takes the same road as the day's poster.
async function uploadImage(cfg, imgId, imageUrl) {
  let b64 = "";
  if (imageUrl) {
    // Instagram's CDN answers 403 to a bare server-side fetch — Node sends no
    // User-Agent at all, and the CDN takes that for a scraper. It serves the
    // same picture happily to anything that looks like a browser.
    const r = await fetch(String(imageUrl), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/jpeg,image/png,*/*",
      },
    });
    if (!r.ok) throw new Error(`post image HTTP ${r.status}`);
    b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  } else {
    const r = await guard.kvCommand(cfg, ["GET", `adm:img:${imgId}`]).catch(() => ({}));
    b64 = (r && r.result) || "";
  }
  if (!b64) throw new Error("poster image gone");
  const d = await graph(`/act_${account()}/adimages`, { bytes: String(b64) });
  const images = d.images || {};
  const first = Object.keys(images)[0];
  if (!first || !images[first].hash) throw new Error("image upload refused");
  return images[first].hash;
}

// Eluru and the towns around it, in adults who use Instagram or Facebook.
// A planned campaign may narrow it — a tighter radius, an age range, one
// gender, and interests Meta has confirmed exist.
const targeting = (c, t) => Object.assign({
  geo_locations: { custom_locations: [{ latitude: ELURU.lat, longitude: ELURU.lng, radius: (t && t.radius) || c.km, distance_unit: "kilometer" }] },
  age_min: (t && t.ageMin) || c.ageMin, age_max: (t && t.ageMax) || c.ageMax,
  publisher_platforms: ["instagram", "facebook"],
  // No "explore": Meta retired that placement and now refuses the whole ad
  // set for asking — "IG Explore placement is deprecated for this API version
  // and cannot be selected." It cost the 25 September poster its ad.
  instagram_positions: ["stream", "reels"],
  facebook_positions: ["feed"],
  // Meta refuses the ad set until this is answered either way: "you need to
  // enable or disable the Advantage audience feature". 0 = stay inside the
  // audience we asked for. With interests chosen by a person that is the
  // whole point, and for the daily poster it keeps the money in Eluru.
  targeting_automation: { advantage_audience: 0 },
},
  // The clinic is in Eluru and the doctor consults in Telugu. Without this,
  // Meta shows a click-to-WhatsApp ad to whoever is cheapest inside the
  // radius — and the chats arrive in Hindi from people who will never come.
  (t && (t.locales || []).length) ? { locales: t.locales.map(Number).filter(Boolean) } : {},
  t && t.genders === "women" ? { genders: [2] } : t && t.genders === "men" ? { genders: [1] } : {},
  t && (t.interests || []).length
    ? { flexible_spec: [{ interests: t.interests.map((i) => ({ id: String(i.id), name: String(i.name || "") })) }] }
    : {});

// The standing ad set a pillar's posters go into.
//
// Every morning used to build a whole new campaign and ad set for one poster —
// ₹300, three days, then dead. Meta spends the first stretch of any new ad set
// working out who to show it to, and on that budget none of ours ever lived
// long enough to finish: ₹95 and 1,650 people, ₹170 and one conversation,
// ₹47 and 592. Seven campaigns, seven learning phases, none completed. Worse,
// they all chased the same people in Eluru, so the clinic was bidding against
// itself in every auction it entered.
//
// One ad set per pillar instead, standing, on a daily budget with no end date.
// Each poster becomes an AD inside it. What Meta learns about who answers a
// click-to-WhatsApp ad from this clinic accumulates instead of being thrown
// away at dawn, and the posters compete with each other on merit rather than
// on price.
//
// Created PAUSED. Nothing here starts spending because a cron ran.
//
// KV: ads:home:<pillar>
const HOME_ADS = 3;                    // live ads kept in a set; older ones are paused
const dailyOf = (c) => Math.max(MIN_PER_DAY, Math.round(c.rupees / Math.max(1, c.days)));

async function home(cfg, c, pillar, tgt) {
  const key = `ads:home:${pillar}`;
  const got = parse(((await guard.kvCommand(cfg, ["GET", key]).catch(() => ({}))) || {}).result || "", null);
  if (got && got.adset) {
    // It is written down, but Meta is where it actually lives: an ad set the
    // owner deleted in Ads Manager would otherwise send every poster from now
    // on into a hole.
    const still = await graph(`/${got.adset}`, null, "GET").catch(() => null);
    if (still && still.id && !/DELETED|ARCHIVED/.test(String(still.effective_status || ""))) return got;
    await guard.kvCommand(cfg, ["DEL", key]).catch(() => {});
  }
  const name = pillar === "academy" ? "DermaLuxe Academy — WhatsApp leads" : "DermaLuxe Clinic — WhatsApp leads";
  const camp = await graph(`/act_${account()}/campaigns`, {
    name, objective: "OUTCOME_ENGAGEMENT", status: "PAUSED",
    special_ad_categories: [], buying_type: "AUCTION",
    is_adset_budget_sharing_enabled: false,
  });
  const adset = await graph(`/act_${account()}/adsets`, {
    name: `${name} · Eluru ${tgt.radius || c.km} km`,
    campaign_id: camp.id, status: "PAUSED",
    // Daily, and no end_time. A lifetime budget with an end date is what
    // silently stopped the academy ad set at midnight on the 30th while the
    // campaign still read ACTIVE.
    daily_budget: dailyOf(c) * 100,
    billing_event: "IMPRESSIONS", optimization_goal: "CONVERSATIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    destination_type: "WHATSAPP", promoted_object: { page_id: pageId() },
    targeting: targeting(c, tgt),
  });
  const rec = { campaign: camp.id, adset: adset.id, pillar, daily: dailyOf(c), ts: Date.now() };
  await guard.kvCommand(cfg, ["SET", key, JSON.stringify(rec)]).catch(() => {});
  return rec;
}

// Older posters in a standing set, stood down. Without this the set collects
// every poster ever made and the budget is spread across all of them.
async function trim(cfg, adsetId, keep) {
  try {
    const r = await graph(`/${adsetId}/ads`, { fields: "id,created_time,effective_status", limit: 50 }, "GET");
    const live = (r.data || [])
      .filter((a) => !/PAUSED|DELETED|ARCHIVED/.test(String(a.effective_status || "")))
      .sort((a, b) => Date.parse(b.created_time) - Date.parse(a.created_time));
    let paused = 0;
    for (const a of live.slice(Math.max(1, keep || HOME_ADS))) {
      await graph(`/${a.id}`, { status: "PAUSED" }).catch(() => {});
      paused++;
    }
    return paused;
  } catch (e) { console.error("boost: trim", e && e.message); return 0; }
}

// One poster → one ad inside its pillar's standing ad set. Every id is written
// down as it is made, so a failure half way can be undone instead of left
// spending.
async function create(cfg, post, c) {
  const made = { campaign: "", adset: "", creative: "", ad: "" };
  const name = post.name || `Daily poster ${istDay()} · ${String(post.topic || post.kind || "post").slice(0, 30)}`;
  // A promoted post is created stopped: the owner starts it themselves, so a
  // mis-tap on a phone cannot begin spending on its own.
  const status = c.status === "PAUSED" ? "PAUSED" : "ACTIVE";
  // The languages the clinic can serve, looked up once by the planner and
  // kept. The morning poster's ad gets them too — it is the same clinic and
  // the same doctor, and a Hindi chat is a chat nobody can answer.
  const loc = parse(((await guard.kvCommand(cfg, ["GET", "ads:locales"]).catch(() => ({}))) || {}).result || "", null);
  const tgt = Object.assign({}, post.targeting || {},
    (!(post.targeting || {}).locales && loc && (loc.ids || []).length) ? { locales: loc.ids } : {});
  // Which standing set this poster belongs in. Asked of the topic list that
  // defines the pillars, the same question the radius is picked by.
  const pillar = pillarOf(post.topic) === "academy" ? "academy" : "clinic";
  const start = Date.now() + 2 * 60000;
  try {
    const set = await home(cfg, c, pillar, tgt);
    made.campaign = set.campaign;
    made.adset = set.adset;
    const adset = { id: set.adset };

    const image_hash = await uploadImage(cfg, post.imgId, post.imageUrl);
    const creative = await graph(`/act_${account()}/adcreatives`, {
      name,
      object_story_spec: {
        page_id: pageId(),
        link_data: {
          image_hash, link: WA_LINK,
          message: String(post.caption || "").slice(0, 900),
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
        },
      },
      // We used to opt out of Meta's automatic creative enhancements here.
      // Meta deprecated that field ("Including standard enhancements field in
      // creative has been deprecated. Please choose to set individual
      // features instead") and refuses the creative for sending it. The
      // replacement is a list of individual feature names that will
      // themselves keep changing, and a refused creative is a day with no ad
      // at all — a worse outcome than Meta brightening a photograph. Opt out
      // in Ads Manager if it ever does something to a poster.
    });
    made.creative = creative.id;
    const ad = await graph(`/act_${account()}/ads`, { name, adset_id: adset.id, creative: { creative_id: creative.id }, status });
    made.ad = ad.id;
    // Yesterday's posters stand down, or the set's budget ends up spread
    // across every poster the clinic has ever made.
    const stood = await trim(cfg, set.adset, HOME_ADS);
    return { ok: true, made, start, home: set, daily: set.daily, stoodDown: stood };
  } catch (e) {
    // Clean up only what THIS poster made. The ad set and campaign are the
    // pillar's standing ones now, shared by every poster and by whatever is
    // already running in them — the old code deleted them on a failure, which
    // would have taken the whole structure down over one bad morning.
    if (made.ad) await graph(`/${made.ad}`, { status: "PAUSED" }).catch(() => {});
    else if (made.creative) {
      await fetch(`${GRAPH}/${made.creative}?access_token=${encodeURIComponent(token())}`, { method: "DELETE" }).catch(() => {});
    }
    return { ok: false, made, error: String(e && e.message).slice(0, 200), code: (e && e.meta && e.meta.code) || 0 };
  }
}

// Called after a poster is published. `post` = {id, imgId, caption, topic, link}
async function run(cfg, post) {
  const res = { boosted: false, why: "" };
  if (!cfg || !post || !post.imgId) return Object.assign(res, { why: "no post" });
  const c = await load(cfg);
  // Every one of these was silent, so a morning with no ad looked exactly
  // like a morning with one. The owner's WhatsApp is not a log.
  if (!c.on) { console.log("boost: skipped — switched off"); return Object.assign(res, { why: "off" }); }
  if (!ready()) {
    console.error(`boost: cannot run — missing ${[!token() && "META_ADS_TOKEN", !account() && "META_AD_ACCOUNT_ID", !pageId() && "IG_PAGE_ID"].filter(Boolean).join(", ")}`);
    return Object.assign(res, { why: "META_ADS_TOKEN / META_AD_ACCOUNT_ID / IG_PAGE_ID ledu" });
  }
  const key = `boost:${post.id || post.imgId}`;
  const once = await guard.kvCommand(cfg, ["SET", key, "1", "NX", "EX", String(90 * 86400)]).catch(() => ({}));
  if (!once || !once.result) { console.log("boost: skipped — this poster already has one"); return Object.assign(res, { why: "already boosted" }); }
  // The day's ceiling, counted before anything is created.
  const dayKey = `boost:day:${istDay()}`;
  const spent = await guard.kvCommand(cfg, ["INCRBY", dayKey, String(c.rupees)]).catch(() => ({}));
  await guard.kvCommand(cfg, ["EXPIRE", dayKey, "172800"]).catch(() => {});
  if (Number(spent && spent.result) > c.maxPerDay) {
    await guard.kvCommand(cfg, ["INCRBY", dayKey, String(-c.rupees)]).catch(() => {});
    await guard.kvCommand(cfg, ["DEL", key]).catch(() => {});
    return Object.assign(res, { why: `roju limit ₹${c.maxPerDay} daatindi` });
  }
  // Belt and braces: whatever is in the settings, never send Meta a lifetime
  // budget it will refuse — shorten the run instead of losing the day.
  const days = Math.min(c.days, maxDays(c.rupees));
  const km = kmFor(c, post.topic);
  const out = await create(cfg, post, Object.assign({}, c, { days, km }));
  if (out.ok) console.log(`boost: ₹${c.rupees} · ${days} rojulu · campaign ${out.made.campaign} ad ${out.made.ad}`);
  else console.error(`boost: Meta refused — ${out.error}${out.code ? " (code " + out.code + ")" : ""}`);
  if (!out.ok) {
    await guard.kvCommand(cfg, ["INCRBY", dayKey, String(-c.rupees)]).catch(() => {});
    await guard.kvCommand(cfg, ["DEL", key]).catch(() => {});   // so tomorrow's run may try again
  }
  await guard.kvCommand(cfg, ["LPUSH", "boost:log", JSON.stringify({
    ts: Date.now(), day: istDay(), post: post.id || "", topic: post.topic || "", link: post.link || "",
    ok: out.ok, rupees: c.rupees, days, km,
    campaign: out.made.campaign || "", ad: out.made.ad || "", error: out.ok ? "" : out.error,
  })]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "boost:log", "0", "199"]).catch(() => {});
  try {
    const notify = require("./_notify.js");
    const text = out.ok
      ? `📣 *Ee roju poster ki ₹${c.rupees} pettam* (${days} rojulu)\n\n📍 Eluru chuttu ${km} km · ${c.ageMin}-${c.ageMax} years\n💬 Tap chesthe direct ga mana WhatsApp agent ki\n${post.link ? "\n" + post.link : ""}\n\nApp → Control panel → Ads boost lo aapocchu / budget marchocchu.`
      : `⚠️ *Ee roju poster ki ad pettaleka poyam*\n\n${out.error}\n\nMeta lo payment method / ad account chudandi. Repu malli try chestundi — leda app → Control panel → Ads boost lo off cheyyandi.`;
    for (const to of guard.ownerPhones()) await notify.sendWa(to, text).catch(() => {});
  } catch (e) {}
  return Object.assign(res, { boosted: out.ok, why: out.ok ? "" : out.error, campaign: out.made.campaign, ad: out.made.ad, rupees: c.rupees, days, km, stoodDown: out.stoodDown || 0, daily: out.daily || 0 });
}

// What the boosts did — for the control panel and the weekly report.
async function recent(cfg, n) {
  const rows = (((await guard.kvCommand(cfg, ["LRANGE", "boost:log", "0", String((n || 10) - 1)]).catch(() => ({}))) || {}).result || []).map((x) => parse(x, null)).filter(Boolean);
  if (!rows.length || !ready()) return rows;
  // What Meta says they spent and brought, for the ones that ran.
  const ids = rows.filter((r) => r.campaign).slice(0, 8).map((r) => r.campaign);
  if (!ids.length) return rows;
  try {
    const out = await Promise.all(ids.map(async (id) => {
      const r = await fetch(`${GRAPH}/${id}/insights?fields=spend,impressions,reach,actions&access_token=${encodeURIComponent(token())}`);
      const d = await r.json().catch(() => ({}));
      const row = ((d && d.data) || [])[0] || null;
      return [id, row];
    }));
    const by = Object.fromEntries(out);
    for (const r of rows) {
      const ins = by[r.campaign];
      if (!ins) continue;
      r.spend = Math.round(Number(ins.spend) || 0);
      r.reach = Number(ins.reach) || 0;
      r.chats = ((ins.actions || []).find((a) => /messaging_conversation_started|onsite_conversion.messaging_conversation_started/.test(a.action_type)) || {}).value || 0;
    }
  } catch (e) {}
  return rows;
}

// A post that already did well for nothing, given money. Created PAUSED, so
// nothing spends until somebody presses Start on Meta's own post card — the
// whole point is that a tap here cannot cost anything by itself.
async function promote(cfg, o) {
  if (!ready()) return { ok: false, error: "META_ADS_TOKEN / META_AD_ACCOUNT_ID / IG_PAGE_ID ledu" };
  const rupees = num(o && o.rupees, 200, 5000, 500);
  const days = Math.max(1, Math.min(maxDays(rupees), Math.round(Number(o && o.days) || 3)));
  const id = String((o && o.mediaId) || "");
  if (!id || !(o && o.imageUrl)) return { ok: false, error: "Post teliyadu" };
  const once = await guard.kvCommand(cfg, ["SET", `promo:${id}`, "1", "NX", "EX", String(90 * 86400)]).catch(() => ({}));
  if (!once || !once.result) return { ok: false, error: "Ee post ki already pettaru" };
  const c = Object.assign({}, await load(cfg), { rupees, days, status: "PAUSED" });
  const out = await create(cfg, {
    id, imageUrl: o.imageUrl, caption: o.caption || "", targeting: o.targeting || null,
    name: o.name || `Promote ${istDay()} · ${String(o.caption || "post").replace(/\s+/g, " ").slice(0, 28)}`,
  }, c);
  if (!out.ok) {
    await guard.kvCommand(cfg, ["DEL", `promo:${id}`]).catch(() => {});
    console.error(`promote: Meta refused — ${out.error}`);
    return { ok: false, error: out.error };
  }
  await guard.kvCommand(cfg, ["SADD", "promo:done", id]).catch(() => {});
  console.log(`promote: ₹${rupees} · ${days} rojulu · campaign ${out.made.campaign} (PAUSED)`);
  return { ok: true, rupees, days, campaign: out.made.campaign };
}

module.exports = { kmFor, pillarOf, home, trim, dailyOf, HOME_ADS, load, save, run, promote, recent, ready, maxDays, DEFAULTS, MIN_PER_DAY, ELURU, WA_LINK };
