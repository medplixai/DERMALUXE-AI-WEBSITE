// One thing asked at a time, and a reply a person can read on a phone.
//
// The agent exam of 16 Nov scored 79: five of twelve chats were asked two
// things in one message ("pick a time — and your name?"), and four got a wall
// of text. Real replies that week ran to 600 characters. Owner, 16 Nov: "ok
// rendu fix cheyyi". The editor now catches both before a reply is sent.
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const L = h.load("_lint");
const codes = (reply, extra, said, opts) => L.lintReply(Object.assign({ reply }, extra || {}), said || "Hair fall undi", [], opts || {}).map((f) => f.code);
const has = (reply, code, extra, said, opts) => codes(reply, extra, said, opts).includes(code);
const SLOTS = { slots: ["Ivala 6:30 PM", "Repu 11:00 AM", "Repu 4:00 PM"] };

console.log("ONE ASK, SHORT REPLY\n");
console.log("  — two things at once —");
is(has("Sare andi 🙏 Mee peru, ooru cheppandi?", "two_questions"), true, "\"peru, ooru cheppandi?\" is two asks, though it has one question mark");
is(has("Ee timings lo meeku edi convenient? Mee peru kuda cheppandi 😊", "two_questions", SLOTS), true, "a time and the name together, with slots, is caught");
is(has("Super andi 😊 Mee peru cheppandi andi?", "two_questions", SLOTS), true, "slots plus \"mee peru?\" — the slots are already a question");
is(has("Mee peru cheppandi. Meeru em chestuntaru — cosmetologist aa, fresher aa?", "two_questions", {}, "Academy course details"), true, "name and background together, for the academy too");

console.log("\n  — one thing —");
is(has("Mee skin kosam em kavali andi — glow, tanning, leda pimple marks?", "two_questions"), false, "one question about the concern");
is(has("Kaikaluru nunchi oke trip lo ayipoyela slot pettukundam — ee timings lo meeku saripoyedi tap cheyandi 😊", "two_questions", SLOTS), false, "slots with a lead-in and nothing else");
is(has("Super Bhavani garu 😊 Ivala *7:30 PM* appointment confirm. Rama Mahal, Ramachandra Rao Peta. Marchali ante okka maata cheppandi 🙏", "two_questions"), false, "a confirmation with \"marchali ante cheppandi\" is not a second ask");
is(has("Namaste 🙏 DermaLuxe by Medicare nunchi — mee problem cheppandi, manam tappakunda help chestam 😊\n_Ee chat lo DermaLuxe AI help chestundi — staff tho matladali ante *staff* ani type cheyandi._", "two_questions"), false, "the opener with its quiet AI line");
is(has("Iddaru okesari chupinchukovachu andi 😊 Amma gari peru, mariyu vaari concern?", "two_questions", {}, "Amma ki kuda chupinchali"), false, "a family booking's one combined question stays allowed");
is(has("Since when have you had this problem?", "two_questions", { buttons: ["< 6 months", "1 year+"] }, "I have hair fall since some time"), false, "\"since when\" is one ask, not a since and a when");
is(has("Hair fall entakalam nundi undi andi? Kindha okati select cheyandi.", "two_questions", { buttons: ["6 nelala lopu", "1 year+"] }), false, "a question and its buttons");

console.log("\n  — length —");
const wall = "Manchi decision andi 👍 PRP lo mee sonta blood nunchi growth factors teesi scalp lo micro-injections ga istaru — hair roots ki direct nutrition andutundi. Sitting 45-60 nimishalu, numbing tho comfortable ga untundi, aa rojee intiki vellipovachu.\n\nSadharanam ga nela ki okati cheppuna 3-6 sittings — kotha baby hairs 2-3 nelallo, thickness 4-6 nelallo kanipistundi. Mundu doctor garu scalp chusi PRP meeku saripotundo ledo confirm chesi plan istaru.\n\nKaikaluru nunchi oke trip lo ayipoyela udayam leda madhyahnam slot pettukundam — ee timings lo meeku saripoyedi tap cheyandi 😊";
is(has(wall, "too_long", SLOTS), true, "a 600-character reply is sent back to be cut");
is(has("Sadharanam ga 3-6 sittings andi, nela ki okati. Results 2-3 nelallo kanipistayi. Ee timings lo meeku edi convenient?", "too_long", SLOTS), false, "a three-line answer is fine");
const footer = "Hair fall ki mundu cause teliyali andi — thyroid, stress, diet anni chustaru. Roju protein food tinandi, 7 gantala nidra unchandi. Mana Dr. Nikhitha Priyanka garu scalp chusi correct plan istaru. Hair fall entakalam nundi undi?\n_Ee chat lo DermaLuxe AI help chestundi — staff tho matladali ante *staff* ani type cheyandi._";
is(has(footer, "too_long"), false, "the AI line at the foot does not count against the length");
is(has(wall, "too_long", SLOTS, "", { academy: true }), false, "an academy answer may carry the course");
is(has(wall, "too_long", SLOTS, "", { analysis: true }), false, "and a photo analysis may run longer");
is(has(wall.replace("Kaikaluru nunchi", "Appointment confirm ✅ —"), "too_long"), false, "a booking confirmation with the address may too");

console.log("\n  — a WhatsApp profile name is not their name —");
is(L.lintReply({ reply: "Namaste 🙏 Phani Madhavi garu, meeku skin problem aa leda hair problem aa?" }, "Hi, can I get more information", [], { profileName: "Phani Madhavi" }).map((f) => f.code).includes("profile_name_used"), true, "\"Phani Madhavi garu\" is caught, not only \"Phani garu\" (16 Nov)");
is(L.dropLabel({ reply: "Phani Madhavi garu, meeku skin aa hair aa?" }, "Phani").reply, "Meeku skin aa hair aa?", "and taken out whole");

console.log("\n  — a nudge in the patient's own language —");
const R = h.load("_reengage");
const M = (a) => a.map((text) => ({ dir: "in", text }));
is(R.langOf(M(["మేడం ఆయిల్ స్కిన్ గా ఉంటుంది మొహం", "6 నెలల లోపు", "Money cost"])), "telugu", "Telugu script in, Telugu script out (she got English on 16 Nov)");
is(R.langOf(M(["How do I get skin analysis?", "[📷 photo]"])), "english", "English in, English out (she got Tenglish)");
is(R.langOf(M(["Hi", "Skin", "Hair fall undi", "Chala kalam", "Eluru"])), "tenglish", "button taps and Tenglish stay Tenglish");
is(R.langOf(M(["ఏమిటి ధర?", "Skin"])), "tenglish", "the ad's own \"ఏమిటి ధర?\" is not the patient's English — Tenglish, not English (17 Nov)");
is(R.langOf(M(["చికిత్స ఖర్చు ఎంత?", "Skin", "పర్మినెంట్ గా glowing skin chestara"])), "telugu", "but Telugu script they typed themselves still counts");

console.log("\n  — another alphabet —");
is(has("Vacchetappudu mukham meeda makeup или cream emi lekunda randi. Repu 6:30 PM ok na?", "foreign_script"), true, "\"makeup или cream\" is caught (17 Nov)");
is(has("नमस्ते 🙏 आपकी समस्या क्या है?", "foreign_script", {}, "मुझे बाल झड़ने की समस्या है"), false, "Hindi to a Hindi speaker is not");

console.log("\n  — \"don't call, don't message\" —");
for (const [t, want, why] of [
  ["Please kavalante nenne vasta ok astamanam cheya kandi call s msg", true, "the 18 Nov message — calls and messages, words in any order"],
  ["Stop calling me", true, "in English"],
  ["కాల్ చేయకండి", true, "in Telugu script"],
  ["Ippudu call cheyakandi, evening cheyandi", false, "\"not now, evening\" is a when, not a no"],
  ["Office lo unna call cheyakandi", false, "\"I'm at the office\" too"],
  ["Repu call cheyandi", false, "and \"call tomorrow\" is a yes"],
]) is(L.asksToStop(t), want, why);

console.log("\n  — an appointment they do not have —");
is(has("Namaste 🙏 Mee appointment ivala 6:30 PM ki hold ayyi undi. Location pampistunnanu.", "false_appointment", {}, "Hi"), true, "\"mee appointment hold lo undi\" to a bare \"Hi\" is caught (18 Nov)");
is(L.lintReply({ reply: "Mee appointment ivala 6:30 PM ki hold lo ne undi 🙏 Location pampistunnanu." }, "Location ekkada", [], { booked: true }).map((f) => f.code).includes("false_appointment"), false, "but not for somebody who has one");

console.log("\n  — the same phrase every time —");
const prev = ["Glow 3-4 vaaralu untundi. Jangareddygudem nunchi oke trip avvela morning better?", "Sare andi. Jangareddygudem nunchi oke trip avvela ee times lo edi set avutundi?"];
is(L.lintReply({ reply: "Hydrafacial 45 nimishalu. Jangareddygudem nunchi oke trip avvela ee times lo edi convenient?" }, "Okey", prev, {}).map((f) => f.code).includes("same_phrase"), true, "a phrase in each of the last two replies is not said a third time");
is(L.lintReply({ reply: "Afternoon slots: 2:30 PM leda 4:30 PM — edi convenient?" }, "Afternoon", prev, {}).map((f) => f.code).includes("same_phrase"), false, "a fresh reply passes");

console.log("\n  — the editor's own instructions —");
const src = require("fs").readFileSync(require("path").join(process.env.DL_API || require("path").resolve("api"), "_lint.js"), "utf8");
is(/do not also ask the name or town/.test(src) && /2–4 short lines, under \$\{MAX_BODY\} characters/.test(src), true, "the rewrite is told the same two rules");

console.log(fails ? `\n${fails} FAILURE(S)` : "\none ask, short replies");
process.exit(fails ? 1 : 0);
