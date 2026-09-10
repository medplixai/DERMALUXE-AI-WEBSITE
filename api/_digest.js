// Shared daily-report builder for the 9AM cron AND the on-demand 'report'
// admin command. buildDigest(cfg, live): live=true (cron) also fires the
// day's patient/candidate reminder sends and queue moves; live=false is
// strictly read-only so the command can run any number of times a day.
// NOTE: deliberately does NOT require _admin.js (it requires us — CJS
// circular requires would hand us its half-built exports), so fmtIst is
// duplicated here.
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const hrmod = require("./_hr.js");

const IST_MS = 330 * 60000;
function fmtIst(ms) {
  const d = new Date(ms + IST_MS);
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  let h = d.getUTCHours(); const min = d.getUTCMinutes(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${mo} ${d.getUTCDate()}, ${h}:${String(min).padStart(2, "0")} ${ap}`;
}

async function buildDigest(cfg, live) {
  const now = Date.now();
  const istDay = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
  const today = istDay(now);
  const lines = ["🌅 *DermaLuxe Daily — " + fmtIst(now).split(",")[0] + "*", ""];
  let nLeads = 0, nAppts = 0;

  // Yesterday's leads (rolling 24h)
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]);
    const leads = (r.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter((l) => l && now - l.ts < 86400000);
    nLeads = leads.length;
    const by = {};
    leads.forEach((l) => { by[l.type] = (by[l.type] || 0) + 1; });
    lines.push(`📋 Ninna leads: *${leads.length}*` + (leads.length ? " (" + Object.keys(by).map((k) => `${k}:${by[k]}`).join(", ") + ")" : ""));
    leads.slice(0, 5).forEach((l) => lines.push(`— ${l.name || "?"} · ${String(l.concern || "").slice(0, 28)}`));
  } catch (e) {}

  // Today's scheduled posts
  try {
    const q = await guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "19"]);
    const due = (q.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter((it) => it && it.due && it.due - now < 86400000 && it.due > now - 600000)
      .sort((a, b) => a.due - b.due);
    if (due.length) {
      lines.push("", "⏰ Ee roju posts:");
      due.forEach((it) => lines.push(`— ${fmtIst(it.due)} ${it.vidId ? "🎬" : "📷"} ${String(it.caption || "").replace(/\n/g, " ").slice(0, 30)}…`));
    }
  } catch (e) {}

  // Hiring: yesterday's applications + today's interviews (reminders when live)
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "299"]);
    const apps = (r.result || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter((l) => l && l.type === "job" && now - l.ts < 86400000);
    if (apps.length) lines.push("", `💼 Ninna job applications: *${apps.length}* ('jobs report' tho chudandi)`);
  } catch (e) {}
  try {
    const q = await guard.kvCommand(cfg, ["LRANGE", "hr:ivq", "0", "49"]);
    const seen = new Set();
    for (const raw of (q.result || [])) {
      let iv; try { iv = JSON.parse(raw); } catch (e) { continue; }
      if (!iv || !iv.at) continue;
      if (iv.at < now - 43200000) {
        if (live) await guard.kvCommand(cfg, ["LREM", "hr:ivq", "1", raw]).catch(() => {});
        continue;
      }
      if (istDay(iv.at) !== today || seen.has(iv.phone)) continue;
      seen.add(iv.phone);
      const app = await hrmod.findApp(cfg, iv.phone);
      lines.push(`📅 Ivala interview: ${app ? app.name + " (" + app.role + ")" : iv.phone} — ${fmtIst(iv.at)}`);
      if (live) {
        await notify.sendWa(iv.phone,
          `⏰ Reminder: Ivala mee interview undi!\n🗓 *${fmtIst(iv.at)}* IST\n📍 DermaLuxe, Rama Mahal, Kasturi Vari Street, Eluru\nAll the best! 🍀`).catch(() => {});
      }
    }
  } catch (e) {}

  // Today's appointments (same-day patient reminders when live)
  try {
    const aq = await guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "199"]);
    const todays = [];
    for (const raw of (aq.result || [])) {
      let a; try { a = JSON.parse(raw); } catch (e) { continue; }
      if (!a || !a.at || !a.ph) {
        if (live) await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
        continue;
      }
      if (a.at < now - 10800000) {
        if (live) {
          // Long past (overnight stragglers) → move to appt:done, no team ping
          await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
          a.doneAt = now;
          await guard.kvCommand(cfg, ["LPUSH", "appt:done", JSON.stringify(a)]).catch(() => {});
        }
        continue;
      }
      if (istDay(a.at) !== today) continue;
      todays.push(a);
      if (live && !a.r9 && !a.cf && a.at > now) { // confirmed patients skip the 9 AM ping (2h one still goes)
        await notify.sendWaTemplate(a.ph, "appointment_reminder", [a.name || "friend", fmtIst(a.at)]).catch(() => {});
        a.r9 = true;
        if (a.at - now < 10800000) a.r2 = true; // near → skip cron-post's 2h ping too
        await guard.kvCommand(cfg, ["LREM", "appt:q", "1", raw]).catch(() => {});
        await guard.kvCommand(cfg, ["LPUSH", "appt:q", JSON.stringify(a)]).catch(() => {});
      }
    }
    nAppts = todays.length;
    if (todays.length) {
      lines.push("", `🩺 Ivala appointments: *${todays.length}*${live ? " (patients ki reminders vellayi)" : ""}`);
      todays.sort((x, y) => x.at - y.at).forEach((a) =>
        lines.push(`${a.cf ? "✅" : "—"} ${fmtIst(a.at).split(", ")[1] || fmtIst(a.at)} · ${a.name || "?"} 📱 ${a.ph}${a.concern ? " · " + a.concern : ""}`));
      const unconfirmed = todays.filter((a) => !a.cf && a.at > now).length;
      if (unconfirmed) lines.push(`⏳ Confirm avvanivi: *${unconfirmed}* — front office call chesi confirm cheyandi 📞`);
    }
  } catch (e) {}

  // Yesterday's smart-link clicks
  try {
    const y = new Date(now - 86400000).toISOString().slice(0, 10);
    const parts = [];
    for (const tag of ["insta", "wa", "fb", "gbp", "story"]) {
      const v = await guard.kvCommand(cfg, ["GET", `utm:${tag}:${y}`]).catch(() => ({}));
      if (Number(v.result || 0) > 0) parts.push(`${tag}:${v.result}`);
    }
    if (parts.length) lines.push("", `🔗 Ninna link clicks: ${parts.join(", ")}`);
  } catch (e) {}

  // Team-scheduled review/session reminders due today (sends only when live)
  try {
    const cq = await guard.kvCommand(cfg, ["LRANGE", "chk:q", "0", "199"]);
    let rem = 0, pend = 0;
    for (const raw of (cq.result || [])) {
      let c; try { c = JSON.parse(raw); } catch (e) { c = null; }
      if (!c || !c.ph || !c.due) {
        if (live) await guard.kvCommand(cfg, ["LREM", "chk:q", "1", raw]).catch(() => {});
        continue;
      }
      if (istDay(c.due) > today) continue; // future — leave queued
      if (!live) { pend++; continue; }
      const first = String(c.name || "").split(" ")[0] || "friend";
      if (c.kind === "session") {
        await notify.sendWaTemplate(c.ph, "session_reminder", [first, String(c.note || "treatment").slice(0, 60)]).catch(() => {});
      } else {
        await notify.sendWaTemplate(c.ph, "review_reminder", [first, String(c.note || "Doctor suggest chesina review checkup").slice(0, 80)]).catch(() => {});
      }
      await guard.kvCommand(cfg, ["LREM", "chk:q", "1", raw]).catch(() => {});
      rem++;
    }
    if (rem) lines.push("", `🔁 Review/session reminders vellayi: *${rem}*`);
    if (pend) lines.push("", `🔁 Ee roju due review/session reminders: *${pend}* (9AM cron pampistundi)`);
  } catch (e) {}

  // Cold leads nudge (Mon & Thu only, 3+ needed): owner fires 'reactivate'
  try {
    const istD = new Date(now + IST_MS).getUTCDay();
    if (istD === 1 || istD === 4) {
      const r2 = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]);
      const uniq = new Set();
      for (const s of (r2.result || [])) {
        let l; try { l = JSON.parse(s); } catch (e) { continue; }
        if (!l || l.type === "job" || (l.slot && l.date)) continue;
        const age = now - (l.ts || 0);
        if (age < 3 * 86400000 || age > 10 * 86400000) continue;
        const ph = String(l.phone || "").replace(/\D/g, "").slice(-10);
        if (ph.length === 10) uniq.add(ph);
      }
      if (uniq.size >= 3) lines.push("", `🧊 Cold leads (3-10 rojulu, book avvaledu): *${uniq.size}* — owner *reactivate* ani pampite follow-up veltundi`);
    }
  } catch (e) {}

  lines.push("", "Dashboard: dermaluxe.ai/leads.html");
  return {
    body: lines.join("\n").slice(0, 3200),
    oneLine: `Ninna ${nLeads} leads · ivala ${nAppts} appointments`.slice(0, 200),
  };
}

module.exports = { buildDigest };
