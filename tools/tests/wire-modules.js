const fs = require("fs"), path = require("path");
const api = fs.readdirSync("api").filter((f) => f.endsWith(".js"));
let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log((ok ? "  ok  " : "  ✗   ") + msg); };

console.log("\n1. every require inside api/ resolves");
for (const f of api) {
  const src = fs.readFileSync(path.join("api", f), "utf8");
  for (const m of src.matchAll(/require\("(\.\/[^"]+)"\)/g)) {
    const t = path.join("api", m[1]);
    if (!fs.existsSync(t)) say(false, `${f} requires ${m[1]} — MISSING`);
  }
}
console.log("  (only failures listed)");

console.log("\n2. every api file loads without throwing");
process.env.STAFF_SECRET = process.env.STAFF_SECRET || "x";
for (const f of api) {
  try { require(path.resolve("api", f)); }
  catch (e) { say(false, `${f} — ${String(e.message).slice(0, 90)}`); }
}
console.log("  (only failures listed)");

console.log("\n3. crons in vercel.json point at files that exist");
const vj = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
for (const c of vj.crons) {
  const f = c.path.replace("/api/", "") + ".js";
  say(api.includes(f), `${c.schedule.padEnd(16)} ${c.path}`);
}

console.log("\n4. functions{} in vercel.json point at files that exist");
for (const k of Object.keys(vj.functions)) say(fs.existsSync(k), k);

console.log("\n5. api files that need a longer run but are not in functions{}");
for (const f of api) {
  if (f.startsWith("_")) continue;
  const key = "api/" + f;
  if (vj.functions[key]) continue;
  const src = fs.readFileSync(key, "utf8");
  const heavy = /openai|anthropic|pdfkit|sharp|puppeteer/i.test(src);
  if (heavy) say(false, `${f} looks heavy but has default timeout`);
}
console.log("  (only failures listed)");

console.log(bad ? `\n${bad} problem(s)` : "\nno problems in 1–5");
