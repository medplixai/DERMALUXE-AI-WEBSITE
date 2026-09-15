// Does every action the dashboard sends have a branch on the server?
const fs = require("fs");
const html = fs.readFileSync("staff.html", "utf8");

// the helper name → endpoint, read from the file itself
const helpers = {};
for (const m of html.matchAll(/function (\w+)\(a, body, qs\) \{[\s\S]{0,400}?ORIGIN \+ "\/api\/([a-z-]+)\?a="/g)) helpers[m[1]] = m[2];
console.log("helpers wired to endpoints:");
for (const [h, e] of Object.entries(helpers)) console.log("   " + h + "() → /api/" + e);

const serverActions = (file) => {
  const src = fs.readFileSync("api/" + file + ".js", "utf8");
  const s = new Set();
  for (const m of src.matchAll(/a === "([a-z0-9-]+)"/g)) s.add(m[1]);
  return s;
};

let bad = 0;
console.log("\nactions the dashboard calls, and whether the server handles them:");
for (const [h, ep] of Object.entries(helpers)) {
  let have;
  try { have = serverActions(ep); } catch (e) { console.log(`  ✗  /api/${ep} missing`); bad++; continue; }
  const calls = new Set();
  const re = new RegExp(h + '\\(\\s*"([a-z0-9-]+)"', "g");
  for (const m of html.matchAll(re)) calls.add(m[1]);
  for (const c of [...calls].sort()) {
    const ok = have.has(c);
    if (!ok) bad++;
    console.log(`  ${ok ? "ok " : "✗  "} ${h}("${c}") → /api/${ep}`);
  }
}
console.log(bad ? `\n${bad} unhandled` : "\nevery call has a server branch");
