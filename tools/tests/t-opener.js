// Two ways of saying hello, and which one people answer.
//
// The danger in an A/B test is not that it is wrong, it is that it looks
// right: a split that is not even, a person counted twice because they are
// chatty, a winner called off nine leads. Each of those produces a number
// the owner would act on.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const ab = h.load("_abtest");
const cfg = { kind: "pg" };
const A_TEXT = "Namaste 🙏 DermaLuxe nunchi — em problem tho ibbandi padutunnaru?";
const B_TEXT = "Namaste 🙏 Mee concern cheppandi, MD doctor tho free ga matladudduru.";

(async () => {
  console.log("AD OPENER TEST\n");

  console.log("  — setting it up —");
  is((await ab.load(cfg)).on, false, "off until the owner writes both lines");
  is((await ab.save(cfg, { on: true, a: { text: A_TEXT } }, "Owner")).error,
    "Rendu openers raayandi — okati lekapote compare cheyalemu",
    "one line is not a test, and saying so beats measuring half of one");
  const set = await ab.save(cfg, { on: true, a: { label: "Paata", text: A_TEXT }, b: { label: "Kotha", text: B_TEXT } }, "Owner");
  is([set.ok, set.opener.on], [true, true], "both lines and it runs");

  console.log("\n  — who gets which —");
  // A person must see the same opener every time or the test measures nothing.
  is(ab.side("9876500001"), ab.side("9876500001"), "the same number always lands on the same side");
  const spread = {};
  for (let i = 0; i < 600; i++) { const v = ab.side("98765" + String(10000 + i)); spread[v] = (spread[v] || 0) + 1; }
  is(Object.keys(spread).sort(), ["a", "b"], "both sides are used");
  is(Math.abs(spread.a - spread.b) < 90, true, `and roughly evenly: ${spread.a} / ${spread.b}`);

  console.log("\n  — what gets counted —");
  h.run(["DEL", "ab:a:leads"]); h.run(["DEL", "ab:b:leads"]);
  const ph = "9876512345", v = ab.side(ph);
  const line = await ab.opener(cfg, ph);
  is(line, v === "a" ? A_TEXT : B_TEXT, "a first message gets that person's own opener back");
  is(Number(h.run(["GET", `ab:${v}:leads`])), 1, "and is counted as one arrival");
  await ab.opener(cfg, ph);
  is(Number(h.run(["GET", `ab:${v}:leads`])), 1, "somebody who comes back is not a second arrival");

  is(await ab.note(cfg, ph, "reply"), true, "they write again — that is the opener's own doing");
  is(await ab.note(cfg, ph, "reply"), false, "a chatty patient is still one reply, not ten");
  is(Number(h.run(["GET", `ab:${v}:reply`])), 1, "so the count is people, not messages");
  is(await ab.note(cfg, "9999999999", "reply"), false, "and somebody who was never in the test counts for neither side");
  is(await ab.note(cfg, ph, "booked"), true, "a booking is counted too");

  console.log("\n  — calling a winner —");
  const seed = (side, leads, reply, booked) => {
    h.run(["SET", `ab:${side}:leads`, String(leads)]);
    h.run(["SET", `ab:${side}:reply`, String(reply)]);
    h.run(["SET", `ab:${side}:booked`, String(booked)]);
  };
  seed("a", 9, 5, 1); seed("b", 9, 2, 0);
  let st = await ab.stats(cfg);
  is([st.enough, st.lead], [false, ""], "nine leads a side is a coin toss, and it says so instead of crowning one");
  is(st.a.rate, 56, "the rate is still shown, because it is true — it is the verdict that waits");

  seed("a", 516, 268, 50); seed("b", 1825, 985, 228);
  st = await ab.stats(cfg);
  is([st.a.rate, st.b.rate], [52, 54], "52% against 54%");
  is([st.enough, st.lead, st.by_pts], [true, "b", 2], "with enough of both, the second one is ahead by 2 points");
  seed("b", 1825, 949, 228);
  is((await ab.stats(cfg)).lead, "", "and a dead heat crowns nobody");

  console.log("\n  — the agent's own first line —");
  h.run(["DEL", "ab:seen:leads:9876577777"]);
  process.env.WA_AGENT_ENABLED = "1";
  is(/^Namaste/.test(await ab.opener(cfg, "9876577777")), true, "the line the agent is told to open with is one of the two");
  await ab.save(cfg, { on: false }, "Owner");
  is(await ab.opener(cfg, "9876588888"), "", "switched off, the agent is told nothing and opens as it always did");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe opener test behaves");
  process.exit(fails ? 1 : 0);
})();
