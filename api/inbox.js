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
    // The grade the qualifier gave each patient, so the desk can see at a
    // glance which waiting chat is worth answering first.
    try {
      const qualify = require("./_qualify.js");
      const recs = await qualify.forPhones(cfg, rows.map((t) => t.phone));
      for (const t of rows) {
        const rec = recs[t.phone];
        if (rec) { t.grade = rec.grade; t.score = rec.score; t.status = rec.status || ""; }
      }
    } catch (e) { console.error("inbox: grades", e && e.message); }
    // yesterday's agent review rides along, for the card at the top of the screen
    let review = null; try { review = await require("./_review.js").latest(cfg); } catch (e) {}
    let exam = null; try { exam = await require("./_exam.js").latest(cfg); } catch (e) {}
    return json(res, 200, { ok: true, threads: rows.map((t) => Object.assign(t, { open: inbox.windowOpen(t) })), unread, canReply, review, exam });
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
    let card = null;
    try {
      const qualify = require("./_qualify.js");
      const rec = await qualify.read(cfg, ph);
      const known = await require("./_memory.js").facts(cfg, ph).catch(() => null);
      const lastIn = (t.meta && Number(t.meta.lastIn)) || 0;
      const lastOut = [...(t.msgs || [])].reverse().find((m) => m.dir === "out");
      card = {
        grade: rec ? rec.grade : "", score: rec ? rec.score : 0,
        why: rec ? (rec.signals || []).map((s) => s.why).slice(0, 3) : [],
        village: rec && rec.facts ? rec.facts.village || "" : "", km: rec ? rec.km : null,
        since: rec && rec.facts ? rec.facts.problem_since || "" : "",
        problem: rec && rec.facts ? rec.facts.problem || "" : "",
        next: rec ? qualify.nextAction(rec, { status: rec.status || "new" }) : null,
        waiting: lastIn && (!lastOut || lastOut.ts < lastIn) ? Date.now() - lastIn : 0,
        visits: known ? known.came : 0, lastVisit: known && known.last ? known.last.at : 0,
        due: known ? known.cycle || "" : "",
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
