// ─── DERMALUXE INSTAGRAM DM AI AGENT ────────────────────────────────────────
// /api/instagram — Instagram Messaging webhook (Meta Graph API, via the
// Facebook Page linked to @dermaluxe.ai). Same Claude brain as the WhatsApp
// agent: Telugu/Tenglish/English replies, photo pre-assessments, voice notes
// (Gemini transcription), booking capture as leads (KV + Medicare Connector).
//
// Env vars:
//   IG_AGENT_ENABLED   – "1" to enable Claude replies
//   IG_SYSTEM_TOKEN    – permanent system-user token (page token auto-derived)
//   IG_PAGE_ID         – Facebook Page id linked to @dermaluxe.ai
//   IG_PAGE_TOKEN      – (alternative) a direct Page token; overrides the above
//   WA_WEBHOOK_TOKEN   – shared webhook secret (?token= and Meta Verify token)
//   ANTHROPIC_API_KEY, AI_MODEL, GEMINI_API_KEY – same as the WhatsApp agent
const guard = require("./_guard.js");
const clinic = require("./_clinic.js");
const leadstore = require("./_leadstore.js");
const qualify = require("./_qualify.js");
const lint = require("./_lint.js");
const facts = require("./_facts.js");
const notify = require("./_notify.js");
const voice = require("./_voice.js"); // shared STT/TTS stack

const transcribeVoice = (b64, mime) => voice.transcribe(b64, mime, "Instagram");

// Voice note out: IG can't take uploads, so park the MP3 and send it by URL.
async function sendDmAudio(igsid, url, cred) {
  const token = cred && cred.tok;
  const host = (cred && cred.host) || "graph.facebook.com";
  if (!token || !igsid || !url) return false;
  try {
    const r = await fetch(`https://${host}/v21.0/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recipient: { id: igsid }, messaging_type: "RESPONSE",
        message: { attachment: { type: "audio", payload: { url, is_reusable: false } } },
      }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 300); } catch (e) {}
      console.error("ig: audio send failed", r.status, d);
      return false;
    }
    return true;
  } catch (e) {
    console.error("ig: audio send error", e && e.message);
    return false;
  }
}

const LIST_KEY = "dl_leads";
const HIST_TTL = 86400;   // 24h conversation memory
const MAX_TURNS = 8;
const PROFILE_TTL = 15552000; // 180-day returning-patient memory
const MAPS_LINK = "https://maps.google.com/?q=16.7107,81.0952";

// Instagram-specific behaviour: DMs don't reveal the phone number, so the
// booking flow must collect it before a lead is complete.
const IG_RULES = `- Booking flow: collect (1) name, (2) 10-digit mobile number, (3) concern/treatment, (4) preferred day & time — one or two questions at a time. Clinic visit or video consultation both possible.
- Instagram doesn't show us the patient's phone number — a booking is complete ONLY when you also have their 10-digit mobile number. But the desk wants EVERY real enquiry on its list (owner, 7 Nov): fill "lead" as soon as a patient has told you a concern, even without name or phone — name may be "" and phone "" until they give them; keep collecting the missing bits in the reply. "lead" stays null for greetings with no concern, job seekers, influencers, promotions and spam.
- WHATSAPP FIRST: our bookings, doctor slots, reminders and free AI skin & hair analysis all run on WhatsApp. Whenever the patient shows interest (treatment, booking, price question, photo check), (a) ask for their 10-digit mobile number so "mana team WhatsApp lo slot confirm chestundi", and (b) also give the direct link: "WhatsApp: 99591 34666 → wa.me/919959134666". Once a number is captured they automatically get a WhatsApp message from us — tell them to reply there.
- Quick-reply taps arrive as plain text: "📅 Book Now" → start the booking flow; "💆 Services" → give a short services overview and ask what concern they have; "📸 Skin Check" → ask them to send a clear face (or scalp) photo right here in the DM.
- When the patient asks WHERE the clinic is / address / directions / how to reach, set "send_location": true in your output (a Google Maps link is sent automatically along with your reply).

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<your dm reply>","lead":null}
or when booking info is ready:
{"reply":"...","lead":{"name":"...","phone":"<10 digits>","concern":"...","date":"<if given>","slot":"<if given>","mode":"<Clinic Visit|Video|blank>","heat":"hot|warm|cold","lang":"<hi if the chat is in Hindi, else blank>","call_prep":"<2 short Tenglish lines: what they want + call tip>"}}
Optionally add "send_location":true when the patient asks for the address/directions.`;

const CLINIC_FACTS = facts.clinicFacts("Instagram", IG_RULES);
// The clinic's whole brief — fees, treatments, rules, academy — is about seven
// thousand tokens, and it was going to Anthropic in full on EVERY message: every
// patient reply, every hourly re-engage, every simulated exam patient. Paid at
// the input rate, every time.
//
// It is byte-identical on every call (built once at module load, no dates or
// randomness in it), which is exactly what prompt caching wants. Cached reads
// cost about a tenth of the input rate.
//
// Caching is a PREFIX match, so the order matters: the unchanging part carries
// the breakpoint and goes first, and anything that varies per call — the owner's
// own rules, the A/B line — goes after it, where it cannot invalidate the cache.
function sysBlocks(stable, volatile) {
  const out = [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }];
  const v = String(volatile || "").trim();
  if (v) out.push({ type: "text", text: v });
  return out;
}

const PHOTO_RULES = facts.photoRules("Instagram");
const FALLBACK_REPLY = facts.FALLBACK_REPLY;

// Comment → private-DM behaviour (comments webhook field).
const COMMENT_RULES = `AN INSTAGRAM USER COMMENTED on one of our posts (you are replying as DermaLuxe).
Decide and answer with ONLY minified JSON: {"dm": <string or null>, "public_reply": <string or null>}
- Comment asks about treatments/booking/prices/location or shows real interest → "dm": a short warm private message in the commenter's language style (Tenglish default): thank them, answer briefly (NEVER prices), invite them to book — mention "WhatsApp: 99591 34666 (wa.me/919959134666)" for fast booking & free AI skin analysis — or ask right here in the DM. 3-4 sentences max, 1 emoji. "public_reply": one tiny acknowledgement like "Details DM chesam 💬".
- Only praise/emojis/greetings → still answer both (owner, 7 Nov: every comment answered and turned into a lead): "dm": a warm thank-you in their language style plus one easy door — "skin leda hair gurinchi edaina doubt unte ikkade adagandi" or WhatsApp 99591 34666 — 2 sentences, 1 emoji, no pressure; "public_reply": one short thank-you line (max 1 emoji).
- Spam, abuse, self-promo, or irrelevant → both null.`;

// ── Page token resolution ────────────────────────────────────────────────────
// Preferred setup: IG_SYSTEM_TOKEN (permanent system-user token) + IG_PAGE_ID —
// the page access token is derived and cached in KV for 6h. A direct
// IG_PAGE_TOKEN env still wins when set.
let memTok = null, memTokAt = 0, memKey = "";
async function pageToken(cfg) {
  if (process.env.IG_PAGE_TOKEN) return process.env.IG_PAGE_TOKEN;
  const sys = process.env.IG_SYSTEM_TOKEN, pageId = process.env.IG_PAGE_ID;
  if (!sys || !pageId) return null;
  if (memTok && memKey === guard.ptokKey() && Date.now() - memTokAt < 3600000) return memTok;
  try {
    if (cfg) {
      const c = await guard.kvCommand(cfg, ["GET", guard.ptokKey()]);
      if (c && c.result) { memTok = c.result; memTokAt = Date.now(); memKey = guard.ptokKey(); return memTok; }
    }
  } catch (e) {}
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(sys)}`);
    if (!r.ok) { console.error("ig: page token derive failed", r.status, (await r.text()).slice(0, 200)); return null; }
    const d = await r.json();
    if (!d.access_token) return null;
    memTok = d.access_token; memTokAt = Date.now(); memKey = guard.ptokKey();
    try { if (cfg) await guard.kvCommand(cfg, ["SET", guard.ptokKey(), memTok, "EX", "21600"]); } catch (e) {}
    return memTok;
  } catch (e) {
    console.error("ig: page token error", e && e.message);
    return null;
  }
}

// Instagram-login flavor: a long-lived IG user token (60 days). We self-refresh
// weekly via KV so it never expires in practice; the refreshed token is kept in
// KV and preferred over the (stale) env value.
async function loginToken(cfg) {
  let tok = process.env.IG_LOGIN_TOKEN;
  if (!tok) return null;
  try {
    const r = cfg ? await guard.kvCommand(cfg, ["GET", "ig:ltok"]) : null;
    if (r && r.result) tok = r.result;
  } catch (e) {}
  try {
    const ts = cfg ? await guard.kvCommand(cfg, ["GET", "ig:ltok:ts"]) : null;
    const last = ts && ts.result ? Number(ts.result) : 0;
    if (Date.now() - last > 7 * 86400000) {
      const rr = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tok)}`);
      if (rr.ok) {
        const d = await rr.json();
        if (d.access_token) {
          tok = d.access_token;
          try { if (cfg) await guard.kvCommand(cfg, ["SET", "ig:ltok", tok]); } catch (e) {}
        }
      } else {
        console.error("ig: login token refresh failed", rr.status); // tokens <24h old can't refresh yet — fine
      }
      try { if (cfg) await guard.kvCommand(cfg, ["SET", "ig:ltok:ts", String(Date.now())]); } catch (e) {}
    }
  } catch (e) {}
  return tok;
}

// Pick the send credential: IG-login token (graph.instagram.com) wins,
// otherwise the FB-login page token (graph.facebook.com).
async function resolveSend(cfg) {
  const lt = await loginToken(cfg);
  if (lt) return { tok: lt, host: "graph.instagram.com" };
  const pt = await pageToken(cfg);
  if (pt) return { tok: pt, host: "graph.facebook.com" };
  return null;
}

// ── Graph send helpers ───────────────────────────────────────────────────────
async function sendDM(igsid, text, withMenu, cred) {
  const token = cred && cred.tok;
  const host = (cred && cred.host) || "graph.facebook.com";
  if (!token || !igsid || !text) return false;
  const message = { text: String(text).slice(0, 1000) };
  if (withMenu) {
    message.quick_replies = [
      { content_type: "text", title: "📅 Book Now", payload: "book" },
      { content_type: "text", title: "💆 Services", payload: "services" },
      { content_type: "text", title: "📸 Skin Check", payload: "skincheck" },
    ];
  }
  try {
    const r = await fetch(`https://${host}/v21.0/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { id: igsid }, messaging_type: "RESPONSE", message }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 300); } catch (e) {}
      console.error("ig: send failed", r.status, d);
      if (withMenu) return sendDM(igsid, text, false, cred); // retry without quick replies
      return false;
    }
    return true;
  } catch (e) {
    console.error("ig: send network error", e && e.message);
    return false;
  }
}

// Best-effort IG username (webhooks don't include it).
async function fetchIgName(igsid, cred) {
  if (!cred || !cred.tok) return "";
  try {
    const r = await fetch(`https://${cred.host}/v21.0/${igsid}?fields=name,username&access_token=${encodeURIComponent(cred.tok)}`);
    if (!r.ok) return "";
    const d = await r.json();
    return String(d.name || d.username || "").slice(0, 60);
  } catch (e) { return ""; }
}

// IG media attachments come as signed CDN URLs (no auth header needed).
async function fetchUrlMedia(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) { console.error("ig: media download failed", r.status); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4500000) return { tooBig: true };
    const mime = String(r.headers.get("content-type") || "").split(";")[0].trim();
    return { base64: buf.toString("base64"), mime };
  } catch (e) {
    console.error("ig: media fetch error", e && e.message);
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
  return { reply: facts.salvageReply(text) || FALLBACK_REPLY, lead: null };
}

async function askClaude(hist, userMsg, profileName, extraCtx, imageBlock) {
  const messages = [];
  hist.forEach((t) => {
    messages.push({ role: "user", content: t.u });
    messages.push({ role: "assistant", content: t.a });
  });
  const prefix = (extraCtx || "") + (profileName ? `[patient name on Instagram: ${profileName}] ` : "");
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
      model: process.env.AI_MODEL || "claude-opus-5",
      max_tokens: 2000,
      system: sysBlocks(imageBlock ? CLINIC_FACTS + "\n\n" + PHOTO_RULES : CLINIC_FACTS),
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`claude HTTP ${resp.status} ${await notify.aiFailed(resp)}`);
  const data = await resp.json();
  const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
  return parseOut(text);
}

// ── Lead + memory ───────────────────────────────────────────────────────────
async function storeLead(cfg, leadInfo, igsid, igName, lastMsg) {
  const phone = String(leadInfo.phone || "").replace(/\D/g, "").slice(-10);
  const lead = {
    ts: Date.now(),
    type: "instagram",
    name: String(leadInfo.name || "").slice(0, 80).trim(),
    phone,
    age: "", gender: "",
    concern: String(leadInfo.concern || "").slice(0, 120),
    message: (igName ? `[IG: ${igName}] ` : "") + String(lastMsg || "").slice(0, 380),
    mode: String(leadInfo.mode || "").slice(0, 40),
    date: String(leadInfo.date || "").slice(0, 20),
    slot: String(leadInfo.slot || "").slice(0, 60),
    skin_score: null, hair_score: null, skin_age: null, skin_type: "",
    treatments: [],
    page: "instagram-agent",
    heat: ["hot", "warm", "cold"].indexOf(String(leadInfo.heat || "").toLowerCase()) !== -1 ? String(leadInfo.heat).toLowerCase() : "",
    lang: leadInfo.lang === "hi" ? "hi" : "",
    call_prep: String(leadInfo.call_prep || "").slice(0, 220),
  };
  // Every real enquiry reaches the desk (owner, 7 Nov), with or without a
  // name or number: the Instagram name stands in, and the card says to answer
  // in the Instagram inbox until a number comes.
  if (!lead.concern && !lead.name) return;
  if (!lead.name) lead.name = igName ? `@${igName}` : "Instagram user";
  lead.src_id = igsid;
  if (phone) Object.assign(lead, qualify.stamp(await qualify.read(cfg, phone)));
  try {
    if (cfg) await guard.kvCommand(cfg, ["SET", `ig:p:${igsid}`,
      JSON.stringify({ name: lead.name, concern: lead.concern, ts: Date.now() }), "EX", String(PROFILE_TTL)]);
  } catch (e) {}
  const sync = await clinic.forwardLead(cfg, lead);
  if (sync.attempted) lead.synced = sync.synced;
  // One lead per conversation: replaces the earlier row, keeping the desk's
  // status and notes.
  await leadstore.saveLead(cfg, lead, (l) => l.src_id === igsid && l.type === "instagram" && lead.ts - l.ts < 21600000, 50);
  await notify.leadAlert(cfg, lead);
  // hand the patient to the WhatsApp agent (approved template, once per week)
  try { await notify.waHandoff(cfg, lead, "Instagram"); } catch (e) { console.error("handoff", e && e.message); }
}

// What the model is told when a DM has an attachment but no words.
function wordlessDm(type) {
  const t = String(type || "");
  if (t === "story_mention") return "[They mentioned DermaLuxe in their Instagram story — no text. Thank them warmly for sharing.]";
  if (/share|reel|post/.test(t)) return "[They shared an Instagram post/reel with us — no text. Likely about our post; thank them and ask how we can help.]";
  if (t === "video") return "[They sent a video — no text. We cannot watch videos here; ask them to type their question or send a clear photo.]";
  return "[They sent a sticker or reaction — no text. Reply with one short warm line.]";
}

const LOCATION_ASK = /(address|location|direction|reach|route|map|ekkad|yekkad|dhari|dari|chirunama|అడ్రస|చిరునామా|ఎక్కడ|లొకేషన|దారి|మ్యాప)/i;

// ── Comment → private DM + public acknowledgement ──────────────────────────
// The public fallback, when the model is unavailable or a private reply is refused.
const COMMENT_WA = "Thank you 🙏 Details kosam WhatsApp cheyandi: 99591 34666";
const COMMENT_ASKS = /(\?|price|cost|rate|charge|fee|entha|enta|book|appoint|slot|timing|treatment|doctor|consult|address|location|ekkad|yekkad|number|contact|whatsapp|details|info|ధర|ఎంత|ఎక్కడ|అడ్రస|టైమ్)/i;
// A comment with nothing to follow up — "🔥🔥🔥", "All the best", "@friend
// thanks" — is answered like any other, but it is not a lead: on 9 Nov twelve
// of them sat in the desk's list with no number and nothing to do. A question,
// a treatment or a problem named, or a few sentences of their own, still is.
const COMMENT_CONCERN = /(acne|pimpl|hair\s*fall|hair\s*loss|hairfall|dandruff|pigment|dark\s*circle|dark\s*spot|scar|mole|wart|\btan\b|melasma|psoriasis|eczema|white\s*hair|grey\s*hair|gray\s*hair|bald|transplant|\bprp\b|\bgfc\b|laser|botox|filler|peel|facial|wrinkle|stretch\s*mark|allerg|itch|rash|fungal|mottim|macha|juttu|raalip|chundru|mudata|nallabad|చర్మ|మొటిమ|మచ్చ|జుట్టు|చుండ్రు|ముడత)/i;
const COURTESY_WORD = /^(thanks?|thankyou|thank|you|u|tq|ty|tysm|all|the|best|wishes|congrats|congratulations|nice|super|superb|wow|great|good|awesome|amazing|beautiful|lovely|cute|cool|wonderful|excellent|fantastic|keep|it|up|well|done|luck|god|bless|proud|of|sir|madam|mam|garu|andi|bro|anna|akka|ji|dear|team|dermaluxe|ok|okay|hi|hello|hey|love|loved|so|very|one|semma|mass|vera|level|adiripoyindi|baagundi|bagundi|chala|ga|undi|happy|for|and|to|a|is|are|this|that|work|job|clinic|dr|pls|please|plz|see|watch|look|check|new|opening|grand|success|successful|wishing|many|more|congratulation)$/i;
function isEnquiry(text) {
  const t = String(text || "");
  if (COMMENT_ASKS.test(t) || COMMENT_CONCERN.test(t)) return true;
  const words = t.replace(/@[\w.]+/g, " ").replace(/#\w+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !COURTESY_WORD.test(w));
  return words.length >= 4;
}
// Faults a public comment reply may never carry; the rest of the DM lint (one
// question, a next step) is about conversations, not one-line acknowledgements.
const COMMENT_HARD = new Set(["price_quoted", "medicine", "diagnosis_guess", "reassurance", "internal_note"]);
const unsafeComment = (s, said) => lint.lintReply({ reply: s }, said, [], {}).some((f) => COMMENT_HARD.has(f.code));
async function sendPrivateReply(commentId, text, cred) {
  if (!cred || !cred.tok || !commentId || !text) return false;
  try {
    const r = await fetch(`https://${cred.host}/v21.0/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cred.tok}` },
      body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: String(text).slice(0, 1000) } }),
    });
    if (!r.ok) console.error("ig: private reply failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
    return r.ok;
  } catch (e) { console.error("ig: private reply error", e && e.message); return false; }
}

async function sendCommentReply(commentId, text, cred) {
  if (!cred || !cred.tok || !commentId || !text) return false;
  try {
    const r = await fetch(`https://${cred.host}/v21.0/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cred.tok}` },
      body: JSON.stringify({ message: String(text).slice(0, 300) }),
    });
    if (!r.ok) console.error("ig: comment reply failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
    return r.ok;
  } catch (e) { console.error("ig: comment reply error", e && e.message); return false; }
}

async function askClaudeComment(username, commentText) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-opus-5",
      max_tokens: 600,
      system: sysBlocks(CLINIC_FACTS + "\n\n" + COMMENT_RULES),
      messages: [{ role: "user", content: `[Instagram comment by @${username} on our post] ${commentText}` }],
    }),
  });
  if (!resp.ok) throw new Error(`claude HTTP ${resp.status} ${await notify.aiFailed(resp)}`);
  const data = await resp.json();
  const text = ((data.content || []).find((x) => x.type === "text") || {}).text || "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const p = JSON.parse(m ? m[0] : text);
    return {
      dm: typeof p.dm === "string" && p.dm.trim() ? p.dm : null,
      public_reply: typeof p.public_reply === "string" && p.public_reply.trim() ? p.public_reply : null,
    };
  } catch (e) { return { dm: null, public_reply: null }; }
}

// A comment that asks about a treatment, a price, a booking or the place is an
// enquiry, and the desk sees it with the rest (owner, 7 Nov: "comments lo aina
// insta messages lo aina vachhina leads anni ikkadiki vacheyali"). One row per
// commenter per six hours; the comment itself is the message.
async function storeCommentLead(cfg, username, fromId, text, permalink, kind) {
  if (!cfg) return;
  const fb = kind === "fb";
  const lead = {
    ts: Date.now(), type: fb ? "fb_comment" : "ig_comment",
    name: username ? (fb ? username : `@${username}`) : (fb ? "Facebook comment" : "Instagram comment"), phone: "",
    age: "", gender: "", concern: String(text).slice(0, 120),
    message: `[${fb ? "Facebook" : "Instagram"} comment] ${String(text).slice(0, 380)}`,
    mode: "", date: "", slot: "", skin_score: null, hair_score: null, skin_age: null, skin_type: "", treatments: [],
    page: permalink || (fb ? "facebook-comment" : "instagram-comment"),
    // A question is warm; a thank-you or an emoji is a cold lead the desk can still greet.
    heat: COMMENT_ASKS.test(text) || COMMENT_CONCERN.test(text) ? "warm" : "cold",
    call_prep: `${fb ? "Facebook" : "Instagram"} comment — ${fb ? "Messenger" : "Instagram"} lo reply cheyyandi; number ivvamani adagandi.`,
    src_id: `${fb ? "fc" : "c"}:${fromId}`,
  };
  try {
    await leadstore.saveLead(cfg, lead, (l) => l.src_id === lead.src_id && l.type === lead.type && lead.ts - l.ts < 21600000, 50);
    if (lead.heat === "warm") await notify.leadAlert(cfg, lead);
  } catch (e) { console.error("ig: comment lead", e && e.message); }
}

async function handleComment(entry, v) {
  const commentId = String(v.id || "");
  const fromId = String((v.from && v.from.id) || "");
  const username = String((v.from && v.from.username) || "");
  const text = String(v.text || "").slice(0, 500).trim();
  const ourId = String(entry.id || "");
  if (!commentId || !text || !fromId || fromId === ourId) return; // empty or our own comment/reply
  if (process.env.IG_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY) return;

  const cfg = guard.kvConfig();
  // one shot per comment, ever (covers webhook redeliveries too)
  if (cfg) {
    try {
      const first = await guard.kvCommand(cfg, ["SET", `ig:c:${commentId}`, "1", "NX", "EX", "604800"]);
      if (!first.result) return;
    } catch (e) {}
  }
  // limits: 3 comment-DMs per commenter/day, 100 globally/day
  const perU = await guard.rateLimit(cfg, `rl:ig:cdm:${fromId}`, 3, 86400);
  if (!perU.allowed) return;
  const g = await guard.rateLimit(cfg, `rl:ig:cg:${guard.today()}`, 300, 90000);
  if (!g.allowed) return;

  const cred = await resolveSend(cfg);
  if (!cred || !cred.tok) { console.error("ig: comment handler has no send token"); return; }

  let out;
  try { out = await askClaudeComment(username, text); }
  catch (e) {
    // The model busy or down: someone asking a question still hears where to
    // ask it. Praise and spam get nothing, as they would anyway.
    console.error("ig: comment ai error", e && e.message);
    if (isEnquiry(text)) await storeCommentLead(cfg, username, fromId, text, v.media && v.media.id);
    if (COMMENT_ASKS.test(text)) await sendCommentReply(commentId, COMMENT_WA, cred);
    return;
  }
  // Everything that is not spam is answered (owner, 7 Nov); what has something
  // to follow up is a lead too (9 Nov — praise and emojis are not).
  if ((out.dm || out.public_reply || COMMENT_ASKS.test(text)) && isEnquiry(text)) await storeCommentLead(cfg, username, fromId, text, v.media && v.media.id);

  // The same last check the DM agent's replies get. Comment replies skipped it
  // until 5 November 2026, and a public reply is read by everyone, not one person.
  if (out.dm) {
    try { out.dm = (await lint.check(cfg, { reply: out.dm, lead: null }, text, [], { channel: "ig-comment" })).reply || out.dm; } catch (e) {}
    if (unsafeComment(out.dm, text)) out.dm = null;
  }
  if (out.public_reply && unsafeComment(out.public_reply, text)) out.public_reply = COMMENT_WA;

  if (out.dm) {
    const ok = await sendPrivateReply(commentId, out.dm, cred);
    // Instagram refuses a private reply now and then (the commenter's settings,
    // or a comment older than seven days). "Details DM chesam" would then be
    // untrue and the person heard nothing, so the number goes in public instead.
    if (ok && out.public_reply) await sendCommentReply(commentId, out.public_reply, cred);
    else if (!ok) await sendCommentReply(commentId, COMMENT_WA, cred);
  } else if (out.public_reply) {
    await sendCommentReply(commentId, out.public_reply, cred);
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
// ── Comments the webhook never brought ─────────────────────────────────────
// The owner asked on 7 Nov for every comment on our posts to be answered and
// made a lead. The webhook only ever sent new ones, and nothing looked back:
// comments from before it was set up, or ones it dropped, sat unanswered.
// Each hour this reads the comments on the last two months of posts and
// answers those we have not, through the same handler the webhook uses — so
// the same once-per-comment rule, limits and editor apply. A comment older
// than seven days can no longer get a private message; it gets the public
// reply with the WhatsApp number instead.
const SWEEP_DAYS = 60;
async function sweepIgComments(cfg, max) {
  const tok = await loginToken(cfg);
  if (!tok || process.env.IG_AGENT_ENABLED !== "1") return { ok: false, why: "IG off" };
  const G = "https://graph.instagram.com/v21.0";
  const get = async (path, params) => {
    const u = new URL(G + path);
    for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
    u.searchParams.set("access_token", tok);
    const r = await fetch(u.toString());
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(((d.error || {}).message || `HTTP ${r.status}`).slice(0, 160));
    return d;
  };
  const me = await get("/me", { fields: "user_id,username" });
  const ourId = String(me.user_id || me.id || ""), ourName = String(me.username || "").toLowerCase();
  const media = await get("/me/media", { fields: "id,timestamp,permalink", limit: "30" });
  let seen = 0, handled = 0;
  for (const m of (media.data || [])) {
    if ((Date.parse(m.timestamp) || 0) < Date.now() - SWEEP_DAYS * 86400000) continue;
    const cs = await get(`/${m.id}/comments`, { fields: "id,text,username,from,timestamp,replies{username,from}", limit: "50" }).catch(() => ({ data: [] }));
    for (const c of (cs.data || [])) {
      seen++;
      const fromId = String((c.from || {}).id || ""), uname = String(c.username || (c.from || {}).username || "");
      if (!c.text || uname.toLowerCase() === ourName || (ourId && fromId === ourId)) continue;
      const ours = (r) => (ourId && String((r.from || {}).id || "") === ourId) || String(r.username || (r.from || {}).username || "").toLowerCase() === ourName;
      if (((c.replies || {}).data || []).some(ours)) continue;          // already answered
      const done = await guard.kvCommand(cfg, ["GET", `ig:c:${c.id}`]).catch(() => ({}));
      if (done && done.result) continue;
      await handleComment({ id: ourId || "ourpage" }, { id: c.id, text: c.text, from: { id: fromId || `u:${uname}`, username: uname }, media: { id: m.id } });
      if (++handled >= (max || 20)) return { ok: true, seen, handled, more: true };
    }
  }
  return { ok: true, seen, handled };
}

// The Facebook page's own comments: nothing listened to them at all.
async function sweepFbComments(cfg, max) {
  const pt = await pageToken(cfg), pageId = process.env.IG_PAGE_ID;
  if (!pt || !pageId || process.env.IG_AGENT_ENABLED !== "1") return { ok: false, why: "FB page token ledu" };
  const F = "https://graph.facebook.com/v21.0";
  const call = async (path, params, body) => {
    const u = new URL(F + path);
    for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
    if (!body) u.searchParams.set("access_token", pt);
    const r = await fetch(u.toString(), body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${pt}` }, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(((d.error || {}).message || `HTTP ${r.status}`).slice(0, 160));
    return d;
  };
  const posts = await call(`/${pageId}/posts`, { fields: "id,created_time,permalink_url,comments.limit(50){id,message,from,created_time,comments.limit(10){from}}", limit: "20" });
  let seen = 0, handled = 0;
  for (const p of (posts.data || [])) {
    if ((Date.parse(p.created_time) || 0) < Date.now() - SWEEP_DAYS * 86400000) continue;
    for (const c of (((p.comments || {}).data) || [])) {
      seen++;
      const from = c.from || {};
      if (!c.message || String(from.id || "") === pageId) continue;
      if ((((c.comments || {}).data) || []).some((r) => String((r.from || {}).id || "") === pageId)) continue;
      const first = await guard.kvCommand(cfg, ["SET", `fb:c:${c.id}`, "1", "NX", "EX", String(90 * 86400)]).catch(() => ({}));
      if (!first || !first.result) continue;
      let out;
      try { out = await askClaudeComment(from.name || "someone", c.message); } catch (e) { out = { dm: null, public_reply: COMMENT_ASKS.test(c.message) ? COMMENT_WA : null }; }
      if (out.dm) { try { out.dm = (await lint.check(cfg, { reply: out.dm, lead: null }, c.message, [], { channel: "fb-comment" })).reply || out.dm; } catch (e) {} if (unsafeComment(out.dm, c.message)) out.dm = null; }
      if (out.public_reply && unsafeComment(out.public_reply, c.message)) out.public_reply = COMMENT_WA;
      let dmOk = false;
      const fresh = (Date.parse(c.created_time) || 0) > Date.now() - 7 * 86400000;
      if (out.dm && fresh) { try { await call(`/${pageId}/messages`, {}, { recipient: { comment_id: c.id }, message: { text: String(out.dm).slice(0, 1000) } }); dmOk = true; } catch (e) { console.error("fb: private reply", e.message); } }
      const pub = dmOk ? out.public_reply : (out.dm || out.public_reply ? (COMMENT_ASKS.test(c.message) ? COMMENT_WA : out.public_reply) : null);
      if (pub) { try { await call(`/${c.id}/comments`, {}, { message: String(pub).slice(0, 300) }); } catch (e) { console.error("fb: comment reply", e.message); } }
      if ((out.dm || out.public_reply || COMMENT_ASKS.test(c.message)) && isEnquiry(c.message)) await storeCommentLead(cfg, from.name || "", from.id || c.id, c.message, p.permalink_url, "fb");
      if (++handled >= (max || 20)) return { ok: true, seen, handled, more: true };
    }
  }
  return { ok: true, seen, handled };
}

module.exports = async (req, res) => {
  const tok = process.env.WA_WEBHOOK_TOKEN;

  if (req.method === "GET") {
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && tok && guard.safeEqual(q["hub.verify_token"], tok)) {
      return res.status(200).send(String(q["hub.challenge"] || ""));
    }
    // One-time setup helper: subscribes the Facebook Page to this app so IG
    // messaging webhooks flow (the WhatsApp subscribed_apps lesson).
    // GET /api/instagram?setup=1&key=<ADMIN_KEY>
    if (q.setup === "1") {
      if (!process.env.ADMIN_KEY || !guard.safeEqual(q.key, process.env.ADMIN_KEY)) {
        return res.status(401).json({ error: "Invalid key" });
      }
      const pageId = process.env.IG_PAGE_ID;
      const pt = await pageToken(guard.kvConfig());
      if (!pageId || !pt) return res.status(501).json({ error: "IG_PAGE_ID / token not configured", pageId: !!pageId, token: !!pt });
      try {
        const sub = await fetch(`https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${pt}` },
          body: JSON.stringify({ subscribed_fields: ["messages"] }),
        });
        const subBody = await sub.json().catch(() => ({}));
        const check = await fetch(`https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?access_token=${encodeURIComponent(pt)}`);
        const checkBody = await check.json().catch(() => ({}));
        return res.status(200).json({ ok: sub.ok, subscribe: subBody, current: checkBody });
      } catch (e) {
        return res.status(500).json({ error: "setup failed", detail: String(e && e.message) });
      }
    }
    return res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  // No token configured means refuse, not stand open.
  if (!tok || !guard.safeEqual((req.query || {}).token, tok)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const b = req.body || {};
  if (b.object !== "instagram") return res.status(200).json({ ok: true });

  // Meta batches: one POST can carry several entries, and each entry several
  // comments or messages. Only the first of each was read until 5 November
  // 2026, so on a busy evening every comment after the first in a batch went
  // unanswered. Comments run side by side (each waits several seconds on the
  // model, and the function has sixty); one person's messages stay in order.
  const jobs = [], bySender = new Map();
  for (const entry of Array.isArray(b.entry) ? b.entry : []) {
    // Comment webhooks arrive via entry.changes (field "comments"), not messaging.
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change && change.field === "comments") jobs.push(() => handleComment(entry, change.value || {}));
    }
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const who = String((m && m.sender && m.sender.id) || "");
      if (!bySender.has(who)) bySender.set(who, []);
      bySender.get(who).push(m || {});
    }
  }
  for (const list of bySender.values()) jobs.push(async () => { for (const m of list) await handleMessage(req, m); });
  await Promise.all(jobs.map((job) => job().catch((e) => console.error("ig: event error", e && e.message))));
  return res.status(200).json({ ok: true });
};

// One Instagram DM: Claude reply, lead capture, voice and location follow-ups.
async function handleMessage(req, m) {
  const msg = m.message || null;
  // ignore reads/deliveries/reactions/postbacks-without-message and our own echoes
  if (!msg || msg.is_echo) return;

  const igsid = String((m.sender && m.sender.id) || "");
  if (!igsid) return;

  const cfg = guard.kvConfig();
  const ptok = await resolveSend(cfg);

  // De-dup Meta redeliveries by message id
  if (cfg && msg.mid) {
    try {
      const first = await guard.kvCommand(cfg, ["SET", `ig:seen:${msg.mid}`, "1", "NX", "EX", "21600"]);
      if (!first.result) return;
    } catch (e) {}
  }

  let text = String(msg.text || "").slice(0, 1000).trim();
  let imageUrl = "", audioUrl = "";
  const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
  for (const a of atts) {
    const url = a && a.payload && a.payload.url;
    if (!url) continue;
    if (a.type === "image" && !imageUrl) imageUrl = url;
    if (a.type === "audio" && !audioUrl) audioUrl = url;
  }
  // A shared reel or post, a story mention, a video or a heart, with no words.
  // These were dropped without a reply; on 5 November two of them arrived the
  // morning after the opening video went up. The model is told what came in
  // and answers it like any other turn. A deleted message carries no
  // attachment, so it still gets nothing.
  if (!text && !imageUrl && !audioUrl && !msg.is_deleted && atts.length) text = wordlessDm(atts[0].type);
  if (!text && !imageUrl && !audioUrl) return;

  // Rate limits: per sender + global daily
  const perUser = await guard.rateLimit(cfg, `rl:ig:h:${igsid}`, 15, 3600);
  if (!perUser.allowed) {
    await sendDM(igsid, "Please wait a bit — our team will get back to you. 🙏 · కాసేపు ఆగండి, మా team మీకు reply చేస్తుంది.", false, ptok);
    return;
  }
  const globalCap = await guard.rateLimit(cfg, `rl:ig:g:${guard.today()}`, 400, 90000);
  if (!globalCap.allowed) {
    await sendDM(igsid, FALLBACK_REPLY, false, ptok);
    return;
  }

  if (process.env.IG_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY || !ptok) {
    if (ptok) await sendDM(igsid, FALLBACK_REPLY, false, ptok);
    else console.error("ig: no send token (set IG_LOGIN_TOKEN, or IG_SYSTEM_TOKEN + IG_PAGE_ID)");
    return;
  }

  const histKey = `ig:h:${igsid}`;
  let hist = [];
  try {
    const r = cfg ? await guard.kvCommand(cfg, ["GET", histKey]) : null;
    hist = r && r.result ? JSON.parse(r.result) : [];
  } catch (e) { hist = []; }
  const firstTurn = hist.length === 0;

  // Returning-patient profile + IG display name (first turn only, best effort)
  let profile = null, igName = "";
  if (firstTurn) {
    try {
      const p = cfg ? await guard.kvCommand(cfg, ["GET", `ig:p:${igsid}`]) : null;
      profile = p && p.result ? JSON.parse(p.result) : null;
    } catch (e) {}
    igName = await fetchIgName(igsid, ptok);
  }
  let extraCtx = facts.nowIstCtx() + (profile && profile.name
    ? `[returning patient — name: ${profile.name}${profile.concern ? ", last concern: " + profile.concern : ""}] `
    : "");
  // The same goals the WhatsApp agent works to — book the consultation, the
  // academy seat, the transplant assessment — read from what they have said.
  try {
    const G = require("./_goal.js");
    const said = hist.map((t) => t.u).concat([text, profile && profile.concern]);
    extraCtx += G.contextLine(G.fromChat(said, { name: profile && profile.name }));
  } catch (e) {}

  let out;
  try {
    if (imageUrl) {
      const imgL = await guard.rateLimit(cfg, `rl:ig:img:${igsid}`, 3, 86400);
      const gCap = await guard.rateLimit(cfg, `rl:an:g:${guard.today()}`, 300, 90000);
      if (!imgL.allowed || !gCap.allowed) {
        await sendDM(igsid, "Photo analysis limit ayipoindi 🙏 — www.dermaluxe.ai lo FREE full AI analysis try cheyandi, leda mee concern text cheyandi.", false, ptok);
        return;
      }
      const media = await fetchUrlMedia(imageUrl);
      if (!media || media.tooBig) {
        await sendDM(igsid, "Photo download avvaledu 🙏 — malli pampandi, leda text type cheyandi.", false, ptok);
        return;
      }
      const mime = ["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(media.mime) !== -1 ? media.mime : "image/jpeg";
      out = await askClaude(hist, text, igName, extraCtx,
        { type: "image", source: { type: "base64", media_type: mime, data: media.base64 } });
      text = "[📷 photo]" + (text ? " " + text : "");
    } else {
      if (audioUrl) {
        const vcL = await guard.rateLimit(cfg, `rl:ig:vc:${igsid}`, 10, 86400);
        if (!vcL.allowed) {
          await sendDM(igsid, "Ee roju voice limit ayipoindi 🙏 — text type chesi pampandi.", false, ptok);
          return;
        }
        const media = await fetchUrlMedia(audioUrl);
        const heard = media && !media.tooBig ? await transcribeVoice(media.base64, media.mime) : null;
        if (!heard) {
          await sendDM(igsid, "Voice note vinipinchaledu 🙏 — dayachesi type chesi pampandi.", false, ptok);
          return;
        }
        text = String(heard).slice(0, 1000).trim();
      }
      out = await askClaude(hist, text, igName, extraCtx + (audioUrl ? voice.VOICE_CTX : ""), null);
      if (audioUrl) {
        const vs = voice.parseVoiceScript(out.reply);
        out.reply = vs.reply || out.reply;
        voiceScript = vs.script;
        text = "[🎤] " + text;
      }
    }
  } catch (e) {
    console.error("ig: ai error", e && e.message);
    await sendDM(igsid, FALLBACK_REPLY, false, ptok);
    return;
  }

  try { out = await lint.check(cfg, out, text, hist.slice(-3).map((t) => t.a), { profileName: igName, channel: "ig", analysis: !!imageUrl }); } catch (e) {}
  if (out.lead && out.lead.phone && cfg) {
    try { const q = await qualify.absorb(cfg, out.lead.phone, out.qual || {}, { inboundCount: hist.length + 1, photo_sent: !!imageUrl, channel: "instagram" }); await qualify.react(cfg, out.lead.phone, q, { name: out.lead.name }); } catch (e) {}
  }
  if (out.lead && (out.lead.name || out.lead.concern)) {
    try { await storeLead(cfg, out.lead, igsid, igName, text); } catch (e) {}
  }
  out.reply = facts.withAiLine(out.reply, firstTurn);
  if (cfg) {
    hist.push({ u: text, a: out.reply });
    try {
      await guard.kvCommand(cfg, ["SET", histKey, JSON.stringify(hist.slice(-MAX_TURNS)), "EX", String(HIST_TTL)]);
    } catch (e) {}
  }

  // Voice note in → voice note out (text still follows as the readable copy).
  if (audioUrl) {
    try {
      const mp3 = await voice.synthesize(voiceScript || voice.stripForTts(out.reply).slice(0, 350), cfg);
      const aid = mp3 ? await voice.parkAudio(cfg, mp3) : "";
      if (aid) await sendDmAudio(igsid, `${voice.publicBase(req)}/api/media?aud=${aid}`, ptok);
    } catch (e) { console.error("ig: voice reply error", e && e.message); }
  }
  await sendDM(igsid, out.reply, firstTurn && !imageUrl, ptok);
  if (out.send_location === true || LOCATION_ASK.test(text)) {
    await sendDM(igsid, "📍 DermaLuxe by Medicare, Eluru — Google Maps: " + MAPS_LINK, false, ptok);
  }
}

module.exports.sweepIgComments = sweepIgComments;
module.exports.isEnquiry = isEnquiry;
module.exports.sweepFbComments = sweepFbComments;
