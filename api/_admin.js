// Owner/admin commands for the WhatsApp agent (allowlisted numbers only).
//   help                     – command list
//   insta report             – IG followers + last posts + boost suggestion
//   leads report [today|week]– lead pipeline summary
//   [photo] post: <idea>     – AI caption → preview → "ok" publishes to IG
// Not a command → returns null and the normal patient flow continues.
const crypto = require("crypto");
const guard = require("./_guard.js");

const IG_GRAPH = "https://graph.instagram.com/v21.0";

function isAdmin(digits) {
  const list = String(process.env.ADMIN_PHONES || "").split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter(Boolean);
  return list.indexOf(String(digits)) !== -1;
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

async function instaReport(cfg) {
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
  if (best) {
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
async function writeCaption(idea, imageB64, mime) {
  const content = [];
  if (imageB64) content.push({ type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: imageB64 } });
  content.push({ type: "text", text: `Post idea from the clinic owner: ${idea || "(none — describe the photo)"}` });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "claude-sonnet-5",
      max_tokens: 600,
      system: `You write Instagram captions for DermaLuxe by Medicare — premium skin/hair/aesthetics clinic, Eluru (MD dermatologists, USFDA tech). Style: premium yet warm; 3-6 short lines; English with a Telugu line; NEVER prices; end with CTA "📲 Book: 99591 34666 (WhatsApp) · www.dermaluxe.ai" then 6-9 hashtags mixing #DermaLuxe #DermaLuxeEluru #EluruSkinClinic #skincare + topic tags. Output ONLY JSON: {"caption":"..."}`,
      messages: [{ role: "user", content }],
    }),
  });
  if (!resp.ok) throw new Error(`claude HTTP ${resp.status}`);
  const data = await resp.json();
  const t = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
  try { const m = t.match(/\{[\s\S]*\}/); const p = JSON.parse(m ? m[0] : t); if (p && p.caption) return String(p.caption).slice(0, 2000); } catch (e) {}
  return t.slice(0, 2000);
}

async function publishPending(cfg, digits) {
  const pRaw = await guard.kvCommand(cfg, ["GET", `adm:post:${digits}`]);
  if (!pRaw.result) return "Pending post em ledu. Photo + 'post: <idea>' pampandi.";
  const pending = JSON.parse(pRaw.result);
  const tok = await igToken(cfg);
  if (!tok) return "IG token ledu — publish cheyalekapotunna.";
  const imageUrl = `https://www.dermaluxe.ai/api/media?id=${pending.imgId}`;
  const c = await fetch(`${IG_GRAPH}/me/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ image_url: imageUrl, caption: pending.caption }),
  });
  const cd = await c.json().catch(() => ({}));
  if (!c.ok || !cd.id) {
    console.error("adm: container failed", c.status, JSON.stringify(cd).slice(0, 200));
    return "Post container fail ayindi 🙏 — konchem sepu agi malli 'ok' try cheyandi.";
  }
  const p = await fetch(`${IG_GRAPH}/me/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ creation_id: cd.id }),
  });
  const pd = await p.json().catch(() => ({}));
  if (!p.ok || !pd.id) {
    console.error("adm: publish failed", p.status, JSON.stringify(pd).slice(0, 200));
    return "Publish fail ayindi 🙏 — malli try cheyandi (image processing lo undochu, 30s agandi).";
  }
  await guard.kvCommand(cfg, ["DEL", `adm:post:${digits}`]).catch(() => {});
  let link = "";
  try { const perm = await igGet(`/${pd.id}?fields=permalink`, tok); link = perm.permalink || ""; } catch (e) {}
  return `✅ *Post live!* @dermaluxe.ai${link ? "\n" + link : ""}`;
}

// Main entry — returns reply text, or null when the message is not an admin command.
async function handle(cfg, digits, text, photo) {
  if (!isAdmin(digits)) return null;
  const t = String(text || "").trim();

  if (/^(help|commands)$/i.test(t)) {
    return ["🛠 *Admin commands*",
      "• insta report — IG stats + boost tip",
      "• leads report [week] — lead summary",
      "• 📷 photo + caption 'post: <idea>' — AI caption preview",
      "• ok — publish pending post · cancel — discard",
      "(migatha messages normal agent laga panichestai)"].join("\n");
  }
  if (/^(insta|ig)\s*report$/i.test(t)) {
    try { return await instaReport(cfg); } catch (e) { console.error("adm: insta report", e.message); return "Report fail: " + e.message.slice(0, 120); }
  }
  if (/^leads?(\s*report)?(\s*(today|week))?$/i.test(t) && /lead/i.test(t)) {
    try { return await leadsReport(cfg, t); } catch (e) { console.error("adm: leads report", e.message); return "Leads report fail ayindi."; }
  }

  // Photo with "post: idea" caption → build preview
  if (photo && /^post\s*[:\-]?/i.test(t)) {
    if (!cfg) return "Storage lekapothe posting kudaradu.";
    const idea = t.replace(/^post\s*[:\-]?\s*/i, "");
    const media = await photo.fetch();
    if (!media || media.tooBig) return "Photo download avvaledu / chala pedda undi 🙏 — malli pampandi.";
    const imgId = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, media.base64, "EX", "3600"]);
    let caption;
    try { caption = await writeCaption(idea, media.base64, media.mime); }
    catch (e) { console.error("adm: caption", e.message); return "Caption rayadam fail ayindi — malli try cheyandi."; }
    await guard.kvCommand(cfg, ["SET", `adm:post:${digits}`, JSON.stringify({ imgId, caption, ts: Date.now() }), "EX", "3600"]);
    return `📸 *Caption preview:*\n\n${caption}\n\n✅ Post cheyala? Reply: *ok*\n❌ Vaddu ante: *cancel*`;
  }

  // ok / cancel — only meaningful when a post is pending
  if (/^(ok|yes|post)$/i.test(t) || /^cancel$/i.test(t)) {
    if (!cfg) return null;
    const pRaw = await guard.kvCommand(cfg, ["GET", `adm:post:${digits}`]);
    if (!pRaw.result) return null; // no pending → let the normal agent answer
    if (/^cancel$/i.test(t)) {
      await guard.kvCommand(cfg, ["DEL", `adm:post:${digits}`]).catch(() => {});
      return "❌ Post cancel chesanu.";
    }
    try { return await publishPending(cfg, digits); }
    catch (e) { console.error("adm: publish", e.message); return "Publish error: " + e.message.slice(0, 120); }
  }

  return null; // not an admin command → normal patient flow
}

module.exports = { isAdmin, handle };
