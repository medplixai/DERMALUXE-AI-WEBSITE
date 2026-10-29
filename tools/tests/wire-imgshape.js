// A picture drawn at a different shape from the one it was made in looks
// squeezed. The header logo on 91 pages was being drawn 96px wide and 60px
// tall when its own proportions ask for 134 by 60 — thinner by 28% on a
// small phone, on every treatment page, for months, because a flex row was
// taking the button's room out of the logo's width and leaving its height.
// Nobody reading the stylesheet would see it; only a narrow screen does.
//
// So: open every page at three phone widths, load every picture (lazy ones
// too), and compare the shape it is drawn at with the shape it actually is.
// object-fit cover/contain is a picture being cropped or framed on purpose,
// and is left alone.
const fs = require("fs"), path = require("path");
const puppeteer = require(path.resolve(__dirname, "../../node_modules/puppeteer-core"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = path.resolve(__dirname, "../..");
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const WIDTHS = [320, 360, 390];
const SLACK = 0.04;   // rounding to whole pixels moves a small logo by a percent or two

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const pg = await b.newPage();
  const bad = [];
  let checked = 0, pics = 0;
  for (const w of WIDTHS) {
    await pg.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true });
    for (const p of pages) {
      try {
        await pg.goto("file://" + path.join(ROOT, p), { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (e) { continue; }
      const r = await pg.evaluate(async (SLACK) => {
        const imgs = [...document.images];
        imgs.forEach((i) => { i.loading = "eager"; });
        await Promise.race([
          Promise.all(imgs.map((i) => i.complete ? 0 : new Promise((ok) => { i.onload = i.onerror = ok; }))),
          new Promise((ok) => setTimeout(ok, 4000)),
        ]);
        const out = []; let n = 0;
        for (const i of imgs) {
          if (!i.naturalWidth || !i.naturalHeight) continue;
          const b = i.getBoundingClientRect(), c = getComputedStyle(i);
          if (b.width < 8 || b.height < 8 || c.display === "none" || c.visibility === "hidden") continue;
          if (c.objectFit === "cover" || c.objectFit === "contain" || c.objectFit === "scale-down") continue;
          n++;
          const want = i.naturalWidth / i.naturalHeight, got = b.width / b.height;
          const off = got / want - 1;
          if (Math.abs(off) > SLACK) out.push({
            src: (i.getAttribute("src") || "").split("/").pop(),
            drawn: Math.round(b.width) + "x" + Math.round(b.height),
            off: Math.round(off * 100),
            where: (i.parentElement.closest("[class]") || i).className.toString().split(" ")[0],
          });
        }
        return { out, n };
      }, SLACK);
      checked++; pics += r.n;
      for (const x of r.out) bad.push(Object.assign({ page: p, w }, x));
    }
  }
  await pg.close(); await b.close();

  console.log(`${checked} page views (${pages.length} pages × ${WIDTHS.join("/")}px), ${pics} pictures compared\n`);
  if (!bad.length) console.log("  every picture is drawn in its own proportions");
  else {
    const by = {};
    for (const x of bad) (by[x.src + " in ." + x.where] = by[x.src + " in ." + x.where] || []).push(x);
    for (const k of Object.keys(by)) {
      const g = by[k], worst = g.reduce((a, x) => Math.abs(x.off) > Math.abs(a.off) ? x : a);
      console.log(`  ✗  ${k} drawn out of shape on ${new Set(g.map(x => x.page)).size} page(s)`);
      console.log(`     worst: ${worst.drawn} at ${worst.w}px, ${worst.off > 0 ? "stretched" : "squeezed"} ${Math.abs(worst.off)}% — e.g. ${worst.page}`);
    }
  }
  process.exit(bad.length ? 1 : 0);
})();
