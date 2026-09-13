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

// A free-form WhatsApp message only delivers inside the 24-hour customer window.
// Try it; if the window is shut, open it with an approved template so the student
// replies and the pending item is delivered by api/whatsapp.js.
async function waSend(cfg, s, text, templateLine, tpl) {
  const first = String(s.name || "Student").trim().split(" ")[0] || "Student";
  if (await notify.sendWa(s.phone, text)) return true;
  if (tpl) { const r = await notify.sendAcademyTemplate(s.phone, tpl.name, tpl.params, tpl.urlSuffix, templateLine); return !!(r && r.ok); }
  const t = await notify.sendWaTemplate(s.phone, "clinic_update", [first, String(templateLine || "DermaLuxe Academy nunchi meeku oka update undi — 'hi' ani reply cheyandi.").slice(0, 250)]);
  return !!(t && t.ok);
}
// A document we just generated: normal send, else the academy_document template
// (its URL button opens /api/doc, so it works outside the 24-hour window).
async function sendDoc(s, d, caption, label) {
  if (!d) return false;
  const first = String(s.name || "Student").trim().split(" ")[0] || "Student";
  const ok = /\.jpg$/i.test(d.name) ? await notify.sendWaImageLink(s.phone, d.url, caption) : await notify.sendWaDocLink(s.phone, d.url, d.name, caption);
  if (ok) return true;
  const r = await notify.sendAcademyTemplate(s.phone, "academy_document", [first, label || "document", s.id], d.id,
    `Mee ${label || "document"} ready — 'hi' ani reply cheyandi, pampistam.`);
  return !!(r && r.ok);
}
const getSt = async (cfg, id) => { const r = await guard.kvCommand(cfg, ["GET", `acad:st:${id}`]).catch(() => ({})); try { return r.result ? JSON.parse(r.result) : null; } catch (e) { return null; } };
async function putSt(cfg, s) {
  const r = await guard.kvCommand(cfg, ["SET", `acad:st:${s.id}`, JSON.stringify(s)]);
  if (!r || r.error) throw new Error("Could not save the student record (storage)");
  if (s.phone) await guard.kvCommand(cfg, ["SET", `acad:ph:${digits10(s.phone)}`, s.id, "EX", "31536000"]).catch(() => {});
  return r;
}

async function saveDoc(cfg, b64, kind, name) {
  const id = crypto.randomBytes(16).toString("hex");
  const r = await guard.kvCommand(cfg, ["SET", `acad:doc:${id}`, JSON.stringify({ t: kind, b: b64, n: name }), "EX", String(DOC_TTL)]);
  if (!r || r.error) throw new Error("Document storage failed for " + name);
  return { id, url: `${BASE}/api/doc?id=${id}`, name };
}
// Build + store the documents a student needs. which: receipt|admission|idcard|certificate
async function buildDocs(cfg, s, which, extra = {}) {
  const jobs = [];
  if (which.includes("receipt")) {
    const amt = extra.payment ? Number(extra.payment.amount) : Number(s.paid || 0);
    if (amt > 0) {
      const seq = (s.payments || []).length || 1;
      const p = extra.payment || { no: `R-${s.id}-${seq}`, amount: amt, mode: s.payMode || "UPI", ref: s.payRef || "", label: extra.label || "Seat reservation advance", ts: s.paidOn || Date.now() };
      if (!p.no) p.no = `R-${s.id}-${seq}`;
      jobs.push({ key: "receipt", html: docs.receiptHtml(s, p), kind: "a4", name: `DermaLuxe-Receipt-${s.id}-${seq}.pdf`, type: "pdf" });
    }
  }
  if (which.includes("admission")) jobs.push({ key: "admission", html: docs.admissionHtml(s), kind: "a4", name: `DermaLuxe-Admission-${s.id}.pdf`, type: "pdf" });
  if (which.includes("idcard")) jobs.push({ key: "idcard", html: docs.idCardHtml(s), kind: "jpg", w: 454, h: 371, name: `DermaLuxe-IDCard-${s.id}.jpg`, type: "jpg" });
  if (which.includes("certificate")) jobs.push({ key: "certificate", html: docs.certificateHtml(s), kind: "a4l", name: `DermaLuxe-Certificate-${s.id}.pdf`, type: "pdf" });
  if (!jobs.length) return {};
  const rendered = await docs.renderBatch(jobs);      // one browser for all of them
  const out = {};
  for (const j of jobs) if (rendered[j.key]) out[j.key] = await saveDoc(cfg, rendered[j.key], j.type, j.name);
  s.files = Object.assign({}, s.files, out);
  await putSt(cfg, s);
  return out;
}
const adminPhones = () => guard.ownerPhones();
async function alertAdmins(text) { await Promise.allSettled(adminPhones().map((ph) => notify.sendWa(ph, text))); }

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
    if (s.onboarded) return json(res, 409, { error: "Ee form already submit ayindi. Emaina marchalante mana team ki WhatsApp cheyandi." });
    const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
    if (!str(b.name, 80) || !/^[6-9]\d{9}$/.test(digits10(b.phone))) return json(res, 400, { error: "Name and a valid 10-digit mobile number are required" });
    Object.assign(s, {
      name: str(b.name, 80), guardian: str(b.guardian, 80), dob: str(b.dob, 20), gender: str(b.gender, 12),
      phone: digits10(b.phone), emergency: digits10(b.emergency), email: str(b.email, 80), address: str(b.address, 220),
      qualification: str(b.qualification, 80), background: str(b.background, 120), experience: str(b.experience, 40),
      idproof: str(b.idproof, 40), blood: str(b.blood, 6), duration: str(b.duration, 20) || s.duration || "1 month",
      docs: { photo: !!b.docPhoto, id: !!b.docId, qualification: !!b.docQual, experience: !!b.docExp, signed: false },
      status: s.status === "enquiry" ? "enrolled" : (s.status || "enrolled"),
    });
    if (b.photo && /^data:image\/(jpe?g|png);base64,/.test(String(b.photo)) && String(b.photo).length < 260000) s.photo = String(b.photo);
    await putSt(cfg, s);
    // documents + WhatsApp delivery (best effort; form must not fail on send errors)
    let built = {};
    try {
      built = await buildDocs(cfg, s, ["receipt", "admission", "idcard"]);
      s.onboarded = Date.now(); await putSt(cfg, s);
      const c = docs.course(s), bal = Math.max(0, (s.fee || c.offer) - (s.paid || 0));
      await waSend(cfg, s, `🎓 *Welcome to DermaLuxe Academy, ${s.name.split(" ")[0]}!*\n\nMee onboarding form submit ayindi ✅\n\n📚 Course: *${c.name}* (${s.duration})\n🗓 Batch ${docs.BATCH.no} — starts *${docs.BATCH.start}*\n🆔 Student ID: *${s.id}*\n💰 Paid: ₹${(s.paid || 0).toLocaleString("en-IN")} · Balance: ₹${bal.toLocaleString("en-IN")} (course starting roju)\n\nMee documents ikkada pampistunnanu 👇`, "Mee academy documents ready — 'hi' ani reply cheyandi, receipt & ID card pampistam.");
      if (built.receipt) await sendDoc(s, built.receipt, "🧾 Payment receipt · రసీదు", "payment receipt");
      if (built.admission) await sendDoc(s, built.admission, "📋 Admission form — print chesi sign chesi first day teesukuni randi.\nఅడ్మిషన్ ఫారం — ప్రింట్ చేసి సంతకం చేసి తీసుకురండి.", "admission form");
      if (built.idcard) await sendDoc(s, built.idcard, `🆔 Mee student ID card — ${s.id}. First day ki print chesi teesukuni randi.`, "student ID card");
      await waSend(cfg, s, `📄 *First day ki teesukuni raavalsinavi:*\n• Signed admission form (print)\n• 2 passport photos\n• Aadhaar/ID proof copy\n• Qualification certificate copy\n• Balance fee ₹${bal.toLocaleString("en-IN")}\n\n📍 ${docs.BRAND.addr}\n🕘 Mon–Sat · Sunday holiday\n\nRoju training material & tips ikkade WhatsApp lo vastayi 📚 Ready ga undandi!`, "First day checklist pampanu — 'hi' ani reply cheyandi.");
    } catch (e) {
      console.error("academy: docs/send", e && e.message);
      s.docsPending = true; await putSt(cfg, s).catch(() => {});
      await alertAdmins(`⚠️ *Academy: documents failed*\n${s.name} (${s.phone}) · ID ${s.id}\nForm submit ayindi kani receipt/admission/ID card generate avvaledu.\nError: ${(e && e.message) || "unknown"}\nDashboard → Students → "Resend docs" tho malli try cheyandi.`);
    }
    await alertAdmins(`🎓 *Academy onboarding complete*\n${s.name} (${s.phone}) · ${docs.course(s).name} · ID ${s.id}\nPaid ₹${(s.paid || 0).toLocaleString("en-IN")} · Balance ₹${Math.max(0, (s.fee || docs.course(s).offer) - (s.paid || 0)).toLocaleString("en-IN")}`);
    return json(res, 200, { ok: true, id: s.id, files: built });
  }

  // ---------- staff ----------
  const me = staffUser(req);
  if (!me) return json(res, 401, { error: "Login required" });
  // Live powers, not the ones frozen into the login token: a role edit or a
  // revoked capability in the Control panel applies here on the next request.
  const staffMod = require("./staff.js");
  const liveMe = await staffMod.liveUser(cfg, me.phone);
  if (!liveMe) return json(res, 403, { error: "Access removed" });
  if (liveMe.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
  const caps = await staffMod.capsFor(cfg, liveMe);
  const can = (c) => caps.includes("*") || caps.includes(c);
  if (!can("academy.view")) return json(res, 403, { error: "Mee role ki academy access ledu" });
  if (["create", "pay", "send", "status", "note", "link", "material", "reopen"].includes(a) && !can("academy.edit"))
    return json(res, 403, { error: "Mee role ki academy lo marpulu chese permission ledu" });
  if (a === "certify" && !can("academy.certify")) return json(res, 403, { error: "Certificate ivvagaligedi owner/manager matrame" });
  if (a === "list") {
    const rl0 = await guard.rateLimit(cfg, `rl:acl:${me.phone}`, 120, 3600);
    if (!rl0.allowed) return json(res, 429, { error: "Too many requests" });
    const r = await guard.kvCommand(cfg, ["LRANGE", LIST, "0", "299"]).catch(() => ({}));
    const students = [];
    for (const id of (r.result || [])) {
      const s = await getSt(cfg, id);
      if (!s) continue;
      students.push({ id: s.id, name: s.name, phone: s.phone, course: s.course, duration: s.duration, status: s.status,
        fee: s.fee, paid: s.paid, batch: s.batch, created: s.created, onboarded: s.onboarded, startISO: s.startISO,
        certNo: s.certNo, grade: s.grade, docsPending: !!s.docsPending, notes: (s.notes || []).slice(0, 3) });
    }
    return json(res, 200, { ok: true, students, batch: docs.BATCH, courses: docs.COURSES });
  }
  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rl = await guard.rateLimit(cfg, `rl:aca:${me.phone}`, 300, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

  if (a === "create") {
    const name = String(b.name || "").trim().slice(0, 80), phone = digits10(b.phone);
    const cKey = ["skin", "hair", "both"].includes(String(b.course)) ? String(b.course) : "skin";
    if (!name || !/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Name + valid 10-digit mobile required" });
    const c = docs.COURSES[cKey];
    const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
    let id = "";
    for (let i = 0; i < 6 && !id; i++) {
      const seq = await guard.kvCommand(cfg, ["INCR", "acad:seq"]).catch(() => ({}));
      const cand = "DLA-" + String(1000 + Number(seq && seq.result ? seq.result : Math.floor(Math.random() * 8999) + 1)).slice(-4);
      if (!(await getSt(cfg, cand))) id = cand;
    }
    if (!id) return json(res, 500, { error: "Could not allocate a student ID — try again" });
    const paid0 = Math.min(num(b.paid, 0), 1000000);
    const s = { id, name, phone, course: cKey, duration: String(b.duration || "1 month"), fee: num(b.fee, c.offer),
      paid: paid0, paidOn: paid0 ? Date.now() : null, payMode: String(b.payMode || "UPI"), payRef: String(b.payRef || "").slice(0, 40),
      payments: paid0 ? [{ amount: paid0, mode: String(b.payMode || "UPI"), ref: String(b.payRef || "").slice(0, 40), ts: Date.now(), by: me.name }] : [],
      status: "enrolled", batch: docs.BATCH.no, startISO: String(b.startISO || docs.BATCH.startISO),
      created: Date.now(), createdBy: me.name, joined: Date.now(), validTill: "31 Dec 2026", files: {} };
    await putSt(cfg, s);
    await guard.kvCommand(cfg, ["LPUSH", LIST, id]);
    const url = `${BASE}/academy-join.html?t=${linkToken(id)}`;
    const bal = Math.max(0, s.fee - s.paid);
    await waSend(cfg, s, `🎓 *Welcome to DermaLuxe Academy!*\n\n${name} garu, mee seat ${docs.COURSES[cKey].name} (${s.duration}) ki reserve ayindi ✅\n🆔 Student ID: *${id}*\n🗓 Batch ${docs.BATCH.no} — starts *${docs.BATCH.start}*\n💰 Paid ₹${s.paid.toLocaleString("en-IN")} · Balance ₹${bal.toLocaleString("en-IN")} (course starting roju)\n\n📝 *Onboarding form fill cheyandi* (2 nimishalu):\n${url}\n\nForm submit chesaka receipt, admission form, ID card anni ikkade vastayi 📄`,
      `Mee academy seat confirm ayindi (ID ${id}). Onboarding form fill cheyandi.`,
      { name: "academy_welcome", params: [name.split(" ")[0], id, c.name, docs.BATCH.start], urlSuffix: linkToken(id) });
    if (s.paid > 0) {
      try { const f = await buildDocs(cfg, s, ["receipt"]); if (f.receipt) await notify.sendWaDocLink(phone, f.receipt.url, f.receipt.name, "🧾 Advance payment receipt · రసీదు"); }
      catch (e) { console.error("receipt", e && e.message); await alertAdmins(`⚠️ Academy: receipt generate avvaledu — ${s.name} (${s.id}). Dashboard lo "Resend docs" try cheyandi.`); }
    }
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
    await putSt(cfg, s);                       // money is recorded first and never lost
    let receipt = null, warn = null;
    try {
      const f = await buildDocs(cfg, s, ["receipt"], { payment: { no: `R-${s.id}-${s.payments.length}`, amount: amt, mode: s.payMode, ref: s.payRef, label: b.label || (s.feeCleared ? "Course fee (balance)" : "Part payment"), ts: Date.now() } });
      receipt = f.receipt || null;
      if (receipt) await sendDoc(s, receipt, `🧾 Receipt — ₹${amt.toLocaleString("en-IN")} received. ${s.feeCleared ? "Fee fully paid ✅" : "Balance ₹" + Math.max(0, s.fee - s.paid).toLocaleString("en-IN")}`, "payment receipt");
    } catch (e) {
      console.error("academy: pay receipt", e && e.message);
      warn = "Payment record ayindi ✅ kani receipt generate avvaledu — 'Resend docs' tho malli try cheyandi.";
    }
    return json(res, 200, { ok: true, student: s, receipt, warn });
  }
  if (a === "send") {
    const ALLOW = ["receipt", "admission", "idcard", "certificate"];
    const raw = Array.isArray(b.which) ? b.which : [b.which || "admission"];
    const which = raw.map((x) => String(x)).filter((x) => ALLOW.includes(x));
    if (!which.length) return json(res, 400, { error: "which must be one of " + ALLOW.join(", ") });
    let f;
    try { f = await buildDocs(cfg, s, which); }
    catch (e) { console.error("academy: send", e && e.message); return json(res, 200, { ok: false, warn: "Documents generate avvaledu — konchem sepu tarvata malli try cheyandi." }); }
    for (const k of which) {
      const d = f[k]; if (!d) continue;
      const cap = k === "certificate" ? "🎓 Mee DermaLuxe Academy certificate — congratulations!" : k === "receipt" ? "🧾 Payment receipt" : k === "idcard" ? `🆔 Mee student ID card — ${s.id}` : "📋 Admission form";
      await sendDoc(s, d, cap, k === "idcard" ? "student ID card" : k === "certificate" ? "certificate" : k === "receipt" ? "payment receipt" : "admission form");
    }
    return json(res, 200, { ok: true, files: f });
  }
  if (a === "certify") {
    const seq = await guard.kvCommand(cfg, ["INCR", "acad:certseq"]).catch(() => ({ result: 1 }));
    s.certNo = `DLA/2026/${String(1000 + Number(seq.result || 1)).slice(-4)}`;
    s.grade = String(b.grade || "A").slice(0, 3); s.issued = Date.now(); s.status = "completed";
    await putSt(cfg, s);
    let f = {};
    try { f = await buildDocs(cfg, s, ["certificate"]); }
    catch (e) { console.error("academy: certify", e && e.message); return json(res, 200, { ok: false, student: s, warn: "Certificate generate avvaledu — malli try cheyandi." }); }
    if (f.certificate) {
      await waSend(cfg, s, `🎉 *Congratulations ${s.name.split(" ")[0]} garu!*\n\nMeeru ${docs.course(s).name} course successfully complete chesaru 🎓\nCertificate No: *${s.certNo}* · Grade: *${s.grade}*\n\nMee certificate ikkada 👇`, "Mee DermaLuxe Academy certificate ready — 'hi' ani reply cheyandi.");
      const certOk = await notify.sendWaDocLink(s.phone, f.certificate.url, f.certificate.name, "🎓 DermaLuxe Academy — Certificate of Completion");
      if (!certOk) await notify.sendAcademyTemplate(s.phone, "academy_certificate", [String(s.name || "").split(" ")[0], docs.course(s).name, s.certNo, s.grade], f.certificate.id, "Mee certificate ready — 'hi' ani reply cheyandi.");
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
  if (a === "material") {
    const t = encodeURIComponent(linkToken(s.id));
    const track = String(s.course) === "hair" ? "hair" : "skin";
    const day = Math.max(1, Math.min(30, Number(b.day || 1)));
    return json(res, 200, { ok: true, paid: Number(s.paid) > 0,
      day: `${BASE}/api/material?t=${t}&track=${track}&day=${day}`,
      day1: `${BASE}/api/material?t=${t}&track=${track}&day=1` });
  }
  if (a === "note") {
    const t = String(b.text || "").trim().slice(0, 300);
    if (t) { s.notes = [{ ts: Date.now(), by: me.name, text: t }].concat(s.notes || []).slice(0, 30); await putSt(cfg, s); }
    return json(res, 200, { ok: true, notes: s.notes || [] });
  }
  if (a === "reopen") {                         // let a student fill the form again
    s.onboarded = 0; await putSt(cfg, s);
    return json(res, 200, { ok: true, url: `${BASE}/academy-join.html?t=${linkToken(s.id)}` });
  }
  if (a === "delete") {
    if (me.role !== "owner") return json(res, 403, { error: "Owner matrame" });
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
