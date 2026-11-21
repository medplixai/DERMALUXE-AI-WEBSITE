// The clinic's price list — one copy, read by the WhatsApp agent and by the
// public price page (price-list.html, built from this by
// tools/gen-price-list.js; tools/tests/wire-prices.js fails if they differ).
//
// From the owner's sheet "DERMA LUXE Ai Price list", 21 Nov 2026: "update
// dermaluxe price list for agent and web". Numbers are as the sheet gives
// them. Three things the sheet did not settle are left out until the owner
// says, rather than guessed:
//   - Laser hair reduction, Bikini, 8 sittings: the sheet says ₹30,000, the
//     same as 6 sittings, where every other area is 6 × the single price.
//   - Q Nd:YAG Full Face: the package column reads "1".
//   - The sheet's "5+1" / "6+2" are written here as 6 and 8 sittings, the
//     plain count — "+1" reads as a free sitting, an inducement NMC 10.1(iv)
//     names, and the price is the same either way.
//
// item: {name, price (one sitting / one procedure, ₹), packs: [{n, price}]}
// A package-only item has price 0. Combination packages carry `n` sittings.
const AS_OF = "2026-11-21";

const SECTIONS = [
  { key: "peels", title: "Chemical peels", te: "కెమికల్ పీల్స్", items: [
    { name: "Azelaic-M + Retises Forte peel", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "Azelaic-M peel", price: 5000, packs: [{ n: 4, price: 18000 }] },
    { name: "Back peel", price: 7500, packs: [{ n: 4, price: 28000 }] },
    { name: "BioRePeel / Green peel (face)", price: 7000, packs: [{ n: 4, price: 25000 }] },
    { name: "Black peel", price: 5000, packs: [{ n: 4, price: 18000 }] },
    { name: "Black peel + comedone extraction", price: 6500, packs: [] },
    { name: "Cosmelan (single sitting)", price: 50000, packs: [] },
    { name: "Full arms peel", price: 7500, packs: [{ n: 4, price: 28000 }] },
    { name: "Intimate area peel", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "Lip peel", price: 3500, packs: [] },
    { name: "Meline under-eye peel", price: 3500, packs: [{ n: 4, price: 12500 }] },
    { name: "Neck peel (NMF medium / yellow)", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "NMF light peel (face)", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "NMF medium peel (face)", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "TCA CROSS", price: 4000, packs: [{ n: 4, price: 14500 }] },
    { name: "Underarms peel", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "Yellow peel (face)", price: 6000, packs: [{ n: 4, price: 22000 }] },
  ] },
  { key: "surgery", title: "Dermatosurgery", te: "డెర్మటో సర్జరీ", items: [
    { name: "Biopsy (per session)", price: 2500, packs: [] },
    { name: "Comedone extraction", price: 1500, packs: [] },
    { name: "Compound nevus excision (per session)", price: 10000, packs: [] },
    { name: "Corn excision (per session)", price: 6000, packs: [] },
    { name: "Dermoid cyst excision (per session)", price: 7000, packs: [] },
    { name: "Ear lobuloplasty (per ear)", price: 6000, packs: [] },
    { name: "Electrolysis", price: 6000, packs: [] },
    { name: "Incision and drainage (I&D, per session)", price: 2000, packs: [] },
    { name: "Lipoma excision (single)", price: 6000, packs: [] },
    { name: "Mini punch grafting — vitiligo (per session)", price: 9000, packs: [] },
    { name: "Nail avulsion (per nail)", price: 6000, packs: [] },
    { name: "NCES — vitiligo (per session)", price: 15000, packs: [] },
    { name: "Needling & extirpation — molluscum (per session)", price: 3000, packs: [] },
    { name: "Platelet-rich fibrin — wounds (per session)", price: 3000, packs: [] },
    { name: "Podowart application", price: 500, packs: [] },
    { name: "PRF — under-eye (per session)", price: 3500, packs: [] },
    { name: "RF & electrocautery", price: 3000, packs: [] },
    { name: "Scar revision", price: 10000, packs: [] },
    { name: "Sebaceous cyst excision", price: 7000, packs: [] },
    { name: "Soaking & paring (per session)", price: 2000, packs: [] },
    { name: "Xanthelasma (single)", price: 6000, packs: [] },
  ] },
  { key: "hairface", title: "Hair & facial treatments", te: "జుట్టు & ఫేషియల్ ట్రీట్‌మెంట్స్", items: [
    { name: "ASCE hair exosomes (10 billion)", price: 20000, packs: [{ n: 5, price: 100000 }] },
    { name: "Carbon peel facial", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "Dutasteride mesotherapy", price: 6000, packs: [{ n: 5, price: 28000 }] },
    { name: "Dutexome mesotherapy", price: 7000, packs: [{ n: 5, price: 33000 }] },
    { name: "Elite medifacial", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "Exosomes GF", price: 6000, packs: [{ n: 8, price: 48000 }] },
    { name: "GFC (hair)", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "GFC + dutasteride", price: 6000, packs: [{ n: 5, price: 28000 }] },
    { name: "HydraFacial", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "Platelet-rich fibrin (hair)", price: 4000, packs: [{ n: 4, price: 14000 }] },
    { name: "Pumpkin medifacial", price: 6000, packs: [{ n: 4, price: 22000 }] },
    { name: "Vampire facial", price: 6000, packs: [{ n: 4, price: 22000 }] },
  ] },
  { key: "inject", title: "Injections", te: "ఇంజెక్షన్లు", items: [
    { name: "Acivir injection (per session)", price: 2500, packs: [] },
    { name: "Bleomycin injection (per session)", price: 2500, packs: [] },
    { name: "Botox 20 units (crow's feet)", price: 20000, packs: [] },
    { name: "Botox 50 units", price: 35000, packs: [] },
    { name: "Glutathione IV drip", price: 6000, packs: [{ n: 8, price: 45000 }] },
    { name: "Intralesional steroid (ILS), 1 vial", price: 1500, packs: [] },
    { name: "Intralesional steroid (ILS), 2 vials", price: 3000, packs: [] },
    { name: "ILS + 5-FU", price: 2000, packs: [] },
    { name: "Inj. Avil", price: 150, packs: [] },
    { name: "Inj. Avil + Hydrocort", price: 300, packs: [] },
    { name: "Inj. Benzathine penicillin (per session)", price: 1500, packs: [] },
    { name: "Inj. Histaglobulin", price: 1000, packs: [] },
    { name: "Inj. Hydrocort / Dexa", price: 150, packs: [] },
    { name: "Inj. Methotrexate", price: 750, packs: [] },
    { name: "Lipolysis injection — double chin (per session)", price: 4500, packs: [] },
    { name: "Lipolysis injection — multiple lipomas (1 vial)", price: 7000, packs: [] },
    { name: "Mint skin booster (1 sitting)", price: 12000, packs: [] },
    { name: "MMR vaccine (per session)", price: 2500, packs: [] },
    { name: "Restylane skin booster (single session)", price: 50000, packs: [] },
  ] },
  { key: "lhr", title: "Laser hair reduction", te: "లేజర్ హెయిర్ రిడక్షన్", items: [
    { name: "Back (full)", price: 9000, packs: [{ n: 6, price: 45000 }, { n: 8, price: 54000 }] },
    { name: "Beard shaping", price: 3500, packs: [{ n: 6, price: 17500 }, { n: 8, price: 21000 }] },
    { name: "Bikini", price: 6000, packs: [{ n: 6, price: 30000 }] },
    { name: "Chin", price: 2500, packs: [{ n: 6, price: 12500 }, { n: 8, price: 15000 }] },
    { name: "Ear pinna", price: 3500, packs: [{ n: 6, price: 17500 }, { n: 8, price: 21000 }] },
    { name: "Full arms", price: 7000, packs: [{ n: 6, price: 35000 }, { n: 8, price: 42000 }] },
    { name: "Full body", price: 20000, packs: [{ n: 6, price: 100000 }, { n: 8, price: 120000 }] },
    { name: "Full legs", price: 8000, packs: [{ n: 6, price: 40000 }, { n: 8, price: 48000 }] },
    { name: "Lower face", price: 6000, packs: [{ n: 6, price: 30000 }, { n: 8, price: 36000 }] },
    { name: "Nipple area", price: 3500, packs: [{ n: 6, price: 17500 }, { n: 8, price: 21000 }] },
    { name: "Nose", price: 2500, packs: [{ n: 6, price: 12500 }, { n: 8, price: 15000 }] },
    { name: "Trunk (chest + abdomen)", price: 9000, packs: [{ n: 6, price: 45000 }, { n: 8, price: 54000 }] },
    { name: "Underarms", price: 6000, packs: [{ n: 6, price: 30000 }, { n: 8, price: 36000 }] },
    { name: "Upper lip", price: 2500, packs: [{ n: 6, price: 12500 }, { n: 8, price: 15000 }] },
    { name: "Upper lip + chin", price: 5000, packs: [{ n: 6, price: 25000 }, { n: 8, price: 30000 }] },
  ] },
  { key: "energy", title: "Lasers & energy devices", te: "లేజర్ & ఎనర్జీ డివైసెస్", items: [
    { name: "CO2 laser", price: 6000, packs: [{ n: 6, price: 34000 }] },
    { name: "HIFU (full face)", price: 15000, packs: [] },
    { name: "HIFU (lower face)", price: 10000, packs: [] },
    { name: "HIFU (per session)", price: 10000, packs: [] },
    { name: "Lip toning", price: 3500, packs: [{ n: 5, price: 16000 }] },
    { name: "Amyloidosis — arms / back / legs", price: 6000, packs: [{ n: 8, price: 45000 }] },
    { name: "MNRF + PRP", price: 6500, packs: [{ n: 6, price: 37000 }] },
    { name: "Q-switched Nd:YAG (face + neck)", price: 7000, packs: [] },
    { name: "Q-switched Nd:YAG (freckles)", price: 6000, packs: [] },
    { name: "Q-switched Nd:YAG (full face)", price: 6000, packs: [] },
    { name: "Q-switched Nd:YAG (neck)", price: 4000, packs: [] },
    { name: "Q-switched Nd:YAG (tattoo)", price: 6000, packs: [{ n: 6, price: 34000 }] },
    { name: "LPP package (face + neck + Nd:YAG)", price: 0, packs: [{ n: 8, price: 45000 }] },
  ] },
  { key: "packs", title: "Combination packages", te: "కాంబినేషన్ ప్యాకేజీలు", items: [
    { name: "Acne scar package 1 — 4 CO2 + 4 MNRF", price: 0, packs: [{ n: 8, price: 46000 }] },
    { name: "Acne scar package 2 — 2 TCA peels + 4 CO2 + 2 MNRF", price: 0, packs: [{ n: 8, price: 53000 }] },
    { name: "Acne scar package 3 — 3 TCA peels + 4 CO2 + 4 MNRF", price: 0, packs: [{ n: 11, price: 56000 }] },
    { name: "2 black peels + 1 Azelaic-M peel + 1 NMF light", price: 0, packs: [{ n: 4, price: 19000 }] },
    { name: "1 comedone extraction + 2 black peels + 1 Azelaic peel + 1 NMF light", price: 0, packs: [{ n: 5, price: 20500 }] },
    { name: "1 comedone extraction + 3 black peels + 1 yellow peel", price: 0, packs: [{ n: 5, price: 20500 }] },
    { name: "2 comedone extractions + 3 black peels", price: 0, packs: [{ n: 5, price: 17000 }] },
    { name: "2 NMF light + 1 NMF medium + 1 yellow peel", price: 0, packs: [{ n: 4, price: 22000 }] },
    { name: "2 NMF light + 2 yellow peels", price: 0, packs: [{ n: 4, price: 22000 }] },
    { name: "4 neck peels + 2 NMF medium + 2 yellow peels", price: 0, packs: [{ n: 8, price: 22000 }] },
    { name: "4 back peels + 2 NMF medium + 2 yellow peels", price: 0, packs: [{ n: 8, price: 28000 }] },
    { name: "4 full arms peels + 2 NMF medium + 2 yellow peels", price: 0, packs: [{ n: 8, price: 28000 }] },
    { name: "4 underarms peels + 2 NMF medium + 2 yellow peels", price: 0, packs: [{ n: 8, price: 22000 }] },
  ] },
];

const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN");
const sittings = (n) => `${n} sitting${n === 1 ? "" : "s"}`;

// Every amount on the list: what the agent's editor lets through.
function amounts() {
  const out = new Set();
  for (const s of SECTIONS) for (const i of s.items) { if (i.price) out.add(i.price); for (const p of i.packs) out.add(p.price); }
  return out;
}

// One line per item, for the agent's prompt and the judges.
function line(i) {
  const bits = [];
  if (i.price) bits.push(`${rupee(i.price)}/sitting`);
  for (const p of i.packs) bits.push(`${sittings(p.n)} ${rupee(p.price)}`);
  return `${i.name}: ${bits.join("; ")}`;
}
function text() {
  return SECTIONS.map((s) => `[${s.title}]\n` + s.items.map(line).join("\n")).join("\n");
}

// The cheapest single-sitting price among items whose name matches, for the
// WhatsApp treatments menu ("₹6,000+").
function fromFor(re) {
  let best = 0;
  for (const s of SECTIONS) for (const i of s.items) {
    if (!re.test(s.title + " · " + i.name) && !re.test(i.name)) continue;
    const v = i.price || (i.packs[0] && i.packs[0].price) || 0;
    if (v && (!best || v < best)) best = v;
  }
  return best;
}

module.exports = { AS_OF, SECTIONS, amounts, text, line, fromFor, rupee, sittings };
