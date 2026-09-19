// The owner's tools: the AI Office, the Insights numbers, and the one-off
// database move.
//
// The AI Office reads the clinic's live data and hands it to the model, so
// what it reads must be cut to the colleague's role before the model ever
// sees it — a receptionist's assistant must not know the academy's fees
// owed. Insights is cached for ten minutes, and the money in it is for
// people who may see money; a cache is exactly where that goes wrong. The
// database move must refuse to run backwards once the switch is thrown.
const path = require("path");
const crypto = require("crypto");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

// A staff module with the fields the AI Office reads, driven by who we are.
let CAPS = ["*"], ME = { name: "Owner", phone: "9010427777", role: "owner" };
const sp = path.join(API, "staff.js");
require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: {
  requireStaff: async () => ({ ok: true, me: ME, caps: CAPS, roles: { owner: { label: "Owner" }, reception: { label: "Reception" } },
    allow: (c) => CAPS.includes("*") || CAPS.includes(c) }),
  capsOf: () => CAPS,
} };
const as = (caps, me) => { CAPS = caps; if (me) ME = me; };
const bearer = (me) => {
  const payload = Buffer.from(JSON.stringify({ p: me.phone, n: me.name, r: me.role, exp: Date.now() + 3600000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.STAFF_SECRET).update(payload).digest("hex");
  return { headers: { authorization: `Bearer ${payload}.${sig}` } };
};

let lastSystem = "", modelSays = "";
global.fetch = async (url, opt) => {
  if (String(url).includes("api.anthropic.com")) {
    lastSystem = JSON.parse(opt.body).system;
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: modelSays }] }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
process.env.ANTHROPIC_API_KEY = "test";

const office = h.load("office"), insights = h.load("insights"), kvmove = h.load("kvmove");
const DESK = { name: "Sowmya", phone: "9876500501", role: "reception" };

(async () => {
  console.log("THE OWNER'S TOOLS\n");

  // a little of everything, so there is something to leak
  const now = Date.now();
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: now - 3600000, name: "Hot Lead", phone: "9876500510", heat: "hot", type: "whatsapp", concern: "PICO" })]);
  h.run(["SET", "acad:st:DLA-0001", JSON.stringify({ id: "DLA-0001", name: "Student One", phone: "9876500511", fee: 49999, paid: 9999, course: "skin", status: "active" })]);
  h.run(["RPUSH", "acad:st:list", "DLA-0001"]);

  console.log("  — the AI Office sees only what the colleague may —");
  is((await h.call(office, {}, { q: "hi" })).code, 401, "no login, no assistant");
  as(["ai.use", "leads.view", "leads.edit"], DESK);
  modelSays = "Call Hot Lead first.\n<actions>[{\"type\":\"status\",\"key\":\"x|9876500510\",\"status\":\"contacted\",\"why\":\"hot\"},{\"type\":\"message\",\"phone\":\"9876500510\",\"text\":\"Hello there\",\"why\":\"x\"},{\"type\":\"status\",\"key\":\"y\",\"status\":\"paid\"}]</actions>";
  const o = await h.call(office, {}, { q: "what now?" }, bearer(DESK));
  is(o.code, 200, "a receptionist can ask");
  is(lastSystem.includes("Hot Lead"), true, "the model sees the leads they work");
  is([lastSystem.includes("Student One"), lastSystem.includes("49,999") && lastSystem.includes("paid ₹")], [false, false], "but not the academy's students or what they owe");
  is(o.body.reply, "Call Hot Lead first.", "the proposal block is taken out of the answer they read");
  is(o.body.actions.map((a) => a.type), ["status"], "only the proposals they may approve reach them — no message (no msg.send), no made-up status");
  as(["leads.view"], DESK);
  is((await h.call(office, {}, { q: "hi" }, bearer(DESK))).code, 403, "without ai.use, no assistant");
  as(["*"], { name: "Owner", phone: "9010427777", role: "owner" });
  await h.call(office, {}, { q: "academy?" }, bearer(ME));
  is(lastSystem.includes("Student One"), true, "the owner's assistant sees the academy");
  const split = office.splitActions('ok <actions>[{"type":"book","phone":"9876500510","at":1}]</actions>', ["*"]);
  is(split.actions, [], "a booking proposed for a time already past is dropped");

  console.log("\n  — Insights —");
  const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  h.run(["SET", "bill:b1", JSON.stringify({ id: "b1", ts: now - 7200000, phone: "9876500510", items: [{ name: "PICO", price: 8000, qty: 1 }], payments: [{ ts: now - 7000000, amount: 5000, mode: "upi" }] })]);
  h.run(["RPUSH", `bill:day:${istDay(now)}`, "b1"]);
  h.run(["RPUSH", "bill:open", "b1"]);
  const full = await h.call(insights, { days: "30" });
  is([full.body.money.collected, full.body.money.outstanding, full.body.money.byMode.upi], [5000, 3000, 5000], "the owner sees what came in and what is still owed");
  is(full.body.sources.find((s) => s.src === "whatsapp").revenue, 5000, "credited to the channel that first brought the patient");
  as(["reports.view"], DESK);
  const cut = await h.call(insights, { days: "30" });
  is(cut.body.cached, true, "a colleague opening it within ten minutes gets the saved copy");
  is([cut.body.money.collected, cut.body.money.outstanding, cut.body.sources[0].revenue, cut.body.treatments[0].value], [null, null, null, null], "but without money.view, the saved copy has no money in it either");
  const cut2 = await h.call(insights, { days: "30", fresh: "1" });
  is(cut2.body.money.collected, null, "nor a fresh one");
  as(["*"], { name: "Owner", phone: "9010427777", role: "owner" });
  is((await h.call(insights, { days: "30" })).body.money.collected, 5000, "and the owner still sees it after them");
  as(["leads.view"], DESK);
  is((await h.call(insights, {})).code, 403, "without reports.view, no Insights at all");

  console.log("\n  — the database move —");
  as(["*"], { name: "Owner", phone: "9010427777", role: "owner" });
  process.env.KV_REST_API_URL = "https://redis.test"; process.env.KV_REST_API_TOKEN = "r";
  process.env.SUPABASE_URL = "https://pg.test"; process.env.SUPABASE_SERVICE_KEY = "p";
  const G = require(path.join(API, "_guard.js"));
  const realPipe = G.kvPipeline, written = [];
  G.kvPipeline = async (cfg, cmds) => (cfg && cfg.url === "https://pg.test") ? (written.push(...cmds), cmds.map((c) => (c[0] === "DBSIZE" ? 0 : "OK"))) : cmds.map(h.run);
  h.run(["SET", "otp:wa:9876500520", "{}", "EX", "40"]);
  as(["leads.view"], DESK);
  is((await h.call(kvmove, {}, { a: "copy" })).code, 403, "only the owner can move the database");
  as(["*"], { name: "Owner", phone: "9010427777", role: "owner" });
  const st = await h.call(kvmove, { a: "status" });
  is([st.code, st.body.from > 0, st.body.to], [200, true, 0], "the status says how many keys each side holds");
  const cp = await h.call(kvmove, {}, { a: "copy" });
  is(cp.body.done, true, "a copy runs to the end");
  const otp = written.filter((c) => c[1] === "otp:wa:9876500520");
  is([otp[0][0], otp[1][0], otp[2][0]], ["DEL", "SET", "PEXPIRE"], "each key is written fresh, and keeps its remaining life");
  is(Number(otp[2][2]) > 30000 && Number(otp[2][2]) <= 40000, true, "an OTP with forty seconds left still has about forty seconds");
  is(written.some((c) => c[1] === "dl_leads" && c[0] === "RPUSH"), true, "lists come across in order");
  process.env.KV_PRIMARY = "supabase";
  const back = await h.call(kvmove, {}, { a: "copy" });
  is(back.code, 409, "once the clinic runs on the new database, copying the old one over it is refused");
  is((await h.call(kvmove, { a: "status" })).code, 200, "though the status can still be read");
  delete process.env.KV_PRIMARY;
  G.kvPipeline = realPipe;

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe owner's tools behave");
  process.exit(fails ? 1 : 0);
})();
