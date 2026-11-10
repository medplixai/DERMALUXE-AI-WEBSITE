// What the Instagram agent collects before the desk can call anyone back.
//
// Instagram hides the phone number, and for weeks the desk's list filled
// with "@someone — Pimples" and nothing to dial. The owner (10 Nov 2026):
// collect the name, the mobile number and the village in the DM, so the
// desk has something to work with. These check that what the patient types
// actually lands — on the lead row, on the patient's qualifying record for
// the WhatsApp agent, and in the nudge that asks the quiet ones again.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("_admin.js", { fmtIst: () => "", promoParams: (tpl, name, text) => [name, text], publishNow: async () => ({ ok: true }) });
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
process.env.IG_PAGE_TOKEN = "page";

const ig = require(path.join(API, "instagram.js"));
const cfg = { kind: "pg" };
const leads = () => h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x));
const qual = (ph) => JSON.parse(h.run(["GET", `qual:${ph}`]) || "null");

(async () => {
  console.log("the agent is told to collect all three");
  is(/name, \(2\) 10-digit mobile number, \(3\) which town or village/.test(ig.IG_RULES), true, "booking flow asks name, number, village in that order");
  is(/CONTACT DETAILS/.test(ig.IG_RULES) && /"village"/.test(ig.IG_RULES), true, "and the lead JSON has a village field");
  is(/peru, number, inka e ooru/.test(ig.QUIET_NUDGE_DM), true, "the nudge to a quiet chat asks for all three too");

  console.log("a DM with a number and a village");
  await ig.storeLead(cfg, { name: "Lakshmi", phone: "9876543210", village: "Bhimavaram", concern: "Hair fall", heat: "warm" }, "ig-1", "lakshmi_b", "Bhimavaram nunchi");
  let L = leads();
  is(L.length, 1, "one lead row");
  is(L[0].village, "Bhimavaram", "the village is on the lead row");
  is(L[0].phone, "9876543210", "with the number");
  is(typeof L[0].km, "number", "and the distance from Eluru, because Bhimavaram is a known town");
  is((qual("9876543210").facts || {}).village, "Bhimavaram", "the WhatsApp agent's record knows the village, so it will not ask again");
  is((qual("9876543210").facts || {}).name, "Lakshmi", "and the name");

  console.log("a DM with a village but no number yet");
  await ig.storeLead(cfg, { name: "", phone: "", village: "Tadepalligudem", concern: "Pimples" }, "ig-2", "pimple_guy", "Tadepalligudem");
  L = leads();
  is(L[0].village, "Tadepalligudem", "the village still rides on the lead row");
  is(L[0].name, "@pimple_guy", "the Instagram handle stands in for the name");
  is(h.run(["GET", "qual:"]) || null, null, "nothing is written to a qualifying record without a number");

  console.log("the number arrives later in the same chat");
  await ig.storeLead(cfg, { name: "Ravi", phone: "9123456789", village: "", concern: "Pimples" }, "ig-2", "pimple_guy", "9123456789");
  L = leads();
  is(L.filter((l) => l.src_id === "ig-2").length, 1, "the earlier row is replaced, not doubled");
  is(L.find((l) => l.src_id === "ig-2").phone, "9123456789", "now with the number");
  is(JSON.parse(h.run(["GET", "ig:p:ig-2"])).village, "Tadepalligudem", "the conversation profile remembered the village it was told first");

  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
