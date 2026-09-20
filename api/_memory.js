// What the clinic already knows about the person who just wrote.
//
// The agent's own memory of a chat lasts a day. A patient who came in
// August and writes again in November was greeted like a stranger — asked
// their name, their concern, their town — by the same clinic that has their
// file, their photos and their bill. Nothing loses trust faster.
//
// This reads that file (the same records the patient screen shows) and
// hands the agent one bracketed line: who they are, when they last came,
// what for, which sitting of which package is due, whether they tend to
// turn up. Never money owed, never allergies — those are the desk's, not a
// chat's. Cached for six hours per number: the file is several list reads,
// and a conversation is many turns.
//
// KV: wa:mem:<phone> — the line (6 h)
const guard = require("./_guard.js");

const DAY = 86400000;
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (ms) => { const d = new Date(ms + 330 * 60000); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const agoText = (ms) => {
  const d = Math.round((Date.now() - ms) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : d < 365 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 365)} year(s) ago`;
};

// The facts, from the records. `null` when the number is new to us.
async function facts(cfg, phone) {
  const ph = ten(phone);
  if (!cfg || ph.length !== 10) return null;
  const [ptR, doneR, pkgR, rvR, pR] = await Promise.all([
    guard.kvCommand(cfg, ["GET", `pt:${ph}`]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "499"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", `pkg:of:${ph}`, "0", "9"]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "rv:log", "0", "299"]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", `wa:p:${ph}`]).catch(() => ({})),
  ]);
  const pt = parse((ptR && ptR.result) || "", {}) || {};
  const prof = parse((pR && pR.result) || "", null);
  const past = ((doneR && doneR.result) || []).map((x) => parse(x, null)).filter(Boolean)
    .filter((a) => ten(a.ph) === ph && a.at && a.status !== "cancelled")
    .sort((a, b) => b.at - a.at);
  const came = past.filter((a) => !a.ns && a.status !== "noshow" && (a.v || a.arrived || a.status === "done" || a.status === "arrived" || (!a.status && a.doneAt)));
  const missed = past.filter((a) => a.ns || a.status === "noshow");
  const pkgIds = (pkgR && pkgR.result) || [];
  let packages = [];
  if (pkgIds.length) {
    const raws = await guard.kvPipeline(cfg, pkgIds.map((id) => ["GET", `pkg:${id}`])).catch(() => []);
    for (const raw of (Array.isArray(raws) ? raws : [])) {
      const p = parse(raw, null);
      if (!p || !p.treatment) continue;
      const done = (p.sessions || []).length, total = Number(p.total || 1), left = Math.max(0, total - done);
      if (!left) continue;
      const last = done ? Number(p.sessions[done - 1].at || 0) : 0;
      const nextDue = last ? last + (Number(p.gapDays) || 30) * DAY : Number(p.ts || 0);
      packages.push({ treatment: p.treatment, done, total, nextDue });
    }
  }
  const ratings = ((rvR && rvR.result) || []).map((x) => parse(x, null)).filter((r) => r && ten(r.ph) === ph && Number(r.rating));
  const name = pt.name || (prof && prof.name) || (past[0] && past[0].name) || "";
  if (!name && !past.length && !packages.length && !(prof && prof.concern)) return null;
  return {
    name, stage: pt.stage || "",
    lastConcern: (prof && prof.concern) || (past[0] && (past[0].concern || past[0].treatment)) || "",
    came: came.length, missed: missed.length,
    last: came[0] ? { at: came[0].at, concern: came[0].concern || came[0].treatment || "", doctor: came[0].staffName || "" } : null,
    packages, lastRating: ratings.length ? Number(ratings[0].rating) : 0,
    tags: Array.isArray(pt.tags) ? pt.tags.slice(0, 4) : [],
  };
}

// One line for the model. Empty for somebody new.
function line(f) {
  if (!f) return "";
  const bits = [];
  if (f.name) bits.push(`name ${f.name}`);
  if (f.last) bits.push(`last visit ${fmt(f.last.at)} (${agoText(f.last.at)})${f.last.concern ? " for " + f.last.concern : ""}${f.last.doctor ? " with " + f.last.doctor : ""}`);
  else if (f.lastConcern) bits.push(`last enquiry: ${f.lastConcern}`);
  if (f.came > 1) bits.push(`came ${f.came} times`);
  if (f.missed) bits.push(`missed ${f.missed} appointment(s) — confirm the time twice, gently`);
  for (const p of f.packages.slice(0, 2)) {
    const due = p.nextDue < Date.now() ? `due since ${fmt(p.nextDue)} (OVERDUE — offer slots for it now)` : `next due ${fmt(p.nextDue)}`;
    bits.push(`package ${p.treatment}: ${p.done}/${p.total} sittings done, ${due}`);
  }
  if (f.lastRating) bits.push(`rated us ${f.lastRating}★ last time`);
  if (f.stage) bits.push(`treatment stage: ${f.stage}`);
  if (f.tags.length) bits.push(`desk tags: ${f.tags.join(", ")}`);
  return `[KNOWN PATIENT — ${bits.join("; ")}. Greet by name, speak from this history (never re-ask name, concern or town), skip the introduction, go straight to what they need; if a sitting is due, offer slots for it.] `;
}

async function contextLine(cfg, phone) {
  const ph = ten(phone);
  if (!cfg || ph.length !== 10) return "";
  const c = await guard.kvCommand(cfg, ["GET", `wa:mem:${ph}`]).catch(() => ({}));
  if (c && typeof c.result === "string") return c.result;       // "" is cached too: a stranger stays a stranger for six hours
  const f = await facts(cfg, ph).catch(() => null);
  const out = line(f);
  await guard.kvCommand(cfg, ["SET", `wa:mem:${ph}`, out, "EX", "21600"]).catch(() => {});
  return out;
}

// After a visit, a sitting or a bill the line is stale.
const forget = (cfg, phone) => (cfg ? guard.kvCommand(cfg, ["DEL", `wa:mem:${ten(phone)}`]).catch(() => {}) : null);

module.exports = { facts, line, contextLine, forget };
