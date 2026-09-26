// The whole staff app, for real, on this machine — no keys, no network.
//
// tools/mock-staff-server.js shows staff.html over invented JSON; it is good
// for layout and useless for finding a screen that calls an action the
// server no longer has. This serves the real api/*.js handlers over the test
// harness's in-memory store, with WhatsApp/push/the model stubbed the way
// the behaviour tests stub them, and seeds a clinic day: patients who wrote
// on WhatsApp, one who booked, a bill, a package, a colleague on the desk.
// Every tab, every button, every action then goes through the code that
// runs on Vercel.
//
//   node tools/dev/real-app.js          → http://localhost:4600/staff.html
//   GET /dev/token                      → an owner session for localStorage
//   GET /dev/sent                       → every WhatsApp/push the app "sent"
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..", "..");
const API = path.join(ROOT, "api");
process.env.DL_API = API;
Object.assign(process.env, {
  ADMIN_PHONES: "9010427777", LEAD_NOTIFY_PHONES: "9989325777",
  WA_WEBHOOK_TOKEN: "hook", WA_CLOUD_TOKEN: "cloud", WA_PHONE_ID_ALLOWLIST: "111",
  WA_AGENT_ENABLED: "1", ANTHROPIC_API_KEY: "test", UPI_VPA: "dermaluxe@upi", PUBLIC_BASE: "http://localhost:4600",
  META_ADS_TOKEN: "dev", META_AD_ACCOUNT_ID: "4527414787474363", IG_LOGIN_TOKEN: "dev", IG_PAGE_ID: "1312992278555449",
});
const h = require(path.join(ROOT, "tools", "tests", "harness.js"));
delete require.cache[path.join(API, "staff.js")];          // the real one, with real sessions

// The model: a plausible receptionist. A message with a time in it books.
let turn = 0;
global.fetch = async (url, opt) => {
  const u = String(url);
  // The planner's own answer, so the AI campaign draft can be looked at
  // without a key. It is recognisable by its system prompt.
  if (u.includes("api.anthropic.com") && /You plan Meta \(Instagram \+ Facebook\) ad campaigns/.test(String((opt && opt.body) || ""))) {
    const plan = { name: "Juttu raalatam — Eluru 30km", why: "Gata 60 rojullo ekkuva mandi juttu raalatam gurinchi ne raasaru, andulo chaala mandi Eluru nunchi. Andhuke ade oka campaign ga.",
      concern: "hair fall", radius_km: 30, age_min: 24, age_max: 50, genders: "all",
      interests: ["Skin care", "Hair care", "Trichology"], rupees: 1500, days: 5,
      headline: "Juttu raalutunda?",
      body: "Juttu raalatam chaala mandi ki vastundi — kaani kaaranam okkokkariki okkoti.\nMana MD dermatologists mee scalp chusi, mee ki e treatment saripotundo cheptaru.\nPRP, GFC, laser — anni okey chota.\nMee concern ikkade WhatsApp lo cheppandi 😊" };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(plan) }] }) };
  }
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opt.body);
    if (/You fix one WhatsApp reply/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: body.messages[0].content.split("\n")[1] || "ok" }] }) };
    if (/quality reviewer/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ score: 78, summary: "Baagundi · okka chat lo price adigaaru · slot mundu adagali", findings: [{ phone: "3002", who: "Ravi", severity: "medium", issue: "price adigithe slot adagaledu", fix: "consultation ani cheppi slot adugu" }] }) }] }) };
    if (/grade ONE simulated/.test(body.system)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ score: 84, booked: true, trap_passed: true, facts: {}, faults: [], note: "baaga close chesindi" }) }] }) };
    if (/haiku/.test(body.model)) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: (turn++ % 3 === 2) ? "[END]" : "Hair fall 6 nelala nundi, Eluru, repu evening ok" }] }) };
    // The patient's own words: everything the app adds rides in [brackets]
    // before them, and matching a time inside that context booked every chat.
    const last = String(body.messages[body.messages.length - 1].content).replace(/\[[^\]]*\]\s*/g, "");
    const wantsSlot = /(\d{1,2}(:\d{2})?\s*(am|pm))\b|\brepu\b|\bivala\b|saturday/i.test(last);
    const reply = wantsSlot
      ? { reply: "Super 🙏 repu 6:30 PM ki book chesanu ✅\n\n📍 Rama Mahal, Kasturi Vari Street, Eluru\n\nEmaina doubts unte ikkade adagandi 😊", lead: { name: "Lakshmi", concern: "Hair fall", slot: "Repu 6:30 PM", slot_ts: (() => { const d = new Date(Date.now() + 86400000 + 330 * 60000); return d.toISOString().slice(0, 10) + " 18:30"; })(), heat: "hot", call_prep: "Hair fall 6 nelalu, PRP interest" }, qual: { intent: "book_now", problem: "hair fall", village: "Eluru", problem_since: "6 nelalu" } }
      : { reply: "Namaste 🙏 Hair fall ki manam baga help cheyagalam.\n\n🌿 Mild shampoo week ki 2-3 sarlu\n💧 Roju 3L neellu\n\nEntakalam nundi undi andi?", lead: null, buttons: ["6 nelala lopu", "1 year+", "Chala kalam"], qual: { problem: "hair fall" } };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(reply) }] }) };
  }
  // Meta's Graph API, answering the way the clinic's WABA would: some
  // templates approved, one waiting, one refused. DL_FAKE_META=0 turns it off.
  if (u.includes("graph.facebook.com") && u.includes("message_templates") && (!opt || opt.method !== "POST")) {
    const src = require("fs").readFileSync(require("path").join(ROOT, "api", "wa-setup.js"), "utf8");
    const names = [...src.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]);
    const data = names.map((name, i) => ({
      name, id: String(1000 + i), category: /offer|update|tips|camp|miss|wish/.test(name) ? "MARKETING" : "UTILITY",
      status: i === 2 ? "PENDING" : i === 5 ? "REJECTED" : "APPROVED",
      rejected_reason: i === 5 ? "INVALID_FORMAT" : "NONE",
    })).slice(0, process.env.DL_META_MISSING ? -3 : undefined);
    return { ok: true, status: 200, json: async () => ({ data }) };
  }
  // The ad account, answering the way a real one with eight campaigns would —
  // one expensive, one dead, one cheap and starved — so the Ads screen and its
  // suggestions can be looked at without a token or a rupee.
  if (u.includes("graph.facebook.com") && /\/act_\d+\/insights/.test(u)) {
    if (u.includes("date_preset=today")) return { ok: true, status: 200, json: async () => ({ data: [{ spend: "412", impressions: "9431" }] }) };
    return { ok: true, status: 200, json: async () => ({ data: [{ spend: "11840", impressions: "486233", reach: "92104",
      actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: "168" }] }] }) };
  }
  // The ad list carries each campaign's picture and the post behind it.
  if (u.includes("graph.facebook.com") && /\/act_\d+\/ads/.test(u)) {
    return { ok: true, status: 200, json: async () => ({ data: [
      { id: "ad1", campaign_id: "120111", creative: { thumbnail_url: "https://www.dermaluxe.ai/assets/academy/batch1-poster.jpg", effective_object_story_id: "1312992278555449_111" } },
      { id: "ad2", campaign_id: "120222", creative: { thumbnail_url: "https://www.dermaluxe.ai/assets/academy/batch1-story.jpg", effective_object_story_id: "1312992278555449_222" } },
    ] }) };
  }
  // Creating things on the ad account, so the planner's Build and the promote
  // buttons can be pressed here without a token or a rupee.
  if (u.includes("graph.facebook.com") && opt && opt.method === "POST" && /\/act_\d+\/(campaigns|adsets|adcreatives|ads|adimages)/.test(u)) {
    if (/adimages/.test(u)) return { ok: true, status: 200, json: async () => ({ images: { bytes: { hash: "DEVHASH" } } }) };
    return { ok: true, status: 200, json: async () => ({ id: "dev" + Math.floor(Math.random() * 1e9) }) };
  }
  // Meta's targeting vocabulary, so the planner's interest search answers.
  if (u.includes("graph.facebook.com") && u.includes("/search")) {
    // URLSearchParams writes a space as "+", and decodeURIComponent does not
    // turn that back — matching on the raw value finds nothing.
    const q = decodeURIComponent(String((u.match(/[?&]q=([^&]*)/) || [, ""])[1] || "").replace(/\+/g, " ")).toLowerCase();
    const all = [
      { id: "6003107902433", name: "Skin care", audience_size_upper_bound: 912000000, path: ["Interests", "Beauty"] },
      { id: "6003139266461", name: "Beauty", audience_size_upper_bound: 845000000, path: ["Interests"] },
      { id: "6003212469satisfy", name: "Hair care", audience_size_upper_bound: 640000000, path: ["Interests", "Beauty"] },
      { id: "6002974590168", name: "Cosmetics", audience_size_upper_bound: 520000000, path: ["Interests", "Beauty"] },
      { id: "6003295306173", name: "Physical fitness", audience_size_upper_bound: 700000000, path: ["Interests"] },
    ];
    return { ok: true, status: 200, json: async () => ({ data: q ? all.filter((x) => x.name.toLowerCase().includes(q)) : all }) };
  }
  // Instagram's own media, so the "promote what already worked" strip has
  // something to work with: one post far above the month's average reach.
  if (u.includes("graph.instagram.com") && u.includes("/me/media")) {
    const day = 86400000, now = Date.now();
    const m = (i, reach, cap) => ({ id: "ig" + i, caption: cap, media_type: "IMAGE",
      media_url: "https://www.dermaluxe.ai/assets/academy/batch1-poster.jpg",
      permalink: "https://www.instagram.com/p/x" + i + "/",
      timestamp: new Date(now - i * 2 * day).toISOString(),
      insights: { data: [{ name: "reach", values: [{ value: reach }] }] } });
    return { ok: true, status: 200, json: async () => ({ data: [
      m(1, 41200, "Beauty therapist kaavaala? — Academy Batch 1"),
      m(2, 980, "Hydrafacial roju"), m(3, 760, "PRP hair therapy"),
      m(4, 1120, "Pigmentation ki PICO"), m(5, 640, "Doctor evaru"),
    ] }) };
  }
  if (u.includes("graph.facebook.com") && /\/act_\d+\/campaigns/.test(u)) {
    const ins = (spend, reach, conv) => ({ data: [{ spend: String(spend), reach: String(reach), impressions: String(reach * 4),
      actions: [{ action_type: "onsite_conversion.messaging_conversation_started", value: String(conv) }] }] });
    const made = (d) => new Date(Date.now() - d * 86400000).toISOString();
    return { ok: true, status: 200, json: async () => ({ data: [
      { id: "120111", name: "DermaLuxe Academy · Batch 1 · launch offer", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", created_time: made(18), daily_budget: "30000", insights: ins(5400, 41200, 96) },
      { id: "120222", name: "Laser hair removal — Eluru 30km", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", created_time: made(12), daily_budget: "60000", insights: ins(4100, 29800, 8) },
      { id: "120333", name: "Daily poster 2026-09-24 · review", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", created_time: made(2), lifetime_budget: "30000", insights: ins(2340, 21100, 0) },
      { id: "120444", name: "Daily poster 2026-09-21 · hair-fall", status: "PAUSED", effective_status: "PAUSED", objective: "OUTCOME_ENGAGEMENT", created_time: made(5), lifetime_budget: "30000", insights: ins(300, 2400, 4) },
    ] }) };
  }
  if (u.includes("graph.facebook.com") && u.includes("/me/adaccounts")) {
    return { ok: true, status: 200, json: async () => ({ data: [{ account_id: "4527414787474363", name: "DermaLuxe by Medicare — Eluru", account_status: 1, currency: "INR" }] }) };
  }
  if (u.includes("graph.facebook.com") && /\/act_\d+$/.test(u.split("?")[0])) {
    return { ok: true, status: 200, json: async () => ({ name: "DermaLuxe by Medicare — Eluru", currency: "INR", account_status: 1,
      amount_spent: "1184000", spend_cap: "1500000" }) };
  }
  if (u.includes("graph.facebook.com") && /\d{6,}$/.test(u.split("?")[0])) {
    return { ok: true, status: 200, json: async () => ({ name: "DermaLuxe by Medicare", account_review_status: "APPROVED" }) };
  }
  // arrayBuffer too: anything that fetches a picture (the promote and plan
  // paths upload one to Meta) otherwise dies on a stub that only speaks JSON.
  return { ok: true, status: 200, json: async () => ({ data: [], id: "x" }), text: async () => "",
    arrayBuffer: async () => new TextEncoder().encode("dev-image-bytes").buffer };
};

const load = (n) => require(path.join(API, n + ".js"));
const call = (mod, req) => new Promise((resolve) => {
  const res = { _c: 200, _h: {}, statusCode: 200, setHeader(k, v) { this._h[k] = v; }, getHeader(k) { return this._h[k]; },
    status(c) { this._c = c; this.statusCode = c; return this; },
    json(o) { resolve({ code: this._c, body: o, headers: this._h }); return this; },
    send(x) { resolve({ code: this._c, bin: x, headers: this._h }); return this; },
    write() { return true; }, end(x) { resolve({ code: this._c, bin: x, headers: this._h }); return this; } };
  Promise.resolve(mod(req, res)).catch((e) => resolve({ code: 500, body: { error: String(e && e.stack || e) } }));
});
const token = () => {
  const payload = Buffer.from(JSON.stringify({ p: "9010427777", n: "Nagaraju", r: "owner", e: 0, exp: Date.now() + 30 * 86400000 })).toString("base64url");
  return payload + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(payload).digest("hex");
};

// ---- a clinic day ----------------------------------------------------------
let mid = 0;
const wa = load("whatsapp");
const say = (from, text, name, extra) => call(wa, { method: "POST", headers: { host: "localhost:4600" }, query: { token: "hook" }, body: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "111" }, contacts: [{ profile: { name: name || "Patient" } }],
  messages: [Object.assign({ id: "seed" + (++mid), from: "91" + from, type: "text", text: { body: text } }, extra || {})] } }] }] } });
async function seed() {
  const user = (ph, name, role) => h.run(["HSET", "staff:users", ph, JSON.stringify({ name, role, added: Date.now() })]);
  user("9876500901", "Sowmya", "reception"); user("9876500902", "Dr. Nikhitha", "doctor"); user("9876500903", "Anitha", "accounts");
  await say("9876503001", "Hair fall chala undi, entha avutundi?", "Lakshmi");
  await say("9876503001", "6 nelala nundi, Eluru", "Lakshmi");
  await say("9876503001", "Repu 6:30 PM ok", "Lakshmi");
  await say("9876503002", "Acne scars ki treatment undha? cost?", "Ravi");
  await say("9876503003", "Hello! Can I get more info on this?", "Priya", { referral: { source_type: "ad", source_id: "ad77", headline: "Hair fall? PRP therapy at DermaLuxe" } });
  await say("9876503004", "Doctor evaru andi? results vastaya?", "Kiran");
  await say("9876503005", "amma ki kuda, iddaram vastam Saturday", "Nagamani");
  // An opener test partway through, so the Ads screen's comparison can be
  // looked at without waiting a fortnight for real leads.
  h.run(["SET", "ab:cfg", JSON.stringify({ on: true,
    a: { label: "Paata opener", text: "Namaste 🙏 DermaLuxe nunchi — em problem tho ibbandi padutunnaru?" },
    b: { label: "Kotha opener", text: "Namaste 🙏 Mee concern cheppandi — MD doctor tho modati matlaata free." },
    by: "Owner", ts: Date.now() - 14 * 86400000 })]);
  [["a", 516, 268, 50], ["b", 1825, 985, 228]].forEach(function (r) {
    h.run(["SET", "ab:" + r[0] + ":leads", String(r[1])]);
    h.run(["SET", "ab:" + r[0] + ":reply", String(r[2])]);
    h.run(["SET", "ab:" + r[0] + ":booked", String(r[3])]);
  });
  // Two alerts already on the owner's phone — one of which WhatsApp refused,
  // because that is the row the feed exists to be honest about.
  [["Instagram post: Gachyanthram leka.... 😅", "₹569 kharchu, okka WhatsApp chat ledu. Aapandi.", false, 3],
   ["Laser hair removal — Eluru 30km", "okko chat ₹513 — lakshyam ₹300. Chala kharidu, chudandi.", true, 26]
  ].forEach(function (a) {
    h.run(["RPUSH", "ads:alerts", JSON.stringify({ ts: Date.now() - a[3] * 3600000, kind: "nochat", id: "c", name: a[0], text: a[1], sent: a[2] })]);
  });
  const staff = load("staff"), money = load("money"), pkg = load("package"), sch = load("schedule"), inbox = load("inbox"), stock = load("stock");
  const auth = { authorization: "Bearer " + token() };
  const post = (mod, a, body) => call(mod, { method: "POST", headers: auth, query: { a }, body: Object.assign({ a, cid: "seed-" + a + "-" + (++mid) + "-xxxx" }, body) });
  await post(money, "bill", { phone: "9876503001", name: "Lakshmi", items: [{ name: "Consultation", price: 500 }, { name: "PRP — hair", price: 5000 }], paid: 2000, mode: "upi" });
  await post(money, "bill", { phone: "9876503006", name: "Bhavani", items: [{ name: "HydraFacial", price: 3500 }], paid: 3500, mode: "cash" });
  h.run(["LPUSH", "appt:done", JSON.stringify({ ph: "9876503006", name: "Bhavani", at: Date.now() - 32 * 86400000, concern: "HydraFacial", status: "done", staffName: "Dr. Nikhitha" })]);
  await post(sch, "create", { ph: "9876503007", name: "Suresh", at: Date.now() + 2 * 3600000, concern: "Pigmentation", mins: 30 });
  h.run(["LPUSH", "appt:q", JSON.stringify({ ph: "9876503008", name: "Late One", at: Date.now() - 40 * 60000, concern: "Acne" })]);
  await post(inbox, "takeover", { phone: "9876503002" });
  await post(staff, "rule-add", { text: "Ee nela laser offer cheppaku" });
  await post(staff, "prices-set", { mode: "consult", consult: 500 });
  await call(load("cron-followup"), { method: "GET", headers: {}, query: { key: "local-admin" }, body: {} });
  await call(load("cron-post"), { method: "GET", headers: {}, query: { key: "local-admin" }, body: {} });
  await require(path.join(API, "_review.js")).run({ kind: "pg" }).catch(() => {});
  await require(path.join(API, "_exam.js")).run({ kind: "pg" }, { ids: ["p01"], turns: 3 }).catch(() => {});
}

// ---- the server ------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".pdf": "application/pdf", ".apk": "application/octet-stream" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/dev/token") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ token: token() })); }
  if (u.pathname === "/dev/sent") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(h.sent.slice(-50))); }
  if (u.pathname.startsWith("/api/")) {
    const name = u.pathname.slice(5).replace(/\.js$/, "");
    let mod; try { mod = load(name); } catch (e) { res.writeHead(404); return res.end("no such api: " + name); }
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; }
    const query = {}; u.searchParams.forEach((v, k) => { query[k] = v; });
    const out = await call(mod, { method: req.method, headers: Object.assign({ host: "localhost:4600" }, req.headers), query, body, url: req.url, rawBody: raw });
    const headers = Object.assign({ "Content-Type": "application/json; charset=utf-8" }, out.headers || {});
    res.writeHead(out.code || 200, headers);
    if (out.body !== undefined) return res.end(JSON.stringify(out.body));
    return res.end(out.bin == null ? "" : out.bin);
  }
  let file = path.join(ROOT, decodeURIComponent(u.pathname === "/" ? "/staff.html" : u.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
seed().then(() => {
  server.listen(Number(process.env.PORT || 4600), () => console.log("real app on http://localhost:" + (process.env.PORT || 4600) + "/staff.html  (token: /dev/token)"));
}).catch((e) => { console.error("seed failed", e); process.exit(1); });
