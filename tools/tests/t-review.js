// Asking a happy patient for a Google review. The clinic has zero reviews and
// this whole machine was switched off by one unset environment variable.
delete process.env.REVIEW_LINK;
process.env.GOOGLE_PLACE_ID = "ChIJ-cpL25oVNjoR2mAIo7G_RF0";
const path = require("path");
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("THE REVIEW ASK\n");
  const reviews = require(path.join(process.env.DL_API, "reviews.js"));
  const cfg = { kind: "pg" };

  const fromId = await reviews.reviewLink(cfg);
  is(/writereview\?placeid=ChIJ/.test(fromId), true, "with no REVIEW_LINK it uses our own place id: " + fromId.slice(0, 58) + "…");

  // what Google itself handed back, once, is preferred over anything we build
  h.run(["SET", reviews.WRITE_KEY, "https://search.google.com/local/writereview?placeid=FROM-GOOGLE"]);
  is(/FROM-GOOGLE/.test(await reviews.reviewLink(cfg)), true, "the link Google gave us wins over one we assemble");

  // and the owner can still override everything
  process.env.REVIEW_LINK = "https://g.page/r/pinned/review";
  is(await reviews.reviewLink(cfg), "https://g.page/r/pinned/review", "REVIEW_LINK still wins if the owner pins one");
  delete process.env.REVIEW_LINK;

  // nothing configured at all: say nothing rather than send a broken link
  const savedId = process.env.GOOGLE_PLACE_ID;
  delete process.env.GOOGLE_PLACE_ID;
  h.run(["DEL", reviews.WRITE_KEY]);
  is(await reviews.reviewLink(cfg), "", "with nothing set it returns nothing, not a guess");
  process.env.GOOGLE_PLACE_ID = savedId;

  // the agent's own brief
  console.log("\n  — what the WhatsApp agent is told —");
  delete require.cache[path.join(process.env.DL_API, "_facts.js")];
  const facts = require(path.join(process.env.DL_API, "_facts.js"));
  const brief = facts.clinicFacts("WhatsApp", "");
  is(/writereview/.test(brief), true, "the agent is now given a review link to offer");
  is(/ALREADY VISITED/.test(brief), true, "and told to ask only somebody who actually came");

  delete process.env.GOOGLE_PLACE_ID;
  delete require.cache[path.join(process.env.DL_API, "_facts.js")];
  const bare = require(path.join(process.env.DL_API, "_facts.js")).clinicFacts("WhatsApp", "");
  is(/writereview/.test(bare), false, "with nothing configured it does not invent one");
  process.env.GOOGLE_PLACE_ID = savedId;

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe review ask behaves");
})();
