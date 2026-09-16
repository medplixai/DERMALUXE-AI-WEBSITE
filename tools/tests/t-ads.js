// The only screen in the app where a tap spends money.
process.env.META_ADS_TOKEN = "test-token";
process.env.META_AD_ACCOUNT_ID = "2110247062961086";
process.env.ADS_MAX_DAILY = "5000";
const h = require("./harness.js");
const path = require("path");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

// Meta is stubbed. A test must never touch a live ad account.
const calls = [];
global.fetch = async (url, opt) => {
  const full = String(url);
  const u = full.split("?")[0];          // match the path, not the query
  calls.push({ u: full, method: (opt && opt.method) || "GET", body: opt && opt.body ? JSON.parse(opt.body) : null });
  const ok = (j) => ({ ok: true, json: async () => j });
  if (u.includes("/me/adaccounts")) return ok({ data: [{ account_id: "2110247062961086", name: "DermaLuxe", account_status: 1, currency: "INR" }] });
  if (/\/act_\d+\/insights/.test(u) && full.includes("date_preset=today")) return ok({ data: [{ spend: "2962", impressions: "102786" }] });
  if (/\/act_\d+\/insights/.test(u)) return ok({ data: [{ spend: "120860", impressions: "2000000", reach: "500000",
    actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "1863" }] }] });
  if (/\/act_\d+\/campaigns/.test(u)) return ok({ data: [
    { id: "111", name: "Laser — Eluru", status: "ACTIVE", effective_status: "ACTIVE", objective: "MESSAGES", daily_budget: "200000",
      insights: { data: [{ spend: "18919", reach: "246595", actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "960" }] }] } },
    { id: "222", name: "Hair transplant", status: "PAUSED", effective_status: "PAUSED", objective: "MESSAGES", daily_budget: "80000",
      insights: { data: [{ spend: "7390", reach: "150079", actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "48" }] }] } },
  ] });
  if (/\/act_\d+$/.test(u)) return ok({ name: "DermaLuxe", currency: "INR", account_status: 1, amount_spent: "120860", spend_cap: "130000" });
  if (/\/\d+$/.test(u) && opt && opt.method === "POST") return ok({ success: true });
  if (/\/\d+$/.test(u)) return ok({ id: "111" });
  return ok({});
};

const ads = h.load("ads");
const A = (q, b) => h.call(ads, q, b);

(async () => {
  console.log("META ADS\n");
  // our own side: a few paid leads with outcomes
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const ph = "98765004" + (10 + i);
    const l = { ts: now - i * 86400000, name: "P" + i, phone: ph, src: "instagram", type: "instagram" };
    h.run(["RPUSH", "dl_leads", JSON.stringify(l)]);
    if (i < 4) h.run(["HSET", "dl_status", `${l.ts}|${ph}`, i < 2 ? "visited" : "booked"]);
  }
  h.run(["RPUSH", "bill:of:9876500410", "B1"]);
  h.run(["SET", "bill:B1", JSON.stringify({ id: "B1", items: [{ name: "Laser", price: 40000 }], payments: [{ amount: 40000, ts: now - 3600000 }] })]);

  const o = await A({ a: "overview", days: "30" });
  is(o.code, 200, "the screen opens");
  is(o.body.connected, true, "connected through META_ADS_TOKEN");
  is(o.body.account.spend, 120860, "30-day spend read from Meta");
  is(o.body.account.results, 1863, "and the conversations it started");
  is(o.body.account.costEach, 65, "₹65 each — the number the owner actually watches");
  is(o.body.today.spend, 2962, "today's spend is separate");
  is(o.body.account.capLeft, 9140, "and what is left inside the spending limit");

  console.log("\n  — our side of it —");
  is(o.body.ours.leads, 6, "six leads came from Instagram/Facebook");
  is(o.body.ours.booked, 4, "four booked");
  is(o.body.ours.came, 2, "two actually came");
  is(o.body.joined.costPerCame, 60430, "so each patient cost ₹60,430 — the number nobody could work out before");
  is(o.body.joined.revenue, 40000, "and they paid ₹40,000 back");

  console.log("\n  — what each campaign is told to do —");
  const c = o.body.campaigns;
  is(c.length, 2, "both campaigns");
  is(c[0].name, "Laser — Eluru", "biggest spender first");
  is(c[0].costEach, 20, "₹20 a conversation");
  is(c[0].verdict.tone, "good", "which is good: " + c[0].verdict.text);
  is(c[1].costEach, 154, "the other is ₹154");
  is(c[1].verdict.tone, "good", "still inside the ₹300 target: " + c[1].verdict.text);
  is(c[1].running, false, "and it is paused");

  const V = ads.verdict;
  is(V(5000, 0, 0, 300).tone, "bad", "money with nothing to show for it is called bad");
  is(V(5000, 5, 1000, 300).tone, "bad", "and so is ₹1,000 a conversation: " + V(5000, 5, 1000, 300).text);
  is(V(5000, 12, 420, 300).tone, "warn", "a bit over target is a warning, not an alarm");
  is(V(0, 0, 0, 300).tone, "quiet", "a campaign that has not spent is left alone");

  console.log("\n  — money, and who may spend it —");
  is((await A({ a: "budget" }, { a: "budget", id: "111", daily: 50 })).code, 400, "under ₹100 a day is refused");
  is((await A({ a: "budget" }, { a: "budget", id: "111", daily: 90000 })).code, 400, "and so is ₹90,000 — a slipped finger cannot do that here");
  const good = await A({ a: "budget" }, { a: "budget", id: "111", daily: 1500 });
  is(good.code, 200, "a sensible one goes through");
  const sent = calls.filter((x) => x.method === "POST" && x.body && x.body.daily_budget).pop();
  is(sent.body.daily_budget, 150000, "sent to Meta in paise, as Meta wants");
  is(h.run(["LRANGE", "staff:audit", "0", "5"]).some((x) => /budget/.test(x)), true, "and written into the audit");

  const p = await A({ a: "pause" }, { a: "pause", id: "111" });
  is(p.code, 200, "a campaign can be stopped");
  is(h.run(["LRANGE", "staff:audit", "0", "5"]).some((x) => /aapaaru/.test(x)), true, "and that is recorded too");

  h.as(["reports.view"]);
  is((await A({ a: "overview" })).code, 200, "a manager can see the numbers");
  is((await A({ a: "overview" })).body.canChange, false, "but the app is told not to draw the buttons");
  is((await A({ a: "budget" }, { a: "budget", id: "111", daily: 500 })).code, 403, "and cannot change a budget");
  is((await A({ a: "pause" }, { a: "pause", id: "111" })).code, 403, "nor stop a campaign");
  h.as(["money.view"]);
  is((await A({ a: "overview" })).code, 403, "somebody without reports sees none of it");
  h.as(["*"]);

  console.log("\n  — with nothing configured —");
  delete process.env.META_ADS_TOKEN;
  h.run(["DEL", "ads:conn"]);
  const off = await A({ a: "overview" });
  is(off.body.connected, false, "it says so plainly rather than showing zeroes");
  is(off.body.needs.length > 0, true, "and names what is missing: " + off.body.needs.join(", "));
  is(off.body.ours.leads, 6, "our own side still shows, because that part needs no token");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nads behave");
})();
