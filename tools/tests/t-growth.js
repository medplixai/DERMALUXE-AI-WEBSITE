// Where the leads come from, and which ad is bringing them.
//
// 13 November 2026: the clinic's own ad account had spent nothing for a
// month, half the leads still came from Instagram boosts paid for on a phone,
// and when one ran out ad leads fell from 14 a day to 3 with nothing on any
// screen saying so. These check the screen and the alert that would have.
delete process.env.META_ADS_TOKEN; delete process.env.IG_SYSTEM_TOKEN; delete process.env.IG_PAGE_TOKEN;
process.env.ADMIN_PHONES = "9010427777";
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const G = h.load("_growth");
const HOUR = 3600000, DAY = 86400000;
// 3 PM in Eluru on Friday 13 November 2026.
const NOW = Date.parse("2026-11-13T15:00:00+05:30");
const at = (d, hh) => Date.parse(`2026-11-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:15:00+05:30`);
let n = 0;
const lead = (ts, extra) => Object.assign({ ts, name: "P" + (++n), phone: "98765" + String(10000 + n), type: "whatsapp", concern: "hair fall" }, extra || {});

(async () => {
  console.log("MARKETING GROWTH\n");

  console.log("  — which door each lead came through —");
  const ours = new Set(["111"]);
  is(G.channelOf({ type: "job" }, ours), "job", "a job seeker is not a patient");
  is(G.channelOf({ type: "whatsapp", intent: "not_patient", ad_id: "999" }, ours), "job", "nor is somebody the agent marked not-a-patient, even off an ad");
  is(G.channelOf({ type: "whatsapp", ad_id: "111", ad_src: "ad" }, ours), "ours", "an ad from our own account");
  is(G.channelOf({ type: "whatsapp", ad_id: "999", ad_src: "ad" }, ours), "boost", "an ad our account does not have is an Instagram boost");
  is(G.channelOf({ type: "whatsapp", ad_id: "111", ad_src: "ad" }, null), "boost", "with no list from Meta, a paid ad cannot be called ours");
  is(G.channelOf({ type: "whatsapp", ad_id: "555", ad_src: "post" }, ours), "post", "an organic post's message button is not paid");
  is(G.channelOf({ type: "ig_comment" }, ours), "insta", "Instagram comments and DMs");
  is(G.channelOf({ type: "walkin" }, ours), "desk", "walk-ins");
  is(G.channelOf({ type: "whatsapp" }, ours), "organic", "everything else is WhatsApp / website");

  console.log("\n  — the chart —");
  const L = [];
  // A boost bringing 4 a day from the 7th to the 11th, then nothing.
  for (let d = 7; d <= 11; d++) for (let k = 0; k < 4; k++) L.push(lead(at(d, 10 + k), { ad_id: "B1", ad_src: "ad", ad_headline: "api.whatsapp.com", ad_body: "Hair fall? Eluru lo doctor", ad_url: "https://www.instagram.com/p/abc/", km: k === 3 ? 200 : 5 }));
  // Our own ad, every day including today.
  for (let d = 7; d <= 13; d++) L.push(lead(at(d, 11), { ad_id: "111", ad_src: "ad", ad_headline: "Laser hair reduction — Eluru", concern: "laser" }));
  // Two job seekers off the boost, and an organic lead just after midnight.
  L.push(lead(at(9, 12), { ad_id: "B1", ad_src: "ad", type: "job" }));
  L.push(lead(at(9, 13), { ad_id: "B1", ad_src: "ad", intent: "not_patient" }));
  L.push(lead(Date.parse("2026-11-12T00:30:00+05:30"), { concern: "acne" }));
  L.push(lead(at(10, 9), { type: "ig_comment", phone: "", concern: "All the best mam 🔥" }));
  L.push(lead(at(10, 9), { type: "ig_comment", concern: "Hair fall ki treatment undaa?" }));
  const st = {};
  const book = (l, s) => { st[`${l.ts}|${l.phone.slice(-10)}`] = s; };
  book(L[0], "visited"); book(L[1], "booked"); book(L[20], "booked");

  const F = G.flow(L, st, { now: NOW, days: 14, ours });
  is(F.length, 14, "fourteen days");
  is(F[F.length - 1].day, "2026-11-13", "ending today, Eluru's date");
  const d9 = F.find((r) => r.day === "2026-11-09");
  is([d9.boost, d9.ours, d9.job, d9.total], [4, 1, 2, 5], "the 9th: 4 from the boost, 1 ours, 2 job seekers drawn apart and not counted");
  is(F.find((r) => r.day === "2026-11-10").insta, 1, "a reel comment with no number (\"All the best\") is not a lead; one with a number is");
  is(F.find((r) => r.day === "2026-11-12").organic, 1, "a 12:30 AM chat belongs to that day in Eluru, not the day before in UTC");
  is(F.find((r) => r.day === "2026-11-07").booked, 3, "bookings counted on the day the lead came (2 off the boost, 1 off ours)");
  is(F.every((r) => r.spend === null), true, "no Meta account, no spend line — not a line of zeros");

  console.log("\n  — the leaderboard —");
  const A = G.adRows(L, st, { now: NOW, ours, paid: { B1: { rupees: 2000 } } });
  const b1 = A.find((r) => r.id === "B1"), o1 = A.find((r) => r.id === "111");
  is(b1.kind, "boost", "the boost is labelled a boost");
  is(b1.label, "Hair fall? Eluru lo doctor", "named by its own words, not by \"api.whatsapp.com\"");
  is(o1.label, "Laser hair reduction — Eluru", "a real headline is used as it is");
  is([b1.leads, b1.jobs, b1.booked, b1.came], [20, 2, 2, 1], "20 patient leads, 2 job seekers apart, 2 booked, 1 came");
  is([b1.perLead, b1.perBooked], [100, 1000], "₹2,000 paid → ₹100 a lead, ₹1,000 a booking");
  is(b1.state, "stopped", "nothing since the 11th → stopped");
  is(o1.state, "live", "our own ad brought somebody this morning → running");
  is([b1.towns, b1.local, b1.far], [20, 15, 5], "where they are: 15 near, 5 from far away");
  is(b1.link, "https://www.instagram.com/p/abc/", "and a link to the post itself");
  is(G.winner(A), "B1", "most bookings for the leads → the one to back next");

  console.log("\n  — going quiet —");
  const slow = [];
  for (let k = 0; k < 6; k++) slow.push(lead(NOW - 30 * HOUR - k * 3 * HOUR, { ad_id: "S1", ad_src: "ad" }));
  const s1 = G.adRows(slow, {}, { now: NOW })[0];
  is([s1.state, s1.sinceH], ["slow", 30], "busy until 30 hours ago and silent since → slowing");
  is(G.quietAds([s1]).map((x) => x.id), ["S1"], "and that is worth a word");
  const trickle = G.adRows([lead(NOW - 30 * HOUR, { ad_id: "T1", ad_src: "ad" })], {}, { now: NOW })[0];
  is(trickle.state, "live", "one lead a day and a quiet day is not a stopped ad");
  is(G.quietAds([Object.assign({}, s1, { kind: "post" })]).length, 0, "an organic post has nothing to switch back on — no alert");

  console.log("\n  — today against the week, at the same hour —");
  const D = [];
  for (let d = 6; d <= 12; d++) for (let k = 0; k < 6; k++) D.push(lead(at(d, 9 + k), { ad_id: "B2", ad_src: "ad" }));
  D.push(lead(at(13, 10), { ad_id: "B2", ad_src: "ad" }));
  const drop = G.dropToday(D, { now: NOW });
  is(drop && [drop.today, drop.avg, drop.pct], [1, 6, 83], "1 by 3 PM against 6 by 3 PM every other day → 83% down");
  is(G.dropToday(D, { now: Date.parse("2026-11-13T10:00:00+05:30") }), null, "at 10 AM it is too early to say");
  const fine = D.concat([2, 3, 4, 5].map((hh) => lead(at(13, 10 + hh), { ad_id: "B2", ad_src: "ad" })).filter((l) => l.ts <= NOW));
  is(G.dropToday(fine, { now: NOW }), null, "a normal day says nothing");

  console.log("\n  — when they write —");
  const R = G.rhythm(L);
  is(R.peak && R.peak.from, 10, "the busiest three hours start at 10 AM, Eluru time");
  is(R.hours.reduce((a, b) => a + b, 0), L.filter((l) => l.type !== "job" && l.intent !== "not_patient" && G.countable(l)).length, "job seekers and number-less comments are not in the rhythm");

  console.log("\n  — the screen —");
  h.run(["DEL", "dl_leads"]);
  for (const l of L) h.run(["RPUSH", "dl_leads", JSON.stringify(Object.assign({}, l, { ts: l.ts - NOW + Date.now() }))]);
  const ads = h.load("ads");
  const g = await h.call(ads, { a: "growth", days: "14" });
  is(g.code, 200, "opens without a Meta account at all");
  is(g.body.connected, false, "and says it is not connected");
  is(g.body.flow.length, 14, "the chart is there anyway");
  is(g.body.ads.map((r) => r.id).sort(), ["111", "B1"], "both ads on the leaderboard");
  is(g.body.mix.boost, 27, "with no Meta list, all 27 paid leads count as boosts — nothing can be called ours");

  console.log("\n  — what the boost cost, typed by the owner —");
  h.as(["reports.view"], { name: "Reception", phone: "9000000001", role: "reception" });
  const no = await h.call(ads, { a: "boostspend" }, { a: "boostspend", ad: "B1", rupees: 2000 });
  is(no.code, 403, "reception can look but not write money in");
  h.as(["*"], { name: "Owner", phone: "9010427777", role: "owner" });
  const bad = await h.call(ads, { a: "boostspend" }, { a: "boostspend", ad: "B1", rupees: -5 });
  is(bad.code, 400, "a negative amount is refused");
  const ok = await h.call(ads, { a: "boostspend" }, { a: "boostspend", ad: "B1", rupees: 2000, note: "7 days" });
  is([ok.code, ok.body.rupees], [200, 2000], "the owner saves ₹2,000");
  const g2 = await h.call(ads, { a: "growth", days: "14" });
  is(g2.body.ads.find((r) => r.id === "B1").perLead, 100, "and the leaderboard now says ₹100 a lead");
  is(/boost B1 kharchu ₹2,000/.test(h.run(["LRANGE", "staff:audit", "0", "0"])[0] || ""), true, "written into the audit");
  await h.call(ads, { a: "boostspend" }, { a: "boostspend", ad: "B1", rupees: 0 });
  const g3 = await h.call(ads, { a: "growth", days: "14" });
  is(g3.body.ads.find((r) => r.id === "B1").spent, null, "₹0 takes it off again");

  console.log("\n  — the alert —");
  const al = h.load("_adalert");
  const P = al.quietProblems(slow.concat(D), NOW);
  is(P.map((p) => p.kind).sort(), ["drop", "quiet"], "a quiet ad and a bad day, both");
  is(/30 gantalu ga ee ad nunchi okka lead kuda raaledu/.test(P.find((p) => p.kind === "quiet").text), true, "said plainly: " + P.find((p) => p.kind === "quiet").text.slice(0, 70) + "…");
  h.run(["DEL", "dl_leads"]);
  for (const l of slow) h.run(["RPUSH", "dl_leads", JSON.stringify(Object.assign({}, l, { ts: l.ts - NOW + Date.now() }))]);
  const before = h.sent.length;
  const r1 = await al.run({ kind: "pg" }, { force: true });
  is([r1.alerts, r1.skipped], [1, "not connected"], "it speaks even with no Meta account — then stops at the Meta part");
  is(h.sent.length - before, 1, "one WhatsApp to the owner");
  const r2 = await al.run({ kind: "pg" }, { force: true });
  is(r2.alerts, 0, "and not again on the next run");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nmarketing growth behaves");
  process.exit(fails ? 1 : 0);
})();
