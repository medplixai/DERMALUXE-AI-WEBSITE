// Which endpoints have a behaviour test, and which do not.
//
// Not a failure list — a map. The wiring checks prove a thing is connected;
// only a t-*.js proves it does the right thing. An endpoint that handles
// money, patients or messages and has no test is where the next surprise
// will come from.
const fs = require("fs"), path = require("path");
const API = process.env.DL_API || path.resolve("api");
const T = path.resolve(__dirname);
const tests = fs.readdirSync(T).filter((f) => /^t-.*\.js$/.test(f)).map((f) => fs.readFileSync(path.join(T, f), "utf8")).join("\n");
const eps = fs.readdirSync(API).filter((f) => f.endsWith(".js") && !f.startsWith("_")).map((f) => f.replace(/\.js$/, ""));
const hit = (n) => new RegExp(`h\\.load\\("${n}"\\)|require\\([^)]*["'/]${n}(\\.js)?["']\\)|"${n}\\.js"`).test(tests);
const yes = eps.filter(hit), no = eps.filter((n) => !hit(n));
no.forEach((n) => console.log(`  ·  ${n}`));
console.log(`\n${yes.length} of ${eps.length} endpoints have a behaviour test` + (no.length ? ` — the ${no.length} above do not` : ""));
