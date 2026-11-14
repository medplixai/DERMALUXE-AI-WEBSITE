// "Staff" — a patient asking for a person.
//
// Since 5 November every first reply ends with "staff tho matladali ante
// *staff* ani type cheyandi" (NMC 7.2(c): an AI must say it is one and offer
// a person). Nothing was listening for that word. Worse, an older guard that
// tells a stranger "this is an owner command" caught it first: by 14 November
// eight patients had typed "Staff" exactly as told and been answered
// "🔒 Ee command owner number nunchi matrame pani chestundi", with the owner
// numbers half-printed underneath. Nobody at the clinic was told any of them
// had asked.
//
// Now the word is a request: the patient is told a person will call, and the
// team is told who asked and what they last said. The agent keeps answering
// in the meantime — at midnight nobody is coming for nine hours, and a
// patient should not sit in silence because they asked for a human.
//
// KV: ntf:staff:<phone> — the team was told (2 hours, so ten "staff"s are one alert).
const guard = require("./_guard.js");

// Short messages only: "staff", "Staff please", "staff tho matladali",
// "human", "real person", "manishi tho". A sentence that happens to contain
// the word ("mee staff chala manchi vallu") is not a request.
// The word on its own (with a "please" or a "?" at most) …
const WORD = /^\s*\*?(?:staff|human|manager|receptionist|real\s+person|manishi)\*?\s*(?:please|pls|plz|kavali|garu|ki|\?|!|\.|🙏)*\s*$/i;
// … or said as a sentence.
const SAID = /staff\s*(?:tho|to|with)?\s*(?:matlad|matlaad|talk|speak|kavali|please|pls|call)|(?:talk|speak)\s+(?:to|with)\s+(?:a\s+|the\s+|your\s+)?(?:staff|human|person|someone|real\s+person)|manishi\s*tho/i;
// "Staff vacancy" is a job seeker, not a patient asking for a person.
const JOB = /vac+an|vecan|vacen|\bjobs?\b|hiring|recruit|udyog|career|opening|resume|\bcv\b|apply/i;

function isAsk(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 60) return false;
  if (JOB.test(t)) return false;
  return WORD.test(t) || SAID.test(t);
}

// Mon–Sat, 9 AM to 9 PM in Eluru.
function openNow(now) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(now || Date.now()));
  const wd = (parts.find((p) => p.type === "weekday") || {}).value;
  const h = Number((parts.find((p) => p.type === "hour") || {}).value);
  return wd !== "Sun" && h >= 9 && h < 21;
}

function reply(open, name) {
  const who = name ? `${name} garu` : "andi";
  return open
    ? `Sare ${who} 🙏 Mana staff ki cheppanu — konni nimishallo meeku call chestaru (leda ikkade reply istaru).\n\nEe lopu emaina adagali ante ikkade adagandi, nenu cheptanu.`
    : `Sare ${who} 🙏 Mana staff ki cheppanu. Clinic ippudu close (Mon–Sat 9 AM – 9 PM) — clinic open ayyaka modata meeke call chestaru.\n\nEe lopu emaina adagali ante ikkade adagandi, nenu cheptanu.`;
}

const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

// Tell the team, once per patient per two hours. In clinic hours that is a
// WhatsApp to the lead phones and an urgent push; out of hours only a quiet
// push, so nobody's phone rings at 1 AM — it is waiting in the inbox at 9.
async function alert(cfg, o) {
  const x = o || {};
  if (!cfg || !x.phone) return { told: false };
  const nx = await guard.kvCommand(cfg, ["SET", `ntf:staff:${ten(x.phone)}`, "1", "NX", "EX", "7200"]).catch(() => ({}));
  if (!(nx && nx.result)) return { told: false, again: true };
  const who = x.name || "Patient";
  const last = String(x.last || "").replace(/\s+/g, " ").slice(0, 140);
  try {
    const push = require("./_push.js");
    if (push.enabled()) await push.notifyCap(cfg, "inbox.reply", {
      title: `🙋 ${who} staff tho matladali antunnaru`,
      body: `${ten(x.phone)}${last ? " · " + last : ""}`,
      tab: "inbox", urgent: !!x.open, data: { kind: "inbox", phone: ten(x.phone) },
    });
  } catch (e) { console.error("push: staff ask", e && e.message); }
  let sent = 0;
  if (x.open) {
    const notify = require("./_notify.js");
    const body = `🙋 *Patient staff tho matladali antunnaru — call cheyandi*\n\n👤 ${who}\n📱 ${ten(x.phone)}${last ? `\n💬 Mundu adigindi: "${last}"` : ""}\n\nApp → Inbox lo chat undi.`;
    for (const to of String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666").split(",").map(ten).filter((p) => p.length === 10)) {
      if (await notify.teamSend(cfg, to, body).catch(() => false)) sent++;
    }
  }
  return { told: true, sent };
}

module.exports = { isAsk, openNow, reply, alert };
