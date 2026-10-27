// The home page used to carry two rows of treatments: eight showcase tiles and
// then all forty-three cards behind filter tabs — 5,303px of wall, duplicating
// treatments.html, which already links every treatment twice over (EN + TE).
//
// The owner asked for the home page to read as a boutique rather than a
// catalogue, and chose eight. So one row of eight stays, the rest of the menu
// is one link away, and the tabs go with the wall they existed to sort.
//
// The eight showcase tiles went too, and not only for length: their pictures
// carry claim text baked into the pixels ("SMOOTH SKIN, LASTING CONFIDENCE",
// "REVEAL SMOOTHER BRIGHTER SKIN"), show people being treated, include a
// branded product box, and carry no AI mark. A text audit cannot see any of
// that, because the words are an image.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

// Eight, chosen to span what the clinic actually sells — skin, hair, surgical
// hair, laser, aesthetic, weight loss — rather than the eight that happened to
// have showcase photographs.
const EIGHT = [
  "Acne &amp; Acne Scars",
  "Pigmentation &amp; Melasma",
  "Hair Fall Treatment",
  "Hair Transplant (FUE / DHI / Bio-FUE)",
  "Laser Hair Reduction",
  "Anti-Ageing &amp; Wrinkles",
  "Hydrafacial",
  "Medical Weight Loss Programme",
];

function main() {
  const f = path.join(ROOT, "index.html");
  let s = fs.readFileSync(f, "utf8");

  const cards = s.match(/<article class="svc reveal"[\s\S]*?<\/article>/g) || [];
  const titleOf = (c) => ((c.match(/<h4[^>]*>(.*?)<\/h4>/) || [])[1] || "").trim();
  const keep = EIGHT.map((t) => {
    const c = cards.find((x) => titleOf(x) === t);
    if (!c) throw new Error(`no card titled ${t} — the eight must name cards that exist`);
    return c;
  });

  // 1. the showcase row goes
  const feat = s.match(/\n *<div class="feat-grid">[\s\S]*?<\/div>\n/);
  if (!feat) throw new Error("feat-grid not found");
  s = s.replace(feat[0], "\n");

  // 2. the divider and the filter tabs go with the wall
  s = s.replace(/\n *<div class="svc-divider reveal">[\s\S]*?<\/div>\n/, "\n");
  s = s.replace(/\n *<div class="svc-tabs reveal" id="svcTabs">[\s\S]*?<\/div>\n/, "\n");

  // 3. the grid keeps eight
  const grid = s.match(/(<div class="svc-grid" id="svcGrid">)([\s\S]*?)(\n *<\/div>)/);
  if (!grid) throw new Error("svc-grid not found");
  const body = "\n          " + keep.join("\n          ");
  s = s.replace(grid[0], grid[1] + body + grid[3] +
    `\n\n        <div class="svc-more reveal">` +
    `<a class="svc-more__link" href="treatments.html">See all 41 treatments` +
    `<span class="te">అన్ని 41 చికిత్సలు చూడండి</span></a></div>`);

  fs.writeFileSync(f, s);
  console.log(`  showcase row removed · tabs removed · ${keep.length} of ${cards.length} cards kept`);
  console.log(`  kept: ${keep.map(titleOf).map((t) => t.replace(/&amp;/g, "&")).join(" · ")}`);
}
main();
