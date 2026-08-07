// ─── DERMALUXE WHATSAPP AI AGENT ────────────────────────────────────────────
// /api/whatsapp — WhatsApp inbound webhook, DUAL MODE:
//   • Twilio senders  (form-encoded POST → TwiML reply)
//   • Meta WhatsApp Cloud API (JSON POST → Graph API reply; GET = verification)
// Claude-powered clinic receptionist: answers in Telugu/English, shares clinic
// info, captures appointment requests as leads (KV + Medicare Connector).
//
// Env vars:
//   ANTHROPIC_API_KEY  – already set (AI analysis)
//   AI_MODEL           – optional, default claude-sonnet-5
//   WA_AGENT_ENABLED   – "1" to enable Claude replies (else static fallback)
//   WA_WEBHOOK_TOKEN   – shared secret: ?token=<value> on the webhook URL and
//                        the Verify token for Meta webhook setup
//   WA_CLOUD_TOKEN     – Meta Cloud API permanent access token (to send replies)
//   TWILIO_AUTH_TOKEN  – optional; when set, X-Twilio-Signature is validated
const crypto = require("crypto");
const guard = require("./_guard.js");
const clinic = require("./_clinic.js");

const LIST_KEY = "dl_leads";
const HIST_TTL = 86400; // 24h conversation memory
const MAX_TURNS = 8;

const CLINIC_FACTS = `You are "DermaLuxe Assistant", the WhatsApp receptionist of DermaLuxe by Medicare — Premium Skin, Hair & Aesthetics Clinic, Eluru (part of Medicare Skin & Hair Clinics family, 3 lakh+ happy clients, 10 branches in Andhra Pradesh).

CLINIC FACTS
- Address: Rama Mahal, Door No. 3-12, Ground Floor, Ramachandra Rao Peta, Kasturi Vari Street, Opposite Happy Mobiles, Near Lakshmi Ganapathi Temple, Eluru – 534002
- Hours: Monday–Saturday 9:00 AM – 9:00 PM. Sunday closed.
- Phones: +91 99491 34666, +91 99591 34666 · Email: support@dermaluxe.ai
- Website: www.dermaluxe.ai (free AI Skin & Hair Analysis available on the site)
- Doctors: MD dermatologists. Founders: Dr. Meghana Valleti (MD DVL, Medical Director), Nagaraju Bandaru (CEO).
- Technology: USFDA-approved — PICO laser, CO2 laser, Diode laser hair removal, Hydrafacial, MNRF, HIFU.
- Services: laser hair removal, PICO pigmentation & tattoo removal, chemical peels, Hydrafacial, MNRF, HIFU skin tightening, acne & scar care, anti-aging, dermal fillers, mesotherapy, PRP & GFC hair therapy, hair transplantation, hair fall treatment, nail treatments, medical weight loss, bridal packages.

RULES
- Reply in the SAME language style the patient uses (Telugu script, Tenglish, or English). Keep it warm, short (2–5 sentences), WhatsApp-style, max 1–2 emojis.
- NEVER quote prices or discounts. For pricing say a consultation/visit is needed. Never diagnose; for medical questions suggest a doctor consultation politely.
- Booking flow: collect (1) name, (2) concern/treatment, (3) preferred day & time — one or two questions at a time. Clinic visit or video consultation both possible.
- When you have at least name + concern, fill "lead" in your output (keep collecting missing bits in the reply). Otherwise "lead" must be null.
- If the patient asks for a human / to talk to staff, tell them our team will call back shortly and set lead with concern "Call back request".
- Patients can send a skin/hair PHOTO here for a quick AI pre-assessment, and VOICE NOTES are understood. If the history shows a photo was analysed earlier, reference those findings naturally when suggesting treatments or booking — don't repeat the whole report.
- If the context marks a RETURNING PATIENT (name/last concern given), greet them warmly by name and continue naturally from their last concern — never ask their name again.
- Quick-menu button taps arrive as plain text: "📅 Book Now" → start the booking flow; "💆 Services" → give a short services overview and ask what concern they have; "📸 Skin Check" → ask them to send a clear face (or scalp) photo right here.
- When the patient asks WHERE the clinic is / address / directions / how to reach, set "send_location": true in your output (a live map pin is sent automatically along with your reply).

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<your whatsapp reply>","lead":null}
or when booking info is ready:
{"reply":"...","lead":{"name":"...","concern":"...","date":"<if given>","slot":"<if given>","mode":"<Clinic Visit|Video|blank>"}}
Optionally add "send_location":true when the patient asks for the address/directions.`;

const PHOTO_RULES = `THE PATIENT JUST SENT A PHOTO on WhatsApp. Give a brief cosmetic skin/hair wellness pre-assessment from it (NOT a medical diagnosis).
Format for WhatsApp, in the patient's language style (from caption/history; default Tenglish), max ~10 short lines:
1. One warm opening line.
2. 📊 Approximate scores out of 100 — skin overall; hair only if scalp/hair is clearly visible.
3. Top 2-3 visible findings with severity (mild/moderate/significant) in simple words.
4. 💡 One practical care tip.
5. Suggest 1-2 relevant DermaLuxe treatments (NEVER prices).
6. Invite them to book a consultation (ask their name if unknown) and mention the free full AI analysis at www.dermaluxe.ai.
7. End with: "Note: idi medical diagnosis kadu — doctor consultation best. 🙏"
If the photo is NOT a skin/hair/face/scalp photo (documents, screenshots, objects), politely say you can only assess skin & hair photos — do not invent an assessment.
Use the SAME JSON output format: {"reply":"...","lead":null} (fill lead only per the booking rules).`;

function xmlEscape(s) {
  return String(s == null ? "" : s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

function twiml(res, text) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + xmlEscape(text) + "</Message></Response>");
}

const FALLBACK_REPLY =
  "Namaste! 🙏 DermaLuxe by Medicare, Eluru — Premium Skin, Hair & Aesthetics.\n" +
  "🕘 Mon–Sat 9 AM–9 PM · 📞 99491 34666\n" +
  "📍 Rama Mahal, R.R. Peta, Kasturi Vari Street, Opp. Happy Mobiles, Eluru\n" +
  "🌐 www.dermaluxe.ai (free AI skin analysis)\n" +
  "మా team త్వరలో మీకు reply చేస్తుంది. Thank you!";

// Twilio signature: base64(HMAC-SHA1(url + sorted(key+value...), authToken))
function twilioSignatureValid(req, authToken) {
  try {
    const sig = req.headers["x-twilio-signature"];
    if (!sig) return false;
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    const url = `${proto}://${host}${req.url}`;
    const params = req.body && typeof req.body === "object" ? req.body : {};
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (e) {
    return false;
  }
}

async function getHistory(cfg, key) {
  try {
    const r = await guard.kvCommand(cfg, ["GET", key]);
    return r.result ? JSON.parse(r.result) : [];
  } catch (e) {
    return [];
  }
}

async function saveHistory(cfg, key, hist) {
  try {
    await guard.kvCommand(cfg, ["SET", key, JSON.stringify(hist.slice(-MAX_TURNS)), "EX", String(HIST_TTL)]);
  } catch (e) {}
}

async function askClaude(hist, userMsg, profileName, extraCtx) {
  const messages = [];
  hist.forEach((t) => {
    messages.push({ role: "user", content: t.u });
    messages.push({ role: "assistant", content: t.a });
  });
  messages.push({ role: "user", content: (extraCtx || "") + (profileName ? `[patient name on WhatsApp: ${profileName}] ` : "") + userMsg });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-sonnet-5",
      max_tokens: 500,
      system: CLINIC_FACTS,
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`claude HTTP ${resp.status}`);
  const data = await resp.json();
  const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    if (parsed && typeof parsed.reply === "string") return parsed;
  } catch (e) {}
  return { reply: text || FALLBACK_REPLY, lead: null };
}

// Quick-menu buttons shown on the first reply of a conversation.
// Falls back to a plain text send if the interactive message is rejected.
async function sendCloudButtons(phoneNumberId, to, bodyText) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !phoneNumberId || !to) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "button",
          body: { text: String(bodyText).slice(0, 1024) },
          action: { buttons: [
            { type: "reply", reply: { id: "book", title: "📅 Book Now" } },
            { type: "reply", reply: { id: "services", title: "💆 Services" } },
            { type: "reply", reply: { id: "skincheck", title: "📸 Skin Check" } },
          ] },
        },
      }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("wa: buttons send failed, falling back to text", r.status, d);
      return sendCloud(phoneNumberId, to, bodyText);
    }
    return true;
  } catch (e) {
    console.error("wa: buttons send error", e && e.message);
    return sendCloud(phoneNumberId, to, bodyText);
  }
}

// Live map pin of the clinic (sent alongside the text when patients ask where we are).
async function sendCloudLocation(phoneNumberId, to) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !phoneNumberId || !to) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "location",
        location: {
          latitude: 16.7107, longitude: 81.0952,
          name: "DermaLuxe by Medicare Skin And Hair Clinic",
          address: "Rama Mahal, R.R. Peta, Kasturi Vari Street, Opp. Happy Mobiles, Eluru 534002",
        },
      }),
    });
    if (!r.ok) console.error("wa: location send failed", r.status);
    return r.ok;
  } catch (e) {
    console.error("wa: location send error", e && e.message);
    return false;
  }
}

const LOCATION_ASK = /(address|location|direction|reach|route|map|ekkad|yekkad|dhari|dari|chirunama|అడ్రస|చిరునామా|ఎక్కడ|లొకేషన|దారి|మ్యాప)/i;

// Long-term patient memory (180 days): name + last concern, so returning
// patients are greeted personally even after the 24h chat history expires.
const PROFILE_TTL = 15552000;
async function getProfile(cfg, digits) {
  if (!cfg || !digits) return null;
  try {
    const r = await guard.kvCommand(cfg, ["GET", `wa:p:${digits}`]);
    return r.result ? JSON.parse(r.result) : null;
  } catch (e) { return null; }
}
async function saveProfile(cfg, digits, name, concern) {
  if (!cfg || !digits || !name) return;
  try {
    await guard.kvCommand(cfg, ["SET", `wa:p:${digits}`,
      JSON.stringify({ name, concern: String(concern || "").slice(0, 120), ts: Date.now() }),
      "EX", String(PROFILE_TTL)]);
  } catch (e) {}
}

// Download WhatsApp media (photo/voice) bytes via the Graph API.
// Returns {base64, mime} | {tooBig:true} | null.
async function fetchMedia(mediaId) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !mediaId) return null;
  try {
    const metaResp = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaResp.ok) { console.error("wa: media meta failed", metaResp.status); return null; }
    const meta = await metaResp.json();
    if (!meta.url) return null;
    if (Number(meta.file_size || 0) > 4500000) return { tooBig: true };
    const binResp = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binResp.ok) { console.error("wa: media download failed", binResp.status); return null; }
    const buf = Buffer.from(await binResp.arrayBuffer());
    return { base64: buf.toString("base64"), mime: String(meta.mime_type || "").split(";")[0].trim() };
  } catch (e) {
    console.error("wa: media fetch error", e && e.message);
    return null;
  }
}

// Voice note → text via Gemini (free tier handles Telugu/Tenglish/English well).
// Claude's API has no audio input, so this is the transcription leg only —
// the reply brain stays Claude. Returns null when GEMINI_API_KEY is unset.
async function transcribeVoice(base64, mime) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const model = process.env.STT_MODEL || "gemini-2.0-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Transcribe this WhatsApp voice note exactly. It may be Telugu, Tenglish (Telugu in English letters), English, or mixed. If Telugu is spoken, transcribe in Telugu script. Output ONLY the transcription, nothing else." },
            { inline_data: { mime_type: mime || "audio/ogg", data: base64 } },
          ],
        }],
      }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("wa: stt failed", r.status, d);
      return null;
    }
    const d = await r.json();
    const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.map((p) => p.text || "").join(" ").trim();
    return text || null;
  } catch (e) {
    console.error("wa: stt error", e && e.message);
    return null;
  }
}

// Claude vision — quick skin/hair pre-assessment of a WhatsApp photo.
async function askClaudeVision(hist, media, caption, profileName, extraCtx) {
  const mime = ["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(media.mime) !== -1 ? media.mime : "image/jpeg";
  const messages = [];
  hist.forEach((t) => {
    messages.push({ role: "user", content: t.u });
    messages.push({ role: "assistant", content: t.a });
  });
  messages.push({
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mime, data: media.base64 } },
      { type: "text", text: (extraCtx || "") + (profileName ? `[patient name on WhatsApp: ${profileName}] ` : "") + (caption || "Photo pampanu — analysis cheyandi.") },
    ],
  });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-sonnet-5",
      max_tokens: 800,
      system: CLINIC_FACTS + "\n\n" + PHOTO_RULES,
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`claude vision HTTP ${resp.status}`);
  const data = await resp.json();
  const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    if (parsed && typeof parsed.reply === "string") return parsed;
  } catch (e) {}
  return { reply: text || FALLBACK_REPLY, lead: null };
}

async function storeLead(cfg, leadInfo, phone, lastMsg) {
  const lead = {
    ts: Date.now(),
    type: "whatsapp",
    name: String(leadInfo.name || "").slice(0, 80).trim(),
    phone,
    age: "",
    gender: "",
    concern: String(leadInfo.concern || "").slice(0, 120),
    message: String(lastMsg || "").slice(0, 400),
    mode: String(leadInfo.mode || "").slice(0, 40),
    date: String(leadInfo.date || "").slice(0, 20),
    slot: String(leadInfo.slot || "").slice(0, 60),
    skin_score: null, hair_score: null, skin_age: null, skin_type: "",
    treatments: [],
    page: "whatsapp-agent",
  };
  if (!lead.name) return;
  await saveProfile(cfg, phone, lead.name, lead.concern); // long-term greeting memory
  const sync = await clinic.forwardLead(cfg, lead);
  if (sync.attempted) lead.synced = sync.synced;
  if (cfg) {
    try {
      await guard.kvCommand(cfg, ["LPUSH", LIST_KEY, JSON.stringify(lead)]);
      await guard.kvCommand(cfg, ["LTRIM", LIST_KEY, "0", "4999"]);
    } catch (e) {}
  }
}

// Meta Cloud API: send a text reply via the Graph API.
async function sendCloud(phoneNumberId, to, text) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !phoneNumberId || !to) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, text: { body: String(text).slice(0, 4000) } }),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.text()).slice(0, 300); } catch (e) {}
      console.error("wa: sendCloud failed", r.status, detail); // token expiry/quality blocks show up in runtime logs
    }
    return r.ok;
  } catch (e) {
    console.error("wa: sendCloud network error", e && e.message);
    return false;
  }
}

module.exports = async (req, res) => {
  const tok = process.env.WA_WEBHOOK_TOKEN;

  // Meta webhook verification handshake
  if (req.method === "GET") {
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && tok && guard.safeEqual(q["hub.verify_token"], tok)) {
      return res.status(200).send(String(q["hub.challenge"] || ""));
    }
    return res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Layer 1: shared-secret token (when configured)
  if (tok && !guard.safeEqual((req.query || {}).token, tok)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const b = req.body || {};
  const isMeta = b && b.object === "whatsapp_business_account";
  const cfg = guard.kvConfig();

  let digits = "", text = "", profileName = "", cloud = null, imageId = "", audioId = "";
  if (isMeta) {
    const entry = (b.entry && b.entry[0]) || {};
    const value = ((entry.changes && entry.changes[0]) || {}).value || {};

    // Layer 2 (Meta): only serve events addressed to our own number —
    // forged/foreign payloads are acknowledged but never replied to.
    const phoneId = String((value.metadata && value.metadata.phone_number_id) || "");
    const allow = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (phoneId && allow.length && allow.indexOf(phoneId) === -1) {
      console.log("wa: ignoring event for unknown phone_number_id", phoneId);
      return res.status(200).json({ ok: true });
    }

    const msg = (value.messages && value.messages[0]) || null;
    // delivery/read status callbacks etc. — acknowledge and ignore
    if (!msg) return res.status(200).json({ ok: true });

    // De-dup: Meta redelivers the same message id if we respond slowly.
    if (cfg && msg.id) {
      try {
        const first = await guard.kvCommand(cfg, ["SET", `wa:seen:${msg.id}`, "1", "NX", "EX", "21600"]);
        if (!first.result) return res.status(200).json({ ok: true });
      } catch (e) {}
    }

    const fromFull = String(msg.from || "").replace(/\D/g, "");
    digits = fromFull.slice(-10);
    profileName = String((value.contacts && value.contacts[0] && value.contacts[0].profile && value.contacts[0].profile.name) || "").slice(0, 60);
    cloud = { phoneNumberId: phoneId, to: fromFull };

    if (msg.type === "text") {
      text = String((msg.text && msg.text.body) || "").slice(0, 1000).trim();
    } else if (msg.type === "button") {
      text = String((msg.button && msg.button.text) || "").slice(0, 1000).trim();
    } else if (msg.type === "interactive") {
      const i = msg.interactive || {};
      text = String((i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || "").slice(0, 1000).trim();
    } else if (msg.type === "image") {
      imageId = String((msg.image && msg.image.id) || "");
      text = String((msg.image && msg.image.caption) || "").slice(0, 500).trim();
      if (!imageId) return res.status(200).json({ ok: true });
    } else if (msg.type === "audio" || msg.type === "voice") {
      audioId = String(((msg.audio || msg.voice || {}).id) || "");
      if (!audioId) return res.status(200).json({ ok: true });
    } else if (["video", "document", "location", "contacts"].indexOf(msg.type) !== -1) {
      // Steer to what the agent CAN handle: text, voice notes, skin/hair photos.
      await sendCloud(cloud.phoneNumberId, cloud.to,
        "Namaste! 🙏 Text, voice note leda skin/hair photo pampandi — photo ki instant AI pre-assessment istanu. 📸\n· టెక్స్ట్, వాయిస్ నోట్ లేదా ఫోటో పంపండి — ఫోటోకి వెంటనే AI విశ్లేషణ ఇస్తాను.");
      return res.status(200).json({ ok: true });
    } else {
      // reaction / sticker / system / unsupported — ignore silently
      return res.status(200).json({ ok: true });
    }
  } else {
    // Layer 2 (Twilio only): signature validation when configured
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken && !twilioSignatureValid(req, authToken)) {
      return res.status(403).json({ error: "Bad signature" });
    }
    const from = String(b.From || "");                     // "whatsapp:+919876543210"
    digits = from.replace(/\D/g, "").slice(-10);           // local 10-digit
    text = String(b.Body || "").slice(0, 1000).trim();
    profileName = String(b.ProfileName || "").slice(0, 60);
  }

  // unified reply transport
  const respond = async (replyText) => {
    if (isMeta) {
      await sendCloud(cloud.phoneNumberId, cloud.to, replyText);
      return res.status(200).json({ ok: true });
    }
    return twiml(res, replyText);
  };

  if (!digits || (!text && !imageId && !audioId)) return respond(FALLBACK_REPLY);

  // Layer 3: rate limits — per phone + global daily
  const perPhone = await guard.rateLimit(cfg, `rl:wa:h:${digits}`, 15, 3600);
  if (!perPhone.allowed) return respond("Please wait a bit — our team will get back to you. 🙏 · కాసేపు ఆగండి, మా team మీకు reply చేస్తుంది.");
  const globalCap = await guard.rateLimit(cfg, `rl:wa:g:${guard.today()}`, 400, 90000);
  if (!globalCap.allowed) return respond(FALLBACK_REPLY);

  if (process.env.WA_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY) {
    return respond(FALLBACK_REPLY);
  }

  const histKey = `wa:h:${digits}`;
  const hist = cfg ? await getHistory(cfg, histKey) : [];
  const firstTurn = hist.length === 0;
  // Returning patient? (24h chat history gone, but the 180-day profile remains)
  const profile = firstTurn ? await getProfile(cfg, digits) : null;
  const extraCtx = profile && profile.name
    ? `[returning patient — name: ${profile.name}${profile.concern ? ", last concern: " + profile.concern : ""}] `
    : "";

  let out;
  try {
    if (imageId) {
      // 📸 Photo → Claude vision pre-assessment (shares the site's global AI cap)
      const imgL = await guard.rateLimit(cfg, `rl:wa:img:${digits}`, 3, 86400);
      const gCap = await guard.rateLimit(cfg, `rl:an:g:${guard.today()}`, 300, 90000);
      if (!imgL.allowed || !gCap.allowed) {
        return respond("Photo analysis limit ayipoindi 🙏 — www.dermaluxe.ai lo FREE full AI analysis try cheyandi, leda mee concern text chesi pampandi.\n· ఫోటో విశ్లేషణ పరిమితి అయిపోయింది — వెబ్‌సైట్‌లో ఉచిత పూర్తి విశ్లేషణ చేయవచ్చు.");
      }
      const media = await fetchMedia(imageId);
      if (media && media.tooBig) return respond("Photo chala pedda undi 🙏 — normal quality photo malli pampandi.\n· ఫోటో చాలా పెద్దగా ఉంది — మామూలు క్వాలిటీలో పంపండి.");
      if (!media) return respond("Photo download avvaledu 🙏 — konchem sepu agi malli pampandi, leda text type cheyandi.\n· ఫోటో డౌన్‌లోడ్ కాలేదు — మళ్ళీ ప్రయత్నించండి.");
      out = await askClaudeVision(hist, media, text, profileName, extraCtx);
      text = "[📷 photo]" + (text ? " " + text : "");
    } else {
      if (audioId) {
        // 🎤 Voice note → Gemini transcription → normal Claude flow
        const vcL = await guard.rateLimit(cfg, `rl:wa:vc:${digits}`, 10, 86400);
        if (!vcL.allowed) return respond("Ee roju voice limit ayipoindi 🙏 — text type chesi pampandi.\n· ఈరోజు వాయిస్ పరిమితి అయిపోయింది — టైప్ చేసి పంపండి.");
        const media = await fetchMedia(audioId);
        const heard = media && !media.tooBig ? await transcribeVoice(media.base64, media.mime) : null;
        if (!heard) {
          return respond("Voice note vinipinchaledu 🙏 — dayachesi text type chesi pampandi.\n· వాయిస్ నోట్ వినిపించలేదు — దయచేసి టైప్ చేసి పంపండి.");
        }
        text = String(heard).slice(0, 1000).trim();
      }
      out = await askClaude(hist, text, profileName, extraCtx);
      if (audioId) text = "[🎤] " + text;
    }
  } catch (e) {
    console.error("wa: ai error", e && e.message);
    return respond(FALLBACK_REPLY);
  }

  if (out.lead && out.lead.name) {
    try { await storeLead(cfg, out.lead, digits, text); } catch (e) {}
  }
  if (cfg) {
    hist.push({ u: text, a: out.reply });
    await saveHistory(cfg, histKey, hist);
  }

  if (isMeta) {
    // First reply of a conversation carries the quick-menu buttons.
    if (firstTurn && !imageId) await sendCloudButtons(cloud.phoneNumberId, cloud.to, out.reply);
    else await sendCloud(cloud.phoneNumberId, cloud.to, out.reply);
    // Map pin when the patient asked where we are (Claude flag or keyword).
    if (out.send_location === true || LOCATION_ASK.test(text)) {
      await sendCloudLocation(cloud.phoneNumberId, cloud.to);
    }
    return res.status(200).json({ ok: true });
  }
  return twiml(res, out.reply);
};
