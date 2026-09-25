// /api/ads — what the Meta advertising is actually doing, and what to do
// about it.
//
// The clinic spends real money on Instagram and Facebook every day and has
// had no way to see whether any of it works. Ads Manager shows spend, reach
// and "results"; what it cannot show is the only number that matters here —
// how many of those became a patient who walked through the door, and what
// each one cost.
//
// So this joins the two sides. Meta supplies the money and the reach; the
// clinic's own leads, bookings and bills supply the outcome. Both counts are
// labelled for what they are, because they are not the same thing and
// pretending otherwise would be worse than showing neither.
//
// Changing anything — a budget, pausing a campaign — is the owner's alone.
// This is the only screen in the app where a tap spends money.
const guard = require("./_guard.js");
const staff = require("./staff.js");

const GRAPH = "https://graph.facebook.com/v21.0";
const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const rupees = (v) => Math.round(Number(v) || 0);
// Account-level money comes from Meta in paise, unlike insights "spend".
const paise = (v) => Math.round((Number(v) || 0) / 100);

// Ads need their own permission (ads_read / ads_management). The page and
// WhatsApp tokens the clinic already has do not carry it, so a dedicated one
// is looked for first and the others are only tried in case the owner reused
// a system user token that happens to have the scope.
function tokens() {
  const e = process.env;
  return [
    ["META_ADS_TOKEN", e.META_ADS_TOKEN],
    ["IG_SYSTEM_TOKEN", e.IG_SYSTEM_TOKEN],
    ["IG_PAGE_TOKEN", e.IG_PAGE_TOKEN],
  ].filter((x) => x[1]);
}

async function graph(path, tok, params) {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v));
  u.searchParams.set("access_token", tok);
  const r = await fetch(u.toString());
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.code = j && j.error && j.error.code;
    err.status = r.status;
    throw err;
  }
  return j;
}

// Which token can actually read ads, and which account. Cached briefly so the
// screen does not re-probe on every refresh.
async function connect(cfg) {
  const cached = parse((await guard.kvCommand(cfg, ["GET", "ads:conn"]).catch(() => ({}))).result || "", null);
  if (cached && cached.at > Date.now() - 600000) return cached;

  const list = tokens();
  if (!list.length) return { ok: false, why: "no-token", tried: [] };

  const tried = [];
  for (const [name, tok] of list) {
    try {
      const me = await graph("/me/adaccounts", tok, { fields: "account_id,name,account_status,currency", limit: 25 });
      const accounts = (me.data || []).map((a) => ({
        id: a.account_id, name: a.name, currency: a.currency,
        active: Number(a.account_status) === 1,
      }));
      if (!accounts.length) { tried.push({ name, why: "no ad accounts on this token" }); continue; }
      const want = clean(process.env.META_AD_ACCOUNT_ID, 32).replace(/^act_/, "");
      const acct = (want && accounts.find((a) => a.id === want)) || accounts[0];
      const out = { ok: true, tokenName: name, accountId: acct.id, accountName: acct.name,
        currency: acct.currency || "INR", accounts, at: Date.now() };
      await guard.kvCommand(cfg, ["SET", "ads:conn", JSON.stringify(out), "EX", "900"]).catch(() => {});
      return out;
    } catch (e) {
      tried.push({ name, why: String(e.message || e).slice(0, 120) });
    }
  }
  return { ok: false, why: "no-permission", tried };
}

const tokenOf = (name) => process.env[name];

// ---- the clinic's own side of the story ------------------------------------
// Leads that came from the channels the ads feed, what happened to them, and
// what they paid. Nothing estimated: these are the same leads and bills the
// rest of the dashboard shows.
const PAID_SRC = ["instagram", "facebook", "messenger", "ig", "fb"];
const srcOf = (l) => String(l.src || l.type || "").toLowerCase();
const isPaid = (l) => !!l.ad_id || PAID_SRC.some((s) => srcOf(l).includes(s));

async function ourSide(cfg, sinceMs) {
  const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "1999"]).catch(() => ({}));
  const leads = (r.result || []).map((x) => parse(x, null)).filter(Boolean)
    .filter((l) => Number(l.ts) >= sinceMs);
  const st = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({}))).result);
  const keyOf = (l) => `${l.ts}|${digits10(l.phone) || l.src_id || ""}`;

  const paid = leads.filter(isPaid);
  const phones = new Set(paid.map((l) => digits10(l.phone)).filter(Boolean));
  const booked = paid.filter((l) => ["booked", "visited"].includes(st[keyOf(l)] || "")).length;
  const came = paid.filter((l) => (st[keyOf(l)] || "") === "visited").length;

  // What those people actually paid, from the bills already in the system.
  let revenue = 0;
  if (phones.size) {
    const ids = await guard.kvPipeline(cfg, [...phones].map((p) => ["LRANGE", `bill:of:${p}`, "0", "19"])).catch(() => []);
    const all = [];
    for (const l of ids) for (const id of (Array.isArray(l) ? l : [])) all.push(id);
    if (all.length) {
      const bills = await guard.kvPipeline(cfg, all.map((id) => ["GET", `bill:${id}`])).catch(() => []);
      for (const raw of bills) {
        const bill = parse(raw, null);
        if (!bill) continue;
        for (const p of (bill.payments || [])) if (Number(p.ts) >= sinceMs) revenue += rupees(p.amount);
      }
    }
  }
  // Per ad: leads that Meta told us came from a specific ad (WhatsApp and
  // Messenger click-to-chat ads carry the ad id), and what those people did.
  const byAd = {};
  const payOf = {};
  for (const l of leads.filter((x) => x.ad_id)) {
    const ad = String(l.ad_id);
    const row = byAd[ad] || (byAd[ad] = { leads: 0, booked: 0, came: 0, revenue: 0, phones: [] });
    row.leads++;
    const s = st[keyOf(l)] || "";
    if (["booked", "visited"].includes(s)) row.booked++;
    if (s === "visited") row.came++;
    const ph = digits10(l.phone);
    if (ph && !row.phones.includes(ph)) row.phones.push(ph);
  }
  const adPhones = [...new Set(Object.values(byAd).flatMap((r) => r.phones))];
  if (adPhones.length) {
    const ids = await guard.kvPipeline(cfg, adPhones.map((p) => ["LRANGE", `bill:of:${p}`, "0", "19"])).catch(() => []);
    for (let i = 0; i < adPhones.length; i++) {
      const list = Array.isArray(ids[i]) ? ids[i] : [];
      if (!list.length) continue;
      const bills = await guard.kvPipeline(cfg, list.map((id) => ["GET", `bill:${id}`])).catch(() => []);
      let sum = 0;
      for (const raw of bills) { const bill = parse(raw, null); if (bill) for (const p of (bill.payments || [])) if (Number(p.ts) >= sinceMs) sum += rupees(p.amount); }
      payOf[adPhones[i]] = sum;
    }
    for (const r of Object.values(byAd)) r.revenue = r.phones.reduce((n, p) => n + (payOf[p] || 0), 0);
  }
  for (const r of Object.values(byAd)) delete r.phones;
  return { leads: paid.length, booked, came, revenue, people: phones.size, fromAds: leads.filter((x) => x.ad_id).length, byAd };
}

// ---- what to say about one campaign ----------------------------------------
// A number nobody can act on is decoration. Each campaign gets a sentence in
// the same words the desk would use.
function verdict(spend, results, costEach, target) {
  if (!spend) return { tone: "quiet", text: "Inka kharchu kaledu" };
  if (!results) return { tone: "bad", text: `₹${spend.toLocaleString("en-IN")} ayindi, okka సంభాషణ kuda raaledu — aapeyyadam manchidi` };
  if (costEach <= target * 0.5) return { tone: "good", text: `Chala baagundi — okko సంభాషణ ₹${costEach}. Budget penchavachu` };
  if (costEach <= target) return { tone: "good", text: `Baagundi — okko సంభాషణ ₹${costEach}` };
  if (costEach <= target * 2) return { tone: "warn", text: `Konchem ekkuva — okko సంభాషణ ₹${costEach} (lakshyam ₹${target})` };
  return { tone: "bad", text: `Chala kharidu — okko సంభాషణ ₹${costEach}. Aapeyyadam manchidi` };
}

// ---- what to do about it, in a sentence and one tap -----------------------
// A dashboard that only reports leaves the owner to work out the arithmetic
// between eight campaigns at nine in the morning, so nobody ever does. Each
// suggestion below carries the number it was worked out from and the money it
// is worth, and applies itself — there is nothing to go and find afterwards.
//
// Rules, in the order they matter:
//   * money going nowhere — spending with nothing to show
//   * money going somewhere expensive, when a cheaper campaign exists
//   * the cheap one, starved
// Nothing is suggested off a handful of rupees: under FLOOR the numbers are
// noise, and a suggestion built on noise teaches people to ignore the box.
const FLOOR = 200;                       // rupees spent before a verdict is worth making
const perMonth = (spend, days) => Math.round((spend / Math.max(1, days)) * 30);

function suggestions(account, campaigns, target, days, dismissed) {
  const out = [];
  const live = (campaigns || []).filter((c) => c.running);
  const scored = live.filter((c) => c.spend >= FLOOR);
  // The best campaign is the yardstick: "expensive" only means anything next
  // to something cheaper that the clinic is already running.
  const best = scored.filter((c) => c.results > 0).sort((a, b) => a.costEach - b.costEach)[0] || null;

  for (const c of scored) {
    if (!c.results) {
      out.push({
        id: `stop:${c.id}`, kind: "stop", campaign: c.name, campaignId: c.id,
        title: `Aapandi: ${c.name}`,
        why: `₹${c.spend.toLocaleString("en-IN")} kharchu ayindi, okka సంభాషణ kuda raaledu (${days} rojullo).`,
        gain: `Nelaki sumaru ₹${perMonth(c.spend, days).toLocaleString("en-IN")} migulutundi`,
        action: { a: "pause", id: c.id },
      });
      continue;
    }
    if (best && c.id !== best.id && c.costEach >= best.costEach * 3 && c.costEach > target) {
      const times = Math.round((c.costEach / best.costEach) * 10) / 10;
      out.push({
        id: `stop:${c.id}`, kind: "stop", campaign: c.name, campaignId: c.id,
        title: `Aapandi: ${c.name}`,
        why: `Okka సంభాషణ ki ₹${c.costEach.toLocaleString("en-IN")} — "${best.name}" adhe pani ₹${best.costEach.toLocaleString("en-IN")} ki chestundi (${times} rettu takkuva). ${days} rojullo ikkada ₹${c.spend.toLocaleString("en-IN")} kharchu ayindi.`,
        gain: `Nelaki sumaru ₹${perMonth(c.spend, days).toLocaleString("en-IN")} migulutundi`,
        action: { a: "pause", id: c.id },
      });
      continue;
    }
    // Cheap and still running on a small daily budget: the one place where
    // spending MORE is the right answer.
    if (c.daily && c.costEach <= target * 0.5) {
      const next = Math.min(Math.max(100, Math.round((c.daily * 1.5) / 50) * 50), Math.max(100, Math.min(50000, Number(process.env.ADS_MAX_DAILY) || 5000)));
      if (next > c.daily) {
        out.push({
          id: `raise:${c.id}`, kind: "raise", campaign: c.name, campaignId: c.id,
          title: `Budget penchandi: ${c.name} → ₹${next.toLocaleString("en-IN")}/roju`,
          why: `Idi okka సంభాషణ ₹${c.costEach.toLocaleString("en-IN")} ki testundi — lakshyam ₹${target.toLocaleString("en-IN")}. Ippudu roju ₹${c.daily.toLocaleString("en-IN")} matrame.`,
          gain: `Roju ~${Math.max(1, Math.round((next - c.daily) / Math.max(1, c.costEach)))} సంభాషణలు ekkuva ravochu`,
          action: { a: "budget", id: c.id, daily: next },
        });
      }
    }
  }

  // The account itself, when Meta is about to stop it for us.
  if (account && account.capLeft != null && account.capLeft > 0 && account.spend > 0) {
    const perDay = account.spend / Math.max(1, days);
    const left = Math.floor(account.capLeft / Math.max(1, perDay));
    if (left <= 7) {
      out.push({
        id: "cap:account", kind: "cap",
        title: "Spending limit ayipotondi",
        why: `Limit lo ₹${account.capLeft.toLocaleString("en-IN")} migilindi — ee vegam ki inka ${left} roju${left === 1 ? "" : "lu"}. Taruvata ads taanantata aagipotayi.`,
        gain: "Ads Manager lo limit penchandi",
        action: null,
      });
    }
  }
  return out.filter((x) => !(dismissed || []).includes(x.id));
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("reports.view")) return json(res, 403, { error: "Mee role ki idi chuse permission ledu" });
  const canChange = allow("settings.manage");

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "overview");
  const days = Math.max(1, Math.min(90, Number(q.days || b.days) || 30));
  const target = Math.max(10, Math.min(5000, Number(process.env.ADS_TARGET_COST) || 300));

  const conn = await connect(cfg);

  // Everything on one screen, so the answer does not need three taps.
  if (a === "overview") {
    const rl = await guard.rateLimit(cfg, `rl:ads:${me.phone}`, 120, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

    const since = Date.now() - days * 86400000;
    const ours = await ourSide(cfg, since);
    // Which of the two openers people actually answer. It needs no ad account
    // — the agent's own numbers — so it shows even before Meta is connected.
    const opener = await require("./_abtest.js").stats(cfg).catch(() => null);

    if (!conn.ok) {
      return json(res, 200, {
        ok: true, connected: false, why: conn.why, tried: conn.tried || [],
        days, ours, opener, canChange, target,
        // Said in the order it has to be done.
        needs: conn.why === "no-token"
          ? ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID"]
          : ["META_ADS_TOKEN (ads_read permission tho)"],
      });
    }

    const tok = tokenOf(conn.tokenName);
    const act = `/act_${conn.accountId}`;
    const since_s = new Date(since).toISOString().slice(0, 10);
    const until_s = new Date().toISOString().slice(0, 10);

    let account = null, campaigns = [], today = null, err = "";
    try {
      const [acc, ins, todayIns, camps, adsList] = await Promise.all([
        graph(act, tok, { fields: "name,currency,amount_spent,spend_cap,account_status" }),
        graph(act + "/insights", tok, { fields: "spend,impressions,reach,actions", time_range: JSON.stringify({ since: since_s, until: until_s }) }),
        graph(act + "/insights", tok, { fields: "spend,impressions", date_preset: "today" }),
        graph(act + "/campaigns", tok, {
          fields: "name,status,effective_status,daily_budget,lifetime_budget,objective," +
                  `insights.time_range(${JSON.stringify({ since: since_s, until: until_s })}){spend,impressions,reach,actions}`,
          limit: 50,
        }),
        Object.keys(ours.byAd || {}).length ? graph(act + "/ads", tok, { fields: "id,campaign_id", limit: 500 }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      const adToCamp = {};
      for (const x of (adsList.data || [])) adToCamp[String(x.id)] = String(x.campaign_id);

      const conv = (actions) => {
        const rows = actions || [];
        const hit = rows.find((x) => /messaging_conversation_started|onsite_conversion.messaging_conversation_started/.test(x.action_type));
        return hit ? Number(hit.value) || 0 : 0;
      };

      const i0 = (ins.data || [])[0] || {};
      const spend = rupees(i0.spend);
      const results = conv(i0.actions);
      account = {
        name: acc.name, currency: acc.currency || conn.currency,
        active: Number(acc.account_status) === 1,
        spend, impressions: Number(i0.impressions || 0), reach: Number(i0.reach || 0),
        results, costEach: results ? Math.round(spend / results) : 0,
        // Meta sends both of these in paise, and sends spend_cap as the STRING
        // "0" when the account has no cap at all — which is truthy, so the
        // obvious version of this line printed "₹0 left" on an account that
        // has no limit whatsoever: the exact opposite of the truth.
        capLeft: paise(acc.spend_cap) ? Math.max(0, paise(acc.spend_cap) - paise(acc.amount_spent)) : null,
      };
      const t0 = (todayIns.data || [])[0] || {};
      today = { spend: rupees(t0.spend), impressions: Number(t0.impressions || 0) };

      campaigns = (camps.data || []).map((c) => {
        const ci = ((c.insights || {}).data || [])[0] || {};
        const s = rupees(ci.spend), r = conv(ci.actions);
        const each = r ? Math.round(s / r) : 0;
        // what the people this campaign's ads brought actually did
        const pts = { leads: 0, booked: 0, came: 0, revenue: 0 };
        for (const [ad, r] of Object.entries(ours.byAd || {})) {
          if (adToCamp[ad] !== String(c.id)) continue;
          pts.leads += r.leads; pts.booked += r.booked; pts.came += r.came; pts.revenue += r.revenue;
        }
        pts.costPerPatient = pts.came ? Math.round(s / pts.came) : 0;
        pts.back = s ? Math.round((pts.revenue / s) * 100) : 0;
        return {
          id: c.id, name: c.name, objective: c.objective, patients: pts,
          status: c.effective_status || c.status,
          running: (c.effective_status || c.status) === "ACTIVE",
          daily: c.daily_budget ? Math.round(Number(c.daily_budget) / 100) : 0,
          lifetime: c.lifetime_budget ? Math.round(Number(c.lifetime_budget) / 100) : 0,
          spend: s, impressions: Number(ci.impressions || 0), reach: Number(ci.reach || 0),
          results: r, costEach: each,
          verdict: verdict(s, r, each, target),
        };
      }).sort((x, y) => y.spend - x.spend);
    } catch (e) {
      err = String(e.message || e).slice(0, 200);
    }

    // What the owner has already said no to, so it does not come back tomorrow.
    const dm = await guard.kvCommand(cfg, ["SMEMBERS", "ads:no"]).catch(() => ({}));
    const dismissed = Array.isArray(dm.result) ? dm.result : [];
    const suggest = suggestions(account, campaigns, target, days, dismissed);

    return json(res, 200, {
      ok: true, connected: true, days, target, canChange,
      tokenName: conn.tokenName, accountId: conn.accountId,
      adsManager: `https://www.facebook.com/adsmanager/manage/campaigns?act=${conn.accountId}`,
      account, today, campaigns, suggest, error: err || undefined,
      ours, opener,
      // The join, stated carefully: Meta counts conversations it started,
      // we count people who became patients. Different things, both real.
      joined: account ? {
        spend: account.spend,
        costPerLead: ours.leads ? Math.round(account.spend / ours.leads) : 0,
        costPerBooked: ours.booked ? Math.round(account.spend / ours.booked) : 0,
        costPerCame: ours.came ? Math.round(account.spend / ours.came) : 0,
        revenue: ours.revenue,
        back: account.spend ? Math.round((ours.revenue / account.spend) * 100) : 0,
      } : null,
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });

  // "Vaddu" on a suggestion. Not a money action, so anybody who can see the
  // screen may do it; it expires, because a campaign that was fine last week
  // is worth asking about again.
  if (a === "dismiss") {
    const sid = clean(b.id, 60);
    if (!sid) return json(res, 400, { error: "Suggestion id kavali" });
    await guard.kvCommand(cfg, ["SADD", "ads:no", sid]).catch(() => {});
    await guard.kvCommand(cfg, ["EXPIRE", "ads:no", "604800"]).catch(() => {});
    return json(res, 200, { ok: true, dismissed: sid });
  }

  if (!canChange) return json(res, 403, { error: "Ads marchagaligedi owner matrame" });
  if (!conn.ok) return json(res, 400, { error: "Ads inka connect cheyyaledu" });
  const rlw = await guard.rateLimit(cfg, `rl:adsw:${me.phone}`, 60, 3600);
  if (!rlw.allowed) return json(res, 429, { error: "Konchem aagandi" });

  // Forget what was cached about the account and read Meta again. No campaign
  // id, so it answers before the id check below.
  if (a === "sync") {
    await guard.kvCommand(cfg, ["DEL", "ads:conn"]).catch(() => {});
    return json(res, 200, { ok: true });
  }

  const tok = tokenOf(conn.tokenName);
  const id = clean(b.id, 40);
  if (!/^\d+$/.test(id)) return json(res, 400, { error: "Campaign id kavali" });

  // Money. A budget is a daily number in rupees, bounded so a slipped finger
  // cannot turn ₹500 into ₹50,000, and every change is written into the audit.
  if (a === "budget") {
    const daily = Math.round(Number(b.daily) || 0);
    const cap = Math.max(100, Math.min(50000, Number(process.env.ADS_MAX_DAILY) || 5000));
    if (!(daily >= 100)) return json(res, 400, { error: "Roju budget kaneesam ₹100" });
    if (daily > cap) return json(res, 400, { error: `Roju budget ₹${cap.toLocaleString("en-IN")} kanna ekkuva ikkada pettalemu — Ads Manager lo pettandi` });
    try {
      await graph(`/${id}`, tok, {});           // exists?
      const u = new URL(`${GRAPH}/${id}`);
      const r = await fetch(u.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_budget: daily * 100, access_token: tok }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, 502, { error: ((j.error || {}).message || "Meta oppukoledu").slice(0, 160) });
    } catch (e) {
      return json(res, 502, { error: String(e.message || e).slice(0, 160) });
    }
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
      ts: Date.now(), by: me.name, phone: me.phone,
      what: `Ads: campaign ${id} roju budget ₹${daily} ki marchharu`,
    })]).catch(() => {});
    await guard.kvCommand(cfg, ["DEL", "ads:conn"]).catch(() => {});
    return json(res, 200, { ok: true, daily });
  }

  if (a === "pause" || a === "resume") {
    const status = a === "pause" ? "PAUSED" : "ACTIVE";
    try {
      const r = await fetch(`${GRAPH}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, access_token: tok }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, 502, { error: ((j.error || {}).message || "Meta oppukoledu").slice(0, 160) });
    } catch (e) {
      return json(res, 502, { error: String(e.message || e).slice(0, 160) });
    }
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
      ts: Date.now(), by: me.name, phone: me.phone,
      what: `Ads: campaign ${id} ${a === "pause" ? "aapaaru" : "malli modalu pettaru"}`,
    })]).catch(() => {});
    return json(res, 200, { ok: true, status });
  }

  return json(res, 400, { error: "Unknown action" });
};
// What Meta charged over the last N days, or null when nothing is connected.
// One insights call; the scoreboard shows "cost per visit" only when it has this.
async function spend(cfg, days) {
  try {
    const conn = await connect(cfg);
    if (!conn.ok) return null;
    const until = new Date(Date.now() - 86400000), since = new Date(until.getTime() - ((Number(days) || 7) - 1) * 86400000);
    const d = (x) => x.toISOString().slice(0, 10);
    const r = await graph(`/act_${conn.accountId}/insights`, tokenOf(conn.tokenName), { fields: "spend", time_range: JSON.stringify({ since: d(since), until: d(until) }) });
    const row = ((r && r.data) || [])[0];
    return row ? Math.round(Number(row.spend) || 0) : 0;
  } catch (e) { return null; }
}
module.exports.spend = spend;
module.exports.suggestions = suggestions;
module.exports.verdict = verdict;
module.exports.ourSide = ourSide;
