// Owner, 24 Nov 2026: "compulsory clinic ki vachela matladali". The main rules
// were changed first, but four other places still told the agent to put a
// video consultation first for a far patient — the goal line, the town hint,
// the trust buttons, and the reviewer, which marked asking a far patient to
// come in as a FAULT. A follow-up on 24 Nov offered "video consultation ki
// rendu slots" because of them. This reads what the agent is told.
const path = require("path");
const API = process.env.DL_API || path.resolve("api");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const fs = require("fs");
const read = (f) => fs.readFileSync(path.join(API, f), "utf8");

const all = ["_facts.js", "_goal.js", "_qualify.js", "_review.js", "_trust.js", "whatsapp.js", "chat.js"].map(read).join("\n");
is(/offer a VIDEO consultation first|Book a video consultation first|chasing clinic slots is a fault|video consult matrame|mention video consultation as an option|clinic visit vs video/i.test(all), false, "nothing tells the agent to put a video consultation before a visit");
is(/CLINIC VISIT IS COMPULSORY/.test(read("_facts.js")), true, "the agent is told the clinic visit is compulsory");
is(/Offering a video consultation to a patient who has NOT said plainly that they cannot come is a fault/.test(read("_review.js")), true, "the reviewer marks an unasked video offer down, not a visit");
is(/🎥 Video consult/.test(read("_trust.js")), false, "the trust buttons offer a slot and the location, not a video call");
is(/ONE planned visit/.test(read("_goal.js")), true, "a far patient's goal is one planned visit");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe agent asks everybody to come in");
process.exit(fails ? 1 : 0);
