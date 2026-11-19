// "Hi" — and then nothing.
//
// In the fortnight to 14 Nov, 64 of 211 people who wrote to the clinic on
// WhatsApp sent one greeting ("Hi", "Hello", "Dermaluxe", Meta's "Can I get
// more info on this?"), got the agent's "mee problem cheppandi", and never
// wrote again. Every follow-up the clinic has works off a lead — a name, a
// concern, a slot — and these people gave none, so nobody ever wrote to them
// again: almost a third of everyone who reached out. The daily review kept
// flagging them ("Hi ki greeting pampi, reply raakapovadam tho chat vadilesaru").
//
// Owner, 16 Nov: "ok". So, once per person and never again: two to
// twenty-two hours after their greeting — inside WhatsApp's free 24-hour
// window, during clinic hours — one short message with three buttons, so
// answering is a single tap.
//
// Left alone: anybody who said more than a greeting, a chat a colleague has
// answered or taken over, a lead the desk already has, a STOP, a job seeker,
// an Academy student, the owners.
//
// KV: nudge:hi:<phone> — they were sent it (90 days).
const guard = require("./_guard.js");
const inbox = require("./_inbox.js");

// A first message that says nothing yet: "Hi", "Hello mam", "Dermaluxe", "?".
const GREET_ONLY = /^(hi+|hii+ ?(mam|sir|madam|andi)?|hello+( (mam|sir|madam|andi))?|hlo+|hai+|hey+|namaste|namaskaram|namaskar|good ?(morning|afternoon|evening|night)|dermaluxe|dermaluxe by medicare|reply|ok|\?+|\.+)?[\s!.?🙏😊👋]*$/i;
const META_PREFILL = /^(hello|hi|hey)?[\s!.,]*(can i get more info(rmation)?( (on|about) this)?|i want to know more( about this)?|please tell me more( about this)?|tell me more about this|i'?m interested in this|i have a question about this|is this available|i would like to know more)[\s?.!]*$/i;
const saidNothing = (t) => { const s = String(t || "").trim(); return GREET_ONLY.test(s) || META_PREFILL.test(s); };

const TEXT = "Namaste 🙏 DermaLuxe nunchi malli. Mee concern okka maata lo cheppina chaalu — skin aa, hair aa? Kindha okati nokkandi, doctor tho correct plan chuddam 😊";
const BUTTONS = ["Skin", "Hair", "📅 Book Now"];
const MIN_H = 2, MAX_H = 22;
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

async function candidates(cfg, now) {
  const rows = await inbox.threads(cfg, 300);
  const owners = new Set(guard.ownerPhones());
  const r = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "499"]).catch(() => ({}));
  const leads = new Set(((r && r.result) || []).map((x) => { try { return ten(JSON.parse(x).phone); } catch (e) { return ""; } }).filter(Boolean));
  const out = [];
  for (const t of rows) {
    const ph = ten(t.phone);
    if (ph.length !== 10 || owners.has(ph) || leads.has(ph) || t.human) continue;
    if (Number(t.inCount || 0) > 2 || t.lastDir !== "out" || t.lastBy !== "ai") continue;
    const age = (now - Number(t.lastIn || 0)) / 3600000;
    if (!(age >= MIN_H && age <= MAX_H)) continue;
    out.push(ph);
  }
  return out;
}

async function run(cfg, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const res = { looked: 0, sent: 0 };
  if (!cfg) return res;
  if (!require("./_staffask.js").openNow(now)) return Object.assign(res, { closed: true });
  const notify = require("./_notify.js");
  for (const ph of await candidates(cfg, now)) {
    if (res.sent >= (o.max || 15)) break;
    res.looked++;
    const th = await inbox.thread(cfg, ph).catch(() => null);
    const msgs = (th && th.msgs) || [];
    const ins = msgs.filter((m) => m.dir === "in");
    if (!ins.length || !ins.every((m) => saidNothing(m.text))) continue;          // they said something real
    // Only the opener has gone to them. 18 Nov: a "Hi" got the opener, then
    // the re-engagement nudge, then this one an hour later — three unanswered
    // messages to somebody who had said one word.
    if (msgs.filter((m) => m.dir === "out").length > 1) continue;
    if (msgs.some((m) => m.dir === "out" && m.by && m.by !== "ai")) continue;    // a colleague has been in this chat
    if (await guard.setHas(cfg, "optout", ph).catch(() => false)) continue;
    const [hrS, hrSt, acad] = await Promise.all(["hr:s:", "hr:st:", "acad:ph:"].map((k) => guard.kvCommand(cfg, ["GET", k + ph]).catch(() => ({}))));
    if ((hrS && hrS.result) || (hrSt && hrSt.result) || (acad && acad.result)) continue;
    const nx = await guard.kvCommand(cfg, ["SET", `nudge:hi:${ph}`, "1", "NX", "EX", String(90 * 86400)]).catch(() => ({}));
    if (!(nx && nx.result)) continue;
    const ok = await notify.sendWaButtons(ph, TEXT, BUTTONS).catch(() => false);
    if (ok) {
      res.sent++;
      await inbox.log(cfg, ph, { dir: "out", text: TEXT, by: "ai" }).catch(() => {});
    } else {
      await guard.kvCommand(cfg, ["DEL", `nudge:hi:${ph}`]).catch(() => {});   // nothing reached them; the next hour may try
    }
  }
  return res;
}

module.exports = { run, candidates, saidNothing, GREET_ONLY, TEXT, BUTTONS };
