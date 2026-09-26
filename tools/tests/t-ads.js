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
// Swapped between cases: Meta sends spend_cap "0" when there is NO cap.
let acctCap = { spend_cap: "13000000" };
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
  // The account edge reports money in PAISE (insights "spend" is in rupees).
  // ₹120,860 spent against a ₹130,000 cap.
  if (/\/act_\d+$/.test(u)) return ok(Object.assign({ name: "DermaLuxe", currency: "INR", account_status: 1,
    amount_spent: "12086000" }, acctCap));
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

  // A brand-new account has no cap at all, and Meta says so with the string
  // "0". That is truthy, so the screen used to announce "₹0 left" — telling
  // the owner they could not spend, on an account with no limit.
  acctCap = { spend_cap: "0" };
  h.run(["DEL", "ads:conn"]);
  const nocap = await A({ a: "overview", days: "30" });
  is(nocap.body.account.capLeft, null, "no cap set means no limit line at all");

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

  // ---- what to do about it ------------------------------------------------
  // A dashboard that only reports leaves eight campaigns' arithmetic to the
  // owner at nine in the morning, so nobody ever does it. Every suggestion has
  // to carry the number it came from and apply itself.
  console.log("\n  — what to do about it —");
  // capLeft 0 in the default account means "there IS a cap and it is spent",
  // which is not what these cases are about — pass a real one so the
  // no-ceiling rule does not fire in every other assertion.
  const sg = (camps, acct, ours) => ads.suggestions(acct || { spend: 1000, capLeft: 9000 }, camps, 300, 30, [], ours || { leads: 0 });
  const camp = (o) => Object.assign({ id: "1", name: "C", running: true, spend: 1000, results: 5, costEach: 200, daily: 0 }, o);

  is(sg([camp({ spend: 150, results: 0 })]).length, 0, "a campaign that has barely spent anything is not judged — noise is not a finding");
  const dead = sg([camp({ id: "9", name: "Hair transplant", spend: 7390, results: 0 })]);
  is([dead.length, dead[0].kind, dead[0].action.a, dead[0].action.id], [1, "stop", "pause", "9"], "money going nowhere: stop it, in one tap");
  is(/7,390/.test(dead[0].why) && /okka సంభాషణ kuda raaledu/.test(dead[0].why), true, "with the number it was worked out from: " + dead[0].why);
  is(/₹7,390 migulutundi/.test(dead[0].gain), true, "and what a month of it is worth: " + dead[0].gain);

  const pair = sg([
    camp({ id: "1", name: "Cheap", spend: 6000, results: 60, costEach: 100 }),
    camp({ id: "2", name: "Dear", spend: 9000, results: 9, costEach: 1000 }),
  ]);
  const stop2 = pair.find((x) => x.campaignId === "2");
  is(!!stop2, true, "the expensive one is named");
  is(/"Cheap" adhe pani ₹100 ki chestundi \(10 rettu takkuva\)/.test(stop2.why), true,
    "against the cheaper one the clinic is already running: " + stop2.why);
  is(pair.some((x) => x.campaignId === "1" && x.kind === "stop"), false, "and the cheap one is never told to stop");

  // "Expensive" only means anything beside something cheaper. One campaign on
  // its own, over target, is not evidence that a better price exists.
  is(sg([camp({ id: "5", spend: 9000, results: 9, costEach: 1000 })]).filter((x) => x.kind === "stop").length, 0,
    "with nothing to compare against, nothing is called expensive");

  const up = sg([camp({ id: "3", name: "Academy", spend: 3000, results: 30, costEach: 100, daily: 300 })]);
  is([up.length, up[0].kind, up[0].action.a, up[0].action.daily], [1, "raise", "budget", 450], "the cheap one, starved, is told to spend more — ₹300 → ₹450");
  is(/₹100 ki testundi/.test(up[0].why) && /roju ₹300 matrame/.test(up[0].why), true, "saying why: " + up[0].why);
  // A lifetime budget has no daily number to raise — but staying silent about
  // a campaign that is working is how the box came to sit empty on the one
  // campaign the clinic had running. It says so, and says where the knob is.
  const lifeOnly = sg([camp({ id: "4", costEach: 100, daily: 0 })]);
  is([lifeOnly.length, lifeOnly[0].kind], [1, "good"], "a lifetime-budget campaign is praised, not told to raise a budget it does not have");
  is(lifeOnly.some((x) => x.kind === "raise"), false, "and never handed a daily-budget button that would do nothing");
  is(sg([camp({ id: "6", running: false, spend: 9000, results: 0 })]).length, 0, "and nothing already paused is suggested at all");

  // ---- the ones a spend-and-reach dashboard can never say ------------------
  console.log("\n  — what the money actually did —");
  const noBook = sg([], { spend: 1000, capLeft: 9000 }, { leads: 8, booked: 0 });
  const follow = noBook.find((x) => x.kind === "follow");
  is(!!follow, true, "leads arriving and nobody booking is the most important thing on the page");
  is(/8 leads vachcharu, okkaru book cheyyaledu/.test(follow.title), true, "said plainly: " + follow.title);
  is(/okko lead ₹125/.test(follow.why), true, "with what each one cost: " + follow.why);
  is(follow.go, "leads", "and it sends you to the screen where the work is");
  is(sg([], { spend: 1000, capLeft: 9000 }, { leads: 8, booked: 1 }).some((x) => x.kind === "follow"), false,
    "one booking and it stops nagging");
  is(sg([], { spend: 1000, capLeft: 9000 }, { leads: 2, booked: 0 }).some((x) => x.kind === "follow"), false,
    "two leads is not a pattern");

  const gap = sg([], { spend: 1000, capLeft: 9000, results: 40 }, { leads: 0 });
  is(gap.some((x) => x.id === "track:none"), true, "Meta counting conversations we have no lead for is worth knowing about");

  const noCap = sg([], { spend: 1000, capLeft: null }, { leads: 0 });
  is(noCap.some((x) => x.id === "cap:none"), true, "an account with no ceiling at all, running ads unattended every morning");

  const orph = sg([{ id: "1", name: "C", running: true, spend: 1000, results: 5, costEach: 200, daily: 0, patients: { leads: 2, came: 0 } }],
    { spend: 1000, capLeft: 9000 }, { leads: 8, booked: 1, byAd: { ad_gone: { leads: 6 }, ad_here: { leads: 2 } } });
  const orphan = orph.find((x) => /^orphan:ads:/.test(x.id));
  is(!!orphan && /6 leads/.test(orphan.title), true, "leads credited to an ad that is no longer listed are named, not silently dropped");

  console.log("\n  — ranked by patients once we have them —");
  const pt = (came, cost) => ({ leads: came * 3, booked: came, came: came, revenue: 0, costPerPatient: cost });
  const byPatient = sg([
    { id: "1", name: "Cheap chats", running: true, spend: 6000, results: 200, costEach: 30, daily: 0, patients: pt(2, 3000) },
    { id: "2", name: "Fewer chats, more patients", running: true, spend: 6000, results: 20, costEach: 300, daily: 0, patients: pt(12, 500) },
  ], { spend: 12000, capLeft: 90000 }, { leads: 42, booked: 14 });
  const stopCheap = byPatient.find((x) => x.campaignId === "1" && x.kind === "stop");
  is(!!stopCheap, true, "the one that is cheap per chat but dear per patient is the one to stop");
  is(/Idi Meta lekka kaadu/.test(stopCheap.why), true, "and it says whose number it is using: " + stopCheap.why);
  is(byPatient.some((x) => x.campaignId === "2" && x.kind === "stop"), false, "the one that actually fills the clinic is left alone");
  is(byPatient.filter((x) => x.campaignId === "1").length, 1, "and nothing is judged twice, once on patients and again on chats");

  console.log("\n  — a lifetime budget has no daily knob —");
  const life = sg([{ id: "7", name: "Academy Batch 1", running: true, spend: 313, results: 3, costEach: 104, daily: 0 }], { spend: 313, capLeft: 9000 });
  const doingWell = life.find((x) => x.kind === "good");
  is(!!doingWell, true, "a campaign doing well on a lifetime budget is not silence — it used to leave the box empty");
  is(/lifetime budget campaign/.test(doingWell.gain), true, "saying where the knob actually is: " + doingWell.gain);

  const cap = sg([], { spend: 30000, capLeft: 4000 });
  is([cap.length, cap[0].kind], [1, "cap"], "the account's own spending limit running out is worth a word");
  is(/inka 4 rojulu/.test(cap[0].why), true, "counted at the rate it is actually going: " + cap[0].why);
  is(ads.suggestions({ spend: 30000, capLeft: 4000 }, [], 300, 30, ["cap:account"]).length, 0, "and once the owner says vaddu, it stops asking");

  console.log("\n  — the day's list —");
  const td = (camps, acct) => ads.todo(acct || { costEach: 115 }, camps, 300);
  const c2 = (o) => Object.assign({ id: "1", name: "C", running: true, spend: 1000, results: 5, costEach: 200 }, o);
  is(td([c2({ spend: 299 })]).rows.length, 0, "under ₹300 a campaign has not earned an opinion");
  is(td([c2({ spend: 400, results: 0 })]).rows[0].tone, "bad", "spending with nothing to show is red");
  is(td([c2({ spend: 400, costEach: 22 })]).rows[0].text, "okko సంభాషణ ₹22 — chauka. Budget penchandi", "cheap is green, and says what to do");
  is(td([c2({ spend: 400, costEach: 515 })]).rows[0].text, "okko సంభాషణ ₹515 — lakshyam ₹300. Aapi creative marchandi", "dear says which number it missed");
  is(td([c2({ running: false, spend: 4000, costEach: 22 })]).rows.length, 0, "and a stopped campaign is not on today's list");
  is([td([]).min, td([]).target, td([]).avg], [300, 300, 115], "the footnote carries the floor, the target and our own average");

  // ---- the posters to choose from ----------------------------------------
  // Typing an image URL by hand was the only way to give a campaign a
  // picture, which nobody on a phone was ever going to do.
  console.log("\n  — choosing a poster —");
  h.run(["DEL", "post:log"]); h.run(["DEL", "ads:igmedia"]); h.run(["DEL", "ads:promo"]);
  h.run(["LPUSH", "post:log", JSON.stringify({ id: "ig1", imgId: "abc123", kind: "post", caption: "Hydrafacial roju", at: Date.now() - 3600000 })]);
  h.run(["LPUSH", "post:log", JSON.stringify({ id: "ig2", imgId: "def456", kind: "story", caption: "A story", at: Date.now() - 7200000 })]);
  // Our own copy of a poster is kept a month; offering one older than that
  // hands Meta a link that answers 404, which is how the first real build
  // failed.
  h.run(["LPUSH", "post:log", JSON.stringify({ id: "ig3", imgId: "old789", kind: "post", caption: "Last week", at: Date.now() - 5 * 86400000 })]);
  h.run(["LPUSH", "post:log", JSON.stringify({ id: "ig4", imgId: "gone42", kind: "post", caption: "Two months ago", at: Date.now() - 60 * 86400000 })]);
  const pk = await A({ a: "posters" });
  is(pk.code, 200, "the picker has something to show");
  const own = (pk.body.rows || []).filter((r) => r.src === "poster");
  is(own.map((r) => r.img), ["https://www.dermaluxe.ai/api/media?id=abc123", "https://www.dermaluxe.ai/api/media?id=old789"],
    "our own posters, as links Meta can fetch — no stories, newest first");
  // Instagram's CDN answers 403 to a server, so a picture hosted there can
  // never be an ad's image. Offering one is offering a button that fails.
  is((pk.body.rows || []).some((r) => /cdninstagram|fbcdn/.test(r.img)), false,
    "and nothing hosted by Instagram, which will not hand a picture to a server");

  // An Instagram link is signed and goes stale; by the time somebody presses
  // Build, Meta gets a 403 from it. The one thing that must happen is asking
  // Instagram again for the current one.
  // "Vaddu" answers the situation in front of the owner. Eight leads with no
  // booking, dismissed; twenty-four is a different fact and has to be allowed
  // to ask again — but not at nine.
  console.log("\n  — saying no, and when it wears off —");
  const follow8 = sg([], { spend: 1000, capLeft: 9000 }, { leads: 8, booked: 0 }).find((x) => x.kind === "follow");
  const said = [follow8.id];
  is(ads.suggestions({ spend: 1000, capLeft: 9000 }, [], 300, 30, said, { leads: 9, booked: 0 }).some((x) => x.kind === "follow"), false,
    "nine leads is the same situation, and it stays quiet");
  is(ads.suggestions({ spend: 1000, capLeft: 9000 }, [], 300, 30, said, { leads: 24, booked: 0 }).some((x) => x.kind === "follow"), true,
    "three times as many is not, and it asks again");

  console.log("\n  — the shells a run of failures leaves —");
  const shell = (i) => ({ id: "s" + i, name: "Half-built " + i, running: false, spend: 0, results: 0, costEach: 0, patients: { leads: 0 } });
  is(sg([shell(1), shell(2)]).some((x) => x.kind === "tidy"), false, "two is not a mess");
  const tidy = sg([shell(1), shell(2), shell(3), shell(4)]).find((x) => x.kind === "tidy");
  is([!!tidy, tidy.action.a], [true, "cleanup"], "four is, and it offers to clear them in one tap");
  is(/4 khaali campaigns/.test(tidy.title), true, "counting them: " + tidy.title);
  is(sg([shell(1), shell(2), Object.assign(shell(3), { spend: 900 })]).some((x) => x.kind === "tidy"), false,
    "and one that cost money is not a shell, so there are only two left — no offer");

  console.log("\n  — a link that has gone stale —");
  let asked = null;
  const realFetch = global.fetch;
  global.fetch = async (u) => {
    if (String(u).includes("graph.instagram.com")) { asked = String(u); return { ok: true, json: async () => ({ media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/FRESH" }) }; }
    return realFetch(u);
  };
  process.env.IG_LOGIN_TOKEN = "igtok";
  is(await ads.freshImage({ kind: "pg" }, "ig123", "https://scontent.cdninstagram.com/STALE"), "https://scontent.cdninstagram.com/FRESH",
    "an Instagram picture is looked up again at the moment of building");
  is(/ig123/.test(asked || ""), true, "by its own id");
  is(await ads.freshImage({ kind: "pg" }, "own:abc", "https://www.dermaluxe.ai/api/media?id=abc"), "",
    "our own posters are served by us and need no refreshing");
  is(await ads.freshImage({ kind: "pg" }, "", "https://scontent.cdninstagram.com/x"), "", "and a picture with no id is left alone");
  global.fetch = realFetch;

  console.log("\n  — the screen's own wiring —");
  h.run(["DEL", "ads:no"]);
  const dis = await A({ a: "dismiss" }, { a: "dismiss", id: "stop:111" });
  is(dis.code, 200, "a suggestion can be dismissed");
  is(h.run(["SMEMBERS", "ads:no"]), ["stop:111"], "and is remembered as a no");
  h.as(["reports.view"]);
  is((await A({ a: "dismiss" }, { a: "dismiss", id: "x" })).code, 200, "saying no costs nothing, so anybody who sees the screen may");
  is((await A({ a: "pause" }, { a: "pause", id: "111" })).code, 403, "but only the owner may spend or stop money");
  h.as(["*"]);
  h.run(["SET", "ads:conn", JSON.stringify({ ok: true, tokenName: "META_ADS_TOKEN", accountId: "2110247062961086", at: Date.now() })]);
  is((await A({ a: "sync" }, { a: "sync" })).code, 200, "and the cached account can be thrown away to read Meta again");
  is(h.run(["GET", "ads:conn"]), null, "which is what sync does");
  h.run(["DEL", "ads:no"]);

  console.log("\n  — with nothing configured —");
  delete process.env.META_ADS_TOKEN;
  h.run(["DEL", "ads:conn"]);
  const off = await A({ a: "overview" });
  is(off.body.connected, false, "it says so plainly rather than showing zeroes");
  is(off.body.needs.length > 0, true, "and names what is missing: " + off.body.needs.join(", "));
  is(off.body.ours.leads, 6, "our own side still shows, because that part needs no token");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nads behave");
})();
