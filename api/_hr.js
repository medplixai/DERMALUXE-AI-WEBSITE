// Hiring/careers flow on the WhatsApp agent.
//
// Candidate journey: dermaluxe.ai/r/jobs (or typing JOBS/CAREERS) →
// role tap-list → name → experience buttons → city → CV (PDF/doc, optional)
// → application stored as a type:"job" lead (dashboard-visible) + instant
// WhatsApp alert to HR_PHONES (falls back to ADMIN_PHONES) with the CV
// document forwarded, so HR can approach the candidate directly.
//
// State: hr:s:<digits> in KV, 48h TTL. "cancel" exits anytime.
const guard = require("./_guard.js");
const notify = require("./_notify.js");

const ROLES = [
  "Dermatologist",
  "Plastic Surgeon",
  "Cosmetologist",
  "BDS/BHMS Doctor",
  "Hair Transplant Surgn",
  "Nursing Staff",
  "Therapist",
  "Front Office",
  "Content Creator",
  "Other Role",
];

const STATE_TTL = 172800;

function norm(t) {
  return String(t || "").toLowerCase().replace(/[^a-z]/g, "");
}
function isTrigger(text) {
  return /^(jobs?|careers?|hiring|vacancy|vacancies|apply|udyogam|opening|openings)$/.test(norm(text));
}

async function getState(cfg, digits) {
  if (!cfg) return null;
  try {
    const r = await guard.kvCommand(cfg, ["GET", `hr:s:${digits}`]);
    return r.result ? JSON.parse(r.result) : null;
  } catch (e) { return null; }
}
async function setState(cfg, digits, st) {
  try { await guard.kvCommand(cfg, ["SET", `hr:s:${digits}`, JSON.stringify(st), "EX", String(STATE_TTL)]); } catch (e) {}
}
async function clearState(cfg, digits) {
  try { await guard.kvCommand(cfg, ["DEL", `hr:s:${digits}`]); } catch (e) {}
}

function roleListReply(text) {
  return {
    text,
    list: { button: "💼 Role select", title: "Open positions", rows: ROLES },
  };
}

// ---- Candidate status pipeline (ATS-lite) --------------------------------
// hr:st:<phone> = {status, at?, ts} (90d). Statuses: applied → shortlisted →
// interview → selected / rejected. hr:ivq list feeds interview-day reminders.
async function getStatus(cfg, phone) {
  try {
    const r = await guard.kvCommand(cfg, ["GET", `hr:st:${phone}`]);
    return r.result ? JSON.parse(r.result) : null;
  } catch (e) { return null; }
}
async function setStatus(cfg, phone, status, at) {
  const st = { status, ts: Date.now() };
  if (at) st.at = at;
  try { await guard.kvCommand(cfg, ["SET", `hr:st:${phone}`, JSON.stringify(st), "EX", "7776000"]); } catch (e) {}
  if (status === "interview" && at) {
    try { await guard.kvCommand(cfg, ["LPUSH", "hr:ivq", JSON.stringify({ phone, at })]); } catch (e) {}
  }
}
function statusEmoji(st) {
  if (!st) return "🆕";
  return { shortlisted: "⭐", interview: "📅", selected: "✅", rejected: "❌" }[st.status] || "🆕";
}
// Latest job application for a phone (from the shared leads list).
async function findApp(cfg, phone) {
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]);
    for (const raw of (r.result || [])) {
      try {
        const l = JSON.parse(raw);
        if (l && l.type === "job" && String(l.phone) === String(phone)) {
          return { name: l.name, role: String(l.concern || "").split("·")[0].trim(), cvId: l.cv_media_id || "" };
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

async function alertTeam(cfg, app) {
  const normList = (v) => String(v || "").split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter((s) => s.length === 10);
  let targets = normList(process.env.HR_PHONES);
  targets = Array.from(new Set(targets.concat(normList(process.env.ADMIN_PHONES))));
  const body = [
    "💼 *New Job Application!*",
    `🧑‍⚕️ Role: *${app.role}*`,
    `👤 ${app.name}`,
    `📱 ${app.phone}`,
    `⏳ Experience: ${app.exp}`,
    app.qual ? `🎓 ${app.qual}` : "",
    `📍 ${app.city}`,
    app.cvId ? "📄 CV attach chesi pampistunnam 👇" : "📄 CV ledu — direct ga matladandi",
    "",
    "Follow-up: 'jobs report' ani ee number ki pampandi",
  ].join("\n");
  for (const to of targets) {
    await notify.sendWa(to, body);
    if (app.cvId) await notify.sendWaDocument(to, app.cvId, app.cvName || `CV-${app.name}.pdf`, `CV — ${app.name} (${app.role})`);
  }
}

async function storeApplication(cfg, app) {
  const lead = {
    ts: Date.now(), type: "job",
    name: String(app.name).slice(0, 80), phone: app.phone,
    age: "", gender: "",
    concern: `${app.role} · ${app.exp}`.slice(0, 120),
    message: `${app.qual ? "Qual: " + app.qual + " · " : ""}City: ${app.city}${app.cvId ? " · CV received" : " · No CV"}`.slice(0, 400),
    mode: "", date: "", slot: "",
    skin_score: null, hair_score: null, skin_age: null, skin_type: "",
    treatments: [], page: "whatsapp-careers", src_id: app.phone,
    cv_media_id: app.cvId || "",
  };
  if (cfg) {
    try {
      await guard.kvCommand(cfg, ["LPUSH", "dl_leads", JSON.stringify(lead)]);
      await guard.kvCommand(cfg, ["LTRIM", "dl_leads", "0", "4999"]);
    } catch (e) {}
  }
}

// Returns {text, list?, buttons?} | null (not in hiring flow).
async function handle(cfg, digits, text, doc) {
  if (!cfg || !digits) return null;
  const t = String(text || "").trim();
  let st = await getState(cfg, digits);

  if (!st) {
    if (!isTrigger(t)) return null;
    await setState(cfg, digits, { step: "role", ts: Date.now() });
    return roleListReply(
      "💼 *DermaLuxe Careers* — Eluru\n\nMemu hiring lo unnam! 🎉 Premium skin & hair clinic lo pani cheyalante ippude apply cheyandi.\n\n👇 Mee role select cheyandi:");
  }

  if (/^cancel$/i.test(t)) {
    await clearState(cfg, digits);
    return { text: "Application cancel chesanu 👍 Malli apply cheyalante *JOBS* ani pampandi." };
  }

  if (st.step === "role") {
    const pick = ROLES.find((r) => norm(r) === norm(t)) ||
      ROLES.find((r) => norm(t).length >= 4 && norm(r).indexOf(norm(t)) !== -1);
    if (!pick) return roleListReply("👇 List nunchi mee role select cheyandi (leda 'cancel'):");
    st.role = pick; st.step = "name";
    await setState(cfg, digits, st);
    return { text: `Good choice! 😊 *${pick}* position ki apply chestunnaru.\n\nMee *full name* cheppandi:` };
  }

  if (st.step === "name") {
    if (t.length < 2 || doc) return { text: "Mee *full name* type chesi pampandi:" };
    st.name = t.slice(0, 80); st.step = "exp";
    await setState(cfg, digits, st);
    return { text: `Thanks ${st.name.split(" ")[0]}! 👍\n\n*Experience* entha?`, buttons: ["Fresher", "1-3 Years", "3+ Years"] };
  }

  if (st.step === "exp") {
    if (!t) return { text: "Experience select cheyandi 👇", buttons: ["Fresher", "1-3 Years", "3+ Years"] };
    st.exp = t.slice(0, 30);
    const medical = ["Dermatologist", "Plastic Surgeon", "Cosmetologist", "BDS/BHMS Doctor", "Hair Transplant Surgn", "Nursing Staff", "Therapist"];
    if (medical.indexOf(st.role) !== -1) {
      st.step = "qual"; await setState(cfg, digits, st);
      return { text: "🎓 Mee *qualification* cheppandi (degree + registration unte adi kuda):\nE.g. MBBS MD DVL · BSc Nursing · D.Pharm" };
    }
    if (st.role === "Content Creator") {
      st.step = "qual"; await setState(cfg, digits, st);
      return { text: "🎨 Mee *portfolio / Instagram / YouTube link* pampandi (leda 'ledu' ani cheppandi):" };
    }
    st.step = "city"; await setState(cfg, digits, st);
    return { text: "📍 Meeru e *city/uru* nunchi?" };
  }

  if (st.step === "qual") {
    if (!t || doc) return { text: "Type chesi pampandi 🙏 (short ga saripotundi):" };
    st.qual = t.slice(0, 120); st.step = "city";
    await setState(cfg, digits, st);
    return { text: "📍 Meeru e *city/uru* nunchi?" };
  }

  if (st.step === "city") {
    if (!t || doc) return { text: "Mee *city* peru type cheyandi:" };
    st.city = t.slice(0, 60); st.step = "cv";
    await setState(cfg, digits, st);
    return { text: "Almost done! 🎯\n\n📄 Mee *CV/Resume* (PDF or Word) ikkade attach chesi pampandi.\n\nCV ready ga lekapothe *skip* ani pampandi — details tho apply chestam." };
  }

  if (st.step === "cv") {
    const app = { role: st.role, name: st.name, exp: st.exp, city: st.city, qual: st.qual || "", phone: digits };
    if (doc && doc.id) {
      app.cvId = doc.id;
      app.cvName = doc.name || "";
    } else if (!/^skip$/i.test(t)) {
      return { text: "📄 CV file attach chesi pampandi (PDF/Word) — leda *skip* ani pampandi." };
    }
    await clearState(cfg, digits);
    await storeApplication(cfg, app);
    await setStatus(cfg, digits, "applied");
    try { await alertTeam(cfg, app); } catch (e) { console.error("hr: alert", e && e.message); }
    return { text: `🎉 *Application received, ${app.name.split(" ")[0]}!*\n\n• Role: *${app.role}*\n• Experience: ${app.exp}\n${app.cvId ? "• CV: received ✅" : "• CV: pending (interview appudu teeskuni randi)"}\n\nMana HR team review chesi *2-3 rojullo* meeku call chestundi. All the best! 🍀\n— Team DermaLuxe`. trim() };
  }

  return null;
}

module.exports = { handle, isTrigger, ROLES, getStatus, setStatus, statusEmoji, findApp };
