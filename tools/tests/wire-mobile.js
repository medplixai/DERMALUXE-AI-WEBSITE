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
      await pg.evaluate(() => {
        // The class that reveals one of these is "in" — script.js adds it and
        // styles.css answers with .reveal.in { opacity: 1; transform: none }.
        // This line asked for "is-visible", which nothing anywhere defines. It
        // changes nothing measurable, because script.js has already added "in"
        // by the time the page is handed over — counted on four pages, 975
        // elements visible either way. It is corrected so the next person does
        // not read it as the thing that makes the page visible.
        document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in"));
        // the academy's join form is behind a .hide until its link checks out
        document.querySelectorAll(".hide").forEach((e) => e.classList.remove("hide"));
      });
      const r = await pg.evaluate((MIN_TAP, GUTTER) => {
        const vw = document.documentElement.clientWidth;
        const out = { over: document.documentElement.scrollWidth > vw + 1, wide: [], tiny: [], stacked: [], ragged: [], ragbtn: [], thin: [], ghost: [], zoom: [], wrapbar: [], shortrow: [], micro: [], unnamed: [], parked: [], buried: [], script: [] };

        // An element closed with the `hidden` attribute whose class still sets
        // a display keeps its whole box: invisible, and still taking every tap
        // that lands on it. The AI chat panel did this for months — .dlchat
        // sets display:flex, which beats the browser's own [hidden] rule, so a
        // closed panel was a 351x431 sheet pinned over the middle of every
        // phone screen. A real touch on "Book a Consultation" at 195,623 went
        // to the panel's WhatsApp strip and the page did not move.
        for (const e of document.querySelectorAll("[hidden]")) {
          const c = getComputedStyle(e), b = e.getBoundingClientRect();
          if (c.display === "none" || b.width < 8 || b.height < 8) continue;
          out.ghost.push(`${(e.id || e.className || e.tagName).toString().split(" ")[0]} ${Math.round(b.width)}x${Math.round(b.height)} still laid out as ${c.display}`);
        }
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
          // Too small to tap. A link inside a sentence is excluded: "Terms" in
          // a line of footer prose is 31x19 and always will be — the rule is
          // about standalone controls, and reporting inline links as controls
          // made six pages fail for a thing no visitor would call a problem.
          if (/^(a|button)$/i.test(e.tagName) && e.textContent.trim() && c.position !== "fixed" &&
              b.height < MIN_TAP && b.width < MIN_TAP) {
            const p = e.parentElement;
            const inProse = p && /^(P|LI|SPAN|SMALL|TD|FIGCAPTION)$/.test(p.tagName) &&
              p.textContent.trim().length > e.textContent.trim().length + 3;
            if (!inProse) out.tiny.push(name(e) + " " + Math.round(b.width) + "x" + Math.round(b.height));
          }
        }
        // Every section starts on the same left edge and leaves the same gap on
        // the right. A centred section may be narrower, but it may not start
        // somewhere of its own.
        const edges = {};
        for (const sec of document.querySelectorAll("section, footer")) {
          const c = sec.querySelector(".container");
          if (!c) continue;
          const b = c.getBoundingClientRect();
          if (b.width < 40) continue;
          const id = sec.id || (sec.className || sec.tagName).toString().split(" ")[0];
          (edges[Math.round(b.left)] = edges[Math.round(b.left)] || []).push(id);
        }
        const ek = Object.keys(edges);
        if (ek.length > 1) {
          const main = ek.sort((a, b) => edges[b].length - edges[a].length)[0];
          out.ragged = ek.filter((k) => k !== main).map((k) => `${edges[k].join("/")} at ${k} not ${main}`);
        }

        // Buttons that stack must stack to one width — 253, 265 and 359 down
        // the middle of a phone is what "not made for this" looks like.
        const seenGroup = new Set();
        for (const btn of document.querySelectorAll("a.btn, button.btn")) {
          const par = btn.parentElement;
          if (!par || seenGroup.has(par)) continue;
          seenGroup.add(par);
          const sibs = [...par.children].filter((e) => e.classList && e.classList.contains("btn") && e.offsetParent);
          if (sibs.length < 2) continue;
          const boxes = sibs.map((e) => e.getBoundingClientRect());
          const stacked = new Set(boxes.map((b) => Math.round(b.top))).size === sibs.length;
          const widths = [...new Set(boxes.map((b) => Math.round(b.width)))];
          if (stacked && widths.length > 1)
            out.ragbtn.push(`${(par.className || par.tagName).toString().split(" ")[0]} [${widths.join(", ")}]`);
        }

        // A grid column under 150px on a phone wraps prose into three-word
        // lines. Four hair-transplant cards two-up gave each 170px and broke
        // their descriptions into six lines.
        for (const g of document.querySelectorAll("div, ul, ol")) {
          const c = getComputedStyle(g);
          if (c.display !== "grid") continue;
          const cols = c.gridTemplateColumns.split(" ").filter(Boolean);
          if (cols.length < 2) continue;
          // Not width alone, and not the grid's text — how many lines that one
          // column forces, measured from the two real cases:
          //   ht__techs    170px holding 259 chars -> ~12 lines. Unreadable.
          //   process__line 167px holding 120 chars -> ~6 lines. Fine.
          // Nearly the same width, opposite verdicts, so width alone cannot
          // tell them apart. At a 16px body roughly w/8 characters fit a line.
          // The first threshold tried here was "narrower than 150px", which
          // the 170px case walks straight past — a check that could not fail.
          const w = parseFloat(cols[0]);
          const first = g.firstElementChild;
          const chars = first ? first.textContent.trim().length : 0;
          const lines = w ? (chars * 8) / w : 0;
          if (lines > 8)
            out.thin.push(`${(g.className || "grid").toString().split(" ")[0]} ${cols.length}×${Math.round(w)}px, about ${Math.round(lines)} lines a column`);
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

        // Safari on iPhone zooms the page in, and leaves it zoomed, the moment
        // a finger lands in a field whose text is under 16px. Nothing shows on
        // a desktop or on Android, so only a rule can hold it: the booking
        // form sat at .98rem — 15.68px, a third of a pixel under — and threw
        // the page out of shape on every tap for as long as it has existed.
        // A <label> sitting beside a field is read by a person looking at the
        // screen and by nothing else. The academy's join form had its words in
        // the right place for all nineteen — "Full name · పూర్తి పేరు" directly
        // above the box — and not one of them tied to the field, so anything
        // reading the page aloud announced an empty edit box nineteen times.
        // `for` and `id`, or a wrapping label, or aria-label: any of the three.
        for (const e of document.querySelectorAll("input, select, textarea")) {
          if (/^(hidden|submit|button|image)$/.test(e.type || "")) continue;
          if ((e.labels && e.labels.length) || e.getAttribute("aria-label") ||
              e.getAttribute("aria-labelledby") || e.getAttribute("title") || e.placeholder) continue;
          const near = e.parentElement && e.parentElement.querySelector("label");
          out.unnamed.push(name(e) + (near ? ' has "' + near.textContent.trim().replace(/\s+/g, " ").slice(0, 22) + '" beside it, untied' : " has nothing naming it"));
        }

        for (const e of document.querySelectorAll("input, select, textarea")) {
          const c = getComputedStyle(e);
          if (c.display === "none" || c.visibility === "hidden") continue;
          if (/^(hidden|checkbox|radio|submit|button|range|color|file)$/.test(e.type || "")) continue;
          const f = parseFloat(c.fontSize);
          if (f && f < 16) out.zoom.push(name(e) + " " + f.toFixed(2) + "px");
        }

        // A bar pinned to the bottom of the screen is sized by whatever is in
        // it. When its label runs one pixel past the width it is given, the
        // label wraps, the bar grows, and it eats further into the page above
        // — which is how the academy bar came to slice through the headline a
        // visitor lands on. A bottom bar holds one line.
        for (const e of document.querySelectorAll("body *")) {
          const c = getComputedStyle(e);
          if (c.position !== "fixed" || c.display === "none" || +c.opacity === 0) continue;
          const b = e.getBoundingClientRect();
          if (b.width < vw * 0.7 || b.bottom < window.innerHeight - 4 || b.height < 8) continue;
          for (const a of e.querySelectorAll("a, button")) {
            if (!a.textContent.trim() || a.children.length) continue;
            const r = document.createRange(); r.selectNodeContents(a);
            const n = r.getClientRects().length;
            if (n > 1) out.wrapbar.push(name(e) + " — " + name(a) + ' "' + a.textContent.trim().slice(0, 26) + '" wraps onto ' + n + " lines, bar " + Math.round(b.height) + "px tall");
          }
        }

        // Twelve pixels is the smallest size worth calling text on a phone. The
        // AI chips sat at .58rem — 9.28px — and the Skin/Hair pills at .62rem,
        // which on a 390px screen is a shape where a word should be. Sizes are
        // set in rem, so this catches a new rule written below the floor
        // wherever it lives, stylesheet or page.
        for (const e of document.querySelectorAll("body *")) {
          if (e.children.length) continue;
          const t = e.textContent.trim();
          if (t.length < 2) continue;
          const c = getComputedStyle(e);
          if (c.display === "none" || c.visibility === "hidden") continue;
          if (e.closest("svg")) continue;            // px inside an svg is viewBox units, not screen pixels
          const f = parseFloat(c.fontSize);
          if (f && f < 12) out.micro.push(name(e) + " " + f.toFixed(2) + 'px "' + t.slice(0, 20) + '"');
        }

        // What a screen reader is told to read the words in. A page says
        // lang="en" at the top and then carries Telugu all down it; anything
        // reading aloud applies English phoneme rules to Telugu glyphs and
        // produces noise, or skips the run. The treatments hub was the worst
        // of it — 36 of its links had names with no Latin letter at all, and
        // they are the only route into the site's whole Telugu half. A run
        // that is all one script has to say which.
        {
          const TE = /[\u0C00-\u0C7F]/;
          // Any Telugu at all has to be announced as Telugu. The other way
          // round is looser on purpose: "PRP", "GFC", "PICO", "LLLT" and
          // "MD (DVL)" sit inside genuinely Telugu sentences on the academy
          // and treatment pages, and a Telugu voice saying an acronym is
          // right. Three words or more is a sentence, and a sentence in the
          // wrong voice is the thing worth catching.
          const LAT = /(?:[A-Za-z]{3,}[^A-Za-z]+){2,}[A-Za-z]{3,}/;
          const langOf = (n) => {
            for (let e = n.parentElement; e; e = e.parentElement) {
              const l = e.getAttribute && e.getAttribute("lang");
              if (l) return l;
            }
            return document.documentElement.lang || "";
          };
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            if (n.parentElement && n.parentElement.closest("script,style")) continue;
            const t = n.nodeValue;
            const te = TE.test(t), anyLat = /[A-Za-z]{2,}/.test(t), lat = LAT.test(t);
            // A run carrying both scripts cannot be given one language, and in
            // an <option> it cannot be split either — "Video Call (వీడియో)" is
            // as good as it gets. Only judge runs that are all one script.
            if (te && anyLat) continue;
            if (!te && !lat) continue;
            const l = langOf(n), saysTe = /^te/i.test(l);
            if (te && !saysTe) out.script.push('Telugu announced as "' + (l || "nothing") + '": ' + JSON.stringify(t.trim().slice(0, 24)));
            else if (lat && saysTe) out.script.push('English announced as Telugu: ' + JSON.stringify(t.trim().slice(0, 24)));
          }
        }

        // A panel hidden by being pushed off the side is still there: still
        // visible to the browser, still in the tab order, still taking taps.
        // The nav drawer was translateX(100%) and nothing else, so Tab seven
        // times on the home page put focus on "Home" inside it, the browser
        // scrolled that into view, and the whole page sat 261px sideways —
        // permanently, through scrolling down and back. visibility:hidden or
        // the inert attribute is what takes it out of both.
        for (const e of document.querySelectorAll("body *")) {
          const c = getComputedStyle(e);
          if (c.display === "none" || c.visibility === "hidden") continue;
          if (e.hasAttribute("inert") || e.closest("[inert]")) continue;
          const b = e.getBoundingClientRect();
          if (b.width < 40 || b.height < 40) continue;
          const off = b.left >= vw - 1 || b.right <= 1;        // parked past an edge
          if (!off) continue;
          const reachable = [...e.querySelectorAll("a[href],button,input,select,textarea")]
            .filter((k) => k.tabIndex >= 0 && getComputedStyle(k).visibility !== "hidden");
          if (reachable.length)
            out.parked.push(name(e) + " is off the edge at " + Math.round(b.left) + " with " + reachable.length + " things still in the tab order");
        }

        // And the button that opens such a panel has to still be reachable
        // once it has. The drawer is z-index 99 and the hamburger was static,
        // so the panel painted over the X it had just animated into: nine real
        // taps in a row left the menu open, and the only way out was to pick a
        // link or leave the site.
        for (const t of document.querySelectorAll("[aria-expanded]")) {
          const tc = getComputedStyle(t);
          if (tc.display === "none" || tc.visibility === "hidden") continue;
          const tb = t.getBoundingClientRect();
          if (tb.width < 8 || tb.height < 8) continue;
          const ctrl = t.getAttribute("aria-controls");
          const panel = ctrl ? document.getElementById(ctrl) : document.querySelector(".nav__links, [class*='drawer'], [class*='menu']");
          if (!panel) continue;
          // The drawer slides in over .45s. Adding the class and measuring in
          // the same tick finds it still parked off the edge, which is how the
          // first version of this check passed while the bug was in: turn the
          // transition off so the open position is the one measured.
          const had = panel.className, hadT = panel.style.transition;
          panel.style.transition = "none";
          panel.classList.add("open");
          void panel.offsetWidth;
          const got = document.elementFromPoint(tb.left + tb.width / 2, tb.top + tb.height / 2);
          const ok = got && (got === t || t.contains(got) || got.contains(t));
          panel.className = had;
          panel.style.transition = hadT;
          void panel.offsetWidth;
          if (!ok)
            out.buried.push(name(t) + " is covered by " + name(panel) + " once it is open — a press there reaches " + (got ? name(got) : "nothing"));
        }

        // A thumb covers about 44px. A column of links each as tall as its own
        // text gives it 24, and the one below is four pixels away: the footer
        // stacked seventeen of those on a phone. Width is not the problem —
        // these run the full screen — so the rule is about height, and only
        // where several sit one under another with nothing else between.
        {
          const col = new Map();
          for (const a of document.querySelectorAll("a[href]")) {
            const c = getComputedStyle(a);
            if (c.display === "none" || c.visibility === "hidden" || +c.opacity === 0 || c.position === "fixed") continue;
            const b = a.getBoundingClientRect();
            if (b.width < vw * 0.4 || b.height < 1 || b.height >= 30) continue;
            const p = a.parentElement; if (!p) continue;
            if (/^(P|LI|SPAN|SMALL|TD|FIGCAPTION)$/.test(p.tagName) && p.textContent.trim().length > a.textContent.trim().length + 3) continue;
            if (!col.has(p)) col.set(p, []);
            col.get(p).push(Math.round(b.height));
          }
          for (const [p, hs] of col) if (hs.length >= 3)
            out.shortrow.push(name(p) + " stacks " + hs.length + " links " + Math.min(...hs) + "px tall");
        }

        return out;
      }, MIN_TAP, GUTTER);

      checked++;
      const problems = [];
      if (r.over) problems.push("scrolls sideways");
      if (r.wide.length) problems.push(`${r.wide.length} off the edge (${r.wide.slice(0, 2).join(", ")})`);
      if (r.tiny.length) problems.push(`${r.tiny.length} too small to tap (${r.tiny.slice(0, 2).join(", ")})`);
      if (r.stacked.length) problems.push(`stacked: ${[...new Set(r.stacked)].join(", ")}`);
      if (r.ragged && r.ragged.length) problems.push(`sections start at different left edges — ${r.ragged.join("; ")}`);
      if (r.ragbtn && r.ragbtn.length) problems.push(`stacked buttons are different widths — ${[...new Set(r.ragbtn)].join(", ")}`);
      if (r.thin && r.thin.length) problems.push(`grid columns too narrow for their text — ${[...new Set(r.thin)].join(", ")}`);
      if (r.ghost && r.ghost.length) problems.push(`closed but still taking taps — ${[...new Set(r.ghost)].join(", ")}`);
      if (r.zoom && r.zoom.length) problems.push(`fields under 16px, which zoom an iPhone — ${[...new Set(r.zoom)].join(", ")}`);
      if (r.wrapbar && r.wrapbar.length) problems.push(`the bar at the bottom wrapped — ${[...new Set(r.wrapbar)].join("; ")}`);
      if (r.shortrow && r.shortrow.length) problems.push(`a column of links too short to aim at — ${[...new Set(r.shortrow)].join(", ")}`);
      if (r.micro && r.micro.length) problems.push(`text under 12px — ${[...new Set(r.micro)].slice(0, 4).join(", ")}`);
      if (r.unnamed && r.unnamed.length) problems.push(`fields nothing would announce — ${[...new Set(r.unnamed)].slice(0, 3).join("; ")}`);
      if (r.parked && r.parked.length) problems.push(`hidden by being pushed off the side, but still reachable — ${[...new Set(r.parked)].join("; ")}`);
      if (r.buried && r.buried.length) problems.push(`the control that opens it cannot close it — ${[...new Set(r.buried)].join("; ")}`);
      if (r.script && r.script.length) problems.push(`${r.script.length} run(s) a reader would be given in the wrong language — ${[...new Set(r.script)].slice(0, 2).join("; ")}`);
      if (problems.length) { bad++; console.log(`  ✗  ${f}: ${problems.join(" · ")}`); }
    } catch (e) {
      bad++; console.log(`  ✗  ${f}: ${e.message.slice(0, 70)}`);
    }
    await pg.close();
  }
  // --- the desktop left edge ------------------------------------------------
  // A section whose text is left-aligned must start on the same left edge as
  // every other one, or the page reads as crooked. The hero got this wrong for
  // months: it is one <div class="container hero__inner">, .container asked for
  // 1200, max-width:860 overruled it, and margin-inline:auto then centred the
  // 860 — so the headline sat 170px right of the logo directly above it, at
  // every width. A CENTRED section may be narrower; it is aligned on the
  // middle, and .highlight and .ctabanner are that on purpose.
  //
  // Checked on one page per template rather than all 94: the left edge comes
  // from .container, which every page shares, and switching the viewport twice
  // on each of 94 pages was flaky enough to kill a tab.
  const TEMPLATES = ["index.html", "treatments.html", "academy.html", "acne-treatment-eluru.html",
    "acne-treatment-eluru-telugu.html", "contact.html", "privacy.html"].filter((f) => fs.existsSync(path.join(ROOT, f)));
  for (const f of TEMPLATES) {
    const pg = await b.newPage();
    await pg.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    try {
      await pg.goto("file://" + path.join(ROOT, f), { waitUntil: "domcontentloaded", timeout: 30000 });
      await pg.evaluate(() => {
        // The class that reveals one of these is "in" — script.js adds it and
        // styles.css answers with .reveal.in { opacity: 1; transform: none }.
        // This line asked for "is-visible", which nothing anywhere defines. It
        // changes nothing measurable, because script.js has already added "in"
        // by the time the page is handed over — counted on four pages, 975
        // elements visible either way. It is corrected so the next person does
        // not read it as the thing that makes the page visible.
        document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in"));
        // the academy's join form is behind a .hide until its link checks out
        document.querySelectorAll(".hide").forEach((e) => e.classList.remove("hide"));
      });
      const edges = await pg.evaluate(() => {
        const m = {};
        for (const sec of document.querySelectorAll("section, footer")) {
          const c = sec.querySelector(".container");
          if (!c || getComputedStyle(c).textAlign === "center") continue;
          const b = c.getBoundingClientRect();
          if (b.width < 40) continue;
          const id = sec.id || (sec.className || sec.tagName).toString().split(" ")[0];
          (m[Math.round(b.left)] = m[Math.round(b.left)] || []).push(id);
        }
        return m;
      });
      const keys = Object.keys(edges);
      if (keys.length > 1) {
        const main = keys.sort((x, y) => edges[y].length - edges[x].length)[0];
        const odd = keys.filter((k) => k !== main).map((k) => `${edges[k].join("/")} starts at ${k}, everything else at ${main}`);
        bad++; console.log(`  ✗  ${f}: left edges disagree at 1440px — ${odd.join("; ")}`);
      }
    } catch (e) { bad++; console.log(`  ✗  ${f}: ${e.message.slice(0, 70)}`); }
    await pg.close();
  }

  await b.close();
  console.log(bad ? `\n  ${bad} problem(s) in the layout people see, of ${checked} pages` : `\n  ${checked} pages, every one behaves at 390px and lines up at 1440px`);
  process.exit(bad ? 1 : 0);
})();
