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

// Core publisher — used by the immediate "ok" flow and the schedule cron.
// Returns {ok:true, link} | {ok:false, transient, msg}.
async function publishNow(cfg, imgId, caption) {
  const tok = await igToken(cfg);
  if (!tok) return { ok: false, transient: false, msg: "IG token ledu" };
  try {
    const img = await guard.kvCommand(cfg, ["GET", `adm:img:${imgId}`]);
    if (!img || !img.result) return { ok: false, transient: false, msg: "image expired" };
  } catch (e) {}
  const imageUrl = `https://www.dermaluxe.ai/api/media?id=${imgId}`;
  const c = await fetch(`${IG_GRAPH}/me/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ image_url: imageUrl, caption }),
  });
  const cd = await c.json().catch(() => ({}));
  if (!c.ok || !cd.id) {
    console.error("adm: container failed", c.status, JSON.stringify(cd).slice(0, 200));
    return { ok: false, transient: true, msg: "container fail" };
  }
  let ready = false;
  for (let i = 0; i < 13; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const st = await igGet(`/${cd.id}?fields=status_code`, tok);
      if (st.status_code === "FINISHED") { ready = true; break; }
      if (st.status_code === "ERROR") {
        console.error("adm: container status ERROR");
        return { ok: false, transient: false, msg: "image processing error (photo IG ki nachaledu — JPEG best)" };
      }
    } catch (e) {}
  }
  if (!ready) return { ok: false, transient: true, msg: "image inka processing lo undi" };
  let p = await fetch(`${IG_GRAPH}/me/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ creation_id: cd.id }),
  });
  let pd = await p.json().catch(() => ({}));
  if (!p.ok && pd && pd.error && pd.error.code === 9007) {
    await new Promise((r) => setTimeout(r, 8000));
    p = await fetch(`${IG_GRAPH}/me/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ creation_id: cd.id }),
    });
    pd = await p.json().catch(() => ({}));
  }
  if (!p.ok || !pd.id) {
    console.error("adm: publish failed", p.status, JSON.stringify(pd).slice(0, 200));
    return { ok: false, transient: true, msg: "publish fail" };
  }
  let link = "";
  try { const perm = await igGet(`/${pd.id}?fields=permalink`, tok); link = perm.permalink || ""; } catch (e) {}
  return { ok: true, link };
}

async function publishPending(cfg, digits) {
  const pRaw = await guard.kvCommand(cfg, ["GET", `adm:post:${digits}`]);
  if (!pRaw.result) return "Pending post em ledu. Photo + 'post: <idea>' pampandi.";
  const pending = JSON.parse(pRaw.result);

  // Scheduled preview → queue it for the cron instead of publishing now.
  if (pending.due) {
    await guard.kvCommand(cfg, ["LPUSH", "adm:queue",
      JSON.stringify({ imgId: pending.imgId, caption: pending.caption, due: pending.due, by: digits, tries: 0 })]);
    const secs = Math.max(3600, Math.ceil((pending.due - Date.now()) / 1000) + 7200);
    await guard.kvCommand(cfg, ["EXPIRE", `adm:img:${pending.imgId}`, String(secs)]).catch(() => {});
    await guard.kvCommand(cfg, ["DEL", `adm:post:${digits}`]).catch(() => {});
    return `⏰ *Scheduled!* ${fmtIst(pending.due)} IST ki @dermaluxe.ai lo post avtundi.\n'queue' tho list chudochu · 'unschedule <number>' tho remove.`;
  }

  const out = await publishNow(cfg, pending.imgId, pending.caption);
  if (!out.ok) {
    return out.transient
      ? "Publish fail ayindi 🙏 — 30 seconds agi malli 'ok' pampandi."
      : `Publish kudaraledu: ${out.msg} 🙏`;
  }
  await guard.kvCommand(cfg, ["DEL", `adm:post:${digits}`]).catch(() => {});
  return `✅ *Post live!* @dermaluxe.ai${out.link ? "\n" + out.link : ""}`;
}

// Main entry — returns reply text, or null when the message is not an admin command.
async function handle(cfg, digits, text, photo) {
  if (!isAdmin(digits)) return null;
  const t = String(text || "").trim();

  if (/^(help|commands)$/i.test(t)) {
    return ["🛠 *Admin commands*",
      "• insta report — IG stats + boost tip",
      "• leads report [week] — lead summary",
      "• marketing report — leads+IG+links+AI plan",
      "• ideas — 3 AI post ideas (season-aware)",
      "• 📷 photo + 'post: <idea>' — AI caption → ok/cancel",
      "• 📷 photo + 'schedule: tomorrow 6pm | <idea>' — auto-post later",
      "• queue — scheduled list · unschedule <n> — remove",
      "(migatha messages normal agent laga panichestai)"].join("\n");
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
    items.forEach((x, i) => lines.push(`${i + 1}. ${fmtIst(x.it.due)} — ${String(x.it.caption || "").replace(/\n/g, " ").slice(0, 45)}…`));
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

  // Photo with "schedule: <when> | <idea>" → preview, then "ok" queues it
  if (photo && /^schedule\s*[:\-]?/i.test(t)) {
    if (!cfg) return "Storage lekapothe scheduling kudaradu.";
    const body = t.replace(/^schedule\s*[:\-]?\s*/i, "");
    const parts = body.split("|");
    const due = parseWhen(parts[0]);
    if (!due) return "Time ardham kaledu 🙏 — ila pampandi:\nschedule: tomorrow 6pm | hydrafacial offer\n(today 7:30pm, 15-08 11am kuda ok)";
    const idea = parts.slice(1).join("|").trim();
    const media = await photo.fetch();
    if (!media || media.tooBig) return "Photo download avvaledu / chala pedda undi 🙏 — malli pampandi.";
    const imgId = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["SET", `adm:img:${imgId}`, media.base64, "EX", "3600"]);
    let caption;
    try { caption = await writeCaption(idea, media.base64, media.mime); }
    catch (e) { console.error("adm: caption", e.message); return "Caption rayadam fail ayindi — malli try cheyandi."; }
    await guard.kvCommand(cfg, ["SET", `adm:post:${digits}`, JSON.stringify({ imgId, caption, due, ts: Date.now() }), "EX", "3600"]);
    return `⏰ *Schedule preview* — ${fmtIst(due)} IST\n\n${caption}\n\n✅ Confirm: *ok* · ❌ *cancel*`;
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

module.exports = { isAdmin, handle, publishNow, fmtIst };
