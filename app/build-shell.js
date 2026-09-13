/* Copies the staff dashboard out of the website and into www/, which is what
 * gets packed into the APK. staff.html becomes index.html so the app opens
 * straight into it. Run via `npm run shell` — cap sync calls it first.
 *
 * Only the shell travels: every bit of data still comes from the live API at
 * https://www.dermaluxe.ai (see ORIGIN in staff.html).
 */
const fs = require("fs");
const path = require("path");

const SITE = path.resolve(__dirname, "..");
const WWW = path.join(__dirname, "www");

const FILES = [
  ["staff.html", "index.html"],
  ["academy-join.html", "academy-join.html"],
  ["assets/logo.webp", "assets/logo.webp"],
  ["assets/logo.png", "assets/logo.png"],
  ["assets/app/icon-192.png", "assets/app/icon-192.png"],
  ["assets/app/icon-512.png", "assets/app/icon-512.png"],
  ["assets/app/apple-touch-icon-180.png", "assets/app/apple-touch-icon-180.png"],
];

fs.rmSync(WWW, { recursive: true, force: true });
for (const [from, to] of FILES) {
  const src = path.join(SITE, from);
  if (!fs.existsSync(src)) { console.warn("skip (missing):", from); continue; }
  const dst = path.join(WWW, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// The website's service worker and manifest are not wanted inside the APK:
// the app already ships these files, and a worker caching "/staff.html" would
// fight the next app update.
let html = fs.readFileSync(path.join(WWW, "index.html"), "utf8");
html = html.replace(/\s*<link rel="manifest"[^>]*>/, "");
fs.writeFileSync(path.join(WWW, "index.html"), html);

const version = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
fs.writeFileSync(path.join(WWW, "app-version.json"), JSON.stringify({ version, built: new Date().toISOString() }, null, 2));
console.log(`www/ ready — DermaLuxe Staff v${version}`);
