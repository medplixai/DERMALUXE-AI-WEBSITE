// The file library behind the staff app's Files tab (owner, 9 Nov 2026):
// what is listed is really there, the paid material is never in the open
// folder, and a study-material link opens the PDF and then dies.
const fs = require("fs"), path = require("path");
const h = require("./harness.js");
const files = h.load("files");
const F = (q, b) => h.call(files, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const ROOT = path.join(process.env.DL_API, "..");

(async () => {
  console.log("FILES — the clinic's library\n");
  const l = await F({ a: "list" });
  is(l.code, 200, "the owner sees the library");
  is(l.body.groups.map((g) => g.key), ["forms", "posters", "videos", "photos"], "forms, posters, videos and photos");
  const items = l.body.groups.flatMap((g) => g.items);
  is(items.length > 30, true, `${items.length} files in it`);
  is(items.filter((it) => !fs.existsSync(path.join(ROOT, it.path))).map((it) => it.path), [], "every file the manifest names is really there to be served");
  is(items.every((it) => /^\/files\/[a-z]+\/[\w.-]+$/.test(it.path) && it.bytes > 0 && it.title && it.ext && it.kind), true, "each with a path under /files, a size, a title and a type");
  is(items.some((it) => /material/.test(it.path)), false, "the paid study material is never in the open folder");
  is([!!l.body.material, l.body.material.tracks.length, l.body.material.books.length, l.body.posters], [true, 2, 3, true], "the owner also gets the material index with the trainer books, and the Instagram posters");

  console.log("\n  — a study-material link —");
  const m = await F({ a: "mlink" }, { a: "mlink", track: "skin", day: 3 });
  is([m.code, /^\/api\/material\?track=skin&day=3&f=/.test(m.body.url)], [200, true], "a day's material comes as a short link, not a session token in a URL");
  const material = h.load("material");
  const qs = Object.fromEntries(new URL("http://x" + m.body.url).searchParams);
  const r = await h.call(material, qs);
  is([r.code, r.headers["Content-Type"]], [200, "application/pdf"], "and /api/material opens the PDF for it");
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60000;
  is((await h.call(material, qs)).code, 403, "sixteen minutes later the same link is dead");
  Date.now = realNow;
  is((await h.call(material, Object.assign({}, qs, { f: qs.f.slice(0, -2) + "zz" }))).code, 403, "a link with its signature altered is dead");
  is((await F({ a: "mlink" }, { a: "mlink", track: "skin", day: 31 })).code, 400, "day 31 does not exist");
  is((await F({ a: "mlink" }, { a: "mlink", track: "nails", day: 1 })).code, 400, "nor a nails track");
  const bk = await F({ a: "mlink" }, { a: "mlink", book: "full" });
  is([bk.code, (await h.call(material, Object.fromEntries(new URL("http://x" + bk.body.url).searchParams))).code], [200, 200], "the owner may open the whole book");

  console.log("\n  — who sees what —");
  h.as(["files.view", "academy.material"], { name: "Asha", phone: "9876500061", role: "trainer" });
  const l2 = await F({ a: "list" });
  is([l2.code, l2.body.groups.length, l2.body.material.books.length, l2.body.posters], [200, 4, 0, false], "a trainer sees the files and the day PDFs — no whole books, no Instagram posters");
  is((await F({ a: "mlink" }, { a: "mlink", book: "full" })).code, 403, "and cannot mint the whole book");
  h.as(["files.view"], { name: "Ravi", phone: "9876500062", role: "therapist" });
  const l3 = await F({ a: "list" });
  is([l3.code, l3.body.material, l3.body.posters], [200, null, false], "a therapist sees the files only");
  is((await F({ a: "mlink" }, { a: "mlink", track: "skin", day: 1 })).code, 403, "and no material link");
  h.as(["leads.view"], { name: "Guest", phone: "9876500063", role: "staff" });
  is((await F({ a: "list" })).code, 403, "without files.view there is nothing");
  h.as(["*"], { name: "Owner", phone: "9010427777", role: "owner" });
  is((await F({ a: "nope" })).code, 400, "an unknown action is refused");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe library behaves");
  process.exit(fails ? 1 : 0);
})();
