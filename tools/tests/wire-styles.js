// Every class the dashboard puts on an element either has a style or is a
// hook the script uses, with the reason written down.
//
// A class with neither is an element drawn in the browser's defaults: that is
// how fifteen inputs went unstyled (.inp), how the Meta Ads figures ran
// together (.cell, dt, dd) and how the ten academy seats never appeared. On a
// dark page a default white box is at least visible; on a light one it
// disappears, so this matters more now than it did.
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(process.env.STAFF_HTML || path.resolve(__dirname, "..", "..", "staff.html"), "utf8");
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const styled = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
// class="…" in markup and in the script's strings (escaped or not); the parts
// between string concatenations are the literal class names.
const used = new Map();
for (const m of html.matchAll(/class=\\?["']([^"'\\]*)/g)) {
  for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/i.test(c)) used.set(c, (used.get(c) || 0) + 1);
}
for (const m of html.matchAll(/classList\.(?:add|toggle|remove)\("([\w-]+)"/g)) used.set(m[1], (used.get(m[1]) || 0) + 1);
// Hooks for the script, not for looks — each with its reason.
const HOOK = {
  hide: "styled — .hide{display:none}", on: "state class, styled in compound selectors (.tab.on, .seat.on …)",
  open: "state class for sheets, styled as .sheet.open / .ptsheet.open", show: "state class for toast/banners",
  te: "styled — Telugu font", "hide-in-app": "styled under html.standalone",
  "s-": "prefix of s-<status> built at run time; each status is styled as .acts select.s-new … s-closed",
  phwrap: "where a lead's photos are mounted; found by the script, drawn by what goes inside",
  native: "put on <html> inside the phone app so the script can tell; no look of its own",
  pband: "one price-band row — a styled .noteform; the class is how Save reads the rows back",
  "pb-name": "inputs inside the .noteform row (styled there); the class is how Save reads them", "pb-from": "same", "pb-to": "same", "pb-del": "the row's remove button, a styled .btn",
  "cyc-days": "the days input inside a styled .noteform row; the class is how Save reads them",
};
const missing = [...used.keys()].filter((c) => !styled.has(c) && !HOOK[c]).sort();
missing.forEach((c) => console.log(`  ✗  .${c}  (${used.get(c)}×) has no style`));
console.log(`\n${used.size} classes used, ${missing.length ? missing.length + " unstyled" : "every one styled or a named hook"}`);
