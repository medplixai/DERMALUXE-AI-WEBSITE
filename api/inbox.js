// /api/inbox — the WhatsApp conversations, from the staff app.
//
//   GET  ?a=list                    threads, most recent first
//   GET  ?a=thread&phone=…          one conversation (marks it read)
//   POST {a:"reply", phone, text}   a colleague answers the patient
//   POST {a:"takeover", phone, on}  a person takes the chat from the agent, or hands it back
//   POST {a:"draft", phone, ask?}   the agent writes the next reply FOR the colleague to send
//
// Replying takes the conversation over automatically: the agent stays quiet
// for that patient until it is handed back, or twelve hours pass. Outside
// WhatsApp's 24-hour window free text cannot be delivered, so the reply goes
// as the approved clinic_update template instead — and says so.
const guard = require("./_guard.js");
const staff = require("./staff.js");
const notify = require("./_notify.js");
const inbox = require("./_inbox.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

// The lead each chat belongs to — its stage, call result and booked slot —
// so the inbox can say "book ayindi" or "closed" instead of making the desk
// open the Leads tab to find out. The newest enquiry per number wins, the
// same way the Leads screen groups them.
const leadKey = (l) => `${l.ts}|${ten(l.phone) || l.src_id || ""}`;
// The list is polled every 20 seconds by every open inbox and the thread
// every 8, so the 400-row page is read at most once a minute per instance;
// the stage and call result (two small HMGETs) are read fresh every time.
let leadPage = { at: 0, rows: [] };
async function leadsByPhone(cfg, phones) {
  const want = new Set(phones);
  if (Date.now() - leadPage.at > 60000) {
    const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "399"]).catch(() => ({}));
    const rows = [];
    for (const raw of ((r && r.result) || [])) { try { rows.push(JSON.parse(raw)); } catch (e) {} }
    if (rows.length || (r && r.result)) leadPage = { at: Date.now(), rows };
  }
  const by = {};
  for (const l0 of leadPage.rows) {
    const ph = ten(l0 && l0.phone);
    if (!want.has(ph) || by[ph]) continue;              // newest first in the list
    by[ph] = Object.assign({}, l0);
  }
  const keys = Object.values(by).map(leadKey);
  if (!keys.length) return by;
  const [st, oc] = await Promise.all([
    guard.kvCommand(cfg, ["HMGET", "dl_status"].concat(keys)).catch(() => ({})),
    guard.kvCommand(cfg, ["HMGET", "dl_outcome"].concat(keys)).catch(() => ({})),
  ]);
  Object.values(by).forEach((l, i) => {
    l.status = (((st && st.result) || [])[i]) || "new";
    l.outcome = (((oc && oc.result) || [])[i]) || "";
  });
  return by;
}

// One chat's intelligence: what it needs, where it stands, what it is about,
// and the goal the agent is working to — the Leads card's words, in the inbox.
function enrich(t, rec, lead, now) {
  const triage = require("./_triage.js");
  const f = (rec && rec.facts) || {};
  const out = triage.triage(t, lead, now);
  t.need = out.need; t.stage = out.stage; t.bucket = out.bucket;
  t.concern = String(f.problem || (lead && lead.concern) || "").slice(0, 60);
  if (rec) { t.grade = rec.grade; t.score = rec.score; t.village = f.village || ""; t.km = rec.km; }
  t.leadStatus = lead ? lead.status : "";
  try {
    const g = require("./_goal.js").goalFor({ concern: (lead && lead.concern) || f.problem || "", type: lead ? lead.type : "whatsapp", km: rec ? rec.km : null, intent: f.intent,
      status: lead ? lead.status : "", outcome: lead ? lead.outcome : "", booked: !!(lead && lead.status === "booked"), name: t.name || (lead && lead.name), slot: lead && (lead.slot || lead.date) });
    t.goal = g.label; t.goalKey = g.key;
  } catch (e) {}
  return t;
}

async function audit(cfg, me, what) {
  await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({ ts: Date.now(), by: me.name, phone: me.phone, what: clean(what, 200) })]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "staff:audit", "0", "199"]).catch(() => {});
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });
  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("inbox.view")) return json(res, 403, { error: "Mee role ki inbox access ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "list");
  const canReply = allow("inbox.reply");

  if (a === "list") {
    const rows = await inbox.threads(cfg, 150);
    const unread = rows.reduce((n, t) => n + (t.unread || 0), 0);
    // The grade the qualifier gave each patient and the lead each chat belongs
    // to, then the triage: which chats need a person, which the agent has.
    const now = Date.now();
    try {
      const qualify = require("./_qualify.js");
      const [recs, leads] = await Promise.all([qualify.forPhones(cfg, rows.map((t) => t.phone)), leadsByPhone(cfg, rows.map((t) => t.phone))]);
      for (const t of rows) enrich(t, qualify.settle(recs[t.phone], leads[t.phone]), leads[t.phone], now);
    } catch (e) { console.error("inbox: triage", e && e.message); for (const t of rows) if (!t.stage) enrich(t, null, null, now); }
    rows.sort(require("./_triage.js").order);
    const counts = { need: 0, human: 0, ai: 0, booked: 0, quiet: 0 };
    for (const t of rows) counts[t.bucket] = (counts[t.bucket] || 0) + 1;
    // yesterday's agent review rides along, one tap away behind the list
    let review = null; try { review = await require("./_review.js").latest(cfg); } catch (e) {}
    let exam = null; try { exam = await require("./_exam.js").latest(cfg); } catch (e) {}
    return json(res, 200, { ok: true, threads: rows.map((t) => Object.assign(t, { open: inbox.windowOpen(t) })), unread, needs: counts.need, counts, canReply, review, exam });
  }

  if (a === "thread") {
    const ph = ten(q.phone || b.phone);
    if (ph.length !== 10) return json(res, 400, { error: "Number sarigga ledu" });
    const t = await inbox.thread(cfg, ph);
    if (!t.meta && !t.msgs.length) return json(res, 404, { error: "Ee number tho chat ledu" });
    await inbox.markRead(cfg, ph);
    // Who this is, in the words the Leads screen uses: the grade and why, the
    // one thing to do next, what the clinic already knows about them, and how
    // long they have been waiting for an answer.
    let card = null, tri = null;
    try {
      const qualify = require("./_qualify.js");
      const [rec0, known, leads] = await Promise.all([qualify.read(cfg, ph), require("./_memory.js").facts(cfg, ph).catch(() => null), leadsByPhone(cfg, [ph])]);
      const lead = leads[ph] || null;
      const rec = qualify.settle(rec0, lead);   // "not interested" at the desk is a D here too
      const lastIn = (t.meta && Number(t.meta.lastIn)) || 0;
      const lastOut = [...(t.msgs || [])].reverse().find((m) => m.dir === "out");
      tri = enrich(Object.assign({ phone: ph }, t.meta || {}, { human: t.human }), rec, lead, Date.now());
      card = {
        grade: rec ? rec.grade : "", score: rec ? rec.score : 0,
        why: rec ? (rec.signals || []).map((s) => s.why).slice(0, 3) : [],
        village: rec && rec.facts ? rec.facts.village || "" : "", km: rec ? rec.km : null,
        since: rec && rec.facts ? rec.facts.problem_since || "" : "",
        problem: rec && rec.facts ? rec.facts.problem || "" : "",
        prefers: rec && rec.facts ? rec.facts.prefers || "" : "",
        next: qualify.nextAction(rec, lead || { status: (rec && rec.status) || "new" }),
        waiting: lastIn && (!lastOut || lastOut.ts < lastIn) ? Date.now() - lastIn : 0,
        visits: known ? known.came : 0, lastVisit: known && known.last ? known.last.at : 0,
        due: known ? known.cycle || "" : "",
        goal: tri.goal || "", stage: tri.stage, need: tri.need, concern: tri.concern,
        leadStatus: lead ? lead.status : "", slot: lead ? lead.slot || "" : "",
      };
    } catch (e) { console.error("inbox: card", e && e.message); }
    return json(res, 200, Object.assign({ ok: true, open: inbox.windowOpen(t.meta), canReply, card }, t));
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (!canReply) return json(res, 403, { error: "Mee role ki reply chese permission ledu" });
  const ph = ten(b.phone);
  if (!/^[6-9]\d{9}$/.test(ph)) return json(res, 400, { error: "Number sarigga ledu" });
  const rl = await guard.rateLimit(cfg, `rl:ib:${me.phone}`, 120, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Konchem aagandi" });

  if (a === "takeover") {
    const on = b.on !== false;
    await inbox.setHuman(cfg, ph, on, me.name);
    await audit(cfg, me, `${on ? "took over" : "handed back"} WhatsApp chat ${ph}`);
    return json(res, 200, { ok: true, human: on ? { by: me.name, ts: Date.now() } : null });
  }

  // Typing Telugu on a phone while a patient waits is why chats are left to
  // the agent even when a person should answer. This writes the reply; a
  // person reads it, changes a word if they want, and presses send. Nothing
  // is sent from here.
  if (a === "draft") {
    if (process.env.WA_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY) return json(res, 501, { error: "AI inka configure cheyyaledu" });
    const t = await inbox.thread(cfg, ph);
    if (!t.msgs.length) return json(res, 404, { error: "Ee number tho chat ledu" });
    const rl2 = await guard.rateLimit(cfg, `rl:ibd:${me.phone}`, 60, 3600);
    if (!rl2.allowed) return json(res, 429, { error: "Konchem aagandi" });
    const msgs = t.msgs.slice(-12);
    const hist = [];
    for (let i = 0; i < msgs.length - 1; i++) if (msgs[i].dir === "in" && msgs[i + 1].dir === "out") { hist.push({ u: msgs[i].text, a: msgs[i + 1].text }); i++; }
    const lastIn = [...msgs].reverse().find((m) => m.dir === "in");
    const ask = clean(b.ask, 200);
    const qualify = require("./_qualify.js");
    const qrec = await qualify.read(cfg, ph).catch(() => null);
    const known = await require("./_memory.js").contextLine(cfg, ph).catch(() => "");
    const ctx = `[You are writing for ${me.name} at the DermaLuxe desk to send by hand — not for the agent. ${known}${qrec ? qualify.contextLine(qrec) : ""}${ask ? `The colleague wants this reply to: ${ask}. ` : ""}Answer the patient's own last message, 2-5 short lines, one next step. "lead" must be null.] `;
    let out;
    try {
      out = await require("./whatsapp.js").askClaude(hist, lastIn ? lastIn.text : "hi", (t.meta && t.meta.name) || "", ctx, await require("./_rules.js").block(cfg).catch(() => ""));
      out = await require("./_lint.js").check(cfg, out, lastIn ? lastIn.text : "", msgs.filter((m) => m.dir === "out").map((m) => m.text), { channel: "draft", profileName: (t.meta && t.meta.name) || "" });
    } catch (e) { return json(res, 502, { error: "Draft raayaleka poyam — malli try cheyandi" }); }
    const text = String((out && out.reply) || "").trim();
    if (!text) return json(res, 502, { error: "Draft raayaleka poyam" });
    return json(res, 200, { ok: true, text });
  }

  if (a === "reply") {
    const text = clean(b.text, 1500);
    if (text.length < 2) return json(res, 400, { error: "Message raayandi" });
    const t = await inbox.thread(cfg, ph);
    if (!t.meta) return json(res, 404, { error: "Ee number tho chat ledu — kotha patient ki Leads nundi message pampandi" });
    let via = "text";
    let sent = inbox.windowOpen(t.meta) ? await notify.sendWa(ph, text) : false;
    if (!sent) {
      const first = clean((t.meta && t.meta.name) || "", 30).split(" ")[0] || "there";
      const tp = await notify.sendWaTemplate(ph, "clinic_update", [first, text.slice(0, 250)]).catch(() => ({ ok: false }));
      sent = !!(tp && tp.ok); via = "template";
    }
    if (!sent) return json(res, 502, { error: "WhatsApp ki vellaledu — phone lo direct ga call cheyandi" });
    await inbox.log(cfg, ph, { dir: "out", text: via === "template" && text.length > 250 ? text.slice(0, 250) + "…" : text, by: me.name, via });
    await inbox.setHuman(cfg, ph, true, me.name);
    await audit(cfg, me, `replied on WhatsApp to ${ph} (${via})`);
    return json(res, 200, { ok: true, via, human: { by: me.name, ts: Date.now() } });
  }

  return json(res, 400, { error: "Unknown action" });
};
