// Template messages are what reach a patient whose 24-hour window is shut.
// On 22 Nov 2026 four booking confirmations never arrived: the text had a new
// line in it, and Meta refuses the whole template for that (error 132018).
// This sends through the real sendWaTemplate with Meta stubbed, and looks at
// exactly what would have been posted.
process.env.WA_CLOUD_TOKEN = "test-token";
process.env.WA_PHONE_ID_ALLOWLIST = "1000000000";
const path = require("path");
const API = path.resolve(__dirname, "..", "..", "api");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const sent = [];
global.fetch = async (url, opt) => {
  const body = JSON.parse(opt.body);
  sent.push(body);
  // Behave like Meta: a variable with a new line, a tab or 5 spaces is refused.
  const bad = (body.template && body.template.components || []).some((c) =>
    (c.parameters || []).some((p) => /[\n\r\t]| {5,}/.test(p.text)));
  if (bad) return { ok: false, status: 400, json: async () => ({ error: { code: 132018, message: "Param text cannot have new-line/tab characters" } }) };
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.x" }] }) };
};

const notify = require(path.join(API, "_notify.js"));

(async () => {
  const booking = "📅 Lakshmi, mee appointment book ayindi — 11:30 AM, 24 Nov.\nDermaLuxe by Medicare, Eluru.";
  const r = await notify.sendWaTemplate("9876500111", "clinic_update", ["Lakshmi", booking]);
  is(r.ok, true, "a booking message with a new line now reaches Meta's approval");
  const text = sent[0].template.components[0].parameters[1].text;
  is(/[\n\r\t]/.test(text), false, "no new line or tab left in what is sent");
  is(text, "📅 Lakshmi, mee appointment book ayindi — 11:30 AM, 24 Nov. DermaLuxe by Medicare, Eluru.", "the line break becomes one space, nothing else changes");

  const waitlist = "Namaste Ravi garu 🙏 slot khali ayindi.\n\nKavalante *YES* ani reply cheyandi\t😊      ok";
  const r2 = await notify.sendWaTemplate("9876500112", "clinic_update", ["Ravi", waitlist]);
  is(r2.ok, true, "two new lines, a tab and a long run of spaces are all accepted");
  is(sent[1].template.components[0].parameters[1].text, "Namaste Ravi garu 🙏 slot khali ayindi. Kavalante *YES* ani reply cheyandi 😊 ok", "each becomes a single space");

  is(notify.tplText("x".repeat(600)).length, 500, "a variable is still capped at 500 characters");
  is(notify.tplText(null), "", "an empty variable sends as empty, not the word null");

  // The greeting slot: tellPatient used to put the message's first word there,
  // which for a booking was the 📅 emoji.
  const src = require("fs").readFileSync(path.join(API, "schedule.js"), "utf8");
  is(/split\(" "\)\[0\] \|\| "Hi"/.test(src), false, "tellPatient no longer greets with the message's first word");
  const calls = src.match(/await tellPatient\([^;]*\);/g) || [];
  is(calls.length >= 4 && calls.every((c) => /,\s*(next|w|cur)\.name\)\s*;$/.test(c)), true, "every booking message passes the patient's name for the greeting");

  if (fails) { console.log(`✗ ${fails} failed`); process.exit(1); }
  console.log("ok — template variables are flattened before Meta sees them");
})();
