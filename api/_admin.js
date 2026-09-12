// Owner/admin commands for the WhatsApp agent (allowlisted numbers only).
//   help                     – command list
//   insta report             – IG followers + last posts + boost suggestion
//   leads report [today|week]– lead pipeline summary
//   [photo] post: <idea>     – AI caption → preview → "ok" publishes to IG
// Not a command → returns null and the normal patient flow continues.
const crypto = require("crypto");
const guard = require("./_guard.js");
const weekly = require("./_weekly.js");
const notify = require("./_notify.js");
const hrmod = require("./_hr.js");
const referral = require("./_referral.js");

const IG_GRAPH = "https://graph.instagram.com/v21.0";

// Two tiers: ADMIN_PHONES = owner (everything), MARKETING_PHONES = staff —
// can post/schedule and see stats, but never boost/budget talk ("entha money
// pettam" is owner-only by request).
function adminRole(digits) {
  const norm = (v) => String(v || "").split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter(Boolean);
  if (norm(process.env.ADMIN_PHONES).indexOf(String(digits)) !== -1) return "owner";
  if (norm(process.env.MARKETING_PHONES).indexOf(String(digits)) !== -1) return "marketing";
  if (norm(process.env.HR_PHONES).indexOf(String(digits)) !== -1) return "hr";
  return null;
}
function isAdmin(digits) {
  return adminRole(digits) !== null;
}

// IG-login token: KV-refreshed copy wins, env fallback (mirror of instagram.js).
async function igToken(cfg) {
  try {
    if (cfg) {
      const r = await guard.kvCommand(cfg, ["GET", "ig:ltok"]);
      if (r && r.result) return r.result;
    }
  } catch (e) {}
  return process.env.IG_LOGIN_TOKEN || null;
}

async function igGet(path, tok) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${IG_GRAPH}${path}${sep}access_token=${encodeURIComponent(tok)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ig ${path.split("?")[0]} HTTP ${r.status}: ${JSON.stringify(d).slice(0, 120)}`);
  return d;
}

async function instaReport(cfg, showBoost) {
  const tok = await igToken(cfg);
  if (!tok) return "IG token ledu — Instagram agent setup check cheyandi.";
  const me = await igGet("/me?fields=username,followers_count,media_count", tok);
  const media = await igGet("/me/media?fields=id,caption,media_type,like_count,comments_count,timestamp,permalink&limit=5", tok);
  const posts = (media.data || []);
  let lines = [`📊 *Instagram Report* — @${me.username}`,
    `👥 Followers: ${me.followers_count} · 📸 Posts: ${me.media_count}`, ""];
  let best = null, bestScore = -1;
  posts.forEach((p, i) => {
    const score = (p.like_count || 0) + 2 * (p.comments_count || 0);
    if (score > bestScore) { bestScore = score; best = p; }
    const when = String(p.timestamp || "").slice(0, 10);
    const cap = String(p.caption || "(no caption)").replace(/\n/g, " ").slice(0, 40);
    lines.push(`${i + 1}. ${when} · ❤️ ${p.like_count || 0} · 💬 ${p.comments_count || 0}\n   ${cap}…`);
  });
  if (best && showBoost) {
    lines.push("", `🚀 *Boost suggestion*: post #${posts.indexOf(best) + 1} (best engagement).`,
      `IG app lo aa post → Boost — 2 taps!`);
  }
  if (!posts.length) lines.push("(no posts yet)");
  return lines.join("\n");
}

async function leadsReport(cfg, text) {
  if (!cfg) return "Lead storage not configured.";
  const week = /week/i.test(text);
  const since = Date.now() - (week ? 7 : 1) * 86400000;
  const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]);
  const leads = (r.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
    .filter((l) => l && l.ts >= since);
  const by = {};
  leads.forEach((l) => { by[l.type] = (by[l.type] || 0) + 1; });
  const label = week ? "Last 7 days" : "Today";
  let lines = [`📋 *Leads — ${label}*: ${leads.length}`];
  Object.keys(by).forEach((t) => lines.push(`• ${t}: ${by[t]}`));
  leads.slice(0, 6).forEach((l) => {
    lines.push(`— ${l.name || "?"} (${l.phone || "no phone"}) · ${String(l.concern || "").slice(0, 30)}`);
  });
  if (!leads.length) lines.push("(no leads in this period)");
  lines.push("", "Full dashboard: dermaluxe.ai/leads.html");
  return lines.join("\n");
}

// Caption writer (uses the photo for context when available).
const CAPTION_SYSTEM = `You write Instagram captions for DermaLuxe by Medicare — premium skin/hair/aesthetics clinic, Eluru (MD dermatologists, USFDA tech). Style: premium yet warm; 3-6 short lines; English with a Telugu line; NEVER prices; end with CTA "📲 Book: 99591 34666 (WhatsApp) · www.dermaluxe.ai" then 6-9 hashtags mixing #DermaLuxe #DermaLuxeEluru #EluruSkinClinic #skincare + topic tags. Output ONLY JSON: {"caption":"..."}`;

async function captionCall(content) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-opus-5",
      max_tokens: 600,
      system: CAPTION_SYSTEM,
      messages: [{ role: "user", content }],
    }),
  });
  if (!resp.ok) throw new Error(`claude HTTP ${resp.status}`);
  const data = await resp.json();
  const t = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
  try { const m = t.match(/\{[\s\S]*\}/); const p = JSON.parse(m ? m[0] : t); if (p && p.caption) return String(p.caption).slice(0, 2000); } catch (e) {}
  return t.slice(0, 2000);
}

async function writeCaption(idea, imageB64, mime) {
  const content = [];
  if (imageB64) content.push({ type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: imageB64 } });
  content.push({ type: "text", text: `Post idea from the clinic owner: ${idea || "(none — describe the photo)"}` });
  return captionCall(content);
}

// Applies a marketing-team correction ("change: telugu line ekkuva pettu",
// "add: 20% off this week") to the pending caption.
async function reviseCaption(current, instruction) {
  return captionCall([{ type: "text",
    text: `Current Instagram caption:\n${current}\n\nTeam's correction/addition request (may be Tenglish): ${instruction}\n\nRewrite the caption applying this request. Keep every style rule.` }]);
}

// Previews return {text, confirm:true} — the WhatsApp layer follows the text
// with tappable ✅/✏️/❌ buttons (typed ok / change: / cancel still work).
const PREVIEW_OPTIONS = "✅ *ok* · ✏️ *change: <correction>* · ❌ *cancel*";
const confirmable = (text) => ({ text, confirm: true });

// IST helpers for the scheduler.
const IST_MS = 330 * 60000;
function parseWhen(s) {
  let rest = String(s || "").trim().toLowerCase();
  const nowIst = new Date(Date.now() + IST_MS);
  let day = null, m;
  if ((m = rest.match(/^(today|ivala)\s+/))) { day = 0; rest = rest.slice(m[0].length); }
  else if ((m = rest.match(/^(tomorrow|repu|reppu)\s+/))) { day = 1; rest = rest.slice(m[0].length); }
  else if ((m = rest.match(/^(\d{1,2})[-\/](\d{1,2})\s+/))) { day = { d: +m[1], mo: +m[2] }; rest = rest.slice(m[0].length); }
  const tm = rest.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!tm) return null;
  let h = +tm[1]; const min = +(tm[2] || 0); const ap = tm[3];
  if (h > 12 || min > 59) return null;
  if (h === 12) h = ap === "am" ? 0 : 12; else if (ap === "pm") h += 12;
  const t = new Date(nowIst);
  t.setUTCHours(h, min, 0, 0); // getUTC* on the shifted date = IST wall clock
  if (day === 1) t.setUTCDate(t.getUTCDate() + 1);
  else if (day && typeof day === "object") {
    t.setUTCMonth(day.mo - 1, day.d);
    if (t.getTime() <= nowIst.getTime()) t.setUTCFullYear(t.getUTCFullYear() + 1);
  } else if (t.getTime() <= nowIst.getTime()) t.setUTCDate(t.getUTCDate() + 1);
  return t.getTime() - IST_MS;
}
// "7d" / "2w" / "1m" (rojulu/varalu/nelalu) → 10:00 AM IST that day; falls
// back to parseWhen for exact "repu 11am" style inputs.
function parseDue(s) {
  const t = String(s || "").trim().toLowerCase();
  let m, days = null;
  if ((m = t.match(/^(\d{1,3})\s*(d|days?|rojulu)$/))) days = +m[1];
  else if ((m = t.match(/^(\d{1,2})\s*(w|weeks?|varalu)$/))) days = +m[1] * 7;
  else if ((m = t.match(/^(\d{1,2})\s*(m|months?|nelalu)$/))) days = +m[1] * 30;
  if (days !== null) {
    const d = new Date(Date.now() + IST_MS);
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(10, 0, 0, 0);
    return d.getTime() - IST_MS;
  }
  return parseWhen(s);
}

// Patient name lookup across the booking queues and the lead list.
async function findPatientName(cfg, ph) {
  if (!cfg) return "";
  for (const key of ["appt:q", "appt:done"]) {
    try {
      const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "199"]);
      for (const s of (q.result || [])) {
        try { const a = JSON.parse(s); if (a.ph === ph && a.name) return a.name; } catch (e) {}
      }
    } catch (e) {}
  }
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]);
    for (const s of (r.result || [])) {
      try {
        const l = JSON.parse(s);
        if (String(l.phone || "").replace(/\D/g, "").slice(-10) === ph && l.name) return l.name;
      } catch (e) {}
    }
  } catch (e) {}
  return "";
}

// Day-only parser for leave/blocks: "" | today/ivala | repu | ellundi |
// 15-09 | 3d → midnight IST of that day (epoch ms). parseWhen can't help
// here because it insists on a clock time.
function parseDay(s) {
  const t = String(s || "").trim().toLowerCase();
  const nowIst = new Date(Date.now() + IST_MS);
  const mid = (dt) => Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) - IST_MS;
  let m;
  if (!t || /^(today|ivala|ee\s*roju)$/.test(t)) return mid(nowIst);
  if (/^(tomorrow|repu|reppu)$/.test(t)) { nowIst.setUTCDate(nowIst.getUTCDate() + 1); return mid(nowIst); }
  if (/^(ellundi|day\s*after\s*tomorrow)$/.test(t)) { nowIst.setUTCDate(nowIst.getUTCDate() + 2); return mid(nowIst); }
  if ((m = t.match(/^(\d{1,3})\s*(d|days?|rojulu)$/))) { nowIst.setUTCDate(nowIst.getUTCDate() + +m[1]); return mid(nowIst); }
  if ((m = t.match(/^(\d{1,2})\s*(w|weeks?|varalu)$/))) { nowIst.setUTCDate(nowIst.getUTCDate() + +m[1] * 7); return mid(nowIst); }
  if ((m = t.match(/^(\d{1,2})[-\/](\d{1,2})(?:[-\/](\d{2,4}))?$/))) {
    const d = new Date(nowIst);
    d.setUTCMonth(+m[2] - 1, +m[1]);
    if (m[3]) d.setUTCFullYear(+m[3] < 100 ? 2000 + +m[3] : +m[3]);
    else if (mid(d) < mid(nowIst)) d.setUTCFullYear(d.getUTCFullYear() + 1);
    return isNaN(d.getTime()) ? null : mid(d);
  }
  return null;
}
function fmtIst(ms) {
  const d = new Date(ms + IST_MS);
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
  let h = d.getUTCHours(); const min = d.getUTCMinutes(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${mo} ${d.getUTCDate()}, ${h}:${String(min).padStart(2, "0")} ${ap}`;
}

// FB Page token — same derivation + ig:ptok cache the Messenger/IG-fallback
// path uses: IG_PAGE_TOKEN env wins, else IG_SYSTEM_TOKEN + IG_PAGE_ID.
async function fbPageToken(cfg) {
  if (process.env.IG_PAGE_TOKEN) return process.env.IG_PAGE_TOKEN;
  try {
    if (cfg) {
      const r = await guard.kvCommand(cfg, ["GET", "ig:ptok"]);
      if (r && r.result) return r.result;
    }
  } catch (e) {}
  const sys = process.env.IG_SYSTEM_TOKEN, pid = process.env.IG_PAGE_ID;
  if (!sys || !pid) return null;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pid}?fields=access_token&access_token=${encodeURIComponent(sys)}`);
    const d = await r.json().catch(() => ({}));
    if (d && d.access_token) {
      if (cfg) await guard.kvCommand(cfg, ["SET", "ig:ptok", d.access_token, "EX", "21600"]).catch(() => {});
      return d.access_token;
    }
  } catch (e) {}
  return null;
}

// Cross-post the just-published IG content to the Facebook Page feed too.
// Best-effort: any failure only logs (the IG post already succeeded).
// Opt-out with FB_CROSSPOST=0.
async function fbPageTokenFresh(cfg) {
  // bypass the 6h ig:ptok cache — used after the system token gets new scopes
  const sys = process.env.IG_SYSTEM_TOKEN, pid = process.env.IG_PAGE_ID;
  if (!sys || !pid) return null;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pid}?fields=access_token&access_token=${encodeURIComponent(sys)}`);
    const d = await r.json().catch(() => ({}));
    if (d && d.access_token) {
      if (cfg) await guard.kvCommand(cfg, ["SET", "ig:ptok", d.access_token, "EX", "21600"]).catch(() => {});
      return d.access_token;
    }
  } catch (e) {}
  return null;
}

async function fbCrossPost(cfg, item) {
  if (process.env.FB_CROSSPOST === "0") return false;
  const pid = process.env.IG_PAGE_ID;
  let ptok = await fbPageToken(cfg);
  if (!pid || !ptok) return false;
  const attempt = async (tok) => {
    const url = item.vidId
      ? `https://graph.facebook.com/v21.0/${pid}/videos`
      : `https://graph.facebook.com/v21.0/${pid}/photos`;
    const body = item.vidId
      ? { file_url: signedWaUrl(item.vidId), description: item.caption, access_token: tok }
      : { url: `https://www.dermaluxe.ai/api/media?id=${item.imgId}`, caption: item.caption, access_token: tok };
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && !d.error, status: r.status, d };
  };
  try {
    let out = await attempt(ptok);
    const code = out.d && out.d.error && out.d.error.code;
    if (!out.ok && (code === 200 || code === 283 || code === 190)) {
      // permission/expiry on the cached page token — re-derive fresh and retry
      // once (covers the cache still holding a pre-upgrade token)
      const fresh = await fbPageTokenFresh(cfg);
      if (fresh && fresh !== ptok) out = await attempt(fresh);
    }
    if (!out.ok) {
      console.error("adm: fb crosspost failed", out.status, JSON.stringify(out.d).slice(0, 250));
      return false;
    }
    return true;
  } catch (e) {
    console.error("adm: fb crosspost error", e && e.message);
    return false;
  }
}

// Signed, expiring proxy URL so IG can fetch a WhatsApp-hosted video via
// /api/media?wa= (videos don't fit in KV; they stream from WhatsApp's CDN).
function signedWaUrl(waId) {
  const exp = Date.now() + 7200000;
  const sig = crypto.createHmac("sha256", String(process.env.WA_WEBHOOK_TOKEN || ""))
    .update(`${waId}.${exp}`).digest("hex");
  return `https://www.dermaluxe.ai/api/media?wa=${waId}&exp=${exp}&sig=${sig}`;
}

// Evening slots for the week-plan batch: tomorrow onwards, 6:30 PM IST daily,
// Sundays skipped (clinic closed).
function nextDailySlots(count) {
  const out = [];
  const d = new Date(Date.now() + IST_MS);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(18, 30, 0, 0);
  while (out.length < count) {
    if (d.getUTCDay() !== 0) out.push(d.getTime() - IST_MS);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Core publisher — used by the immediate "ok" flow and the schedule cron.
// `item` is {imgId, caption} (feed photo) or {vidId, caption} (Reel), plus an
// optional creationId to resume polling a container created on an earlier try
// (videos often outlive one 60s invocation). Legacy publishNow(cfg, imgId,
// caption) string form still works.
// Returns {ok:true, link} | {ok:false, transient, msg, creationId?}.
async function publishNow(cfg, item, legacyCaption) {
  if (typeof item === "string") item = { imgId: item, caption: legacyCaption };
  const tok = await igToken(cfg);
  if (!tok) return { ok: false, transient: false, msg: "IG token ledu" };
  const isVideo = !!item.vidId;
  let cid = item.creationId || null;
  if (!cid) {
    let body;
    if (isVideo) {
      body = item.story
        ? { media_type: "STORIES", video_url: signedWaUrl(item.vidId) }
        : { media_type: "REELS", video_url: signedWaUrl(item.vidId), caption: item.caption, share_to_feed: true };
    } else {
      try {
        const img = await guard.kvCommand(cfg, ["GET", `adm:img:${item.imgId}`]);
        if (!img || !img.result) return { ok: false, transient: false, msg: "image expired" };
      } catch (e) {}
      body = item.story
        ? { media_type: "STORIES", image_url: `https://www.dermaluxe.ai/api/media?id=${item.imgId}` }
        : { image_url: `https://www.dermaluxe.ai/api/media?id=${item.imgId}`, caption: item.caption };
    }
    const c = await fetch(`${IG_GRAPH}/me/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    });
    const cd = await c.json().catch(() => ({}));
    if (!c.ok || !cd.id) {
      console.error("adm: container failed", c.status, JSON.stringify(cd).slice(0, 250));
      return { ok: false, transient: true, msg: "container fail" };
    }
    cid = cd.id;
  }
  let ready = false;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 3500));
    try {
      const st = await igGet(`/${cid}?fields=status_code`, tok);
      if (st.status_code === "FINISHED") { ready = true; break; }
      if (st.status_code === "ERROR") {
        console.error("adm: container status ERROR");
        return { ok: false, transient: false,
          msg: isVideo ? "video processing error (normal WhatsApp MP4 video best)" : "image processing error (photo IG ki nachaledu — JPEG best)" };
      }
    } catch (e) {}
  }
  if (!ready) {
    return { ok: false, transient: true, creationId: cid,
      msg: isVideo ? "video inka processing lo undi" : "image inka processing lo undi" };
  }
  let p = await fetch(`${IG_GRAPH}/me/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ creation_id: cid }),
  });
  let pd = await p.json().catch(() => ({}));
  if (!p.ok && pd && pd.error && pd.error.code === 9007) {
    await new Promise((r) => setTimeout(r, 8000));
    p = await fetch(`${IG_GRAPH}/me/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ creation_id: cid }),
    });
    pd = await p.json().catch(() => ({}));
  }
  if (!p.ok || !pd.id) {
    console.error("adm: publish failed", p.status, JSON.stringify(pd).slice(0, 200));
    return { ok: false, transient: true, creationId: cid, msg: "publish fail" };
  }
  let link = "";
  try { const perm = await igGet(`/${pd.id}?fields=permalink`, tok); link = perm.permalink || ""; } catch (e) {}
  let fb = false;
  if (!item.story) { try { fb = await fbCrossPost(cfg, item); } catch (e) {} }
  return { ok: true, link, fb };
}

async function publishPending(cfg, digits) {
  const pRaw = await guard.kvCommand(cfg, ["GET", `adm:post:${digits}`]);
  if (!pRaw.result) return "Pending post em ledu. Photo + 'post: <idea>' pampandi.";
  const pending = JSON.parse(pRaw.result);

  // Scheduled preview → queue it for the cron instead of publishing now.
  if (pending.due) {
    await guard.kvCommand(cfg, ["LPUSH", "adm:queue",
      JSON.stringify({ imgId: pending.imgId, vidId: pending.vidId, caption: pending.caption, due: pending.due, by: digits, tries: 0 })]);
    if (pending.imgId) {
      const secs = Math.max(3600, Math.ceil((pending.due - Date.now()) / 1000) + 7200);
      await guard.kvCommand(cfg, ["EXPIRE", `adm:img:${pending.imgId}`, String(secs)]).catch(() => {});
    }
    await guard.kvCommand(cfg, ["DEL", `adm:post:${digits}`]).catch(() => {});
    return `⏰ *Scheduled!* ${fmtIst(pending.due)} IST ki @dermaluxe.ai lo ${pending.vidId ? "reel" : "post"} avtundi.\n'queue' tho list chudochu · 'unschedule <number>' tho remove.`;
  }

  const out = await publishNow(cfg, pending);
  if (!out.ok) {
    if (out.transient && out.creationId) {
      // container is created and still cooking (videos take a while) —
      // remember it so the next "ok" resumes instead of re-uploading
      pending.creationId = out.creationId;
      await guard.kvCommand(cfg, ["SET", `adm:post:${digits}`, JSON.stringify(pending), "EX", "3600"]).catch(() => {});
      return "🎬 Instagram inka process chestundi (video ki konchem time padutundi) — 1 nimisham agi malli *ok* pampandi.";
    }
    return out.transient
      ? "Publish fail ayindi 🙏 — 30 seconds agi malli 'ok' pampandi."
      : `Publish kudaraledu: ${out.msg} 🙏`;
  }
  await guard.kvCommand(cfg, ["DEL", `adm:post:${digits}`]).catch(() => {});
  return `✅ *${pending.story ? "Story" : pending.vidId ? "Reel" : "Post"} live!* @dermaluxe.ai${out.fb ? " + 📘 FB page" : ""}${out.link ? "\n" + out.link : ""}`;
}

// Main entry — returns reply text, or null when the message is not an admin command.
// ---- Promo-broadcast toolkit ----------------------------------------------
// Ready-made MARKETING templates the owner fires with one command; render()
// mirrors each template body for the preview bubble, promoParams() builds the
// {{n}} params for the actual send (shared with cron-post's bc:q drain).
const PROMO_DEFS = {
  festival_offer: {
    usage: "festival: Diwali | Festival Glow Package — Hydrafacial pai 20% off!",
    render: (text, p2) => `Hi <name>! 🪔 *${p2} Subhakankshalu* from DermaLuxe! ✨\n\n${text}\n\n📲 Book cheyalante ee message ki reply cheyandi, leda call: +91 99491 34666\n📍 Rama Mahal, Kasturi Vari Street, Eluru`,
  },
  flash_offer: {
    usage: "flash: Laser package pai 25% off | Ee Sunday",
    render: (text, p2) => `Hi <name>! ⚡ *DermaLuxe Flash Offer:*\n\n${text}\n\n⏰ ${p2} varaku matrame — slots limited!\n📲 Book cheyalante ee message ki reply cheyandi 🏃‍♀️`,
  },
  new_service: {
    usage: "launch: HydraFacial Platinum | Launch offer: first 20 bookings ki 30% off!",
    render: (text, p2) => `Hi <name>! 🎉 DermaLuxe lo *kotha service*:\n\n✨ *${p2}*\n${text}\n\n📲 Details & booking ki ee message ki reply cheyandi, leda call: +91 99491 34666`,
  },
  seasonal_tips: {
    usage: "tips: Varsha kalam lo fungal infections ekkuva — 1) Tadi battalu ventane marchandi 2) Roju rendu sarlu mild soap tho snanam",
    render: (text) => `Hi <name>! 🌿 *DermaLuxe Care Tips:*\n\n${text}\n\nMee skin/hair gurinchi emaina doubts unte ee message ki reply cheyandi — free ga guide chestam 💖\n\n— DermaLuxe by Medicare, Eluru`,
  },
  free_camp: {
    usage: "camp: Ee Sunday udayam 10 – sayantram 5. Doctor consultation FREE!",
    render: (text) => `Hi <name>! 🩺 *FREE Skin & Hair Check-up Camp* — DermaLuxe lo!\n\n${text}\n\n🎟 Slots limited — mee slot book cheyalante ee message ki reply cheyandi!\n📍 Rama Mahal, Kasturi Vari Street, Eluru`,
  },
};

function promoParams(tpl, name, text, p2) {
  if (tpl === "festival_offer") return [name, p2 || "Panduga", text];
  if (tpl === "flash_offer") return [name, text, p2 || "ee week"];
  if (tpl === "new_service") return [name, p2 || "Kotha service", text];
  if (tpl === "free_camp") return [name, text];
  return [name, text]; // clinic_update
}

// Distinct opted-in patient phones from the lead book (job applicants out,
// optional concern/treatments segment filter).
async function bcTargets(cfg, seg) {
  const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]);
  const opt = await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}));
  const optSet = new Set(opt.result || []);
  const seen = new Set(); const targets = [];
  for (const s of (r.result || [])) {
    let l; try { l = JSON.parse(s); } catch (e) { continue; }
    if (!l || l.type === "job") continue;
    if (seg) {
      const hay = (String(l.concern || "") + " " + (Array.isArray(l.treatments) ? l.treatments.join(" ") : "")).toLowerCase();
      if (hay.indexOf(seg) === -1) continue;
    }
    const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
    if (ph.length !== 10 || seen.has(ph) || optSet.has(ph)) continue;
    seen.add(ph);
    targets.push({ ph, name: String(l.name || "").trim().split(" ")[0] || "friend" });
  }
  return targets;
}

async function handle(cfg, digits, text, photo, video) {
  const who = adminRole(digits);
  if (!who) return null;
  const owner = who === "owner";
  const t = String(text || "").trim();

  // HR tier sees only the hiring side; anything else falls to the normal agent.
  if (who === "hr" && !/^(help|commands|jobs|shortlist|reject|select|interview)/i.test(t)) return null;
  if (who === "hr" && /^(help|commands)$/i.test(t)) {
    return { text: "🛠 *HR commands*\n• jobs report [month] — applications + status\n• shortlist <phone> — ⭐ shortlist + candidate ki msg\n• interview <phone> repu 11am — 📅 fix + invite + map\n• select <phone> — ✅ selected msg\n• reject <phone> — ❌ polite regret msg\n\nApply link: dermaluxe.ai/r/jobs", menuRows: ["jobs report", "jobs report month"] };
  }

  // Candidate pipeline: shortlist/select/reject <phone> · interview <phone> <when>
  let hm;
  if ((hm = t.match(/^(shortlist|select|reject)\s+(\d{10})$/i))) {
    if (!cfg) return "Storage ledu.";
    const action = hm[1].toLowerCase(), phone = hm[2];
    const app = await hrmod.findApp(cfg, phone);
    if (!app) return `📱 ${phone} tho application em ledu — 'jobs report' chudandi.`;
    await hrmod.setStatus(cfg, phone, action === "shortlist" ? "shortlisted" : action === "select" ? "selected" : "rejected");
    const first = String(app.name || "").split(" ")[0] || "";
    let msg;
    if (action === "shortlist") msg = `🎉 Good news ${first} garu! Mee *${app.role}* application SHORTLIST ayindi. Interview details tvaralo pampistam. — DermaLuxe HR`;
    else if (action === "select") msg = `🎊 Congratulations ${first} garu! Meeru *${app.role}* position ki SELECT ayyaru! Joining details ki mana team meeku call chestundi. Welcome to DermaLuxe! 💖`;
    else msg = `Thank you ${first} garu 🙏 Ee sari mee profile mundhuku vellaledhu — kani mee CV mana file lo undi, suitable opening vachinappudu contact chestam. All the best!`;
    const sent = await notify.sendWa(phone, msg);
    const label = action === "shortlist" ? "⭐ SHORTLISTED" : action === "select" ? "✅ SELECTED" : "❌ REJECTED";
    return `${label} — ${app.name} (${phone})\nCandidate ki message ${sent ? "vellindi ✉️" : "vellaledhu (24h window close — nerugaa call cheyandi 📞)"}`;
  }
  if ((hm = t.match(/^interview\s+(\d{10})\s+(.+)$/i))) {
    if (!cfg) return "Storage ledu.";
    const phone = hm[1];
    const at = parseWhen(hm[2]);
    if (!at) return "Time ardham kaledu 🙏 — ila pampandi:\ninterview " + phone + " repu 11am\n(today 5pm, 15-08 10:30am kuda ok)";
    const app = await hrmod.findApp(cfg, phone);
    if (!app) return `📱 ${phone} tho application em ledu — 'jobs report' chudandi.`;
    await hrmod.setStatus(cfg, phone, "interview", at);
    const first = String(app.name || "").split(" ")[0] || "";
    const sent = await notify.sendWa(phone,
      `📅 *Interview Fixed!*\n\nHi ${first} garu — mee *${app.role}* interview:\n🗓 *${fmtIst(at)}* IST\n📍 DermaLuxe by Medicare, Rama Mahal, Kasturi Vari Street, Opp. Happy Mobiles, Eluru\n\nCV & original certificates teeskuni randi. All the best! 🍀\n— DermaLuxe HR`);
    if (sent) await notify.sendWaLocation(phone);
    return `📅 Interview fixed — ${app.name} (${phone})\n🗓 ${fmtIst(at)} IST\nCandidate ki invite ${sent ? "+ map pin vellindi ✉️" : "vellaledhu (24h window close — nerugaa call cheyandi 📞)"}\n(Interview roju udayam digest lo reminder vastundi)`;
  }

  // jobs report [month] — applications summary for owner/marketing/HR
  if (/^jobs(\s*report)?(\s*(week|month))?$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const days = /month/i.test(t) ? 30 : 7;
    const since = Date.now() - days * 86400000;
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]);
    const apps = (r.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } })
      .filter((l) => l && l.type === "job" && l.ts >= since);
    const lines = [`💼 *Job Applications — last ${days} days*: ${apps.length}`];
    const byRole = {};
    apps.forEach((a) => { const role = String(a.concern || "").split("·")[0].trim() || "?"; byRole[role] = (byRole[role] || 0) + 1; });
    Object.keys(byRole).forEach((k) => lines.push(`• ${k}: ${byRole[k]}`));
    if (apps.length) lines.push("");
    for (const a of apps.slice(0, 10)) {
      const st = await hrmod.getStatus(cfg, a.phone);
      const stx = st && st.status === "interview" && st.at ? `📅 ${fmtIst(st.at)}` : hrmod.statusEmoji(st);
      lines.push(`${stx} ${a.name} · ${String(a.concern || "").slice(0, 38)} · 📱 ${a.phone}${a.cv_media_id ? " · 📄" : ""}`);
    }
    if (apps.length) lines.push("", "🆕 new · ⭐ shortlist · 📅 interview · ✅ select · ❌ reject", "Actions: shortlist/interview/select/reject <phone>");
    if (!apps.length) lines.push("(applications em ravaledu)", "", "Promote link: dermaluxe.ai/r/jobs");
    else lines.push("", "Dashboard: dermaluxe.ai/leads.html");
    return lines.join("\n");
  }

  if (/^(help|commands)$/i.test(t)) {
    const lines = ["🛠 *Admin commands*",
      "• daily post now — AI poster ippude post · daily on/off · daily status · daily topics",
      "• academy status · academy booked <n> — training seats target (10)",
      "• staff list · staff add <number> <name> [owner] · staff remove <number> · staff password <pwd> — dashboard access",
      "• templates · templates create — WhatsApp template approval status / submit",
      "• 📷 photo / 🎬 video + 'post: <idea>' — AI caption → post (video = Reel)",
      "• 📷/🎬 + 'schedule: tomorrow 6pm | <idea>' — auto-post later",
      "• 📷/🎬 + 'story:' — Instagram Story ga (24h)",
      "• weekplan — week antha posts okesari plan (photos → done)",
      "• report — daily report ippude chudandi",
      "• appointments — bookings · arrived <phone> ✅ · noshow <phone> 🔁",
      "• 📷 photo + 'result: hair transplant' — before/after gallery",
      "• referrals — evaru patients ni pampistunnaro",
      "• missed <phone> — miss ayina call ki WhatsApp rescue",
      "• leave repu · block repu 2pm-5pm — agent aa time book cheyadu",
      "• followup <phone> Hydrafacial — results check msg",
      "• preop <phone> <procedure> · aftercare <phone> <procedure>",
      "• paid <phone> — advance confirm · birthday <phone> — wish",
      "• checkup <phone> 7d — review reminder · session <phone> 30d | PRP",
      "• campaign: GLOW | <offer reply> — keyword campaign",
      "• review <phone> — patient ki Google review ask",
      "• unschedule <n> — scheduled post remove"];
    if (owner) lines.push(
      "• broadcast: <offer> — andariki · broadcast hair: — segment ki (paid)",
      "• festival:/flash:/launch:/camp:/tips: — ready designs (paid)",
      "• reactivate — 3-10 roju cold leads ki follow-up (paid)",
      "• weekly — Monday marketing report · reviews — patient ratings");
    lines.push("", "Reports ki 👇 list nunchi tap cheyandi:");
    const menuRows = ["report", "weekly", "funnel", "reviews", "referrals", "appointments", "checkups", "blocks", "results", "insta report", "leads report", "leads report week", "ideas", "queue", "campaigns"];
    if (owner) menuRows.splice(4, 0, "marketing report");
    return { text: lines.join("\n"), menuRows };
  }

  // ---- WhatsApp message templates (wa-setup.js) --------------------------
  // templates · templates create · templates academy
  let tm;
  if ((tm = t.match(/^templates?(?:\s+(create|status|academy|list))?$/i))) {
    if (!owner) return "🔒 Owner matrame.";
    const sub = (tm[1] || "list").toLowerCase();
    const u = new URL("https://www.dermaluxe.ai/api/wa-setup");
    u.searchParams.set("key", process.env.ADMIN_KEY || "");
    if (sub === "create" || sub === "academy") u.searchParams.set("action", "create");
    try {
      const r = await fetch(u.toString(), { headers: { "x-admin-key": process.env.ADMIN_KEY || "" } });
      const d = await r.json().catch(() => ({}));
      if (sub === "create" || sub === "academy") {
        const rows = (d.created || []).filter((x) => sub !== "academy" || /^academy/.test(x.name));
        const ok = rows.filter((x) => x.ok), bad = rows.filter((x) => !x.ok);
        const lines = [`📤 *Templates submit chesanu* — ${ok.length} pampam, ${bad.length} fail/already`];
        ok.forEach((x) => lines.push(`✅ ${x.name} — review lo (Meta 1-24 gantalu teesukuntundi)`));
        bad.slice(0, 8).forEach((x) => lines.push(`⚠️ ${x.name} — ${String(x.resp).slice(0, 90)}`));
        lines.push("", "Status chudataniki: *templates*");
        return lines.join("\n");
      }
      const tpl = d.templates || [];
      const by = { APPROVED: [], PENDING: [], REJECTED: [] };
      tpl.forEach((x) => (by[x.status] || (by[x.status] = [])).push(x));
      const lines = [`📋 *WhatsApp templates* — ${tpl.length} total`];
      if (d.account) lines.push(`Account review: ${d.account.account_review_status || "—"} · Business verification: ${d.account.business_verification_status || "—"}`);
      lines.push("", `✅ Approved: ${(by.APPROVED || []).length}`, `⏳ Pending: ${(by.PENDING || []).length}`, `❌ Rejected: ${(by.REJECTED || []).length}`);
      const acad = tpl.filter((x) => /^academy/.test(x.name));
      if (acad.length) { lines.push("", "*Academy templates:*"); acad.forEach((x) => lines.push(`${x.status === "APPROVED" ? "✅" : x.status === "REJECTED" ? "❌" : "⏳"} ${x.name} — ${x.status}${x.rejected_reason ? " (" + x.rejected_reason + ")" : ""}`)); }
      else lines.push("", "Academy templates inka create cheyaledu — *templates create* ani pampandi.");
      (by.REJECTED || []).slice(0, 5).forEach((x) => lines.push(`❌ ${x.name}: ${x.rejected_reason || "—"}`));
      return lines.join("\n");
    } catch (e) { return "Templates check cheyaleka poyanu: " + String((e && e.message) || e).slice(0, 90); }
  }

  // ---- Staff dashboard team (staff.html) ---------------------------------
  // staff list · staff add <10-digit> <name> · staff remove <10-digit>   (owner)
  let pwm;
  if ((pwm = t.match(/^staff\s+password\s+(.+)$/i))) {
    if (!cfg) return "Storage ledu.";
    if (!owner) return "🔒 Owner matrame.";
    const pwd = pwm[1].trim();
    if (/^off$/i.test(pwd)) { await guard.kvCommand(cfg, ["DEL", "staff:pwd"]); return "🔓 Dashboard password teesesanu — ippudu OTP login matrame."; }
    if (pwd.length < 6) return "Password kaneesam 6 characters undali.";
    const crypto = require("crypto");
    const salt = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["SET", "staff:pwd", JSON.stringify({ salt, hash: crypto.scryptSync(pwd, salt, 32).toString("hex"), ts: Date.now(), by: digits })]);
    return "✅ Staff dashboard password set ayindi (andariki same password + valla number).\nLogin: www.dermaluxe.ai/staff.html\nTeeseyalante: *staff password off*\n\n🔐 Security: ee message ni chat lo delete cheyandi.";
  }
  let sm;
  if ((sm = t.match(/^staff(?:\s+(list|add|remove|delete))?(?:\s+(\d{10}))?(?:\s+(.+))?$/i))) {
    if (!cfg) return "Storage ledu.";
    const sub = (sm[1] || "list").toLowerCase(), ph = sm[2] || "", name = (sm[3] || "").trim().slice(0, 60);
    const readAll = async () => { const r = await guard.kvCommand(cfg, ["HGETALL", "staff:users"]).catch(() => ({})); const a = r.result || [], o = {}; if (Array.isArray(a)) { for (let i = 0; i + 1 < a.length; i += 2) { try { o[a[i]] = JSON.parse(a[i + 1]); } catch (e) {} } } return o; };
    if (sub === "add") {
      if (!owner) return "🔒 Owner matrame.";
      if (!/^[6-9]\d{9}$/.test(ph) || !name) return "Format: *staff add 9876543210 Priya*";
      const asOwner = /\bowner\b/i.test(name);
      const clean = name.replace(/\bowner\b/ig, "").trim() || "Owner";
      await guard.kvCommand(cfg, ["HSET", "staff:users", ph, JSON.stringify({ name: clean, role: asOwner ? "owner" : "staff", added: Date.now(), by: digits })]);
      notify.sendWa(ph, `👋 Hi ${clean}! Meeru DermaLuxe staff dashboard ki add ayyaru.\nLogin: www.dermaluxe.ai/staff.html — mee number ${ph} tho OTP login.`).catch(() => {});
      return `✅ ${clean} (${ph}) ${asOwner ? "OWNER" : "staff"} ga add ayyaru — dermaluxe.ai/staff.html lo login cheyochu.`;
    }
    if (sub === "remove" || sub === "delete") {
      if (!owner) return "🔒 Owner matrame.";
      if (!ph) return "Format: *staff remove 9876543210*";
      await guard.kvCommand(cfg, ["HDEL", "staff:users", ph]);
      return `🗑 ${ph} staff access teesesanu.`;
    }
    const all = await readAll();
    const lines = ["👥 *Staff dashboard access* — dermaluxe.ai/staff.html", `Owners: ${String(process.env.ADMIN_PHONES || "").split(",").map((x) => x.trim()).filter(Boolean).join(", ") || "—"}`];
    const ks = Object.keys(all);
    if (!ks.length) lines.push("Staff: (none) — add: *staff add 9876543210 Name*");
    else ks.forEach((k) => lines.push(`• ${all[k].name} — ${k}`));
    lines.push("", "Commands: *staff add <number> <name>* (owner ki chivara *owner* pettandi) · *staff remove <number>* · *staff password <pwd>*");
    return lines.join("\n");
  }

  // ---- Academy seat target ------------------------------------------------
  // academy status · academy booked <n> (owner) — seats-left count is injected into the agent prompt.
  let am;
  if ((am = t.match(/^academy(?:\s+(status|booked|seats))?(?:\s+(\d{1,2}))?$/i))) {
    if (!cfg) return "Storage ledu.";
    const sub = (am[1] || "status").toLowerCase(), n = am[2];
    if ((sub === "booked" || sub === "seats") && n !== undefined) {
      if (!owner) return "🔒 Owner matrame.";
      await guard.kvCommand(cfg, ["SET", "acad:booked", String(Math.max(0, Math.min(10, Number(n))))]);
    }
    const b = await guard.kvCommand(cfg, ["GET", "acad:booked"]).catch(() => ({}));
    const booked = Number(b.result || 0), left = Math.max(0, 10 - booked);
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]).catch(() => ({}));
    const leads = (r.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter((l) => l && /^academy/i.test(String(l.concern || "")));
    const paid = leads.filter((l) => /paid/i.test(String(l.concern || ""))).length;
    const lines = [`🎓 *Academy — Batch 1 (20 Oct 2026)*`, `Seats booked: *${booked}/10* · left: *${left}* · offer till 30 Sep`, `Enquiries: ${leads.length} · paid screenshots: ${paid}`];
    leads.slice(0, 8).forEach((l) => lines.push(`• ${l.name || "?"} — ${String(l.concern || "").replace(/^Academy\s*/i, "")} (${l.phone || l.src_id || ""})`));
    lines.push("", "Update: *academy booked 3* (owner) · Enquiries WhatsApp lo 'ACADEMY' tho vastayi.");
    return lines.join("\n");
  }

  // ---- Daily auto-poster (cron-daily.js) --------------------------------
  // daily post now [topic] · daily post [topic] (queue for 8:30 AM) · daily on/off · daily topics
  let dm;
  if ((dm = t.match(/^daily\s+(post(?:\s+now)?|on|off|topics|status)(?:\s+([a-z0-9-]+))?$/i))) {
    if (!cfg) return "Storage ledu.";
    const sub = dm[1].toLowerCase().replace(/\s+/g, " "), key = (dm[2] || "").toLowerCase();
    const daily = require("./_daily.js");
    if (sub === "topics") {
      return "🗂 *Daily topics* (daily post now <key>):\n" + daily.TOPICS.map((x) => `• ${x.key} — ${x.h1}`).join("\n");
    }
    if (sub === "on" || sub === "off") {
      if (!owner) return "🔒 Owner matrame.";
      await guard.kvCommand(cfg, ["SET", "dp:enabled", sub === "on" ? "1" : "0"]);
      return sub === "on" ? "✅ Daily auto post ON — roju 7:00 AM ki poster ready, 8:30 AM ki Instagram + Facebook lo veltundi." : "⏸ Daily auto post OFF. Malli start: *daily on*";
    }
    if (sub === "status") {
      const en = await guard.kvCommand(cfg, ["GET", "dp:enabled"]).catch(() => ({}));
      const h = await guard.kvCommand(cfg, ["LRANGE", "dp:hist", "0", "6"]).catch(() => ({}));
      return `Daily auto post: ${String(en.result || "1") === "0" ? "⏸ OFF" : "✅ ON"} (7:00 AM build → 8:30 AM publish)\nLast posts: ${(h.result || []).map((x) => String(x).replace("|", " @ ")).join(", ") || "—"}`;
    }
    if (key && !daily.TOPICS.find((x) => x.key === key)) return `Topic '${key}' ledu — *daily topics* chudandi.`;
    const now = sub === "post now";
    const u = new URL("https://www.dermaluxe.ai/api/cron-daily");
    u.searchParams.set("force", "1"); if (now) u.searchParams.set("now", "1"); if (key) u.searchParams.set("topic", key); u.searchParams.set("by", digits);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 4000);
    fetch(u.toString(), { headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ""}`, "x-admin-key": process.env.ADMIN_KEY || "" }, signal: ctl.signal }).catch(() => {}).finally(() => clearTimeout(timer));
    await new Promise((z) => setTimeout(z, 1500));
    return now ? "🎨 Poster generate avutondi (AI image + design) — 1-2 nimishallo Instagram + Facebook lo post ayyi, mee ki link vastundi." : "🎨 Poster generate avutondi — 1-2 nimishallo preview vastundi, 8:30 AM ki post avutundi (unschedule 1 tho skip cheyyochhu).";
  }

  if (/^ideas?$/i.test(t)) {
    try {
      const today = fmtIst(Date.now());
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.AI_MODEL || "claude-opus-5",
          max_tokens: 500,
          system: "You are the social media strategist for DermaLuxe by Medicare — premium skin/hair/aesthetics clinic in Eluru, Andhra Pradesh (Telugu audience). Services: laser hair removal, PICO pigmentation, Hydrafacial, PRP/GFC, hair transplant, acne care, anti-aging, bridal packages, weight loss.",
          messages: [{ role: "user", content: `Today is ${today} (IST). Give exactly 3 Instagram post ideas for this week — consider the season, any nearby Indian/Telugu festivals, and wedding/exam seasons. For each: one bold hook line, then "📷" line saying what photo/video to shoot at the clinic, then "✍️" line with the caption angle. Tenglish-friendly, no prices. Max 12 short lines total, numbered 1-3.` }],
        }),
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      const txt = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
      return "💡 *Post ideas — ee week:*\n\n" + txt.trim() + "\n\nNachhindi select chesi photo + 'post: <idea>' pampandi!";
    } catch (e) { console.error("adm: ideas", e.message); return "Ideas generate avvaledu — malli try cheyandi."; }
  }

  if (/^marketing(\s*report)?$/i.test(t)) {
    if (!owner) return "🔒 Ee report owner ki matrame. Meeku: insta report · leads report · ideas 👍";
    try {
      const lines = ["📈 *Marketing Report — 7 days*", ""];
      // Leads by channel
      let leadStats = "";
      if (cfg) {
        const since = Date.now() - 7 * 86400000;
        const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]);
        const leads = (r.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
          .filter((l) => l && l.ts >= since);
        const by = {};
        leads.forEach((l) => { by[l.type] = (by[l.type] || 0) + 1; });
        leadStats = `${leads.length} leads (` + (Object.keys(by).map((k) => `${k}:${by[k]}`).join(", ") || "none") + ")";
        lines.push(`📋 Leads: ${leadStats}`);
      }
      // IG snapshot
      let igStats = "";
      try {
        const tok2 = await igToken(cfg);
        if (tok2) {
          const me = await igGet("/me?fields=username,followers_count,media_count", tok2);
          const media = await igGet("/me/media?fields=like_count,comments_count,caption&limit=5", tok2);
          const posts = media.data || [];
          const eng = posts.reduce((a, p) => a + (p.like_count || 0) + (p.comments_count || 0), 0);
          igStats = `${me.followers_count} followers, last ${posts.length} posts ${eng} engagements`;
          lines.push(`📸 IG: ${igStats}`);
        }
      } catch (e) {}
      // Smart link hits
      let linkStats = "";
      if (cfg) {
        const tags = ["insta", "wa", "fb", "gbp", "story"];
        const parts = [];
        for (const tag of tags) {
          let sum = 0;
          for (let d = 0; d < 7; d++) {
            const key = `utm:${tag}:${new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)}`;
            try { const v = await guard.kvCommand(cfg, ["GET", key]); sum += Number(v.result || 0); } catch (e) {}
          }
          if (sum > 0) parts.push(`${tag}:${sum}`);
        }
        linkStats = parts.join(", ") || "no clicks yet";
        lines.push(`🔗 Smart links: ${linkStats}`);
        lines.push("   (bio lo vadandi: dermaluxe.ai/r/insta · /r/wa · /r/fb · /r/gbp · /r/story)");
      }
      // Keyword-campaign hits (7d)
      try {
        const cs = await guard.kvCommand(cfg, ["SMEMBERS", "camp:_set"]);
        const cparts = [];
        for (const w of (cs.result || [])) {
          let hits = 0;
          for (let d = 0; d < 7; d++) {
            const key = `camphit:${w}:${new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)}`;
            try { const v = await guard.kvCommand(cfg, ["GET", key]); hits += Number(v.result || 0); } catch (e) {}
          }
          if (hits > 0) cparts.push(`${w}:${hits}`);
        }
        if (cparts.length) lines.push(`🎯 Campaign hits: ${cparts.join(", ")}`);
      } catch (e) {}
      // AI plan
      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: process.env.AI_MODEL || "claude-opus-5",
            max_tokens: 300,
            system: "Marketing advisor for DermaLuxe skin/hair clinic, Eluru. Be concrete and brief.",
            messages: [{ role: "user", content: `This week's stats — Leads: ${leadStats || "n/a"}. Instagram: ${igStats || "n/a"}. Link clicks: ${linkStats || "n/a"}. Give exactly 3 short next-week marketing actions (one line each, Tenglish-friendly, no prices).` }],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const txt = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
          if (txt.trim()) lines.push("", "🎯 *Next week:*", txt.trim());
        }
      } catch (e) {}
      return lines.join("\n");
    } catch (e) { console.error("adm: marketing", e.message); return "Marketing report fail ayindi."; }
  }

  if (/^queue$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const r = await guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "19"]);
    const items = (r.result || []).map((s) => { try { return { raw: s, it: JSON.parse(s) }; } catch (e) { return null; } })
      .filter(Boolean).sort((a, b) => a.it.due - b.it.due);
    if (!items.length) return "⏰ Queue khali — photo + 'schedule: tomorrow 6pm | <idea>' tho add cheyandi.";
    const lines = ["⏰ *Scheduled posts:*"];
    items.forEach((x, i) => lines.push(`${i + 1}. ${fmtIst(x.it.due)} — ${x.it.vidId ? "🎬 " : ""}${String(x.it.caption || "").replace(/\n/g, " ").slice(0, 45)}…`));
    lines.push("", "Remove: unschedule <number>");
    return lines.join("\n");
  }

  let um;
  if ((um = t.match(/^(?:unschedule|remove)\s+(\d{1,2})$/i))) {
    if (!cfg) return "Storage ledu.";
    const r = await guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "19"]);
    const items = (r.result || []).map((s) => { try { return { raw: s, it: JSON.parse(s) }; } catch (e) { return null; } })
      .filter(Boolean).sort((a, b) => a.it.due - b.it.due);
    const idx = Number(um[1]) - 1;
    if (idx < 0 || idx >= items.length) return `Queue lo #${um[1]} ledu — 'queue' tho list chudandi.`;
    await guard.kvCommand(cfg, ["LREM", "adm:queue", "1", items[idx].raw]);
    return `🗑 Removed: ${fmtIst(items[idx].it.due)} post.`;
  }

  // report / digest — on-demand daily report; also the reply target of the
  // 9AM daily_digest_ping template when the free-form window was closed.
  if (/^(report|digest)$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const dgmod = require("./_digest.js"); // lazy require — no load-order games
    const out = await dgmod.buildDigest(cfg, false);
    return out.body;
  }

  // Live booking book — upcoming patient appointments with reminder status
  if (/^(appointments?|bookings?)$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const aq = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
    const items = (aq.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter((a) => a && a.at && a.at > Date.now() - 10800000).sort((x, y) => x.at - y.at);
    if (!items.length) return "📅 Upcoming appointments em levu.\n(Patient agent lo slot confirm avvagane ikkada vastayi + auto reminders veltayi)";
    const lines = [`📅 *Appointments (${items.length}):*`];
    items.slice(0, 15).forEach((a) => lines.push(
      `— ${fmtIst(a.at)} · ${a.name || "?"} 📱 ${a.ph}${a.concern ? " · " + String(a.concern).slice(0, 24) : ""}${a.r9 || a.r2 ? " ✅reminded" : ""}`));
    lines.push("", "Miss ayithe: *noshow <phone>* — rebook nudge veltundi");
    return lines.join("\n");
  }

  // arrived <10-digit> — team marks the visit happened (analytics + keeps
  // tomorrow's care follow-up on; pairs with the +3h "vachhara?" team ping)
  if ((um = t.match(/^arrived\s+(\d{10})$/i))) {
    if (!cfg) return "Storage ledu.";
    const ph = um[1];
    const dq = await guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "199"]).catch(() => ({}));
    for (const s of (dq.result || [])) {
      try {
        const a = JSON.parse(s);
        if (a.ph === ph && !a.v) {
          a.v = 1;
          await guard.kvCommand(cfg, ["LREM", "appt:done", "1", s]);
          await guard.kvCommand(cfg, ["LPUSH", "appt:done", JSON.stringify(a)]);
          return `✅ ${a.name || ph} — arrived ani mark chesanu. Repu udayam care follow-up auto veltundi 💖`;
        }
      } catch (e) {}
    }
    return `${ph} ki recent visit record ledu — appointment ayina patients matrame mark cheyagalam.`;
  }

  // noshow <10-digit> — warm rebook nudge to a patient who missed the visit
  if ((um = t.match(/^no\s*show\s+(\d{10})$/i))) {
    if (!cfg) return "Storage ledu.";
    const ph = um[1];
    let name = "";
    for (const key of ["appt:done", "appt:q"]) {
      const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "199"]).catch(() => ({}));
      for (const s of (q.result || [])) { try { const a = JSON.parse(s); if (a.ph === ph && a.name) name = a.name; } catch (e) {} }
      if (name) break;
    }
    const first = String(name).split(" ")[0];
    // mark ns on their latest appt:done row → morning care-check skips them
    try {
      const dq = await guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "199"]);
      for (const s of (dq.result || [])) {
        try {
          const a = JSON.parse(s);
          if (a.ph === ph && !a.ns) {
            a.ns = 1;
            await guard.kvCommand(cfg, ["LREM", "appt:done", "1", s]);
            await guard.kvCommand(cfg, ["LPUSH", "appt:done", JSON.stringify(a)]);
            break;
          }
        } catch (e) {}
      }
    } catch (e) {}
    const ok = await notify.sendWa(ph,
      `Hi ${first || "andi"}! 🙏 Ivala mee DermaLuxe appointment miss ayinattu undi — parledu!\n\nMalli convenient time book chesukovalante ee message ki reply cheyandi 😊 Ee week slots available unnayi.`);
    if (ok) return `✅ Rebook nudge ${ph} ki vellindi.`;
    const out = await notify.sendWaTemplate(ph, "clinic_update",
      [first || "friend", "Ivala mee appointment miss ayinattu undi — malli book cheyala? Mee convenient time reply cheyandi, slot fix chestam 😊"]);
    return out.ok ? `✅ Rebook nudge ${ph} ki vellindi (template).`
      : `❌ Deliver avvaledu: ${out.msg || "window closed + template fail"}`;
  }

  // followup <phone> [service] — "results ela unnayi?" check, sent right now
  if ((um = t.match(/^follow\s*up\s+(\d{10})(?:\s+(.+))?$/i))) {
    const ph = um[1];
    const svc = (um[2] || "").trim().slice(0, 50) || "treatment";
    const name = String(await findPatientName(cfg, ph)).split(" ")[0] || "friend";
    const out = await notify.sendWaTemplate(ph, "service_followup", [name, svc]);
    return out.ok ? `✅ Service follow-up ${ph} ki vellindi (${svc}).`
      : `❌ Vellaledu: ${out.msg || "template inka approve avvakapovachu — konchem agi malli try cheyandi"}`;
  }

  // preop / aftercare <phone> <procedure> — surgical-journey instruction sends.
  // The standard instruction list lives inside the approved template, so the
  // team only types who + which procedure.
  if ((um = t.match(/^pre\s*op\s+(\d{10})(?:\s+([\s\S]+))?$/i))) {
    const ph = um[1];
    const proc = (um[2] || "").trim().slice(0, 90);
    if (!proc) return "Procedure & time kuda cheppandi 🙏:\npreop " + ph + " FUE Hair Transplant (Aug 20, udayam 9 AM)";
    const name = String(await findPatientName(cfg, ph)).split(" ")[0] || "friend";
    const out = await notify.sendWaTemplate(ph, "preop_instructions", [name, proc]);
    return out.ok ? `✅ Pre-op instructions ${name} (${ph}) ki vellindi.\n📋 ${proc}`
      : `❌ Vellaledu: ${out.msg || "template inka approve avvakapovachu"}`;
  }
  if ((um = t.match(/^after\s*care\s+(\d{10})(?:\s+([\s\S]+))?$/i))) {
    const ph = um[1];
    const proc = (um[2] || "").trim().slice(0, 90) || "treatment";
    const name = String(await findPatientName(cfg, ph)).split(" ")[0] || "friend";
    const out = await notify.sendWaTemplate(ph, "aftercare_instructions", [name, proc]);
    return out.ok ? `✅ Aftercare instructions ${name} (${ph}) ki vellindi.\n💖 ${proc}`
      : `❌ Vellaledu: ${out.msg || "template inka approve avvakapovachu"}`;
  }

  // paid <phone> [amount] — advance verified by the team → official confirmation
  if ((um = t.match(/^paid\s+(\d{10})(?:\s+(\d{2,6}))?$/i))) {
    const ph = um[1];
    const amt = um[2] || String(process.env.ADVANCE_AMOUNT || 200);
    const name = String(await findPatientName(cfg, ph)).split(" ")[0] || "friend";
    let when = "mee booked slot";
    if (cfg) {
      try {
        const q = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
        let best = 0;
        for (const s of (q.result || [])) {
          try { const a = JSON.parse(s); if (a.ph === ph && a.at > Date.now() - 3600000 && (!best || a.at < best)) best = a.at; } catch (e) {}
        }
        if (best) when = fmtIst(best);
      } catch (e) {}
    }
    const out = await notify.sendWaTemplate(ph, "payment_confirmed", [name, amt, when]);
    return out.ok ? `✅ Payment confirmation ${name} (${ph}) ki vellindi — ₹${amt} · ${when}`
      : `❌ Vellaledu: ${out.msg || "template inka approve avvakapovachu"}`;
  }

  // birthday <phone> [offer] — wish + gift line
  if ((um = t.match(/^birth\s*day\s+(\d{10})(?:\s+([\s\S]+))?$/i))) {
    const ph = um[1];
    const offer = (um[2] || "").trim().slice(0, 200)
      || "Birthday gift ga ee nela lo e treatment pai aina special discount — mee kosam!";
    const name = String(await findPatientName(cfg, ph)).split(" ")[0] || "friend";
    const out = await notify.sendWaTemplate(ph, "birthday_wish", [name, offer]);
    return out.ok ? `🎂 Birthday wish ${name} (${ph}) ki vellindi.`
      : `❌ Vellaledu: ${out.msg || "template inka approve avvakapovachu"}`;
  }

  // checkups — scheduled review/session reminders list
  if (/^checkups$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const q = await guard.kvCommand(cfg, ["LRANGE", "chk:q", "0", "199"]);
    const items = (q.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(Boolean).sort((a, b) => a.due - b.due);
    if (!items.length) return "🔁 Scheduled reminders em levu.\n\ncheckup <phone> 7d — review-visit reminder\nsession <phone> 30d | PRP — next-session reminder";
    const lines = [`🔁 *Scheduled reminders (${items.length}):*`];
    items.slice(0, 15).forEach((c) => lines.push(
      `— ${fmtIst(c.due)} ${c.kind === "session" ? "💆" : "🩺"} ${c.name || "?"} 📱 ${c.ph}${c.note ? " · " + c.note : ""}`));
    lines.push("", "Remove: checkup remove <phone>");
    return lines.join("\n");
  }
  if ((um = t.match(/^check\s*up\s+(?:remove|cancel)\s+(\d{10})$/i))) {
    if (!cfg) return "Storage ledu.";
    const q = await guard.kvCommand(cfg, ["LRANGE", "chk:q", "0", "199"]);
    let n = 0;
    for (const s of (q.result || [])) {
      try { if (JSON.parse(s).ph === um[1]) { await guard.kvCommand(cfg, ["LREM", "chk:q", "1", s]); n++; } } catch (e) {}
    }
    return n ? `🗑 ${um[1]} ki scheduled reminders (${n}) remove chesanu.` : `${um[1]} ki scheduled reminders em levu.`;
  }

  // checkup <phone> <when> [| note] — review-visit reminder that morning
  if ((um = t.match(/^check\s*up\s+(\d{10})\s+([^|]+?)(?:\s*\|\s*(.+))?$/i))) {
    if (!cfg) return "Storage ledu.";
    const ph = um[1];
    const due = parseDue(um[2]);
    if (!due) return "Time ardham kaledu 🙏 — ila pampandi:\ncheckup " + ph + " 7d\n(2w, 1m, repu 11am, 15-08 10:30am kuda ok)";
    const name = await findPatientName(cfg, ph);
    const q = await guard.kvCommand(cfg, ["LRANGE", "chk:q", "0", "199"]);
    for (const s of (q.result || [])) {
      try { const c = JSON.parse(s); if (c.ph === ph && c.kind === "review") await guard.kvCommand(cfg, ["LREM", "chk:q", "1", s]); } catch (e) {}
    }
    await guard.kvCommand(cfg, ["LPUSH", "chk:q", JSON.stringify({ ph, name, due, kind: "review", note: (um[3] || "").trim().slice(0, 60) })]);
    return `🩺 Review reminder fix ayindi — ${name || ph}\n📅 ${fmtIst(due)} (aa roju udayam patient ki auto message veltundi)\nList: *checkups*`;
  }

  // session <phone> <when> | <treatment> — next-session reminder that morning
  if ((um = t.match(/^session\s+(\d{10})\s+([^|]+?)\s*\|\s*(.+)$/i))) {
    if (!cfg) return "Storage ledu.";
    const ph = um[1];
    const due = parseDue(um[2]);
    if (!due) return "Time ardham kaledu 🙏 — ila pampandi:\nsession " + ph + " 30d | PRP";
    const treat = um[3].trim().slice(0, 60);
    const name = await findPatientName(cfg, ph);
    const q = await guard.kvCommand(cfg, ["LRANGE", "chk:q", "0", "199"]);
    for (const s of (q.result || [])) {
      try { const c = JSON.parse(s); if (c.ph === ph && c.kind === "session") await guard.kvCommand(cfg, ["LREM", "chk:q", "1", s]); } catch (e) {}
    }
    await guard.kvCommand(cfg, ["LPUSH", "chk:q", JSON.stringify({ ph, name, due, kind: "session", note: treat })]);
    return `💆 Session reminder fix ayindi — ${name || ph} (${treat})\n📅 ${fmtIst(due)} (aa roju udayam patient ki auto message veltundi)\nList: *checkups*`;
  }
  if (/^session\s+\d{10}\s*$/i.test(t)) {
    return "Treatment kuda cheppandi 🙏:\nsession <phone> 30d | PRP\n(30d = 30 rojula tarvata reminder)";
  }

  // ---- missed <phone> — manual missed-call rescue -------------------------
  // Twilio has no Indian numbers to sell, so until the clinic has a cloud
  // telephony line, staff forward a missed call here and the agent sends the
  // same rescue message the automated webhook would have sent.
  // Staff paste straight from the call log, so accept +91 / 0 / spaces / dashes.
  if ((um = t.match(/^miss(?:ed)?\s*(?:call)?\s*[:\-]?\s*((?:\+?91[\s-]*)?[\d][\d\s-]{8,15})$/i))) {
    const ph = String(um[1]).replace(/\D/g, "").slice(-10);
    if (ph.length !== 10) return "Number sarigga ledu 🙏 — ila pampandi: *missed 9876543210*";
    if (cfg) await guard.kvCommand(cfg, ["SET", `ntf:miss:${ph}`, "1", "EX", "21600"]).catch(() => {});
    const msg = "Namaste! 🙏 Meeru DermaLuxe ki call chesaru — miss ayindi, sorry!\n\nIkkade WhatsApp lo cheppandi — appointment book chestam leda mee doubts ki reply chestam 😊\n\n📍 Rama Mahal, Kasturi Vari Street, Eluru\n⏰ Mon-Sat, 9 AM - 9 PM";
    if (await notify.sendWa(ph, msg)) return `✅ Missed-call message ${ph} ki vellindi.\nVaallu reply istey agent ventane matladutundi 💬`;
    const out = await notify.sendWaTemplate(ph, "clinic_update",
      ["friend", "Meeru DermaLuxe ki call chesaru — miss ayindi, sorry! Appointment leda doubts unte ee message ki reply cheyandi 😊"]);
    return out.ok
      ? `✅ Missed-call message ${ph} ki vellindi (template).`
      : `❌ Deliver avvaledu: ${out.msg || "try again"}`;
  }

  // ---- Before/after gallery: photo + "result: <tag> | <caption>" ---------
  // Stored WITHOUT a TTL (adm:img key space, so api/media.js serves it) and
  // indexed by tag; the patient agent sends the matching set on request.
  if (photo && /^result\s*[:\-]/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const rest = t.replace(/^result\s*[:\-]\s*/i, "");
    const parts = rest.split("|");
    const tag = String(parts[0] || "").trim().toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!tag) return "Tag kuda cheppandi 🙏:\nresult: hair transplant | 6 nelala tarvata result";
    const caption = String(parts.slice(1).join("|") || "").trim().slice(0, 200);
    const media = await photo.fetch();
    if (!media || media.tooBig) return "Photo download avvaledu / pedda undi 🙏 — malli pampandi.";
    // Gallery rows live forever, so keep them comfortably inside the KV
    // request limit (posting reuses the same key space with a TTL).
    if (media.base64.length > 1400000) return "Photo konchem pedda undi 🙏 — normal quality lo (WhatsApp compress chesindi) malli pampandi.";
    const imgId = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, media.base64]); // no TTL — gallery is permanent
    await guard.kvCommand(cfg, ["LPUSH", `gal:${tag}`, JSON.stringify({ imgId, caption, ts: Date.now() })]);
    await guard.kvCommand(cfg, ["LTRIM", `gal:${tag}`, "0", "5"]);
    await guard.kvCommand(cfg, ["SADD", "gal:_tags", tag]).catch(() => {});
    const n = await guard.kvCommand(cfg, ["LLEN", `gal:${tag}`]).catch(() => ({}));
    return `🖼 *Gallery lo add ayindi!*\n\n🏷 Tag: *${tag}* (ippudu ${n.result || 1} photo)\n${caption ? "✍️ " + caption + "\n" : ""}\nPatient "results ela untayi" ani adigithe ee photo automatic ga veltundi ✨\n\n⚠️ Patient consent unna photos matrame pettandi 🙏\nList: *results*`;
  }
  if (/^results?$/i.test(t) && !photo) {
    if (!cfg) return "Storage ledu.";
    const tg = await guard.kvCommand(cfg, ["SMEMBERS", "gal:_tags"]).catch(() => ({}));
    const tags = tg.result || [];
    if (!tags.length) return "🖼 Gallery khali.\n\nBefore/after photo pampi caption lo ila rayandi:\n*result: hair transplant | 6 nelala tarvata*\n\nPatient results adigithe avi automatic ga veltayi ✨";
    const lines = ["🖼 *Results gallery:*", ""];
    for (const tag of tags) {
      const n = await guard.kvCommand(cfg, ["LLEN", `gal:${tag}`]).catch(() => ({}));
      lines.push(`• *${tag}* — ${n.result || 0} photo`);
    }
    lines.push("", "Add: photo + 'result: <tag> | <caption>'", "Remove: results remove <tag>");
    return lines.join("\n");
  }
  let gm;
  if ((gm = t.match(/^results?\s+(?:remove|delete)\s+(.+)$/i))) {
    if (!cfg) return "Storage ledu.";
    const tag = gm[1].trim().toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const items = await guard.kvCommand(cfg, ["LRANGE", `gal:${tag}`, "0", "9"]).catch(() => ({}));
    for (const x of (items.result || [])) {
      try { await guard.kvCommand(cfg, ["DEL", `adm:img:${JSON.parse(x).imgId}`]); } catch (e) {}
    }
    await guard.kvCommand(cfg, ["DEL", `gal:${tag}`]).catch(() => {});
    await guard.kvCommand(cfg, ["SREM", "gal:_tags", tag]).catch(() => {});
    return `🗑 Gallery nunchi *${tag}* remove chesanu.`;
  }

  // ---- Doctor leave / blocked windows: agent won't offer these times ------
  let lm;
  if ((lm = t.match(/^(leave|block)\s+(.+)$/i))) {
    if (!cfg) return "Storage ledu.";
    const whole = lm[1].toLowerCase() === "leave";
    let rest = lm[2].trim();
    let note = "";
    const np = rest.split("|");
    if (np.length > 1) { rest = np[0].trim(); note = np.slice(1).join("|").trim().slice(0, 40); }
    // optional trailing time range: "2pm-5pm", "10-1", "10:30am - 1pm"
    let h1 = null, m1 = 0, h2 = null, m2 = 0;
    const rm = rest.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|nunchi)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i);
    if (rm && !whole) {
      h1 = +rm[1]; m1 = +(rm[2] || 0); h2 = +rm[4]; m2 = +(rm[5] || 0);
      const ap1 = (rm[3] || "").toLowerCase(), ap2 = (rm[6] || "").toLowerCase();
      if (ap1 === "pm" && h1 < 12) h1 += 12; if (ap1 === "am" && h1 === 12) h1 = 0;
      if (ap2 === "pm" && h2 < 12) h2 += 12; if (ap2 === "am" && h2 === 12) h2 = 0;
      if (!ap1 && !ap2 && h1 < 9) h1 += 12;   // "2-5" in clinic hours means PM
      if (!ap2 && h2 < h1) h2 += 12;
      rest = rest.slice(0, rm.index).trim();
    }
    const dayStart = parseDay(rest);
    if (dayStart === null) return `Roju ardham kaledu 🙏 — ila pampandi:\n*leave repu* (roju antha)\n*block repu 2pm-5pm*\n*leave 15-09 | Dr. Meghana leave*\n(today · repu · ellundi · 3d · 15-09 pani chestayi)`;
    const from = h1 === null ? dayStart + 9 * 3600000 : dayStart + (h1 * 60 + m1) * 60000;
    const to = h2 === null ? dayStart + 21 * 3600000 : dayStart + (h2 * 60 + m2) * 60000;
    if (to <= from) return "Time range thappu undi 🙏 — e.g. *block repu 2pm-5pm*";
    await guard.kvCommand(cfg, ["LPUSH", "blk:q", JSON.stringify({ from, to, note })]);
    await guard.kvCommand(cfg, ["LTRIM", "blk:q", "0", "49"]);
    return `🚫 *Block set ayindi*\n\n📅 ${fmtIst(from)} — ${fmtIst(to)}${note ? "\n📝 " + note : ""}\n\nAgent ee time lo appointments book cheyadu ✅\nList: *blocks* · Remove: *unblock <n>*`;
  }
  if (/^blocks?$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const b = await guard.kvCommand(cfg, ["LRANGE", "blk:q", "0", "49"]).catch(() => ({}));
    const now3 = Date.now();
    const items = (b.result || []).map((x) => { try { return { raw: x, v: JSON.parse(x) }; } catch (e) { return null; } })
      .filter((x) => x && x.v.to > now3).sort((a, b2) => a.v.from - b2.v.from);
    if (!items.length) return "🚫 Blocks em levu — clinic hours anni open.\n\nAdd: *leave repu* leda *block repu 2pm-5pm*";
    const lines = ["🚫 *Blocked times:*", ""];
    items.forEach((x, i) => lines.push(`${i + 1}. ${fmtIst(x.v.from)} — ${fmtIst(x.v.to)}${x.v.note ? " · " + x.v.note : ""}`));
    lines.push("", "Remove: unblock <number>");
    return lines.join("\n");
  }
  if ((lm = t.match(/^unblock\s+(\d{1,2})$/i))) {
    if (!cfg) return "Storage ledu.";
    const b = await guard.kvCommand(cfg, ["LRANGE", "blk:q", "0", "49"]).catch(() => ({}));
    const now3 = Date.now();
    const items = (b.result || []).map((x) => { try { return { raw: x, v: JSON.parse(x) }; } catch (e) { return null; } })
      .filter((x) => x && x.v.to > now3).sort((a, b2) => a.v.from - b2.v.from);
    const idx = Number(lm[1]) - 1;
    if (idx < 0 || idx >= items.length) return `Block #${lm[1]} ledu — *blocks* tho chudandi.`;
    await guard.kvCommand(cfg, ["LREM", "blk:q", "1", items[idx].raw]);
    return `✅ Block remove chesanu — ${fmtIst(items[idx].v.from)} ippudu open.`;
  }

  // ---- Referrals: who is bringing patients in ----------------------------
  if (/^referrals?$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const rows = await referral.leaderboard(cfg, 10);
    if (!rows.length) {
      return "🎁 *Referrals*\n\nInka evaru referral tho raaledu.\n\nPatients ki cheppandi: agent ki *REFER* ani type chesthe valla personal code vastundi 👍\nOffer marchali ante REFERRAL_OFFER env set cheyandi.";
    }
    const total = rows.reduce((a, r2) => a + r2.n, 0);
    const lines = [`🎁 *Referrals — total ${total} patients*`, ""];
    rows.forEach((r2, i) => lines.push(`${i + 1}. 📱 ${r2.ph} (${r2.code}) — *${r2.n}* pampincharu · last: ${r2.last.name || r2.last.ph}`));
    lines.push("", "Top referrers ki thank-you message pampandi 💖");
    return lines.join("\n");
  }

  // ---- Weekly marketing report (auto every Monday 9 AM; on demand here) ----
  if (/^weekly(\s*report)?$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const rep = await weekly.buildWeekly(cfg);
    return rep.body;
  }

  // ---- Patient ratings (visit_rating taps, day 2 after the visit) ---------
  if (/^reviews?(\s*report)?$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const r = await guard.kvCommand(cfg, ["LRANGE", "rv:log", "0", "199"]);
    const rows = (r.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter((x) => x && x.rating);
    if (!rows.length) return "⭐ Inka ratings raledu — prathi visit tarvata 2nd day patients ki rating buttons automatic ga veltayi.";
    const since = Date.now() - 30 * 86400000;
    const recent = rows.filter((x) => x.ts >= since);
    const base = recent.length ? recent : rows;
    const avg = (base.reduce((s, x) => s + Number(x.rating), 0) / base.length).toFixed(1);
    const dist = [5, 4, 3].map((n) => `${n}⭐ ${base.filter((x) => Number(x.rating) === n).length}`).join(" · ");
    const lines = [`⭐ *Patient Ratings — last 30 days*`, "", `Responses: *${base.length}* · avg *${avg}*`, dist, "", "Recent:"];
    rows.slice(0, 8).forEach((x) => lines.push(`${Number(x.rating) >= 4 ? "😊" : "⚠️"} ${x.rating}⭐ ${x.name || "?"} (${x.ph})${x.concern ? " · " + String(x.concern).slice(0, 24) : ""} · ${fmtIst(x.ts).split(",")[0]}`));
    const low = base.filter((x) => Number(x.rating) <= 3).length;
    lines.push("", low ? `⚠️ ${low} low rating(s) — owner/manager call chesi service recovery cheyandi 🙏` : "👏 Low ratings levu — great service!");
    if (!process.env.REVIEW_LINK) lines.push("ℹ️ Google review link inka set avvaledu (GBP verify ayyaka REVIEW_LINK pettandi) — 4-5⭐ vaallaki automatic ga veltundi.");
    return lines.join("\n");
  }

  // ---- Conversion funnel: enquiry → booking → arrived ---------------------
  if (/^funnel(\s*(week|month))?$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const days = /month/i.test(t) ? 30 : 7;
    const since = Date.now() - days * 86400000;
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]);
    const leads = (r.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } })
      .filter((l) => l && l.type !== "job" && l.ts >= since);
    const uniq = new Set(), booked = new Set(), byType = {};
    leads.forEach((l) => {
      const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
      if (ph.length === 10) uniq.add(ph);
      byType[l.type] = (byType[l.type] || 0) + 1;
      if (l.slot && l.date && ph.length === 10) booked.add(ph);
    });
    let arrived = 0, noshow = 0, pending = 0;
    const seenAppt = new Set();
    for (const key of ["appt:done", "appt:q"]) {
      const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "199"]).catch(() => ({}));
      for (const x of (q.result || [])) {
        try {
          const a = JSON.parse(x);
          if (!a.at || a.at < since) continue;
          const k = `${a.ph}:${a.at}`;
          if (seenAppt.has(k)) continue;
          seenAppt.add(k);
          if (a.ph) booked.add(a.ph);
          if (a.v) arrived++; else if (a.ns) noshow++; else if (key === "appt:q") pending++;
        } catch (e) {}
      }
    }
    const enq = uniq.size, bk = booked.size;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const bar = (n, total) => "▓".repeat(Math.max(1, Math.round((total ? n / total : 0) * 10))) ;
    const lines = [
      `📊 *Conversion Funnel — last ${days} days*`, "",
      `💬 Enquiries: *${enq}* ${bar(enq, enq)}`,
      `📅 Booked: *${bk}* (${pct(bk, enq)}%) ${bar(bk, enq)}`,
      `✅ Vachharu: *${arrived}* (${pct(arrived, bk)}% of bookings) ${bar(arrived, enq)}`,
    ];
    if (noshow) lines.push(`❌ Raaledu: *${noshow}*`);
    if (pending) lines.push(`⏳ Inka raavalsinavi: *${pending}*`);
    lines.push("", `📈 Enquiry → chair: *${pct(arrived, enq)}%*`);
    const chans = Object.keys(byType).map((k) => `${k}:${byType[k]}`).join(", ");
    if (chans) lines.push(`📲 Channels: ${chans}`);
    lines.push("");
    if (enq && pct(bk, enq) < 40) lines.push("💡 Booking % thakkuva — *reactivate* tho cold leads ni push cheyandi.");
    else if (bk && arrived && pct(arrived, bk) < 70) lines.push("💡 Book chesi raani vaallu ekkuva — visit roju call cheyandi, *noshow <phone>* mark cheyandi.");
    else if (enq) lines.push("💡 Baaga velthundi! Leads penchadaniki IG posts + *broadcast:* try cheyandi.");
    lines.push("Arrived mark: *arrived <phone>* · Full report: *report*");
    return lines.join("\n");
  }

  // ---- Week plan: batch-collect posts, auto-schedule across the week -------
  const wkKey = `adm:wk:${digits}`;
  if (/^week\s*plan$/i.test(t) && !photo && !video) {
    if (!cfg) return "Storage ledu.";
    await guard.kvCommand(cfg, ["SET", wkKey, JSON.stringify({ items: [] }), "EX", "21600"]);
    return "🗓 *Week Plan mode ON!*\n\nPhotos/videos okkokkati pampandi — prathi daani tho paatu caption lo idea rayandi (e.g. 'hydrafacial glow offer').\n\nAnni ayyaka *done* pampandi — nenu captions rasi, week antha auto-schedule chesta (roju 6:30 PM, Sunday skip) ✨\n\n*cancel* = mode close";
  }
  if (cfg) {
    const wkRaw = await guard.kvCommand(cfg, ["GET", wkKey]).catch(() => ({}));
    const wk = wkRaw && wkRaw.result ? JSON.parse(wkRaw.result) : null;
    if (wk) {
      if (/^cancel$/i.test(t) && !photo && !video) {
        await guard.kvCommand(cfg, ["DEL", wkKey]).catch(() => {});
        return "Week plan cancel chesanu 👍";
      }
      if (/^done$/i.test(t)) {
        await guard.kvCommand(cfg, ["DEL", wkKey]).catch(() => {});
        if (!wk.items.length) return "Photos em pampaledu 🙏 — malli *weekplan* tho start cheyandi.";
        const dues = nextDailySlots(wk.items.length);
        const lines = [`🗓 *Week Plan scheduled — ${wk.items.length} posts!*`, ""];
        for (let i = 0; i < wk.items.length; i++) {
          const it = wk.items[i];
          await guard.kvCommand(cfg, ["LPUSH", "adm:queue",
            JSON.stringify({ imgId: it.imgId, vidId: it.vidId, caption: it.caption, due: dues[i], by: digits, tries: 0 })]);
          if (it.imgId) {
            const secs = Math.max(3600, Math.ceil((dues[i] - Date.now()) / 1000) + 7200);
            await guard.kvCommand(cfg, ["EXPIRE", `adm:img:${it.imgId}`, String(secs)]).catch(() => {});
          }
          lines.push(`${i + 1}. ${fmtIst(dues[i])} ${it.vidId ? "🎬" : "📷"} ${String(it.caption).replace(/\n/g, " ").slice(0, 38)}…`);
        }
        lines.push("", "Auto-post avutayi ✅ · *queue* tho chudochu · *unschedule <n>* remove");
        return lines.join("\n");
      }
      if ((photo || video) && !/^(post|schedule|story|result)\s*[:\-]/i.test(t)) {
        if (wk.items.length >= 10) return "10 posts limit 🙏 — *done* pampandi.";
        const item = { caption: "" };
        if (video) {
          item.vidId = video.id;
          try { item.caption = await writeCaption(t, null, null); }
          catch (e) { return "Caption rayadam fail 🙏 — aa photo/video malli pampandi."; }
        } else {
          const media = await photo.fetch();
          if (!media || media.tooBig) return "Photo download avvaledu / pedda undi 🙏 — malli pampandi.";
          const imgId = crypto.randomBytes(16).toString("hex");
          await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, media.base64, "EX", "21600"]);
          item.imgId = imgId;
          try { item.caption = await writeCaption(t, media.base64, media.mime); }
          catch (e) { return "Caption rayadam fail 🙏 — aa photo malli pampandi."; }
        }
        wk.items.push(item);
        await guard.kvCommand(cfg, ["SET", wkKey, JSON.stringify(wk), "EX", "21600"]);
        return `✅ *Post #${wk.items.length} ready!*\n"${String(item.caption).replace(/\n/g, " ").slice(0, 90)}…"\n\nInka pampandi — anni ayyaka *done* 🗓`;
      }
    }
  }

  // Photo/video with "story:" → publish straight to Instagram Story (24h, no caption)
  if ((photo || video) && /^story\s*[:\-]?/i.test(t)) {
    if (!cfg) return "Storage lekapothe posting kudaradu.";
    const item = { story: true, caption: "" };
    if (video) {
      item.vidId = video.id;
    } else {
      const media = await photo.fetch();
      if (!media || media.tooBig) return "Photo download avvaledu / chala pedda undi 🙏 — malli pampandi.";
      const imgId = crypto.randomBytes(16).toString("hex");
      await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, media.base64, "EX", "3600"]);
      item.imgId = imgId;
    }
    const out = await publishNow(cfg, item);
    if (out.ok) return "✅ *Story live!* @dermaluxe.ai 📱 (24 gantalu kanipistundi)";
    if (out.transient && out.creationId) {
      item.creationId = out.creationId;
      await guard.kvCommand(cfg, ["SET", `adm:post:${digits}`, JSON.stringify(item), "EX", "3600"]);
      return "🎬 Story processing lo undi — 1 nimisham agi *ok* pampandi.";
    }
    return out.transient
      ? "Story publish fail ayindi 🙏 — 30 seconds agi malli try cheyandi."
      : `Story publish kudaraledu: ${out.msg} 🙏`;
  }

  // Photo/video with "schedule: <when> | <idea>" → preview, then "ok" queues it
  if ((photo || video) && /^schedule\s*[:\-]?/i.test(t)) {
    if (!cfg) return "Storage lekapothe scheduling kudaradu.";
    const body = t.replace(/^schedule\s*[:\-]?\s*/i, "");
    const parts = body.split("|");
    const due = parseWhen(parts[0]);
    if (!due) return "Time ardham kaledu 🙏 — ila pampandi:\nschedule: tomorrow 6pm | hydrafacial offer\n(today 7:30pm, 15-08 11am kuda ok)";
    if (video && due > Date.now() + 25 * 86400000) return "Video schedule 25 rojula lopu matrame kudurutundi 🙏 — closer date pettandi.";
    const idea = parts.slice(1).join("|").trim();
    const pendingObj = { caption: "", due, ts: Date.now() };
    if (video) {
      pendingObj.vidId = video.id;
      try { pendingObj.caption = await writeCaption(idea, null, null); }
      catch (e) { console.error("adm: caption", e.message); return "Caption rayadam fail ayindi — malli try cheyandi."; }
    } else {
      const media = await photo.fetch();
      if (!media || media.tooBig) return "Photo download avvaledu / chala pedda undi 🙏 — malli pampandi.";
      const imgId = crypto.randomBytes(16).toString("hex");
      await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, media.base64, "EX", "3600"]);
      pendingObj.imgId = imgId;
      try { pendingObj.caption = await writeCaption(idea, media.base64, media.mime); }
      catch (e) { console.error("adm: caption", e.message); return "Caption rayadam fail ayindi — malli try cheyandi."; }
    }
    await guard.kvCommand(cfg, ["SET", `adm:post:${digits}`, JSON.stringify(pendingObj), "EX", "3600"]);
    return confirmable(`⏰ *${video ? "Reel schedule" : "Schedule"} preview* — ${fmtIst(due)} IST\n\n${pendingObj.caption}\n\n${PREVIEW_OPTIONS}`);
  }
  if (/^(insta|ig)\s*report$/i.test(t)) {
    try { return await instaReport(cfg, owner); } catch (e) { console.error("adm: insta report", e.message); return "Report fail: " + e.message.slice(0, 120); }
  }
  if (/^leads?(\s*report)?(\s*(today|week))?$/i.test(t) && /lead/i.test(t)) {
    try { return await leadsReport(cfg, t); } catch (e) { console.error("adm: leads report", e.message); return "Leads report fail ayindi."; }
  }

  // Photo/video with "post: idea" caption → build preview (video = Reel)
  if ((photo || video) && /^post\s*[:\-]?/i.test(t)) {
    if (!cfg) return "Storage lekapothe posting kudaradu.";
    const idea = t.replace(/^post\s*[:\-]?\s*/i, "");
    const pendingObj = { caption: "", ts: Date.now() };
    if (video) {
      pendingObj.vidId = video.id;
      try { pendingObj.caption = await writeCaption(idea, null, null); }
      catch (e) { console.error("adm: caption", e.message); return "Caption rayadam fail ayindi — malli try cheyandi."; }
    } else {
      const media = await photo.fetch();
      if (!media || media.tooBig) return "Photo download avvaledu / chala pedda undi 🙏 — malli pampandi.";
      const imgId = crypto.randomBytes(16).toString("hex");
      await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, media.base64, "EX", "3600"]);
      pendingObj.imgId = imgId;
      try { pendingObj.caption = await writeCaption(idea, media.base64, media.mime); }
      catch (e) { console.error("adm: caption", e.message); return "Caption rayadam fail ayindi — malli try cheyandi."; }
    }
    await guard.kvCommand(cfg, ["SET", `adm:post:${digits}`, JSON.stringify(pendingObj), "EX", "3600"]);
    return confirmable(`${video ? "🎬 *Reel caption preview:*" : "📸 *Caption preview:*"}\n\n${pendingObj.caption}\n\n${PREVIEW_OPTIONS}`);
  }

  // Keyword campaigns: posts say "Reply GLOW" → the agent answers with the
  // campaign offer and counts the hit. Both tiers can manage campaigns.
  let km;
  if ((km = t.match(/^campaign\s*[:\-]\s*([a-z0-9]{2,16})\s*\|\s*([\s\S]{3,600})$/i))) {
    if (!cfg) return "Storage ledu.";
    const word = km[1].toLowerCase();
    await guard.kvCommand(cfg, ["SET", `camp:${word}`, JSON.stringify({ reply: km[2].trim().slice(0, 600), by: digits, ts: Date.now() }), "EX", "7776000"]);
    await guard.kvCommand(cfg, ["SADD", "camp:_set", word]).catch(() => {});
    return `🎯 Campaign *${word.toUpperCase()}* ready!\nPosts/stories lo rayandi: "Reply *${word.toUpperCase()}* on WhatsApp 99591 34666"\nEvaraina aa word pampite offer reply veltundi + count avtundi.\n'campaigns' — list · 'campaign remove ${word}' — stop.`;
  }
  if (/^campaigns$/i.test(t)) {
    if (!cfg) return "Storage ledu.";
    const s = await guard.kvCommand(cfg, ["SMEMBERS", "camp:_set"]).catch(() => ({}));
    const words = (s.result || []);
    if (!words.length) return "Campaigns em levu — 'campaign: GLOW | <offer reply>' tho create cheyandi.";
    const lines = ["🎯 *Active campaigns:*"];
    for (const w of words) {
      let hits = 0;
      for (let d = 0; d < 7; d++) {
        const key = `camphit:${w}:${new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)}`;
        try { const v = await guard.kvCommand(cfg, ["GET", key]); hits += Number(v.result || 0); } catch (e) {}
      }
      lines.push(`• ${w.toUpperCase()} — 7d hits: ${hits}`);
    }
    lines.push("", "Remove: campaign remove <word>");
    return lines.join("\n");
  }
  if ((km = t.match(/^campaign\s+(?:remove|stop|delete)\s+([a-z0-9]{2,16})$/i))) {
    if (!cfg) return "Storage ledu.";
    const word = km[1].toLowerCase();
    await guard.kvCommand(cfg, ["DEL", `camp:${word}`]).catch(() => {});
    await guard.kvCommand(cfg, ["SREM", "camp:_set", word]).catch(() => {});
    return `🗑 Campaign ${word.toUpperCase()} removed.`;
  }

  // ---- Broadcast: owner sends a paid template message to past patients ----
  // Uses the clinic_update MARKETING template (works outside the 24h window),
  // skips STOP opt-outs, dedupes phones, excludes job applicants.
  if (/^broadcast$/i.test(t)) {
    if (!owner) return "🔒 Broadcast owner ki matrame.";
    return "📣 *Broadcast — pata patients ki offer pampadam*\n\nAndariki:\nbroadcast: Ee week Hydrafacial pai special offer! 😍\n\nOka segment ki matrame:\nbroadcast hair: Hair transplant free consultation ee week!\n(hair / skin / laser / acne / bridal — concern match ayina vallake)\n\n• Template message ga veltundi (24h window avasaram ledu)\n• STOP cheppina patients ki veladu\n• Approx ₹0.80 per message charge";
  }
  // broadcast: <offer>  — everyone;  broadcast hair: <offer> — only leads
  // whose concern/treatments mention that word (waste spend down, relevance up)
  let bm;
  if ((bm = t.match(/^broadcast(?:\s+([a-z]{3,20}))?\s*[:\-]\s*([\s\S]{10,550})$/i))) {
    if (!owner) return "🔒 Broadcast owner ki matrame.";
    if (!cfg) return "Storage ledu.";
    const seg = (bm[1] || "").toLowerCase();
    const targets = await bcTargets(cfg, seg);
    if (!targets.length) {
      return seg
        ? `'${seg}' concern tho patients evaru dorakaledu.\nTry: broadcast hair: / broadcast skin: / broadcast laser: — leda andariki: broadcast: <offer>`
        : "Broadcast ki patients evaru leru inka — leads lo phone numbers unte veltundi.";
    }
    const msg = bm[2].trim();
    await guard.kvCommand(cfg, ["SET", `adm:bc:${digits}`, JSON.stringify({ text: msg, targets, seg }), "EX", "900"]);
    return confirmable(`📣 *Broadcast preview* — *${targets.length}*${seg ? ` '${seg}'` : ""} patients ki veltundi:\n\n"Hi <name>! ✨ DermaLuxe by Medicare, Eluru nunchi update:\n\n${msg}\n\n📲 Appointment ki ee message ki reply cheyandi..."\n\n💰 Approx ₹${Math.ceil(targets.length * 0.8)} charge · STOP patients auto-skip\n\n✅ *ok* — pampu · ❌ *cancel*`);
  }

  // ---- Ready-made promo broadcasts (owner): festival/flash/launch/camp ----
  // Same preview→ok flow as broadcast, but a dedicated MARKETING template
  // carries the design — the owner only types the offer.
  if (/^(festival|flash|launch|camp|tips)$/i.test(t)) {
    if (!owner) return "🔒 Promo broadcasts owner ki matrame.";
    return "🎁 *Promo broadcasts — ready-made designs:*\n\n🪔 " + PROMO_DEFS.festival_offer.usage
      + "\n\n⚡ " + PROMO_DEFS.flash_offer.usage
      + "\n\n🎉 " + PROMO_DEFS.new_service.usage
      + "\n\n🩺 " + PROMO_DEFS.free_camp.usage
      + "\n\n🌿 " + PROMO_DEFS.seasonal_tips.usage
      + "\n\nPreview vachaka *ok* antene veltundi · STOP patients auto-skip";
  }
  const mkPromo = async (tpl, promoText, p2) => {
    if (!owner) return "🔒 Promo broadcasts owner ki matrame.";
    if (!cfg) return "Storage ledu.";
    const targets = await bcTargets(cfg, "");
    if (!targets.length) return "Patients evaru leru inka — leads lo phone numbers unte veltundi.";
    await guard.kvCommand(cfg, ["SET", `adm:bc:${digits}`, JSON.stringify({ text: promoText, targets, tpl, p2 }), "EX", "900"]);
    return confirmable(`📣 *Promo preview* — *${targets.length}* patients ki veltundi:\n\n"${PROMO_DEFS[tpl].render(promoText, p2)}"\n\n💰 Approx ₹${Math.ceil(targets.length * 0.8)} · STOP patients auto-skip\n\n✅ *ok* — pampu · ❌ *cancel*`);
  };
  let pm;
  if ((pm = t.match(/^festival\s*[:\-]\s*([^|]{2,40})\|\s*([\s\S]{10,500})$/i))) {
    return mkPromo("festival_offer", pm[2].trim(), pm[1].trim());
  }
  if ((pm = t.match(/^flash\s*[:\-]\s*([\s\S]{10,500}?)\|\s*([^|]{2,60})$/i))) {
    return mkPromo("flash_offer", pm[1].trim(), pm[2].trim());
  }
  if ((pm = t.match(/^launch\s*[:\-]\s*([^|]{2,60})\|\s*([\s\S]{5,500})$/i))) {
    return mkPromo("new_service", pm[2].trim(), pm[1].trim());
  }
  if ((pm = t.match(/^camp\s*[:\-]\s*([\s\S]{10,500})$/i))) {
    return mkPromo("free_camp", pm[1].trim(), "");
  }
  if ((pm = t.match(/^tips\s*[:\-]\s*([\s\S]{10,500})$/i))) {
    return mkPromo("seasonal_tips", pm[1].trim(), "");
  }
  if (/^(festival|flash|launch)\s*[:\-]/i.test(t)) {
    const which = t.match(/^(festival|flash|launch)/i)[1].toLowerCase();
    const key = which === "festival" ? "festival_offer" : which === "flash" ? "flash_offer" : "new_service";
    return `Format konchem alaga undali 🙏 — '|' tho rendu parts:\n\n${PROMO_DEFS[key].usage}`;
  }

  // ---- Reactivate: one paid follow-up to 3-10 day old silent leads --------
  if (/^reactivate$/i.test(t)) {
    if (!owner) return "🔒 Reactivate owner ki matrame.";
    if (!cfg) return "Storage ledu.";
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]);
    const opt = await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}));
    const optSet = new Set(opt.result || []);
    // anyone with a booking on file is not "cold"
    const booked = new Set();
    for (const key of ["appt:q", "appt:done"]) {
      const q = await guard.kvCommand(cfg, ["LRANGE", key, "0", "199"]).catch(() => ({}));
      for (const s of (q.result || [])) { try { booked.add(JSON.parse(s).ph); } catch (e) {} }
    }
    const now2 = Date.now(); const seen = new Set(); const targets = [];
    for (const s of (r.result || [])) {
      let l; try { l = JSON.parse(s); } catch (e) { continue; }
      if (!l || l.type === "job" || (l.slot && l.date)) continue;
      const age = now2 - (l.ts || 0);
      if (age < 3 * 86400000 || age > 10 * 86400000) continue;
      const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
      if (ph.length !== 10 || seen.has(ph) || optSet.has(ph) || booked.has(ph)) continue;
      seen.add(ph);
      targets.push({ ph, name: String(l.name || "").trim().split(" ")[0] || "friend", concern: String(l.concern || "").slice(0, 50), src: l.type || "" });
    }
    if (!targets.length) return "🧊 Cold leads (3-10 rojulu, book cheyani) evaru leru — good sign! 👍";
    await guard.kvCommand(cfg, ["SET", `adm:rc:${digits}`, JSON.stringify({ targets }), "EX", "900"]);
    return confirmable(`🧊 *Reactivation preview* — *${targets.length}* cold leads (3-10 rojula nunchi silent):\n\n${targets.slice(0, 5).map((x) => `— ${x.name} (${x.concern || "general"})`).join("\n")}${targets.length > 5 ? `\n… +${targets.length - 5} more` : ""}\n\nOkkokkariki valla concern tho personalized follow-up veltundi.\n💰 Approx ₹${Math.ceil(targets.length * 0.8)} · STOP patients auto-skip\n\n✅ *ok* — pampu · ❌ *cancel*`);
  }

  // review <10-digit> — sends the Google-review ask to a patient (post-visit).
  if ((km = t.match(/^review\s+(\d{10})$/i))) {
    if (!process.env.REVIEW_LINK) return "REVIEW_LINK inka set avvaledu — Google Business Profile verify ayyaka ee feature on chestam.";
    const ok = await notify.sendWa(km[1],
      `Thank you for visiting DermaLuxe! 💖 Mee experience baga unte oka Google review ivvagalara? 🙏\n⭐ ${process.env.REVIEW_LINK}\nMee feedback tho memu inka improve avutam!`);
    return ok ? `✅ Review request ${km[1]} ki vellindi.`
      : `❌ Deliver avvaledu — aa patient 24h lo agent tho chat cheyakapothe message veladu. Vallu manaki last message pampi 24h dati unte, valle mundu em aina pampaka malli try cheyandi.`;
  }

  // Bare "change" (the ✏️ button) → ask for the correction text
  if (/^(change|edit|marchu)$/i.test(t)) {
    if (!cfg) return null;
    const pRaw0 = await guard.kvCommand(cfg, ["GET", `adm:post:${digits}`]).catch(() => ({}));
    if (!pRaw0 || !pRaw0.result) return null;
    return "✏️ Em marchalo type chesi pampandi:\nchange: <mee correction>\n\nE.g. change: telugu line ekkuva pettu, offer bold ga cheppu";
  }

  // change:/add: — revise the pending caption with AI (marketing correction loop)
  let cm;
  if ((cm = t.match(/^(change|edit|add|marchu|marchandi)\s*[:\-]\s*([\s\S]+)$/i))) {
    if (!cfg) return null;
    const pRaw = await guard.kvCommand(cfg, ["GET", `adm:post:${digits}`]);
    if (!pRaw.result) return null; // no pending post → normal agent handles it
    const pending = JSON.parse(pRaw.result);
    try {
      pending.caption = await reviseCaption(pending.caption, t);
      delete pending.creationId; // caption changed → any half-built IG container is stale
      await guard.kvCommand(cfg, ["SET", `adm:post:${digits}`, JSON.stringify(pending), "EX", "3600"]);
      return confirmable(`✏️ *Kotha caption:*\n\n${pending.caption}\n\n${PREVIEW_OPTIONS}`);
    } catch (e) {
      console.error("adm: revise", e.message);
      return "Caption marchadam fail ayindi 🙏 — malli 'change: <...>' pampandi.";
    }
  }

  // ok / cancel — only meaningful when a post or a broadcast is pending
  if (/^(ok|yes|post)$/i.test(t) || /^(cancel|no|vaddu)$/i.test(t)) {
    if (!cfg) return null;
    const pRaw = await guard.kvCommand(cfg, ["GET", `adm:post:${digits}`]);
    if (pRaw.result) {
      if (/^(cancel|no|vaddu)$/i.test(t)) {
        await guard.kvCommand(cfg, ["DEL", `adm:post:${digits}`]).catch(() => {});
        return "❌ Post cancel chesanu.";
      }
      try { return await publishPending(cfg, digits); }
      catch (e) { console.error("adm: publish", e.message); return "Publish error: " + e.message.slice(0, 120); }
    }
    const bRaw = await guard.kvCommand(cfg, ["GET", `adm:bc:${digits}`]).catch(() => ({}));
    if (bRaw && bRaw.result) {
      await guard.kvCommand(cfg, ["DEL", `adm:bc:${digits}`]).catch(() => {});
      if (/^(cancel|no|vaddu)$/i.test(t)) return "❌ Broadcast cancel chesanu.";
      const bc = JSON.parse(bRaw.result);
      // First 80 go out right now (fits the 60s budget); the rest drain via
      // cron-post at ~30 per 10-min run with a completion ping when done.
      let sent = 0, fail = 0;
      const bcTpl = bc.tpl || "clinic_update";
      for (const tg of bc.targets.slice(0, 80)) {
        const out = await notify.sendWaTemplate(tg.ph, bcTpl, promoParams(bcTpl, tg.name, bc.text, bc.p2));
        if (out.ok) sent++; else fail++;
      }
      const rest = bc.targets.slice(80);
      if (rest.length) {
        for (const tg of rest) {
          await guard.kvCommand(cfg, ["LPUSH", "bc:q", JSON.stringify({ ph: tg.ph, name: tg.name, text: bc.text, tpl: bc.tpl, p2: bc.p2 })]).catch(() => {});
        }
        await guard.kvCommand(cfg, ["SET", "bc:meta", JSON.stringify({ total: rest.length, by: digits }), "EX", "86400"]).catch(() => {});
        await guard.kvCommand(cfg, ["SET", "bc:done", "0", "EX", "86400"]).catch(() => {});
      }
      return `📣 *Broadcast:* ${sent} patients ki vellindi ✅${fail ? `\n⚠️ ${fail} fail (template approve avvakapothe anni fail avtayi — konchem agi malli try cheyandi)` : ""}${rest.length ? `\n⏳ ${rest.length} queue lo — 10-15 min lo veltayi, ayyaka cheptha` : ""}`;
    }
    const rcRaw = await guard.kvCommand(cfg, ["GET", `adm:rc:${digits}`]).catch(() => ({}));
    if (rcRaw && rcRaw.result) {
      await guard.kvCommand(cfg, ["DEL", `adm:rc:${digits}`]).catch(() => {});
      if (/^(cancel|no|vaddu)$/i.test(t)) return "❌ Reactivation cancel chesanu.";
      const rc = JSON.parse(rcRaw.result);
      let sent = 0, fail = 0;
      for (const tg of rc.targets.slice(0, 80)) {
        const line = tg.concern
          ? `Meeru '${tg.concern}' gurinchi adigaru kada — inka interest unte ee week doctor slots available unnayi. Book cheyalante mee convenient time reply cheyandi 😊`
          : `Meeru mana treatments gurinchi adigaru kada — ee week doctor slots available unnayi. Book cheyalante mee convenient time reply cheyandi 😊`;
        // Instagram-origin leads get the insta-flavored template (falls back
        // to the generic one if that template isn't approved yet).
        const tpl = tg.src === "instagram" ? "insta_lead_followup" : "clinic_update";
        let out = await notify.sendWaTemplate(tg.ph, tpl, [tg.name, line]);
        if (!out.ok && tpl !== "clinic_update") out = await notify.sendWaTemplate(tg.ph, "clinic_update", [tg.name, line]);
        if (out.ok) sent++; else fail++;
      }
      return `🧊 *Reactivation:* ${sent} leads ki vellindi ✅${fail ? ` · ${fail} fail` : ""}\nEvaraina reply istey ventane lead alert vastundi 🔥`;
    }
    return null; // nothing pending → normal agent
  }

  return null; // not an admin command → normal patient flow
}

module.exports = { isAdmin, handle, publishNow, fmtIst, promoParams };
