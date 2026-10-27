// treatments.html is where the home page now sends anybody who wants more than
// the eight it shows. It was a bullet list: 18 KB, two pictures, forty-one
// links. Sending people from the home page to that was the single biggest
// thing undoing "make it feel expensive" — the destination looked nothing like
// the page they came from.
//
// This turns each <li><a> into the same card the home page uses, with the same
// condition picture, WITHOUT touching the href or the anchor text: those are
// the SEO value of the hub and the one thing that must survive.
//
// The picture for each link is read from the target page's own <img>, never
// guessed from its filename. Guessing is how ten Telugu pages were silently
// skipped once before.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const imageOf = (href) => {
  const f = path.join(ROOT, href);
  if (!fs.existsSync(f)) return null;
  const t = fs.readFileSync(f, "utf8");
  const m = t.match(/<img src="(assets\/tx\/[^"]+)" alt="([^"]*)"/);
  return m ? { src: m[1], alt: m[2] } : null;
};

function main() {
  const f = path.join(ROOT, "treatments.html");
  let s = fs.readFileSync(f, "utf8");
  let made = 0, bare = 0;

  s = s.replace(/<ul class="ticklist">([\s\S]*?)<\/ul>/g, (all, inner) => {
    const items = [...inner.matchAll(/<li><a href="([^"]+)">([\s\S]*?)<\/a><\/li>/g)];
    if (!items.length) return all;
    const cards = items.map(([, href, text]) => {
      const img = imageOf(href);
      if (!img) { bare++; return `<a class="hubc" href="${href}"><span class="hubc__t">${text}</span></a>`; }
      made++;
      return `<a class="hubc" href="${href}">` +
        `<img class="hubc__img" src="${img.src}" alt="${img.alt.replace(/"/g, "&quot;")}" ` +
        `width="1200" height="800" loading="lazy" decoding="async" />` +
        `<span class="hubc__t">${text}</span></a>`;
    });
    return `<div class="hub-grid">\n  ${cards.join("\n  ")}\n</div>`;
  });

  // One source mark for every picture on the page — NMC 7.2. Same words the
  // home page uses, because they are the same pictures.
  if (!s.includes("hub-ai-note")) {
    const anchor = '<main class="seo-body">';
    s = s.replace(anchor, anchor +
      '\n<p class="hub-ai-note">The pictures below illustrate what each condition looks like. They are generated with AI — none is a photograph of a patient, and none shows a result.' +
      '<span class="te">కింది బొమ్మలు ఆ సమస్య ఎలా ఉంటుందో చూపుతాయి. ఇవి AI తో రూపొందించినవి — ఏదీ రోగి ఫోటో కాదు, ఏదీ ఫలితం కాదు.</span></p>');
  }

  fs.writeFileSync(f, s);
  console.log(`  ${made} links are cards with their condition picture · ${bare} without one`);
}
main();
