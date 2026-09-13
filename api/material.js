// GET /api/material?t=<token>&track=skin|hair&day=N   → that day's study material
// GET /api/material?t=<token>&book=full|skin|hair     → full book / trainer manual
//
// Access is granted only to:
//   • students whose record shows a payment (paid > 0)  — token = <studentId>.<hmac>
//   • trainers listed in ACADEMY_TRAINER_PHONES         — token = t<phone>.<hmac>
//   • logged-in staff (Bearer token from /api/staff)
// The public path /assets/academy/material/* is blocked by a redirect in vercel.json,
// so these PDFs can only be reached through this endpoint.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const guard = require("./_guard.js");

// The PDFs travel with this function via functions.includeFiles in vercel.json.
// Vercel can mount the bundle at a couple of different roots, so probe a few.
const REL = ["assets", "academy", "material"];
const CANDIDATES = [path.join(__dirname, "..", ...REL), path.join(process.cwd(), ...REL), path.join("/var/task", ...REL), path.join(__dirname, ...REL)];
let _dir;
function dir() {
  if (_dir !== undefined) return _dir;
  _dir = CANDIDATES.find((d) => { try { return fs.existsSync(path.join(d, "skin-day-01.pdf")); } catch (e) { return false; } }) || null;
  if (!_dir) console.error("material: bundle dir not found, tried", CANDIDATES.join(" | "));
  return _dir;
}
const secret = () => process.env.STAFF_SECRET || process.env.ADMIN_KEY || process.env.WA_WEBHOOK_TOKEN || "";
const sign = (p) => crypto.createHmac("sha256", secret()).update(p).digest("hex");
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const trainerPhones = () => (process.env.ACADEMY_TRAINER_PHONES ? String(process.env.ACADEMY_TRAINER_PHONES).split(",").map(digits10).filter((x) => x.length === 10) : guard.ownerPhones());

function staffUser(req) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const [payload, sig] = tok.split(".");
  if (!payload || !sig || !secret() || !guard.safeEqual(sig, sign(payload))) return null;
  try { const u = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); return u.exp > Date.now() ? u : null; } catch (e) { return null; }
}
const deny = (res, msg) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(403).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DermaLuxe Academy — material</title>
<body style="margin:0;background:#0d0d0f;color:#ece9e3;font-family:Jost,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">
<div style="max-width:460px"><div style="font-size:2.4rem">🔒</div>
<h1 style="font-family:Georgia,serif;font-size:1.7rem;color:#f4e2b8;margin:10px 0">Study material is for enrolled students</h1>
<p style="color:#a39e95;line-height:1.6">${msg}</p>
<p style="color:#c6a25c;font-family:'Noto Sans Telugu',sans-serif;line-height:1.7;margin-top:8px">ఈ మెటీరియల్ కోర్సు ఫీజు చెల్లించిన స్టూడెంట్స్‌కి మాత్రమే. అడ్మిషన్ కోసం WhatsApp చేయండి.</p>
<p style="margin-top:20px"><a href="/r/academy" style="background:linear-gradient(135deg,#f6e6bd,#c79a4e);color:#2a1d07;text-decoration:none;padding:12px 22px;border-radius:100px;font-weight:600">💬 WhatsApp 99591 34666</a></p>
<p style="margin-top:14px"><a href="/academy.html" style="color:#e9cf8f">DermaLuxe Academy — course details →</a></p></div></body>`);
};

module.exports = async (req, res) => {
  const q = req.query || {};
  if (q.diag === "1") {   // harmless health check: can this function see the PDFs?
    const d = dir();
    let n = 0; try { n = d ? fs.readdirSync(d).filter((f) => f.endsWith(".pdf")).length : 0; } catch (e) {}
    return res.status(200).json({ ok: !!d, files: n, dir: d ? "found" : "missing" });
  }
  if (!secret()) return deny(res, "Material access is not configured yet.");
  const cfg = guard.kvConfig();
  // k=<token>~<track>~<day>  — one value, so a WhatsApp dynamic URL button can carry it
  if (q.k && !q.t) {
    const parts = String(q.k).split("~");
    q.t = parts[0] || "";
    if (parts[1] === "skin" || parts[1] === "hair") q.track = parts[1];
    else if (parts[1] === "full" || parts[1] === "bskin" || parts[1] === "bhair") q.book = parts[1].replace(/^b/, "");
    if (parts[2]) q.day = parts[2];
  }
  const t = String(q.t || "");
  const [id, sig] = t.split(".");
  let who = null;

  // A staff token alone is not enough: the person must still exist, still be
  // active, and still hold academy.material. A 30-day token from someone who
  // has since been suspended or removed used to open the whole library.
  const staff = staffUser(req);
  if (staff && cfg) {
    try {
      const staffMod = require("./staff.js");
      const roles = await staffMod.loadRoles(cfg);
      const live = await staffMod.liveUser(cfg, digits10(staff.p), roles);
      if (live && !live.off) {
        const caps = staffMod.effCaps(roles, live);
        const has = (c) => caps.includes("*") || caps.includes(c);
        if (has("academy.material")) who = { kind: "staff", name: live.name, full: has("academy.certify") || has("*") };
      }
    } catch (e) { console.error("material: staff check failed", e && e.message); }
    if (!who) return deny(res, "Mee login ki course material access ledu. Owner ni adagandi.");
  }
  else if (id && sig && guard.safeEqual(sig, sign("acad:" + id).slice(0, 24))) {
    if (id[0] === "t") {                                   // trainer token  t<phone>.<sig>
      const ph = digits10(id.slice(1));
      if (trainerPhones().includes(ph)) who = { kind: "trainer", name: ph };
    } else if (cfg) {                                      // student token  DLA-xxxx.<sig>
      const r = await guard.kvCommand(cfg, ["GET", `acad:st:${id}`]).catch(() => ({}));
      let s = null; try { s = r.result ? JSON.parse(r.result) : null; } catch (e) {}
      if (!s) return deny(res, "This link is not valid any more. Please contact the academy team.");
      if (!(Number(s.paid) > 0)) return deny(res, "Your seat payment is not recorded yet. Once the advance is paid, your study material unlocks automatically.");
      if (["dropped", "enquiry"].includes(String(s.status))) return deny(res, "This account is not active for study material. Please contact the academy team.");
      who = { kind: "student", name: s.id, course: s.course };
    }
  }
  if (!who) return deny(res, "This download link is only for enrolled students, trainers and clinic staff. Please open the link we sent you on WhatsApp.");

  // ---- resolve the file ----
  const book = String(q.book || "");
  let file = null, nice = null;
  if (book) {
    if (who.kind === "student")
      return deny(res, "The complete book is for trainers. Your day-by-day material is sent to you on WhatsApp every training morning.");
    if (who.kind === "staff" && !who.full)
      return deny(res, "Trainer manual trainers ki matrame. Mee login ki roju-vaari material link matrame undi.");
    if (book === "full") { file = "full-30-day-study-material.pdf"; nice = "DermaLuxe-Academy-30-Day-Study-Material-Skin-and-Hair.pdf"; }
    else if (book === "skin" || book === "hair") { file = `${book}-trainer-manual.pdf`; nice = `DermaLuxe-Academy-${book === "skin" ? "Skin" : "Hair"}-30-Day-Manual.pdf`; }
  } else {
    const track = q.track === "hair" ? "hair" : "skin";
    const dayNum = Number(q.day);
    if (q.day !== undefined && (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 30))
      return deny(res, "That day does not exist — material runs from day 1 to day 30.");
    const day = Number.isFinite(dayNum) ? Math.max(1, Math.min(30, dayNum)) : 1;
    if (who.kind === "student" && who.course && who.course !== "both" && who.course !== track)
      return deny(res, "This material belongs to the other specialisation. Please open the link sent for your course.");
    file = `${track}-day-${String(day).padStart(2, "0")}.pdf`;
    nice = `DermaLuxe-${track === "skin" ? "Skin" : "Hair"}-Day-${String(day).padStart(2, "0")}.pdf`;
  }
  if (!file) return deny(res, "Unknown material requested.");

  try {
    const base = dir();
    if (!base) return res.status(500).send("Material bundle unavailable — contact the team");
    const full = path.join(base, file);
    const st = fs.statSync(full);
    if (st.size > 4200000) {                       // Vercel caps a function response at 4.5 MB
      if (book === "full") return deny(res, "The complete book is too large to send here — please use the Skin and Hair manuals sent to you on WhatsApp.");
      return res.status(503).send("This file is too large to serve — please contact the academy team.");
    }
    const buf = fs.readFileSync(full);
    if (cfg && who.kind === "student") guard.kvCommand(cfg, ["LPUSH", "acad:dl", JSON.stringify({ id: who.name, file, ts: Date.now() })]).then(() => guard.kvCommand(cfg, ["LTRIM", "acad:dl", "0", "999"])).catch(() => {});
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `inline; filename="${nice}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.status(200).end(buf);
  } catch (e) {
    console.error("material: read failed", file, e && e.message);
    return res.status(404).send("Material not found");
  }
};
