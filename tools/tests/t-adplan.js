// Planning a campaign out of what the clinic knows, then building it.
//
// The two things that would make this dangerous rather than useful: an
// interest id nobody checked (it silently targets nobody), and a plan that
// starts spending because somebody tapped Plan. Both are pinned here.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.ANTHROPIC_API_KEY = "test";
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };

// Meta's vocabulary: it knows "Skin care" and "Beauty", and has never heard
// of the one the model made up.
const KNOWN = { "skin care": { id: "6003107902433", name: "Skin care", audience_size_upper_bound: 900000000 },
                beauty: { id: "6003139266461", name: "Beauty", audience_size_upper_bound: 800000000 } };
const searched = [];
stub("ads.js", {
  connect: async () => ({ ok: true, tokenName: "META_ADS_TOKEN", accountId: "123" }),
  tokenOf: () => "tok",
  graph: async (p, tok, params) => {
    searched.push(params.q);
    const hit = KNOWN[String(params.q || "").toLowerCase()];
    return { data: hit ? [hit] : [] };
  },
  spend: async () => 4200,
});
let built = null;
stub("_boost.js", { ready: () => true, promote: async (cfg, o) => { built = o; return { ok: true, rupees: o.rupees, days: o.days, campaign: "c_new" }; } });

// The model's answer.
let reply = {
  name: "Hair fall — Eluru 30km", why: "Hair fall is the concern most people write in about.",
  concern: "hair fall", radius_km: 30, age_min: 24, age_max: 50, genders: "all",
  interests: ["Skin care", "Beauty", "Trichological hair restoration"],
  rupees: 1500, days: 5, headline: "Juttu raalutunda?", body: "Line one\nLine two\nMessage cheyandi",
};
// Wrapped in a sentence on purpose: a model that will not take a prefilled
// turn is a model that will sometimes say "Here is the plan:" first.
global.fetch = async () => ({ ok: true, status: 200,
  json: async () => ({ content: [{ type: "text", text: "Here is the plan:\n" + JSON.stringify(reply) }] }) });

const ap = h.load("_adplan");
const cfg = { kind: "pg" };

(async () => {
  console.log("AD CAMPAIGN PLANNER\n");

  console.log("  — what it plans from —");
  const now = Date.now();
  [["hair fall", "Eluru"], ["hair fall", "Eluru"], ["hair fall", "Bhimavaram"], ["acne", "Eluru"], ["pigmentation", "Nuzvid"]]
    .forEach(([c, v], i) => h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: now - i * 86400000, concern: c, village: v, phone: "98765000" + (10 + i) })]));
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: now - 400 * 86400000, concern: "old thing", village: "Eluru" })]);
  const f = await ap.clinicFacts(cfg);
  is(f.leads, 5, "only the last sixty days count — a year-old enquiry is not this month's demand");
  is(f.concerns[0], { name: "hair fall", n: 3 }, "the concern people actually write in about, most first");
  is(f.towns[0], { name: "Eluru", n: 3 }, "and the towns they write from");

  console.log("\n  — interests are Meta's word, not ours —");
  searched.length = 0;
  const p1 = await ap.plan(cfg, {});
  is(p1.ok, true, "a plan comes back");
  is(p1.plan.interests.map((i) => i.name), ["Skin care", "Beauty"], "only the ones Meta confirmed are kept");
  is(p1.plan.missed, ["Trichological hair restoration"], "and the invented one is named, not quietly dropped");
  is(searched.length, 3, "every one was actually looked up: " + searched.join(", "));

  console.log("\n  — a plan cannot spend —");
  is(built, null, "planning builds nothing on Meta at all");
  is(JSON.parse(h.run(["GET", "adplan:last"])).name, "Hair fall — Eluru 30km", "the draft is kept so leaving the screen does not lose it");

  console.log("\n  — the arithmetic Meta refuses —");
  reply = Object.assign({}, reply, { rupees: 400, days: 9 });
  const p2 = await ap.plan(cfg, {});
  is(p2.plan.days, 4, "₹400 cannot run nine days — Meta wants ₹100 a day, so the run is shortened");
  is(p2.plan.perDay >= 100, true, "whatever comes back, a day is never under ₹100: ₹" + p2.plan.perDay);
  reply = Object.assign({}, reply, { rupees: 1500, days: 5, radius_km: 900, age_min: 5 });
  const p3 = await ap.plan(cfg, {});
  is([p3.plan.radius, p3.plan.ageMin], [80, 18], "a nonsense radius or a child's age is pulled back to what Meta allows");

  // extractJson happily returns whatever fields survived a cut-off answer, so
  // a plan can parse and still have no ad in it. The live one did exactly
  // that: a name, a half-written reason, and empty copy.
  console.log("\n  — a plan cut off half way —");
  const whole = reply;
  reply = { name: "Hair fall", why: "Because peo", radius_km: 30, rupees: 1500, days: 5 };
  const cut = await ap.plan(cfg, {});
  is([cut.ok, cut.error], [false, "Plan sagam lone aagipoyindi — malli 'Plan cheyyi' nokkandi"],
    "no headline and no body is not a plan, and it says so rather than showing empty boxes");
  reply = whole;

  console.log("\n  — building it —");
  const good = Object.assign({}, p1.plan, { image: "https://www.dermaluxe.ai/assets/academy/batch1-poster.jpg" });
  const out = await ap.create(cfg, good, "Owner");
  is(out.ok, true, "it builds");
  is([built.rupees, built.days], [1500, 5], "with the money the plan said");
  is([built.targeting.radius, built.targeting.ageMin, built.targeting.ageMax], [30, 24, 50], "and the audience the owner agreed to");
  is(built.targeting.interests.map((i) => i.id), ["6003107902433", "6003139266461"], "carrying Meta's own interest ids, not names");
  is(built.name, "Hair fall — Eluru 30km", "under the plan's name");
  is((await ap.create(cfg, Object.assign({}, good, { image: "" }), "Owner")).error, "Poster kavali", "and never without a picture");

  console.log("\n  — what it never does —");
  const src = require("fs").readFileSync(path.join(API, "_adplan.js"), "utf8");
  is(/status:\s*"ACTIVE"/.test(src), false, "nothing here creates anything running — the boost module makes it PAUSED and starting it is a person's job");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe planner behaves");
  process.exit(fails ? 1 : 0);
})();
