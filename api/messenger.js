// ─── DERMALUXE FACEBOOK MESSENGER AI AGENT ──────────────────────────────────
// /api/messenger — Messenger Platform webhook (object "page") for the
// Dermaluxe Facebook Page. Same Claude brain as WhatsApp/Instagram:
// Telugu/Tenglish/English replies, photo pre-assessments, voice notes,
// booking capture as leads (KV + Medicare Connector).
//
// Env: reuses the Instagram agent's credentials — IG_SYSTEM_TOKEN +
// IG_PAGE_ID (page token derived, cached in KV ig:ptok) and WA_WEBHOOK_TOKEN.
// Opt-out with FB_AGENT_ENABLED=0.
const guard = require("./_guard.js");
const clinic = require("./_clinic.js");
const facts = require("./_facts.js");
const notify = require("./_notify.js");

const LIST_KEY = "dl_leads";
const HIST_TTL = 86400;
const MAX_TURNS = 8;
const PROFILE_TTL = 15552000;
const MAPS_LINK = "https://maps.google.com/?q=16.7107,81.0952";

const FB_RULES = `- Booking flow: collect (1) name, (2) 10-digit mobile number, (3) concern/treatment, (4) preferred day & time — one or two questions at a time. Clinic visit or video consultation both possible.
- Messenger doesn't show us the patient's phone number — a booking is complete ONLY when you also have their 10-digit mobile number. Fill "lead" once you have name + phone + concern (keep collecting missing bits in the reply); otherwise "lead" must be null.
- Quick-reply taps arrive as plain text: "📅 Book Now" → start the booking flow; "💆 Services" → give a short services overview and ask what concern they have; "📸 Skin Check" → ask them to send a clear face (or scalp) photo right here in the chat.
- When the patient asks WHERE the clinic is / address / directions / how to reach, set "send_location": true in your output (a Google Maps link is sent automatically along with your reply).

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<your reply>","lead":null}
or when booking info is ready:
{"reply":"...","lead":{"name":"...","phone":"<10 digits>","concern":"...","date":"<if given>","slot":"<if given>","mode":"<Clinic Visit|Video|blank>"}}
Optionally add "send_location":true when the patient asks for the address/directions.`;

const CLINIC_FACTS = facts.clinicFacts("Facebook Messenger", FB_RULES);
const PHOTO_RULES = facts.photoRules("Messenger");
const FALLBACK_REPLY = facts.FALLBACK_REPLY;

// ── Page token (shared derivation + cache with the Instagram agent) ─────────
let memTok = null, memTokAt = 0;
async function pageToken(cfg) {
  if (process.env.IG_PAGE_TOKEN) return process.env.IG_PAGE_TOKEN;
  const sys = process.env.IG_SYSTEM_TOKEN, pageId = process.env.IG_PAGE_ID;
  if (!sys || !pageId) return null;
  if (memTok && Date.now() - memTokAt < 3600000) return memTok;
  try {
    if (cfg) {
      const c = await guard.kvCommand(cfg, ["GET", "ig:ptok"]);
      if (c && c.result) { memTok = c.result; memTokAt = Date.now(); return memTok; }
    }
  } catch (e) {}
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(sys)}`);
    if (!r.ok) { console.error("fb: page token derive failed", r.status, (await r.text().catch(() => "")).slice(0, 200)); return null; }
    const d = await r.json();
    if (!d.access_token) return null;
    memTok = d.access_token; memTokAt = Date.now();
    try { if (cfg) await guard.kvCommand(cfg, ["SET", "ig:ptok", memTok, "EX", "21600"]); } catch (e) {}
    return memTok;
  } catch (e) {
    console.error("fb: page token error", e && e.message);
    return null;
  }
}

// ── Send API ────────────────────────────────────────────────────────────────
async function sendMsg(psid, text, withMenu, tok) {
  if (!tok || !psid || !text) return false;
  const message = { text: String(text).slice(0, 1900) };
  if (withMenu) {
    message.quick_replies = [
      { content_type: "text", title: "📅 Book Now", payload: "book" },
      { content_type: "text", title: "💆 Services", payload: "services" },
      { content_type: "text", title: "📸 Skin Check", payload: "skincheck" },
    ];
  }
  try {
    const r = await fetch("https://graph.facebook.com/v21.0/me/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 300); } catch (e) {}
      console.error("fb: send failed", r.status, d);
      if (withMenu) return sendMsg(psid, text, false, tok);
      return false;
    }
    return true;
  } catch (e) {
    console.error("fb: send network error", e && e.message);
    return false;
  }
}

async function fetchFbName(psid, tok) {
  if (!tok) return "";
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(tok)}`);
    if (!r.ok) return "";
    const d = await r.json();
    return String([d.first_name, d.last_name].filter(Boolean).join(" ")).slice(0, 60);
  } catch (e) { return ""; }
}

async function fetchUrlMedia(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) { console.error("fb: media download failed", r.status); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4500000) return { tooBig: true };
    const mime = String(r.headers.get("content-type") || "").split(";")[0].trim();
    return { base64: buf.toString("base64"), mime };
  } catch (e) {
    console.error("fb: media fetch error", e && e.message);
    return null;
  }
}

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
            { text: "Transcribe this voice note exactly. It may be Telugu, Tenglish (Telugu in English letters), English, or mixed. If Telugu is spoken, transcribe in Telugu script. Output ONLY the transcription, nothing else." },
            { inline_data: { mime_type: mime || "audio/mp4", data: base64 } },
          ],
        }],
      }),
    });
    if (!r.ok) { console.error("fb: stt failed", r.status); return null; }
    const d = await r.json();
    const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
    return parts.map((p) => p.text || "").join(" ").trim() || null;
  } catch (e) {
    console.error("fb: stt error", e && e.message);
    return null;
  }
}

// ── Claude ──────────────────────────────────────────────────────────────────
function parseOut(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    if (parsed && typeof parsed.reply === "string") return parsed;
  } catch (e) {}
  return { reply: text || FALLBACK_REPLY, lead: null };
}

async function askClaude(hist, userMsg, profileName, extraCtx, imageBlock) {
  const messages = [];
  hist.forEach((t) => {
    messages.push({ role: "user", content: t.u });
    messages.push({ role: "assistant", content: t.a });
  });
  const prefix = (extraCtx || "") + (profileName ? `[patient name on Facebook: ${profileName}] ` : "");
  if (imageBlock) {
    messages.push({ role: "user", content: [imageBlock, { type: "text", text: prefix + (userMsg || "Photo pampanu — analysis cheyandi.") }] });
  } else {
    messages.push({ role: "user", content: prefix + userMsg });
  }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-sonnet-5",
      max_tokens: imageBlock ? 800 : 500,
      system: imageBlock ? CLINIC_FACTS + "\n\n" + PHOTO_RULES : CLINIC_FACTS,
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`claude HTTP ${resp.status}`);
  const data = await resp.json();
  const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
  return parseOut(text);
}

// ── Lead + memory ───────────────────────────────────────────────────────────
async function storeLead(cfg, leadInfo, psid, fbName, lastMsg) {
  const phone = String(leadInfo.phone || "").replace(/\D/g, "").slice(-10);
  const lead = {
    ts: Date.now(),
    type: "messenger",
    name: String(leadInfo.name || "").slice(0, 80).trim(),
    phone,
    age: "", gender: "",
    concern: String(leadInfo.concern || "").slice(0, 120),
    message: (fbName ? `[FB: ${fbName}] ` : "") + String(lastMsg || "").slice(0, 380),
    mode: String(leadInfo.mode || "").slice(0, 40),
    date: String(leadInfo.date || "").slice(0, 20),
    slot: String(leadInfo.slot || "").slice(0, 60),
    skin_score: null, hair_score: null, skin_age: null, skin_type: "",
    treatments: [],
    page: "messenger-agent",
  };
  if (!lead.name) return;
  lead.src_id = psid;
  try {
    if (cfg) await guard.kvCommand(cfg, ["SET", `fb:p:${psid}`,
      JSON.stringify({ name: lead.name, concern: lead.concern, ts: Date.now() }), "EX", String(PROFILE_TTL)]);
  } catch (e) {}
  // One lead per patient per 6h conversation window (replace, don't stack).
  if (cfg) {
    try {
      const recent = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", "49"]);
      for (const s of (recent.result || [])) {
        try {
          const l = JSON.parse(s);
          if (l.src_id === psid && l.type === "messenger" && lead.ts - l.ts < 21600000) {
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
  await notify.leadAlert(cfg, lead);
}

const LOCATION_ASK = /(address|location|direction|reach|route|map|ekkad|yekkad|dhari|dari|chirunama|అడ్రస|చిరునామా|ఎక్కడ|లొకేషన|దారి|మ్యాప)/i;

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const tok = process.env.WA_WEBHOOK_TOKEN;

  if (req.method === "GET") {
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && tok && guard.safeEqual(q["hub.verify_token"], tok)) {
      return res.status(200).send(String(q["hub.challenge"] || ""));
    }
    return res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (tok && !guard.safeEqual((req.query || {}).token, tok)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const b = req.body || {};
  if (b.object !== "page") return res.status(200).json({ ok: true });

  const entry = (b.entry && b.entry[0]) || {};
  const m = ((entry.messaging && entry.messaging[0]) || {});

  // Postbacks (e.g. Get Started) → treat the button title as text.
  let text = "";
  const msg = m.message || null;
  if (!msg && m.postback && m.postback.title) {
    text = String(m.postback.title).slice(0, 200);
  } else {
    if (!msg || msg.is_echo) return res.status(200).json({ ok: true });
    text = String(msg.text || "").slice(0, 1000).trim();
  }

  const psid = String((m.sender && m.sender.id) || "");
  if (!psid || psid === String(entry.id || "")) return res.status(200).json({ ok: true });

  const cfg = guard.kvConfig();

  const mid = (msg && msg.mid) || (m.postback && m.postback.mid) || "";
  if (cfg && mid) {
    try {
      const first = await guard.kvCommand(cfg, ["SET", `fb:seen:${mid}`, "1", "NX", "EX", "21600"]);
      if (!first.result) return res.status(200).json({ ok: true });
    } catch (e) {}
  }

  let imageUrl = "", audioUrl = "";
  const atts = msg && Array.isArray(msg.attachments) ? msg.attachments : [];
  for (const a of atts) {
    const url = a && a.payload && a.payload.url;
    if (!url) continue;
    if (a.type === "image" && !imageUrl) imageUrl = url;
    if (a.type === "audio" && !audioUrl) audioUrl = url;
  }
  if (!text && !imageUrl && !audioUrl) return res.status(200).json({ ok: true });

  const ptok = await pageToken(cfg);

  const perUser = await guard.rateLimit(cfg, `rl:fb:h:${psid}`, 15, 3600);
  if (!perUser.allowed) {
    await sendMsg(psid, "Please wait a bit — our team will get back to you. 🙏 · కాసేపు ఆగండి, మా team మీకు reply చేస్తుంది.", false, ptok);
    return res.status(200).json({ ok: true });
  }
  const globalCap = await guard.rateLimit(cfg, `rl:fb:g:${guard.today()}`, 400, 90000);
  if (!globalCap.allowed) {
    await sendMsg(psid, FALLBACK_REPLY, false, ptok);
    return res.status(200).json({ ok: true });
  }

  if (process.env.FB_AGENT_ENABLED === "0" || !process.env.ANTHROPIC_API_KEY || !ptok) {
    if (ptok) await sendMsg(psid, FALLBACK_REPLY, false, ptok);
    else console.error("fb: no page token (need IG_SYSTEM_TOKEN + IG_PAGE_ID)");
    return res.status(200).json({ ok: true });
  }

  const histKey = `fb:h:${psid}`;
  let hist = [];
  try {
    const r = cfg ? await guard.kvCommand(cfg, ["GET", histKey]) : null;
    hist = r && r.result ? JSON.parse(r.result) : [];
  } catch (e) { hist = []; }
  const firstTurn = hist.length === 0;

  let profile = null, fbName = "";
  if (firstTurn) {
    try {
      const p = cfg ? await guard.kvCommand(cfg, ["GET", `fb:p:${psid}`]) : null;
      profile = p && p.result ? JSON.parse(p.result) : null;
    } catch (e) {}
    fbName = await fetchFbName(psid, ptok);
  }
  const extraCtx = profile && profile.name
    ? `[returning patient — name: ${profile.name}${profile.concern ? ", last concern: " + profile.concern : ""}] `
    : "";

  let out;
  try {
    if (imageUrl) {
      const imgL = await guard.rateLimit(cfg, `rl:fb:img:${psid}`, 3, 86400);
      const gCap = await guard.rateLimit(cfg, `rl:an:g:${guard.today()}`, 300, 90000);
      if (!imgL.allowed || !gCap.allowed) {
        await sendMsg(psid, "Photo analysis limit ayipoindi 🙏 — www.dermaluxe.ai lo FREE full AI analysis try cheyandi, leda mee concern text cheyandi.", false, ptok);
        return res.status(200).json({ ok: true });
      }
      const media = await fetchUrlMedia(imageUrl);
      if (!media || media.tooBig) {
        await sendMsg(psid, "Photo download avvaledu 🙏 — malli pampandi, leda text type cheyandi.", false, ptok);
        return res.status(200).json({ ok: true });
      }
      const mime = ["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(media.mime) !== -1 ? media.mime : "image/jpeg";
      out = await askClaude(hist, text, fbName, extraCtx,
        { type: "image", source: { type: "base64", media_type: mime, data: media.base64 } });
      text = "[📷 photo]" + (text ? " " + text : "");
    } else {
      if (audioUrl) {
        const vcL = await guard.rateLimit(cfg, `rl:fb:vc:${psid}`, 10, 86400);
        if (!vcL.allowed) {
          await sendMsg(psid, "Ee roju voice limit ayipoindi 🙏 — text type chesi pampandi.", false, ptok);
          return res.status(200).json({ ok: true });
        }
        const media = await fetchUrlMedia(audioUrl);
        const heard = media && !media.tooBig ? await transcribeVoice(media.base64, media.mime) : null;
        if (!heard) {
          await sendMsg(psid, "Voice note vinipinchaledu 🙏 — dayachesi type chesi pampandi.", false, ptok);
          return res.status(200).json({ ok: true });
        }
        text = String(heard).slice(0, 1000).trim();
      }
      out = await askClaude(hist, text, fbName, extraCtx, null);
      if (audioUrl) text = "[🎤] " + text;
    }
  } catch (e) {
    console.error("fb: ai error", e && e.message);
    await sendMsg(psid, FALLBACK_REPLY, false, ptok);
    return res.status(200).json({ ok: true });
  }

  if (out.lead && out.lead.name) {
    try { await storeLead(cfg, out.lead, psid, fbName, text); } catch (e) {}
  }
  if (cfg) {
    hist.push({ u: text, a: out.reply });
    try {
      await guard.kvCommand(cfg, ["SET", histKey, JSON.stringify(hist.slice(-MAX_TURNS)), "EX", String(HIST_TTL)]);
    } catch (e) {}
  }

  await sendMsg(psid, out.reply, firstTurn && !imageUrl, ptok);
  if (out.send_location === true || LOCATION_ASK.test(text)) {
    await sendMsg(psid, "📍 DermaLuxe by Medicare, Eluru — Google Maps: " + MAPS_LINK, false, ptok);
  }
  return res.status(200).json({ ok: true });
};
