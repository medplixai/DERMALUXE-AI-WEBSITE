// The structured data is what Google reads: the FAQ blocks, the clinic's
// hours, the offer's end date. Nothing on the site displays it, so when it
// breaks nobody notices — it simply stops being used, and the rich result
// quietly disappears from the search page.
//
// It breaks easily. Making the phone numbers in the FAQ answers pressable
// put <a href="tel:..."> inside three of these blocks on 28 October 2026;
// the quotes in the markup ended the JSON string early and all three stopped
// parsing. The page looked perfectly fine.
//
// Two questions per block: does it parse, and does it hold markup it should
// not. Plus the one thing a wrong answer here is expensive for — that every
// telephone it advertises is a number the clinic actually answers.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const OURS = new Set(["+919949134666", "+919959134666", "+919989325777"]);
let bad = 0, blocks = 0, pages = 0, phones = 0;

const phonesIn = (v, out) => {
  if (v == null) return out;
  if (Array.isArray(v)) { v.forEach((x) => phonesIn(x, out)); return out; }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (/^telephone$/i.test(k) && typeof x === "string") out.push(x);
      else phonesIn(x, out);
    }
    return out;
  }
  return out;
};

for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort()) {
  const s = fs.readFileSync(path.join(ROOT, f), "utf8");
  const found = [...s.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (!found.length) continue;
  pages++;
  found.forEach((m, i) => {
    blocks++;
    let data;
    try { data = JSON.parse(m[1]); }
    catch (e) { bad++; console.log(`  ✗  ${f} block ${i + 1} does not parse — ${e.message.slice(0, 54)}`); return; }
    if (/<[a-z][^>]*>/i.test(m[1])) { bad++; console.log(`  ✗  ${f} block ${i + 1} has markup inside it, which belongs in the page, not the data`); }
    for (const t of phonesIn(data, [])) {
      phones++;
      const flat = t.replace(/[^0-9+]/g, "");
      if (!OURS.has(flat)) { bad++; console.log(`  ✗  ${f} block ${i + 1} advertises ${t}, which is not a number the clinic answers`); }
    }
  });
}

console.log(bad ? `\n  ${bad} problem(s) in ${blocks} blocks on ${pages} pages`
                : `\n  ${blocks} blocks on ${pages} pages all parse, hold no markup, and name ${phones} telephones the clinic answers`);
process.exit(bad ? 1 : 0);
