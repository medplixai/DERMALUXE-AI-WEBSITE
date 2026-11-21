// Builds price-list.html from api/_pricelist.js — the same list the WhatsApp
// and website agents quote from, so the page and the chat cannot disagree.
// tools/tests/wire-prices.js fails if the page on disk is not what this
// writes. Run after any change to the list:
//
//   node tools/gen-price-list.js
//
// NMC (6 Oct 2026), 8.1(x): a disclosure of charges must be factual,
// transparent and not misleading — so the page is a plain list: no "offer",
// no "free", no "save", no struck-out prices, and the consultation fee is
// stated as charged separately.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const L = require(path.join(ROOT, "api", "_pricelist.js"));
const docs = require(path.join(ROOT, "api", "_docs.js"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const asOf = new Date(L.AS_OF + "T12:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
const URL = "https://www.dermaluxe.ai/price-list.html";
const TITLE = "Treatment Price List — DermaLuxe Skin & Hair Clinic, Eluru";
const DESC = `Prices for chemical peels, laser hair reduction, HydraFacial, hair treatments, lasers, injections and dermatosurgery at DermaLuxe by Medicare, Eluru. Consultation ₹300. As of ${asOf}.`;

function row(i) {
  const per = i.price ? L.rupee(i.price) : "—";
  const pk = i.packs.length ? i.packs.map((p) => `${L.sittings(p.n)} · ${L.rupee(p.price)}`).join("<br>") : "—";
  return `        <tr><th scope="row">${esc(i.name)}</th><td>${per}</td><td>${pk}</td></tr>`;
}
function section(s) {
  return `    <h2 id="${s.key}">${esc(s.title)} <span class="te"><span lang="te">${esc(s.te)}</span></span></h2>
    <div class="pl-wrap"><table class="pl">
      <thead><tr><th scope="col">Treatment</th><th scope="col">Per sitting</th><th scope="col">Package</th></tr></thead>
      <tbody>
${s.items.map(row).join("\n")}
      </tbody>
    </table></div>`;
}

const offers = L.SECTIONS.map((s) => s.items.filter((i) => i.price).map((i) => ({ "@type": "Offer", name: i.name, price: String(i.price), priceCurrency: "INR" }))).flat();
const schema = { "@context": "https://schema.org", "@type": "MedicalClinic", name: "DermaLuxe by Medicare", url: URL, telephone: "+91-99591-34666",
  address: { "@type": "PostalAddress", streetAddress: "Rama Mahal, Door No. 3-12, Ground Floor, Ramachandra Rao Peta, Kasturi Vari Street, Opposite Happy Mobiles", addressLocality: "Eluru", addressRegion: "Andhra Pradesh", postalCode: "534002", addressCountry: "IN" },
  hasOfferCatalog: { "@type": "OfferCatalog", name: "Treatment price list", itemListElement: offers } };
const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "Home", item: "https://www.dermaluxe.ai/" },
  { "@type": "ListItem", position: 2, name: "Treatments", item: "https://www.dermaluxe.ai/treatments.html" },
  { "@type": "ListItem", position: 3, name: "Price list", item: URL }] };

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(TITLE)}</title>
  <meta name="description" content="${esc(DESC)}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href="${URL}" />
  <meta property="og:title" content="${esc(TITLE)}" />
  <meta property="og:description" content="${esc(DESC)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${URL}" />
  <meta property="og:image" content="https://www.dermaluxe.ai/assets/og-card.jpg" />
  <meta name="geo.region" content="IN-AP" />
  <meta name="geo.placename" content="Eluru, Andhra Pradesh" />
  <link rel="icon" type="image/png" href="assets/favicon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&family=Jost:wght@300..700&family=Noto+Serif+Telugu:wght@400..700&family=Noto+Sans+Telugu:wght@300..700&display=swap" rel="stylesheet" />
  <script defer src="analytics.js"></script>
  <link rel="stylesheet" href="styles.css" />
  <style>
    .pl-jump { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.4rem 0 .4rem; }
    .pl-jump a { font-size: .85rem; padding: .35rem .8rem; border: 1px solid var(--line); border-radius: 100px; color: var(--gold-2); text-decoration: none; }
    .pl-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--ink-2); }
    .pl { width: 100%; border-collapse: collapse; font-size: .92rem; font-variant-numeric: tabular-nums; }
    .pl th, .pl td { padding: .65rem .85rem; text-align: left; vertical-align: top; border-top: 1px solid var(--line-soft); }
    .pl thead th { border-top: 0; font-size: .78rem; letter-spacing: .06em; text-transform: uppercase; color: var(--gold-2); font-weight: 600; }
    .pl tbody th { font-weight: 500; color: var(--text); }
    .pl td { color: var(--text); white-space: nowrap; }
    .pl td:last-child { color: var(--muted); }
    .pl-note { border-left: 2px solid var(--gold-3); padding: .2rem 0 .2rem 1rem; }
    @media (max-width: 560px) {
      .pl th, .pl td { padding: .55rem .6rem; }
      .pl tbody th { min-width: 9.5rem; }
      .pl td:last-child { white-space: normal; min-width: 7.5rem; }
    }
  </style>
  <script type="application/ld+json">${JSON.stringify(schema)}</script>
  <script type="application/ld+json">${JSON.stringify(crumbs)}</script>
</head>
<body>
  <div class="bg-glow" aria-hidden="true"></div>
  <header class="legal-nav">
    <div class="container">
      <a href="index.html" aria-label="DermaLuxe home"><img src="assets/logo.webp" alt="DermaLuxe by Medicare — Skin &amp; Hair Clinic in Eluru" /></a>
      <a href="index.html#contact" class="btn btn--gold">Book Consultation</a>
    </div>
  </header>

  <section class="seo-hero">
    <div class="container">
      <p class="eyebrow" style="display:inline-block;">DermaLuxe by Medicare · Eluru</p>
      <h1>Treatment <span class='gold-text'>price list</span></h1>
      <p class="head-te te-serif"><span lang="te">చికిత్సల ధరల జాబితా</span></p>
      <p class="lead">What each treatment costs at DermaLuxe, per sitting and as a course of sittings. Which treatment suits you, and how many sittings you need, is decided by the doctor after examining your skin or hair.</p>
      <div class="seo-cta">
        <a href="tel:+919959134666" class="btn btn--gold">Call +91 99591 34666</a>
        <a href="https://wa.me/919959134666?text=Hi%20DermaLuxe%21%20I%20have%20a%20question%20about%20treatment%20prices." target="_blank" rel="noopener" class="btn btn--ghost">WhatsApp Us</a>
      </div>
    </div>
  </section>

  <div class="seo-strip">✦ Consultation ₹300 · charged separately · Mon–Sat 9 AM – 9 PM ✦</div>

  <main class="seo-body">
    <p class="pl-note">Prices as of ${esc(asOf)}, in Indian rupees. The consultation fee of ₹300 is charged separately and is not adjusted against treatment. A package is the price for that number of sittings, booked together. The hair transplant package has its own page: <a href="hair-transplant-offer.html" style="color:var(--gold-2)">hair transplant</a>.<br /><span class="te"><span lang="te">ఈ ధరలు</span> ${esc(asOf)} <span lang="te">నాటివి. కన్సల్టేషన్</span> ₹300 <span lang="te">వేరుగా — చికిత్స ధరలో కలపబడదు. మీకు ఏ చికిత్స, ఎన్ని సిట్టింగ్స్ అవసరమో డాక్టర్ పరీక్షించి చెప్తారు.</span></span></p>
    <nav class="pl-jump" aria-label="Sections">
${L.SECTIONS.map((s) => `      <a href="#${s.key}">${esc(s.title)}</a>`).join("\n")}
    </nav>
${L.SECTIONS.map(section).join("\n")}
    <p style="margin-top:2rem">Rama Mahal, Door No. 3-12, Ground Floor, Ramachandra Rao Peta, Kasturi Vari Street, Opposite Happy Mobiles, Near Lakshmi Ganapathi Temple, Eluru – 534002, Andhra Pradesh.<br />Phone / WhatsApp: <a href="tel:+919959134666" style="color:var(--gold-2)">+91 99591 34666</a></p>
    <p>Also explore: <a href="treatments.html" style="color:var(--gold-2)">All Treatments</a> · <a href="index.html#ai-analysis" style="color:var(--gold-2)">Free AI Skin &amp; Hair Analysis</a> · <a href="index.html#teleconsult" style="color:var(--gold-2)">Teleconsultation</a></p>
  </main>

  <footer class="seo-foot">
    <div class="container">
      <a href="index.html" class="btn btn--ghost">← Back to DermaLuxe Home</a>
      <p>© DermaLuxeAI Private Limited · Premium Skin, Hair &amp; Aesthetics · Eluru, Andhra Pradesh<br/>Serving Eluru, Tadepalligudem, Bhimavaram, Tanuku, Jangareddygudem, Nidadavolu, Kovvur &amp; nearby areas.</p>
      <p class="legal-reg">${docs.regDisclosure("en")}</p>
    </div>
  </footer>
  <script src="cookies.js"></script>
  <script defer src="/_vercel/insights/script.js"></script>
  <script defer src="/_vercel/speed-insights/script.js"></script>
</body>
</html>
`;

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, "price-list.html"), html);
  console.log("price-list.html —", L.SECTIONS.reduce((n, s) => n + s.items.length, 0), "items, as of", asOf);
}
module.exports = { html };
