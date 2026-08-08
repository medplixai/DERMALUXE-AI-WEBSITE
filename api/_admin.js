// Owner/admin commands for the WhatsApp agent (allowlisted numbers only).
//   help                     – command list
//   insta report             – IG followers + last posts + boost suggestion
//   leads report [today|week]– lead pipeline summary
//   [photo] post: <idea>     – AI caption → preview → "ok" publishes to IG
// Not a command → returns null and the normal patient flow continues.
const crypto = require("crypto");
const guard = require("./_guard.js");
const notify = require("./_notify.js");

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
      model: process.env.AI_MODEL || "claude-sonnet-5",
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
      body = { media_type: "REELS", video_url: signedWaUrl(item.vidId), caption: item.caption, share_to_feed: true };
    } else {
      try {
        const img = await guard.kvCommand(cfg, ["GET", `adm:img:${item.imgId}`]);
        if (!img || !img.result) return { ok: false, transient: false, msg: "image expired" };
      } catch (e) {}
      body = { image_url: `https://www.dermaluxe.ai/api/media?id=${item.imgId}`, caption: item.caption };
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
  try { fb = await fbCrossPost(cfg, item); } catch (e) {}
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
  return `✅ *${pending.vidId ? "Reel" : "Post"} live!* @dermaluxe.ai${out.fb ? " + 📘 FB page" : ""}${out.link ? "\n" + out.link : ""}`;
}

// Main entry — returns reply text, or null when the message is not an admin command.
async function handle(cfg, digits, text, photo, video) {
  const who = adminRole(digits);
  if (!who) return null;
  const owner = who === "owner";
  const t = String(text || "").trim();

  // HR tier sees only the hiring side; anything else falls to the normal agent.
  if (who === "hr" && !/^(help|commands|jobs)/i.test(t)) return null;
  if (who === "hr" && /^(help|commands)$/i.test(t)) {
    return { text: "🛠 *HR commands*\n• jobs report — last 7 days applications\n• jobs report month — last 30 days\n\nCandidates apply link: dermaluxe.ai/r/jobs", menuRows: ["jobs report", "jobs report month"] };
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
    apps.slice(0, 10).forEach((a) => lines.push(`— ${a.name} · ${String(a.concern || "").slice(0, 40)} · 📱 ${a.phone}${a.cv_media_id ? " · 📄CV" : ""}`));
    if (!apps.length) lines.push("(applications em ravaledu)", "", "Promote link: dermaluxe.ai/r/jobs");
    else lines.push("", "Dashboard: dermaluxe.ai/leads.html");
    return lines.join("\n");
  }

  if (/^(help|commands)$/i.test(t)) {
    const lines = ["🛠 *Admin commands*",
      "• 📷 photo / 🎬 video + 'post: <idea>' — AI caption → post (video = Reel)",
      "• 📷/🎬 + 'schedule: tomorrow 6pm | <idea>' — auto-post later",
      "• campaign: GLOW | <offer reply> — keyword campaign",
      "• review <phone> — patient ki Google review ask",
      "• unschedule <n> — scheduled post remove",
      "",
      "Reports ki 👇 list nunchi tap cheyandi:"];
    const menuRows = ["insta report", "leads report", "leads report week", "ideas", "queue", "campaigns"];
    if (owner) menuRows.splice(2, 0, "marketing report");
    return { text: lines.join("\n"), menuRows };
  }

  if (/^ideas?$/i.test(t)) {
    try {
      const today = fmtIst(Date.now());
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.AI_MODEL || "claude-sonnet-5",
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
            model: process.env.AI_MODEL || "claude-sonnet-5",
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

  // ok / cancel — only meaningful when a post is pending
  if (/^(ok|yes|post)$/i.test(t) || /^(cancel|no|vaddu)$/i.test(t)) {
    if (!cfg) return null;
    const pRaw = await guard.kvCommand(cfg, ["GET", `adm:post:${digits}`]);
    if (!pRaw.result) return null; // no pending → let the normal agent answer
    if (/^(cancel|no|vaddu)$/i.test(t)) {
      await guard.kvCommand(cfg, ["DEL", `adm:post:${digits}`]).catch(() => {});
      return "❌ Post cancel chesanu.";
    }
    try { return await publishPending(cfg, digits); }
    catch (e) { console.error("adm: publish", e.message); return "Publish error: " + e.message.slice(0, 120); }
  }

  return null; // not an admin command → normal patient flow
}

module.exports = { isAdmin, handle, publishNow, fmtIst };
