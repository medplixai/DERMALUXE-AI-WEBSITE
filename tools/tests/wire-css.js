// A class is defined once in the hand-written stylesheet.
//
// ".seat" was written twice — once as a square seat tile, once as a row card —
// and the tile's aspect-ratio:1 and place-items:center stayed on every card.
// A full-width dues row came out 1156px tall. Two top-level rules for the same
// class, in a stylesheet nobody generates, are either a duplicate or two
// components sharing a name; both deserve a look.
//
// The deliberate override layer at the end ("Medicare staff app look") is
// excluded: restating a class there is its whole purpose.
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(process.env.STAFF_HTML || path.resolve(__dirname, "..", "..", "staff.html"), "utf8");
let css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
const cut = css.indexOf("Medicare staff app look");
if (cut > 0) css = css.slice(0, css.lastIndexOf("/*", cut));
// Drop @media blocks — a class restated for a screen size is expected.
css = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const seen = new Map();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const sel of m[1].split(",").map((x) => x.trim())) {
    if (!/^\.[\w-]+$/.test(sel)) continue;          // a lone class, e.g. ".seat"
    const props = m[2].split(";").map((d) => d.split(":")[0].trim()).filter(Boolean);
    if (!seen.has(sel)) seen.set(sel, []);
    seen.get(sel).push(props);
  }
}
// Known, with the reason.
const OK = {
};
let bad = 0;
for (const [sel, rules] of seen) {
  if (rules.length < 2 || OK[sel]) continue;
  bad++;
  const shared = rules[0].filter((p) => rules.slice(1).some((r) => r.includes(p)));
  console.log(`  ✗  ${sel} defined ${rules.length}× — ${shared.length ? "both set " + shared.join(", ") : "different properties"}`);
}
console.log(`\n${seen.size} classes — ${bad ? bad + " defined more than once" : "each defined once"}`);
