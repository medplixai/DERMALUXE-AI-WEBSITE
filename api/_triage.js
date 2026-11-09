// What each WhatsApp chat needs from a person, if anything.
//
// The inbox used to be a list of 150 conversations sorted by time, with
// "524 unread" over it — and almost all of those were chats the agent had
// already handled. The desk could not tell which of them needed a human.
// The dangerous one was invisible: a colleague takes a chat over, the agent
// goes quiet for that patient, the patient writes again, and the row looks
// like any other. (Owner, 9 Nov 2026: "whatsapp inbox chala confusing ga
// undi … intelligent ga cheyyi".)
//
// This reads the thread summary the inbox already keeps (who spoke last,
// when, the last few words, whether the agent is repeating itself), the
// lead's stage and the qualifier's grade, and says one of two things about
// every chat: a person must act (and why, in the order it matters), or it
// is fine — the agent has it, it is booked, or it has gone quiet.
//
// Pure: no store, no clock of its own, so it can be tested with a table.

const MIN = 60000, HOUR = 3600000, DAY = 86400000;

// Words that mean somebody is hurt now — a person rings, whatever the agent
// said. Phrases, not bare nouns: in a skin clinic "infection", "allergy",
// "burning", "swelling", "hospital" and "urgent appointment" are the everyday
// enquiry, and the first draft turned every one of them red (review, 9 Nov).
const EMERGENCY = /\bbleed|rakt(am)?\s*(vastondi|vastundi|aagatledu|aagadam ledu)|blood\s*(vastondi|vastundi|aagatledu)|severe\s*(pain|swelling|reaction|burning|allergy|noppi)|unbearable|\bemergency|ambulance|casualty|(can.?t|cannot|kashtam)\w*.{0,12}breath|breath(ing)?\s*(problem|kashtam|aadatledu)|faint|(after|tarvata|chesaka).{0,40}(burn|blister|swell|vaapu|bleed|pus\b)|అత్యవసర|రక్తం|ఊపిరి/i;
// They want a human on the phone, not a chat. "video call", "missed call"
// and "call back chestanu" are not that.
const WANTS_CALL = /(?<!video\s)(?<!missed\s)(?<!phone\s)\bcall\s*(cheyandi|cheyyandi|chey\b|cheyagalara|chestara|me\b|please|back\s*(cheyandi|ivvandi))|\bcall\s*ivvandi|phone\s*che|\bph\s*che|number\s*ivv|matlad|maatlad|mataad|talk to|doctor tho|కాల్ చే|ఫోన్ చే|మాట్లాడ/i;
// A photograph came in — logged as "[📷 photo]" bare, or "[📷] caption".
const PHOTO = /^\[📷/;

const NEEDS = {
  emergency:  { pri: 1, icon: "🚨", label: "Emergency laga undi" },
  human_wait: { pri: 1, icon: "👤", label: "Mee reply kosam waiting" },
  stuck:      { pri: 2, icon: "🤖", label: "AI reply ivvaledu" },
  ask_call:   { pri: 3, icon: "📞", label: "Call adigaru" },
  hot_window: { pri: 4, icon: "⏳", label: "Window moosukupotundi" },
  loop:       { pri: 5, icon: "🔁", label: "AI ade matalu" },
  photo:      { pri: 6, icon: "📷", label: "Photo pampaaru" },
};

function waitFor(ms) {
  const m = Math.round(ms / MIN);
  if (m < 1) return "ippude";
  if (m === 1) return "1 nimisham";
  if (m < 60) return m + " nimishalu";
  const h = Math.round(m / 60);
  if (h === 1) return "1 ganta";
  if (h < 24) return h + " gantalu";
  const d = Math.round(h / 24);
  return d === 1 ? "1 roju" : d + " rojulu";
}

// t: the thread summary (+ human, grade); lead: {status, outcome, slot_ts, slot}; now: ms
function triage(t, lead, now) {
  t = t || {}; lead = lead || {}; now = now || Date.now();
  const lastIn = Number(t.lastIn || 0), lastHuman = Number(t.lastHuman || 0);
  const said = String(t.lastInText || (t.lastDir === "in" ? t.last : "") || "");
  const fresh = lastIn && now - lastIn < DAY;                 // inside WhatsApp's window
  const humanAfter = lastHuman && lastHuman >= lastIn;        // a person already answered this
  const st = String(lead.status || "");
  // A slot the agent fixed is a booking even before the desk moves the stage.
  const slotLive = !!(lead.slot_ts && Date.parse(String(lead.slot_ts).replace(" ", "T") + "+05:30") > now - HOUR);
  const done = st === "booked" || st === "visited" || st === "closed" || slotLive;
  const since = lastIn ? now - lastIn : 0;
  let need = null;
  const set = (kind, text) => { if (!need || NEEDS[kind].pri < NEEDS[need.kind].pri) need = Object.assign({ kind, text }, NEEDS[kind]); };

  if (fresh && EMERGENCY.test(said) && !humanAfter && !done) set("emergency", "Patient ki emergency laga undi — ventane call cheyandi");
  if (t.human && t.lastDir === "in") set("human_wait", `${String(t.human.by || "").split(" ")[0] || "Evaro"} chusukuntunnaru, AI aagi undi — patient ${waitFor(since)} nundi reply kosam`);
  // Ten minutes without an answer is a failure; six hours later it is an old
  // chat, not an alarm — and a booked patient's closing "ok thank you" the
  // agent let pass is nothing at all.
  if (!t.human && t.lastDir === "in" && since > 10 * MIN && since < 6 * HOUR && !done) set("stuck", `AI reply ivvaledu — ${waitFor(since)} nundi waiting`);
  if (fresh && WANTS_CALL.test(said) && !humanAfter && !done) set("ask_call", "Patient call adigaru — phone cheyandi");
  if (fresh && t.grade === "A" && !done && since > 21 * HOUR) set("hot_window", `A grade · 24h window inka ${waitFor(DAY - since)} lo moosukupotundi — ippude reply/call`);
  if (Number(t.aiRep || 0) >= 2 && fresh && !done) set("loop", `AI ade message ${Number(t.aiRep) + 1} sarlu pampindi — meeru chudandi`);
  if (fresh && PHOTO.test(said) && !humanAfter && !done && since < 6 * HOUR) set("photo", "Photo pampaaru — doctor ki okasari chupinchandi");
  if (need) need.since = since;

  // Where the conversation stands, in one pill.
  let stage;
  if (st === "booked" || slotLive) stage = { kind: "booked", text: "📅 Book ayindi" + (lead.slot ? " · " + String(lead.slot).slice(0, 24) : "") };
  else if (st === "visited") stage = { kind: "visited", text: "✅ Vachcharu" };
  else if (st === "closed") stage = { kind: "closed", text: "Close chesaru" };
  else if (t.human) stage = { kind: "human", text: "👤 " + (String(t.human.by || "").split(" ")[0] || "Staff") };
  else if (Number(t.ts || 0) > now - DAY) stage = { kind: "ai", text: "🤖 AI matladutondi" };
  else stage = { kind: "quiet", text: "💤 " + waitFor(now - Number(t.ts || now)) + " nundi silent" };

  // The bucket the list groups by.
  const bucket = need ? "need" : stage.kind === "booked" || stage.kind === "visited" ? "booked" : stage.kind === "quiet" || stage.kind === "closed" ? "quiet" : stage.kind === "human" ? "human" : "ai";
  return { need, stage, bucket };
}

// Needs first (most urgent, then longest waiting), then the rest by recency.
function order(a, b) {
  const an = a.need ? a.need.pri : 99, bn = b.need ? b.need.pri : 99;
  if (an !== bn) return an - bn;
  if (a.need && b.need) return (b.need.since || 0) - (a.need.since || 0);
  return Number(b.ts || 0) - Number(a.ts || 0);
}

module.exports = { triage, order, NEEDS, EMERGENCY, WANTS_CALL, waitFor };
