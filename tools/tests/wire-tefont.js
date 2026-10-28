// wire-fonts proves the four Telugu stacks are written correctly. It cannot
// prove that a stack is the one that WINS on a given element, and that is a
// different question: .te-serif is one class, so any rule like ".highlight p"
// carrying two beats it, and the paragraph quietly falls back to whatever
// Telugu face the reader's phone happens to own -- a sans on Android, next to
// an English sibling in Cormorant, while the Noto Serif Telugu the page has
// already downloaded goes unused.
//
// So: open every page, find every run of Telugu, and ask the browser which
// family it resolved, not which one the stylesheet asked for.
const fs = require("fs"), path = require("path");
const puppeteer = require(path.resolve(__dirname, "../../node_modules/puppeteer-core"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = path.resolve(__dirname, "../..");
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 390, height: 844 });
  const bad = [];
  let checked = 0;

  for (const p of pages) {
    try {
      await pg.goto("file://" + path.join(ROOT, p), { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (e) { continue; }
    const found = await pg.evaluate(() => {
      const TE = /[ఀ-౿]/;
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      // a script's source is not text anybody reads, and an <option> is drawn
      // by the operating system's own menu widget, which ignores font-family
      const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE|OPTION)$/;
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!TE.test(n.nodeValue)) continue;
        const el = n.parentElement;
        if (!el || seen.has(el) || SKIP.test(el.tagName) || el.closest("script,style,template,option")) continue;
        seen.add(el);
        const fam = getComputedStyle(el).fontFamily;
        if (/Noto (Sans|Serif) Telugu/.test(fam)) continue;
        out.push({
          where: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""),
          fam: fam,
          text: n.nodeValue.trim().slice(0, 30),
        });
      }
      return out;
    });
    checked++;
    for (const f of found) bad.push(Object.assign({ page: p }, f));
  }
  await pg.close(); await b.close();

  console.log(`${checked} pages read for Telugu text\n`);
  if (!bad.length) {
    console.log("  every run of Telugu resolves to a Telugu face the site ships");
  } else {
    // one line per distinct rule, not per occurrence
    const by = {};
    for (const x of bad) (by[x.where + " :: " + x.fam] = by[x.where + " :: " + x.fam] || []).push(x);
    for (const k of Object.keys(by)) {
      const g = by[k];
      console.log(`  ✗  ${g[0].where} on ${g.length} element(s) across ${new Set(g.map(x => x.page)).size} page(s)`);
      console.log(`     asks for ${g[0].fam} — no Telugu face, so the phone picks one`);
      console.log(`     e.g. ${g[0].page}: ${JSON.stringify(g[0].text)}`);
    }
  }
  process.exit(bad.length ? 1 : 0);
})();
