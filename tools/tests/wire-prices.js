// The price page and the agents quote one list (api/_pricelist.js, owner's
// sheet of 21 Nov 2026). If the page is edited by hand, or the list changes
// and the page is not rebuilt, a patient reads one number on the site and
// hears another on WhatsApp. This fails until `node tools/gen-price-list.js`
// has been run.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const L = require(path.join(ROOT, "api", "_pricelist.js"));
const P = require(path.join(ROOT, "api", "_prices.js"));
const gen = require(path.join(ROOT, "tools", "gen-price-list.js"));
const bad = [];
const page = fs.existsSync(path.join(ROOT, "price-list.html")) ? fs.readFileSync(path.join(ROOT, "price-list.html"), "utf8") : "";
if (page !== gen.html) bad.push("price-list.html is not what tools/gen-price-list.js writes — run it");
for (const n of L.amounts()) if (!page.includes(L.rupee(n))) bad.push(`₹${n} is on the list but not on the page`);
// NMC 8.1(x) / 10.1(iv): a factual list, not an inducement.
// Visible words only: a link to hair-transplant-offer.html is not the page
// offering anything, and "2 black peels + 1 Azelaic-M peel" is a recipe.
const words = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ").replace(/Free AI Skin/g, "");
for (const w of [/\bfree\b/i, /\boffers?\b/i, /\bdiscount/i, /\bsave\b/i, /\d\s?\+\s?\d\s?\)/, /\bextra sitting/i]) if (w.test(words)) bad.push(`the page says ${w}`);
for (const f of ["index.html", "treatments.html", "sitemap.xml", "llms.txt"]) if (!fs.readFileSync(path.join(ROOT, f), "utf8").includes("price-list.html")) bad.push(`${f} does not link the price page`);
// Since 24 Nov the agent's default gives no treatment price (owner). The list
// still has to reach the prompt whole whenever the control panel is set to it.
(async () => {
  const p0 = await P.load(null);
  if (p0.mode !== "consult") bad.push(`agent default price mode is ${p0.mode}, not consult (owner, 24 Nov: no prices in chat)`);
  const p = Object.assign({}, p0, { mode: "list" });
  const block = P.block(p);
  for (const s of L.SECTIONS) for (const i of s.items) if (!block.includes(L.line(i))) bad.push(`agent prompt is missing "${i.name}"`);
  const allow = P.allowSet(p);
  for (const n of L.amounts()) if (!allow.has(n)) bad.push(`the price block would strip ₹${n}`);
  if (bad.length) { bad.slice(0, 20).forEach((b) => console.log("  ✗ " + b)); console.log(`${bad.length} problem(s)`); process.exit(1); }
  console.log(`  ${L.SECTIONS.reduce((n, s) => n + s.items.length, 0)} prices — the page, the agents and the editor read the same list`);
})();
