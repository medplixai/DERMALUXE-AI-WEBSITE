// POST /api/chat — the website chat widget's brain.
// { sid, message } → { reply, buttons?, done? }
//
// Same clinic brain as the WhatsApp/Instagram agents, minus anything that
// needs a messaging platform (no media, no map pins, no templates). The
// visitor has no phone number attached, so a lead only counts once they give
// name + mobile — until then we keep chatting and asking.
// Guarded by the origin allowlist + per-IP and global daily caps.
const guard = require("./_guard.js");
const facts = require("./_facts.js");
const clinic = require("./_clinic.js");
const notify = require("./_notify.js");

const LIST_KEY = "dl_leads";
const HIST_TTL = 7200; // 2h — website sessions are short
const MAX_TURNS = 8;

const WEB_RULES = `- This is the website chat widget on dermaluxe.ai — the visitor is already on our site, so keep it short and helpful.
- We do NOT have their phone number here. A booking is complete ONLY when you have name + 10-digit mobile + concern. Ask for the mobile naturally ("mee mobile number cheppandi, mana team confirm chesi call chestundi") — never demand it upfront.
- Fill "lead" ONLY when you have name AND a 10-digit phone; otherwise "lead" must be null (keep collecting in the reply).
- No photo analysis here — for that, point them to the FREE AI Skin & Hair Analysis section on this same page (say "paina AI Analysis section lo photo upload cheyandi").
- For a live chat with photos/voice, invite them to WhatsApp: wa.me/919959134666
- TAPPABLE CHIPS: when your reply offers choices, add "buttons": up to 3 short options (each ≤22 chars, patient's language) — they render as clickable chips.

OUTPUT FORMAT — respond with ONLY minified JSON, no markdown:
{"reply":"<your reply>","lead":null}
or when name + mobile + concern are known:
{"reply":"...","lead":{"name":"...","phone":"<10 digits>","concern":"...","date":"<if given>","slot":"<if given>","heat":"hot|warm|cold","call_prep":"<2 short Tenglish lines for our follow-up call>"}}
Optionally add "buttons":["option1","option2"].`;

const CLINIC_FACTS = facts.clinicFacts("website chat", WEB_RULES);

function nowIstCtx() {
  const d = new Date(Date.now() + 330 * 60000);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getUTCHours();
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `[Now: ${days[d.getUTCDay()]} ${d.getUTCDate()} ${mo[d.getUTCMonth()]}, ${h}:${min} ${ap} IST] `;
}

async function storeLead(cfg, info, sid, lastMsg) {
  const phone = String(info.phone || "").replace(/\D/g, "").slice(-10);
  const name = String(info.name || "").slice(0, 80).trim();
  if (!name || phone.length !== 10) return false;
  const lead = {
    ts: Date.now(),
    type: "website_chat",
    name, phone,
    age: "", gender: "",
    concern: String(info.concern || "").slice(0, 120),
    message: String(lastMsg || "").slice(0, 400),
    mode: "", date: String(info.date || "").slice(0, 20), slot: String(info.slot || "").slice(0, 60),
    skin_score: null, hair_score: null, skin_age: null, skin_type: "",
    treatments: [],
    page: "website-chat",
    heat: ["hot", "warm", "cold"].indexOf(String(info.heat || "").toLowerCase()) !== -1 ? String(info.heat).toLowerCase() : "",
    call_prep: String(info.call_prep || "").slice(0, 220),
    src_id: sid,
  };
  if (cfg) {
    try { // one lead per session — replace the earlier, thinner copy
      const recent = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", "29"]);
      for (const s of (recent.result || [])) {
        try {
          const l = JSON.parse(s);
          if (l.type === "website_chat" && l.src_id === sid) await guard.kvCommand(cfg, ["LREM", LIST_KEY, "1", s]);
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
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!guard.originAllowed(req)) return res.status(403).json({ error: "Unauthorized request origin" });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const sid = String(body.sid || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  const message = String(body.message || "").trim().slice(0, 600);
  if (!sid || !message) return res.status(400).json({ error: "Bad request" });

  const cfg = guard.kvConfig();
  const ip = guard.getIp(req);
  const perIp = await guard.rateLimit(cfg, `rl:web:${ip}`, 30, 3600);
  if (!perIp.allowed) return res.status(200).json({ reply: "Konchem sepu aagi malli try cheyandi 🙏 Ventane matladalante WhatsApp: wa.me/919959134666" });
  const globalCap = await guard.rateLimit(cfg, `rl:web:g:${guard.today()}`, 500, 90000);
  if (!globalCap.allowed || !process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ reply: facts.FALLBACK_REPLY });
  }

  const histKey = `web:h:${sid}`;
  let hist = [];
  if (cfg) {
    try {
      const r = await guard.kvCommand(cfg, ["GET", histKey]);
      hist = r.result ? JSON.parse(r.result) : [];
    } catch (e) {}
  }

  const messages = [];
  hist.forEach((t) => {
    messages.push({ role: "user", content: t.u });
    messages.push({ role: "assistant", content: t.a });
  });
  messages.push({ role: "user", content: nowIstCtx() + message });

  let out;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "claude-opus-5",
        max_tokens: 1000,
        system: CLINIC_FACTS,
        messages,
      }),
    });
    if (!resp.ok) throw new Error("claude HTTP " + resp.status);
    const data = await resp.json();
    const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
    try {
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : text);
      out = parsed && typeof parsed.reply === "string" ? parsed : null;
    } catch (e) { out = null; }
    if (!out) out = { reply: facts.salvageReply(text) || facts.FALLBACK_REPLY, lead: null };
  } catch (e) {
    console.error("chat: ai error", e && e.message);
    return res.status(200).json({ reply: facts.FALLBACK_REPLY });
  }

  let captured = false;
  if (out.lead && out.lead.name && out.lead.phone) {
    try { captured = await storeLead(cfg, out.lead, sid, message); } catch (e) {}
  }
  if (cfg) {
    hist.push({ u: message, a: out.reply });
    try {
      await guard.kvCommand(cfg, ["SET", histKey, JSON.stringify(hist.slice(-MAX_TURNS)), "EX", String(HIST_TTL)]);
    } catch (e) {}
  }

  return res.status(200).json({
    reply: out.reply,
    buttons: Array.isArray(out.buttons) ? out.buttons.slice(0, 3).map((b) => String(b).slice(0, 24)) : [],
    captured,
  });
};
