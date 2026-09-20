// A stand-in for the staff API, for looking at staff.html without a login.
//
// The dashboard can only be opened by a real staff member with a real session,
// which makes the one thing we most need to look at — the screen itself — the
// hardest thing to reach. This serves the real staff.html against invented
// data so layout, paging and rendering can be checked locally. It is a
// development tool: it never runs on Vercel and it holds no real records.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 4599);
const TOTAL = Number(process.env.LEADS || 640);
const PAGE = 200;

const CONCERNS = ["acne treatment", "hair fall", "pigmentation", "laser hair removal", "anti-ageing", "academy skin course"];
const NAMES = ["Sita", "Ravi", "Latha", "Anil", "Meena", "Kiran", "Padma", "Suresh"];
const leads = [];
for (let i = 0; i < TOTAL; i++) {
  const ts = Date.now() - i * 2.5 * 3600000;
  const phone = "98" + String(76543210 + i).slice(-8);
  leads.push({
    ts, phone, name: NAMES[i % NAMES.length] + " " + (i + 1),
    concern: CONCERNS[i % CONCERNS.length],
    message: "Patient enquiry text that used to travel in full on every refresh. ".repeat(6),
    call_prep: i % 3 === 0 ? "Ask about previous treatments and any medication. ".repeat(4) : "",
    heat: i % 5 === 0 ? "hot" : i % 3 === 0 ? "warm" : "",
    type: ["whatsapp", "instagram", "web", "messenger"][i % 4],
    key: `${ts}|${phone}`,
    grade: ["A", "B", "C", "D", "B"][i % 5], score: [82, 58, 33, 12, 51][i % 5],
    village: ["Eluru", "Bhimavaram", "Vijayawada", "Hyderabad", "Tadepalligudem"][i % 5], km: [0, 60, 60, 330, 35][i % 5],
    since: i % 3 ? "6 nelalu" : "", prefers: i % 5 === 0 ? "Saturday evening" : "",
    why: [["Eluru — 0 km, daggare", "raavadaniki ready", "entakalam nundo chepparu: 6 nelalu"], ["Bhimavaram — 60 km", "alochistunnaru"], ["price matrame adigaru"], ["patient kaadu (job / sales / wrong number)"], ["ee vaaram lo"]][i % 5],
    intent: ["book_now", "considering", "price_only", "not_patient", "considering"][i % 5],
    next: [{ kind: "call", text: "Ippude call cheyandi 🔥" }, { kind: "ask", text: "Adagandi: eppudu raagalaru?" }, { kind: "video", text: "330 km — video consultation offer cheyandi" }, { kind: "skip", text: "Patient kaadu — vadileyandi" }, { kind: "book", text: "Slot pettandi — Saturday evening" }][i % 5],
    waiting: [42 * 60000, 5 * 3600000, 12 * 60000, 0, 26 * 3600000][i % 5],
    status: ["new", "contacted", "booked", "visited", "closed"][i % 5],
    notes: i % 4 === 0 ? [{ ts: ts + 600000, by: "Reception", text: "Called, asked to ring back" }] : [],
  });
}
const trim = (l) => Object.assign({}, l, {
  message: l.message.length > 300 ? l.message.slice(0, 300) + "…" : l.message,
  call_prep: l.call_prep.length > 200 ? l.call_prep.slice(0, 200) + "…" : l.call_prep,
});

const mockTpl = require("../api/consent.js").DRAFTS.map((t) => Object.assign({}, t, { version: 1, approved: null }));
const progressOf = (() => {
  // the real one, read straight out of api/academy.js so it cannot drift
  const src = fs.readFileSync(path.join(ROOT, "api", "academy.js"), "utf8");
  const m = src.match(/function progressOf\(s\) \{[\s\S]*?\n\}/);
  return eval("(" + m[0] + ")");
})();
const mockRef = { code: "DL5310", count: 2, unrewarded: 1, cameFrom: "", rows: [
  { phone: "9876500061", name: "Sita Rani", ts: Date.now() - 4 * 86400000, rewarded: null },
  { phone: "9876500062", name: "Ravi Kumar", ts: Date.now() - 20 * 86400000, rewarded: { ts: Date.now() - 19 * 86400000, by: "Sowmya", what: "20% off" } },
] };
const mockPvSet = { doctor: "auto", academy: "auto" };
const mockPv = [
  { id: "a1b2c3d4e5f60718", imgId: "pvseed1", topic: "hydrafacial", pillar: "tx", h1: "Hydrafacial glow in 30 minutes", te: "హైడ్రాఫేషియల్ — వెంటనే గ్లో", look: "macro", doctor: "Dr. Nikhitha Priyanka", hadImage: true, status: "posted", link: "https://instagram.com/p/x", by: "Owner", at: Date.now() - 86400000, postedAt: Date.now() - 80000000, caption: "Hydrafacial glow in 30 minutes\nCleanse · Exfoliate · Hydrate" },
];
const mockPostQ = [{ imgId: "q0", caption: "Repu podduna — laser hair removal offer", due: Date.now() + 5 * 3600000, kind: "post", tries: 0, by: "Owner" }];
const mockCns = [];
const mockStage = { stage: "", stageAt: 0, stageBy: "", stageNote: "", stageLog: [] };
// Pretend the hospital bridge is configured and two leads did not get through.
const mockHms = { ok: true, connected: true, host: "clinic.medicare-hms.in", tenant: "dlx-eluru", hasKey: true,
  portalUrl: "", bookingUrl: "", missing: [], waiting: 2, oldest: Date.now() - 5 * 3600000,
  sample: [{ name: "Ravi Kumar", phone: "0045", ts: Date.now() - 5 * 3600000 }, { name: "Sita", phone: "0061", ts: Date.now() - 2 * 3600000 }], last: null };
const CAPS = ["leads.view", "leads.edit", "appts.view", "appts.edit", "academy.view", "academy.edit",
  "posts.view", "reviews.view", "reports.view", "money.view", "money.bill", "money.expense", "stock.view", "stock.edit", "attend.manage", "consent.take", "pkg.log", "ai.use", "msg.send", "team.manage", "settings.manage"];

function page(offset) {
  const from = Math.max(0, offset | 0);
  const slice = leads.slice(from, from + PAGE).map(trim);
  return { leads: slice, leadsTotal: leads.length, offset: from, more: from + slice.length < leads.length };
}
function data() {
  const p = page(0);
  return {
    ok: true,
    me: { phone: "9010427777", name: "Owner (mock)", role: "owner", caps: ["*"], roleLabel: "Owner" },
    roles: { owner: { label: "Owner", te: "ఓనర్", caps: ["*"] } },
    capList: CAPS, capTe: {}, capGroups: [],
    leads: p.leads, leadsTotal: p.leadsTotal, leadsMore: p.more, leadPage: PAGE,
    statuses: ["new", "contacted", "booked", "visited", "closed"],
    appts: [{ ph: "9876543210", name: "Sita 1", at: Date.now() + 3600000, concern: "acne", id: "x1" }],
    academy: { booked: 4, left: 6, leads: p.leads.filter((l) => /^academy/i.test(l.concern)) },
    today: null, queue: [], dailyOn: true, reviews: [], team: {}, owners: ["9010427777"], ts: Date.now(),
  };
}

let mockMoved = 0;
const M = 60000;
const mockIb = [
  { phone: "9876543210", name: "Lakshmi Priya", unread: 2, human: null, open: true, msgs: [
    { dir: "in", text: "Hi, naaku face meeda pigmentation undi. Treatment undha?", ts: Date.now() - 42 * M },
    { dir: "out", by: "ai", text: "Namaste Lakshmi garu 🙏 Avunu, PICO laser & peels tho pigmentation ki chala manchi results vastayi. Doctor consultation lo mee skin chusi correct plan chepptaru. Ee week lo eppudu vilu avutundi?", ts: Date.now() - 41 * M },
    { dir: "in", text: "Price entha avutundi?", ts: Date.now() - 12 * M },
    { dir: "out", by: "ai", text: "Price doctor mee skin chusina tarvata chepptaru andi — prathi patient ki plan veru. Consultation book cheyamantara? Saturday 5 PM slot undi 😊", ts: Date.now() - 11 * M },
    { dir: "in", text: "Konchem discount istara? Naa friend kuda vastundi", ts: Date.now() - 3 * M },
  ] },
  { phone: "9876500223", name: "Ravi Teja", unread: 0, human: { by: "Sowmya", ts: Date.now() - 50 * M }, open: true, msgs: [
    { dir: "in", text: "Hair fall ekkuva ga undi, PRP cheyinchukovali", ts: Date.now() - 3 * 60 * M },
    { dir: "out", by: "ai", text: "PRP gurinchi adiginanduku thanks 🙏 Doctor scalp check chesi enni sittings kavalo chepptaru.", ts: Date.now() - 179 * M },
    { dir: "out", by: "Sowmya", text: "Ravi garu, nenu Sowmya from DermaLuxe. Repu 11 AM ki Dr. Sai Divija available. Book cheyana?", ts: Date.now() - 50 * M },
    { dir: "in", text: "Ok book cheyandi 👍", ts: Date.now() - 45 * M },
  ] },
  { phone: "9876500311", name: "Anusha", unread: 0, human: null, open: false, msgs: [
    { dir: "in", text: "Academy course fees entha?", ts: Date.now() - 30 * 60 * M },
    { dir: "out", by: "ai", text: "Skin Care course ₹49,999 (launch offer). Batch 20 Oct nundi, 10 seats matrame 🎓", ts: Date.now() - 30 * 60 * M + M },
  ] },
];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (u.pathname === "/api/staff") {
    const a = u.searchParams.get("a") || "";
    if (a === "data") return send(200, data());
    if (a === "leads") return send(200, Object.assign({ ok: true }, page(Number(u.searchParams.get("offset") || 0))));
    if (a === "storage") return send(200, {
      ok: true, cached: false, keys: 41230, leads: leads.length, appts: 12,
      photos: { photos: 412, inBlob: 380, inKv: 0, legacy: 32, bytes: 104857600, blobOn: true, encrypted: true, partial: false },
      at: Date.now(),
    });
    if (a === "storage-move") return send(200, { ok: true, moved: 12, skipped: 0, failed: 0, freedBytes: 3145728, done: true });
    if (a === "panel") return send(200, { health: { dbCheckAt: Date.now() - 23 * 60000, reviewAsks: [{ ts: Date.now() - 2 * 86400000, day: "2026-09-15", sent: 3 }, { ts: Date.now() - 86400000, day: "2026-09-16", sent: 2 }] },
      ok: true,
      roles: { owner: { label: "Owner", te: "ఓనర్", caps: ["*"], builtin: true }, reception: { label: "Reception", te: "రిసెప్షన్", caps: ["leads.view", "leads.edit", "appts.view", "appts.edit", "msg.send"], builtin: true } },
      capList: CAPS, capTe: {}, capGroups: [{ key: "leads", label: "Leads", caps: ["leads.view", "leads.edit"] }],
      people: [
        { phone: "9876500001", name: "Sowmya", role: "reception", caps: ["leads.view", "leads.edit"], lastLogin: Date.now() - 3600000, hasPwd: true, tempPwd: false },
        { phone: "9876500002", name: "Latha", role: "reception", caps: ["leads.view"], lastLogin: Date.now() - 86400000 * 3, hasPwd: true, tempPwd: true },
        { phone: "9876500003", name: "Kiran", role: "reception", caps: [], lastLogin: null, hasPwd: false, off: true },
      ],
      owners: [{ phone: "9010427777", lastLogin: Date.now() - 600000 }],
      passwordSet: true, audit: [{ ts: Date.now() - 120000, by: "Owner", phone: "9010427777", what: "AI Office: message → 9876543210 (message)" }],
      me: { phone: "9010427777", name: "Owner (mock)", role: "owner", caps: ["*"] },
    });
    if (a === "login" || a === "verify") return send(200, { ok: true, token: "mock.token" });
    if (a === "lead-add") {
      let body = ""; req.on("data", (c) => (body += c));
      return req.on("end", () => {
        const b2 = (() => { try { return JSON.parse(body || "{}"); } catch (e) { return {}; } })();
        const ph = String(b2.phone || "").replace(/\D/g, "").slice(-10);
        // one number is already in the list, so the duplicate path can be seen
        if (ph === "9876543210" && !b2.anyway) {
          return send(409, { error: "Ee number 6 Aug na already vachindi (Sita Rani). Malli add cheyyala?" });
        }
        const lead = { ts: Date.now(), name: b2.name, phone: ph, src: b2.src, type: b2.src,
          age: b2.age || "", gender: b2.gender || "",
          concern: b2.concern || "", message: b2.message || "", heat: b2.heat || "warm",
          status: b2.status || "new", notes: b2.message ? [{ ts: Date.now(), by: "Owner", text: b2.message }] : [],
          call_prep: "", key: Date.now() + "|" + ph };
        leads.unshift(lead);
        return send(200, { ok: true, lead, key: lead.key, synced: true });
      });
    }
    return send(200, { ok: true });
  }
  if (u.pathname === "/api/kvrestore") {
    const a = u.searchParams.get("a") || "list";
    if (a === "list") return send(200, { ok: true, last: { day: "2026-09-14", keys: 154, bytes: 81000 },
      backups: ["2026-09-14","2026-09-13","2026-09-12"].map((d) => ({ day: d, bytes: 81000, at: new Date().toISOString() })) });
    if (a === "run") return send(200, { ok: true, day: "2026-09-14", keys: 154, bytes: 81000 });
    if (a === "peek") return send(200, { ok: true, day: "2026-09-14", keys: 154, leads: 0, byType: { string: 140, list: 6, hash: 5, set: 3 } });
    if (a === "restore") return send(200, { ok: true, day: "2026-09-14", keys: 154 });
    return send(200, { ok: true });
  }
  if (u.pathname === "/api/kvmove") {
    const a = u.searchParams.get("a") || "status";
    if (a === "status") return send(200, { ok: true, from: 4180, to: mockMoved, cursor: "0", live: "redis (america)" });
    if (a === "copy") { mockMoved = Math.min(4180, mockMoved + 200); return send(200, { ok: true, moved: 200, skipped: 0, done: mockMoved >= 4180 }); }
    return send(200, { ok: true });
  }
  if (u.pathname === "/api/hms") {  // hms-mock
    const a = u.searchParams.get("a") || "status";
    if (a === "status") return send(200, mockHms);
    let body = ""; req.on("data", (c) => (body += c)); return req.on("end", () => {
      if (a === "test") { mockHms.last = { at: Date.now(), ms: 212, ok: true, by: "Owner" }; return send(200, { ok: true, ms: 212 }); }
      if (a === "retry") { const n = mockHms.waiting; mockHms.waiting = 0; mockHms.sample = []; return send(200, { ok: true, sent: n, failed: 0, waiting: 0 }); }
      return send(400, { error: "Unknown action" });
    });
  }
  if (u.pathname === "/api/insights") {  // insights-mock
    return send(200, { ok: true, days: 30, since: Date.now() - 30 * 86400000,
      money: { collected: 284000, billed: 341000, outstanding: 57000, openCount: 9, byMode: { cash: 96000, upi: 171000, card: 17000, other: 0 }, spark: [], payers: 63 },
      funnel: { leads: 212, contacted: 168, booked: 74, firstReplyMins: 9, firstReplyCount: 168 },
      sources: [{ name: "whatsapp", leads: 96, booked: 41, revenue: 148000 }, { name: "instagram", leads: 71, booked: 22, revenue: 86000 }, { name: "web", leads: 45, booked: 11, revenue: 50000 }],
      treatments: [{ name: "Laser — full face", count: 31, value: 118000 }, { name: "PRP hair therapy", count: 22, value: 84000 }],
      patients: { total: 148, repeats: 52, repeatRate: 35 } });
  }
  if (u.pathname === "/api/ads") {  // ads-mock
    const a = u.searchParams.get("a") || "overview";
    if (a === "overview") return send(200, { ok: true, connected: true, days: 30, target: 300, canChange: true,
      tokenName: "META_ADS_TOKEN", accountId: "2110247062961086",
      account: { name: "DermaLuxe", currency: "INR", active: true, spend: 120860, impressions: 2000000, reach: 500000, results: 1863, costEach: 65, capLeft: 9140 },
      today: { spend: 2962, impressions: 102786 },
      ours: { leads: 96, booked: 41, came: 12, revenue: 386000, people: 96 },
      joined: { spend: 120860, costPerLead: 1259, costPerBooked: 2948, costPerCame: 10072, revenue: 386000, back: 319 },
      campaigns: [
        { id: "111", name: "Laser — Eluru radius", objective: "MESSAGES", status: "ACTIVE", running: true, daily: 2000, spend: 18919, impressions: 246595, reach: 246595, results: 960, costEach: 20, verdict: { tone: "good", text: "Chala baagundi — okko సంభాషణ ₹20. Budget penchavachu" } },
        { id: "222", name: "Hair transplant — awareness", objective: "MESSAGES", status: "ACTIVE", running: true, daily: 800, spend: 7595, impressions: 99970, reach: 99970, results: 176, costEach: 43, verdict: { tone: "good", text: "Baagundi — okko సంభాషణ ₹43" } },
        { id: "333", name: "Bridal package", objective: "ENGAGEMENT", status: "ACTIVE", running: true, daily: 500, spend: 7390, impressions: 150079, reach: 150079, results: 10, costEach: 739, verdict: { tone: "bad", text: "Chala kharidu — okko సంభాషణ ₹739. Aapeyyadam manchidi" } },
      ] });
    let body = ""; req.on("data", (c) => (body += c)); return req.on("end", () => send(200, { ok: true }));
  }
  if (u.pathname === "/api/poster") {  // poster-mock: saved daily posters
    const a = u.searchParams.get("a") || "list";
    if (a === "topics") return send(200, { ok: true, topics: [
      { key: "acad-seats", h1: "Ten seats. One batch.", pillar: "academy" }, { key: "acad-who", h1: "Beautician? Nurse? Fresher?", pillar: "academy" },
      { key: "hydrafacial", h1: "Hydrafacial glow in 30 minutes", pillar: "tx" }, { key: "hair-fall", h1: "Hair fall? Find the cause first", pillar: "edu" } ] });
    if (a === "list") return setTimeout(() => send(200, { ok: true, keepDays: 14, posters: mockPv }), 900);
    if (a === "settings" && req.method === "GET") return send(200, Object.assign({ ok: true, canChange: true, doctors: [{ key: "nikhitha", name: "Dr. Nikhitha Priyanka" }, { key: "meghana", name: "Dr. Meghana Valeti" }, { key: "sai", name: "Dr. Sai Divija" }], campaign: { on: true, left: 6, offerDays: 11, batchDays: 31 } }, mockPvSet));
    let body = ""; req.on("data", (c) => (body += c)); return req.on("end", () => {
      const b2 = (() => { try { return JSON.parse(body || "{}"); } catch (e) { return {}; } })();
      if (a === "settings") { if (b2.doctor) mockPvSet.doctor = b2.doctor; if (b2.academy) mockPvSet.academy = b2.academy;
        return send(200, Object.assign({ ok: true, canChange: true, doctors: [{ key: "nikhitha", name: "Dr. Nikhitha Priyanka" }, { key: "meghana", name: "Dr. Meghana Valeti" }, { key: "sai", name: "Dr. Sai Divija" }], campaign: { on: mockPvSet.academy !== "off", left: 6, offerDays: 11, batchDays: 31 } }, mockPvSet)); }
      const row = mockPv.find((x) => x.id === b2.id);
      const fresh = (extra) => Object.assign({ imgId: "pv" + Date.now(), topic: "acad-seats", pillar: "academy", h1: "Ten seats. One batch.", te: "పది సీట్లు మాత్రమే",
        look: ["daylight", "golden", "macro", "studio"][mockPv.length % 4], doctor: "Dr. Meghana Valeti", hadImage: true, by: "Owner (mock)", at: Date.now(),
        caption: "Ten seats. One batch.\nపది సీట్లు మాత్రమే\n\nDermaLuxe Academy, Eluru — hands-on training.\n📲 WhatsApp *ACADEMY* to 99591 34666" }, extra);
      if (a === "create") return setTimeout(() => { const r = fresh({ id: Math.random().toString(16).slice(2, 18).padEnd(16, "0"), status: "draft", note: b2.note || "" }); mockPv.unshift(r); send(200, { ok: true, poster: r }); }, 3000);
      if (!row) return send(404, { error: "Aa poster dorakaledu" });
      if (a === "regenerate") return setTimeout(() => { Object.assign(row, fresh({ note: b2.note || "", redone: (row.redone || 0) + 1 })); send(200, { ok: true, poster: row }); }, 3000);
      if (a === "post") { Object.assign(row, { status: "posted", link: "https://instagram.com/p/mock", postedAt: Date.now() }); return send(200, { ok: true, poster: row }); }
      if (a === "schedule") { Object.assign(row, { status: "scheduled", due: Date.now() + 20 * 3600000 }); return send(200, { ok: true, poster: row }); }
      if (a === "remove") { mockPv.splice(mockPv.indexOf(row), 1); return send(200, { ok: true }); }
      return send(400, { error: "Unknown action" });
    });
  }
  if (u.pathname === "/api/media" && /^pv/.test(u.searchParams.get("id") || "")) {  // the preview picture
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    return res.end(require("fs").readFileSync(require("path").join(__dirname, "fixtures", "poster-sample.jpg")));
  }
  if (u.pathname === "/api/post") {  // post-mock
    const a = u.searchParams.get("a") || "list";
    if (a === "list") return send(200, { ok: true, canPost: true, account: "@dermaluxe.ai", crossPosts: true,
      queue: mockPostQ,
      posted: [
        { id: "ig1", imgId: "p1", caption: "Hydrafacial — instant glow, zero downtime ✨", kind: "post", link: "https://instagram.com/p/abc", fb: true, at: Date.now() - 20 * 3600000, by: "Owner" },
        { id: "ig2", imgId: "p2", caption: "PRP hair therapy — mee sonta raktham nunchi", kind: "reel", link: "https://instagram.com/reel/def", fb: false, at: Date.now() - 3 * 86400000, by: "Sowmya" },
      ] });
    let body = ""; req.on("data", (c) => (body += c)); return req.on("end", () => {
      const b2 = (() => { try { return JSON.parse(body || "{}"); } catch (e) { return {}; } })();
      if (a === "create") {
        if (b2.due) { mockPostQ.push({ imgId: "q" + (mockPostQ.length + 1), caption: b2.caption, due: b2.due, kind: "post", tries: 0, by: "Owner (mock)" }); return send(200, { ok: true, scheduled: true, due: b2.due }); }
        return send(200, { ok: true, link: "https://instagram.com/p/new", fb: true, id: "ig_new" });
      }
      if (a === "cancel") { const i = mockPostQ.findIndex((x) => x.imgId === b2.imgId); if (i < 0) return send(404, { error: "Aa post queue lo ledu" }); mockPostQ.splice(i, 1); return send(200, { ok: true }); }
      return send(400, { error: "Unknown action" });
    });
  }
  if (u.pathname === "/api/referral") {  // referral-mock
    const a = u.searchParams.get("a") || "of";
    if (a === "of") return send(200, Object.assign({ ok: true, canSend: true, canEdit: true, offer: "20% off next sitting" }, mockRef));
    if (a === "board") return send(200, { ok: true, offer: "20% off next sitting", total: 5, owed: 2, rows: [
      { phone: "9876543210", code: "DL5310", n: 3, owed: 2, last: { ts: Date.now() - 86400000 }, names: ["Sita Rani", "Ravi Kumar"] },
      { phone: "9876500045", code: "DL2277", n: 2, owed: 0, last: { ts: Date.now() - 5 * 86400000 }, names: ["Padma"] },
    ] });
    let body = ""; req.on("data", (c) => (body += c)); return req.on("end", () => {
      const b2 = (() => { try { return JSON.parse(body || "{}"); } catch (e) { return {}; } })();
      if (a === "send") return send(200, { ok: true, code: mockRef.code, via: "message" });
      if (a === "reward") { const r = mockRef.rows.find((x) => x.phone === b2.brought); if (r) r.rewarded = { ts: Date.now(), by: "Owner (mock)", what: b2.what }; mockRef.unrewarded = mockRef.rows.filter((x) => !x.rewarded).length; return send(200, { ok: true }); }
      if (a === "unreward") { const r = mockRef.rows.find((x) => x.phone === b2.brought); if (r) r.rewarded = null; mockRef.unrewarded = mockRef.rows.filter((x) => !x.rewarded).length; return send(200, { ok: true }); }
      if (a === "redeem") { if (!/^DL\d{4}$/.test(String(b2.code || "").toUpperCase())) return send(400, { error: "Aa code dorakaledu — malli chudandi" }); return send(200, { ok: true, owner: "9876500045", code: String(b2.code).toUpperCase() }); }
      return send(400, { error: "Unknown action" });
    });
  }
  if (u.pathname === "/api/consent") {  // consent-mock
    const a = u.searchParams.get("a") || "templates";
    if (a === "templates") return send(200, { ok: true, canApprove: true, canTake: true,
      templates: mockTpl.map((t) => ({ id: t.id, name: t.name, version: t.version, approved: t.approved, body: t.body })) });
    if (a === "of") return send(200, { ok: true, rows: mockCns.slice().sort((x, y) => y.signedAt - x.signedAt) });
    if (a === "sig") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")); }
    let body = ""; req.on("data", (c) => (body += c)); return req.on("end", () => {
      const b = (() => { try { return JSON.parse(body || "{}"); } catch (e) { return {}; } })();
      const t = mockTpl.find((x) => x.id === (b.id || b.templateId));
      if (a === "approve") { t.approved = { by: "Owner", ts: Date.now() }; return send(200, { ok: true, templates: mockTpl }); }
      if (a === "edit-template") { t.body = String(b.body || t.body); t.version++; t.approved = null; return send(200, { ok: true, templates: mockTpl }); }
      if (a === "sign") {
        if (!t.approved) return send(400, { error: "Ee consent maatalaki inka doctor approval ledu — mundu approve cheyyandi" });
        if (!b.agreed) return send(400, { error: "Patient ophukunnaru ani tick cheyyandi" });
        const c = { id: "c" + (mockCns.length + 1), phone: b.phone, name: b.name, templateId: t.id, templateName: t.name,
          templateVersion: t.version, body: t.body, signedAt: Date.now(), takenBy: "Owner", hasSig: !!b.signature,
          approvedWording: t.approved, withdrawn: null };
        mockCns.push(c); return send(200, { ok: true, consent: c });
      }
      if (a === "withdraw") {
        const c = mockCns.find((x) => x.id === b.id);
        if (!c) return send(404, { error: "dorakaledu" });
        if (c.withdrawn) return send(400, { error: "Idi ippatike venakki teesukunnaru" });
        c.withdrawn = { ts: Date.now(), by: "Owner", reason: String(b.reason || "") };
        return send(200, { ok: true });
      }
      return send(400, { error: "Unknown action" });
    });
  }
  if (u.pathname === "/api/schedule") {  // schedule-mock: a day with three doctors and a waitlist
    const a = u.searchParams.get("a") || "day";
    const istDayS = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
    const day = u.searchParams.get("day") || istDayS(Date.now());
    const at = (h, m) => new Date(day + "T" + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":00+05:30").getTime();
    const tm = (ts) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ts));
    const team = [{ phone: "9000000001", name: "Dr. Nikhitha", role: "doctor" }, { phone: "9000000002", name: "Dr. Sai Divija", role: "doctor" }, { phone: "9000000003", name: "Latha (therapist)", role: "therapist" }, { phone: "9000000004", name: "Sowmya", role: "reception" }];
    if (!global.mockSch) global.mockSch = [
      ["Lakshmi Priya", 10, 0, 30, "9000000001", "Consultation", "booked", true], ["Ravi Teja", 10, 30, 45, "9000000002", "PRP", "arrived", true],
      ["Anusha", 11, 0, 60, "9000000003", "Hydrafacial", "booked", false], ["Kiran", 12, 0, 30, "9000000001", "Acne follow-up", "done", true],
      ["Padma", 15, 30, 45, "9000000002", "Laser — face", "booked", false], ["Suresh", 17, 0, 30, "", "Hair fall", "booked", false],
      ["Meena", 18, 0, 60, "9000000003", "Chemical peel", "booked", true],
    ].map((r, i) => ({ id: "s" + i, name: r[0], ph: "98765432" + String(10 + i), atH: r[1], atM: r[2], mins: r[3], staff: r[4], staffName: (team.find((t) => t.phone === r[4]) || {}).name || "", concern: r[5], status: r[6], cf: r[7], room: r[5] === "Hydrafacial" ? "Hydrafacial" : r[5].startsWith("Laser") ? "Laser room" : "" }));
    if (a === "week") return send(200, { ok: true, team, days: Array.from({ length: 7 }, (_, i) => ({ day: istDayS(Date.now() + i * 86400000), total: i ? 3 : global.mockSch.length, mine: 0 })) });
    if (a === "day") {
      const rows = global.mockSch.map((r) => Object.assign({}, r, { at: r.at || at(r.atH, r.atM), day, time: tm(r.at || at(r.atH, r.atM)) }));
      return send(200, { ok: true, day, rows, team, rooms: ["Consultation", "Laser room", "Hydrafacial", "Procedure room"],
        wait: [{ id: "w1", ph: "9876500777", name: "Bhavani", concern: "PICO laser", day, when: "evening", ts: Date.now() - 7200000, by: "Sowmya" }],
        counts: { total: rows.length, booked: 4, arrived: 1, done: 1, unconfirmed: 3 } });
    }
    let raw = ""; req.on("data", (c) => { raw += c; });
    return req.on("end", () => {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch (e) {}
      const r = global.mockSch.find((x) => x.id === body.id);
      if (a === "move" && r) { r.at = body.at; }
      if (a === "assign" && r) { r.staff = body.staff; r.staffName = body.staffName; }
      return send(200, { ok: true });
    });
  }
  if (u.pathname === "/api/me") {  // portal-mock: the patient's own page
    const a = u.searchParams.get("a") || "home";
    if (a === "home") return send(200, { ok: true, phone: "9876543210", name: "Sita", due: 3000,
      upcoming: [{ at: Date.now() + 2 * 86400000, concern: "PICO laser — sitting 3", confirmed: false, doctor: "Dr. Nikhitha" }],
      visits: [{ at: Date.now() - 20 * 86400000, concern: "PICO laser — sitting 2" }, { at: Date.now() - 50 * 86400000, concern: "Consultation" }],
      bills: [{ id: "B1001", date: Date.now() - 20 * 86400000, items: ["PICO laser × 6"], total: 30000, paid: 27000, balance: 3000, pay: "/pay.html?b=B1001&t=x", receipt: "/pay.html?b=B1001&t=x" }],
      packages: [{ treatment: "PICO laser", done: 2, total: 6, left: 4, nextDue: Date.now() + 2 * 86400000, status: "active" }] });
    return send(200, { ok: true, msg: "Ee number clinic records lo unte, WhatsApp lo code vastundi.", token: "mock" });
  }
  if (u.pathname === "/api/pay") {  // pay-mock: the patient's bill link
    if (req.method === "POST") return send(200, { ok: true, msg: "Thank you 🙏 Clinic bank lo check chesi confirm chestundi." });
    const url = "upi://pay?pa=dermaluxe%40okaxis&pn=DermaLuxe%20by%20Medicare&am=3000&cu=INR&tn=DermaLuxe%20bill%20B1001";
    return require("qrcode").toString(url, { type: "svg", margin: 1 }).then((qr) => send(200, { ok: true,
      bill: { id: "B1001", name: "Sita", date: Date.now() - 86400000 * 3, items: [{ name: "Laser — face", qty: 1, price: 5000 }], payments: [{ amount: 2000, mode: "cash", ts: Date.now() - 86400000 * 3 }], total: 5000, paid: 2000, balance: 3000 },
      upi: { vpa: "dermaluxe@okaxis", payee: "DermaLuxe by Medicare", url, qr }, razorpay: null }));
  }
  if (u.pathname === "/api/inbox") {  // inbox-mock: WhatsApp conversations
    const a = u.searchParams.get("a") || "list";
    if (a === "list") return send(200, { ok: true, canReply: true, unread: mockIb.reduce((n, t) => n + t.unread, 0),
      review: { day: "2026-09-19", checked: 12, score: 78, summary: "Chala chats lo slots baaga offer chesindi · Okka chat lo price cheppesindi · Price rule lint lo undi, ippudu rewrite avutundi", lint: { checked: 4, rewritten: 3 },
        findings: [{ phone: "3210", who: "Lakshmi Priya", severity: "high", issue: "PICO laser ki ₹8,000 ani price cheppindi", fix: "Consultation lo doctor exact plan istaru ani cheppi slot adagali" }, { phone: "0223", who: "Ravi Teja", severity: "medium", issue: "Rendu questions okate message lo", fix: "Okka question, migilinavi statements" }] },
      threads: mockIb.map((t) => ({ phone: t.phone, name: t.name, last: t.msgs[t.msgs.length - 1].text, lastDir: t.msgs[t.msgs.length - 1].dir, lastBy: t.msgs[t.msgs.length - 1].by || "", ts: t.msgs[t.msgs.length - 1].ts, unread: t.unread, human: t.human, open: t.open })) });
    if (a === "thread") {
      const t = mockIb.find((x) => x.phone === u.searchParams.get("phone"));
      if (!t) return send(404, { error: "Ee number tho chat ledu" });
      t.unread = 0;
      return send(200, { ok: true, phone: t.phone, msgs: t.msgs, meta: { name: t.name, lastIn: t.msgs.filter((m) => m.dir === "in").pop().ts }, human: t.human, open: t.open, canReply: true });
    }
    let raw = ""; req.on("data", (c) => { raw += c; });
    return req.on("end", () => {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch (e) {}
      const t = mockIb.find((x) => x.phone === body.phone);
      if (!t) return send(404, { error: "Ee number tho chat ledu" });
      if (a === "takeover") { t.human = body.on === false ? null : { by: "Owner (mock)", ts: Date.now() }; return send(200, { ok: true, human: t.human }); }
      if (a === "reply") {
        t.msgs.push({ dir: "out", by: "Owner (mock)", text: body.text, ts: Date.now(), via: t.open ? "text" : "template" });
        t.human = { by: "Owner (mock)", ts: Date.now() };
        return send(200, { ok: true, via: t.open ? "text" : "template", human: t.human });
      }
      return send(400, { error: "Unknown action" });
    });
  }
  if (u.pathname === "/api/stock") {  // stock-mock
    const a = u.searchParams.get("a") || "list";
    if (a === "list") return send(200, { ok: true, canEdit: true, lowCount: 2,
      units: ["pcs","box","ml","vial","pack","kit","tube","pair"],
      rows: [
        { id: "s1", name: "PRP kits", qty: 2, unit: "kit", low: 3, isLow: true, by: "Latha", updatedAt: Date.now() - 3600000 },
        { id: "s2", name: "Diode laser tips", qty: 1, unit: "pcs", low: 2, isLow: true, note: "1064nm", by: "Owner", updatedAt: Date.now() - 86400000 },
        { id: "s3", name: "Nitrile gloves", qty: 8, unit: "box", low: 3, isLow: false, by: "Sowmya", updatedAt: Date.now() - 7200000 },
      ],
      log: [{ ts: Date.now() - 3600000, name: "PRP kits", change: -1, left: 2, reason: "vaadaam", by: "Latha" }] });
    return send(200, { ok: true, item: { id: "s1", name: "PRP kits", qty: 3, unit: "kit", isLow: true }, warned: true });
  }
  if (u.pathname === "/api/attend") {  // attend-mock
    const a = u.searchParams.get("a") || "day";
    if (a === "day") return send(200, { ok: true, day: "2026-09-15", today: "2026-09-15", canManage: true,
      statuses: ["present","leave","half","holiday"], labels: { present:"Vachcharu", leave:"Leave", half:"Half day", holiday:"Selavu" },
      me: { phone: "9010427777", status: null, in: 0, out: 0 },
      counts: { present: 2, leave: 1, unmarked: 1 },
      rows: [
        { phone: "9876500051", name: "Sowmya", role: "reception", status: "present", in: Date.now()-14400000, out: 0, inAt: "9:15 am", outAt: "", note: "", markedBy: "Sowmya" },
        { phone: "9876500052", name: "Latha", role: "therapist", status: "leave", in: 0, out: 0, inAt: "", outAt: "", note: "fever", markedBy: "Owner" },
        { phone: "9876500053", name: "Kiran", role: "doctor", status: "present", in: Date.now()-10800000, out: 0, inAt: "10:00 am", outAt: "", note: "", markedBy: "Kiran" },
        { phone: "9010427777", name: "Owner", role: "owner", status: null, in: 0, out: 0, inAt: "", outAt: "", note: "", markedBy: "" },
      ] });
    if (a === "month") return send(200, { ok: true, month: "2026-09",
      rows: [{ name: "Sowmya", present: 12, half: 1, leave: 2 }, { name: "Latha", present: 11, half: 0, leave: 3 }] });
    return send(200, { ok: true, at: "9:15 am" });
  }
  if (u.pathname === "/api/expense" && u.searchParams.get("a") === "pnl") {  // pnl-mock
    const month = u.searchParams.get("month") || new Date(Date.now() + 19800000).toISOString().slice(0, 7);
    const days = Array.from({ length: 19 }, (_, i) => ({ day: month + "-" + String(i + 1).padStart(2, "0"), in: [0, 6].includes(i % 7) ? 0 : 8000 + ((i * 3719) % 14000), out: i % 4 === 0 ? 3000 + (i * 911) % 5000 : (i % 3 ? 400 : 0) }));
    const collected = days.reduce((n, d) => n + d.in, 0), spent = days.reduce((n, d) => n + d.out, 0);
    return send(200, { ok: true, month, prev: "2026-08",
      cur: { month, collected, billed: collected + 42000, spent, profit: collected - spent, margin: Math.round((collected - spent) / collected * 100), patients: 64, days,
        byMode: { cash: 61000, upi: 118000, card: 9000 },
        byCategory: [{ name: "Salaries", amount: 22000 }, { name: "Consumables", amount: 9800 }, { name: "Marketing & ads", amount: 6100 }, { name: "Electricity & water", amount: 2300 }],
        treatments: [{ name: "PICO laser", count: 9, value: 54000 }, { name: "Hydrafacial", count: 14, value: 42000 }, { name: "PRP", count: 8, value: 36000 }, { name: "Chemical peel", count: 11, value: 22000 }, { name: "Consultation", count: 40, value: 20000 }] },
      before: { month: "2026-08", collected: 162000, spent: 51000, profit: 111000, margin: 69, patients: 58 },
      change: { collected: Math.round((collected - 162000) / 1620), spent: Math.round((spent - 51000) / 510), profit: Math.round((collected - spent - 111000) / 1110) } });
  }
  if (u.pathname === "/api/expense") {  // expense-mock
    const a = u.searchParams.get("a") || "summary";
    const rows = [
      { id: "E10011", amount: 1200, category: "Consumables", note: "PRP kits", mode: "cash", by: "Reception", ts: Date.now() - 3600000 },
      { id: "E10012", amount: 800, category: "Electricity & water", mode: "upi", by: "Owner", ts: Date.now() - 7200000 },
    ];
    if (a === "summary") return send(200, { ok: true, today: "2026-09-15", month: "2026-09",
      day: { collected: 12500, spent: 2000, left: 10500, rows },
      monthly: { collected: 186000, spent: 74300, left: 111700, count: 31,
        byCategory: [{ name: "Salaries", amount: 45000 }, { name: "Consumables", amount: 14300 }, { name: "Rent", amount: 15000 }] },
      cats: ["Consumables", "Medicines & products", "Salaries", "Rent", "Electricity & water", "Marketing & ads", "Other"],
      canEdit: true });
    return send(200, { ok: true });
  }
  if (u.pathname === "/api/money") {
    const a = u.searchParams.get("a") || "day";
    if (a === "day") return send(200, { ok: true, day: "2026-09-15", collected: 12500, billed: 15000,
      byMode: { cash: 5000, upi: 7500, card: 0, other: 0 }, count: 3,
      payments: [{ billId: "B1007", phone: "9876500041", name: "Latha Devi", amount: 5000, mode: "cash", by: "Reception", ts: Date.now() - 5400000 }] });
    if (a === "of") return send(200, { ok: true, due: 3000, bills: [{ id: "B1001", phone: "9876543210", name: "Sita Rani",
      ts: Date.now() - 7 * 86400000, total: 5000, paid: 2000, balance: 3000, items: [{ name: "Laser — face", amount: 5000 }],
      payments: [{ amount: 2000, mode: "upi", by: "Reception", ts: Date.now() - 7 * 86400000 }] }] });
    if (a === "rates") return send(200, { ok: true, canEdit: true, rates: [
      { id: "laser-face", name: "Laser — full face", price: 5000 },
      { id: "prp", name: "PRP hair therapy", price: 4000 },
      { id: "peel", name: "Chemical peel", price: 2500 },
      { id: "hydra", name: "Hydrafacial", price: 3500 }] });
    if (a === "dues") return send(200, { ok: true, due: 8500,
      rows: [{ id: "B1001", phone: "9876500041", name: "Latha Devi", ts: Date.now() - 7 * 86400000, total: 5000, paid: 2000, balance: 3000, reminded: 0 },
             { id: "B1004", phone: "9876500045", name: "Ravi Kumar", ts: Date.now() - 12 * 86400000, total: 8000, paid: 2500, balance: 5500, reminded: Date.now() - 2 * 86400000 }] });
    return send(200, { ok: true });
  }
  if (u.pathname === "/api/academy") {  // acad:st-mock
    const a = u.searchParams.get("a") || "list";
    // The real server computes `progress` from what it already stores; the
    // mock mirrors the same shape so the dashboard is exercised honestly.
    const iso = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const st = [
      { id: "DLA001", name: "Keerthi", phone: "9876500021", course: "skin", duration: "1 month", fee: 49999, paid: 49999, status: "enrolled", onboarded: 1, startISO: iso(12), created: Date.now() - 20 * 86400000, notes: [] },
      { id: "DLA002", name: "Harika", phone: "9876500022", course: "both", duration: "2 months", fee: 99999, paid: 9999, status: "enrolled", onboarded: 0, startISO: iso(-9), created: Date.now() - 3 * 86400000, notes: [] },
      { id: "DLA003", name: "Sravani", phone: "9876500023", course: "hair", duration: "1 month", fee: 49999, paid: 49999, status: "completed", onboarded: 1, startISO: iso(40), certNo: "DLA-C-0007", created: Date.now() - 50 * 86400000, notes: [] },
    ].map((x) => Object.assign(x, { progress: progressOf(x) }));
    if (a === "students" || a === "list") return send(200, { ok: true, students: st });
    // The seat board, in the shape api/academy.js returns it (the dashboard
    // reads deadline.offerDays; without it the tab shows an error the real
    // server never causes).
    if (a === "funnel") return send(200, { ok: true,
      seats: { total: 10, booked: 4, left: 6 }, money: { collected: 139996, pending: 159998 },
      counts: { reserved: 4, enquiry: 2, lost: 1 },
      deadline: { offerDays: 11, batchDays: 31, offer: "30 Sep 2026", batch: "20 October 2026" },
      rows: [
        { phone: "9876500031", name: "Divya", course: "skin", stage: "enquiry", quietDays: 3, paid: 0, balance: 49999, lastTouch: Date.now() - 3 * 86400000 },
        { phone: "9876500033", name: "Swathi", course: "hair", stage: "enquiry", quietDays: 0, paid: 0, balance: 49999, lastTouch: Date.now() - 3600000 },
        { phone: "9876500032", name: "Rekha", course: "both", stage: "reserved", quietDays: null, paid: 9999, balance: 90000, lastTouch: Date.now() - 86400000 },
        { phone: "9876500034", name: "Anusha", course: "skin", stage: "lost", quietDays: 9, paid: 0, balance: 0, lastTouch: Date.now() - 9 * 86400000 },
      ] });
    if (a === "reopen") return send(200, { ok: true, url: "https://www.dermaluxe.ai/academy-join.html?t=xyz" });
    if (a === "pay") {
      // mirror the real server: the paid student comes back WITH progress
      const s2 = Object.assign({}, st[1], { paid: st[1].fee });
      return send(200, { ok: true, student: Object.assign(s2, { progress: progressOf(s2) }), receipt: null });
    }
    return send(200, { ok: true, students: st, student: Object.assign({}, st[0], { progress: progressOf(st[0]) }) });
  }
  if (u.pathname === "/api/patient") {  // pt-msg-mock
    const a = u.searchParams.get("a") || "list";
    const p = () => Object.assign({ phone: "9876543210", name: "Sita Rani", since: Date.now() - 86400000 * 40, allergies: "",
      counts: { visits: 2, booked: 1, photos: 3, upcoming: 1, came: 2, noShows: 1 },
      photos: [{ id: "a".repeat(32), ts: Date.now() - 86400000 * 38, by: "Latha", label: "Before" }, { id: "b".repeat(32), ts: Date.now() - 86400000 * 20, by: "Latha", label: "Sitting 3" }, { id: "c".repeat(32), ts: Date.now() - 86400000 * 2, by: "Latha", label: "After" }],
      visits: [{ key: "k1", ts: Date.now() - 86400000 * 40, concern: "Acne scars", src: "whatsapp", status: "visited" }, { key: "k2", ts: Date.now() - 86400000 * 5, concern: "Pigmentation", src: "instagram", status: "booked", slot: "Sat 5 PM" }],
      notes: [{ ts: Date.now() - 86400000 * 39, by: "Sowmya", text: "Called — coming Monday 11 AM" }],
      appts: [{ at: Date.now() + 86400000 * 2, concern: "PICO sitting 4", cf: true }],
      past: [{ at: Date.now() - 86400000 * 38, concern: "Consultation" }, { at: Date.now() - 86400000 * 20, concern: "MNRF sitting 3" }, { at: Date.now() - 86400000 * 10, concern: "MNRF sitting 4", noShow: true }],
      ratings: [{ ts: Date.now() - 86400000 * 18, rating: 5, concern: "MNRF" }],
      spent: { bills: 2, billed: 32000, paid: 24000, due: 8000 },
      chat: { count: 14, human: null, last: [{ dir: "in", text: "Repu appointment ki vastanu", ts: Date.now() - 3600000 }, { dir: "out", by: "ai", text: "Super 🙏 Repu 11 AM, see you!", ts: Date.now() - 3500000 }] },
    }, mockStage);
    if (a === "list") return send(200, { ok: true,
      rows: [Object.assign(p(), { stageLabel: mockStage.stage ? ({consult:"Consultation",plan:"Plan ichcharu",procedure:"Procedure nadustundi",course:"Course ayipoyindi",review:"Review / maintenance",declined:"Vaddannaru"})[mockStage.stage] : "", visits: 3, last: Date.now() - 86400000, concern: "acne" })],
      total: 1, repeats: 1,
      stages: [["consult","Consultation"],["plan","Plan ichcharu"],["procedure","Procedure nadustundi"],["course","Course ayipoyindi"],["review","Review / maintenance"],["declined","Vaddannaru"]]
        .map(([key,label]) => ({ key, label, count: mockStage.stage === key ? 1 : 0 })),
      stageless: mockStage.stage ? 0 : 1 });
    if (a === "stage") {
      let body = ""; req.on("data", (c) => (body += c));
      return req.on("end", () => {
        const b2 = (() => { try { return JSON.parse(body || "{}"); } catch (e) { return {}; } })();
        const from = mockStage.stage || "";
        mockStage.stage = b2.stage || "";
        mockStage.stageAt = mockStage.stage ? Date.now() : 0;
        mockStage.stageBy = mockStage.stage ? "Owner (mock)" : "";
        mockStage.stageNote = b2.note || "";
        if (from !== mockStage.stage) mockStage.stageLog.unshift({ ts: Date.now(), by: "Owner (mock)", from, to: mockStage.stage, note: b2.note || "" });
        return send(200, { ok: true, patient: p() });
      });
    }
    return send(200, { ok: true, patient: p(), via: "message" });
  }
  if (u.pathname === "/api/photo" && u.searchParams.get("a") === "get") {  // photo-mock: a coloured square per id
    const id = u.searchParams.get("id") || "";
    const col = id[0] === "a" ? "#b45309" : id[0] === "b" ? "#d97706" : "#fbbf24";
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="${col}"/><text x="150" y="210" font-size="40" text-anchor="middle" fill="#fff" font-family="sans-serif">${id[0] === "a" ? "BEFORE" : id[0] === "b" ? "MID" : "AFTER"}</text></svg>`);
  }
  if (u.pathname.startsWith("/api/")) return send(200, { ok: true, rows: [], photos: [], days: [], team: [] });

  let f = u.pathname === "/" ? "/staff.html" : u.pathname;
  const file = path.join(ROOT, f.replace(/^\/+/, ""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  // ?fastlock=1 shortens the idle lock so it can be watched instead of waited
  // out. Development only; the real file is never changed.
  if (u.searchParams.get("fastlock") === "1" && file.endsWith(".html")) {
    const html = fs.readFileSync(file, "utf8").replace("var WEB_LOCK_AFTER = 10 * 60 * 1000;", "var WEB_LOCK_AFTER = 3000;");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log("mock staff dashboard on http://localhost:" + PORT + " (" + TOTAL + " leads)"));
