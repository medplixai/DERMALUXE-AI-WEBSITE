// One goal for every lead (owner, 7 Nov 2026: "agent ki prathi lead ki goal
// pettu"). The agent gets it with every message, and the desk sees the same
// words on the lead card, so the chat and the call pull the same way.
//
// The goal comes from what is already known — what they asked about, how far
// away they are, what the desk heard on the phone, whether a slot is already
// booked, whether they have been a patient before — never from a guess. The
// next step is the one missing piece on the way to it.

const HT_ENDS = Date.parse("2026-12-07T00:00:00+05:30");

const GOALS = {
  redirect:      { label: "Job / vere pani — application ki pampu", rule: "Not a patient. Point them at the job application or support@dermaluxe.ai once; no slots, no treatment talk." },
  respect:       { label: "Vaddannaru — gauravamga", rule: "They told the desk no. Answer what they ask, warmly; at most one soft offer, never chase." },
  show_up:       { label: "Appointment ki vachela chudu", rule: "A slot is booked. Help them arrive: time, location, what to bring, answer doubts. Sell nothing new." },
  return_visit:  { label: "Next session / follow-up book", rule: "Treated here before. Ask how they are doing, then the next session or review." },
  academy_seat:  { label: "Academy counselling / ₹9,999 seat", rule: "Academy enquiry. Course fit, the counselling visit or call, then the ₹9,999 seat reservation." },
  ht_consult:    { label: "Hair transplant consultation book (scalp assessment)", rule: "Hair transplant enquiry, baldness or a receding hairline (owner, 7 Nov: promote it freely). Recommend hair transplant warmly as the main solution — FUE, natural hairline from their own hair, the ₹59,999 all-inclusive package (up to 2,000 grafts) while it is on — and book the surgeon's scalp assessment. The one thing not to do: promise a result or tell them they definitely need it; say the surgeon confirms suitability at the assessment." },
  video_consult: { label: "Video consultation book", rule: "They are far from Eluru. Book a video consultation first; a clinic visit only if they ask." },
  clinic_consult:{ label: "Clinic consultation slot book (₹300)", rule: "Book a doctor consultation at the clinic." },
};

// Transplant enquiries, and — by the owner's decision of 7 Nov ("hairline
// baldness anni HT promote cheyyi") — baldness and a receding hairline too.
// Hair fall alone stays a clinic consultation. The goal is the surgeon's scalp
// assessment, never the surgery: whether a transplant, PRP or medicines suit
// them is the doctor's call, and the rule below says so to the agent.
const HT = /transplant|graft|\bfue\b|\bdhi\b|bald|hairline|receding|male pattern|norwood|ట్రాన్స్‌?ప్లాంట్|బట్టతల/i;
const ACAD = /^\s*academy|academy (course|seat|enquiry|callback|fee)|course enquiry|cosmetology course/i;
const JOB = /\bjob\b|vacancy|resume|\bcv\b|hiring|application/i;

// o: { concern, type, km, intent, status, outcome, booked, treatedBefore, name, slot }
function goalFor(o) {
  const c = String(o.concern || "");
  let key = "clinic_consult";
  if (o.type === "job" || o.intent === "not_patient" || (JOB.test(c) && !/treatment|hair|skin|acne/i.test(c))) key = "redirect";
  else if (o.outcome === "notinterested" || o.outcome === "notravel" || o.status === "closed") key = "respect";
  else if (o.booked || o.status === "booked") key = "show_up";
  else if (ACAD.test(c)) key = "academy_seat";
  else if (o.treatedBefore || o.status === "visited") key = "return_visit";
  else if (HT.test(c)) key = "ht_consult";
  else if (o.km != null && o.km > 80) key = "video_consult";
  const g = GOALS[key];
  let next = "";
  if (["clinic_consult", "video_consult", "ht_consult", "academy_seat", "return_visit"].includes(key)) {
    next = !c.trim() ? "concern adugu" : !o.name ? "peru adugu" : (o.needPhone && !o.phone) ? "10-digit mobile number adugu (WhatsApp lo slot confirm kosam)" : !o.slot ? "2 slots offer cheyyi" : "slot confirm cheyyi";
  }
  let label = g.label;
  if (key === "ht_consult" && Date.now() < HT_ENDS) label = "Hair transplant FREE consultation book (scalp assessment)"; // owner's decision, data-owner="ht-offer-2026-11"
  return { key, label, rule: g.rule, next };
}

// Instagram, Messenger and the website chat know no number and keep no desk
// record of their own until a lead is saved, so the goal is read from what the
// person has written so far (owner, 8 Nov: goals for every agent).
function fromChat(texts, o) {
  const said = (texts || []).filter(Boolean).join(" \n ").slice(-1500);
  return goalFor(Object.assign({ concern: said, needPhone: true }, o || {}));
}

// The line the agent reads.
function contextLine(g) {
  if (!g) return "";
  return `[GOAL for this person: ${g.label}. ${g.rule}${g.next ? " Next step: " + g.next + "." : ""} Every reply moves one step toward it — but if the patient clearly wants something else, follow them.] `;
}

module.exports = { goalFor, fromChat, contextLine, GOALS };
