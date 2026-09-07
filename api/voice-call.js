// ─── DERMALUXE PHONE AI ──────────────────────────────────────────────────────
// Twilio Programmable Voice webhook — the clinic's after-hours receptionist.
//
//   POST /api/voice-call?token=<WA_WEBHOOK_TOKEN>          → answer + greet
//   POST /api/voice-call?token=...&step=turn               → speech → Claude → speak
//   POST /api/voice-call?token=...&step=status             → missed call → WhatsApp
//
// Speech recognition is Twilio's (<Gather input="speech" language="te-IN">),
// the brain is the same Claude clinic agent, and the voice is our own Gemini
// TTS MP3 played back with <Play> — Twilio's built-in <Say> has no Telugu.
// Everything degrades: no TTS → <Say> in English; AI down → transfer message.
//
// Env: TWILIO_AUTH_TOKEN (signature check), WA_WEBHOOK_TOKEN (URL secret),
//      CLINIC_FALLBACK_NUMBER (optional, for <Dial> during clinic hours).
const crypto = require("crypto");
const guard = require("./_guard.js");
const facts = require("./_facts.js");
const voice = require("./_voice.js");
const notify = require("./_notify.js");
const clinic = require("./_clinic.js");

const HIST_TTL = 3600;
const MAX_TURNS = 6;

const CALL_RULES = `- This is a PHONE CALL — the patient is speaking, not typing. Their words reach you from speech recognition, so expect small mistakes and never comment on them.
- Speak like a warm human receptionist: SHORT sentences, no emojis, no bullet points, no asterisks, no URLs, no website addresses. Everything you write will be READ ALOUD.
- Max 45 words per reply. One question at a time. If they go quiet, gently repeat the question.
- Booking flow: name → concern → preferred day and time. Confirm the details back to them before ending.
- Never quote prices; say the doctor decides after seeing them. Never diagnose or name medicines.
- If it sounds like a medical emergency, tell them to come to the clinic or call an ambulance immediately, and set "urgent".
- When they are done (they say bye/thanks/that's all) or the booking is confirmed, set "end": true.

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<what to say aloud>","lead":null}
or when you have name + concern:
{"reply":"...","lead":{"name":"...","concern":"...","date":"<if given>","slot":"<if given>","heat":"hot|warm|cold","call_prep":"<2 short Tenglish lines for our follow-up call>"},"end":false}
Optionally add "urgent":"<one line>" and "end":true.`;

const CLINIC_FACTS = facts.clinicFacts("phone call", CALL_RULES);

function xml(res, body) {
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response>' + body + "</Response>");
}
const esc = (s) => String(s == null ? "" : s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

// Twilio signature: base64(HMAC-SHA1(url + sorted params, authToken)).
function twilioValid(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true; // not configured yet — the ?token secret still guards us
  try {
    const sig = req.headers["x-twilio-signature"];
    if (!sig) return false;
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    const url = `${proto}://${host}${req.url}`;
    const p = req.body && typeof req.body === "object" ? req.body : {};
    const data = url + Object.keys(p).sort().map((k) => k + p[k]).join("");
    const expect = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
    return guard.safeEqual(sig, expect);
  } catch (e) { return false; }
}

// Speak a line: our Gemini voice when we can, Twilio's own voice otherwise.
async function speak(cfg, req, text) {
  const clean = voice.stripForTts(text).slice(0, 420);
  try {
    const mp3 = await voice.synthesize(clean);
    if (mp3) {
      const aid = await voice.parkAudio(cfg, mp3, 1800);
      if (aid) return `<Play>${esc(voice.publicBase(req) + "/api/media?aud=" + aid)}</Play>`;
    }
  } catch (e) { console.error("call: tts", e && e.message); }
  return `<Say language="en-IN">${esc(clean)}</Say>`;
}

function gather(req, inner) {
  const action = `${voice.publicBase(req)}/api/voice-call?token=${encodeURIComponent(process.env.WA_WEBHOOK_TOKEN || "")}&amp;step=turn`;
  return `<Gather input="speech" language="te-IN" speechTimeout="auto" timeout="6" action="${action}" method="POST">${inner}</Gather>`
    + `<Redirect method="POST">${action}&amp;silent=1</Redirect>`;
}

function istHour() {
  return new Date(Date.now() + 330 * 60000).getUTCHours();
}

async function storeCallLead(cfg, info, from, said) {
  const phone = String(from || "").replace(/\D/g, "").slice(-10);
  const name = String(info.name || "").slice(0, 80).trim();
  if (!name || phone.length !== 10) return;
  const lead = {
    ts: Date.now(), type: "phone_call", name, phone,
    age: "", gender: "",
    concern: String(info.concern || "").slice(0, 120),
    message: String(said || "").slice(0, 400),
    mode: "Clinic Visit", date: String(info.date || "").slice(0, 20), slot: String(info.slot || "").slice(0, 60),
    skin_score: null, hair_score: null, skin_age: null, skin_type: "", treatments: [],
    page: "phone-agent",
    heat: ["hot", "warm", "cold"].indexOf(String(info.heat || "").toLowerCase()) !== -1 ? String(info.heat).toLowerCase() : "hot",
    call_prep: String(info.call_prep || "").slice(0, 220),
    src_id: phone,
  };
  if (cfg) {
    try {
      const recent = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "29"]);
      for (const s of (recent.result || [])) {
        try {
          const l = JSON.parse(s);
          if (l.type === "phone_call" && l.phone === phone && lead.ts - l.ts < 21600000) {
            await guard.kvCommand(cfg, ["LREM", "dl_leads", "1", s]);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  const sync = await clinic.forwardLead(cfg, lead);
  if (sync.attempted) lead.synced = sync.synced;
  if (cfg) {
    try {
      await guard.kvCommand(cfg, ["LPUSH", "dl_leads", JSON.stringify(lead)]);
      await guard.kvCommand(cfg, ["LTRIM", "dl_leads", "0", "4999"]);
    } catch (e) {}
  }
  await notify.leadAlert(cfg, lead);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const secret = process.env.WA_WEBHOOK_TOKEN || "";
  const q = req.query || {};
  if (!secret || !guard.safeEqual(String(q.token || ""), secret)) return res.status(403).json({ error: "Forbidden" });
  if (!twilioValid(req)) return res.status(403).json({ error: "Bad signature" });

  const cfg = guard.kvConfig();
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const from = String(b.From || "").replace(/\D/g, "").slice(-10);
  const step = String(q.step || "");

  // ── Missed / unanswered call → instant WhatsApp so the lead isn't lost ──
  if (step === "status") {
    const status = String(b.CallStatus || b.DialCallStatus || "");
    if (from && ["no-answer", "busy", "failed", "canceled"].indexOf(status) !== -1) {
      let go = true;
      if (cfg) {
        const nx = await guard.kvCommand(cfg, ["SET", `ntf:miss:${from}`, "1", "NX", "EX", "21600"]).catch(() => ({}));
        go = !!(nx && nx.result);
      }
      if (go) {
        const sent = await notify.sendWa(from,
          "Namaste! 🙏 Meeru ippude DermaLuxe ki call chesaru — miss ayindi, sorry!\n\nIkkade WhatsApp lo cheppandi — appointment book chestam leda mee doubts ki reply chestam 😊\n\n📍 Rama Mahal, Kasturi Vari Street, Eluru\n⏰ Mon-Sat, 9 AM - 9 PM");
        if (!sent) {
          await notify.sendWaTemplate(from, "clinic_update",
            ["friend", "Meeru ippude DermaLuxe ki call chesaru — miss ayindi, sorry! Appointment leda doubts unte ee message ki reply cheyandi 😊"]).catch(() => {});
        }
        const team = String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666")
          .split(",").map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10);
        for (const to of team) {
          await notify.sendWa(to, `📞 *Missed call* — ${from}\nAgent WhatsApp message pampindi. Meeru kuda call cheyandi 🙏`).catch(() => {});
        }
      }
    }
    return res.status(200).json({ ok: true });
  }

  // ── Live conversation ──
  const histKey = `call:h:${from || b.CallSid || "x"}`;
  let hist = [];
  if (cfg) {
    try {
      const r = await guard.kvCommand(cfg, ["GET", histKey]);
      hist = r.result ? JSON.parse(r.result) : [];
    } catch (e) {}
  }

  if (step !== "turn") {
    // First leg: during clinic hours try the humans first (when configured).
    const h = istHour();
    const open = h >= 9 && h < 21 && new Date(Date.now() + 330 * 60000).getUTCDay() !== 0;
    if (open && process.env.CLINIC_FALLBACK_NUMBER) {
      const st = `${voice.publicBase(req)}/api/voice-call?token=${encodeURIComponent(secret)}&amp;step=status`;
      return xml(res,
        `<Dial timeout="18" action="${st}" method="POST"><Number>${esc(process.env.CLINIC_FALLBACK_NUMBER)}</Number></Dial>`);
    }
    if (cfg) await guard.kvCommand(cfg, ["DEL", histKey]).catch(() => {});
    const greet = open
      ? "Namaste! DermaLuxe by Medicare ki call chesinanduku thanks. Nenu clinic assistant ni. Cheppandi, meeku em kavali?"
      : "Namaste! DermaLuxe by Medicare. Ippudu clinic close ayindi, kani nenu mee appointment ippude book chestanu. Cheppandi, mee samasya emiti?";
    return xml(res, gather(req, await speak(cfg, req, greet)));
  }

  const said = String(b.SpeechResult || "").trim().slice(0, 500);
  if (!said) {
    const tries = Number(q.silent ? 1 : 0) + (hist.length ? 1 : 0);
    if (tries >= 2) {
      return xml(res, await speak(cfg, req, "Vinipinchaledu andi. WhatsApp lo 9 9 5 9 1 3 4 6 6 6 ki message cheyandi, ventane reply chestam. Dhanyavadalu.") + "<Hangup/>");
    }
    return xml(res, gather(req, await speak(cfg, req, "Sorry, vinipinchaledu. Malli cheppagalara?")));
  }

  let out;
  try {
    const messages = [];
    hist.forEach((t) => {
      messages.push({ role: "user", content: t.u });
      messages.push({ role: "assistant", content: t.a });
    });
    const ctx = `[Phone call from ${from || "unknown"}. Now: ${new Date(Date.now() + 330 * 60000).toUTCString().slice(0, 22)} IST] `;
    messages.push({ role: "user", content: ctx + said });
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.AI_MODEL || "claude-opus-5", max_tokens: 600, system: CLINIC_FACTS, messages }),
    });
    if (!resp.ok) throw new Error("claude HTTP " + resp.status);
    const data = await resp.json();
    const text = ((data.content || []).find((x) => x.type === "text") || {}).text || "";
    try {
      const m = text.match(/\{[\s\S]*\}/);
      out = JSON.parse(m ? m[0] : text);
    } catch (e) { out = null; }
    if (!out || typeof out.reply !== "string") out = { reply: facts.salvageReply(text) || "Cheppandi andi.", lead: null };
  } catch (e) {
    console.error("call: ai error", e && e.message);
    return xml(res, await speak(cfg, req, "Chinna technical problem andi. Mana team meeku call chestundi, leda WhatsApp lo message cheyandi. Dhanyavadalu.") + "<Hangup/>");
  }

  if (out.lead && out.lead.name) {
    try { await storeCallLead(cfg, out.lead, from, said); } catch (e) {}
  }
  if (out.urgent && from) {
    const team = String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666")
      .split(",").map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10);
    for (const to of team) {
      await notify.sendWa(to, `🚨 *URGENT — phone call*\n📱 ${from}\n⚠️ ${String(out.urgent).slice(0, 200)}\n💬 "${said.slice(0, 160)}"\n\nVentane call cheyandi 🙏`).catch(() => {});
    }
  }
  if (cfg) {
    hist.push({ u: said, a: out.reply });
    await guard.kvCommand(cfg, ["SET", histKey, JSON.stringify(hist.slice(-MAX_TURNS)), "EX", String(HIST_TTL)]).catch(() => {});
  }

  const spoken = await speak(cfg, req, out.reply);
  if (out.end === true || hist.length >= MAX_TURNS) {
    return xml(res, spoken + await speak(cfg, req, "Dhanyavadalu andi. Meeku manchi jarugutundi.") + "<Hangup/>");
  }
  return xml(res, gather(req, spoken));
};
