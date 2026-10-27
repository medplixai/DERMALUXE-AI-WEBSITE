// Cutting the home page to eight treatments took thirty-five cards off it. Most
// of those treatments have a page of their own and are linked from this hub, so
// nothing was lost. Fourteen do not, and for a few days they existed nowhere on
// the site at all — the clinic treats leprosy and skin tuberculosis and the
// site stopped saying so.
//
// They go at the foot of the hub, with their own condition picture and no link,
// because there is no page to link to. A card that goes nowhere is honest; a
// service the site never mentions is not.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");

// A 46px square does not need a 1200x800 photograph. Pointing the hub at the
// full files made it a 5.4 MB page — the same mistake as serving a 1050px
// portrait to a 92px avatar, made again one screen later.
const thumb = (src) => {
  const t = src.replace("assets/tx/", "assets/tx/thumb/");
  return fs.existsSync(path.join(ROOT, t)) ? t : src;
};

function main() {
  const hubPath = path.join(ROOT, "treatments.html");
  let hub = fs.readFileSync(hubPath, "utf8");
  const linked = new Set([...hub.matchAll(/href="([a-z0-9-]+\.html)"/g)].map((m) => m[1]));

  // The cards as the home page had them before the cut — titles, Telugu names
  // and pictures all together, rather than three lists to keep in step.
  const old = execSync("git show HEAD:index.html", { cwd: ROOT, maxBuffer: 1 << 26 }).toString();
  const cards = old.match(/<article class="svc reveal"[\s\S]*?<\/article>/g) || [];
  const kept = new Set((fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
    .match(/<h4[^>]*>(.*?)<\/h4>/g) || []).map((h) => h.replace(/<[^>]*>/g, "").trim()));

  const map = fs.readFileSync(path.join(ROOT, "tools/card-images.js"), "utf8");
  const slugOf = (t) => {
    const m = map.match(new RegExp('"' + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '":\\s*"([^"]+)"'));
    return m ? m[1] : "";
  };

  const orphanServices = [];
  for (const c of cards) {
    const title = ((c.match(/<h4[^>]*>(.*?)<\/h4>/) || [])[1] || "").trim();
    if (!title || kept.has(title)) continue;
    const slug = slugOf(title);
    const page = slug && !/^card-/.test(slug) ? slug + ".html" : null;
    if (page && linked.has(page)) continue;           // the hub already offers it
    const img = c.match(/class="svc__img" src="([^"]+)" alt="([^"]*)"/) || [];
    const te = (c.match(/<span class="te svc__te">(.*?)<\/span>/) || [])[1] || "";
    orphanServices.push({ title, te, src: img[1] || "", alt: img[2] || "" });
  }

  if (!orphanServices.length) { console.log("  nothing to restore"); return; }

  const cardsHtml = orphanServices.map((o) =>
    `<div class="hubc hubc--plain">` +
    (o.src ? `<img class="hubc__img" src="${thumb(o.src)}" alt="${o.alt.replace(/"/g, "&quot;")}" width="128" height="128" loading="lazy" decoding="async" />` : "") +
    `<span class="hubc__t">${o.title}<span class="te">${o.te}</span></span></div>`).join("\n  ");

  const block = `\n<h2>Also treated at the clinic <span class="te">· క్లినిక్‌లో ఇవి కూడా</span></h2>\n` +
    `<p class="hub-also-note">These are treated at the clinic and have no page of their own yet — ask about any of them on WhatsApp or at your consultation.` +
    `<span class="te">ఇవి క్లినిక్‌లో చేస్తాం, వీటికి ఇంకా ప్రత్యేక పేజీ లేదు — WhatsApp లో లేదా కన్సల్టేషన్‌లో అడగండి.</span></p>\n` +
    `<div class="hub-grid">\n  ${cardsHtml}\n</div>\n`;

  if (hub.includes("Also treated at the clinic")) {
    hub = hub.replace(/\n<h2>Also treated at the clinic[\s\S]*?<\/div>\n/, block);
  } else {
    const anchor = "    <h2>Visit DermaLuxe Eluru</h2>";
    if (!hub.includes(anchor)) throw new Error("cannot find where the menu ends");
    hub = hub.replace(anchor, block + anchor);
  }
  fs.writeFileSync(hubPath, hub);
  console.log(`  ${orphanServices.length} services restored to the hub, each with its own picture`);
  orphanServices.forEach((o) => console.log(`     ${o.title.replace(/&amp;/g, "&")}`));
}
main();
