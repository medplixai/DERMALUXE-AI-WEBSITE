// Bringing a stalled chat back to life.
//
// Someone writes, we answer, and then they go quiet. That silence is where
// most enquiries are lost — the person is still interested, they were
// interrupted. One short message that picks up exactly where the chat stopped
// and ends in a question restarts it.
//
// The rules that keep this from becoming spam:
//   * only chats where the last word was ours and they had written to us,
//   * only inside WhatsApp's 24-hour window (older ones are the template
//     ladder's job, in cron-followup),
//   * never for someone booked, opted out, a D grade, or held by a colleague,
//   * three nudges at most, ever: one hour, next morning, two days,
//   * only between 8 AM and 9 PM IST,
//   * the moment they reply, the count resets and we stop.
//
// KV: rg:<phone> — how many nudges and when (7 days).
const guard = require("./_guard.js");
const inbox = require("./_inbox.js");
const notify = require("./_notify.js");

const GAPS_MIN = [60, 20 * 60, 48 * 60];
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

// `ctx`: see _recover.findStranded — the shared inbox rows and opt-out list.
async function candidates(cfg, ctx) {
  const out = [];
  const qualify = require("./_qualify.js");
  const rows = (ctx && ctx.rows) || await inbox.threads(cfg, 200);
  const optSet = ctx && ctx.optout;
  for (const t of rows) {
    if (t.human || t.lastDir !== "out") continue;                 // we spoke last, and no colleague holds it
    if (!t.lastIn || Date.now() - t.lastIn > 23.5 * 3600000) continue;   // inside the window
    const st = parse(((await guard.kvCommand(cfg, ["GET", `rg:${t.phone}`]).catch(() => ({}))) || {}).result || "", null) || { n: 0, at: 0 };
    if (st.n >= GAPS_MIN.length) continue;
    if (st.lastIn && st.lastIn !== t.lastIn) { st.n = 0; }         // they wrote again: start over
    const since = Date.now() - Math.max(Number(t.ts) || 0, Number(st.at) || 0);
    if (since < GAPS_MIN[st.n] * 60000) continue;
    if (optSet ? optSet.has(t.phone) : await guard.setHas(cfg, "optout", t.phone)) continue;
    const q = await qualify.read(cfg, t.phone).catch(() => null);
    if (q && (q.grade === "D" || ["booked", "visited", "closed"].includes(q.status))) continue;
    out.push({ phone: t.phone, name: t.name || "", n: st.n, lastIn: t.lastIn, grade: (q && q.grade) || "" });
  }
  return out;
}

// The language to write the nudge in, from what the patient themselves typed.
//
// The nudge is asked for with an English instruction, and the model answered
// in the instruction's language: on 16 Nov a patient who wrote only in
// Telugu script got "Just a small tip — the skin under the eyes…", and one
// who wrote in English got Tenglish. Button taps ("Skin", "6 nelala lopu")
// say nothing about how a person writes, so they are left out.
const TAPS = /^(skin|hair|📅 book now|💆 services|📸 skin check|glow \/ facial|6 nelala lopu|1 year\+|chala kalam|ivala .*|repu .*|\[(📷|🎤|🎬|📄).*)$/i;
const EN_WORDS = /\b(the|is|are|i|my|have|has|since|please|can|could|you|what|how|and|for|with|this|it|me|do|does|get|want|need|when|where|which|much|cost)\b/gi;
const TE_WORDS = /\b(meeru|mee|naaku|naku|undi|unnai|ledu|kavali|cheppandi|enti|ela|eppudu|entha|andi|garu|chesthe|chestara|vastanu|ravachu|kuda)\b/gi;
// The questions Meta's ads put in the patient's mouth ("ఏమిటి ధర?", "Hello! Can
// I get more info on this?"). They say which ad was tapped, not how the person
// writes: on 17 Nov a dozen people whose only words were "ఏమిటి ధర?" were
// nudged in English.
const META_TE = /^(ఏమిటి ధర|ఖర్చు ఎంత|చికిత్స ఖర్చు ఎంత|ఎలా బుక్ చేస్తారు|బుక్ చేయడం ఎలా|హలో|లేజర్ హెయిర్ రిమూవల్\u200c?కు ముందు ఏమి చేయాలి)\s*[?？]?$/;
function langOf(msgs) {
  const isPrefill = (t) => META_TE.test(t) || require("./_lint.js").isMetaPrefill(t);
  const own = (msgs || []).filter((m) => m.dir === "in").map((m) => String(m.text || "").trim()).filter((t) => t && !TAPS.test(t) && !isPrefill(t));
  if (!own.length) return "tenglish";
  const all = own.join("\n");
  if (/[ఀ-౿]/.test(all)) return "telugu";
  const en = (all.match(EN_WORDS) || []).length, te = (all.match(TE_WORDS) || []).length;
  return en >= 3 && te === 0 ? "english" : "tenglish";
}
const LANG_RULE = {
  telugu: "Telugu script, as the patient writes (times and numbers in digits)",
  english: "simple English, as the patient writes",
  tenglish: "Tenglish (Telugu words in English letters), as the patient writes",
};

// `until`: see _recover. One Claude call per person, one after another — on a
// busy hour that alone can outlast the whole function.
async function run(cfg, max, until, ctx) {
  const res = { found: 0, sent: 0, quiet: false, stopped: false, left: 0 };
  if (!cfg || process.env.WA_AGENT_ENABLED !== "1" || !process.env.ANTHROPIC_API_KEY) return res;
  const hour = new Date(Date.now() + 330 * 60000).getUTCHours();
  res.quiet = hour < 8 || hour >= 21;
  const list = await candidates(cfg, ctx);
  res.found = list.length;
  if (res.quiet) return res;
  const wa = require("./whatsapp.js"), lint = require("./_lint.js"), rules = require("./_rules.js");
  const sys = await rules.block(cfg).catch(() => "");
  const todo = list.slice(0, max || 10);
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    if (until && Date.now() > until) { res.stopped = true; res.left = todo.length - i; break; }
    try {
      const th = await inbox.thread(cfg, c.phone);
      const msgs = (th.msgs || []).slice(-10);
      const hist = [];
      for (let i = 0; i < msgs.length - 1; i++) {
        if (msgs[i].dir === "in" && msgs[i + 1].dir === "out") { hist.push({ u: msgs[i].text, a: msgs[i + 1].text }); i++; }
      }
      const hrs = Math.round((Date.now() - c.lastIn) / 3600000);
      const lang = langOf(msgs);
      const ask = wa.nowIstCtx() + `[The patient has gone quiet for about ${hrs} hour(s) after our last message. Write ONE short caring message (2-4 lines) that picks up exactly where this chat stopped, adds one genuinely useful thing, and ends with ONE easy question or two slots. No greeting, no introduction, do not repeat what we already said, no pressure. "lead" must be null. Write it in ${LANG_RULE[lang]}.]`;
      const out = await wa.askClaude(hist, ask, c.name, "", sys);
      // The editor checks the language against what the patient wrote, not
      // against this English instruction.
      const theirs = msgs.filter((m) => m.dir === "in").map((m) => m.text).slice(-3).join("\n");
      const checked = await lint.check(cfg, out, theirs, msgs.filter((m) => m.dir === "out").map((m) => m.text), { channel: "re", profileName: c.name });
      const text = String(checked.reply || "").trim();
      if (!text) continue;
      if (!(await notify.sendWa(c.phone, text))) continue;
      await inbox.log(cfg, c.phone, { dir: "out", text, by: "ai", via: "reengage" });
      await guard.kvCommand(cfg, ["SET", `rg:${c.phone}`, JSON.stringify({ n: c.n + 1, at: Date.now(), lastIn: c.lastIn }), "EX", String(7 * 86400)]).catch(() => {});
      res.sent++;
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) { console.error("reengage:", c.phone, e && e.message); }
  }
  return res;
}

module.exports = { run, candidates, langOf, GAPS_MIN };
