// The staff dashboard shows pictures the clinic's own Meta account holds —
// campaign thumbnails, Instagram posts to promote, posters to pick from. The
// site-wide policy allows images from nowhere but ourselves, so every one of
// them was blocked and the strips came out empty with no error anybody saw.
const fs = require("fs");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const vj = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const cspOf = (src) => {
  const rule = (vj.headers || []).find((h) => h.source === src);
  const h = rule && (rule.headers || []).find((x) => x.key === "Content-Security-Policy");
  return h ? h.value : "";
};
const imgSrc = (csp) => ((csp.match(/img-src ([^;]+)/) || [, ""])[1] || "").trim();

(async () => {
  console.log("THE PAGES' OWN POLICY\n");
  const site = cspOf("/(.*)"), staff = cspOf("/staff.html");
  is(!!site, true, "the public site has a content policy");
  is(!!staff, true, "and the staff dashboard has its own, because it needs different things");

  console.log("\n  — pictures —");
  is(/cdninstagram|fbcdn/.test(imgSrc(site)), false, "the public site loads images from nobody but itself");
  is(/\*\.cdninstagram\.com/.test(imgSrc(staff)) && /\*\.fbcdn\.net/.test(imgSrc(staff)), true,
    "the dashboard may show what Meta holds — campaign thumbnails, posts to promote, posters to choose: " + imgSrc(staff));
  is(imgSrc(staff).split(/\s+/).includes("'self'"), true, "and its own, which is where the app's posters live");

  console.log("\n  — and nothing else loosened —");
  for (const k of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) {
    is(staff.includes(k), true, `${k} still holds on the dashboard`);
  }
  is(/script-src [^;]*https:/.test(staff), false, "no outside scripts on a page that can spend money");
  is(/connect-src 'self'/.test(staff), true, "and it talks to nobody but this site");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe policies behave");
  process.exit(fails ? 1 : 0);
})();
