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

// 6. The dashboard is one <script> of about five thousand lines, and a single
// stray quote in it takes the WHOLE app down — every tab blank, no error the
// user can see, and every other check in this folder still green, because
// they all read the file as text. One parse catches it in a second.
console.log("\n6. the dashboard's own script parses");
for (const page of ["staff.html", "leads.html", "index.html"]) {
  if (!fs.existsSync(page)) continue;
  const src = fs.readFileSync(page, "utf8");
  const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((x) => x.trim() && !/^\s*\{[\s\S]*\}\s*$/.test(x));   // JSON-LD blocks are not JS
  let n = 0;
  for (const js of blocks) {
    n++;
    try { new (require("vm").Script)(js, { filename: `${page}#${n}` }); }
    catch (e) { say(false, `${page} script ${n} — ${String(e.message).slice(0, 90)}`); }
  }
  say(true, `${page} — ${blocks.length} script block(s)`);
}

console.log(bad ? `\n${bad} problem(s)` : "\nno problems in 1–6");
