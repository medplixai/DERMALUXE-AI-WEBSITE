const fs = require("fs");
const html = fs.readFileSync("staff.html", "utf8");
let bad = 0;
const tabs = [...new Set([...html.matchAll(/data-t="([a-z]+)"/g)].map((m) => m[1]))];
const pick = (n) => { const i = html.indexOf("var " + n); return html.slice(i, html.indexOf("\n", i)); };
const NAV_PREF = JSON.parse(pick("NAV_PREF =").split("=")[1].trim().replace(/;$/, "").replace(/'/g, '"'));
const NAV_LABEL = [...pick("NAV_LABEL =").matchAll(/(\w+):"/g)].map((m) => m[1]);
const ICONS = [...html.slice(html.indexOf("var ICONS"), html.indexOf("var NAV_LABEL")).matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]);
const panels = [...html.matchAll(/id="t-([a-z]+)"/g)].map((m) => m[1]);

console.log("tab button | panel | phone bar | label | icon");
for (const t of tabs.sort()) {
  const row = [panels.includes(t), NAV_PREF.includes(t), NAV_LABEL.includes(t), ICONS.includes(t)];
  const ok = row.every(Boolean);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok " : "✗  "} ${t.padEnd(10)} ${row.map((x) => (x ? "✓" : "—")).join("  ")}`);
}
console.log("\npanels with no tab button:");
for (const p of panels) if (!tabs.includes(p)) { bad++; console.log("  ✗  t-" + p); }
console.log("  (none above = fine)");
console.log("\nphone bar lists a tab that does not exist:");
for (const t of NAV_PREF) if (!tabs.includes(t)) { bad++; console.log("  ✗  " + t); }
console.log("  (none above = fine)");
console.log(bad ? `\n${bad} problem(s)` : "\nevery tab is complete");
