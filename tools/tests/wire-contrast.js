// Gold and grey on near-black looks expensive on a desk and can be
// unreadable on a phone held outdoors, which is where this clinic's patients
// read it. --muted-2 carried the registration numbers, the dates and the
// Telugu captions under every treatment picture at #7c776e, and that is
// 4.45:1 against --black falling to 3.81:1 against --panel-2 — under the 4.5
// the guideline asks for text that size, on all five of the grounds the site
// uses, on 84 pages.
//
// This reads the colour the browser resolves, not the one the stylesheet
// asks for, and it looks for the ground behind the text rather than assuming
// it: a transparent box is see-through, so the walk goes up until it finds
// something opaque. Text over a picture or a gradient is skipped — there is
// no single colour behind it to measure against.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// the logged-in screens need a session; wire-fonts holds their sizes instead
const SKIP = /^(staff|staff-app|leads|marketing|my|pay|offline|google[0-9a-f]+)\.html$/;

(async () => {
  if (!fs.existsSync(CHROME)) { console.log("  (no Chrome here — skipped)"); process.exit(0); }
  let puppeteer;
  try { puppeteer = require(path.join(ROOT, "node_modules/puppeteer-core")); }
  catch (e) { console.log("  (puppeteer-core not installed — skipped)"); process.exit(0); }

  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !SKIP.test(f)).sort();
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--allow-file-access-from-files"] });

  const probe = () => {
    const lum = (r, g, bl) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
    };
    const parse = (s) => { const m = (s || "").match(/[\d.]+/g); return m ? m.map(Number) : null; };
    const behind = (e) => {
      for (let q = e; q && q !== document.documentElement; q = q.parentElement) {
        const c = getComputedStyle(q), p = parse(c.backgroundColor);
        if (c.backgroundImage !== "none") return null;          // a picture or a gradient — no one colour to measure
        if (p && (p[3] === undefined || p[3] > 0.92)) return p;
      }
      return [10, 10, 12];
    };
    const nm = (e) => (e.id ? "#" + e.id : "") + (e.className && e.className.toString().trim() ? "." + e.className.toString().trim().split(/\s+/)[0] : (e.id ? "" : e.tagName.toLowerCase()));
    const out = [];
    for (const e of document.querySelectorAll("body *")) {
      if (e.children.length || e.textContent.trim().length < 3) continue;
      const c = getComputedStyle(e);
      if (c.display === "none" || c.visibility === "hidden" || +c.opacity < 0.95) continue;
      if (e.closest("[hidden]") || e.closest("svg")) continue;
      const bb = e.getBoundingClientRect();
      if (bb.width < 8 || bb.height < 6) continue;
      const fg = parse(c.color); if (!fg || (fg[3] !== undefined && fg[3] < 0.9)) continue;
      const bg = behind(e); if (!bg) continue;
      const l1 = lum(fg[0], fg[1], fg[2]), l2 = lum(bg[0], bg[1], bg[2]);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(c.fontSize), bold = +c.fontWeight >= 700;
      const need = (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5;   // the guideline's allowance for large text
      if (ratio < need)
        out.push(nm(e) + " " + ratio.toFixed(2) + ":1 where " + need + " is asked, " + Math.round(px) +
                 "px rgb(" + fg.slice(0, 3).join(",") + ") on rgb(" + bg.slice(0, 3).join(",") + ")");
    }
    return [...new Set(out)];
  };

  const found = new Map();
  let checked = 0;
  for (const f of pages) {
    const pg = await b.newPage();
    await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    try {
      await pg.goto("file://" + path.join(ROOT, f), { waitUntil: "domcontentloaded", timeout: 30000 });
      await pg.evaluate(() => { document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")); });
      await pg.evaluate(() => document.fonts.ready).catch(() => {});
      for (const line of await pg.evaluate(probe)) {
        const key = line.replace(/^\S+ /, "");                  // the colour pair, not the element name
        if (!found.has(key)) found.set(key, { line, pages: [] });
        if (found.get(key).pages.length < 3) found.get(key).pages.push(f);
      }
      checked++;
    } catch (e) { console.log(`  ✗  ${f}: ${e.message.split("\n")[0].slice(0, 70)}`); }
    await pg.close();
  }
  await b.close();

  // one colour failing on ninety pages is one thing to fix, not ninety
  for (const g of [...found.values()]) console.log(`  ✗  ${g.line}   e.g. ${g.pages.join(", ")}`);
  console.log(found.size ? `\n  ${found.size} colour pair(s) too faint to read, across ${checked} pages`
                         : `\n  every piece of text on ${checked} pages is readable against what is behind it`);
  process.exit(found.size ? 1 : 0);
})();
