// The daily clinic poster alternates disease and beauty (owner, 23 Nov 2026:
// "disease and beauty kuda portrait avvali"), and never promises anything
// free but the AI analysis — "free skin check" went out on 22 Nov while a
// consultation is ₹300. Runs the real _daily.js with the planner stubbed.
process.env.ANTHROPIC_API_KEY = "test-key";
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API || path.resolve("api");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

let reply = null, lastPrompt = "";
global.fetch = async (url, opt) => {
  lastPrompt = JSON.parse(opt.body).messages[0].content;
  return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }] }) };
};
const D = require(path.join(API, "_daily.js"));
const cfg = { kind: "pg" };
const hist = (...keys) => { h.run(["DEL", "dp:hist"]); keys.reverse().forEach((k, i) => h.run(["LPUSH", "dp:hist", `${k}|2026-11-${10 + i}`])); };

(async () => {
  is(D.wantKind(["pigmentation", "carbon"]), "disease", "after a beauty poster comes a disease poster");
  is(D.wantKind(["psoriasis"]), "beauty", "after a disease poster comes a beauty one");
  is(D.wantKind(["tech", "acad-who", "fungal"]), "beauty", "doctor/machine posts and academy days don't break the turn");
  is(["eczema", "allergy", "nail"].map(D.kindOf), ["disease", "disease", "disease"], "three new disease topics: eczema, allergy, nails");

  // Without the planner: the plain rotation keeps the turn too.
  hist("pigmentation", "tan");
  for (let i = 0; i < 12; i++) {
    const t = await D.pickTopic(cfg);
    if (D.kindOf(t.key) === "beauty") { is(t.key, "(a disease or neutral topic)", "rotation after a beauty day"); break; }
  }
  is(true, true, "twelve picks after a beauty day: none of them beauty");

  // With the planner: it is only offered today's kind.
  hist("pigmentation");
  reply = { key: "psoriasis", h1: "Psoriasis can be calmed", te: "సోరియాసిస్ అదుపులో", sub: "MD dermatologist led · Long-term plan · free skin check", img: "A calm South Indian man in soft golden light, tasteful, dark background.", why: "disease day" };
  const t1 = await D.planTopic(cfg);
  is(/SKIN OR HAIR DISEASE/.test(lastPrompt), true, "the planner is told today is a disease day");
  is(/\bpigmentation \[|hydrafacial \[|tan \[/.test(lastPrompt), false, "and is not offered beauty topics");
  is(/consultation costs ₹300 — it is NOT free/.test(lastPrompt), true, "and is told the consultation is ₹300, not free");
  is([t1.key, t1.sub], ["psoriasis", "MD dermatologist led · Long-term plan"], "a 'free skin check' fragment is cut from the line");

  reply = { key: "hydrafacial", h1: "Glow for the wedding", te: "పెళ్ళికి గ్లో", sub: "Deep cleanse · Hydration · Same-day glow", img: "A smiling South Indian bride in golden light, tasteful, dark background.", why: "x" };
  const t2 = await D.planTopic(cfg);
  is(D.kindOf(t2.key) !== "beauty", true, "if the planner picks beauty on a disease day anyway, the day falls back to a disease topic");

  hist("psoriasis");
  reply = { key: "hydrafacial", h1: "Free facial this week", te: "పెళ్ళికి గ్లో", sub: "Deep cleanse · Hydration", img: "A smiling South Indian bride in golden light, tasteful, dark background.", why: "x" };
  const t3 = await D.planTopic(cfg);
  is(t3.h1 === "Free facial this week", false, "a headline promising something free is never published");

  reply = { key: "hydrafacial", h1: "Glow, without the filter", te: "ఫిల్టర్ లేని గ్లో", sub: "Deep cleanse · Free AI skin analysis online", img: "A smiling South Indian woman in golden light, tasteful, dark background.", why: "x" };
  const t4 = await D.planTopic(cfg);
  is(t4.sub, "Deep cleanse · Free AI skin analysis online", "the free AI analysis may still be mentioned — it is free");

  // The owner's priority topics come round often.
  hist("psoriasis", "a1", "a2", "a3", "a4", "a5", "a6", "pigmentation");
  reply = { key: "pigmentation", h1: "Melasma can be lightened", te: "మంగు మచ్చలు తగ్గుతాయి", sub: "Peels · PICO laser · Sunscreen habit", img: "A South Indian woman's cheek in soft golden light, tasteful, dark background.", why: "x" };
  const t5 = await D.planTopic(cfg);
  is(/pigmentation \[tx\] ★/.test(lastPrompt), true, "pigmentation is offered again 7 days after it ran, marked as priority");
  is(t5.key, "pigmentation", "and can be today's poster");
  hist("psoriasis");
  let pri = 0;
  for (let i = 0; i < 40; i++) if (D.PRIORITY.has((await D.pickTopic(cfg)).key)) pri++;
  is(pri >= 20, true, "without the planner, most beauty days land on a priority topic (" + pri + " of 40)");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nposters alternate disease and beauty");
  process.exit(fails ? 1 : 0);
})();
