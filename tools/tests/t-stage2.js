// Stage 2 — the patients we already have, and the ones who went quiet.
//
// A treatment has a natural next time; the bill now remembers it and the
// patient hears from us when it comes, once, unless they said STOP or already
// have a slot. Campaigns come from the clinic's own calendar, go to a chosen
// audience, no more than one per person a fortnight, and report back what
// they did. What the agent may say about money is the owner's setting, and
// the same setting reaches the prompt, the editor and the judges. And the
// services button is a tappable menu, not an essay.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

// Eluru's clock, held at 10:45 AM — the hour the recalls go.
let NOW = (() => { const d = new Date(); d.setUTCHours(5, 15, 0, 0); return d.getTime(); })();
Date.now = () => NOW;
const DAY = 86400000;

process.env.ADMIN_PHONES = "9010427777";
process.env.WA_WEBHOOK_TOKEN = "hook"; process.env.WA_CLOUD_TOKEN = "cloud"; process.env.WA_PHONE_ID_ALLOWLIST = "111";
process.env.WA_AGENT_ENABLED = "1"; process.env.ANTHROPIC_API_KEY = "test"; process.env.LEAD_NOTIFY_PHONES = "9989325777";
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("_hr.js", { handle: async () => null });
stub("_clinic.js", { forwardLead: async () => ({ attempted: false }) });
stub("_voice.js", { VOICE_CTX: "", stripForTts: (s) => s, synthesize: async () => null, transcribe: async () => null });

let claude = [], lastSystem = "", cloudOut = [];
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opt.body);
    if (/You fix one WhatsApp reply/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: body.messages[0].content.split("\n")[1] || "ok" }] }) };
    lastSystem = body.system;
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏 Em problem andi?", lead: null };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(next) }] }) };
  }
  if (u.includes("graph.facebook.com") && u.includes("/messages")) { cloudOut.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ messages: [{ id: "m" }] }) }; }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

const prices = require(path.join(API, "_prices.js"));
const cycles = require(path.join(API, "_cycles.js"));
const camp = require(path.join(API, "_campaign.js"));
const L = require(path.join(API, "_lint.js"));
const memory = require(path.join(API, "_memory.js"));
const wa = h.load("whatsapp"), money = h.load("money"), followup = h.load("cron-followup"), post = h.load("cron-post"), campaignApi = h.load("campaign"), staffApi = h.load("staff");
const cfg = { kind: "pg" };
let mid = 0;
const say = (from, text, name) => new Promise((resolve) => {
  const res = { _c: 200, setHeader() {}, status(c) { this._c = c; return this; }, json(o) { resolve(o); return this; }, send() { resolve(); return this; } };
  wa({ method: "POST", headers: {}, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: name || "Patient" } }],
    messages: [{ id: "s2" + (++mid), from: "91" + from, type: "text", text: { body: text } }] } }] }] } }, res);
});
const sentTo = (ph, kind) => h.sent.filter((s) => s[0] === kind && s[1] === ph);
const DESK = { name: "Sowmya", phone: "9876500901", role: "reception" };

(async () => {
  console.log("STAGE 2 — THE PATIENTS WE ALREADY HAVE\n");

  console.log("  — what the agent may say about money —");
  is((await prices.load(cfg)).mode, "none", "until the owner decides, the old rule stands: nothing");
  is(await prices.blockFor(cfg), "", "and the prompt says nothing extra");
  is((await prices.save(cfg, { mode: "consult" }, "Owner")).ok, false, "a consultation policy without a fee is refused");
  is((await prices.save(cfg, { mode: "bands", consult: 500, bands: [{ name: "Hydrafacial", from: 4000, to: 3000 }] }, "Owner")).error, "Hydrafacial: 'to' 'from' kanna takkuva undi", "a range that runs backwards is refused");
  const ps = await prices.save(cfg, { mode: "bands", consult: "₹500", bands: [{ name: "Hydrafacial", from: "3,000", to: 4500 }, { name: "Laser hair removal", from: 2500, to: 0 }] }, "Owner");
  is([ps.ok, ps.prices.consult, ps.prices.bands.length], [true, 500, 2], "the owner sets a fee and two ranges");
  const blk = await prices.blockFor(cfg);
  is([/PRICE POLICY/.test(blk), /consultation fee is ₹500/.test(blk), /Hydrafacial ₹3,000–₹4,500/.test(blk), /Laser hair removal ₹2,500\+/.test(blk), /Any treatment NOT in that list: no number/.test(blk)], [true, true, true, true, true], "the prompt carries exactly that far and no further");
  await say("9876504001", "Hydrafacial entha?");
  is(/Hydrafacial ₹3,000–₹4,500/.test(lastSystem), true, "and the next patient message is answered under it");
  is([...await prices.allowed(cfg)].sort((a, b) => a - b), [500, 2500, 3000, 4500], "the editor is told which numbers are now permitted");
  const ok = L.lintReply({ reply: "Hydrafacial approx ₹3,000 nundi start andi — exact plan consultation lo. Repu 6 PM ki vastara?" }, "entha?", [], { allow: await prices.allowed(cfg) });
  is(ok.some((f) => f.code === "price_quoted"), false, "a permitted number passes the editor");
  const bad = L.lintReply({ reply: "PRP session ₹6,000 andi. Repu vastara?" }, "entha?", [], { allow: await prices.allowed(cfg) });
  is(bad.some((f) => f.code === "price_quoted"), true, "a number the owner did not permit is still caught");
  is(/consultation fee ₹500 may be told/.test(prices.judgeNote(ps.prices)), true, "and the reviewer/judge is told a permitted price is not a fault");
  await prices.save(cfg, { mode: "none" }, "Owner");
  is(await prices.blockFor(cfg), "", "switching back to none removes it all");

  console.log("\n  — the treatment's next time —");
  h.as(["money.bill", "money.view"], DESK);
  const b1 = await h.call(money, { a: "bill" }, { a: "bill", phone: "9876504010", name: "Lakshmi Devi", items: [{ name: "HydraFacial", price: 3500 }, { name: "Consultation", price: 500 }] });
  is(b1.code, 200, "a Hydrafacial is billed");
  const last = h.run(["HGETALL", "cyc:last"]);
  is(last.filter((x, i) => i % 2 === 0).sort(), ["9876504010|hydrafacial", "9876504010|review"], "the bill remembers the last Hydrafacial and the doctor visit, per patient");
  const b2 = await h.call(money, { a: "bill" }, { a: "bill", phone: "9876504011", name: "Ravi", items: [{ name: "PRP — hair", price: 5000 }] });
  is(h.run(["HGETALL", "cyc:last"]).some((x) => x === "9876504011|prp"), false, "a six-sitting package is the package recall's job, not this one's");
  is((await cycles.table(cfg)).find((c) => c.key === "hydrafacial").days, 30, "a Hydrafacial is due again in 30 days by default");
  is((await cycles.setDays(cfg, { hydrafacial: 28, peel: 0 }, "Owner")).cycles.find((c) => c.key === "hydrafacial").days, 28, "which the owner can change");
  is((await cycles.due(cfg)).length, 0, "the day after the bill, nobody is due");
  NOW += 27 * DAY;
  let d = await cycles.due(cfg);
  is([d.length, d[0].key, d[0].phone], [1, "hydrafacial", "9876504010"], "twenty-seven days on, Lakshmi is due (two days early is in time)");
  is(/Hydrafacial last .*, next due /.test(await cycles.dueLine(cfg, "9876504010")), true, "and the agent's memory line says so if she writes first");
  h.sent.length = 0;
  const r1 = await cycles.run(cfg, 25);
  is([r1.due, r1.sent], [1, 1], "the recall goes");
  const msg = sentTo("9876504010", "btn")[0];
  is([/Lakshmi garu/.test(msg[2]), /last \*Hydrafacial\*/.test(msg[2]), msg[3].length], [true, true, 3], "by name, naming the treatment, with three taps");
  h.sent.length = 0;
  is((await cycles.run(cfg, 25)).sent, 0, "and not again tomorrow");
  is(JSON.parse(h.run(["LRANGE", "cyc:log", "0", "0"])[0]).key, "hydrafacial", "it is on the record for the weekly report");
  await h.call(money, { a: "bill" }, { a: "bill", phone: "9876504012", name: "Padma", items: [{ name: "Chemical peel", price: 2500 }] });
  NOW += 25 * DAY;
  is((await cycles.due(cfg)).some((x) => x.phone === "9876504012"), false, "a cycle the owner set to 0 never recalls");
  await h.call(money, { a: "bill" }, { a: "bill", phone: "9876504013", name: "Stop", items: [{ name: "HydraFacial", price: 3500 }] });
  h.run(["SADD", "optout", "9876504013"]);
  await h.call(money, { a: "bill" }, { a: "bill", phone: "9876504014", name: "Booked", items: [{ name: "HydraFacial", price: 3500 }] });
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876504014", name: "Booked", at: NOW + 40 * DAY })]);
  NOW += 29 * DAY;
  h.sent.length = 0;
  const r2 = await cycles.run(cfg, 25);
  is([r2.due >= 2, r2.skipped, r2.sent], [true, 2, 0], "somebody who said STOP, and somebody who already has a slot, are left alone");
  is((await h.call(followup, { key: "local-admin" })).body.cycled !== undefined, true, "the hourly cron carries it at 10:45");

  console.log("\n  — campaigns from the clinic's calendar —");
  const sep = camp.suggest(Date.UTC(2026, 8, 20));
  is(sep.map((s) => s.key).sort(), ["hairfall", "monsoon"], "September suggests monsoon fungal care (and the year-round hair-fall check-in)");
  is(camp.suggest(Date.UTC(2027, 0, 5)).map((s) => s.key).includes("sankranti"), true, "January suggests Sankranti");
  h.run(["DEL", "dl_leads"]);
  const lead = (ph, name, concern, daysAgo) => h.run(["RPUSH", "dl_leads", JSON.stringify({ ts: NOW - daysAgo * DAY, type: "whatsapp", phone: ph, name, concern })]);
  lead("9876504020", "Hair One", "Hair fall", 10); lead("9876504021", "Skin One", "Pigmentation", 20); lead("9876504022", "Fresh", "Acne", 2); lead("9876504023", "Stopped", "Hair fall", 15);
  h.run(["SADD", "optout", "9876504023"]);
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: "9876504030", name: "Came Twice", at: NOW - 30 * DAY, status: "done" })]);
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: "9876504031", name: "No Show", at: NOW - 30 * DAY, status: "noshow", ns: 1 })]);
  is((await camp.audience(cfg, "all")).map((t) => t.ph).sort(), ["9876504020", "9876504021", "9876504022"], "'everyone' is every opted-in number in the lead book");
  is((await camp.audience(cfg, "seg", "hair")).map((t) => t.ph), ["9876504020"], "a concern word narrows it");
  is((await camp.audience(cfg, "visited")).map((t) => t.ph), ["9876504030"], "'visited' is the people who actually came — a no-show is not one");
  is((await camp.audience(cfg, "cold")).map((t) => t.ph).sort(), ["9876504020", "9876504021"], "'cold' is 7–90 day enquiries that never booked — the two-day-old one is not cold yet");
  h.as(["msg.send", "settings.manage"], DESK);
  const pv = await h.call(campaignApi, {}, { a: "preview", aud: "all" });
  is([pv.code, pv.body.count, pv.body.rested], [200, 3, 0], "preview says how many would get it");
  h.run(["DEL", "bc:q"]);
  const sd = await h.call(campaignApi, {}, { a: "send", cid: "cid-monsoon-1", name: "Monsoon care", text: camp.SEASONS.find((s) => s.key === "monsoon").text, tpl: "seasonal_tips", aud: "all" });
  is([sd.code, sd.body.queued, sd.body.minutes], [200, 3, 10], "sending queues it — three people, spaced by the ten-minute drain");
  is(h.run(["LLEN", "bc:q"]), 3, "into the same queue the owner's broadcasts use");
  is((await h.call(campaignApi, {}, { a: "send", cid: "cid-monsoon-1", name: "Monsoon care", text: "x".repeat(20), aud: "all" })).body.dup, true, "sending the same form twice does not queue it twice");
  is((await h.call(campaignApi, {}, { a: "preview", aud: "all" })).body, { ok: true, count: 0, rested: 3, sample: [] }, "the same people cannot be marketed to again for a fortnight");
  is((await h.call(campaignApi, {}, { a: "send", cid: "cid-again-002", name: "Again", text: "x".repeat(20), aud: "all" })).code, 400, "so a second campaign to them today is refused, not silently empty");
  h.sent.length = 0;
  const dr = await h.call(post, { key: "local-admin" });
  is(dr.body.bsent, 3, "the drain sends them as the seasonal_tips template");
  is(sentTo("9876504020", "tpl")[0][2], "seasonal_tips", "");
  const id = sd.body.id;
  is(Number(h.run(["GET", `cmp:stat:${id}`])), 3, "and counts them against the campaign");
  // one replied, one booked after it
  const IB = require(path.join(API, "_inbox.js"));
  NOW += 60000;
  await IB.log(cfg, "9876504020", { dir: "in", text: "Hair fall ki slot kavali" });
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876504020", name: "Hair One", at: NOW + 2 * DAY })]);
  const ls = await h.call(campaignApi, { a: "list" });
  is([ls.body.campaigns[0].sent, ls.body.campaigns[0].replied, ls.body.campaigns[0].booked], [3, 1, 1], "the campaigns screen says: 3 went, 1 wrote back, 1 fixed a slot");
  h.as(["msg.send"], DESK);
  is((await h.call(campaignApi, {}, { a: "send", cid: "cid-third-003", name: "x", text: "x".repeat(20), aud: "visited" })).code, 403, "somebody who may message but not run the settings cannot spend on a campaign");
  h.as(["leads.view"], DESK);
  is((await h.call(campaignApi, { a: "list" })).code, 403, "and without msg.send, no campaigns screen at all");

  console.log("\n  — the services button is a menu —");
  cloudOut.length = 0; claude.length = 0;
  let calls = 0; const realFetch = global.fetch;
  global.fetch = async (u, o) => { if (String(u).includes("anthropic")) calls++; return realFetch(u, o); };
  await say("9876504040", "💆 Services");
  is(calls, 0, "tapping Services needs no model turn");
  const menu = cloudOut.find((m) => m.interactive && m.interactive.type === "list");
  is([!!menu, menu && menu.interactive.action.sections.length, menu && menu.interactive.action.sections.reduce((n, s) => n + s.rows.length, 0)], [true, 3, 10], "a list of ten treatments in three sections goes out");
  is(menu.interactive.action.sections[0].rows.some((r) => /₹/.test(r.description)), false, "with no prices while the policy is none");
  await prices.save(cfg, { mode: "bands", consult: 500, bands: [{ name: "Hydrafacial", from: 3000, to: 4500 }] }, "Owner");
  cloudOut.length = 0;
  await say("9876504040", "menu");
  const menu2 = cloudOut.find((m) => m.interactive && m.interactive.type === "list");
  is(menu2.interactive.action.sections[0].rows.find((r) => r.title === "Hydrafacial").description.startsWith("₹3,000+ · "), true, "and the owner's 'starts from' on the row once the policy allows it");
  claude.push({ reply: "💧 *Hydrafacial* — 3-step machine facial…\n\nRepu evening slot pettamanta?", lead: null });
  await say("9876504040", "Hydrafacial");
  is(calls, 1, "a tapped row is answered by the agent, in explain mode");
  is(JSON.parse(h.run(["GET", "wa:h:9876504040"])).length >= 2, true, "and the menu is in the conversation's memory");

  console.log("\n  — the control panel —");
  delete require.cache[path.join(API, "staff.js")];
  const staffReal = require(path.join(API, "staff.js"));
  const crypto = require("crypto");
  const payload = Buffer.from(JSON.stringify({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: NOW + 3600000 })).toString("base64url");
  const bearer = { headers: { authorization: "Bearer " + payload + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(payload).digest("hex") } };
  const pnl = (await h.call(staffReal, { a: "panel" }, null, bearer)).body;
  is([pnl.prices.mode, pnl.cycles.find((c) => c.key === "hydrafacial").days], ["bands", 28], "the panel shows the price policy and the cycle days");
  const set = await h.call(staffReal, { a: "cycles-set" }, { a: "cycles-set", days: { hydrafacial: 30 } }, bearer);
  is(set.body.cycles.find((c) => c.key === "hydrafacial").days, 30, "and they can be changed from it");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nstage 2 behaves");
  process.exit(fails ? 1 : 0);
})();
