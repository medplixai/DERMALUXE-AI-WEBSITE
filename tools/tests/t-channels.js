// The other doors: Instagram DMs and comments, Facebook Messenger, and the
// phone line (the Twilio receptionist and the Exotel missed-call bridge).
//
// Each is a webhook anybody could post to, so first: without the shared
// secret, nothing gets in — and with no secret configured, still nothing.
// Then the same promises the WhatsApp agent keeps: a redelivered message is
// answered once, a conversation keeps one lead, and the desk's status and
// notes survive the patient writing again. A missed call gets one WhatsApp,
// not one per ring.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.WA_WEBHOOK_TOKEN = "hook";
process.env.IG_PAGE_TOKEN = "page";
process.env.IG_AGENT_ENABLED = "1";
process.env.ANTHROPIC_API_KEY = "test";
process.env.LEAD_NOTIFY_PHONES = "9989325777";

let claude = [], claudeCalls = 0, claudeDown = false, privateRefused = false;
const dms = [], comments = [], privates = [], publics = [];
global.fetch = async (url, opt) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    if (/You fix one WhatsApp reply/.test(String((opt && opt.body) || ""))) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.parse(opt.body).messages[0].content.split("\n")[1] || "ok" }] }) };   // the editor's rewrite is not a patient turn
    claudeCalls++;
    if (claudeDown) return { ok: false, status: 529, json: async () => ({}), text: async () => "overloaded" };
    const next = claude.length ? claude.shift() : { reply: "Namaste 🙏", lead: null };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(next) }] }) };
  }
  if (u.includes("/me/messages")) {
    const b = JSON.parse(opt.body);
    if (b.recipient.comment_id) {   // a private reply to a comment
      if (privateRefused) return { ok: false, status: 400, json: async () => ({}), text: async () => "refused" };
      privates.push({ to: b.recipient.comment_id, text: b.message.text }); return { ok: true, json: async () => ({}) };
    }
    dms.push({ to: b.recipient.id, text: (b.message || {}).text || "" }); return { ok: true, json: async () => ({}) };
  }
  if (u.includes("/private_replies") || u.includes("/replies")) { comments.push(u); publics.push({ on: u.split("/").slice(-2)[0], text: JSON.parse(opt.body).message }); return { ok: true, json: async () => ({}) }; }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};
const n = require(path.join(API, "_notify.js"));
n.waHandoff = async () => ({ ok: true });

const ig = h.load("instagram"), fb = h.load("messenger");
const exotel = h.load("exotel"), call = h.load("voice-call");
const leads = () => h.run(["LRANGE", "dl_leads", "0", "-1"]).map((x) => JSON.parse(x));
let mid = 0;
const igDm = (from, text) => ({ object: "instagram", entry: [{ id: "ourpage", messaging: [{ sender: { id: from }, message: { mid: "ig." + (++mid), text } }] }] });
const fbDm = (from, text) => ({ object: "page", entry: [{ id: "ourpage", messaging: [{ sender: { id: from }, message: { mid: "fb." + (++mid), text } }] }] });
const hook = { token: "hook" };

(async () => {
  console.log("THE OTHER DOORS\n");

  console.log("  — who gets in —");
  for (const [name, mod, body] of [["Instagram", ig, igDm("u1", "hi")], ["Messenger", fb, fbDm("u1", "hi")]]) {
    is((await h.call(mod, { token: "guess" }, body)).code, 403, `${name}: a message without the webhook's token is refused`);
    delete process.env.WA_WEBHOOK_TOKEN;
    is((await h.call(mod, {}, body)).code, 403, `${name}: and with no token configured at all, it still refuses`);
    process.env.WA_WEBHOOK_TOKEN = "hook";
    is((await h.call(mod, { "hub.mode": "subscribe", "hub.verify_token": "hook", "hub.challenge": "7" })).bin, "7", `${name}: Meta's handshake is answered`);
  }
  is((await h.call(ig, { setup: "1", key: "guess" })).code, 401, "the Instagram setup helper needs the admin key");

  const facts = require(path.join(API, "_facts.js")), realNow = Date.now;
  Date.now = () => Date.parse("2026-11-06T09:00:00+05:30");
  const onTheDay = facts.clinicFacts("Instagram", "");
  Date.now = () => Date.parse("2026-11-07T00:00:00+05:30");
  const dayAfter = facts.clinicFacts("Instagram", "");
  Date.now = realNow;
  is([/6 November 2026, 10:32 AM/.test(onTheDay), /NEVER invent one/.test(onTheDay), /GRAND OPENING/.test(dayAfter)], [true, true, false], "every agent knows the opening until the day is over, and stops inviting after it");
  Date.now = () => Date.parse("2026-11-20T10:00:00+05:30");
  const htOn = facts.clinicFacts("WhatsApp", "");
  Date.now = () => Date.parse("2026-12-07T00:30:00+05:30");
  const htOff = facts.clinicFacts("WhatsApp", "");
  Date.now = realNow;
  is([/₹59,999 all-inclusive, up to 2,000 grafts/.test(htOn), /NEVER call the hair transplant or the surgery "free"/.test(htOn), /HAIR TRANSPLANT PACKAGE/.test(htOff)], [true, true, false],
    "the hair transplant package is known until 6 December, never as 'free', and gone the day after");
  const G = require(path.join(API, "_goal.js")).goalFor;
  is([G({ concern: "Hair transplant cost" }).key, G({ concern: "Acne", km: 330 }).key, G({ concern: "Academy course enquiry – Skin" }).key,
      G({ concern: "Hair fall", outcome: "notravel" }).key, G({ type: "job", concern: "Nursing" }).key, G({ concern: "Pigmentation", booked: true }).key, G({ concern: "Acne", km: 5 }).key],
    ["ht_consult", "video_consult", "academy_seat", "respect", "redirect", "show_up", "clinic_consult"],
    "every lead gets one goal from what is known: transplant, far away, academy, said no, job, booked, or a clinic consultation");
  is([G({ concern: "Hair fall & male pattern baldness (hairline receding)" }).key, G({ concern: "Hair fall – 6 nelala lopu" }).key, /promise a result/i.test(G({ concern: "baldness" }).rule)],
    ["ht_consult", "clinic_consult", true], "baldness and a receding hairline go to the transplant consultation (owner, 7 Nov), hair fall alone does not, and surgery is never promised");
  is([G({ concern: "" }).next, G({ concern: "Acne" }).next, G({ concern: "Acne", name: "Ravi" }).next], ["concern adugu", "peru adugu", "2 slots offer cheyyi"],
    "and the next step is the one missing piece on the way to it");
  const GF = require(path.join(API, "_goal.js")).fromChat;
  is([GF(["hi", "hair transplant cost entha?"]).key, GF(["academy course details kavali"]).key, GF(["acne undi"], { name: "Sita" }).next],
    ["ht_consult", "academy_seat", "10-digit mobile number adugu (WhatsApp lo slot confirm kosam)"],
    "Instagram, Messenger and the website read the same goal from what was written, and ask the number before the slot");
  const hi = "Namaste andi, mee concern cheppandi.";
  is([facts.withAiLine(hi, true).endsWith(facts.AI_LINE), facts.withAiLine(hi, false), facts.withAiLine("Nenu clinic AI assistant ni andi.", true)],
    [true, hi, "Nenu clinic AI assistant ni andi."], "the first reply of a chat always says an AI is answering, once, even when the model forgets");
  is(/Is chat mein DermaLuxe AI/.test(facts.withAiLine("Namaste ji, aapki problem kya hai? Batayein, main aapki madad karta hoon, aap kitne time se pareshan hain?", true)), true,
    "a Hindi first reply gets the AI notice in Hindi");
  const lint = require(path.join(API, "_lint.js")), stubFetch = global.fetch, realKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = realKey || "test";
  const whole = { reply: "Hair transplant cost grafts batti untundi andi. Doctor garu scalp chusi exact ga cheptaru. Meeru e ooru nundi? Mee peru enti?" };
  const cut = (stop) => async () => ({ ok: true, json: async () => ({ stop_reason: stop, content: [{ type: "text", text: "Namaste 🙏 DermaLu" }] }) });
  global.fetch = cut("max_tokens");
  const stopped = await lint.rewrite(whole, [{ code: "two_questions", note: "one question" }], "cost entha?", {});
  global.fetch = cut("end_turn");
  const shrunk = await lint.rewrite(whole, [{ code: "two_questions", note: "one question" }], "cost entha?", {});
  global.fetch = stubFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey;
  is([stopped.out.reply, shrunk.out.reply], [whole.reply, whole.reply], "an editor's rewrite that stopped half-way, or lost most of the reply, never replaces the whole reply");
  is([lint.cutMidWord("Namaste 🙏 Mee concern cheppand", "Namaste 🙏 Mee concern cheppandi 😊"), lint.cutMidWord("Mee concern cheppandi", "Mee concern cheppandi 😊")], [true, false],
    "a rewrite that ends half-way through one of the original's words is spotted, a whole one is not");
  is(lint.dropLabel({ reply: "Namaste Mahadev garu 🙏 DermaLuxe nunchi.\nMee concern enti, Mahadev garu?" }, "Mahadev").reply, "Namaste 🙏 DermaLuxe nunchi.\nMee concern enti?",
    "a WhatsApp profile label used as a name is taken out without asking the model");
  const codes = (r, s) => lint.lintReply({ reply: r }, s || "hi", [], {}).map((f) => f.code);
  is([codes("Done! Ivala 6:30 PM ki note chesanu. Mee peru cheppandi, booking confirm chestాను?").includes("mixed_script"), codes("మీ concern ఏమిటి అండి?", "హలో అండి").includes("mixed_script")], [true, false],
    "Telugu letters slipped into a Tenglish word are caught; a Telugu reply to a Telugu writer is left alone");
  is(codes("Launch offer ₹49,999 (regular ₹1,00,000) — ₹9,999 tho seat lock cheyochu. Seat reserve cheddama?").includes("price_quoted"), false,
    "the academy's regular fee is a published fee, not a quoted price");
  const satNow = Date.now; Date.now = () => Date.parse("2026-11-07T10:00:00+05:30");
  const sat = facts.nowIstCtx(); Date.now = () => Date.parse("2026-11-07T21:30:00+05:30");
  const satLate = facts.nowIstCtx(); Date.now = satNow;
  is([/Saturday/.test(sat), /"repu" is SUNDAY/.test(sat), /offer Monday/.test(satLate)], [true, true, true], "every agent's clock says on a Saturday that tomorrow is a closed Sunday");

  // The real notify module, not the harness's stub: the window check is the point.
  const np = require.resolve(path.join(API, "_notify.js")), stubNotify = require.cache[np];
  delete require.cache[np];
  const realNotify = require(np);
  require.cache[np] = stubNotify;
  const graph = [];
  global.fetch = async (url, opt) => { graph.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ messages: [{ id: "m" }] }), text: async () => "" }; };
  process.env.WA_CLOUD_TOKEN = process.env.WA_CLOUD_TOKEN || "test";
  const alert = "🚨 *New Lead!* (whatsapp)\n👤 Ravi\n📱 9876543210\n💬 Hair transplant\n\nAnni leads: dermaluxe.ai/leads.html\n_(Reply *ok* — next alerts kuda ravadaniki)_";
  await realNotify.teamSend({}, "9949134666", alert);
  const shut = graph.shift() || {};
  await realNotify.markWindow({}, "9949134666");
  await realNotify.teamSend({}, "9949134666", alert);
  const open = graph.shift() || {};
  global.fetch = stubFetch;
  is([shut.type, shut.template && shut.template.name, JSON.stringify(shut).includes("\\n"), JSON.stringify(shut).includes("Ravi · 📱 9876543210")],
    ["template", "daily_digest_ping", false, true], "a team member who hasn't written in 24 hours still gets the alert, on one line, through the template");
  is([open.type || "text", open.text && open.text.body], ["text", alert], "once they have written, the full alert goes as plain text");
  graph.length = 0;
  global.fetch = async (url, opt) => { graph.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ messages: [{ id: "m" }] }), text: async () => "" }; };
  const broke = { text: async () => '{"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}' };
  await realNotify.aiFailed(broke); const firstWave = graph.length;
  await realNotify.aiFailed(broke);
  global.fetch = stubFetch;
  is([firstWave > 0, graph.length, JSON.stringify(graph[0] || {}).includes("credits aipoyayi")], [true, firstWave, true],
    "when the AI account runs dry the team is told, once, not on every message");

  console.log("\n  — Instagram —");
  claudeCalls = 0;
  const twice = igDm("ig-anu", "hi, pimples");
  await h.call(ig, hook, twice); await h.call(ig, hook, twice);
  is(claudeCalls, 1, "a redelivered DM is answered once");
  is(dms.filter((d) => d.to === "ig-anu").length, 1, "one reply, not two");
  const ourOwn = { object: "instagram", entry: [{ id: "ourpage", messaging: [{ sender: { id: "ourpage" }, message: { mid: "x1", text: "hi", is_echo: true } }] }] };
  claudeCalls = 0;
  await h.call(ig, hook, ourOwn);
  is(claudeCalls, 0, "our own sent messages coming back are not answered");
  claude.push({ reply: "Thanks Anu 🙏", lead: { name: "Anu", phone: "9876500401", concern: "Acne", heat: "warm" } });
  await h.call(ig, hook, igDm("ig-anu", "Anu, 9876500401"));
  let L = leads().filter((l) => l.src_id === "ig-anu");
  is([L.length, L[0].type, L[0].phone], [1, "instagram", "9876500401"], "a DM with a name becomes an Instagram lead");
  const k1 = `${L[0].ts}|9876500401`;
  h.run(["HSET", "dl_status", k1, "contacted"]);
  h.run(["HSET", "dl_notes", k1, JSON.stringify([{ ts: Date.now(), by: "Desk", text: "Called" }])]);
  await new Promise((r) => setTimeout(r, 3));
  claude.push({ reply: "Ok 🙏", lead: { name: "Anu", phone: "9876500401", concern: "Acne scars", heat: "hot" } });
  await h.call(ig, hook, igDm("ig-anu", "scars kuda"));
  L = leads().filter((l) => l.src_id === "ig-anu");
  const k2 = `${L[0].ts}|9876500401`;
  is([L.length, L[0].concern], [1, "Acne scars"], "writing again keeps one lead, with the fuller concern");
  is([h.run(["HGET", "dl_status", k2]), JSON.parse(h.run(["HGET", "dl_notes", k2]) || "[]").length], ["contacted", 1], "and the desk's status and note stay on it");
  const cmt = (id, from) => ({ object: "instagram", entry: [{ id: "ourpage", changes: [{ field: "comments", value: { id, text: "price entha?", from: { id: from, username: "someone" } } }] }] });
  claude.push({ dm: "Hi! DM lo details pampam 🙏", public_reply: "Check your DMs 😊" });
  claudeCalls = 0;
  await h.call(ig, hook, cmt("c1", "fan1")); await h.call(ig, hook, cmt("c1", "fan1"));
  is(claudeCalls, 1, "a comment is answered once, however often Meta sends it");
  claudeCalls = 0;
  await h.call(ig, hook, cmt("c2", "ourpage"));
  is(claudeCalls, 0, "and our own replies are not answered");

  const said = (id, from, text) => ({ id, text, from: { id: from, username: from } });
  const batch = (...values) => ({ object: "instagram", entry: [{ id: "ourpage", changes: values.map((value) => ({ field: "comments", value })) }] });
  claudeCalls = 0; privates.length = 0; publics.length = 0;
  claude.push({ dm: "Hi 🙏 WhatsApp: 99591 34666", public_reply: "Details DM chesam 💬" }, { dm: null, public_reply: "Thank you 🙏" }, { dm: null, public_reply: "Thank you 🙏" });
  await h.call(ig, hook, batch(said("c3", "fan3", "address ekkada?"), said("c4", "fan4", "All the best 👏"), said("c5", "fan5", "Super")));
  is([claudeCalls, privates.length, publics.length], [3, 1, 3], "three comments in one delivery get three answers, not one");
  const cl = leads().filter((l) => l.type === "ig_comment");
  is([cl.some((l) => l.name === "@fan3" && /address ekkada/.test(l.concern) && l.heat === "warm"), cl.some((l) => l.name === "@fan4" && l.heat === "cold"), cl.some((l) => l.name === "@fan5" && l.heat === "cold")], [true, true, true],
    "every answered comment reaches the desk as a lead — a question warm, praise cold (owner, 7 Nov)");
  claude.push({ reply: "Acne ki baaga help chestam 🙏 Mee number cheppandi?", lead: { name: "", phone: "", concern: "Acne", heat: "warm" } });
  await h.call(ig, hook, igDm("ig-nophone", "acne undi"));
  const igNp = leads().filter((l) => l.src_id === "ig-nophone");
  is([igNp.length, igNp[0] && igNp[0].concern, igNp[0] && !igNp[0].phone], [1, "Acne", true], "an Instagram enquiry with a concern but no number is on the desk's list too");

  privates.length = 0; publics.length = 0; privateRefused = true;
  claude.push({ dm: "Hi 🙏 details ivi", public_reply: "Details DM chesam 💬" });
  await h.call(ig, hook, batch(said("c6", "fan6", "price entha?")));
  privateRefused = false;
  is([privates.length, publics.map((p) => p.text)], [0, ["Thank you 🙏 Details kosam WhatsApp cheyandi: 99591 34666"]], "when Instagram refuses the private reply, the number goes in public, not \"DM chesam\"");

  publics.length = 0;
  claude.push({ dm: null, public_reply: "Laser ₹4,500 per session 😊" });
  await h.call(ig, hook, batch(said("c7", "fan7", "laser cost?")));
  is(publics.map((p) => p.text), ["Thank you 🙏 Details kosam WhatsApp cheyandi: 99591 34666"], "a public reply quoting a price never goes out");

  publics.length = 0; claudeDown = true;
  await h.call(ig, hook, batch(said("c8", "fan8", "appointment kavali"), said("c9", "fan9", "Congratulations 🎉")));
  claudeDown = false;
  is(publics.map((p) => p.on), ["c8"], "with the model down, a question still gets the WhatsApp number and praise gets nothing");

  // Comments from before the webhook, read back each hour (owner, 7 Nov).
  const igMod = require(path.join(API, "instagram.js"));
  const keepFetch = global.fetch;
  process.env.IG_LOGIN_TOKEN = "login";
  privates.length = 0; publics.length = 0;
  global.fetch = async (url, opt) => {
    const u = String(url);
    if (/graph\.instagram\.com\/v[\d.]+\/me\?/.test(u)) return { ok: true, json: async () => ({ user_id: "ourig", username: "dermaluxe.ai" }) };
    if (/\/me\/media\?/.test(u)) return { ok: true, json: async () => ({ data: [{ id: "m1", timestamp: new Date().toISOString() }] }) };
    if (/\/m1\/comments\?/.test(u)) return { ok: true, json: async () => ({ data: [
      { id: "old1", text: "hair transplant cost entha?", username: "asker", from: { id: "u1", username: "asker" }, replies: { data: [] } },
      { id: "old2", text: "Super 😍", username: "fan", from: { id: "u2", username: "fan" }, replies: { data: [] } },
      { id: "old3", text: "price?", username: "done", from: { id: "u3", username: "done" }, replies: { data: [{ username: "dermaluxe.ai", from: { id: "ourig" } }] } },
    ] }) };
    if (/ig\.refresh|refresh_access_token/.test(u)) return { ok: false, json: async () => ({}) };
    return keepFetch(url, opt);
  };
  claude.push({ dm: "Hi 🙏 WhatsApp: 99591 34666", public_reply: "Details DM chesam 💬" }, { dm: "Thank you 😊 skin leda hair doubt unte adagandi", public_reply: "Thank you 🙏" });
  const sw = await igMod.sweepIgComments(h.cfg || {}, 20);
  global.fetch = keepFetch; delete process.env.IG_LOGIN_TOKEN;
  const swl = leads().filter((l) => l.type === "ig_comment");
  is([sw.handled, swl.some((l) => l.name === "@asker" && l.heat === "warm"), swl.some((l) => l.name === "@fan" && l.heat === "cold"), swl.some((l) => l.name === "@done")],
    [2, true, true, false], "old comments we never answered are answered and become leads — a question warm, praise cold — and one we already answered is left");

  dms.length = 0;
  claude.push({ reply: "Hi Ravi 🙏", lead: null }, { reply: "Hi Sita 🙏", lead: null });
  await h.call(ig, hook, { object: "instagram", entry: [
    { id: "ourpage", messaging: [{ sender: { id: "ig-b1" }, message: { mid: "ig.b1", text: "hello" } }] },
    { id: "ourpage", messaging: [{ sender: { id: "ig-b2" }, message: { mid: "ig.b2", text: "hi" } }] }] });
  is(["ig-b1", "ig-b2"].every((who) => dms.some((d) => d.to === who)), true, "two DMs in one delivery are both answered");

  dms.length = 0; claudeCalls = 0;
  const wordless = (who, extra) => ({ object: "instagram", entry: [{ id: "ourpage", messaging: [{ sender: { id: who }, message: Object.assign({ mid: "ig.w" + (++mid) }, extra) }] }] });
  await h.call(ig, hook, wordless("ig-reel", { attachments: [{ type: "ig_reel", payload: { reel_video_id: "1" } }] }));
  await h.call(ig, hook, wordless("ig-story", { attachments: [{ type: "story_mention", payload: { url: "https://cdn/x" } }] }));
  is([claudeCalls, dms.some((d) => d.to === "ig-reel"), dms.some((d) => d.to === "ig-story")], [2, true, true], "a shared reel or a story mention with no words still gets a reply");
  claudeCalls = 0;
  await h.call(ig, hook, wordless("ig-del", { is_deleted: true }));
  is(claudeCalls, 0, "a deleted message does not");

  console.log("\n  — Messenger —");
  claudeCalls = 0;
  const fbTwice = fbDm("fb-ravi", "hello");
  await h.call(fb, hook, fbTwice); await h.call(fb, hook, fbTwice);
  is(claudeCalls, 1, "a redelivered message is answered once");
  claude.push({ reply: "Thanks Ravi 🙏", lead: { name: "Ravi", phone: "9876500402", concern: "Hair fall" } });
  await h.call(fb, hook, fbDm("fb-ravi", "Ravi 9876500402 hair fall"));
  let F = leads().filter((l) => l.src_id === "fb-ravi");
  const f1 = `${F[0].ts}|9876500402`;
  h.run(["HSET", "dl_status", f1, "booked"]);
  await new Promise((r) => setTimeout(r, 3));
  claude.push({ reply: "Ok", lead: { name: "Ravi", phone: "9876500402", concern: "Hair fall, dandruff" } });
  await h.call(fb, hook, fbDm("fb-ravi", "dandruff kuda"));
  F = leads().filter((l) => l.src_id === "fb-ravi");
  is([F.length, h.run(["HGET", "dl_status", `${F[0].ts}|9876500402`])], [1, "booked"], "one lead, and the desk's status survives");
  claudeCalls = 0;
  for (let i = 0; i < 16; i++) await h.call(fb, hook, fbDm("fb-spam", "m" + i));
  is(claudeCalls, 15, "fifteen messages an hour reach the model, not more");

  console.log("\n  — a missed call (Exotel) —");
  process.env.EXOTEL_TOKEN = "exo";
  is((await h.call(exotel, { token: "hook", event: "missed", CallFrom: "09876500403" })).code, 403, "the telephony vendor's own secret, not the Meta one");
  h.sent.length = 0;
  const m1 = await h.call(exotel, { token: "exo", event: "missed", CallFrom: "09876500403" });
  is([m1.code, m1.body.sent], [200, true], "a missed call gets a WhatsApp");
  is(h.sent.some((s) => s[0] === "wa" && s[1] === "9876500403"), true, "to the caller's ten-digit number");
  is(h.sent.some((s) => s[0] === "wa" && s[1] === "9989325777" && /Missed call/.test(s[2])), true, "and the team hears about it");
  h.sent.length = 0;
  const m2 = await h.call(exotel, { token: "exo", event: "missed", CallFrom: "09876500403" });
  is([m2.body.why, h.sent.length], ["deduped", 0], "calling back three times does not get three messages");
  h.sent.length = 0;
  const ans = await h.call(exotel, { token: "exo", event: "passthru", CallFrom: "09876500404", DialCallStatus: "completed", DialCallDuration: "95" });
  is([ans.body.note, h.sent.length], ["answered — no message", 0], "an answered call gets nothing");
  const busy = await h.call(exotel, { token: "exo", event: "passthru", CallFrom: "09876500404", DialCallStatus: "busy" });
  is(busy.body.sent, true, "a busy line does");
  const ivr = await h.call(exotel, { token: "exo", event: "ivr", CallFrom: "09876500405", d: "2" });
  const addr = (h.sent.find((s) => s[1] === "9876500405") || [])[2] || "";
  is(/Kasturi Vari Street/.test(addr), true, "pressing 2 sends the address");
  // /r/clinic is a smart link that opens WhatsApp: somebody who rang for the
  // address and tapped "Maps" was sent back into the chat they came from.
  is([/maps\?cid=/.test(addr), /\/r\/clinic/.test(addr)], [true, false], "and a map link that opens a map, not the WhatsApp chat again");

  console.log("\n  — the phone receptionist (Twilio) —");
  delete process.env.TWILIO_AUTH_TOKEN;
  is((await h.call(call, { token: "guess" }, { From: "+919876500406" })).code, 403, "without the secret, no call is answered");
  const greet = await h.call(call, hook, { From: "+919876500406", CallSid: "CA1" }, { headers: { host: "www.dermaluxe.ai" } });
  is([greet.code, /<Gather input="speech"/.test(String(greet.bin))], [200, true], "a call is greeted and listened to");
  is(String(greet.bin).includes("&step=turn"), false, "and the XML it returns is well formed (no bare &)");
  process.env.TWILIO_AUTH_TOKEN = "twilio";
  is((await h.call(call, hook, { From: "+919876500406" }, { headers: { host: "www.dermaluxe.ai", "x-twilio-signature": "forged" }, url: "/api/voice-call?token=hook" })).code, 403, "once Twilio's key is set, a forged signature is refused");
  delete process.env.TWILIO_AUTH_TOKEN;
  claude.push({ reply: "Saturday 5 ki book chesanu andi.", lead: { name: "Kiran", concern: "Hair fall", heat: "hot" }, end: true });
  const turn = await h.call(call, { token: "hook", step: "turn" }, { From: "+919876500406", SpeechResult: "Naa peru Kiran, hair fall, Saturday 5" }, { headers: { host: "www.dermaluxe.ai" } });
  is(/<Hangup\/>/.test(String(turn.bin)), true, "a finished booking ends the call");
  const C = leads().filter((l) => l.type === "phone_call");
  is([C.length, C[0] && C[0].phone, C[0] && C[0].heat], [1, "9876500406", "hot"], "and the caller is a lead, with the number they rang from");
  h.sent.length = 0;
  await h.call(call, { token: "hook", step: "status" }, { From: "+919876500407", CallStatus: "no-answer" });
  await h.call(call, { token: "hook", step: "status" }, { From: "+919876500407", CallStatus: "no-answer" });
  is(h.sent.filter((s) => s[0] === "wa" && s[1] === "9876500407").length, 1, "a call nobody answered gets one WhatsApp, not one per attempt");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe other doors behave");
  process.exit(fails ? 1 : 0);
})();
