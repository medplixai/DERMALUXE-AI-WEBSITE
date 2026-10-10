// The moment a patient hesitates, show them who they would be trusting.
//
// "Doctor evaru?", "results vastaya?", "safe na?", "alochistanu" — every one
// of these is somebody who wants to come and has not yet been given a reason
// to. The agent answered with words. Words from a chatbot are not a reason.
// A photo of the doctor with her degrees and registration number, and three
// lines on what a consultation actually is — that is.
//
// It used to also send real before/after photos and the Google rating. Both
// are gone: NMC 8.1(v) forbids displaying "before and after" photographs for
// promotion (and 6.2 says patient consent does not make it permissible), and
// 3.2 Explanation V forbids sharing patient reviews for professional
// promotion. The doctor's qualifications and what a consultation involves are
// factual information, which 8.3(i) allows.
//
// Sent once per person a week, as pictures with captions, right after the
// agent's reply, ending in the choice that closes: slot, video, or a doubt.
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const docs = require("./_docs.js");

const BASE = () => String(process.env.PUBLIC_BASE || "https://www.dermaluxe.ai").replace(/\/+$/, "");
const DOCTOR = {
  img: "/assets/dr-nikhitha.jpg",
  // NMC 3.2 Explanation III/IV: an electronic-media post by an RMP or clinical
  // establishment must disclose name, qualifications, registration status and
  // the SMR/NMR registration number. docs.REG fills the last of those in; until
  // the owner supplies it the line is left out rather than guessed at.
  caption: () => "👩‍⚕️ *Dr. Nikhitha Priyanka* — MD (DVL)\nSenior Dermatologist · Main Consultant\n🎓 Ex-Senior Dermatologist, AIIMS Mangalagiri\n🎓 Aesthetics Fellowship (AAAFP), Mumbai"
    + (docs.regLine("nikhitha") ? "\n" + docs.regLine("nikhitha") : "")
    + "\n\nMee consultation direct ga doctor garu tho ne — full history chusi, mee skin/hair ki personal plan istaru.",
};
// What the words sound like when somebody is on the fence.
const ASK = /(doctor\s*(evaru|evar|who|name|qualif)|evaru\s*chust|who\s*(is|will)\s*(the\s*)?doctor|results?\s*(vast|osta|untay|guarantee|ela)|guarantee|safe\s*(na|aa|ah|\?)|side\s*effects?|risk|alochist|aalochist|chust[aā]nu|tarvata\s*chept|later\s*chept|think\s*(about|and)|nammak|trust|experience\s*(undi|unda|entha)|reviews?\s*(unnay|ela|entha)|rating|genuine|original|fake|bhayam|bayam|scared|afraid)/i;
const hesitant = (text) => ASK.test(String(text || ""));

// Send the pack. The `concern` and `gallery` options are still accepted so
// callers do not have to change, and are deliberately ignored — see the note
// at the top of this file.
async function send(cfg, phone, opts) {
  const ph = String(phone || "").replace(/\D/g, "").slice(-10);
  if (!cfg || ph.length !== 10) return { sent: false, why: "no phone" };
  const nx = await guard.kvCommand(cfg, ["SET", `trust:${ph}`, "1", "NX", "EX", String(7 * 86400)]).catch(() => ({}));
  if (!nx || !nx.result) return { sent: false, why: "already this week" };
  const o = opts || {};
  let n = 0;
  if (await notify.sendWaImageLink(ph, BASE() + DOCTOR.img, DOCTOR.caption())) n++;
  const text = `🩺 *Consultation lo em jarugutundi?*\n🔬 Doctor garu skin/hair ni dermoscope tho chusi cause cheptaru\n📋 Meeku correct treatment plan + exact cost — ade roju\n🙂 Treatment teesukovala vaddaa — mee ishtam, pressure ledu\n\nEppudu convenient andi?`;
  const ok = await notify.sendWaButtons(ph, text, ["📅 Slot chudandi", "🎥 Video consult", "❓ Inka doubt undi"]);
  if (ok) n++;
  if (!n) await guard.kvCommand(cfg, ["DEL", `trust:${ph}`]).catch(() => {});   // nothing went — let it try again
  await guard.kvCommand(cfg, ["LPUSH", "trust:log", JSON.stringify({ ts: Date.now(), ph: ph.slice(-4), phone: ph, n })]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "trust:log", "0", "499"]).catch(() => {});
  return { sent: n > 0, parts: n };
}

module.exports = { send, hesitant, ASK, DOCTOR };
