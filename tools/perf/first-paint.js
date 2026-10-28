// What one attribute in <head> costs at first paint, on a line like the one a
// phone in Eluru is on.
//
//   node .claude/serve-site.js          (or: preview "site", port 4321)
//   node tools/perf/first-paint.js
//
// Both arms go over the same local server with the browser throttled, and the
// file is changed on disk between runs. Do not reach for request interception
// here: a fetch() in Node is not one of the browser's requests, so CDP does
// not throttle it, and whichever arm is intercepted wins. docs/measuring-
// first-paint.md has the longer version.
const fs = require("fs");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const puppeteer = require("/Users/nagarajubandaru/Library/Mobile Documents/com~apple~CloudDocs/DERMALUXE AI WEBSITE/node_modules/puppeteer-core");
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const ROOT = "/Users/nagarajubandaru/Library/Mobile Documents/com~apple~CloudDocs/DERMALUXE AI WEBSITE/";
const RUNS = Number(process.env.RUNS || 7);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const set = (file, deferred) => {
  const p = ROOT + file, s = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, deferred
    ? s.replace('<script src="analytics.js"></script>', '<script defer src="analytics.js"></script>')
    : s.replace('<script defer src="analytics.js"></script>', '<script src="analytics.js"></script>'));
};
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [file, url] of [["index.html", "/index.html"], ["acne-treatment-eluru.html", "/acne-treatment-eluru.html"]]) {
    const got = { blocking: [], deferred: [] };
    // alternate the two arms run by run, so a machine that gets busier partway
    // through slows both the same way instead of only the later one
    for (let i = 0; i < RUNS * 2; i++) {
      const mode = i % 2 ? "deferred" : "blocking";
      set(file, mode === "deferred");
      const pg = await b.newPage();
      await pg.setUserAgent(UA);
      await pg.setViewport({ width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await pg.evaluateOnNewDocument(() => { try { localStorage.setItem("dl_cookie_consent", "granted"); } catch (e) {} });
      const cdp = await pg.target().createCDPSession();
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: 400e3 / 8, uploadThroughput: 400e3 / 8, latency: 400 });
      try {
        await pg.goto("http://localhost:4321" + url, { waitUntil: "domcontentloaded", timeout: 120000 });
        await new Promise(s => setTimeout(s, 2500));
        const f = await pg.evaluate(() => Math.round((performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || 0));
        if (f > 0) got[mode].push(f);
      } catch (e) {}
      await pg.close();
    }
    set(file, true);   // leave it as it is deployed
    const x = med(got.blocking), y = med(got.deferred);
    console.log(file.padEnd(28) + "first paint, middle of " + got.blocking.length + "/" + got.deferred.length + " runs:  blocking " + x + "ms   deferred " + y + "ms   -> " +
      (x > y ? (x - y) + "ms sooner" : (y - x) + "ms LATER"));
    console.log("   " + " ".repeat(25) + "blocking [" + got.blocking.join(", ") + "]");
    console.log("   " + " ".repeat(25) + "deferred [" + got.deferred.join(", ") + "]");
  }
  await b.close();
})();
