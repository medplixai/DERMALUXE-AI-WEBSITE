// ─── DERMALUXE WHATSAPP AI AGENT ────────────────────────────────────────────
// /api/whatsapp — WhatsApp inbound webhook, DUAL MODE:
//   • Twilio senders  (form-encoded POST → TwiML reply)
//   • Meta WhatsApp Cloud API (JSON POST → Graph API reply; GET = verification)
// Claude-powered clinic receptionist: answers in Telugu/English, shares clinic
// info, captures appointment requests as leads (KV + Medicare Connector).
//
// Env vars:
//   ANTHROPIC_API_KEY  – already set (AI analysis)
//   AI_MODEL           – optional, default claude-opus-5
//   WA_AGENT_ENABLED   – "1" to enable Claude replies (else static fallback)
//   WA_WEBHOOK_TOKEN   – shared secret: ?token=<value> on the webhook URL and
//                        the Verify token for Meta webhook setup
//   WA_CLOUD_TOKEN     – Meta Cloud API permanent access token (to send replies)
//   TWILIO_AUTH_TOKEN  – optional; when set, X-Twilio-Signature is validated
const crypto = require("crypto");
const guard = require("./_guard.js");
const clinic = require("./_clinic.js");
const leadstore = require("./_leadstore.js");
const inbox = require("./_inbox.js");
const SA = require("./_staffask.js");
const qualify = require("./_qualify.js");
const lint = require("./_lint.js");
const rules = require("./_rules.js");
const admin = require("./_admin.js");

const LIST_KEY = "dl_leads";
const HIST_TTL = 86400; // 24h conversation memory
const MAX_TURNS = 8;

const facts = require("./_facts.js");
const notify = require("./_notify.js");
const voice = require("./_voice.js"); // shared STT/TTS stack (all channels)

const VOICE_CTX = voice.VOICE_CTX;
const stripForTts = voice.stripForTts;
const synthesizeVoice = voice.synthesize;
const transcribeVoice = (b64, mime) => voice.transcribe(b64, mime, "WhatsApp");
const hr = require("./_hr.js");
const referral = require("./_referral.js");
const memory = require("./_memory.js");
const trust = require("./_trust.js");
const capi = require("./_capi.js");

// What an ad was about, from its headline — so a person who tapped "Hair
// fall? PRP therapy" is not asked what their concern is.
// The list lives in _growth.js, which the Ads screen reads too.
const AD_CONCERNS = require("./_growth.js").CONCERNS;
const adConcern = (headline) => { const h = String(headline || ""); for (const [re, c] of AD_CONCERNS) if (re.test(h)) return c; return ""; };

// WhatsApp-specific behaviour on top of the shared clinic brain.
const WA_RULES = `- Booking flow: collect (1) name, (2) concern/treatment, (3) preferred time — ONE question at a time. Clinic visit or video consultation both possible.
- TIME SLOTS (tappable): whenever you ask for the appointment time, ALSO output "slots": 6-9 realistic options inside clinic hours (Mon–Sat 9 AM – 9 PM; use the current IST time given in context — today's remaining windows first, then tomorrow; never Sunday). Each ≤22 characters in the patient's language, e.g. "Ivala 6:30 PM", "Repu 11:00 AM", "Repu 4:00 PM". They appear as a tap-to-select list; the tapped slot comes back as plain text — treat it as their chosen time. If the context lists FULL slots, NEVER offer those exact times — suggest nearby free times instead (double-booking avvakudadu).
- When you have at least name + concern, fill "lead" in your output (keep collecting missing bits in the reply). ALSO fill "lead" the moment the patient picks a day/time, even if they have not told their name yet — then leave "name" as "" (never invent one, never use the WhatsApp profile name) and ask the name in the reply. Otherwise "lead" must be null.
- Quick-menu button taps arrive as plain text: "📅 Book Now" → start the booking flow; "💆 Services" → give a short services overview and ask what concern they have; "📸 Skin Check" → ask them to send a clear face (or scalp) photo right here; "Skin" / "Hair" (the opener's buttons) → one line asking what exactly, with up to 3 buttons.
- OFFER SLOTS THE MOMENT YOU CAN: once the concern AND the town or distance are both known (the qualifier context line names the town or says "patient is from … km") and the context shows no upcoming appointment, that SAME reply must carry "slots" (6-9 of them) with a one-line lead-in — not another question first. On 8 Nov a patient said hair fall and named their town and was still not offered a time; the chat ended there. A "[OFFER SLOTS NOW …]" marker in the context means exactly this.
- When the patient asks WHERE the clinic is / address / directions / how to reach, set "send_location": true in your output (a live map pin is sent automatically along with your reply).

- TAPPABLE BUTTONS: whenever your reply asks the patient to pick between clear options (clinic visit vs video, morning vs evening, day choices, yes/no, book now vs more info), ALSO output "buttons": up to 3 short options (each ≤20 characters, patient's language). Tapping one sends that text back to you. Prefer buttons over asking them to type — most replies that pose a choice should carry buttons.

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<your whatsapp reply>","lead":null}
or when booking info is ready:
{"reply":"...","lead":{"name":"...","concern":"...","date":"<if given>","slot":"<if given>","mode":"<Clinic Visit|Video|blank>","heat":"hot|warm|cold","lang":"<hi if the chat is in Hindi, else blank>","call_prep":"<2 short Tenglish lines for our team follow-up call: what the patient wants + one talking tip>"}}
heat: hot = ready to book / picked or asked slots / urgent; warm = interested, asking details; cold = casual browsing.
slot_ts: when the patient CONFIRMS a specific day + time, ALSO add "slot_ts":"YYYY-MM-DD HH:mm" (24-hour, IST) inside lead — compute the real calendar date from the current IST date/time given in context (e.g. if today is Sun Aug 10 2026 and they pick "Repu 6:30 PM" → "2026-08-11 18:30"). Omit until a specific time is fixed — our reminder system auto-messages the patient from this.
cancel: if the patient wants to CANCEL their appointment (and is not picking a new time), add "cancel":true inside lead. For reschedule just output the new slot_ts — old booking auto-replace avutundi. The context shows this patient's upcoming appointment if any — confirm that time with them before cancelling, and be warm about rebooking later.
Optionally add "send_location":true when the patient asks for the address/directions, "buttons":["option1","option2"] when offering choices, "slots":["Ivala 6:30 PM","Repu 11:00 AM",...] when asking for the appointment time, "send_catalog":true when someone asks about the DermaLuxe Academy / training courses (the course catalog PDF is sent automatically with your reply — mention "Course catalog PDF ikkada pampistunnanu 📄"), "trust":true when the patient hesitates (asks who the doctor is / whether results come / is it safe / will think about it) — the doctor's card with her qualifications goes out after your reply, "family":[{"name":"…","concern":"…"}] inside lead when more than one person is coming in the same slot (amma + koothuru), "voice":true when the patient would clearly rather listen than read (asks for voice, says they cannot read well, elderly writing with difficulty) — your reply is also sent as a voice note from then on, and "urgent":"<one line>" for medical emergencies.`;

const CLINIC_FACTS = facts.clinicFacts("WhatsApp", WA_RULES);
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

// Greetings, thanks, a tapped slot: turns with no medicine in them. They do
// not need the big model, and the patient notices the seconds.
const SIMPLE_TURN = /^(hi+|hello+|hai|hey|namaste|namaskaram|good (morning|evening|afternoon)|ok+|okay|sure|thanks?( you)?|thank u|dhanyavadalu|yes|no|ha|avunu|kaadu|ledu|👍|🙏|😊|❤️)[\s!.,🙏😊👍❤️]*$/i;
const SLOT_TAP = /^(ivala|repu|today|tomorrow|mon|tue|wed|thu|fri|sat)[a-z]*\s+\d{1,2}(:\d{2})?\s*(am|pm)$/i;
const isSimpleTurn = (t) => { const s = String(t || "").trim(); return s.length <= 40 && (SIMPLE_TURN.test(s) || SLOT_TAP.test(s)); };
const FAST_MODEL = () => process.env.AI_FAST_MODEL || "claude-sonnet-5";
// "Voice lo cheppandi" — somebody who would rather listen than read.
const VOICE_ASK = /(voice\s*(lo|note|message)|audio\s*(lo|message)|vinipinch|chadav(a)?len|chadavadam kashtam|kallu\s*(kanapad|sarigga)|record\s*chesi|వాయిస్|ఆడియో|వినిపించ)/i;

// "claude HTTP 400" on its own tells nobody what was wrong with the request.
// It also tells the team when the reason is an empty AI account.
const why = (resp) => notify.aiFailed(resp);

// A voice note nobody could transcribe, a sticker, a location pin: all of them
// land in the history as a turn with no words. The API refuses an empty text
// block outright — 400, no reply sent, and the patient is left waiting. So no
// half-turn and no blank message ever leaves this file.
const said = (s) => String(s == null ? "" : s).trim();
function turns(hist) {
  const messages = [];
  (hist || []).forEach((t) => {
    const u = said(t.u), a = said(t.a);
    if (!u || !a) return;
    messages.push({ role: "user", content: u });
    messages.push({ role: "assistant", content: a });
  });
  return messages;
}
const NO_WORDS = "[patient sent something with no words in it — greet them and ask what they need help with]";

async function askClaude(hist, userMsg, profileName, extraCtx, sysExtra, opts) {
  const messages = turns(hist);
  messages.push({ role: "user", content: said((extraCtx || "") + (profileName ? `[patient name on WhatsApp: ${profileName}] ` : "") + said(userMsg)) || NO_WORDS });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: (opts && opts.model) || process.env.AI_MODEL || "claude-opus-5",
      max_tokens: 2000,
      system: sysBlocks(CLINIC_FACTS, sysExtra),
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`claude HTTP ${resp.status} ${await why(resp)}`);
  const data = await resp.json();
  // Whether the cached half was actually read. A silent invalidator — a date
  // that crept into the brief, a reordered block — turns the saving off without
  // breaking anything, so it would never be noticed. One line an hour says so.
  try {
    const u = data.usage || {};
    if (Math.random() < 0.02) console.log(`claude tokens: in ${u.input_tokens || 0} · cache read ${u.cache_read_input_tokens || 0} · cache write ${u.cache_creation_input_tokens || 0} · out ${u.output_tokens || 0}`);
  } catch (e) {}
  const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    if (parsed && typeof parsed.reply === "string") return parsed;
  } catch (e) {}
  return { reply: facts.salvageReply(text) || FALLBACK_REPLY, lead: null };
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

// The treatment menu: ten rows a patient can tap, in three sections. A tap
// sends the row's title back, and the agent explains that treatment. Row
// descriptions carry the owner's "starts from" band when the policy allows.
const MENU = [
  { s: "Skin", t: "Acne & scars", d: "Pimples, marks, scars — peels, MNRF, CO2" },
  { s: "Skin", t: "Pigmentation", d: "Dark spots, melasma, tan — PICO, peels" },
  { s: "Skin", t: "Hydrafacial", d: "Instant glow, zero downtime, 45 min" },
  { s: "Skin", t: "Laser hair removal", d: "Diode laser, safe for Indian skin" },
  { s: "Skin", t: "Skin diseases", d: "Eczema, psoriasis, vitiligo, fungal, warts" },
  { s: "Hair", t: "Hair fall / PRP", d: "PRP, GFC, mesotherapy — hair roots ki" },
  { s: "Hair", t: "Hair transplant", d: "FUE / DHI / Bio-FUE, natural hairline" },
  { s: "Anti-ageing", t: "Botox & fillers", d: "Lines, volume, jawline — MD dermatologist" },
  { s: "Anti-ageing", t: "HIFU / skin tightening", d: "Non-surgical lift, single session" },
  { s: "Anti-ageing", t: "Weight loss", d: "Doctor-supervised, body contouring" },
];
// A first message that says nothing yet: "Hi", "Hello mam", "Dermaluxe", "?".
const GREET_ONLY = /^(hi+|hii+ ?(mam|sir|madam|andi)?|hello+( (mam|sir|madam|andi))?|hlo+|hai+|hey+|namaste|namaskaram|namaskar|good ?(morning|afternoon|evening|night)|dermaluxe|dermaluxe by medicare|reply|ok|\?+|\.+)?[\s!.?🙏😊👋]*$/i;
const MENU_ASK = /^(💆 services|services|menu|treatments?|treatment list|price list|rates|list)\s*\??$/i;
async function sendCloudMenu(phoneNumberId, to, cfg) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !phoneNumberId || !to) return false;
  let bands = [];
  try { const p = await require("./_prices.js").load(cfg); if (p.mode === "bands") bands = p.bands; } catch (e) {}
  const desc = (row) => {
    const b = bands.find((x) => new RegExp(x.name.split(/\s+/)[0], "i").test(row.t));
    return (b ? `₹${b.from.toLocaleString("en-IN")}+ · ` : "") + row.d;
  };
  const sections = [];
  for (const row of MENU) {
    let sec = sections.find((x) => x.title === row.s);
    if (!sec) { sec = { title: row.s, rows: [] }; sections.push(sec); }
    sec.rows.push({ id: "m" + (sec.rows.length + 1) + row.s.slice(0, 2), title: row.t.slice(0, 24), description: desc(row).slice(0, 72) });
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "list",
          header: { type: "text", text: "DermaLuxe treatments" },
          body: { text: "Mana treatments 👇 okati tap cheyandi — details cheptam. Anni MD dermatologists supervision lo, USFDA machines tho." },
          footer: { text: "Exact plan & cost — doctor consultation lo" },
          action: { button: "🗂 Treatments", sections },
        },
      }),
    });
    if (r.ok) return true;
    let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
    console.error("wa: menu send failed", r.status, d);
  } catch (e) { console.error("wa: menu send error", e && e.message); }
  return sendCloud(phoneNumberId, to, "Mana treatments:\n" + MENU.map((m) => "• " + m.t + " — " + m.d).join("\n") + "\n\nE concern gurinchi cheppamantaru?");
}

// Generic tap-to-select list message (careers roles etc.).
async function sendCloudList(phoneNumberId, to, bodyText, buttonLabel, sectionTitle, rows) {
  const token = process.env.WA_CLOUD_TOKEN;
  const items = (rows || []).map((r) => String(r || "").trim().slice(0, 24)).filter(Boolean).slice(0, 10);
  if (!token || !phoneNumberId || !to || !items.length) return sendCloud(phoneNumberId, to, bodyText);
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "list",
          body: { text: String(bodyText).slice(0, 1024) },
          action: {
            button: String(buttonLabel || "Select").slice(0, 20),
            sections: [{ title: String(sectionTitle || "Options").slice(0, 24), rows: items.map((t, i) => ({ id: `opt_${i}`, title: t })) }],
          },
        },
      }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("wa: list send failed, falling back to text", r.status, d);
      return sendCloud(phoneNumberId, to, bodyText + "\n\n" + items.map((t) => "• " + t).join("\n"));
    }
    return true;
  } catch (e) {
    console.error("wa: list send error", e && e.message);
    return sendCloud(phoneNumberId, to, bodyText);
  }
}

// Tappable command list after admin "help" (row titles ARE the commands).
async function sendAdminMenu(phoneNumberId, to, rows) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !phoneNumberId || !to || !rows || !rows.length) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "list",
          body: { text: "👇 Tap chesi run cheyandi:" },
          action: {
            button: "📋 Commands",
            sections: [{
              title: "DermaLuxe Admin",
              rows: rows.slice(0, 10).map((cmd, i) => ({ id: `cmd_${i}`, title: String(cmd).slice(0, 24) })),
            }],
          },
        },
      }),
    });
    if (!r.ok) console.error("wa: admin menu failed", r.status);
    return r.ok;
  } catch (e) {
    console.error("wa: admin menu error", e && e.message);
    return false;
  }
}

// Dynamic per-reply buttons chosen by the AI (booking choices, yes/no...).
// Falls back to a plain text send if the interactive message is rejected.
async function sendCloudDynButtons(phoneNumberId, to, bodyText, titles) {
  const token = process.env.WA_CLOUD_TOKEN;
  const btns = Array.from(new Set((titles || []).map((s) => String(s || "").trim().slice(0, 20)).filter(Boolean))).slice(0, 3);
  if (!token || !phoneNumberId || !to || !btns.length) return sendCloud(phoneNumberId, to, bodyText);
  try {
    let body = String(bodyText);
    if (body.length > 1000) {
      // interactive bodies cap at 1024 — send the long text first, buttons after
      await sendCloud(phoneNumberId, to, body);
      body = "👇";
    }
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "button",
          body: { text: body.slice(0, 1024) },
          action: { buttons: btns.map((t, i) => ({ type: "reply", reply: { id: `dyn_${i}`, title: t } })) },
        },
      }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("wa: dyn buttons failed, falling back to text", r.status, d);
      return body === "👇" ? true : sendCloud(phoneNumberId, to, bodyText);
    }
    return true;
  } catch (e) {
    console.error("wa: dyn buttons error", e && e.message);
    return sendCloud(phoneNumberId, to, bodyText);
  }
}

// Tappable confirm buttons after admin caption previews (ok/change/cancel).
async function sendAdminConfirm(phoneNumberId, to) {
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
          body: { text: "👇 Decide cheyandi:" },
          action: { buttons: [
            { type: "reply", reply: { id: "adm_ok", title: "✅ Post cheyyi" } },
            { type: "reply", reply: { id: "adm_change", title: "✏️ Marchali" } },
            { type: "reply", reply: { id: "adm_cancel", title: "❌ Cancel" } },
          ] },
        },
      }),
    });
    if (!r.ok) console.error("wa: admin confirm buttons failed", r.status);
    return r.ok;
  } catch (e) {
    console.error("wa: admin confirm buttons error", e && e.message);
    return false;
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

// The shared clock lives in _facts.js — every agent gets the same one.
const nowIstCtx = facts.nowIstCtx;

function apptFmtIst(ms) {
  const d = new Date(ms + 330 * 60000);
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  let h = d.getUTCHours();
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${mo} ${d.getUTCDate()}, ${h}:${mi} ${ap}`;
}

// Appointment context (one KV read): the patient's own upcoming booking (so
// the agent can answer/cancel/reschedule it) + times already at capacity
// (APPT_PER_SLOT, default 2) listed as FULL so it never double-books.
async function apptCtx(cfg, digits) {
  if (!cfg) return "";
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
    const per = Number(process.env.APPT_PER_SLOT || 2);
    const now = Date.now(), count = {};
    let mine = 0;
    for (const s of (r.result || [])) {
      try {
        const a = JSON.parse(s);
        if (!a.at) continue;
        if (a.ph === digits && a.at > now - 3600000) mine = a.at;
        if (a.at < now || a.at - now > 7 * 86400000) continue;
        const key = apptFmtIst(a.at);
        count[key] = (count[key] || 0) + 1;
      } catch (e) {}
    }
    const full = Object.keys(count).filter((k) => count[k] >= per);

    // Doctor leave / blocked windows the team declared — never offer these.
    let blocked = "";
    try {
      const b = await guard.kvCommand(cfg, ["LRANGE", "blk:q", "0", "49"]);
      const win = [];
      for (const s of (b.result || [])) {
        try {
          const x = JSON.parse(s);
          if (!x.from || !x.to || x.to < now) continue;
          if (x.from - now > 30 * 86400000) continue;
          win.push(`${apptFmtIst(x.from)} - ${apptFmtIst(x.to)}${x.note ? " (" + x.note + ")" : ""}`);
        } catch (e) {}
      }
      if (win.length) blocked = `[CLOSED / doctor leave — NEVER offer or accept these times, suggest the next free day instead: ${win.join(" · ")}] `;
    } catch (e) {}

    return (mine ? `[This patient's upcoming appointment: ${apptFmtIst(mine)}] ` : "")
      + (full.length ? `[FULL slots — do not offer these times: ${full.join(", ")}] ` : "")
      + blocked;
  } catch (e) { return ""; }
}

// Patient cancelled → drop queued reminders + tell the team so a human can
// follow up (a win-back call beats a silent empty chair).
// ✅ Vastanu tap (day-before appointment_confirm template) → flag the
// upcoming appointment confirmed: digest shows ✅, 9 AM reminder is skipped.
// askedOnly: plain "yes"/"confirm" only count when the confirm template went
// out (c1) — a bare "yes" mid-chat must not be misread as a confirmation.
async function confirmAppt(cfg, phone, askedOnly) {
  try {
    const q = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
    for (const s of (q.result || [])) {
      let a; try { a = JSON.parse(s); } catch (e) { continue; }
      if (!a || a.ph !== phone || !a.at || a.at < Date.now() - 3600000) continue;
      if (askedOnly && !a.c1) continue;
      if (!a.cf) {
        a.cf = true; a.cfAt = Date.now();
        await guard.kvCommand(cfg, ["LREM", "appt:q", "1", s]).catch(() => {});
        await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(a)]).catch(() => {});
      }
      return a;
    }
  } catch (e) {}
  return null;
}

// Post-visit rating tap (visit_rating template, day 2). Stores it in rv:log,
// thanks the patient, sends 4-5 stars to the Google review link when
// REVIEW_LINK is set (referral nudge otherwise) and pages the team on <=3
// for a same-day recovery call.
async function recordRating(cfg, phone, rating, askRaw, profileName) {
  let ask = {}; try { ask = JSON.parse(askRaw) || {}; } catch (e) {}
  const name = String(ask.name || profileName || "").split(" ")[0];
  await guard.kvCommand(cfg, ["DEL", `rv:ask:${phone}`]).catch(() => {});
  await guard.kvCommand(cfg, ["LPUSH", "rv:log", JSON.stringify({ ph: phone, name, rating, concern: ask.concern || "", ts: Date.now() })]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "rv:log", "0", "499"]).catch(() => {});
  if (rating >= 4) {
    // This used to answer a four- or five-star rating with the Google
    // write-review link, and, when there was no link, with "recommend us to
    // your friends". Both are gone. NMC 3.2 Explanation V: "An RMP shall not
    // request or share patient testimonials, recommendations, endorsements or
    // reviews for professional promotion." A patient who has just given five
    // stars is the moment the ask works, which is the moment the clause is
    // aimed at. Thanking them and leaving the door open is not an ask.
    return `${rating === 5 ? "\u{1F31F}" : "\u{1F60A}"} Thank you ${name}! Mee ${rating}⭐ maaku chala important 💖\n\n` +
      "Inka emaina doubts unte ikkade adagandi 😊";
  }
  const team = Array.from(new Set(
    String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666").split(",")
      .concat(guard.ownerPhones())
      .map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10)));
  try {
    const push = require("./_push.js");
    if (push.enabled()) await push.notifyCap(cfg, "reviews.view", {
      title: `⚠️ ${rating}★ rating — ${name || "Patient"}`,
      body: `${ask.concern || "Feedback"} · ${phone || ""} — ivala call cheyandi`.slice(0, 160),
      tab: "reviews", urgent: true, data: { kind: "rating", phone: phone || "" },
    });
  } catch (e) { console.error("push: rating", e && e.message); }
  for (const to of team) {
    await notify.teamSend(cfg, to, `⚠️ *Low rating — ${rating}⭐*\n\n👤 ${name || "Patient"} (${phone})\n🩺 ${ask.concern || "-"}\n\nIvala call chesi issue teluskondi — service recovery 🙏`).catch(() => {});
  }
  return `Sorry ${name} 🙏 mee experience meeru expect chesinatlu lekapoyinanduku. Mee feedback maaku chala important.\n\nMana team ivala meeku call chesi matladutharu. Emi problem ayindo ikkada kuda cheppochu — ventane fix chestam 💛`;
}

async function cancelAppt(cfg, phone, name) {
  if (!cfg) return;
  let hadAt = 0;
  try {
    const q = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
    for (const s of (q.result || [])) {
      try {
        const a = JSON.parse(s);
        if (a.ph === phone) { hadAt = a.at; await guard.kvCommand(cfg, ["LREM", "appt:q", "1", s]); }
      } catch (e) {}
    }
  } catch (e) {}
  if (!hadAt) return;
  const team = String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666")
    .split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter((s) => s.length === 10);
  for (const to of team) {
    await notify.teamSend(cfg, to, `❌ *Appointment cancelled* — ${name || "patient"} (${phone})\nWas: ${apptFmtIst(hadAt)}\nCall chesi reason adigi, malli book cheyagalara 📞`).catch(() => {});
  }
}

// Tap-to-select appointment slots (interactive list, up to 10 rows).
// Falls back to a plain text send if the list message is rejected.
async function sendCloudSlotList(phoneNumberId, to, bodyText, slots) {
  const token = process.env.WA_CLOUD_TOKEN;
  const rows = Array.from(new Set((slots || []).map((s) => String(s || "").trim().slice(0, 24)).filter(Boolean))).slice(0, 10);
  if (!token || !phoneNumberId || !to || !rows.length) return sendCloud(phoneNumberId, to, bodyText);
  try {
    let body = String(bodyText);
    let sentTextFirst = false;
    if (body.length > 1000) {
      await sendCloud(phoneNumberId, to, body);
      body = "🗓 Time select cheyandi:";
      sentTextFirst = true;
    }
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "list",
          body: { text: body.slice(0, 1024) },
          action: {
            button: "🗓 Slot select",
            sections: [{ title: "Available times", rows: rows.map((t, i) => ({ id: `slot_${i}`, title: t })) }],
          },
        },
      }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("wa: slot list failed, falling back to text", r.status, d);
      return sentTextFirst ? true : sendCloud(phoneNumberId, to, bodyText);
    }
    return true;
  } catch (e) {
    console.error("wa: slot list error", e && e.message);
    return sendCloud(phoneNumberId, to, bodyText);
  }
}

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


// Send a picture by public URL (gallery before/after shots live in KV and are
// served by api/media.js). Failure is silent — the text reply already went.
const CATALOG_URL = "https://www.dermaluxe.ai/assets/academy/DermaLuxe-Academy-Course-Catalog.pdf";
const acadDocs = require("./_docs.js");   // batch dates/seats, written down once
const ACADEMY_ASK = /(academy|acadamy|course|cours|training|trainin|cosmetolog|therapist course|nerchuko|nerpist|nerputar|శిక్షణ|కోర్సు|అకాడమీ)/i;
async function sendCloudDocument(phoneNumberId, to, url, filename, caption) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !phoneNumberId || !to || !url) return false;
  try {
    const document = { link: url };
    if (filename) document.filename = String(filename).slice(0, 120);
    if (caption) document.caption = String(caption).slice(0, 900);
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "document", document }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("wa: document send failed", r.status, d);
      return false;
    }
    return true;
  } catch (e) { console.error("wa: document send error", e && e.message); return false; }
}
// Academy conversation → live seat status for the sales playbook (owner sets via "academy booked N").
async function academyCtx(cfg, hist, text) {
  try {
    const inConvo = ACADEMY_ASK.test(String(text || "")) || (hist || []).slice(-4).some((t) => ACADEMY_ASK.test(String(t.u || "")) || /academy/i.test(String(t.a || "")));
    if (!inConvo || !cfg) return "";
    const seats = acadDocs.BATCH.seats;
    const booked = await require("./_seats.js").booked(cfg), left = seats - booked;
    const days = Math.max(0, Math.ceil((acadDocs.BATCH.offerEndMs - Date.now()) / 86400000));
    return `[ACADEMY SEATS STATUS: booked ${booked}/${seats}, seats left ${left}; launch offer ends ${acadDocs.BATCH.offerEnd} (${days} days left); batch starts ${acadDocs.BATCH.start}] `;
  } catch (e) { return ""; }
}
// Material parked by cron-academy while the 24-hour window was shut: the moment
// the student writes to us, deliver it.
async function flushPendingMaterial(cfg, cloud) {
  if (!cfg) return false;
  const digits = String(cloud.to || "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return false;
  try {
    const idr = await guard.kvCommand(cfg, ["GET", `acad:ph:${digits}`]);
    const id = idr && idr.result ? String(idr.result) : "";
    if (!id) return false;
    const pr = await guard.kvCommand(cfg, ["GET", `acad:pending:${id}`]);
    if (!pr || !pr.result) return false;
    let pend; try { pend = JSON.parse(pr.result); } catch (e) { return false; }
    await guard.kvCommand(cfg, ["DEL", `acad:pending:${id}`]).catch(() => {});
    const secret = process.env.STAFF_SECRET || process.env.ADMIN_KEY || process.env.WA_WEBHOOK_TOKEN || "";
    const tok = `${id}.${require("crypto").createHmac("sha256", secret).update("acad:" + id).digest("hex").slice(0, 24)}`;
    for (const t of (pend.tracks || ["skin"])) {
      const url = `https://www.dermaluxe.ai/api/material?t=${encodeURIComponent(tok)}&track=${t}&day=${pend.day}`;
      await sendCloudDocument(cloud.phoneNumberId, cloud.to, url,
        `DermaLuxe-${t === "skin" ? "Skin" : "Hair"}-Day-${String(pend.day).padStart(2, "0")}.pdf`,
        `📄 Day ${pend.day} study material — ${t === "skin" ? "Skin Care" : "Hair Care"}.\n🔒 Mee personal link, share cheyakandi.`);
    }
    return true;
  } catch (e) { console.error("wa: pending material", e && e.message); return false; }
}

// Academy enquiry → send the course catalog PDF once per number per 30 days.
async function maybeSendCatalog(cfg, cloud, out, text) {
  const wants = out.send_catalog === true || ACADEMY_ASK.test(String(text || "")) || /^academy/i.test(String((out.lead && out.lead.concern) || ""));
  if (!wants) return false;
  const digits = String(cloud.to || "").replace(/\D/g, "").slice(-10);
  if (cfg && digits) {
    try {
      const nx = await guard.kvCommand(cfg, ["SET", `acad:pdf:${digits}`, "1", "NX", "EX", "2592000"]);
      if (!nx || !nx.result) return false;
    } catch (e) {}
  }
  const ok = await sendCloudDocument(cloud.phoneNumberId, cloud.to, CATALOG_URL, "DermaLuxe-Academy-Course-Catalog.pdf",
    `📄 DermaLuxe Academy — Course Catalog\nSkin Care · Hair Care · Skin + Hair · Fees & launch offer (till ${acadDocs.BATCH.offerEnd}) · Batch ${acadDocs.BATCH.no}: ${acadDocs.BATCH.start} · Only ${acadDocs.BATCH.seats} seats\n\nSeat reserve cheyalante *ACADEMY* ani reply cheyandi 😊`);
  if (!ok && cfg && digits) await guard.kvCommand(cfg, ["DEL", `acad:pdf:${digits}`]).catch(() => {});
  return ok;
}
async function sendCloudImage(phoneNumberId, to, url, caption) {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token || !phoneNumberId || !to || !url) return false;
  try {
    const image = { link: url };
    if (caption) image.caption = String(caption).slice(0, 900);
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "image", image }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("wa: image send failed", r.status, d);
      return false;
    }
    return true;
  } catch (e) {
    console.error("wa: image send error", e && e.message);
    return false;
  }
}

// Before/after gallery: admins file shots under a tag ("hair transplant",
// "pigmentation"); a patient asking for proof gets the closest-matching set.
async function galleryFor(cfg, want) {
  if (!cfg || !want) return [];
  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const asked = norm(want);
  if (!asked) return [];
  const askWords = asked.split(" ").filter((w) => w.length > 2);
  try {
    const tagsR = await guard.kvCommand(cfg, ["SMEMBERS", "gal:_tags"]);
    const tags = tagsR.result || [];
    if (!tags.length) return [];
    let best = "";
    for (const t of tags) {
      const nt = norm(t);
      if (nt === asked) { best = t; break; }
      const hit = nt.indexOf(asked) !== -1 || asked.indexOf(nt) !== -1
        || askWords.some((w) => nt.indexOf(w) !== -1);
      if (hit && !best) best = t;
    }
    if (!best) return [];
    const r = await guard.kvCommand(cfg, ["LRANGE", `gal:${best}`, "0", "1"]);
    return (r.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } })
      .filter((it) => it && it.imgId);
  } catch (e) { return []; }
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


// Claude vision — quick skin/hair pre-assessment of a WhatsApp photo.
async function askClaudeVision(hist, media, caption, profileName, extraCtx, sysExtra) {
  const mime = ["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(media.mime) !== -1 ? media.mime : "image/jpeg";
  const messages = turns(hist);
  messages.push({
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mime, data: media.base64 } },
      { type: "text", text: said((extraCtx || "") + (profileName ? `[patient name on WhatsApp: ${profileName}] ` : "") + said(caption)) || "Photo pampanu — analysis cheyandi." },
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
      model: process.env.AI_MODEL || "claude-opus-5",
      max_tokens: 2000,
      // PHOTO_RULES is constant too, so it joins the cached half; the owner's
      // rules stay after the breakpoint.
      system: sysBlocks(CLINIC_FACTS + "\n\n" + PHOTO_RULES, sysExtra),
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`claude vision HTTP ${resp.status} ${await why(resp)}`);
  const data = await resp.json();
  const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    if (parsed && typeof parsed.reply === "string") return parsed;
  } catch (e) {}
  return { reply: facts.salvageReply(text) || FALLBACK_REPLY, lead: null };
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
    heat: ["hot", "warm", "cold"].indexOf(String(leadInfo.heat || "").toLowerCase()) !== -1 ? String(leadInfo.heat).toLowerCase() : "",
    lang: leadInfo.lang === "hi" ? "hi" : "",   // the desk hands Hindi chats to somebody who speaks it
    call_prep: String(leadInfo.call_prep || "").slice(0, 220),
  };
  // A slot picked before a name is still a booking: the desk sees it, the
  // team is alerted, the reminder goes out. The name shown is only a label
  // for the desk — it is never remembered as the patient's name, and the
  // reminders greet them without one.
  const unnamed = !lead.name;
  if (unnamed) {
    if (!leadInfo.slot_ts && !lead.date && !lead.slot) return;
    lead.name = leadInfo.profile ? `${String(leadInfo.profile).slice(0, 40)} (WhatsApp peru)` : "(peru cheppaledu)";
  }
  // Amma + koothuru in one slot: the others ride on the same booking.
  const family = (Array.isArray(leadInfo.family) ? leadInfo.family : []).map((f) => ({ name: String((f && f.name) || "").slice(0, 40).trim(), concern: String((f && f.concern) || "").slice(0, 60).trim() })).filter((f) => f.name).slice(0, 4);
  if (family.length) lead.concern = (lead.concern + " + " + family.map((f) => `${f.name}${f.concern ? " (" + f.concern + ")" : ""}`).join(", ")).slice(0, 160);
  lead.src_id = phone;
  Object.assign(lead, qualify.stamp(await qualify.read(cfg, phone)));   // grade, score, km, why — for the desk
  if (!unnamed) await saveProfile(cfg, phone, lead.name, lead.concern); // long-term greeting memory
  // One lead per patient per 6h conversation window — as the chat progresses,
  // the earlier row is replaced by this enriched one (and keeps the desk's
  // status and notes).
  if (cfg) {
    const ar = await guard.kvCommand(cfg, ["GET", `ad:ref:${phone}`]).catch(() => ({}));
    let ref = null; try { ref = ar && ar.result ? JSON.parse(ar.result) : null; } catch (e) {}
    if (ref && ref.ad) {
      lead.ad_id = ref.ad; if (ref.headline) lead.ad_headline = ref.headline; if (ref.src) lead.ad_src = ref.src;
      if (ref.body) lead.ad_body = ref.body; if (ref.url) lead.ad_url = ref.url; if (ref.thumb) lead.ad_thumb = ref.thumb;
    }
  }
  const sync = await clinic.forwardLead(cfg, lead);
  if (sync.attempted) lead.synced = sync.synced;
  await leadstore.saveLead(cfg, lead, (l) => (l.src_id || l.phone) === phone && l.type === lead.type && lead.ts - l.ts < 21600000);
  // Confirmed slot with a machine-readable time → appointment-reminder queue.
  // cron-digest (9AM IST) sends the same-day template reminder, cron-post the
  // ~2h-before nudge. Latest booking per patient wins (reschedules replace).
  let bookedNow = 0;
  try {
    const m = String(leadInfo.slot_ts || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (cfg && m) {
      const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 330 * 60000; // IST wall time → epoch
      if (at > Date.now() - 600000 && at - Date.now() < 60 * 86400000) {
        const q = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
        let hadSame = false;
        for (const s of (q.result || [])) {
          try {
            const prev = JSON.parse(s);
            if (prev.ph === phone) {
              // Same slot re-confirmed mid-chat → keep the existing item so
              // its r9/r2 reminder flags survive; changed slot → replace.
              if (prev.at === at) { hadSame = true; continue; }
              // A slot already in the past stays: since 9 Nov it waits on the
              // day's list for the desk to say whether the person came, and a
              // rebooking must not erase that record (the no-show would never
              // be written anywhere).
              if (Number(prev.at) < Date.now()) continue;
              await guard.kvCommand(cfg, ["LREM", "appt:q", "1", s]);
            }
          } catch (e) {}
        }
        if (!hadSame) {
          await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(Object.assign({
            ph: phone, name: unnamed ? "" : lead.name.split(" ")[0], at, concern: lead.concern.slice(0, 60),
            ts: Date.now(), by: "AI agent",
            label: unnamed ? lead.name : undefined,   // the desk's label; reminders still greet without it
          }, family.length ? { pax: family.length + 1, with: family.map((f) => f.name).join(", ") } : {}))]);
          bookedNow = at; // advance ask only on a NEW/changed slot
          // The agent tells the patient "mana team call chesi confirm
          // chestundi" — and in the opening week it held 14 slots of which
          // one got that call (plan, 9 Nov). The desk's phones are told the
          // moment the slot is held, so the call happens inside 30 minutes.
          try {
            const push = require("./_push.js");
            if (push.enabled()) await push.notifyCap(cfg, "appts.edit", {
              title: `☎️ Confirm call — ${unnamed ? lead.name : lead.name.split(" ")[0]} · ${apptFmtIst(at)}`.slice(0, 120),
              body: "Agent slot hold chesindi. 30 nimishallo call chesi confirm cheyandi.",
              tab: "appts", urgent: true, data: { kind: "confirm", ph: phone, at },
            });
          } catch (e) { console.error("push: confirm call", e && e.message); }
        }
      }
    }
  } catch (e) {}
  await notify.leadAlert(cfg, lead);
  return { bookedAt: bookedNow };
}

// The burst this message belongs to. Waits WA_MERGE_MS (2.5 s), then reads
// the patient's inbox thread: a later plain-text message from them means
// that one will answer ({later:true}); otherwise every plain-text message
// they sent since our last word to them, within a minute, is joined into
// one ({text}). Photos, voice notes and files are never folded in — they go
// through on their own, as before.
const MEDIA_LINE = /^\[(📷|🎤|🎬|📄)/;
async function mergeBurst(cfg, phone, myTs, myText) {
  const wait = Number(process.env.WA_MERGE_MS == null ? 2500 : process.env.WA_MERGE_MS);
  if (!(wait > 0)) return {};
  await new Promise((r) => setTimeout(r, wait));
  const r = await guard.kvCommand(cfg, ["LRANGE", `ib:m:${phone}`, "0", "11"]).catch(() => ({}));
  const rows = ((r && r.result) || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
  // Newest first. Anything from them after mine, in words, will answer.
  if (rows.some((m) => m.dir === "in" && Number(m.ts) > myTs && !MEDIA_LINE.test(String(m.text || "")))) return { later: true };
  const mine = [];
  for (const m of rows) {
    if (Number(m.ts) > myTs) continue;               // a photo that came after: it answers itself
    if (m.dir !== "in") break;                       // our last word to them ends the burst
    if (myTs - Number(m.ts) > 60000 || MEDIA_LINE.test(String(m.text || ""))) break;
    mine.unshift(String(m.text || ""));
  }
  if (mine.length < 2) return {};
  return { text: mine.join("\n").slice(0, 1000) };
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

  // Layer 1: shared-secret token. With none configured it refuses instead of
  // standing open — otherwise a forged payload "from" the owner's number
  // could run owner commands (a broadcast to every patient).
  if (!tok || !guard.safeEqual((req.query || {}).token, tok)) {
    if (!tok) console.error("wa: WA_WEBHOOK_TOKEN is not set — refusing webhook POSTs");
    return res.status(403).json({ error: "Forbidden" });
  }

  const b = req.body || {};
  const isMeta = b && b.object === "whatsapp_business_account";
  const cfg = guard.kvConfig();

  let digits = "", text = "", profileName = "", cloud = null, imageId = "", audioId = "", videoId = "", videoMime = "", docId = "", docName = "";
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
    // Came from a click-to-WhatsApp ad: Meta says which ad. Kept for 30 days
    // so the lead this conversation becomes is credited to that ad, and the
    // Ads screen can say what each campaign cost per patient, not per chat.
    if (cfg && msg.referral && (msg.referral.source_type === "ad" || msg.referral.source_id)) {
      const rph = String(msg.from || "").replace(/\D/g, "").slice(-10);
      // "ad" is money being spent; "post" is an organic post with a message
      // button and nothing to switch off. Told apart only by this field, and
      // a day went into guessing which it was for want of storing it.
      const R = msg.referral;
      const ref = { ad: String(R.source_id || "").slice(0, 40), headline: String(R.headline || "").slice(0, 120), src: String(R.source_type || "").slice(0, 12).toLowerCase(), ts: Date.now(),
        // Enough to recognise the ad by on the Ads screen: an Instagram boost
        // lives in an account we cannot read, and its "headline" is often just
        // "api.whatsapp.com". Its own words, its link and its picture are not.
        body: String(R.body || "").replace(/\s+/g, " ").slice(0, 200), url: String(R.source_url || "").slice(0, 300),
        thumb: String(R.thumbnail_url || R.image_url || "").slice(0, 500) };
      if (rph.length === 10 && ref.ad) {
        await guard.kvCommand(cfg, ["SET", `ad:ref:${rph}`, JSON.stringify(ref), "EX", String(30 * 86400)]).catch(() => {});
        // The ad already told us the concern: the grade starts from it, and the
        // agent will not ask it again.
        const c = adConcern(ref.headline);
        if (c && c !== "academy") await qualify.absorb(cfg, rph, { problem: c }, { channel: "whatsapp" }).catch(() => {});
      }
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
      const bid = String((i.button_reply && i.button_reply.id) || "");
      // Admin preview confirm buttons map straight to the typed commands.
      if (bid === "adm_ok") text = "ok";
      else if (bid === "adm_change") text = "change";
      else if (bid === "adm_cancel") text = "cancel";
      else text = String((i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || "").slice(0, 1000).trim();
    } else if (msg.type === "image") {
      imageId = String((msg.image && msg.image.id) || "");
      text = String((msg.image && msg.image.caption) || "").slice(0, 500).trim();
      if (!imageId) return res.status(200).json({ ok: true });
    } else if (msg.type === "audio" || msg.type === "voice") {
      audioId = String(((msg.audio || msg.voice || {}).id) || "");
      if (!audioId) return res.status(200).json({ ok: true });
    } else if (msg.type === "video") {
      // Kept only for admin Reel posting — patients get the steering reply below.
      videoId = String((msg.video && msg.video.id) || "");
      videoMime = String((msg.video && msg.video.mime_type) || "video/mp4").split(";")[0];
      text = String((msg.video && msg.video.caption) || "").slice(0, 500).trim();
      if (!videoId) return res.status(200).json({ ok: true });
    } else if (msg.type === "document") {
      // Documents are CVs for the careers flow — captured here, steered later
      // if no hiring session is active.
      docId = String((msg.document && msg.document.id) || "");
      docName = String((msg.document && msg.document.filename) || "").slice(0, 120);
      text = String((msg.document && msg.document.caption) || "").slice(0, 500).trim();
      if (!docId) return res.status(200).json({ ok: true });
    } else if (["location", "contacts"].indexOf(msg.type) !== -1) {
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

  // The staff inbox keeps every patient conversation; owner commands are not
  // patient conversations and stay out of it.
  const patientChat = () => cfg && digits && !admin.isAdmin(digits);
  const logOut = (t) => (patientChat() ? inbox.log(cfg, digits, { dir: "out", text: t, by: "ai" }).catch(() => {}) : null);

  // unified reply transport
  const respond = async (replyText) => {
    await logOut(replyText);
    if (isMeta) {
      await sendCloud(cloud.phoneNumberId, cloud.to, replyText);
      return res.status(200).json({ ok: true });
    }
    return twiml(res, replyText);
  };

  if (!digits || (!text && !imageId && !audioId && !videoId && !docId)) return respond(FALLBACK_REPLY);
  if (isMeta) await notify.markWindow(cfg, digits); // team alerts check this before sending plain text
  let loggedAt = 0;   // when this message went into the inbox — see the merge below
  if (patientChat()) {
    const shown = text || (imageId ? "[📷 photo]" : audioId ? "[🎤 voice note]" : videoId ? "[🎬 video]" : docId ? `[📄 ${docName || "document"}]` : "");
    loggedAt = await inbox.log(cfg, digits, { dir: "in", text: (imageId || videoId || docId) && text ? `[${imageId ? "📷" : videoId ? "🎬" : "📄"}] ${text}` : shown, name: profileName }).catch(() => {});
  }

  // Owner/admin commands (owner allowlist = ADMIN_PHONES ∪ STAFF_OWNERS;
  // explicit commands only —
  // anything else from the admin falls through to the normal agent).
  // Admin-looking command from a number that is not on the admin allowlist:
  // tell them, instead of letting the patient agent answer it.
  // "staff", "report", "results", "appointments" and "reviews" on their own
  // are words patients use — every first reply tells them to type "staff" —
  // so only the full owner forms of those ("staff add …") are caught here.
  const ADMIN_CMD = /^(templates?|staff\s+(list|add|remove|delete|roles|password)|academy\s+(booked|status|notify|msg|message)|daily\s+(post|on|off|status|topics)|weekly|funnel|referrals|checkups|blocks|insta\s+report|leads\s+report|ideas|queue|campaigns|marketing\s+report)\b/i;
  if (isMeta && !admin.isAdmin(digits) && ADMIN_CMD.test(String(text || "").trim())) {
    return respond(`🔒 Ee command *owner number* nunchi matrame pani chestundi.\n\nMee number: ${digits}\nOwner numbers: ${guard.ownerPhones().map((x) => x.slice(0, 2) + "xxxxx" + x.slice(-3)).join(", ") || "—"}\n\nMee number ni owner ga add cheyalante, existing owner number nunchi cheppandi.`);
  }

  if (isMeta && admin.isAdmin(digits)) {
    try {
      const adminReply = await admin.handle(cfg, digits, text,
        imageId ? { fetch: () => fetchMedia(imageId) } : null,
        videoId ? { id: videoId, mime: videoMime } : null);
      if (adminReply) {
        const obj = typeof adminReply === "object" ? adminReply : { text: adminReply };
        await sendCloud(cloud.phoneNumberId, cloud.to, obj.text);
        if (obj.confirm) await sendAdminConfirm(cloud.phoneNumberId, cloud.to);
        if (obj.menuRows) await sendAdminMenu(cloud.phoneNumberId, cloud.to, obj.menuRows);
        return res.status(200).json({ ok: true });
      }
    } catch (e) { console.error("wa: admin error", e && e.message); }
  }

  // Careers flow: JOBS trigger / active application session (handles CV docs).
  if (isMeta) {
    try {
      const hrReply = await hr.handle(cfg, digits, text, docId ? { id: docId, name: docName } : null);
      if (hrReply) {
        await logOut(hrReply.text);          // or the applicant looks unanswered in the inbox for ever
        if (hrReply.list) {
          await sendCloudList(cloud.phoneNumberId, cloud.to, hrReply.text, hrReply.list.button, hrReply.list.title, hrReply.list.rows);
        } else if (hrReply.buttons) {
          await sendCloudDynButtons(cloud.phoneNumberId, cloud.to, hrReply.text, hrReply.buttons);
        } else {
          await sendCloud(cloud.phoneNumberId, cloud.to, hrReply.text);
        }
        return res.status(200).json({ ok: true });
      }
    } catch (e) { console.error("wa: hr error", e && e.message); }
  }

  // Documents outside the careers flow — steer to what the agent handles.
  if (docId) {
    return respond("Namaste! 🙏 Document analysis cheyalenu — text, voice note leda skin/hair photo pampandi. 📸\nJob application ki aithe *JOBS* ani pampandi. 💼");
  }

  // Videos are only for the admin Reel pipeline — the patient agent can't
  // analyse them, so steer everyone else (and command-less admin videos).
  if (videoId) {
    return respond(admin.isAdmin(digits)
      ? "🎬 Reel post cheyali ante video tho paatu caption lo 'post: <idea>' ani pampandi (leda 'schedule: repu 6pm | <idea>')."
      : "Namaste! 🙏 Video ki analysis cheyalenu — text, voice note leda skin/hair photo pampandi. 📸\n· టెక్స్ట్, వాయిస్ నోట్ లేదా ఫోటో పంపండి — ఫోటోకి వెంటనే AI విశ్లేషణ ఇస్తాను.");
  }

  // ---- Referral program: personal code out, friend's code in -------------
  if (cfg && !imageId && !audioId) {
    const raw = text.trim();
    if (/^(refer|referral|refer friend|my code|code|referral code)$/i.test(raw)) {
      const code = await referral.myCode(cfg, digits);
      const n = await referral.countFor(cfg, digits);
      return respond(`*Mee referral code: ${code}*\n\n👨‍👩‍👧 Mee friends/family ki ee code ivvandi — vaallu first visit lo cheppithe, meeru cheppi vachcharani manaki telustundi.\n${n ? `Ippativaraku mee code tho vachchina vaallu: *${n}*\n` : ""}\nShare cheyadaniki 👇 (copy chesi pampandi)\n\n_DermaLuxe by Medicare, Eluru — skin & hair treatments ki chala manchi clinic 😊 Naa referral code *${code}* cheppandi: wa.me/919959134666_`);
    }
    const cm = raw.match(/\b(DL\d{4})\b/i);
    if (cm && raw.length <= 60) {
      const out = await referral.redeem(cfg, cm[1], digits, profileName);
      if (out.ok) {
        const team = Array.from(new Set(
          String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666").split(",")
            .concat(guard.ownerPhones())
            .map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10)));
        for (const to of team) {
          await notify.teamSend(cfg, to, `*Referral*\n\n👤 ${profileName || "Patient"} (${digits})\n🔗 Code *${out.code}* — referrer: ${out.owner}\n\nEvaru cheppi vachcharo telusukovadaniki matrame — referral ki emi ivvakoodadhu (NMC 8.1(vii)).`).catch(() => {});
        }
        await notify.sendWa(out.owner, `Mee referral code tho *${profileName || "oka friend"}* DermaLuxe ki vachcharu — dhanyavadalu 🙏`).catch(() => {});
        return respond(`*Code accept ayindi*\n\n✅ *${out.code}* — mee friend mimmalni pampincharu, dhanyavadalu 🙏\n\nMee concern cheppandi, appointment chuddam 😊`);
      }
      if (out.reason === "self") return respond("😄 Adi mee own code andi — friends ki share cheyandi!\n\nAppointment kavali ante cheppandi 🙏");
      if (out.reason === "already") return respond(`Meeru already *${out.code}* code use chesaru 👍\n\nInkem kavali? Appointment book cheyala? 😊`);
      // unknown code → fall through to the normal agent (might be a typo/other text)
    }
  }

  // ---- Day-before confirm buttons + post-visit rating taps ---------------
  if (cfg && !imageId && !audioId) {
    const raw = text.trim();
    const tapped = /^(✅\s*)?vasta+nu$/i.test(raw); // button label (no emoji allowed by Meta) or typed
    if (tapped || /^(confirm|confirmed|yes)$/i.test(raw)) {
      const c = await confirmAppt(cfg, digits, !tapped);
      if (c) return respond(`✅ *Confirmed!* Thank you ${c.name || ""} 🙏\n\n📅 ${admin.fmtIst(c.at)}\n📍 DermaLuxe by Medicare, Rama Mahal, Kasturi Vari Street, Opp. Happy Mobiles, Eluru\n\nSee you! Emaina doubts unte ikkade adagandi 😊`);
    }
    if (/^(🔁\s*)?reschedule$/i.test(raw)) {
      text = "Naa appointment reschedule cheyali — next available slots chupinchu";
    }
    const rm = raw.match(/^[⭐👍😐]?\s*([1-5])(?:\s|$)/u);
    if (rm) {
      const pend = await guard.kvCommand(cfg, ["GET", `rv:ask:${digits}`]).catch(() => ({}));
      if (pend && pend.result) return respond(await recordRating(cfg, digits, Number(rm[1]), pend.result, profileName));
    }
  }

  // Marketing opt-out/in: STOP blocks broadcast templates (the optout set);
  // utility appointment reminders and normal chat keep working.
  if (cfg && !imageId && !audioId) {
    if (/^(stop|unsubscribe|opt\s*out)$/i.test(text.trim())) {
      await guard.kvCommand(cfg, ["SADD", "optout", digits]).catch(() => {});
      return respond("✅ Done — ika meeku offers/promotional messages pampamu. 🙏\nAppointments & skin/hair questions ki eppudaina message cheyochu!\n(Offers malli kavali ante *START* ani pampandi)");
    }
    if (/^(start|subscribe)$/i.test(text.trim())) {
      await guard.kvCommand(cfg, ["SREM", "optout", digits]).catch(() => {});
      return respond("💖 Welcome back! Offers & updates malli vastayi. 🙏");
    }
  }

  // Layer 3: rate limits — per phone + global daily
  const perPhone = await guard.rateLimit(cfg, `rl:wa:h:${digits}`, 15, 3600);
  if (!perPhone.allowed) {
    // Said once per phone per two hours. It used to go out on every message
    // over the limit, and on 7 Nov one patient was told "please wait" eight
    // times in a row — a loop, to anyone reading it. The message is already
    // in the inbox and _rescue pages a human, so a silent 200 loses nothing.
    const first = cfg ? await guard.kvCommand(cfg, ["SET", `wa:wait:${digits}`, "1", "NX", "EX", "7200"]).catch(() => ({})) : { result: "OK" };
    if (first && first.result) return respond("Please wait a bit — our team will get back to you. 🙏 · కాసేపు ఆగండి, మా team మీకు reply చేస్తుంది.");
    return isMeta ? res.status(200).json({ ok: true, muted: true }) : twiml(res, "");
  }
  const globalCap = await guard.rateLimit(cfg, `rl:wa:g:${guard.today()}`, 400, 90000);
  if (!globalCap.allowed) return respond(FALLBACK_REPLY);

  // A colleague has taken this conversation over: the agent stays quiet and
  // the people who can answer are told there is a message waiting.
  if (patientChat()) {
    const hum = await inbox.human(cfg, digits);
    if (hum) {
      const ping = await guard.kvCommand(cfg, ["SET", `ib:ping:${digits}`, "1", "NX", "EX", "300"]).catch(() => ({}));
      if (ping && ping.result) {
        try {
          const push = require("./_push.js");
          if (push.enabled()) await push.notifyCap(cfg, "inbox.view", {
            title: `💬 ${profileName || digits}`,
            body: String(text || "[media]").slice(0, 140),
            tab: "inbox", urgent: true, data: { kind: "inbox", phone: digits },
          });
        } catch (e) { console.error("push: inbox", e && e.message); }
      }
      return isMeta ? res.status(200).json({ ok: true, human: true }) : twiml(res, "");
    }
  }

  // "Staff" — they want a person. Said, and the team told; see _staffask.js.
  if (patientChat() && !imageId && !audioId && SA.isAsk(text)) {
    const sk = `wa:h:${digits}`;
    const h0 = await getHistory(cfg, sk);
    const lastAsk = h0.map((t) => String((t && t.u) || "")).reverse().find((u) => u && !SA.isAsk(u)) || "";
    const open = SA.openNow();
    await SA.alert(cfg, { phone: digits, name: profileName, last: lastAsk, open }).catch((e) => console.error("wa: staff ask", e && e.message));
    const said = SA.reply(open);
    h0.push({ u: text, a: said });
    await saveHistory(cfg, sk, h0);
    return respond(said);
  }

  if (process.env.WA_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY) {
    return respond(FALLBACK_REPLY);
  }

  // Two or three messages in one breath get one answer. "Hair fall" and
  // "Dandruff" a second apart used to get two replies, and "Dermaluxe" + "?"
  // two identical greetings — 177 times in the fortnight to 14 Nov. Each
  // plain text message waits a moment; if the patient has written again it
  // stays quiet, and the newest one answers all of them together.
  if (isMeta && cfg && loggedAt && text && !imageId && !audioId && !videoId && !docId) {
    try {
      const mg = await mergeBurst(cfg, digits, loggedAt, text);
      if (mg.later) return res.status(200).json({ ok: true, merged: true });
      if (mg.text) text = mg.text;
    } catch (e) { console.error("wa: merge", e && e.message); }
  }

  const histKey = `wa:h:${digits}`;
  const hist = cfg ? await getHistory(cfg, histKey) : [];
  const firstTurn = hist.length === 0;

  // Keyword campaigns ("Reply GLOW" CTAs on posts): single-word matches get the
  // campaign offer directly and count the hit; Claude sees it in history after.
  if (cfg && !imageId && !audioId) {
    const kw = text.trim().toLowerCase();
    if (/^[a-z0-9]{2,16}$/.test(kw)) {
      try {
        const c = await guard.kvCommand(cfg, ["GET", `camp:${kw}`]);
        if (c && c.result) {
          const camp = JSON.parse(c.result);
          const hitKey = `camphit:${kw}:${guard.today()}`;
          try {
            const n = await guard.kvCommand(cfg, ["INCR", hitKey]);
            if (Number(n.result) === 1) await guard.kvCommand(cfg, ["EXPIRE", hitKey, "7776000"]);
          } catch (e) {}
          hist.push({ u: `[campaign ${kw}] ` + text, a: camp.reply });
          await saveHistory(cfg, histKey, hist);
          return respond(camp.reply);
        }
      } catch (e) {}
    }
  }
  // "Services" / "menu": the treatment list, tappable — no model turn needed.
  if (isMeta && cfg && !imageId && !audioId && MENU_ASK.test(text)) {
    await sendCloudMenu(cloud.phoneNumberId, cloud.to, cfg);
    hist.push({ u: text, a: "[Treatment menu list pampanu — patient okati tap chesthe aa treatment gurinchi explain cheyi, tarvata concern/slot ki move avvu]" });
    await saveHistory(cfg, histKey, hist);
    await logOut("🗂 Treatments list");
    return res.status(200).json({ ok: true, menu: true });
  }
  // Returning patient? (24h chat history gone, but the 180-day profile remains)
  const profile = firstTurn ? await getProfile(cfg, digits) : null;
  const apptLine = await apptCtx(cfg, digits);
  // Academy chat, or an enrolled student? Decided before anything
  // patient-shaped is added (owner, 13 Nov: "academy lead ki academy
  // cheppali" — see _acadmode.js).
  const AM = require("./_acadmode.js");
  let acadStudent = null, acadAd = null;
  if (cfg) {
    try {
      const idr = await guard.kvCommand(cfg, ["GET", `acad:ph:${digits}`]).catch(() => ({}));
      if (idr && idr.result) { const sr = await guard.kvCommand(cfg, ["GET", `acad:st:${idr.result}`]).catch(() => ({})); acadStudent = sr && sr.result ? JSON.parse(sr.result) : null; }
    } catch (e) {}
    try { const ar = await guard.kvCommand(cfg, ["GET", `ad:ref:${digits}`]).catch(() => ({})); acadAd = ar && ar.result ? JSON.parse(ar.result) : null; } catch (e) {}
  }
  let acad = AM.detect({ text, hist, student: acadStudent, ad: acadAd });
  // non-empty = an academy enquiry, where fees may be said. A student is not
  // being sold a seat, so the seat count stays out of their chat.
  const acadLine = acad === "student" ? "" : await academyCtx(cfg, hist, acad === "lead" ? "academy" : text);
  let extraCtx = nowIstCtx() + apptLine + acadLine + (profile && profile.name
    ? `[returning patient — name: ${profile.name}${profile.concern ? ", last concern: " + profile.concern : ""}] `
    : "");
  // What the qualifier already knows (how far they are, what is still unasked),
  // where the chat came from, and whether this "message" is Meta's ad prefill
  // rather than the patient's own words.
  let known = "", adLead = "";
  if (cfg) {
    // Somebody the clinic has already treated is not a stranger.
    known = await memory.contextLine(cfg, digits).catch(() => "");
    extraCtx += known;
    const qrec0 = await qualify.read(cfg, digits);
    if (qrec0) extraCtx += qualify.contextLine(qrec0);
    // This person's goal, from what the desk and the qualifier already know.
    try {
      const lr = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]).catch(() => ({}));
      let last = null;
      for (const x of ((lr && lr.result) || [])) { try { const l = JSON.parse(x); if (String(l.phone || "").replace(/\D/g, "").slice(-10) === digits) { last = l; break; } } catch (e) {} }
      const lk = last ? `${last.ts}|${digits}` : "";
      const [stR, ocR] = lk ? await Promise.all([guard.kvCommand(cfg, ["HGET", "dl_status", lk]).catch(() => ({})), guard.kvCommand(cfg, ["HGET", "dl_outcome", lk]).catch(() => ({}))]) : [{}, {}];
      const f0 = (qrec0 && qrec0.facts) || {};
      if (!acad) acad = AM.detect({ text, hist, concern: (last && last.concern) || f0.problem || "", type: last && last.type, ad: acadAd });
      const g = require("./_goal.js").goalFor({
        concern: acad === "lead" ? "Academy course enquiry" : (last && last.concern) || f0.problem || "", type: last && last.type, km: qrec0 ? qrec0.km : null, intent: f0.intent,
        status: stR && stR.result, outcome: ocR && ocR.result, booked: !!apptLine, treatedBefore: !!known,
        name: (last && last.name) || f0.name || (profile && profile.name) || "", slot: last && (last.slot || last.date),
      });
      // A student has no sales goal — the student line below says what to do.
      if (acad !== "student") extraCtx += require("./_goal.js").contextLine(g);
      // Concern known, town known, no appointment yet: this reply offers the
      // slots. The ladder's third rung is the town, and on 8 Nov the agent
      // learned it and then asked another question instead of a time.
      const concernKnown = !!((last && last.concern) || f0.problem);
      const townKnown = !!(qrec0 && (qrec0.km != null || qrec0.place || f0.village || f0.place));
      // Not for a job seeker: on 13 Nov one finished her application, said
      // "Ok", and was offered "Repu 11:30 AM" — which she took for an interview.
      const slotsFit = ["clinic_consult", "video_consult", "ht_consult", "return_visit"].includes(g.key);
      if (!acad && slotsFit && hist.length >= 2 && concernKnown && townKnown && !/upcoming appointment/.test(apptLine)) extraCtx += '[OFFER SLOTS NOW — concern and town are known; put 6-9 "slots" in this reply] ';
    } catch (e) {}
    const ar0 = await guard.kvCommand(cfg, ["GET", `ad:ref:${digits}`]).catch(() => ({}));
    try {
      const ref0 = ar0 && ar0.result ? JSON.parse(ar0.result) : null;
      if (ref0 && ref0.headline) {
        extraCtx += `[came from our ad: "${ref0.headline}"] `;
        adLead = adConcern(ref0.headline);
        // The first replies of an ad conversation: the concern is known, go for the slot.
        if (adLead && adLead !== "academy" && hist.length < 3) extraCtx += `[AD LEAD — concern from the ad: ${adLead}. Do not ask what concern; confirm it in one line and ask how long / offer slots. A slot within 3 replies.] `;
      }
    } catch (e) {}
  }
  extraCtx += AM.line(acad, acadStudent);
  if (lint.isMetaPrefill(text)) extraCtx += acad
    ? "[This is Meta's click-to-WhatsApp prefill from an Academy ad or post, not their own words — reply in Tenglish about the DermaLuxe Academy course and ask their name; do not ask about a skin or hair concern] "
    : adLead && adLead !== "academy"
    ? `[This is Meta's click-to-WhatsApp prefill, not the patient's words — reply in Tenglish, own the concern "${adLead}" from the ad in one warm line, do not ask what concern they have] `
    : "[This is Meta's click-to-WhatsApp prefill, not the patient's words — reply in Tenglish and ask what concern they have] ";

  const ownerRules = cfg ? await rules.block(cfg).catch(() => "") : "";
  // Two openers, running side by side on the same day's ads. The first line
  // is the one thing every later number hangs off, and until now it changed
  // with no way to tell whether it had helped.
  const ab = require("./_abtest.js");
  let abLine = "";
  // The openers are patient lines ("mee problem cheppandi", "consultation
  // free") — an Academy chat or a student gets none of them, and is not
  // counted in the test.
  if (cfg && firstTurn && !acad) { try { abLine = await ab.opener(cfg, digits); } catch (e) {} }
  else if (cfg) { try { await ab.note(cfg, digits, "reply"); } catch (e) {} }
  // The opener asks "mee problem cheppandi". To "Hi" that is right. To "How
  // many sessions are required?" or "Private parts ki laser vintundha" it
  // was glued on in front of the answer, asking for what they had just said.
  // Then only the greeting goes first and the question is answered.
  // An ad that already named the concern counts as said, too.
  const greetOnly = !(adLead && adLead !== "academy")
    && (String(text || "").split(/\n+/).every((l) => GREET_ONLY.test(l.trim())) || lint.isMetaPrefill(text));
  const abRule = !abLine ? ""
    : greetOnly ? `\n\nOPENER: start this reply with exactly this line, then carry on as usual:\n${abLine}`
    : `\n\nOPENER: their first message already says what they want. Start with only "Namaste 🙏 DermaLuxe by Medicare nunchi" and answer what they asked straight away — do not ask what their problem is.`;
  // Would they rather listen? A voice note in, a request in words, or a
  // preference they set earlier (a month) — then the reply is spoken too.
  let speak = !!audioId;
  if (cfg && !audioId) {
    if (VOICE_ASK.test(text)) { speak = true; await guard.kvCommand(cfg, ["SET", `wa:voice:${digits}`, "1", "EX", String(30 * 86400)]).catch(() => {}); }
    else { const vp = await guard.kvCommand(cfg, ["GET", `wa:voice:${digits}`]).catch(() => ({})); speak = !!(vp && vp.result); }
  }
  const fast = !imageId && !audioId && isSimpleTurn(text);
  const t0 = Date.now();
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
      out = await askClaudeVision(hist, media, text, profileName, extraCtx, ownerRules + abRule);
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
      out = await askClaude(hist, text, profileName, speak ? extraCtx + VOICE_CTX : extraCtx, ownerRules + abRule, fast ? { model: FAST_MODEL() } : undefined);
      if (speak) {
        // Pull the TTS script line out of the visible reply.
        const vm = String(out.reply || "").match(/\n?\s*VOICE_SCRIPT\s*:\s*([\s\S]+?)\s*$/);
        if (vm) {
          voiceScript = vm[1].trim().slice(0, 450);
          out.reply = String(out.reply).slice(0, vm.index).trim() || FALLBACK_REPLY;
        }
      }
      if (audioId) text = "[🎤] " + text;
      // The model itself noticed they would rather listen.
      if (out.voice === true && cfg && !speak) { speak = true; await guard.kvCommand(cfg, ["SET", `wa:voice:${digits}`, "1", "EX", String(30 * 86400)]).catch(() => {}); }
    }
  } catch (e) {
    console.error("wa: ai error", e && e.message);
    // The clinic-card fallback goes once per phone per two hours. When the AI
    // account ran dry on 7 Nov (15:28–16:50) every message from the same four
    // patients was answered with the same card; the second and later ones
    // are answered to Meta only, and _rescue has already alerted the team.
    const first = cfg ? await guard.kvCommand(cfg, ["SET", `wa:fb:${digits}`, "1", "NX", "EX", "7200"]).catch(() => ({})) : { result: "OK" };
    if (first && first.result) return respond(FALLBACK_REPLY);
    return isMeta ? res.status(200).json({ ok: true, muted: true }) : twiml(res, "");
  }

  // The opener. On 9 Nov, 10 of 40 chats stopped at the first reply, which
  // asked "which language?" with Telugu / English / Hindi buttons. A bare
  // greeting is now answered with one question about the concern, and these
  // three buttons ride on it whether or not the model remembered them.
  if (firstTurn && fast && !(Array.isArray(out.buttons) && out.buttons.length)) out.buttons = ["Skin", "Hair", "📅 Book Now"];

  // Save what the agent learned, re-score, tell the desk if it just became an A.
  let qrec = null;
  if (cfg) {
    try {
      const im = await inbox.meta(cfg, digits);
      const oo = await guard.setHas(cfg, "optout", digits);
      qrec = await qualify.absorb(cfg, digits, out.qual || {}, { inboundCount: (im && im.inCount) || hist.length + 1, photo_sent: !!imageId, opted_out: oo, channel: "whatsapp",
        status: /last visit|came \d+ times/.test(known) ? "visited" : undefined });   // a patient who has been here is graded as one
      await qualify.react(cfg, digits, qrec, { name: (out.lead && out.lead.name) || profileName });
    } catch (e) { console.error("wa: qualify", e && e.message); }
    // The editor: a deterministic read of the reply before it goes out.
    try { out = await lint.check(cfg, out, text, hist.slice(-3).map((t) => t.a), { profileName, channel: "wa", analysis: !!imageId, booked: /appointment/i.test(apptLine) }); }
    catch (e) { console.error("wa: lint", e && e.message); }
    // The hard price block (owner, 9 Nov), after the editor: a treatment price
    // of ₹500 or more leaves the reply with its sentence, text and photo
    // replies alike. The owner's "bands" policy and an academy enquiry (its
    // fees are published) are the two cases where a number may stand.
    try {
      const pol = await require("./_prices.js").load(cfg);
      if (pol.mode !== "bands" && !acadLine) {
        const allow = new Set(pol.mode !== "none" && pol.consult ? [pol.consult] : []);
        // The closing line names the consultation fee only when the policy
        // has one, and never for a hair transplant chat — that assessment is
        // the owner's own package offer and the brief says what it costs.
        const ht = adLead === "hair transplant" || /transplant|graft|\bfue\b|\bdhi\b/i.test(String(out.reply || "") + " " + text);
        const fee = !ht && pol.mode !== "none" && pol.consult ? pol.consult : 0;
        const cut = lint.stripTreatmentPrices(out.reply, { allow, fee });
        if (cut.removed.length) { console.log("wa: price removed", digits.slice(-4), cut.removed.join(",")); out.reply = cut.reply; }
        // The spoken reply is cut out of the text before the editor runs, so
        // it needs the same block — or the patient hears the price the text
        // no longer carries.
        if (voiceScript) {
          const vc = lint.stripTreatmentPrices(voiceScript, { allow, fee });
          if (vc.removed.length) { console.log("wa: price removed (voice)", digits.slice(-4)); voiceScript = vc.reply; }
        }
      }
    } catch (e) { console.error("wa: price block", e && e.message); }
  }

  let justBooked = 0;
  // The model said a slot is held but sent no time with it: read the slot from
  // the patient's own words, so the booking reaches the desk (7 Nov, Prasanthi).
  // Then from the reply itself, when it names exactly one time and says it is
  // done — between 6 and 11 Nov five more patients were told "slot hold
  // chesanu" with no booking behind it, because the time had been picked a
  // message earlier ("Location ekda" → "*Repu 11:30 AM* slot hold chesanu").
  try {
    const sp = require("./_slotparse.js");
    if (sp.HELD.test(String(out.reply || "")) && !(out.lead && out.lead.slot_ts)) {
      const ts = sp.parseSlot(text) || sp.slotInReply(out.reply);
      if (ts) {
        let prev = null;
        const lr = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "99"]).catch(() => ({}));
        for (const x of ((lr && lr.result) || [])) { try { const l = JSON.parse(x); if (String(l.phone || "").replace(/\D/g, "").slice(-10) === digits) { prev = l; break; } } catch (e) {} }
        out.lead = Object.assign({ name: (prev && !/\(WhatsApp peru\)|peru cheppaledu/.test(prev.name || "") && prev.name) || "", concern: (prev && prev.concern) || "Consultation", heat: "hot" }, out.lead || {}, { slot: text.slice(0, 40), slot_ts: ts });
        console.log("wa: slot read from the chat (no slot_ts)", digits.slice(-4), ts);
      }
    }
  } catch (e) {}
  if (out.lead && (out.lead.name || out.lead.slot_ts || out.lead.date || out.lead.slot)) {
    try {
      const st = await storeLead(cfg, Object.assign({}, out.lead, { profile: profileName }), digits, text);
      justBooked = (st && st.bookedAt) || 0;
    } catch (e) {}
  }
  if (justBooked && cfg) {
    // Meta learns who actually fixes a slot, not who merely says hello — and
    // the scoreboard learns how many replies a booking took, ad vs organic.
    const eventId = "sch-" + crypto.createHash("sha256").update(`${digits}|${justBooked}`).digest("hex").slice(0, 24);
    capi.send("Schedule", { phone: digits, eventId, custom: { content_name: String((out.lead && out.lead.concern) || "").slice(0, 60), source: adLead ? "ad" : "organic" } }).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", "ttb:log", JSON.stringify({ ts: Date.now(), ph: digits.slice(-4), turns: hist.length + 1, ad: !!adLead, known: !!known, at: justBooked })]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "ttb:log", "0", "999"]).catch(() => {});
    try { await require("./_abtest.js").note(cfg, digits, "booked"); } catch (e) {}
  }
  // Cancellation works even when the lead JSON came without a name.
  if (out.lead && out.lead.cancel === true) {
    try { await cancelAppt(cfg, digits, (out.lead && out.lead.name) || profileName || ""); } catch (e) {}
  }

  // 🚨 Medical urgency the model flagged → wake the care team immediately.
  // One alert per patient per 2h so a long worried chat can't spam the team.
  if (out.urgent) {
    try {
      let go = true;
      if (cfg) {
        const nx = await guard.kvCommand(cfg, ["SET", `ntf:urg:${digits}`, "1", "NX", "EX", "7200"]).catch(() => ({}));
        go = !!(nx && nx.result);
      }
      if (go) {
        const team = Array.from(new Set(
          String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666").split(",")
            .concat(guard.ownerPhones())
            .map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10)));
        const who = (out.lead && out.lead.name) || profileName || "Patient";
        try {
          const push = require("./_push.js");
          if (push.enabled()) await push.notifyCap(cfg, "leads.view", {
            title: `🚨 Urgent — ${who}`,
            body: `${String(out.urgent).slice(0, 120)} · ${digits}`,
            tab: "leads", urgent: true, data: { kind: "urgent", phone: digits },
          });
        } catch (e) { console.error("push: urgent", e && e.message); }
        const body = `🚨 *URGENT — patient ki ventane call cheyandi!*\n\n👤 ${who}\n📱 ${digits}\n⚠️ ${String(out.urgent).slice(0, 200)}\n\n💬 "${String(text).slice(0, 160)}"\n\nAgent vaalliki clinic number ichhindi — kaani mana nunchi call vellite better 🙏`;
        for (const to of team) await notify.teamSend(cfg, to, body).catch(() => {});
      }
    } catch (e) { console.error("wa: urgent alert", e && e.message); }
  }
  out.reply = facts.withAiLine(out.reply, firstTurn);
  if (cfg) {
    hist.push({ u: text, a: out.reply });
    await saveHistory(cfg, histKey, hist);
  }
  await logOut(out.reply);

  if (isMeta) {
    // How long they waited, for the weekly (fast turns and full ones apart).
    if (cfg) {
      await guard.kvCommand(cfg, ["LPUSH", "wa:lat", JSON.stringify({ ts: Date.now(), ms: Date.now() - t0, fast })]).catch(() => {});
      await guard.kvCommand(cfg, ["LTRIM", "wa:lat", "0", "1999"]).catch(() => {});
    }
    // Voice note in → voice note out; and whoever asked to listen (text still follows as the readable copy).
    if (speak) {
      try {
        const mp3 = await synthesizeVoice(voiceScript || stripForTts(out.reply).slice(0, 350), cfg);
        if (mp3) await sendCloudVoice(cloud.phoneNumberId, cloud.to, mp3);
      } catch (e) { console.error("wa: voice reply error", e && e.message); }
    }
    // The AI's tappable slot list or choice buttons ride along with the reply.
    // A first reply with neither gets the quick menu. Until 9 Nov the quick
    // menu won on every first reply, so the opener's Skin / Hair / Book Now
    // buttons (and a first-turn slot list) would never have reached the phone.
    if (Array.isArray(out.slots) && out.slots.length) await sendCloudSlotList(cloud.phoneNumberId, cloud.to, out.reply, out.slots);
    else if (Array.isArray(out.buttons) && out.buttons.length) await sendCloudDynButtons(cloud.phoneNumberId, cloud.to, out.reply, out.buttons);
    else if (firstTurn && !imageId) await sendCloudButtons(cloud.phoneNumberId, cloud.to, out.reply);
    else await sendCloud(cloud.phoneNumberId, cloud.to, out.reply);
    // Fresh booking + UPI configured → optional advance ask (cuts no-shows).
    // Off until UPI_VPA env is set; amount via ADVANCE_AMOUNT (default 200).
    // With Razorpay set up the link locks the slot by itself when it is paid
    // (pay-hook); the UPI text below is the fallback that needs a "PAID" reply.
    let advLink = null;
    if (justBooked && Number(process.env.ADVANCE_AMOUNT || 200) > 0 && require("./_pay.js").rzpOn()) {
      const amt = Number(process.env.ADVANCE_AMOUNT || 200);
      advLink = await require("./_pay.js").advanceLink(cfg, { phone: digits, name: (out.lead && out.lead.name) || profileName, at: justBooked, amount: amt }).catch(() => null);
      if (advLink) {
        await sendCloud(cloud.phoneNumberId, cloud.to,
          `💳 *Slot lock cheyalante (optional):*\n₹${amt} advance — mee visit bill lo adjust avutundi 👍\n\n👉 ${advLink}\n(GPay / PhonePe / card — 1 nimisham)\n\nPay ayina ventane mee slot automatic ga CONFIRM avutundi ✅`);
        if (cfg && hist.length) {
          hist[hist.length - 1].a += "\n[Advance payment link pampanu — pay chesthe slot automatic ga confirm avutundi ani cheppu; PAID ani adagakkarledu]";
          await saveHistory(cfg, histKey, hist);
        }
      }
    }
    if (justBooked && !advLink && process.env.UPI_VPA && Number(process.env.ADVANCE_AMOUNT || 200) > 0) {
      const amt = Number(process.env.ADVANCE_AMOUNT || 200);
      const vpa = process.env.UPI_VPA.trim();
      const payee = encodeURIComponent(process.env.UPI_PAYEE || "DermaLuxe by Medicare");
      await sendCloud(cloud.phoneNumberId, cloud.to,
        `💳 *Slot lock cheyalante (optional):*\n₹${amt} advance pay cheyochu — mee visit bill lo adjust avutundi 👍\n\n📲 UPI ID: *${vpa}*\n(GPay / PhonePe / Paytm)\nupi://pay?pa=${encodeURIComponent(vpa)}&pn=${payee}&am=${amt}&cu=INR&tn=DermaLuxe%20advance\n\nPay ayyaka *PAID* ani reply cheyandi ✅`);
      if (cfg && hist.length) {
        hist[hist.length - 1].a += "\n[Booking advance UPI request pampanu — patient PAID ante thank + team verify chestaru ani cheppu]";
        await saveHistory(cfg, histKey, hist);
      }
    }
    // Map pin when the patient asked where we are (Claude flag or keyword).
    if (out.send_location === true || LOCATION_ASK.test(text)) {
      await sendCloudLocation(cloud.phoneNumberId, cloud.to);
    }
    // Before/after proof used to go out here. NMC 8.1(v) forbids displaying
    // "before and after" photographs for promotion, and 6.2 says the patient's
    // consent does not make it permissible, so nothing is sent. The agent is
    // told (in _facts.js) to answer the question honestly in words instead.
    //
    // The patient hesitated: the doctor's card with her qualifications, once a week.
    if (cfg && (out.trust === true || trust.hesitant(text)) && !imageId) {
      try {
        const base = `https://${String(req.headers["x-forwarded-host"] || req.headers.host || "www.dermaluxe.ai")}`;
        const want = (out.qual && out.qual.problem) || (out.lead && out.lead.concern) || (profile && profile.concern) || adLead || "";
        const tp = await trust.send(cfg, digits, { concern: want });
        if (tp.sent && hist.length) {
          hist[hist.length - 1].a += "\n[Doctor card pampanu — malli describe cheyyaku, slot question meeda focus]";
          await saveHistory(cfg, histKey, hist);
        }
      } catch (e) { console.error("wa: trust pack", e && e.message); }
    }
    // Academy enquiry → course catalog PDF (once per number).
    if (acad !== "student") { try { await maybeSendCatalog(cfg, cloud, out, text); } catch (e) { console.error("wa: catalog send", e && e.message); } }
    // Enrolled student wrote to us → hand over any material we could not deliver earlier.
    try { await flushPendingMaterial(cfg, cloud); } catch (e) { console.error("wa: pending", e && e.message); }
    return res.status(200).json({ ok: true });
  }
  return twiml(res, out.reply);
};
module.exports.confirmAppt = confirmAppt;
module.exports.askClaude = askClaude;
module.exports.recordRating = recordRating;
module.exports.nowIstCtx = nowIstCtx;
