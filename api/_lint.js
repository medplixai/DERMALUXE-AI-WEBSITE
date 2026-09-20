// The last check before a reply leaves for a patient's phone.
//
// The prompt already says all of this. Rules in a long prompt are followed
// most of the time; a check that reads the actual reply is followed every
// time. Each check is deterministic and cheap. A reply that trips one is
// rewritten once by the model with the fault named; if the rewrite is no
// better, the original goes out rather than nothing.
const facts = require("./_facts.js");

// Rupee figures the agent is allowed to say: the academy's published fees.
const ALLOWED_RUPEES = new Set([9999, 49999, 99999]);
// Medicines and doses — never from a receptionist.
const MEDICINE = /(\b\d+\s?(mg|ml|mcg)\b|\btablet(s)?\b|\bcapsule(s)?\b|\bointment\b|\bminoxidil\b|\bfinasteride\b|\bisotretinoin\b|\btretinoin\b|\bhydroquinone\b|\bketoconazole\b|\bclindamycin\b|\bbenzoyl\b|\badapalene\b|\bbetamethasone\b|\bclobetasol\b|\bfluconazole\b|\bterbinafine\b|\bazithromycin\b|\bdoxycycline\b|\bmetformin\b)/i;
// Conditions the agent must not guess at in plain chat.
const CONDITIONS = ["psoriasis", "vitiligo", "eczema", "fungal", "fungus", "ringworm", "melasma", "alopecia", "cancer", "melanoma", "herpes", "hiv", "std", "scabies", "leprosy", "lupus", "rosacea", "folliculitis", "keloid", "సొరియాసిస్", "ఎగ్జిమా", "ఫంగస్", "క్యాన్సర్", "మెలస్మా", "బొల్లి"];
const GUESS = /(kavachu|kavochu|ayi undochu|ayyundochu|laaga undi|la undi|anipistondi|anipistundi|might be|could be|looks like|seems like|probably|కావచ్చు|కావొచ్చు|లా ఉంది|లాగా ఉంది|అనిపిస్తోంది)/i;
const REASSURE = /(bhayapadoddu|bhayapadakandi|kangaru padakandi|tension vaddu|worry vaddu|no need to worry|nothing to worry|nothing serious|it'?s normal|completely normal|totally safe|100% safe|harmless|serious emi ledu|antha normal|భయపడొద్దు|భయపడకండి|కంగారు పడకండి|అంతా నార్మల్|సీరియస్ ఏమీ లేదు)/i;
const META_PREFILL = /^(hello|hi|hey)?[\s!.,]*(can i get more info(rmation)?( (on|about) this)?|i want to know more( about this)?|please tell me more( about this)?|tell me more about this|i'?m interested in this|i have a question about this|is this available|i would like to know more)[\s?.!]*$/i;
const isMetaPrefill = (line) => META_PREFILL.test(String(line || "").trim());
const OPT_OUT = /^\s*(stop|unsubscribe)\s*$|\b(mes+a?g?e?s?|msgs?|mesg|sms)\s*(cheyakandi|cheyyakandi|cheyakudadhu|pampakandi|pampoddu|vaddu|vadhu)\b|\bdon'?t\s+(message|msg|text)\b|మెసేజ్(‌?లు)?\s*(చేయకండి|పంపకండి|వద్దు)/i;
const asksToStop = (t) => OPT_OUT.test(String(t || ""));

const norm = (s) => String(s || "").replace(/[\s*_~`]+/g, " ").replace(/[.!?,:;–-]+/g, "").trim().toLowerCase();
function similar(a, b) {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 1)), B = new Set(norm(b).split(" ").filter((w) => w.length > 1));
  if (!A.size || !B.size) return false;
  let both = 0; for (const w of A) if (B.has(w)) both++;
  return both / Math.max(A.size, B.size) >= 0.75;
}
const hasTelugu = (s) => /[ఀ-౿]/.test(String(s || ""));

// out = the model's parsed JSON (reply, buttons, slots, urgent, lead…).
// patientText = what the patient wrote this turn. recent = our last replies.
function lintReply(out, patientText, recent, opts) {
  const o = opts || {};
  const reply = String((out && out.reply) || "");
  const prose = reply.replace(/https?:\/\/\S+/g, "").replace(/wa\.me\/\S+/g, "");
  const faults = [];
  const said = String(patientText || "");
  const hasChoice = (Array.isArray(out.buttons) && out.buttons.length) || (Array.isArray(out.slots) && out.slots.length);

  const questions = (prose.match(/\?/g) || []).length;
  if (questions > 1 && !hasChoice) faults.push({ code: "two_questions", note: `${questions} questions unnayi — okkate undali; migilinavi statements ga maarchu` });

  // Prices: the site never quotes treatment prices; the academy's fees are published.
  const rupees = [...prose.matchAll(/₹\s?([\d,]{3,})|(?:rs\.?|inr)\s?([\d,]{3,})/gi)].map((m) => Number((m[1] || m[2]).replace(/,/g, ""))).filter((n) => n >= 100);
  const odd = [...new Set(rupees.filter((n) => !ALLOWED_RUPEES.has(n)))];
  if (odd.length) faults.push({ code: "price_quoted", note: `₹${odd.join(", ₹")} cheppav — treatment prices eppudu cheppakudadu; "consultation lo doctor exact plan istaru" ani cheppi slot adugu (academy fees ₹9,999/₹49,999/₹99,999 matrame allowed)` });

  if (MEDICINE.test(prose)) faults.push({ code: "medicine", note: "medicine peru / dose cheppav — receptionist medicines cheppadu; lifestyle tips matrame, medicines doctor consultation lo" });

  if (!o.analysis) {
    const low = said.toLowerCase();
    for (const c of CONDITIONS) {
      if (!prose.toLowerCase().includes(c) || low.includes(c)) continue;
      const sentence = prose.split(/[.\n!?]/).find((s) => s.toLowerCase().includes(c)) || "";
      if (GUESS.test(sentence)) { faults.push({ code: "diagnosis_guess", note: `patient cheppani "${c}" ni kavachu ani cheppav — doctor chusi cheptaru ani cheppu` }); break; }
    }
    if (REASSURE.test(prose)) faults.push({ code: "reassurance", note: "safety verdict ichchav (bhayapadoddu / normal / safe) — adi doctor maata; teesey" });
  }

  // English to a patient who typed no English of their own.
  const own = said.split("\n").filter((l) => l.trim() && !isMetaPrefill(l) && !/^\[(📷|🎤|photo|voice)/i.test(l.trim())).join("\n");
  const lastMsg = own.trim().split("\n").pop() || "";
  const englishWords = (lastMsg.toLowerCase().match(/\b(the|is|are|i|my|have|has|since|please|can|could|you|what|how|and|for|with|this|it|me|to|in|of|am|was|will|need|want|from|there|here|when|where|which|do|does|not)\b/g) || []).length;
  const replyEnglish = prose.replace(/[^A-Za-z]/g, "").length, replyTelugu = (prose.match(/[ఀ-౿]/g) || []).length;
  const teluguHeavy = replyTelugu > 40 && replyTelugu > replyEnglish * 0.6;
  if (!hasTelugu(lastMsg) && englishWords >= 4 && teluguHeavy) faults.push({ code: "language_mismatch", note: "patient English lo raasaru — reply simple English lo undali, Telugu script kaadu" });
  const prefillOnly = !own.trim() && said.split("\n").some(isMetaPrefill);
  const tenglishWords = (prose.toLowerCase().match(/\b(meeru|mee|cheppandi|kavali|undi|unnai|ledu|avutundi|chesthe|cheyandi|garu|manam|mana|ela|enti|eppudu|ki|lo|tho|andi|kuda|okasari|ivala|repu)\b/g) || []).length;
  if (prefillOnly && replyEnglish > 60 && tenglishWords < 3 && replyTelugu < 10) faults.push({ code: "prefill_english", note: "'Hello! Can I get more info on this?' anedi Meta ad text, patient bhasha kaadu — reply Tenglish lo undali (Telugu words English letters lo), pure English kaadu" });

  // Internal notes leaking into the message.
  const firstLine = prose.split("\n").find((l) => l.trim()) || "";
  if (/^(note:|internal|redirect|routing|since no|as per (the )?(prompt|rules|instructions)|per (the )?system)/i.test(firstLine.trim()) || /\b(CRM|profile name|system prompt|as an ai|language model)\b/i.test(prose)) faults.push({ code: "internal_note", note: "internal note / CRM / system maata patient message lo undi — teesey" });

  // Greeting by a WhatsApp profile label the patient never typed.
  const gaveName = /(peru|per\b|name|పేరు|my name|i am |nenu |naa peru)/i.test(said);
  const label = String(o.profileName || "").trim().split(/\s+/)[0] || "";
  if (!gaveName && label.length >= 2 && new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+garu`, "i").test(prose) && !said.includes(label)) {
    faults.push({ code: "profile_name_used", note: `"${label} garu" anedi WhatsApp profile label, patient cheppina peru kaadu — peru lekunda greet chesi, peru adugu` });
  }

  // A stop request answered with a question or an offer.
  if (asksToStop(lastMsg) && (questions > 0 || hasChoice)) faults.push({ code: "stop_ignored", note: "patient messages vaddannaru — 'Sare 🙏 ika pampamu, avasaram ayithe ikkade message cheyandi' ani okka line; question, slot, offer vaddu" });

  // A dead end: no question, no choice, no confirmation, not urgent, not a goodbye.
  const ackOnly = /^\s*(ok+|okay|sare|sari|thanks?|thank you|thanku|alage|vastanu|vastam|👍|🙏)[\s.!🙏👍]*$/i.test(lastMsg);
  const confirmish = /(book ayindi|note chesanu|confirm|reserve chesa|✅|ventane|immediately|call cheyandi|99491 34666|emergency)/i.test(prose);
  const goodbye = /(see you|take care|kaluddam|jagratta|thank you|dhanyavadalu|welcome)/i.test(prose);
  if (questions === 0 && !hasChoice && !confirmish && !asksToStop(lastMsg) && !(goodbye && (o.booked || ackOnly)) && prose.length > 60) {
    faults.push({ code: "no_next_step", note: "reply question lekunda, buttons/slots lekunda aagipoyindi (dead end) — chivarlo okka chinna question leda slots undali" });
  }

  // Booking confirmed, then doubted again.
  if (/(book ayindi|note chesanu|reserve chesa|✅)/i.test(prose) && /(sari ?potunda|ok na\?|kudurutunda|marchamantara|vere time)/i.test(prose)) faults.push({ code: "confirm_then_ask", note: "book chesaka 'ee time ok na?' ani malli adagaku — 'marchali ante okka maata cheppandi' ani okka line" });

  // The same thing we already said, in our last three.
  const rec = (Array.isArray(recent) ? recent : []).slice(-3);
  if (rec.some((p) => similar(p, reply))) faults.push({ code: "repeat", note: "ide maata already cheppam — malli kaadu; kotha angle: oppukunte first slot book chesi cheppu, 'tarvata' ante okasari sare ani mugincha" });

  return faults;
}

// Rewrite once with the faults named. Returns the better of the two.
async function rewrite(out, faults, patientText, opts) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !faults.length) return { out, faults, rewritten: false };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "claude-opus-5", max_tokens: 700,
        system: "You fix one WhatsApp reply from DermaLuxe Assistant (a skin & hair clinic receptionist in Eluru), keeping the same language, tone, every fact and the booking intent. Return ONLY the corrected reply text, no JSON, no preamble.",
        messages: [{ role: "user", content: `REPLY:\n${out.reply}\n\nFAULTS TO FIX:\n${faults.map((f) => "- " + f.note).join("\n")}\n\nRules: exactly one question mark in the whole reply (or none when buttons/slots are offered); never a treatment price or a medicine name; never name a condition the patient did not name; no safety verdicts; end with one short next step unless it is a confirmation, an emergency, or the reply to a stop request; Tenglish (Telugu in English letters) unless the patient wrote real English of their own. Keep it 2–6 short lines.` }],
      }),
    });
    if (!r.ok) return { out, faults, rewritten: false };
    const d = await r.json();
    const fixed = String(((d.content || []).find((b) => b.type === "text") || {}).text || "").trim();
    if (!fixed) return { out, faults, rewritten: false };
    const next = Object.assign({}, out, { reply: fixed });
    const left = lintReply(next, patientText, opts && opts.recent, opts);
    if (left.length < faults.length) return { out: next, faults: left, rewritten: true };
    return { out, faults, rewritten: false };
  } catch (e) { return { out, faults, rewritten: false }; }
}

// Lint, rewrite if needed, and write the editor's log line. Returns the reply to send.
async function check(cfg, out, patientText, recent, opts) {
  const o = Object.assign({}, opts || {}, { recent });
  const faults = lintReply(out, patientText, recent, o);
  if (!faults.length) return out;
  const res = await rewrite(out, faults, patientText, o);
  try {
    const guard = require("./_guard.js");
    if (cfg) {
      await guard.kvCommand(cfg, ["LPUSH", "lint:log", JSON.stringify({ ts: Date.now(), ch: o.channel || "wa", faults: faults.map((f) => f.code), rewritten: res.rewritten, left: res.faults.map((f) => f.code) })]);
      await guard.kvCommand(cfg, ["LTRIM", "lint:log", "0", "999"]);
    }
  } catch (e) {}
  console.log("reply lint:", faults.map((f) => f.code).join(","), res.rewritten ? "→ rewritten" : "→ kept original");
  return res.out;
}

module.exports = { lintReply, rewrite, check, isMetaPrefill, asksToStop, ALLOWED_RUPEES };
