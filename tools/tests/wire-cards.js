// The pictures on the home page's treatment cards.
//
// This check exists because of a real bug, not a hypothetical one. The first
// version of tools/card-images.js filled a card that had no picture of its own
// with the nearest one it could find. That put a photograph of a fungal nail
// under "Brittle & Discoloured Nails" and under "Ingrown Toenail Treatment",
// each carrying alt text that said, in the markup, that the picture showed the
// condition named on the card. Four identical toenails also appeared in a row.
//
// So: a card shows its own picture or it shows none, and the picture it points
// at must exist. A card still waiting is fine and is printed — but it must have
// a subject in tools/page-images.js, otherwise "waiting" quietly means
// "forgotten".
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const gen = fs.readFileSync(path.join(ROOT, "tools/page-images.js"), "utf8");
const map = fs.readFileSync(path.join(ROOT, "tools/card-images.js"), "utf8");

let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log(`  ${ok ? "ok" : "✗ "} ${msg}`); };

const cards = html.split(/<article class="svc/).slice(1).map(c => ({
  title: ((c.match(/<h4[^>]*>(.*?)<\/h4>/) || [])[1] || "?").trim(),
  src:   (c.match(/class="svc__img" src="([^"]+)"/) || [])[1] || null,
  alt:   (c.match(/class="svc__img"[^>]*alt="([^"]*)"/) || [])[1] || "",
}));
say(cards.length > 0, `${cards.length} treatment cards on the home page`);

// 1. No card borrows another's picture.
const users = {};
cards.filter(c => c.src).forEach(c => (users[c.src] = users[c.src] || []).push(c.title));
const shared = Object.entries(users).filter(([, v]) => v.length > 1);
shared.forEach(([f, v]) => console.log(`  ✗  ${f.replace("assets/tx/", "")} is on ${v.length} cards: ${v.join(", ")}`));
say(shared.length === 0, "no card is showing another card's picture");

// 2. Every picture a card points at is actually there.
const missing = cards.filter(c => c.src && !fs.existsSync(path.join(ROOT, c.src)));
missing.forEach(c => console.log(`  ✗  ${c.title} points at a file that is not there: ${c.src}`));
say(missing.length === 0, "every card picture exists on disk");

// 3. The alt text names the card it sits on — it is a statement about the
//    picture, so it must not name a condition the picture does not show.
const mislabelled = cards.filter(c => c.src &&
  !c.alt.includes(c.title.replace(/&amp;/g, "and").replace(/&middot;/g, "·")));
mislabelled.forEach(c => console.log(`  ✗  alt text on "${c.title}" does not name that card: ${c.alt}`));
say(mislabelled.length === 0, "every alt text names its own card");

// 4. NMC 7.2 — the source mark, once for the whole list.
const marks = (html.match(/class="svc-ai-note"/g) || []).length;
say(marks === 1, `the AI source mark appears once above the list (found ${marks})`);
say(/generated with AI/i.test(html), "the mark says the pictures are generated");
say(html.includes("none is a photograph of a patient"), "the mark says none is a patient");

// 5. Cards still waiting must each have a subject ready to generate.
const waiting = cards.filter(c => !c.src).map(c => c.title);
const slugFor = t => (map.match(new RegExp(`"${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*"([^"]+)"`)) || [])[1];
const orphan = waiting.filter(t => { const s = slugFor(t); return !s || !gen.includes(`"${s}"`); });
orphan.forEach(t => console.log(`  ✗  "${t}" has no picture and no subject to generate one`));
say(orphan.length === 0, `${waiting.length} cards still waiting, every one with a subject ready`);
if (waiting.length) console.log(`     waiting: ${waiting.join(", ")}`);

console.log(bad ? `\n  ${bad} problem(s)` : `\n  ${cards.length - waiting.length} of ${cards.length} cards pictured, none borrowed`);
process.exit(bad ? 1 : 0);
