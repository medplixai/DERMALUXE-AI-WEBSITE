const fs = require("fs");
const pages = fs.readdirSync(".").filter((f) => f.endsWith(".html"));
const have = new Set(pages);
const broken = {};
let links = 0;

const EXT = "html|png|jpg|jpeg|webp|svg|css|js|pdf|apk|json|ico|xml|txt";

const check = (where, raw) => {
  let t = raw.trim().replace(/[?#].*$/, "");
  if (!t || /^https?:|^\/\/|^data:|^mailto:|^tel:/.test(t)) return;
  if (t.startsWith("/_vercel/")) return;        // Vercel serves its own analytics
  links++;
  const f = t.replace(/^\//, "");
  if (!fs.existsSync(f) && !have.has(f)) (broken[where] = broken[where] || new Set()).add(t);
};

for (const p of pages) {
  const s = fs.readFileSync(p, "utf8");

  for (const m of s.matchAll(new RegExp(`(?:href|src)="(/?[^":#?]+\\.(?:${EXT}))(?:[?#][^"]*)?"`, "g"))) check(p, m[1]);

  /* A picture named only in an attribute used to go unchecked. The home page
     hands five portraits to script.js through data-bg and picks the hero by
     screen density through imagesrcset, so for those files these attributes
     are the only mention anywhere — delete one and nothing would have said so,
     the hero would simply stop appearing on dense phones. */
  for (const m of s.matchAll(/\bdata-bg="([^"]+)"/g)) check(p, m[1]);
  for (const m of s.matchAll(/\b(?:imagesrcset|srcset)="([^"]+)"/g)) {
    for (const cand of m[1].split(",")) check(p, cand.trim().split(/\s+/)[0]);
  }
}

/* url() inside the stylesheets was never read either, so a renamed section
   background was invisible to this check as well. */
for (const css of fs.readdirSync(".").filter((f) => f.endsWith(".css"))) {
  const s = fs.readFileSync(css, "utf8");
  for (const m of s.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) check(css, m[1]);
}

console.log(`${pages.length} pages, ${links} internal links and assets checked\n`);
const keys = Object.keys(broken);
if (!keys.length) console.log("  every internal link and asset resolves");
for (const p of keys) console.log(`  ✗  ${p}: ${[...broken[p]].join(", ")}`);
process.exit(keys.length ? 1 : 0);
