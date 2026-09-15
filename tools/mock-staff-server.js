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
    status: ["new", "contacted", "booked", "visited", "closed"][i % 5],
    notes: i % 4 === 0 ? [{ ts: ts + 600000, by: "Reception", text: "Called, asked to ring back" }] : [],
  });
}
const trim = (l) => Object.assign({}, l, {
  message: l.message.length > 300 ? l.message.slice(0, 300) + "…" : l.message,
  call_prep: l.call_prep.length > 200 ? l.call_prep.slice(0, 200) + "…" : l.call_prep,
});

const mockTpl = require("../api/consent.js").DRAFTS.map((t) => Object.assign({}, t, { version: 1, approved: null }));
const mockCns = [];
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
    if (a === "panel") return send(200, {
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
    const st = [
      { id: "DLA001", name: "Keerthi", phone: "9876500021", course: "skin", duration: "1 month", fee: 49999, paid: 49999, status: "enrolled", onboarded: 1, notes: [] },
      { id: "DLA002", name: "Harika", phone: "9876500022", course: "both", duration: "2 months", fee: 99999, paid: 9999, status: "enrolled", onboarded: 0, notes: [] },
    ];
    if (a === "students" || a === "list") return send(200, { ok: true, students: st });
    if (a === "reopen") return send(200, { ok: true, url: "https://www.dermaluxe.ai/academy-join.html?t=xyz" });
    return send(200, { ok: true, students: st, student: st[0] });
  }
  if (u.pathname === "/api/patient") {  // pt-msg-mock
    const a = u.searchParams.get("a") || "list";
    const p = { phone: "9876543210", name: "Sita Rani", since: Date.now() - 86400000 * 40, allergies: "",
      counts: { visits: 3, booked: 1, photos: 0, upcoming: 0 }, photos: [], visits: [], notes: [], appts: [] };
    if (a === "list") return send(200, { ok: true, rows: [p], total: 1, repeats: 1 });
    return send(200, { ok: true, patient: p, via: "message" });
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
