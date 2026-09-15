const h = require("./harness.js");
const stock = h.load("stock");
const K = (q, b) => h.call(stock, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("STOCK — counting a shelf\n");
  const a = await K({ a: "add" }, { a: "add", name: "PRP kits", unit: "kit", qty: 6, low: 3 });
  const id = a.body.item.id;
  is(a.body.item.qty, 6, "six kits on the shelf");

  await K({ a: "move" }, { a: "move", id, change: -1, reason: "vaadaam" });
  await K({ a: "move" }, { a: "move", id, change: -1 });
  let l = await K({ a: "list" });
  is(l.body.rows[0].qty, 4, "two used → four left");
  is(l.body.rows[0].isLow, false, "four is above the line of three");

  const warn = await K({ a: "move" }, { a: "move", id, change: -1 });
  is(warn.body.item.qty, 3, "one more → three");
  is(warn.body.item.isLow, true, "three touches the line, so it counts as low");
  is(warn.body.warned, true, "somebody is told the first time");
  const again = await K({ a: "move" }, { a: "move", id, change: -0.5 });
  is(again.body.warned, false, "and not told again the same day");

  const tooMany = await K({ a: "move" }, { a: "move", id, change: -99 });
  is(tooMany.code, 400, "cannot use more than is there");
  is(/2\.5/.test(tooMany.body.error || ""), true, "and it says how many there actually are");

  const half = await K({ a: "move" }, { a: "move", id, change: 0.5 });
  is(half.body.item.qty, 3, "half units add up properly (2.5 + 0.5)");

  // a shelf count that disagrees
  const c = await K({ a: "count" }, { a: "count", id, qty: 10 });
  is(c.body.item.qty, 10, "a physical count wins over the running number");
  const log = (await K({ a: "list" })).body.log;
  const counted = log.find((x) => x.reason === "lekka chesam");
  is(counted && counted.change, 7, "and the difference is written down (+7)");
  is(counted && counted.by, "Owner", "with who counted it");

  // low line of zero means never warn
  const b2 = await K({ a: "add" }, { a: "add", name: "Cotton", unit: "pack", qty: 0, low: 0 });
  is(b2.body.item.qty, 0, "an item can start at zero");
  const l2 = await K({ a: "list" });
  const cotton = l2.body.rows.find((r) => r.name === "Cotton");
  is(cotton.isLow, false, "with no line set, zero is not a warning");

  // low items come first
  is(l2.body.rows[0].isLow, false, "nothing is low right now, so plain alphabetical");

  // edit + remove
  await K({ a: "edit" }, { a: "edit", id, low: 12 });
  const l3 = await K({ a: "list" });
  is(l3.body.rows[0].name, "PRP kits", "now low, so it sorts to the top");
  is(l3.body.lowCount, 1, "one item needs ordering");

  await K({ a: "remove" }, { a: "remove", id });
  const l4 = await K({ a: "list" });
  is(l4.body.rows.some((r) => r.name === "PRP kits"), false, "removed item is gone from the list");
  is(l4.body.rows.length, 1, "and nothing else went with it");

  // permissions
  h.as(["stock.view"]);
  const ro = await K({ a: "add" }, { a: "add", name: "X", qty: 1 });
  is(ro.code, 403, "somebody who can only look cannot change the count");
  const see = await K({ a: "list" });
  is(see.code, 200, "but can still see the shelf");
  is(see.body.canEdit, false, "and the app is told not to draw the buttons");
  h.as(["*"]);
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nstock behaves");
})();
