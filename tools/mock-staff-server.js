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

const CAPS = ["leads.view", "leads.edit", "appts.view", "appts.edit", "academy.view", "academy.edit",
  "posts.view", "reviews.view", "reports.view", "money.view", "money.bill", "pkg.log", "ai.use", "msg.send", "team.manage", "settings.manage"];

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
  if (u.pathname === "/api/patient") {  // pt-msg-mock
    const a = u.searchParams.get("a") || "list";
    const p = { phone: "9876543210", name: "Sita Rani", since: Date.now() - 86400000 * 40, allergies: "",
      counts: { visits: 3, booked: 1, photos: 0, upcoming: 0 }, photos: [], visits: [], notes: [], appts: [] };
    if (a === "list") return send(200, { ok: true, rows: [p] });
    return send(200, { ok: true, patient: p, via: "message" });
  }
  if (u.pathname.startsWith("/api/")) return send(200, { ok: true, rows: [], photos: [], days: [], team: [] });

  let f = u.pathname === "/" ? "/staff.html" : u.pathname;
  const file = path.join(ROOT, f.replace(/^\/+/, ""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log("mock staff dashboard on http://localhost:" + PORT + " (" + TOTAL + " leads)"));
