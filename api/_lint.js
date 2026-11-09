// The last check before a reply leaves for a patient's phone.
//
// The prompt already says all of this. Rules in a long prompt are followed
// most of the time; a check that reads the actual reply is followed every
// time. Each check is deterministic and cheap. A reply that trips one is
// rewritten once by the model with the fault named; if the rewrite is no
// better, the original goes out rather than nothing.
const facts = require("./_facts.js");

// Rupee figures the agent is allowed to say: the academy's published fees —
// the seat, the two launch prices, and the two regular prices they are cut
// from. The regular ones were missing: an honest "regular ₹1,00,000" tripped
// price_quoted, and the rewrite "fixed" it to "regular ₹99,999" (6 Nov).
const ALLOWED_RUPEES = new Set([9999, 49999, 99999, 100000, 200000,
  // the hair transplant package, 6 Nov – 6 Dec 2026 (owner, 7 Nov)
  ...(Date.now() < Date.parse("2026-12-07T00:00:00+05:30") ? [59999] : [])]);
// Beyond the package's 3,000 grafts the owner charges ₹20 a graft (9 Nov), so
// an honest total for 3,500 grafts is ₹69,999 — the package plus a whole
// number of ₹20s. Up to 3,000 extra grafts; anything else is still caught.
const HT_PACKAGE = 59999, HT_PER_GRAFT = 20;
const htTotal = (n) => Date.now() < Date.parse("2026-12-07T00:00:00+05:30") && n > HT_PACKAGE && n <= HT_PACKAGE + HT_PER_GRAFT * 3000 && (n - HT_PACKAGE) % HT_PER_GRAFT === 0;
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
  const odd = [...new Set(rupees.filter((n) => !ALLOWED_RUPEES.has(n) && !htTotal(n) && !(o.allow && o.allow.has(n))))];
  if (odd.length) faults.push({ code: "price_quoted", note: `₹${odd.join(", ₹")} cheppav — treatment prices eppudu cheppakudadu; "consultation lo doctor exact plan istaru" ani cheppi slot adugu (allowed: academy seat ₹9,999; launch ₹49,999 / ₹99,999; regular ₹1,00,000 / ₹2,00,000; hair transplant package ₹59,999 + ₹20 per graft beyond 3,000, till 6 Dec)` });

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
  const confirmish = /(book ayindi|note chesanu|confirm|reserve chesa|✅|ventane|immediately|call cheyandi|99[45]91 34666|emergency)/i.test(prose);
  const goodbye = /(see you|take care|kaluddam|jagratta|thank you|dhanyavadalu|welcome)/i.test(prose);
  if (questions === 0 && !hasChoice && !confirmish && !asksToStop(lastMsg) && !(goodbye && (o.booked || ackOnly)) && prose.length > 60) {
    faults.push({ code: "no_next_step", note: "reply question lekunda, buttons/slots lekunda aagipoyindi (dead end) — chivarlo okka chinna question leda slots undali" });
  }

  // Booking confirmed, then doubted again.
  if (/(book ayindi|note chesanu|reserve chesa|✅)/i.test(prose) && /(sari ?potunda|ok na\?|kudurutunda|marchamantara|vere time)/i.test(prose)) faults.push({ code: "confirm_then_ask", note: "book chesaka 'ee time ok na?' ani malli adagaku — 'marchali ante okka maata cheppandi' ani okka line" });

  // The same thing we already said, in our last three.
  const rec = (Array.isArray(recent) ? recent : []).slice(-3);
  // Telugu letters inside a Tenglish reply ("chestాను", "Chెప్పండి", "అయినా"):
  // the model slips mid-word, and a patient reading English letters sees a
  // broken word. A reply written in Telugu script for a Telugu writer is fine.
  const mixedWord = /[A-Za-z][ఀ-౿]|[ఀ-౿][A-Za-z]/.test(prose);
  const strayTelugu = replyTelugu > 0 && replyTelugu < 25 && replyEnglish > 40 && replyEnglish > replyTelugu * 4 && !hasTelugu(said);
  if (mixedWord || strayTelugu) faults.push({ code: "mixed_script", note: "Telugu aksharalu English letters reply madhyalo kalisayi (udaharana 'chestాను') — motham reply English letters lo (Tenglish) raayi, Telugu script okka aksharam kuda vaddu" });

  if (rec.some((p) => similar(p, reply))) faults.push({ code: "repeat", note: "ide maata already cheppam — malli kaadu; kotha angle: oppukunte first slot book chesi cheppu, 'tarvata' ante okasari sare ani mugincha" });

  return faults;
}

// The last word of the rewrite is only the start of a word the original had,
// and not a word of its own there.
function cutMidWord(fixed, orig) {
  const last = (String(fixed || "").match(/([A-Za-zఀ-౿]+)[^A-Za-zఀ-౿]*$/) || [])[1];
  if (!last || last.length < 2) return false;
  const words = String(orig || "").match(/[A-Za-zఀ-౿]+/g) || [];
  return !words.includes(last) && words.some((w) => w.length > last.length && w.startsWith(last));
}

// A profile label used as a name ("Mahadev garu") is taken out here, without a
// model call: it was the commonest fault, and each rewrite was a fresh chance
// for the model to cut the reply short.
function dropLabel(out, label) {
  if (!label) return out;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let r = String(out.reply || "")
    .replace(new RegExp(`(^|\\n)\\s*${esc}\\s+garu\\s*[,—–-]?\\s*`, "gi"), "$1")
    .replace(new RegExp(`\\s*,?\\s*\\b${esc}\\s+garu\\b`, "gi"), "")
    .replace(/(^|\n)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return Object.assign({}, out, { reply: r });
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
        model: process.env.AI_MODEL || "claude-opus-5", max_tokens: 2000,
        system: "You fix one WhatsApp reply from DermaLuxe Assistant (a skin & hair clinic receptionist in Eluru), keeping the same language, tone, every fact and the booking intent. Return ONLY the corrected reply text, no JSON, no preamble.",
        messages: [{ role: "user", content: `REPLY:\n${out.reply}\n\nFAULTS TO FIX:\n${faults.map((f) => "- " + f.note).join("\n")}\n\nRules: exactly one question mark in the whole reply (or none when buttons/slots are offered); never a treatment price or a medicine name; never name a condition the patient did not name; no safety verdicts; end with one short next step unless it is a confirmation, an emergency, or the reply to a stop request; Tenglish (Telugu in English letters) unless the patient wrote real English of their own. Keep it 2–6 short lines.` }],
      }),
    });
    if (!r.ok) return { out, faults, rewritten: false };
    const d = await r.json();
    const fixed = String(((d.content || []).find((b) => b.type === "text") || {}).text || "").trim();
    if (!fixed) return { out, faults, rewritten: false };
    // On 6 November a hair transplant enquiry was answered "Namaste 🙏 DermaLu"
    // and nothing more: the rewrite stopped early, and a reply cut that short
    // has no question, no price, no name — so it scored fewer faults than the
    // whole one and won. A rewrite that did not finish, or lost most of the
    // reply, is never better than the original.
    if ((d.stop_reason && d.stop_reason !== "end_turn") || fixed.length < String(out.reply || "").length * 0.4) {
      console.error("reply lint: rewrite dropped —", d.stop_reason, fixed.length, "of", String(out.reply || "").length);
      return { out, faults, rewritten: false };
    }
    // A rewrite that ends half-way through one of the original's words
    // ("Mee concern cheppand", 6 Nov 18:32) lost its ending, however long it is.
    if (cutMidWord(fixed, out.reply)) {
      console.error("reply lint: rewrite dropped — ends mid-word");
      return { out, faults, rewritten: false };
    }
    const next = Object.assign({}, out, { reply: fixed });
    const left = lintReply(next, patientText, opts && opts.recent, opts);
    if (left.length < faults.length) return { out: next, faults: left, rewritten: true };
    return { out, faults, rewritten: false };
  } catch (e) { return { out, faults, rewritten: false }; }
}

// The hard price block, after the editor has had its say.
//
// On 7 and 8 November the WhatsApp agent told hair transplant enquiries
// "₹59,999" — the brief carried that figure for the owner's package, and the
// daily review (review:2026-11-07, review:2026-11-08) marked the chats down
// for it. The owner's decision of 9 Nov: no treatment price in chat at all,
// as a rule the code enforces rather than one the model is asked to follow.
// Any rupee amount of ₹500 or more is cut out with the sentence it sits in,
// and one line sends them to the consultation. The two cases where a number
// is still allowed are decided by the caller, not here: the owner's "bands"
// price policy, and an academy enquiry (the academy's fees are published).
//
// Forms caught: ₹59,999 · Rs 60000 · Rs. 60,000 · INR 60000 · 60k · ₹60k ·
// 1.2 lakh · 59,999 rupees / rupayalu. A bare number with no rupee mark or
// unit ("3,000 grafts", "6:30 PM") is left alone, and so is anything under
// ₹500 — the ₹300 consultation fee and "₹20 per graft" pass untouched.
const PRICE_FLOOR = 500;
const NUM = "\\d[\\d,]*(?:\\.\\d+)?";
const AMOUNT = new RegExp(`(?:₹|\\brs\\.?|\\binr\\b)\\s*(${NUM})\\s*(k|lakhs?|lacs?)?\\b|\\b(${NUM})\\s*(k|lakhs?|lacs?|rupees|rupayalu|rupaayalu|rs\\.?|రూపాయలు)\\b`, "gi");
const UNIT = { k: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000 };
const CONSULT_LINE = "Exact cost doctor consultation lo mee skin/hair chusaka cheptaru — consultation ₹300 matrame 🙏";
function amountsIn(sentence) {
  const out = [];
  for (const m of String(sentence || "").matchAll(AMOUNT)) {
    const n = Number(String(m[1] || m[3]).replace(/,/g, ""));
    const unit = String(m[2] || m[4] || "").toLowerCase();
    if (!isFinite(n)) continue;
    out.push(Math.round(n * (UNIT[unit] || 1)));
  }
  return out;
}
// opts.allow: a Set of amounts the caller still permits (the owner's
// consultation fee when it is ₹500 or more). Returns {reply, removed}.
function stripTreatmentPrices(reply, opts) {
  const o = opts || {};
  const allow = o.allow instanceof Set ? o.allow : new Set();
  const removed = [];
  const lines = String(reply || "").split("\n").map((line) => {
    // Sentences, keeping their own end marks so what stays reads as written.
    // An end mark only counts before a space or the end of the line, and not
    // after "Rs" / "Dr" / "approx", so the point in "1.2 lakh" or "Rs. 60,000"
    // does not split a sentence in two and leave the number standing alone.
    const parts = line.match(/.+?(?:(?<!\b(?:rs|dr|mrs?|approx|no))[.!?]+(?=\s|$)|$)/gi) || [];
    return parts.filter((s) => {
      const bad = amountsIn(s).filter((n) => n >= PRICE_FLOOR && !allow.has(n));
      if (!bad.length) return true;
      removed.push(...bad);
      return false;
    }).join("").replace(/\s+$/, "");
  }).filter((l) => l.trim());
  if (!removed.length) return { reply: String(reply || ""), removed };
  const kept = lines.join("\n").trim();
  return { reply: (kept ? kept + "\n\n" : "") + CONSULT_LINE, removed: [...new Set(removed)] };
}

// Lint, rewrite if needed, and write the editor's log line. Returns the reply to send.
let allowCache = { at: 0, set: null };
async function check(cfg, out, patientText, recent, opts) {
  const o = Object.assign({}, opts || {}, { recent });
  // The owner's price policy: numbers it permits are not faults. Read once a
  // few minutes, not once a reply.
  if (cfg && !o.allow) {
    if (Date.now() - allowCache.at > 300000) { allowCache = { at: Date.now(), set: await require("./_prices.js").allowed(cfg).catch(() => null) }; }
    if (allowCache.set) o.allow = allowCache.set;
  }
  let faults = lintReply(out, patientText, recent, o);
  if (!faults.length) return out;
  if (faults.some((f) => f.code === "profile_name_used")) {
    out = dropLabel(out, String(o.profileName || "").trim().split(/\s+/)[0] || "");
    const before = faults.map((f) => f.code);
    faults = lintReply(out, patientText, recent, o);
    if (!faults.length) {
      try { if (cfg && !o.exam) { const guard = require("./_guard.js"); await guard.kvCommand(cfg, ["LPUSH", "lint:log", JSON.stringify({ ts: Date.now(), ch: o.channel || "wa", faults: before, rewritten: "label", left: [] })]); } } catch (e) {}
      return out;
    }
  }
  const res = await rewrite(out, faults, patientText, o);
  try {
    const guard = require("./_guard.js");
    if (cfg && !o.exam) {      // the nightly exam's chats are not the day's record
      await guard.kvCommand(cfg, ["LPUSH", "lint:log", JSON.stringify({ ts: Date.now(), ch: o.channel || "wa", faults: faults.map((f) => f.code), rewritten: res.rewritten, left: res.faults.map((f) => f.code) })]);
      await guard.kvCommand(cfg, ["LTRIM", "lint:log", "0", "999"]);
    }
  } catch (e) {}
  console.log("reply lint:", faults.map((f) => f.code).join(","), res.rewritten ? "→ rewritten" : "→ kept original");
  return res.out;
}

module.exports = { lintReply, rewrite, check, cutMidWord, dropLabel, isMetaPrefill, asksToStop, ALLOWED_RUPEES, stripTreatmentPrices, amountsIn, CONSULT_LINE };
