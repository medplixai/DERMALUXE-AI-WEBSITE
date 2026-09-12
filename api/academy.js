// api/academy.js — DermaLuxe Academy student lifecycle.
//   student record  → KV acad:st:<id>   (index list acad:st:list)
//   documents       → rendered by _docs.js, stored in KV acad:doc:<docId>, served by /api/doc
//   delivery        → WhatsApp (notify.sendWaDocLink / sendWaImageLink / sendWa)
//
// Public   : ?a=form&t=<token>          — onboarding form data  (academy-join.html)
//            POST a=submit {t, ...}     — student fills the form → docs generated & sent
// Staff    : Bearer token from /api/staff → list, create, pay, send, certify, status
const crypto = require("crypto");
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const docs = require("./_docs.js");

const BASE = "https://www.dermaluxe.ai";
const LIST = "acad:st:list";
const DOC_TTL = 60 * 60 * 24 * 180;     // 180 days
const json = (res, c, o) => { res.setHeader("Cache-Control", "no-store"); return res.status(c).json(o); };
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const secret = () => process.env.STAFF_SECRET || process.env.ADMIN_KEY || process.env.WA_WEBHOOK_TOKEN || "";
const sign = (p) => crypto.createHmac("sha256", secret()).update(p).digest("hex");
const linkToken = (id) => `${id}.${sign("acad:" + id).slice(0, 24)}`;
const checkToken = (t) => {
  const [id, sig] = String(t || "").split(".");
  return id && sig && guard.safeEqual(sig, sign("acad:" + id).slice(0, 24)) ? id : null;
};
function staffUser(req) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const [payload, sig] = tok.split(".");
  if (!payload || !sig || !secret() || !guard.safeEqual(sig, sign(payload))) return null;
  try { const u = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); return u.exp > Date.now() ? { phone: u.p, name: u.n, role: u.r } : null; } catch (e) { return null; }
}

const getSt = async (cfg, id) => { const r = await guard.kvCommand(cfg, ["GET", `acad:st:${id}`]).catch(() => ({})); try { return r.result ? JSON.parse(r.result) : null; } catch (e) { return null; } };
const putSt = (cfg, s) => guard.kvCommand(cfg, ["SET", `acad:st:${s.id}`, JSON.stringify(s)]);

async function saveDoc(cfg, b64, kind, name) {
  const id = crypto.randomBytes(16).toString("hex");
  await guard.kvCommand(cfg, ["SET", `acad:doc:${id}`, JSON.stringify({ t: kind, b: b64, n: name }), "EX", String(DOC_TTL)]);
  return { id, url: `${BASE}/api/doc?id=${id}`, name };
}
// Build + store the documents a student needs. which: receipt|admission|idcard|certificate
async function buildDocs(cfg, s, which, extra = {}) {
  const out = {};
  if (which.includes("receipt")) {
    const p = extra.payment || { no: `DLA-R-${s.id}`, amount: s.paid || 9999, mode: s.payMode || "UPI", ref: s.payRef || "", label: extra.label || "Seat reservation advance", ts: s.paidOn || Date.now() };
    out.receipt = await saveDoc(cfg, await docs.renderPdf(docs.receiptHtml(s, p), "a4"), "pdf", `DermaLuxe-Receipt-${s.id}.pdf`);
  }
  if (which.includes("admission")) out.admission = await saveDoc(cfg, await docs.renderPdf(docs.admissionHtml(s), "a4"), "pdf", `DermaLuxe-Admission-${s.id}.pdf`);
  if (which.includes("idcard")) out.idcard = await saveDoc(cfg, await docs.renderImage(docs.idCardHtml(s), 454, 371), "jpg", `DermaLuxe-IDCard-${s.id}.jpg`);
  if (which.includes("certificate")) out.certificate = await saveDoc(cfg, await docs.renderPdf(docs.certificateHtml(s), "a4l"), "pdf", `DermaLuxe-Certificate-${s.id}.pdf`);
  s.files = Object.assign({}, s.files, out);
  await putSt(cfg, s);
  return out;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });
  if (!secret()) return json(res, 501, { error: "STAFF_SECRET not configured" });
  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "");

  // ---------- public: onboarding form ----------
  if (a === "form") {
    const id = checkToken(q.t);
    if (!id) return json(res, 403, { error: "Invalid or expired link" });
    const s = await getSt(cfg, id);
    if (!s) return json(res, 404, { error: "Student not found" });
    const c = docs.course(s);
    return json(res, 200, { ok: true, id: s.id, name: s.name || "", phone: s.phone || "", course: s.course, courseName: c.name, courseTe: c.te,
      duration: s.duration || "1 month", fee: s.fee || c.offer, paid: s.paid || 0, batch: docs.BATCH, done: !!s.onboarded });
  }
  if (a === "submit") {
    if (req.method !== "POST") return json(res, 405, { error: "POST" });
    const id = checkToken(b.t);
    if (!id) return json(res, 403, { error: "Invalid or expired link" });
    const rl = await guard.rateLimit(cfg, `rl:acj:${guard.getIp(req)}`, 20, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many submissions — try later" });
    const s = await getSt(cfg, id);
    if (!s) return json(res, 404, { error: "Student not found" });
    const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
    if (!str(b.name, 80) || !/^[6-9]\d{9}$/.test(digits10(b.phone))) return json(res, 400, { error: "Name and a valid 10-digit mobile number are required" });
    Object.assign(s, {
      name: str(b.name, 80), guardian: str(b.guardian, 80), dob: str(b.dob, 20), gender: str(b.gender, 12),
      phone: digits10(b.phone), emergency: digits10(b.emergency), email: str(b.email, 80), address: str(b.address, 220),
      qualification: str(b.qualification, 80), background: str(b.background, 120), experience: str(b.experience, 40),
      idproof: str(b.idproof, 40), blood: str(b.blood, 6), duration: str(b.duration, 20) || s.duration || "1 month",
      docs: { photo: !!b.docPhoto, id: !!b.docId, qualification: !!b.docQual, experience: !!b.docExp, signed: false },
      onboarded: Date.now(), status: s.status === "enquiry" ? "enrolled" : (s.status || "enrolled"),
    });
    if (b.photo && /^data:image\/(jpe?g|png);base64,/.test(String(b.photo)) && String(b.photo).length < 900000) s.photo = String(b.photo);
    await putSt(cfg, s);
    // documents + WhatsApp delivery (best effort; form must not fail on send errors)
    let built = {};
    try {
      built = await buildDocs(cfg, s, ["receipt", "admission", "idcard"]);
      const c = docs.course(s), bal = Math.max(0, (s.fee || c.offer) - (s.paid || 0));
      await notify.sendWa(s.phone, `🎓 *Welcome to DermaLuxe Academy, ${s.name.split(" ")[0]}!*\n\nMee onboarding form submit ayindi ✅\n\n📚 Course: *${c.name}* (${s.duration})\n🗓 Batch ${docs.BATCH.no} — starts *${docs.BATCH.start}*\n🆔 Student ID: *${s.id}*\n💰 Paid: ₹${(s.paid || 0).toLocaleString("en-IN")} · Balance: ₹${bal.toLocaleString("en-IN")} (course starting roju)\n\nMee documents ikkada pampistunnanu 👇`);
      if (built.receipt) await notify.sendWaDocLink(s.phone, built.receipt.url, built.receipt.name, "🧾 Payment receipt · రసీదు");
      if (built.admission) await notify.sendWaDocLink(s.phone, built.admission.url, built.admission.name, "📋 Admission form — print chesi sign chesi first day teesukuni randi.\nఅడ్మిషన్ ఫారం — ప్రింట్ చేసి సంతకం చేసి తీసుకురండి.");
      if (built.idcard) await notify.sendWaImageLink(s.phone, built.idcard.url, `🆔 Mee student ID card — ${s.id}. First day ki print chesi teesukuni randi.`);
      await notify.sendWa(s.phone, `📄 *First day ki teesukuni raavalsinavi:*\n• Signed admission form (print)\n• 2 passport photos\n• Aadhaar/ID proof copy\n• Qualification certificate copy\n• Balance fee ₹${bal.toLocaleString("en-IN")}\n\n📍 ${docs.BRAND.addr}\n🕘 Mon–Sat · Sunday holiday\n\nRoju training material & tips ikkade WhatsApp lo vastayi 📚 Ready ga undandi!`);
    } catch (e) { console.error("academy: docs/send", e && e.message); }
    const admins = String(process.env.ADMIN_PHONES || "").split(",").map((x) => digits10(x)).filter(Boolean);
    for (const ph of admins) notify.sendWa(ph, `🎓 *Academy onboarding complete*\n${s.name} (${s.phone}) · ${docs.course(s).name} · ID ${s.id}\nPaid ₹${(s.paid || 0).toLocaleString("en-IN")} · Balance ₹${Math.max(0, (s.fee || docs.course(s).offer) - (s.paid || 0)).toLocaleString("en-IN")}`).catch(() => {});
    return json(res, 200, { ok: true, id: s.id, files: built });
  }

  // ---------- staff ----------
  const me = staffUser(req);
  if (!me) return json(res, 401, { error: "Login required" });
  if (a === "list") {
    const r = await guard.kvCommand(cfg, ["LRANGE", LIST, "0", "299"]).catch(() => ({}));
    const ids = r.result || [];
    const students = [];
    for (const id of ids) { const s = await getSt(cfg, id); if (s) students.push(s); }
    return json(res, 200, { ok: true, students, batch: docs.BATCH, courses: docs.COURSES });
  }
  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rl = await guard.rateLimit(cfg, `rl:aca:${me.phone}`, 300, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

  if (a === "create") {
    const name = String(b.name || "").trim().slice(0, 80), phone = digits10(b.phone);
    const cKey = ["skin", "hair", "both"].includes(String(b.course)) ? String(b.course) : "skin";
    if (!name || !/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Name + valid 10-digit mobile required" });
    const seq = await guard.kvCommand(cfg, ["INCR", "acad:seq"]).catch(() => ({ result: Date.now() % 10000 }));
    const id = "DLA-" + String(1000 + Number(seq.result || 1)).slice(-4);
    const c = docs.COURSES[cKey];
    const s = { id, name, phone, course: cKey, duration: String(b.duration || "1 month"), fee: Number(b.fee || c.offer),
      paid: Number(b.paid || 0), paidOn: b.paid ? Date.now() : null, payMode: String(b.payMode || "UPI"), payRef: String(b.payRef || "").slice(0, 40),
      status: "enrolled", batch: docs.BATCH.no, created: Date.now(), createdBy: me.name, joined: Date.now(), validTill: "31 Dec 2026", files: {} };
    await putSt(cfg, s);
    await guard.kvCommand(cfg, ["LPUSH", LIST, id]);
    const url = `${BASE}/academy-join.html?t=${linkToken(id)}`;
    const bal = Math.max(0, s.fee - s.paid);
    await notify.sendWa(phone, `🎓 *Welcome to DermaLuxe Academy!*\n\n${name} garu, mee seat ${docs.COURSES[cKey].name} (${s.duration}) ki reserve ayindi ✅\n🆔 Student ID: *${id}*\n🗓 Batch ${docs.BATCH.no} — starts *${docs.BATCH.start}*\n💰 Paid ₹${s.paid.toLocaleString("en-IN")} · Balance ₹${bal.toLocaleString("en-IN")} (course starting roju)\n\n📝 *Onboarding form fill cheyandi* (2 nimishalu):\n${url}\n\nForm submit chesaka receipt, admission form, ID card anni ikkade vastayi 📄`);
    if (s.paid > 0) { try { const f = await buildDocs(cfg, s, ["receipt"]); if (f.receipt) await notify.sendWaDocLink(phone, f.receipt.url, f.receipt.name, "🧾 Advance payment receipt · రసీదు"); } catch (e) { console.error("receipt", e && e.message); } }
    return json(res, 200, { ok: true, student: s, formUrl: url });
  }

  const s = await getSt(cfg, String(b.id || ""));
  if (!s) return json(res, 404, { error: "Student not found" });

  if (a === "pay") {
    const amt = Number(b.amount || 0);
    if (!(amt > 0)) return json(res, 400, { error: "amount required" });
    s.paid = Number(s.paid || 0) + amt; s.paidOn = Date.now(); s.payMode = String(b.mode || s.payMode || "UPI"); s.payRef = String(b.ref || "").slice(0, 40);
    s.payments = (s.payments || []).concat([{ amount: amt, mode: s.payMode, ref: s.payRef, ts: Date.now(), by: me.name }]);
    if (s.paid >= (s.fee || 0)) s.feeCleared = true;
    await putSt(cfg, s);
    const f = await buildDocs(cfg, s, ["receipt"], { payment: { no: `DLA-R-${s.id}-${s.payments.length}`, amount: amt, mode: s.payMode, ref: s.payRef, label: b.label || (s.feeCleared ? "Course fee (balance)" : "Part payment"), ts: Date.now() } });
    if (f.receipt) await notify.sendWaDocLink(s.phone, f.receipt.url, f.receipt.name, `🧾 Receipt — ₹${amt.toLocaleString("en-IN")} received. ${s.feeCleared ? "Fee fully paid ✅" : "Balance ₹" + Math.max(0, s.fee - s.paid).toLocaleString("en-IN")}`);
    return json(res, 200, { ok: true, student: s, receipt: f.receipt });
  }
  if (a === "send") {
    const which = Array.isArray(b.which) ? b.which : [String(b.which || "admission")];
    const f = await buildDocs(cfg, s, which);
    for (const k of which) {
      const d = f[k]; if (!d) continue;
      if (k === "idcard") await notify.sendWaImageLink(s.phone, d.url, `🆔 Mee student ID card — ${s.id}`);
      else await notify.sendWaDocLink(s.phone, d.url, d.name, k === "certificate" ? "🎓 Mee DermaLuxe Academy certificate — congratulations!" : k === "receipt" ? "🧾 Payment receipt" : "📋 Admission form");
    }
    return json(res, 200, { ok: true, files: f });
  }
  if (a === "certify") {
    if (me.role !== "owner") return json(res, 403, { error: "Owner only" });
    const seq = await guard.kvCommand(cfg, ["INCR", "acad:certseq"]).catch(() => ({ result: 1 }));
    s.certNo = `DLA/2026/${String(1000 + Number(seq.result || 1)).slice(-4)}`;
    s.grade = String(b.grade || "A").slice(0, 3); s.issued = Date.now(); s.status = "completed";
    await putSt(cfg, s);
    const f = await buildDocs(cfg, s, ["certificate"]);
    if (f.certificate) {
      await notify.sendWa(s.phone, `🎉 *Congratulations ${s.name.split(" ")[0]} garu!*\n\nMeeru ${docs.course(s).name} course successfully complete chesaru 🎓\nCertificate No: *${s.certNo}* · Grade: *${s.grade}*\n\nMee certificate ikkada 👇`);
      await notify.sendWaDocLink(s.phone, f.certificate.url, f.certificate.name, "🎓 DermaLuxe Academy — Certificate of Completion");
      await notify.sendWa(s.phone, `💼 Job opportunities mana clinics lo unnayi — interested ayithe ikkade reply cheyandi.\nAlumni group lo kotha protocols, refresher sessions & job openings share chestam. All the best! 🌟`);
    }
    return json(res, 200, { ok: true, student: s, certificate: f.certificate });
  }
  if (a === "status") {
    const st = String(b.status || "");
    if (!["enquiry", "enrolled", "active", "completed", "dropped"].includes(st)) return json(res, 400, { error: "bad status" });
    s.status = st; await putSt(cfg, s);
    return json(res, 200, { ok: true, student: s });
  }
  if (a === "link") return json(res, 200, { ok: true, url: `${BASE}/academy-join.html?t=${linkToken(s.id)}` });
  if (a === "note") {
    const t = String(b.text || "").trim().slice(0, 300);
    if (t) { s.notes = [{ ts: Date.now(), by: me.name, text: t }].concat(s.notes || []).slice(0, 30); await putSt(cfg, s); }
    return json(res, 200, { ok: true, notes: s.notes || [] });
  }
  if (a === "delete") {
    if (me.role !== "owner") return json(res, 403, { error: "Owner only" });
    await guard.kvCommand(cfg, ["LREM", LIST, "1", s.id]).catch(() => {});
    await guard.kvCommand(cfg, ["DEL", `acad:st:${s.id}`]).catch(() => {});
    return json(res, 200, { ok: true });
  }
  return json(res, 400, { error: "Unknown action" });
};
module.exports.linkToken = linkToken;
module.exports.buildDocs = buildDocs;
module.exports.getSt = getSt;
module.exports.putSt = putSt;
