// Every button drawn has a handler, and every handler is reachable.
//
// Adapt: the page path, and the two patterns — how an element declares its
// action when rendered, and how the delegated listener matches it.
//
// Not every data-act is a button. A <form> is caught by a submit listener and
// a checkbox is read in bulk by querySelectorAll, so both look like orphans
// to a click-handler check. Those are recognised below rather than left to
// print every run: a check that always reports two non-problems teaches
// everyone to ignore its output.
const fs = require("fs");
const html = fs.readFileSync(process.argv[2] || "staff.html", "utf8");

const rendered = new Set([...html.matchAll(/data-act=\\?"([a-z0-9-]+)\\?"/g)].map((m) => m[1]));
const handled = new Set([...html.matchAll(/\.dataset\.act === \\?"([a-z0-9-]+)\\?"/g)].map((m) => m[1]));
for (const m of html.matchAll(/case "([a-z0-9-]+)":/g)) handled.add(m[1]);

// reached some other way: a form submit, or read in bulk from the DOM
const otherwise = (a) =>
  new RegExp(`dataset\\.act !== "${a}"`).test(html) ||          // if (f.dataset.act !== "x") return
  new RegExp(`\\[data-act="${a}"\\]`).test(html);                // querySelectorAll('[data-act="x"]')

let bad = 0;
console.log("buttons drawn with nothing behind them:");
for (const a of [...rendered].sort()) {
  if (handled.has(a)) continue;
  if (otherwise(a)) { console.log(`  ·   "${a}" — not a click; reached another way`); continue; }
  bad++; console.log(`  ✗  data-act="${a}"`);
}
console.log("\nhandlers nothing can reach:");
for (const a of [...handled].sort()) if (!rendered.has(a)) { bad++; console.log(`  ✗  "${a}" is handled but never drawn`); }

console.log(`\n${rendered.size} actions, ${handled.size} click handlers — ${bad ? bad + " to fix" : "every one of them does something"}`);
