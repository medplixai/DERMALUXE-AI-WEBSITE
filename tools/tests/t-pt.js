const h = require("./harness.js");
const patient = h.load("patient"), money = h.load("money"), pkg = h.load("package");
const PT = (q, b) => h.call(patient, q, b);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("PATIENT FILE — what the clinic knows about one person\n");
  const ph = "9876500041";
  // two enquiries from the same number, months apart
  const leads = [
    { ts: Date.now() - 200 * 86400000, name: "Latha Devi", phone: ph, message: "acne", status: "visited", key: "k1", source: "whatsapp" },
    { ts: Date.now() - 20 * 86400000, name: "Latha Devi", phone: ph, message: "hair fall", status: "booked", key: "k2", source: "instagram" },
  ];
  for (const l of leads) h.run(["RPUSH", "dl_leads", JSON.stringify(l)]);

  const g = await PT({ a: "get", phone: ph });
  is(g.code, 200, "the file opens");
  is(g.body.patient.name, "Latha Devi", "name comes from the enquiry");
  is(g.body.patient.counts.visits >= 2, true, "both enquiries are in the file");

  const l = await PT({ a: "list" });
  is(l.body.total, 1, "one patient");
  is(l.body.repeats, 1, "and she counts as somebody who came back");

  // notes
  await PT({ a: "note" }, { a: "note", phone: ph, text: "Allergic to lidocaine" });
  const g2 = await PT({ a: "get", phone: ph });
  is(g2.body.patient.notes[0].text, "Allergic to lidocaine", "a note is kept");
  is(g2.body.patient.notes[0].by, "Owner", "with who wrote it");

  // details
  await PT({ a: "save" }, { a: "save", phone: ph, allergies: "Lidocaine", dob: "1994-03-02" });
  const g3 = await PT({ a: "get", phone: ph });
  is(g3.body.patient.allergies, "Lidocaine", "allergies are saved where they will be seen");

  // money and packages show up in the file
  await h.call(money, { a: "bill" }, { a: "bill", phone: ph, name: "Latha Devi", items: [{ name: "PRP", price: 6000 }], paid: 2000 });
  await h.call(pkg, { a: "create" }, { a: "create", phone: ph, name: "Latha Devi", treatment: "PRP", total: 4 });
  const bills = await h.call(money, { a: "of", phone: ph });
  is(bills.body.due, 4000, "her balance is in the file");
  const pk = await h.call(pkg, { a: "of", phone: ph });
  is(pk.body.rows.length, 1, "her package is in the file");

  // a number nobody knows
  const unknown = await PT({ a: "get", phone: "9999999999" });
  console.log(`  ·   opening a file for a number with no history → ${unknown.code}`);
  const badph = await PT({ a: "get", phone: "123" });
  is(badph.code, 400, "a bad number is refused");

  h.as(["leads.view"]);
  const view = await PT({ a: "get", phone: ph });
  is(view.code, 200, "somebody who can see leads can see the file");
  h.as(["appts.view"]);
  const noLeads = await PT({ a: "get", phone: ph });
  is(noLeads.code, 403, "somebody who cannot see leads cannot see the file");
  h.as(["*"]);
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe patient file behaves");
})();
