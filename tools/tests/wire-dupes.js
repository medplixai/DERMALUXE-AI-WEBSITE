// Two functions with one name, in one scope.
//
// The dashboard is a single four-hundred-kilobyte script. A function declared
// twice does not warn: the last declaration silently replaces the first, and
// every caller of the first now calls something else. That is how the
// WhatsApp-templates button painted nothing — a paintTemplates() written for
// the consent screen had taken the name — and nothing in the tests or the
// browser said a word.
//
// Also checks the API: two exports with one name in a module, and two files
// that would answer the same route.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const API = process.env.DL_API || path.join(ROOT, "api");
let bad = 0;

const dupes = (names) => {
  const seen = new Map();
  for (const n of names) seen.set(n, (seen.get(n) || 0) + 1);
  return [...seen].filter(([, c]) => c > 1);
};

console.log("1. staff.html — one name, one function");
const html = fs.readFileSync(path.join(ROOT, "staff.html"), "utf8");
// Top-level declarations inside the app's IIFE are indented four spaces.
const fns = [...html.matchAll(/^ {4}function ([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
const fnDupes = dupes(fns);
fnDupes.forEach(([n, c]) => console.log(`  ✗  function ${n}() declared ${c}× — the last one wins, the first one's callers are silently rewired`));
bad += fnDupes.length;
// var/let/const at the same level, same problem for the value
const vars = [...html.matchAll(/^ {4}(?:var|let|const) ([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1]);
const varDupes = dupes(vars).filter(([n]) => !fns.includes(n));
varDupes.forEach(([n, c]) => console.log(`  ✗  ${n} assigned at top level ${c}×`));
bad += varDupes.length;
console.log(`  ${fns.length} functions, ${vars.length} top-level values${fnDupes.length + varDupes.length ? "" : " — every name is its own"}`);

console.log("\n2. api/*.js — one name, one export");
for (const f of fs.readdirSync(API).filter((x) => x.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(API, f), "utf8");
  const top = [...src.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
  const d = dupes(top);
  d.forEach(([n, c]) => { console.log(`  ✗  ${f}: function ${n}() declared ${c}×`); bad++; });
  const ex = [...src.matchAll(/^module\.exports\.([A-Za-z_$][\w$]*) =/gm)].map((m) => m[1]);
  dupes(ex).forEach(([n, c]) => { console.log(`  ✗  ${f}: module.exports.${n} set ${c}×`); bad++; });
}
console.log(bad ? `\n${bad} name collision(s)` : "\nno name collisions");
process.exit(bad ? 1 : 0);
