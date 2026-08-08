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
const facts = require("./_facts.js");
const notify = require("./_notify.js");

const LIST_KEY = "dl_leads";
const HIST_TTL = 86400;   // 24h conversation memory
const MAX_TURNS = 8;
const PROFILE_TTL = 15552000; // 180-day returning-patient memory
const MAPS_LINK = "https://maps.google.com/?q=16.7107,81.0952";

// Instagram-specific behaviour: DMs don't reveal the phone number, so the
// booking flow must collect it before a lead is complete.
const IG_RULES = `- Booking flow: collect (1) name, (2) 10-digit mobile number, (3) concern/treatment, (4) preferred day & time — one or two questions at a time. Clinic visit or video consultation both possible.
- Instagram doesn't show us the patient's phone number — a booking is complete ONLY when you also have their 10-digit mobile number. Fill "lead" once you have name + phone + concern (keep collecting missing bits in the reply); otherwise "lead" must be null.
- Quick-reply taps arrive as plain text: "📅 Book Now" → start the booking flow; "💆 Services" → give a short services overview and ask what concern they have; "📸 Skin Check" → ask them to send a clear face (or scalp) photo right here in the DM.
- When the patient asks WHERE the clinic is / address / directions / how to reach, set "send_location": true in your output (a Google Maps link is sent automatically along with your reply).

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<your dm reply>","lead":null}
or when booking info is ready:
{"reply":"...","lead":{"name":"...","phone":"<10 digits>","concern":"...","date":"<if given>","slot":"<if given>","mode":"<Clinic Visit|Video|blank>","heat":"hot|warm|cold","call_prep":"<2 short Tenglish lines: what they want + call tip>"}}
Optionally add "send_location":true when the patient asks for the address/directions.`;

const CLINIC_FACTS = facts.clinicFacts("Instagram", IG_RULES);
const PHOTO_RULES = facts.photoRules("Instagram");
const FALLBACK_REPLY = facts.FALLBACK_REPLY;

// Comment → private-DM behaviour (comments webhook field).
const COMMENT_RULES = `AN INSTAGRAM USER COMMENTED on one of our posts (you are replying as DermaLuxe).
Decide and answer with ONLY minified JSON: {"dm": <string or null>, "public_reply": <string or null>}
- Comment asks about treatments/booking/prices/location or shows real interest → "dm": a short warm private message in the commenter's language style (Tenglish default): thank them, answer briefly (NEVER prices), invite them to book or ask right here in the DM. 3-4 sentences max, 1 emoji. "public_reply": one tiny acknowledgement like "Details DM chesam 💬".
- Only praise/emojis/greetings → "dm": null, "public_reply": one short thank-you line (max 1 emoji).
- Spam, abuse, self-promo, or irrelevant → both null.`;

// ── Page token resolution ────────────────────────────────────────────────────
// Preferred setup: IG_SYSTEM_TOKEN (permanent system-user token) + IG_PAGE_ID —
// the page access token is derived and cached in KV for 6h. A direct
// IG_PAGE_TOKEN env still wins when set.
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
    if (!r.ok) { console.error("ig: page token derive failed", r.status, (await r.text()).slice(0, 200)); return null; }
    const d = await r.json();
    if (!d.access_token) return null;
    memTok = d.access_token; memTokAt = Date.now();
    try { if (cfg) await guard.kvCommand(cfg, ["SET", "ig:ptok", memTok, "EX", "21600"]); } catch (e) {}
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
    if (!r.ok) { console.error("ig: stt failed", r.status); return null; }
    const d = await r.json();
    const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
    return parts.map((p) => p.text || "").join(" ").trim() || null;
  } catch (e) {
    console.error("ig: stt error", e && e.message);
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
    call_prep: String(leadInfo.call_prep || "").slice(0, 220),
  };
  if (!lead.name) return;
  lead.src_id = igsid;
  try {
    if (cfg) await guard.kvCommand(cfg, ["SET", `ig:p:${igsid}`,
      JSON.stringify({ name: lead.name, concern: lead.concern, ts: Date.now() }), "EX", String(PROFILE_TTL)]);
  } catch (e) {}
  // One lead per patient per 6h conversation window (replace, don't stack).
  if (cfg) {
    try {
      const recent = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", "49"]);
      for (const s of (recent.result || [])) {
        try {
          const l = JSON.parse(s);
          if (l.src_id === igsid && l.type === "instagram" && lead.ts - l.ts < 21600000) {
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

// ── Comment → private DM + public acknowledgement ──────────────────────────
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
      model: process.env.AI_MODEL || "claude-sonnet-5",
      max_tokens: 400,
      system: CLINIC_FACTS + "\n\n" + COMMENT_RULES,
      messages: [{ role: "user", content: `[Instagram comment by @${username} on our post] ${commentText}` }],
    }),
  });
  if (!resp.ok) throw new Error(`claude HTTP ${resp.status}`);
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
  const g = await guard.rateLimit(cfg, `rl:ig:cg:${guard.today()}`, 100, 90000);
  if (!g.allowed) return;

  const cred = await resolveSend(cfg);
  if (!cred || !cred.tok) { console.error("ig: comment handler has no send token"); return; }

  let out;
  try { out = await askClaudeComment(username, text); }
  catch (e) { console.error("ig: comment ai error", e && e.message); return; }

  if (out.dm) {
    const ok = await sendPrivateReply(commentId, out.dm, cred);
    if (ok && out.public_reply) await sendCommentReply(commentId, out.public_reply, cred);
  } else if (out.public_reply) {
    await sendCommentReply(commentId, out.public_reply, cred);
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
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
  if (tok && !guard.safeEqual((req.query || {}).token, tok)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const b = req.body || {};
  if (b.object !== "instagram") return res.status(200).json({ ok: true });

  const entry = (b.entry && b.entry[0]) || {};

  // Comment webhooks arrive via entry.changes (field "comments"), not messaging.
  const change = (entry.changes && entry.changes[0]) || null;
  if (change && change.field === "comments") {
    await handleComment(entry, change.value || {});
    return res.status(200).json({ ok: true });
  }

  const m = ((entry.messaging && entry.messaging[0]) || {});
  const msg = m.message || null;
  // ignore reads/deliveries/reactions/postbacks-without-message and our own echoes
  if (!msg || msg.is_echo) return res.status(200).json({ ok: true });

  const igsid = String((m.sender && m.sender.id) || "");
  if (!igsid) return res.status(200).json({ ok: true });

  const cfg = guard.kvConfig();
  const ptok = await resolveSend(cfg);

  // De-dup Meta redeliveries by message id
  if (cfg && msg.mid) {
    try {
      const first = await guard.kvCommand(cfg, ["SET", `ig:seen:${msg.mid}`, "1", "NX", "EX", "21600"]);
      if (!first.result) return res.status(200).json({ ok: true });
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
  if (!text && !imageUrl && !audioUrl) return res.status(200).json({ ok: true });

  // Rate limits: per sender + global daily
  const perUser = await guard.rateLimit(cfg, `rl:ig:h:${igsid}`, 15, 3600);
  if (!perUser.allowed) {
    await sendDM(igsid, "Please wait a bit — our team will get back to you. 🙏 · కాసేపు ఆగండి, మా team మీకు reply చేస్తుంది.", false, ptok);
    return res.status(200).json({ ok: true });
  }
  const globalCap = await guard.rateLimit(cfg, `rl:ig:g:${guard.today()}`, 400, 90000);
  if (!globalCap.allowed) {
    await sendDM(igsid, FALLBACK_REPLY, false, ptok);
    return res.status(200).json({ ok: true });
  }

  if (process.env.IG_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY || !ptok) {
    if (ptok) await sendDM(igsid, FALLBACK_REPLY, false, ptok);
    else console.error("ig: no send token (set IG_LOGIN_TOKEN, or IG_SYSTEM_TOKEN + IG_PAGE_ID)");
    return res.status(200).json({ ok: true });
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
  const extraCtx = profile && profile.name
    ? `[returning patient — name: ${profile.name}${profile.concern ? ", last concern: " + profile.concern : ""}] `
    : "";

  let out;
  try {
    if (imageUrl) {
      const imgL = await guard.rateLimit(cfg, `rl:ig:img:${igsid}`, 3, 86400);
      const gCap = await guard.rateLimit(cfg, `rl:an:g:${guard.today()}`, 300, 90000);
      if (!imgL.allowed || !gCap.allowed) {
        await sendDM(igsid, "Photo analysis limit ayipoindi 🙏 — www.dermaluxe.ai lo FREE full AI analysis try cheyandi, leda mee concern text cheyandi.", false, ptok);
        return res.status(200).json({ ok: true });
      }
      const media = await fetchUrlMedia(imageUrl);
      if (!media || media.tooBig) {
        await sendDM(igsid, "Photo download avvaledu 🙏 — malli pampandi, leda text type cheyandi.", false, ptok);
        return res.status(200).json({ ok: true });
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
          return res.status(200).json({ ok: true });
        }
        const media = await fetchUrlMedia(audioUrl);
        const heard = media && !media.tooBig ? await transcribeVoice(media.base64, media.mime) : null;
        if (!heard) {
          await sendDM(igsid, "Voice note vinipinchaledu 🙏 — dayachesi type chesi pampandi.", false, ptok);
          return res.status(200).json({ ok: true });
        }
        text = String(heard).slice(0, 1000).trim();
      }
      out = await askClaude(hist, text, igName, extraCtx, null);
      if (audioUrl) text = "[🎤] " + text;
    }
  } catch (e) {
    console.error("ig: ai error", e && e.message);
    await sendDM(igsid, FALLBACK_REPLY, false, ptok);
    return res.status(200).json({ ok: true });
  }

  if (out.lead && out.lead.name) {
    try { await storeLead(cfg, out.lead, igsid, igName, text); } catch (e) {}
  }
  if (cfg) {
    hist.push({ u: text, a: out.reply });
    try {
      await guard.kvCommand(cfg, ["SET", histKey, JSON.stringify(hist.slice(-MAX_TURNS)), "EX", String(HIST_TTL)]);
    } catch (e) {}
  }

  await sendDM(igsid, out.reply, firstTurn && !imageUrl, ptok);
  if (out.send_location === true || LOCATION_ASK.test(text)) {
    await sendDM(igsid, "📍 DermaLuxe by Medicare, Eluru — Google Maps: " + MAPS_LINK, false, ptok);
  }
  return res.status(200).json({ ok: true });
};
