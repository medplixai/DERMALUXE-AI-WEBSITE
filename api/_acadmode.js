// Is this WhatsApp chat about the Academy — and is the person already a
// student?
//
// Owner, 13 Nov 2026: "academy lead ki consultation adugutundi — academy lead
// ki academy cheppali". The agent's every reply is steered by a patient's
// machinery: an opener that says "mee problem cheppandi", a goal of a ₹300
// clinic consultation, "concern adugu", "OFFER SLOTS NOW" once a town is
// known. On the day this was written it greeted a paid, admitted student
// asking about her ID card with "mee problem cheppandi", and asked a
// beautician who wrote "Academy details kavali" whether her concern was skin
// or hair fall.
//
// So the chat is classified first, and an Academy chat gets its own line and
// none of the patient's.

// Course words, in the spellings people actually type.
const ACADEMY_ASK = /(academy|acadamy|akadami|course|cours\b|training|trainin|cosmetolog|therapist course|nerchuko|nerpist|nerputar|nerpisru|class(es)?\b|batch|శిక్షణ|కోర్సు|అకాడమీ)/i;
// "Not for the academy — for a test": the person has said which they are.
const NOT_ACAD = /(academy|course|class)\s*(kosam\s*)?(ka+du|kadhu|kaadhu|vaddu|not)|not\s+(for\s+)?(the\s+)?(academy|course)|treatment\s+kosam|test\s+cheyinchu/i;
// A job seeker describes their qualifications ("ANM nursing course") —
// that is the job flow, not a course enquiry.
const JOB = /\bjobs?\b|vacanc|resume|\bcv\b|hiring|naukri|udyogam|ఉద్యోగం/i;
// Treatment words in the same breath as "course" mean a course of treatment.
const TREATMENT_COURSE = /(tablets?|medicines?|mandulu|antibiotic|sessions?)\s+course|course\s+(of\s+)?(tablets?|medicine|treatment|sessions?)/i;

const IN_COURSE = ["enrolled", "active", "training", "completed"];

// o: { text, hist:[{u,a}], concern, type, ad:{headline, body}, student }
function detect(o) {
  const x = o || {};
  const st = x.student;
  if (st && IN_COURSE.includes(String(st.status || "enrolled"))) return "student";
  const users = [String(x.text || "")].concat((x.hist || []).slice(-4).map((t) => String((t && t.u) || "")));
  const said = users.join(" \n ");
  if (NOT_ACAD.test(said)) return "";
  if (x.type === "job" || JOB.test(said)) return "";
  if (TREATMENT_COURSE.test(said)) return "";
  if (ACADEMY_ASK.test(said)) return "lead";
  if (/^\s*academy/i.test(String(x.concern || ""))) return "lead";
  const ad = x.ad || {};
  if (ACADEMY_ASK.test(`${ad.headline || ""} ${ad.body || ""}`)) return "lead";
  // The agent itself has been talking course for the last few turns.
  if ((x.hist || []).slice(-3).some((t) => /DermaLuxe Academy|course catalog|seat reserv/i.test(String((t && t.a) || "")))) return "lead";
  return "";
}

const COURSE = { skin: "Skin Care", hair: "Hair Care", both: "Skin + Hair" };

function line(mode, st) {
  if (mode === "student") {
    const s = st || {};
    const bal = Math.max(0, Math.round(Number(s.fee || 0) - Number(s.paid || 0)));
    return `[ACADEMY STUDENT — ${s.name || "this person"} is already enrolled in the ${COURSE[s.course] || s.course || ""} course (status ${s.status || "enrolled"}${s.startISO ? ", batch from " + s.startISO : ""}${bal ? ", fee balance ₹" + bal.toLocaleString("en-IN") : ", fee fully paid"}). ` +
      "Do NOT sell the course or the seat, do NOT ask about a skin or hair problem, do NOT offer a doctor consultation, a clinic slot or the consultation fee. " +
      "Help like the academy front desk: class timings, what to bring, forms, receipt, ID card, study material, attendance, fee balance. Anything about refunds, discounts or certificates — the academy team will call; say so. If they themselves ask for a treatment for their own skin or hair, then follow them.] ";
  }
  if (mode === "lead") {
    return "[ACADEMY LEAD — this person is asking about the DermaLuxe Academy training course for themselves, NOT a treatment. " +
      "Do NOT ask about their skin or hair problem, do NOT offer a doctor consultation or clinic slots, do NOT mention the consultation fee, and do not open with patient lines like 'mee problem cheppandi'. " +
      "Talk about the course: what is taught hands-on, duration, fees and the launch offer, batch date and seats, certificate, placement. " +
      "Next step, one at a time: their name → which course (Skin / Hair / Skin + Hair) → their background (beautician, nurse, fresher…) → a counselling call or visit with the academy team (offer a time) → the ₹9,999 seat reservation. " +
      "If they say clearly that they want treatment for themselves, follow them instead.] ";
  }
  return "";
}

module.exports = { detect, line, ACADEMY_ASK, NOT_ACAD, IN_COURSE };
