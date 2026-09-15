// Word of mouth, from the desk's side.
process.env.REFERRAL_OFFER = "20% off next sitting";
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  const ref = h.load("referral");
  const R = (q, b) => h.call(ref, q, b);
  const LATHA = "9876500401", SITA = "9876500402", RAVI = "9876500403";

  console.log("REFERRAL — the desk's half\n");
  const mine = await R({ a: "of", phone: LATHA });
  is(mine.code, 200, "a patient's referral panel opens");
  is(/^DL\d{4}$/.test(mine.body.code), true, "with a code of their own: " + mine.body.code);
  is(mine.body.count, 0, "and nobody brought yet");
  is(mine.body.offer, "20% off next sitting", "the offer is shown, so messages can name it");

  const again = await R({ a: "of", phone: LATHA });
  is(again.body.code, mine.body.code, "the same person always gets the same code");

  // the friend walks in and the desk types the code
  const red = await R({ a: "redeem" }, { a: "redeem", phone: SITA, name: "Sita Rani", code: mine.body.code });
  is(red.code, 200, "the desk can enter a code for somebody who walked in");
  is(red.body.owner, LATHA, "and it lands on the right person");
  is(h.sent.some((x) => x[0] === "wa" && x[1] === LATHA), true, "who is told straight away");

  const now = await R({ a: "of", phone: LATHA });
  is(now.body.count, 1, "Latha has brought one");
  is(now.body.rows[0].name, "Sita Rani", "by name");
  is(now.body.unrewarded, 1, "and nobody has thanked her yet");

  const sitaSide = await R({ a: "of", phone: SITA });
  is(sitaSide.body.cameFrom, mine.body.code, "Sita's file says whose code she came on");

  // the things that must not happen
  is((await R({ a: "redeem" }, { a: "redeem", phone: SITA, name: "Sita", code: mine.body.code })).body.reason,
     "already", "the same patient cannot redeem twice");
  const own = await R({ a: "of", phone: SITA });
  is((await R({ a: "redeem" }, { a: "redeem", phone: RAVI, name: "Ravi", code: "DL9999" })).body.reason,
     "unknown", "an invented code is refused");
  const selfTry = await R({ a: "redeem" }, { a: "redeem", phone: SITA, name: "Sita", code: own.body.code });
  is(["self", "already"].indexOf(selfTry.body.reason) > -1, true, "and nobody can redeem their own");

  // the thank-you
  console.log("\n  — the part that was missing —");
  const rew = await R({ a: "reward" }, { a: "reward", owner: LATHA, brought: SITA, what: "20% off" });
  is(rew.code, 200, "the desk records that the thank-you was given");
  const after = await R({ a: "of", phone: LATHA });
  is(after.body.unrewarded, 0, "nothing is owed now");
  is(after.body.rows[0].rewarded.what, "20% off", "with what was given");
  is(after.body.rows[0].rewarded.by, "Owner", "and who gave it");
  await R({ a: "unreward" }, { a: "unreward", owner: LATHA, brought: SITA });
  is((await R({ a: "of", phone: LATHA })).body.unrewarded, 1, "and it can be undone if it was a mistake");

  // the board
  console.log("\n  — the board —");
  await R({ a: "redeem" }, { a: "redeem", phone: RAVI, name: "Ravi Kumar", code: mine.body.code });
  const board = await R({ a: "board" });
  is(board.code, 200, "the board opens");
  is(board.body.total, 2, "two people came through referrals");
  is(board.body.rows[0].phone, LATHA, "Latha is top");
  is(board.body.rows[0].n, 2, "with two");
  is(board.body.owed, 2, "and two thank-yous are owed");
  const older = await R({ a: "board", since: String(Date.now() + 60000) });
  is(older.body.total, 0, "a window that excludes them shows nothing");

  // who may do what
  console.log("\n  — permissions —");
  h.as(["leads.view"]);
  is((await R({ a: "of", phone: LATHA })).code, 200, "anybody who sees leads sees the panel");
  is((await R({ a: "reward" }, { a: "reward", owner: LATHA, brought: SITA })).code, 403, "but cannot record a thank-you");
  is((await R({ a: "redeem" }, { a: "redeem", phone: "9876500404", code: mine.body.code })).code, 403, "nor enter a code");
  is((await R({ a: "board" })).code, 403, "and the board needs reports");
  h.as(["appts.view"]);
  is((await R({ a: "of", phone: LATHA })).code, 403, "somebody with no lead access sees none of it");
  h.as(["*"]);

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nreferrals behave");
})();
