// Money going wrong, said out loud on the owner's phone.
//
// The risk in a machine that messages by itself is not that it says nothing;
// it is that it says the same thing every ten minutes until the owner mutes
// it, or claims to have said something WhatsApp never delivered.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.ADMIN_PHONES = "9010427777";
// Meta, stubbed through ads.js's own door: one campaign burning money for
// nothing, one far over the target, one perfectly fine.
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("ads.js", {
  connect: async () => ({ ok: true, tokenName: "META_ADS_TOKEN", accountId: "123" }),
  tokenOf: () => "tok",
  graph: async (p) => {
    if (/\/campaigns$/.test(p)) return { data: [
      { id: "c1", name: "Instagram post: Gachyanthram leka", effective_status: "ACTIVE",
        insights: { data: [{ spend: "747", actions: [] }] } },
      { id: "c2", name: "Laser — Eluru", effective_status: "ACTIVE",
        insights: { data: [{ spend: "4000", actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "4" }] }] } },
      { id: "c3", name: "Academy", effective_status: "ACTIVE",
        insights: { data: [{ spend: "3000", actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "60" }] }] } },
      { id: "c4", name: "Old, stopped", effective_status: "PAUSED",
        insights: { data: [{ spend: "9000", actions: [] }] } },
      { id: "c5", name: "Barely started", effective_status: "ACTIVE",
        insights: { data: [{ spend: "120", actions: [] }] } },
    ] };
    return { amount_spent: "1000000", spend_cap: "0" };   // "0" = no cap at all
  },
});
const al = h.load("_adalert");
const cfg = { kind: "pg" };
const feed = () => h.run(["LRANGE", "ads:alerts", "0", "29"]).map((x) => JSON.parse(x));

(async () => {
  console.log("ADS ALERTS\n");

  console.log("  — what earns a message —");
  const p1 = al.problems({ spend: 8000, capLeft: null }, [
    { id: "c1", name: "A", running: true, spend: 747, results: 0, costEach: 0 },
    { id: "c2", name: "B", running: true, spend: 4000, results: 4, costEach: 1000 },
    { id: "c3", name: "C", running: true, spend: 3000, results: 60, costEach: 50 },
    { id: "c4", name: "D", running: false, spend: 9000, results: 0, costEach: 0 },
    { id: "c5", name: "E", running: true, spend: 120, results: 0, costEach: 0 },
  ], 300);
  is(p1.map((x) => x.id), ["c1", "c2"], "the one spending for nothing and the one three times over target — nothing else");
  is(/₹747 kharchu, okka WhatsApp chat ledu. Aapandi./.test(p1[0].text), true, "said the way the owner would: " + p1[0].text);
  is(/₹1,000 — lakshyam ₹300/.test(p1[1].text), true, "and the dear one names both numbers: " + p1[1].text);
  is(al.problems({ spend: 7000, capLeft: 2000 }, [], 300).map((x) => x.kind), ["cap"],
    "an account about to hit its own ceiling counts too");
  is(al.problems({ spend: 7000, capLeft: 40000 }, [], 300).length, 0, "a ceiling that is weeks away does not");

  console.log("\n  — it says it once —");
  h.run(["DEL", "ads:alerts"]);
  const r1 = await al.run(cfg, { force: true });
  is([r1.checked, r1.alerts], [5, 2], "five campaigns looked at, two worth a word");
  is(feed().length, 2, "and both are written down");
  is(h.sent.filter((x) => x[0] === "wa").length, 2, "the owner's phone has them");
  const r2 = await al.run(cfg, { force: true });
  is([r2.alerts, feed().length], [0, 2], "run again straight away and it stays quiet — the same campaign is still wrong tomorrow");

  console.log("\n  — and not too often —");
  h.run(["DEL", "ads:alert:run"]);
  const r3 = await al.run(cfg);
  is(r3.skipped, "", "a first unforced run goes ahead");
  const r4 = await al.run(cfg);
  is(r4.skipped, "too soon", "the next one a minute later does not: " + r4.skipped);

  console.log("\n  — when WhatsApp will not take it —");
  // Free-form only reaches somebody who wrote in the last 24 hours. A feed
  // that showed "sent" for a message nobody got would be worse than no feed.
  h.run(["DEL", "ads:alerts"]);
  ["ads:alert:c1:nochat", "ads:alert:c2:dear", "ads:alert:run"].forEach((k) => h.run(["DEL", k]));
  const notify = require(path.join(API, "_notify.js"));
  const realSend = notify.sendWa;
  notify.sendWa = async () => false;
  const r5 = await al.run(cfg, { force: true });
  notify.sendWa = realSend;
  is([r5.alerts, r5.sent], [2, 0], "the alert still happens, the message does not");
  is(feed().every((a) => a.sent === false), true, "and every row says so, rather than claiming it was sent");

  console.log("\n  — what it never does —");
  const src = require("fs").readFileSync(path.join(API, "_adalert.js"), "utf8");
  is(/method:\s*"?(POST|DELETE)/.test(src), false, "it writes nothing to Meta at all — no pausing, no budgets, nothing it could get wrong unattended");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe alerts behave");
  process.exit(fails ? 1 : 0);
})();
