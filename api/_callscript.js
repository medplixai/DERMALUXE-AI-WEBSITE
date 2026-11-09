// The caller's note: what to say and how, when the agent could not close it.
//
// First built as a button (7 Nov, "Em matladali"). On 8 Nov the owner asked
// for it to be there already: "agent valla kakapothe staff call chesi em
// mataladali ela matladalo kuda staff ki note pettu". So every lead the agent
// left unbooked — a number on file, still new or contacted, no slot, the chat
// gone quiet — gets the note written ahead of the call, and the card shows it
// without a tap. The button still writes a fresh one on demand.
const guard = require("./_guard.js");

const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const ten = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const keyOf = (l) => `${l.ts}|${ten(l.phone) || l.src_id || ""}`;
const TTL = 86400;                       // a day: the chat moves on, so does the note

const SYSTEM = "You prepare a receptionist at DermaLuxe skin & hair clinic, Eluru, for a phone call to an enquiry the clinic's chat agent could not book. Write in simple Tenglish (Telugu in English letters), at most 6 short lines, each starting with an emoji: 🗣 what they want and where the chat stopped (one line), 📞 the first sentence to say when they pick up, 💬 how to talk to this person (tone — e.g. they are worried, price-conscious, busy, far away), ✅ what to offer next (a slot, a video consultation if far, the academy counselling and ₹9,999 seat, the hair transplant scalp assessment), ⚠️ the objection to expect and one honest answer, ⏰ what time of day to ring, if the chat shows it. Facts only from the brief. Never promise a result, never quote a treatment price (consultation is ₹300; the hair transplant package is ₹59,999 all-inclusive up to 3,000 grafts, ₹20 per graft beyond that, till 6 Dec 2026; academy launch fees are published), never name a medicine, never say anything is free except the hair transplant consultation till 6 Dec. If they are a job seeker or not a patient, say so in one line.";

async function make(cfg, key, preloaded) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, code: 503, error: "AI ippudu ledu" };
  const raw = preloaded || ((await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "399"]).catch(() => ({}))).result || []).map((x) => parse(x, null)).filter(Boolean);
  const lead = raw.find((l) => keyOf(l) === key);
  if (!lead) return { ok: false, code: 404, error: "Lead dorakaledu" };
  const ph = ten(lead.phone);
  const same = raw.filter((l) => ph && ten(l.phone) === ph).slice(0, 5);
  const notesR = await guard.kvCommand(cfg, ["HGET", "dl_notes", key]).catch(() => ({}));
  const notes = parse((notesR && notesR.result) || "[]", []) || [];
  let chat = [];
  if (ph) { try { chat = ((await require("./_inbox.js").thread(cfg, ph)).msgs || []).slice(-24); } catch (e) {} }
  const qual = ph ? await require("./_qualify.js").read(cfg, ph).catch(() => null) : null;
  let goal = null;
  try { goal = require("./_goal.js").goalFor({ concern: lead.concern || "", type: lead.type, km: qual ? qual.km : null, intent: ((qual || {}).facts || {}).intent, name: lead.name, slot: lead.slot }); } catch (e) {}
  const brief = [
    `Lead: ${lead.name || "?"} · ${lead.concern || ""} · source ${lead.type || ""} · ${new Date(lead.ts).toISOString().slice(0, 10)}`,
    goal ? `The clinic's goal for this person: ${goal.label}` : "",
    same.length > 1 ? "Earlier enquiries: " + same.slice(1).map((l) => `${new Date(l.ts).toISOString().slice(0, 10)} ${l.concern || ""}`).join("; ") : "",
    qual && qual.facts ? "Known: " + JSON.stringify(qual.facts).slice(0, 400) : "",
    lead.call_prep ? "Agent's note: " + lead.call_prep : "",
    notes.length ? "Desk notes: " + notes.slice(0, 6).map((n) => `${n.by}: ${n.text}`).join(" | ") : "No calls yet.",
    chat.length ? "Chat (latest last):\n" + chat.map((m) => `${m.dir === "in" ? "Patient" : "Clinic"}: ${String(m.text || "").slice(0, 220)}`).join("\n") : "No chat.",
  ].filter(Boolean).join("\n");
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.AI_MODEL || "claude-opus-5", max_tokens: 700, system: SYSTEM, messages: [{ role: "user", content: brief }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, code: 502, error: "AI: " + String((d.error || {}).message || r.status).slice(0, 120) };
    const script = String(((d.content || []).find((x) => x.type === "text") || {}).text || "").trim().slice(0, 1400);
    if (!script) return { ok: false, code: 502, error: "AI emi ivvaledu" };
    await guard.kvCommand(cfg, ["SET", `cs:${key}`, script, "EX", String(TTL)]).catch(() => {});
    return { ok: true, script };
  } catch (e) { return { ok: false, code: 502, error: "AI: " + String(e.message || e).slice(0, 120) }; }
}

// The leads the agent left for the desk, newest first, a few per run.
async function backfill(cfg, max) {
  if (!cfg || !process.env.ANTHROPIC_API_KEY) return { made: 0 };
  const raw = ((await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "199"]).catch(() => ({}))).result || []).map((x) => parse(x, null)).filter(Boolean);
  const now = Date.now(), seen = new Set();
  const todo = raw.filter((l) => {
    const ph = ten(l.phone);
    if (!ph || seen.has(ph)) return false;            // one per person: the newest enquiry
    seen.add(ph);
    if (l.type === "job" || /^\s*academy seat paid/i.test(l.concern || "")) return false;
    if (now - l.ts > 3 * 86400000) return false;      // the last three days
    if (now - l.ts < 30 * 60000) return false;        // give the agent half an hour first
    return !l.slot_ts;
  });
  if (!todo.length) return { made: 0 };
  const keys = todo.map(keyOf);
  const [stR, cs] = await Promise.all([
    guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({})),
    guard.kvCommand(cfg, ["MGET"].concat(keys.map((k) => `cs:${k}`))).catch(() => ({})),
  ]);
  const st = guard.hashOf((stR && stR.result)) || {};
  let made = 0;
  for (let i = 0; i < todo.length && made < (max || 5); i++) {
    const status = st[keys[i]] || "new";
    if (!["new", "contacted"].includes(status)) continue;
    if (((cs && cs.result) || [])[i]) continue;          // already written
    const out = await make(cfg, keys[i], raw);
    if (out.ok) made++;
  }
  return { made };
}

module.exports = { make, backfill };
