// Answer the people the agent could not answer.
//
// When the model is down or the account runs dry, patients get the holding
// reply (FALLBACK_REPLY) instead of an answer, and nothing ever goes back for
// them: the agent only speaks when a webhook arrives, and their message has
// come and gone. This finds those chats in the inbox and answers the
// patient's own last message properly. Deliberately conservative: never over
// a person who took the chat, never after STOP, never outside WhatsApp's
// 24-hour window (Meta would refuse the text), never at night, and each chat
// is tried once.
const guard = require("./_guard.js");
const inbox = require("./_inbox.js");
const facts = require("./_facts.js");
const notify = require("./_notify.js");

const HOLD = facts.FALLBACK_REPLY.slice(0, 60);
const isHold = (t) => String(t || "").slice(0, 60) === HOLD;

async function findStranded(cfg, hoursBack) {
  const out = [];
  const since = Date.now() - (hoursBack || 30) * 3600000;
  for (const t of await inbox.threads(cfg, 200)) {
    if (!t.ts || t.ts < since) continue;
    if (t.human) continue;
    const th = await inbox.thread(cfg, t.phone);
    const msgs = th.msgs || [];
    let li = -1; for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].dir === "in") { li = i; break; }
    if (li < 0) continue;
    const lastIn = msgs[li];
    // what we sent after their last message — by position, since a reply can share its millisecond
    const after = msgs.slice(li + 1).filter((m) => m.dir === "out");
    // answered by anything that was not the holding line — the desk, or the agent once it recovered
    if (!after.length || after.some((m) => !isHold(m.text))) continue;
    if (await guard.setHas(cfg, "optout", t.phone)) continue;
    out.push({ phone: t.phone, name: t.name || "", lastIn, msgs, windowOpen: Date.now() - lastIn.ts < 24 * 3600000 - 120000 });
  }
  return out.sort((a, b) => a.lastIn.ts - b.lastIn.ts);
}

async function run(cfg, max) {
  const res = { found: 0, answered: 0, skippedClosed: 0, failed: 0, quiet: false };
  if (!cfg || process.env.WA_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY) return res;
  const hour = new Date(Date.now() + 330 * 60000).getUTCHours();
  res.quiet = hour >= 21 || hour < 8;
  const all = await findStranded(cfg, 30);
  res.found = all.length;
  const open = all.filter((s) => s.windowOpen);
  res.skippedClosed = all.length - open.length;
  if (res.quiet) return res;
  const wa = require("./whatsapp.js");
  for (const s of open.slice(0, max || 20)) {
    const once = await guard.kvCommand(cfg, ["SET", `recov:${s.phone}:${s.lastIn.ts}`, "1", "NX", "EX", "172800"]).catch(() => ({}));
    if (!once || !once.result) continue;
    try {
      // History without our holding lines: leaving them in teaches the model
      // that "staff will reply" is how this conversation goes.
      const clean = s.msgs.filter((m) => !(m.dir === "out" && isHold(m.text)));
      const hist = [];
      for (let i = 0; i < clean.length - 1; i++) {
        const m = clean[i], n = clean[i + 1];
        if (m.dir === "in" && n.dir === "out") { hist.push({ u: m.text, a: n.text }); i++; }
      }
      const out = await wa.askClaude(hist.slice(-8), s.lastIn.text, s.name, "[The patient wrote this earlier and got no proper answer — answer it now, warmly, no apology longer than a few words] ");
      const reply = String(out.reply || "").trim();
      if (!reply || isHold(reply)) { res.failed++; continue; }
      const ok = await notify.sendWa(s.phone, reply);
      if (!ok) { res.failed++; continue; }
      await inbox.log(cfg, s.phone, { dir: "out", text: reply, by: "ai", via: "recovered" });
      res.answered++;
      await new Promise((r) => setTimeout(r, 1200));   // spaced, so a burst does not read as spam to Meta
    } catch (e) { res.failed++; console.error("recover:", s.phone, e && e.message); }
  }
  return res;
}

module.exports = { findStranded, run, isHold };
