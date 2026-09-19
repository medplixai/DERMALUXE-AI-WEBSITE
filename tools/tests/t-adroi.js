// What each ad campaign cost per patient, not per chat.
//
// Meta counts conversations started; the clinic cares about people who came
// and paid. A click-to-WhatsApp ad tells us which ad a chat came from — the
// lead that chat becomes carries that ad, and the Ads screen joins it back to
// the campaign: leads, booked, came, money in, and the cost of each patient.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.META_ADS_TOKEN = "t"; process.env.META_AD_ACCOUNT_ID = "2110247062961086";
process.env.WA_WEBHOOK_TOKEN = "hook"; process.env.WA_CLOUD_TOKEN = "cloud"; process.env.WA_PHONE_ID_ALLOWLIST = "111";
process.env.WA_AGENT_ENABLED = "1"; process.env.ANTHROPIC_API_KEY = "test"; process.env.ADMIN_PHONES = "9010427777";
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("_admin.js", { isAdmin: () => false, handle: async () => null, fmtIst: () => "" });
stub("_hr.js", { handle: async () => null });
stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });

let lead = null;
global.fetch = async (url) => {
  const full = String(url), u = full.split("?")[0];
  const ok = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => "" });
  if (full.includes("api.anthropic.com")) return ok({ content: [{ type: "text", text: JSON.stringify({ reply: "Namaste 🙏", lead }) }] });
  if (u.includes("/me/adaccounts")) return ok({ data: [{ account_id: "2110247062961086", name: "DermaLuxe", account_status: 1, currency: "INR" }] });
  if (/\/act_\d+\/insights/.test(u)) return ok({ data: [{ spend: "3000", impressions: "1000", reach: "900", actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "30" }] }] });
  if (/\/act_\d+\/campaigns/.test(u)) return ok({ data: [
    { id: "C1", name: "Laser — Eluru", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "50000", insights: { data: [{ spend: "2000", actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "20" }] }] } },
    { id: "C2", name: "Hair", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "50000", insights: { data: [{ spend: "1000", actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "10" }] }] } },
  ] });
  if (/\/act_\d+\/ads/.test(u)) return ok({ data: [{ id: "AD9", campaign_id: "C1" }, { id: "AD8", campaign_id: "C2" }] });
  if (/\/act_\d+$/.test(u)) return ok({ name: "DermaLuxe", currency: "INR", amount_spent: "0", spend_cap: "0", account_status: 1 });
  return ok({});
};

const wa = h.load("whatsapp"), ads = h.load("ads"), money = h.load("money");
let mid = 0;
const say = (from, text, referral) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve(o); return this; }, send() { resolve(); return this; } };
  const m = { id: "a" + (++mid), from: "91" + from, type: "text", text: { body: text } };
  if (referral) m.referral = referral;
  wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: "X" } }], messages: [m] } }] }] } }, res);
});

(async () => {
  console.log("COST PER PATIENT, PER CAMPAIGN\n");
  await say("9876501401", "Laser gurinchi", { source_type: "ad", source_id: "AD9", headline: "Laser hair removal ₹999" });
  lead = { name: "Anu", concern: "Laser", heat: "hot" };
  await say("9876501401", "Naa peru Anu");
  const L = JSON.parse(h.run(["LRANGE", "dl_leads", "0", "0"])[0]);
  is([L.ad_id, L.ad_headline], ["AD9", "Laser hair removal ₹999"], "a chat that started from an ad becomes a lead credited to that ad");
  lead = { name: "Bala", concern: "Laser" };
  await say("9876501402", "Bala, laser");                         // no ad
  is(JSON.parse(h.run(["LRANGE", "dl_leads", "0", "0"])[0]).ad_id, undefined, "one that did not start from an ad is not");

  h.run(["HSET", "dl_status", `${L.ts}|9876501401`, "visited"]);
  const b = (await h.call(money, {}, { a: "bill", phone: "9876501401", name: "Anu", items: [{ name: "Laser", price: 5000 }] })).body.bill;
  await h.call(money, {}, { a: "pay", id: b.id, amount: 5000, mode: "upi" });

  const o = (await h.call(ads, { a: "overview", days: "30" })).body;
  const c1 = o.campaigns.find((c) => c.id === "C1"), c2 = o.campaigns.find((c) => c.id === "C2");
  is([c1.patients.leads, c1.patients.came, c1.patients.revenue], [1, 1, 5000], "the laser campaign shows the lead, that they came, and what they paid");
  is([c1.patients.costPerPatient, c1.patients.back], [2000, 250], "so one patient cost ₹2,000 and the campaign returned 250%");
  is(c2.patients.leads, 0, "and the other campaign is not credited with them");
  is(o.ours.fromAds, 1, "the screen can say how many leads came straight from ads");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\ncost per patient behaves");
  process.exit(fails ? 1 : 0);
})();
