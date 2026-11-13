// Phone-sized screenshots of the staff app for the Telugu user manual
// (print/make-staff-manual.js). They are taken from the MOCK server
// (tools/mock-staff-server.js, port 4599), which serves the real staff.html
// against invented names and numbers — no real patient or lead appears in
// the manual. Start the mock first, then:  node print/manual-shots.js
const path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const OUT = path.join(__dirname, "manual", "shots");
const BASE = "http://localhost:4599/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // Any real-looking owner number the mock carries is swapped for a dummy
  // before the picture is taken.
  const scrub = () => p.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (/9010427777/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/9010427777/g, "9876500000"); });
  const shot = async (name) => { await wait(900); await scrub(); await p.screenshot({ path: path.join(OUT, name + ".png") }); console.log("  ✓", name); };
  // 1 · login, from a fresh profile
  await p.goto(BASE, { waitUntil: "networkidle0" });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.goto(BASE, { waitUntil: "networkidle0" });
  // The browser's "add to home screen" bar is not in the Android app; close it.
  const noBar = () => p.evaluate(() => { const n = document.getElementById("installNo"); if (n && n.offsetParent) n.click(); });
  await wait(600); await noBar();
  await shot("login");
  await p.type("#phone", "9876500000").catch(() => {});
  await p.type("#pwd", "demo").catch(() => {});
  await p.click("#loginBtn").catch(() => {});
  await wait(2500);
  // Everything after login happens in ONE page, moving by the app's own tab
  // buttons — a reload re-opens whatever sheet was last open.
  const go = async (t) => { await p.evaluate((t) => { document.querySelectorAll(".sheet.open, .modal.open").forEach((x) => x.classList.remove("open")); const b = document.querySelector('.tab[data-t="' + t + '"]'); if (b) b.click(); }, t); await wait(1600); await noBar(); await p.evaluate(() => window.scrollTo(0, 0)); await wait(300); };
  const closeAll = () => p.evaluate(() => { [...document.querySelectorAll("button")].filter((b) => /^(Close|Moosey|Cancel)$/i.test(b.textContent.trim()) && b.offsetParent).forEach((b) => b.click()); document.querySelectorAll(".sheet.open").forEach((x) => x.classList.remove("open")); });
  const tabs = ["leads", "inbox", "appts", "patients", "money", "academy", "students", "attend", "files", "today", "stock", "team"];
  for (const t of tabs) { await closeAll(); await go(t); await shot("tab-" + t); }
  // a lead card in view
  await closeAll(); await go("leads");
  await p.evaluate(() => { const c = document.querySelector("#leadList article.lead"); if (c) c.scrollIntoView({ block: "start" }); window.scrollBy(0, -70); });
  await shot("lead-card");
  // the More sheet on a phone
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => { const m = document.querySelector('[data-nav="__more"]'); if (m) m.click(); });
  await shot("more");
  await closeAll();
  // a patient file
  await go("patients");
  await p.evaluate(() => { const r = document.querySelector("#ptList .ptrow"); if (r) r.click(); });
  await shot("patient-file");
  await closeAll();
  // a student card with its status picker
  await go("students");
  await p.evaluate(() => { const c = document.querySelector("#studList article"); if (c) c.scrollIntoView({ block: "start" }); window.scrollBy(0, -70); });
  await shot("student-card");
  // the appointment list further down
  await go("appts");
  await p.evaluate(() => window.scrollBy(0, 520));
  await shot("appts-list");
  // the new-lead form last, so it cannot follow us into another screen
  await go("leads");
  await p.evaluate(() => { const b = document.getElementById("leadAdd"); if (b) b.click(); });
  await shot("lead-new");
  await b.close();
})();
