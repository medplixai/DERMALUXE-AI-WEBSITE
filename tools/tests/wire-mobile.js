// Most people reach this clinic on a phone, so the phone is the real layout,
// not the fallback. This opens every public page at 390x844 and reports only
// things a visitor would feel: the page scrolling sideways, text or a button
// running off the edge or crowding it, a tap target too small to hit, and two
// fixed controls sitting on top of each other.
//
// It exists because the back-to-top arrow spent weeks unreachable on phones —
// the AI chat button sat a z-index above it at almost the same coordinates,
// and on a first visit the cookie bar covered both. Nothing caught it, because
// nothing had ever looked at the page the way a thumb does.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SKIP = /^(staff|staff-app|leads|marketing|my|pay|offline|404|google[0-9a-f]+)\.html$/;
const MIN_TAP = 32;      // below this a control is hard to hit with a thumb
const GUTTER = 8;        // text this close to the edge reads as a mistake

(async () => {
  if (!fs.existsSync(CHROME)) { console.log("  (no Chrome here — skipped)"); process.exit(0); }
  let puppeteer;
  try { puppeteer = require("puppeteer-core"); }
  catch (e) { console.log("  (puppeteer-core not installed — skipped)"); process.exit(0); }

  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !SKIP.test(f)).sort();
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  let bad = 0, checked = 0;

  for (const f of pages) {
    const pg = await b.newPage();
    await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    try {
      await pg.goto("file://" + path.join(ROOT, f), { waitUntil: "domcontentloaded", timeout: 30000 });
      await pg.evaluate(() => { document.querySelectorAll(".reveal").forEach((e) => e.classList.add("is-visible")); });
      const r = await pg.evaluate((MIN_TAP, GUTTER) => {
        const vw = document.documentElement.clientWidth;
        const out = { over: document.documentElement.scrollWidth > vw + 1, wide: [], tiny: [], stacked: [] };
        const name = (e) => (e.id || (e.className && e.className.toString()) || e.tagName).split(" ")[0];

        // A closed off-canvas panel parks its contents past the right edge on
        // purpose. Everything inside one is where it is meant to be.
        // Asked by where the panel actually sits, not by how it is positioned —
        // the nav drawer slides out with a transform, so testing for
        // position:fixed missed it and reported all nine of its links.
        const parked = new Set();
        for (const e of document.querySelectorAll("body *")) {
          const b = e.getBoundingClientRect();
          if (b.width > 40 && b.left >= vw - 1) { parked.add(e); e.querySelectorAll("*").forEach((k) => parked.add(k)); }
        }
        for (const e of document.querySelectorAll("body *")) {
          if (parked.has(e)) continue;
          const c = getComputedStyle(e);
          if (c.display === "none" || c.visibility === "hidden" || +c.opacity === 0) continue;
          const b = e.getBoundingClientRect();
          if (b.width < 2 || b.height < 2) continue;
          // Runs off the edge — unless an ancestor clips it on purpose. The
          // treatment marquee is wider than the screen by design and scrolls
          // inside a box with overflow:hidden; reported raw it was thirteen
          // findings that a visitor can never see.
          if (e.children.length === 0 && e.textContent.trim() && (b.right > vw + 1 || b.left < -1)) {
            let clipped = false;
            for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
              const pc = getComputedStyle(p);
              if (/hidden|clip|auto|scroll/.test(pc.overflowX)) { clipped = true; break; }
            }
            if (!clipped) out.wide.push(name(e) + " " + Math.round(b.left) + ".." + Math.round(b.right));
          }
          // too small to tap
          if (/^(a|button)$/i.test(e.tagName) && e.textContent.trim() && c.position !== "fixed" &&
              (b.height < MIN_TAP && b.width < MIN_TAP)) out.tiny.push(name(e) + " " + Math.round(b.width) + "x" + Math.round(b.height));
        }
        // two fixed controls in the same place: whichever is on top wins every tap
        const fx = [...document.querySelectorAll("body *")].filter((e) => {
          const c = getComputedStyle(e), b = e.getBoundingClientRect();
          return c.position === "fixed" && c.display !== "none" && +c.opacity > 0 && b.width > 16 && b.height > 16 && b.width < 300;
        });
        for (let i = 0; i < fx.length; i++) for (let j = i + 1; j < fx.length; j++) {
          const a = fx[i].getBoundingClientRect(), d = fx[j].getBoundingClientRect();
          const ox = Math.min(a.right, d.right) - Math.max(a.left, d.left);
          const oy = Math.min(a.bottom, d.bottom) - Math.max(a.top, d.top);
          if (ox > 8 && oy > 8) out.stacked.push(name(fx[i]) + " over " + name(fx[j]));
        }
        return out;
      }, MIN_TAP, GUTTER);

      checked++;
      const problems = [];
      if (r.over) problems.push("scrolls sideways");
      if (r.wide.length) problems.push(`${r.wide.length} off the edge (${r.wide.slice(0, 2).join(", ")})`);
      if (r.tiny.length) problems.push(`${r.tiny.length} too small to tap (${r.tiny.slice(0, 2).join(", ")})`);
      if (r.stacked.length) problems.push(`stacked: ${[...new Set(r.stacked)].join(", ")}`);
      if (problems.length) { bad++; console.log(`  ✗  ${f}: ${problems.join(" · ")}`); }
    } catch (e) {
      bad++; console.log(`  ✗  ${f}: ${e.message.slice(0, 70)}`);
    }
    await pg.close();
  }
  await b.close();
  console.log(bad ? `\n  ${bad} problem(s) on a phone, of ${checked} pages` : `\n  ${checked} pages, every one behaves on a 390px phone`);
  process.exit(bad ? 1 : 0);
})();
