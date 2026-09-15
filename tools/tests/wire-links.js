const fs = require("fs");
const pages = fs.readdirSync(".").filter((f) => f.endsWith(".html"));
const have = new Set(pages);
const broken = {};
let links = 0;
for (const p of pages) {
  const s = fs.readFileSync(p, "utf8");
  for (const m of s.matchAll(/(?:href|src)="(\/?[^":#?]+\.(?:html|png|jpg|jpeg|webp|svg|css|js|pdf|apk|json|ico|xml|txt))(?:[?#][^"]*)?"/g)) {
    let t = m[1];
    if (/^https?:|^\/\//.test(t)) continue;
    if (t.startsWith("/_vercel/")) continue;   // Vercel serves its own analytics
    links++;
    const f = t.replace(/^\//, "");
    if (!fs.existsSync(f) && !have.has(f)) (broken[p] = broken[p] || new Set()).add(t);
  }
}
console.log(`${pages.length} pages, ${links} internal links checked\n`);
const keys = Object.keys(broken);
if (!keys.length) console.log("  every internal link and asset resolves");
for (const p of keys) console.log(`  ✗  ${p}: ${[...broken[p]].join(", ")}`);
