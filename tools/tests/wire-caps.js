const fs = require("fs");
const src = fs.readFileSync("api/staff.js", "utf8");
const cut = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const caps = [...cut("const CAPS = {", "const CAP_TE").matchAll(/"([a-z]+\.[a-z]+)":/g)].map((m) => m[1]);
const te = new Set([...cut("const CAP_TE", "const CAP_GROUPS").matchAll(/"([a-z]+\.[a-z]+)":/g)].map((m) => m[1]));
const grp = new Set([...cut("const CAP_GROUPS", "const BUILTIN_ROLES").matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]));
const rolesSrc = cut("const BUILTIN_ROLES", "function roles");
const inRole = new Set([...rolesSrc.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]));

let bad = 0;
console.log(caps.length + " capabilities\n");
console.log("label / group / a role other than owner:");
for (const c of caps) {
  const miss = [];
  if (!te.has(c)) miss.push("no Telugu label");
  if (!grp.has(c)) miss.push("NOT IN ANY GROUP — invisible on the roles screen");
  if (!inRole.has(c)) miss.push("owner-only");
  if (miss.length) { const owneronly = miss.length === 1 && miss[0] === "owner-only";
    if (!owneronly) bad++;
    console.log(`  ${owneronly ? "·  " : "✗  "} ${c} — ${miss.join(", ")}`); }
}

const files = {};
for (const f of fs.readdirSync("api")) if (f.endsWith(".js")) files["api/" + f] = fs.readFileSync("api/" + f, "utf8");
files["staff.html"] = fs.readFileSync("staff.html", "utf8");

console.log("\nasked for but not defined:");
for (const [f, s] of Object.entries(files))
  for (const m of s.matchAll(/(?:state\.)?allow\("([a-z]+\.[a-z]+)"\)|notifyCap\(cfg, "([a-z]+\.[a-z]+)"/g)) {
    const c = m[1] || m[2];
    if (!caps.includes(c)) { bad++; console.log(`  ✗  ${f}: "${c}"`); }
  }
console.log("  (none above = fine)");

console.log("\ndefined but nothing ever checks it:");
for (const c of caps) {
  let n = 0;
  for (const [f, s] of Object.entries(files)) {
    if (f === "api/staff.js") continue;
    n += (s.match(new RegExp('allow\\("' + c.replace(".", "\\.") + '"\\)', "g")) || []).length;
    n += (s.match(new RegExp('"' + c.replace(".", "\\.") + '"', "g")) || []).length;
  }
  const inStaff = (src.match(new RegExp('allow\\("' + c.replace(".", "\\.") + '"\\)', "g")) || []).length;
  if (n === 0 && inStaff === 0) { bad++; console.log(`  ✗  ${c} — granted to roles but no code ever checks it (in staff.js ${inStaff}×)`); }
}
console.log("  (none above = fine)");
console.log(bad ? `\n${bad} problem(s)` : "\nno problems");
