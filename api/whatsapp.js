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

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<your whatsapp reply>","lead":null}
or when booking info is ready:
{"reply":"...","lead":{"name":"...","concern":"...","date":"<if given>","slot":"<if given>","mode":"<Clinic Visit|Video|blank>"}}`;

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

async function askClaude(hist, userMsg, profileName) {
  const messages = [];
  hist.forEach((t) => {
    messages.push({ role: "user", content: t.u });
    messages.push({ role: "assistant", content: t.a });
  });
  messages.push({ role: "user", content: (profileName ? `[patient name on WhatsApp: ${profileName}] ` : "") + userMsg });

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
    return r.ok;
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  const tok = process.env.WA_WEBHOOK_TOKEN;

  // Meta webhook verification handshake
  if (req.method === "GET") {
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && tok && q["hub.verify_token"] === tok) {
      return res.status(200).send(String(q["hub.challenge"] || ""));
    }
    return res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Layer 1: shared-secret token (when configured)
  if (tok && String((req.query || {}).token || "") !== tok) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const b = req.body || {};
  const isMeta = b && b.object === "whatsapp_business_account";

  let digits = "", text = "", profileName = "", cloud = null;
  if (isMeta) {
    const entry = (b.entry && b.entry[0]) || {};
    const value = ((entry.changes && entry.changes[0]) || {}).value || {};
    const msg = (value.messages && value.messages[0]) || null;
    // delivery/read status callbacks etc. — acknowledge and ignore
    if (!msg || msg.type !== "text") return res.status(200).json({ ok: true });
    text = String((msg.text && msg.text.body) || "").slice(0, 1000).trim();
    const fromFull = String(msg.from || "").replace(/\D/g, "");
    digits = fromFull.slice(-10);
    profileName = String((value.contacts && value.contacts[0] && value.contacts[0].profile && value.contacts[0].profile.name) || "").slice(0, 60);
    cloud = { phoneNumberId: (value.metadata && value.metadata.phone_number_id) || "", to: fromFull };
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

  if (!digits || !text) return respond(FALLBACK_REPLY);

  // Layer 3: rate limits — per phone + global daily
  const cfg = guard.kvConfig();
  const perPhone = await guard.rateLimit(cfg, `rl:wa:h:${digits}`, 15, 3600);
  if (!perPhone.allowed) return respond("Please wait a bit — our team will get back to you. 🙏 · కాసేపు ఆగండి, మా team మీకు reply చేస్తుంది.");
  const globalCap = await guard.rateLimit(cfg, `rl:wa:g:${guard.today()}`, 400, 90000);
  if (!globalCap.allowed) return respond(FALLBACK_REPLY);

  if (process.env.WA_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY) {
    return respond(FALLBACK_REPLY);
  }

  const histKey = `wa:h:${digits}`;
  const hist = cfg ? await getHistory(cfg, histKey) : [];

  let out;
  try {
    out = await askClaude(hist, text, profileName);
  } catch (e) {
    return respond(FALLBACK_REPLY);
  }

  if (out.lead && out.lead.name) {
    try { await storeLead(cfg, out.lead, digits, text); } catch (e) {}
  }
  if (cfg) {
    hist.push({ u: text, a: out.reply });
    await saveHistory(cfg, histKey, hist);
  }
  return respond(out.reply);
};
