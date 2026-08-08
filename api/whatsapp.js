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
const admin = require("./_admin.js");

const LIST_KEY = "dl_leads";
const HIST_TTL = 86400; // 24h conversation memory
const MAX_TURNS = 8;

const facts = require("./_facts.js");

// WhatsApp-specific behaviour on top of the shared clinic brain.
const WA_RULES = `- Booking flow: collect (1) name, (2) concern/treatment, (3) preferred day & time — one or two questions at a time. Clinic visit or video consultation both possible.
- When you have at least name + concern, fill "lead" in your output (keep collecting missing bits in the reply). Otherwise "lead" must be null.
- Quick-menu button taps arrive as plain text: "📅 Book Now" → start the booking flow; "💆 Services" → give a short services overview and ask what concern they have; "📸 Skin Check" → ask them to send a clear face (or scalp) photo right here.
- When the patient asks WHERE the clinic is / address / directions / how to reach, set "send_location": true in your output (a live map pin is sent automatically along with your reply).

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<your whatsapp reply>","lead":null}
or when booking info is ready:
{"reply":"...","lead":{"name":"...","concern":"...","date":"<if given>","slot":"<if given>","mode":"<Clinic Visit|Video|blank>"}}
Optionally add "send_location":true when the patient asks for the address/directions.`;

const CLINIC_FACTS = facts.clinicFacts("WhatsApp", WA_RULES);
const PHOTO_RULES = facts.photoRules("WhatsApp");

function xmlEscape(s) {
  return String(s == null ? "" : s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

function twiml(res, text) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + xmlEscape(text) + "</Message></Response>");
}

const FALLBACK_REPLY = facts.FALLBACK_REPLY;

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
  // Each model has its own free-tier quota — on 429/404 fall through to the next.
  const models = [];
  if (process.env.STT_MODEL) models.push(process.env.STT_MODEL);
  ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"].forEach((m) => {
    if (models.indexOf(m) === -1) models.push(m);
  });
  for (const model of models) {
    try {
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
      if (r.status === 429 || r.status === 404) {
        let d = ""; try { d = (await r.text()).slice(0, 400); } catch (e) {}
        console.error("wa: stt skipping model", model, r.status, d);
        continue;
      }
      if (!r.ok) {
        let d = ""; try { d = (await r.text()).slice(0, 400); } catch (e) {}
        console.error("wa: stt failed", model, r.status, d);
        return null;
      }
      const d = await r.json();
      const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
      const text = parts.map((p) => p.text || "").join(" ").trim();
      if (text) return text;
    } catch (e) {
      console.error("wa: stt error", model, e && e.message);
      return null;
    }
  }
  return null;
}

// ---- Voice replies (voice note in → voice note out) ---------------------
// Gemini TTS returns raw PCM (16-bit mono, usually 24kHz); WhatsApp only takes
// aac/mp3/amr/ogg-opus and serverless has no ffmpeg, so we encode MP3 with the
// pure-JS lamejs port. Any failure falls back to the normal text-only reply.

async function pcmToMp3(pcm, rate) {
  const lame = await import("@breezystack/lamejs"); // ESM-only package
  const Mp3Encoder = lame.Mp3Encoder || (lame.default && lame.default.Mp3Encoder);
  const byteLen = pcm.length - (pcm.length % 2);
  const ab = new ArrayBuffer(byteLen); // copy → guaranteed 2-byte alignment
  new Uint8Array(ab).set(pcm.subarray(0, byteLen));
  const samples = new Int16Array(ab);
  const enc = new Mp3Encoder(1, rate || 24000, 48);
  const out = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const buf = enc.encodeBuffer(samples.subarray(i, i + 1152));
    if (buf.length) out.push(Buffer.from(buf));
  }
  const end = enc.flush();
  if (end.length) out.push(Buffer.from(end));
  return Buffer.concat(out);
}

async function synthesizeVoice(script) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !script) return null;
  const models = [process.env.TTS_MODEL || "gemini-2.5-flash-preview-tts", "gemini-2.5-flash-tts", "gemini-2.5-pro-preview-tts"];
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: script }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.TTS_VOICE || "Aoede" } } },
          },
        }),
      });
      if (r.status === 404 || r.status === 429) { // renamed model / per-model quota — try the next
        let d = ""; try { d = (await r.text()).slice(0, 400); } catch (e) {}
        console.error("wa: tts skipping model", model, r.status, d);
        continue;
      }
      if (!r.ok) {
        let d = ""; try { d = (await r.text()).slice(0, 400); } catch (e) {}
        console.error("wa: tts failed", model, r.status, d);
        return null;
      }
      const d = await r.json();
      const part = ((((d.candidates || [])[0] || {}).content || {}).parts || [])
        .find((p) => (p.inlineData || p.inline_data || {}).data);
      const inline = part && (part.inlineData || part.inline_data);
      if (!inline) return null;
      const m = String(inline.mimeType || inline.mime_type || "").match(/rate=(\d+)/);
      return await pcmToMp3(Buffer.from(inline.data, "base64"), m ? Number(m[1]) : 24000);
    } catch (e) {
      console.error("wa: tts error", e && e.message);
      return null;
    }
  }
  return null;
}

// Upload the MP3 to WhatsApp media, then send it as an audio message.
async function sendCloudVoice(phoneNumberId, to, mp3) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !phoneNumberId || !to || !mp3 || !mp3.length) return false;
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "audio/mpeg");
    form.append("file", new Blob([mp3], { type: "audio/mpeg" }), "reply.mp3");
    const up = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!up.ok) {
      let d = ""; try { d = (await up.text()).slice(0, 200); } catch (e) {}
      console.error("wa: voice upload failed", up.status, d);
      return false;
    }
    const meta = await up.json();
    if (!meta.id) return false;
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "audio", audio: { id: meta.id } }),
    });
    if (!r.ok) console.error("wa: voice send failed", r.status);
    return r.ok;
  } catch (e) {
    console.error("wa: voice send error", e && e.message);
    return false;
  }
}

// TTS fallback text: drop URLs/emojis/markdown so the fallback script is speakable.
function stripForTts(s) {
  return String(s || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_`#>·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VOICE_CTX = "[The patient sent this as a VOICE note. After your normal reply, append ONE extra final line formatted exactly as VOICE_SCRIPT: <script> — a natural spoken version of your reply for text-to-speech: the same language the patient spoke (if they spoke Telugu, write the script in Telugu script), warm receptionist tone, digits and times spoken naturally, no emojis, no URLs, no lists, under 55 words.] ";

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
  lead.src_id = phone;
  await saveProfile(cfg, phone, lead.name, lead.concern); // long-term greeting memory
  // One lead per patient per 6h conversation window — as the chat progresses,
  // replace the earlier row with this enriched one instead of stacking dupes.
  if (cfg) {
    try {
      const recent = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", "49"]);
      for (const s of (recent.result || [])) {
        try {
          const l = JSON.parse(s);
          if ((l.src_id || l.phone) === phone && l.type === lead.type && lead.ts - l.ts < 21600000) {
            await guard.kvCommand(cfg, ["LREM", LIST_KEY, "1", s]);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
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

  // Owner/admin commands (ADMIN_PHONES allowlist; explicit commands only —
  // anything else from the admin falls through to the normal agent).
  if (isMeta && admin.isAdmin(digits)) {
    try {
      const adminReply = await admin.handle(cfg, digits, text,
        imageId ? { fetch: () => fetchMedia(imageId) } : null);
      if (adminReply) {
        await sendCloud(cloud.phoneNumberId, cloud.to, adminReply);
        return res.status(200).json({ ok: true });
      }
    } catch (e) { console.error("wa: admin error", e && e.message); }
  }

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
  let voiceScript = "";
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
      out = await askClaude(hist, text, profileName, audioId ? extraCtx + VOICE_CTX : extraCtx);
      if (audioId) {
        // Pull the TTS script line out of the visible reply.
        const vm = String(out.reply || "").match(/\n?\s*VOICE_SCRIPT\s*:\s*([\s\S]+?)\s*$/);
        if (vm) {
          voiceScript = vm[1].trim().slice(0, 450);
          out.reply = String(out.reply).slice(0, vm.index).trim() || FALLBACK_REPLY;
        }
        text = "[🎤] " + text;
      }
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
    // Voice note in → voice note out (text still follows as the readable copy).
    if (audioId) {
      try {
        const mp3 = await synthesizeVoice(voiceScript || stripForTts(out.reply).slice(0, 350));
        if (mp3) await sendCloudVoice(cloud.phoneNumberId, cloud.to, mp3);
      } catch (e) { console.error("wa: voice reply error", e && e.message); }
    }
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
