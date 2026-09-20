// The moment a patient hesitates, show them who they would be trusting.
//
// "Doctor evaru?", "results vastaya?", "safe na?", "alochistanu" — every one
// of these is somebody who wants to come and has not yet been given a reason
// to. The agent answered with words. Words from a chatbot are not a reason.
// A photo of the doctor with her degrees, the clinic's Google rating, real
// before/after of their own concern, and three lines on what a consultation
// actually is — that is.
//
// Sent once per person a week, as pictures with captions, right after the
// agent's reply, ending in the choice that closes: slot, video, or a doubt.
const guard = require("./_guard.js");
const notify = require("./_notify.js");

const BASE = () => String(process.env.PUBLIC_BASE || "https://www.dermaluxe.ai").replace(/\/+$/, "");
const DOCTOR = {
  img: "/assets/dr-nikhitha.jpg",
  caption: "👩‍⚕️ *Dr. Nikhitha Priyanka* — MD (DVL)\nSenior Dermatologist · Main Consultant\n🎓 Ex-Senior Dermatologist, AIIMS Mangalagiri\n🎓 Aesthetics Fellowship (AAAFP), Mumbai\n\nMee consultation direct ga doctor garu tho ne — full history chusi, mee skin/hair ki personal plan istaru.",
};
// What the words sound like when somebody is on the fence.
const ASK = /(doctor\s*(evaru|evar|who|name|qualif)|evaru\s*chust|who\s*(is|will)\s*(the\s*)?doctor|results?\s*(vast|osta|untay|guarantee|ela)|guarantee|safe\s*(na|aa|ah|\?)|side\s*effects?|risk|alochist|aalochist|chust[aā]nu|tarvata\s*chept|later\s*chept|think\s*(about|and)|nammak|trust|experience\s*(undi|unda|entha)|reviews?\s*(unnay|ela|entha)|rating|genuine|original|fake|bhayam|bayam|scared|afraid)/i;
const hesitant = (text) => ASK.test(String(text || ""));

async function ratingLine(cfg) {
  try {
    // the same cached copy /api/reviews serves the website from
    const r = await guard.kvCommand(cfg, ["GET", "gplace:reviews:v1"]).catch(() => ({}));
    const d = r && r.result ? JSON.parse(r.result) : null;
    if (d && d.rating && d.count) return `⭐ Google lo *${d.rating}* rating · ${d.count} reviews\n${d.mapsUrl || "https://www.google.com/maps?cid=6720707313608974554"}`;
  } catch (e) {}
  return "";
}

// Send the pack. `concern` picks the before/after set; `gallery(want)` is the
// agent's own gallery lookup, passed in so this file does not need to know
// how the media is served.
async function send(cfg, phone, opts) {
  const ph = String(phone || "").replace(/\D/g, "").slice(-10);
  if (!cfg || ph.length !== 10) return { sent: false, why: "no phone" };
  const nx = await guard.kvCommand(cfg, ["SET", `trust:${ph}`, "1", "NX", "EX", String(7 * 86400)]).catch(() => ({}));
  if (!nx || !nx.result) return { sent: false, why: "already this week" };
  const o = opts || {};
  let n = 0;
  if (await notify.sendWaImageLink(ph, BASE() + DOCTOR.img, DOCTOR.caption)) n++;
  try {
    const shots = o.gallery && o.concern ? await o.gallery(o.concern) : [];
    for (const it of (shots || []).slice(0, 2)) {
      if (it && it.url && await notify.sendWaImageLink(ph, it.url, it.caption || "Real patient result — DermaLuxe, Eluru (individual results vary)")) n++;
    }
  } catch (e) {}
  const rating = await ratingLine(cfg);
  const text = `${rating ? rating + "\n\n" : ""}🩺 *Consultation lo em jarugutundi?*\n🔬 Doctor garu skin/hair ni dermoscope tho chusi cause cheptaru\n📋 Meeku correct treatment plan + exact cost — ade roju\n🙂 Treatment teesukovala vaddaa — mee ishtam, pressure ledu\n\nEppudu convenient andi?`;
  const ok = await notify.sendWaButtons(ph, text, ["📅 Slot chudandi", "🎥 Video consult", "❓ Inka doubt undi"]);
  if (ok) n++;
  if (!n) await guard.kvCommand(cfg, ["DEL", `trust:${ph}`]).catch(() => {});   // nothing went — let it try again
  await guard.kvCommand(cfg, ["LPUSH", "trust:log", JSON.stringify({ ts: Date.now(), ph: ph.slice(-4), phone: ph, n })]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "trust:log", "0", "499"]).catch(() => {});
  return { sent: n > 0, parts: n };
}

module.exports = { send, hesitant, ASK, DOCTOR };
