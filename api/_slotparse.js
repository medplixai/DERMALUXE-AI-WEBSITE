// A picked slot, read from the patient's own words — the safety net under the
// model. On 7 Nov the agent told a patient "Monday 6:00 PM slot hold chesanu"
// and sent no slot_ts with it, so the booking reached nobody: no desk row, no
// reminder. When the reply says a slot is held and the patient's message is a
// slot ("Monday 6:00 PM", "Repu 11:00 AM", "Somavaram 11 AM"), this works out
// the real date and time in Eluru.

const DAYS = [
  [0, /\b(sunday|sun|aadivaaram|adivaram|ఆదివారం)\b/i],
  [1, /\b(monday|mon|somavaram|somavaaram|సోమవారం)\b/i],
  [2, /\b(tuesday|tue|tues|mangalavaram|మంగళవారం)\b/i],
  [3, /\b(wednesday|wed|budhavaram|బుధవారం)\b/i],
  [4, /\b(thursday|thu|thurs|guruvaram|గురువారం)\b/i],
  [5, /\b(friday|fri|sukravaram|shukravaram|శుక్రవారం)\b/i],
  [6, /\b(saturday|sat|shanivaram|sanivaram|శనివారం)\b/i],
];
const ist = (ms) => new Date(ms + 330 * 60000);

// Returns "YYYY-MM-DD HH:mm" (IST) or "" when the words are not a slot.
function parseSlot(text, nowMs) {
  const t = String(text || "").toLowerCase();
  const tm = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/);
  if (!tm) return "";
  let h = Number(tm[1]) % 12; const mi = Number(tm[2] || 0);
  if (tm[3] === "pm") h += 12;
  if (h < 9 || h > 20 || mi > 59) return "";
  const now = ist(nowMs || Date.now());
  let add = null;
  if (/\b(ivala|eeroju|today|ee roju|ఇవాళ|ఈరోజు)\b/.test(t)) add = 0;
  else if (/\b(repu|tomorrow|రేపు)\b/.test(t)) add = 1;
  else {
    const d = DAYS.find(([, re]) => re.test(t));
    if (d) { add = (d[0] - now.getUTCDay() + 7) % 7; if (add === 0) add = 7; }
  }
  if (add === null) return "";
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add));
  if (day.getUTCDay() === 0) return "";                       // Sunday: closed
  const pad = (n) => String(n).padStart(2, "0");
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())} ${pad(h)}:${pad(mi)}`;
}

// The reply says the slot is held / booked.
const HELD = /(hold chesanu|hold chesam|note chesanu|book chesanu|slot (meeku )?(hold|reserve)|confirm chest|slot hold)/i;

// Stricter: the reply itself says it is done — "slot hold chesanu", "ki
// marchanu", "Confirmed!" — not "select cheste team confirm chestundi".
// Only this lets the time be read out of the agent's own words.
const DONE = /(hold chesanu|hold chesam|hold chesa\b|book chesanu|ki note chesanu|ki marchanu|slot (meeku )?(hold|reserve|book) chesanu|\bConfirmed!)/i;

// The one time the reply names. Two times ("6:30 PM leda 11:00 AM") is an
// offer, not a booking, and gives nothing.
function slotInReply(reply, nowMs) {
  const r = String(reply || "");
  if (!DONE.test(r)) return "";
  const times = r.match(/\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b/gi) || [];
  if (new Set(times.map((x) => x.toLowerCase().replace(/\s+/g, ""))).size !== 1) return "";
  return parseSlot(r.replace(/\*/g, ""), nowMs);
}

module.exports = { parseSlot, slotInReply, HELD, DONE };
