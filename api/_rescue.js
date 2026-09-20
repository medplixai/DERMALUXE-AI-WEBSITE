// Nobody waits on a colleague who is not coming.
//
// Taking a chat over switches the agent off for that patient. That is right
// while somebody is actually answering. It is wrong when the chat is picked up
// and then forgotten: the patient sits there, and the agent that would have
// answered in seconds has been told to stay quiet.
//
// So, every ten minutes: a patient waiting more than 20 minutes on a person
// gets the team told, once. Still waiting after an hour, and the agent takes
// the chat back and answers what they actually asked.
//
// KV: rs:alert:<phone> — the team has been told (6 hours).
const guard = require("./_guard.js");
const inbox = require("./_inbox.js");
const notify = require("./_notify.js");

const ALERT_MIN = 20, RESUME_MIN = 60;
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

async function waiting(cfg) {
  const out = [];
  for (const t of await inbox.threads(cfg, 200)) {
    if (!t.human || t.lastDir !== "in" || !t.lastIn) continue;
    const mins = Math.round((Date.now() - t.lastIn) / 60000);
    if (mins < ALERT_MIN) continue;
    out.push({ phone: t.phone, name: t.name || "", by: t.human.by || "", mins, last: t.last || "", windowOpen: mins < 23.5 * 60 });
  }
  return out.sort((a, b) => b.mins - a.mins);
}

async function run(cfg, max) {
  const res = { waiting: 0, alerted: 0, resumed: 0 };
  if (!cfg) return res;
  const list = await waiting(cfg);
  res.waiting = list.length;
  for (const w of list) {
    // 20 minutes: tell the team, once.
    const nx = await guard.kvCommand(cfg, ["SET", `rs:alert:${w.phone}`, "1", "NX", "EX", "21600"]).catch(() => ({}));
    if (nx && nx.result) {
      const text = `⏳ *${w.name || w.phone} ${w.mins} nimishalu nundi reply kosam chustunnaru*\n\n${w.by ? w.by + " garu ee chat teesukunnaru." : "Evaro chat teesukunnaru."}\n💬 "${String(w.last).slice(0, 120)}"\n\nApp → Inbox lo reply cheyandi. Leda "🤖 AI ki ivvandi" nokkandi.`;
      for (const to of String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666").split(",").map(ten).filter((x) => x.length === 10)) {
        await notify.sendWa(to, text).catch(() => {});
      }
      try {
        const push = require("./_push.js");
        if (push.enabled()) await push.notifyCap(cfg, "inbox.reply", { title: `⏳ ${w.name || w.phone} waiting ${w.mins}m`, body: String(w.last).slice(0, 140), tab: "inbox", urgent: true, data: { kind: "inbox", phone: w.phone } });
      } catch (e) {}
      res.alerted++;
    }
    // An hour: the agent takes it back rather than leaving them there.
    if (w.mins >= RESUME_MIN && w.windowOpen && res.resumed < (max || 5)
      && process.env.WA_AGENT_ENABLED === "1" && process.env.ANTHROPIC_API_KEY) {
      try {
        const th = await inbox.thread(cfg, w.phone);
        const msgs = (th.msgs || []).slice(-12);
        const hist = [];
        for (let i = 0; i < msgs.length - 1; i++) if (msgs[i].dir === "in" && msgs[i + 1].dir === "out") { hist.push({ u: msgs[i].text, a: msgs[i + 1].text }); i++; }
        const lastIn = [...msgs].reverse().find((m) => m.dir === "in");
        const wa = require("./whatsapp.js"), lint = require("./_lint.js"), rules = require("./_rules.js");
        const out = await wa.askClaude(hist, lastIn ? lastIn.text : "hi", w.name, "[This chat was taken over by a colleague who has not answered. Answer the patient's own last message now, warmly, without mentioning the delay or any colleague.] ", await rules.block(cfg).catch(() => ""));
        const checked = await lint.check(cfg, out, lastIn ? lastIn.text : "", msgs.filter((m) => m.dir === "out").map((m) => m.text), { channel: "rs", profileName: w.name });
        const text = String(checked.reply || "").trim();
        if (text && await notify.sendWa(w.phone, text)) {
          await inbox.setHuman(cfg, w.phone, false, "");
          await inbox.log(cfg, w.phone, { dir: "out", text, by: "ai", via: "resumed" });
          res.resumed++;
        }
      } catch (e) { console.error("rescue:", w.phone, e && e.message); }
    }
  }
  return res;
}

module.exports = { run, waiting, ALERT_MIN, RESUME_MIN };
