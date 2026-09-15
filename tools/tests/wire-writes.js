const fs = require("fs");
// A write that stores the ONLY copy of something a person typed must not be
// fire-and-forget. Index updates alongside a checked write are fine.
const PRIMARY = /\["(SET|HSET)",\s*`?(cns:|bill:|exp:|stk:item|pt:|pkg:|att:|dl_leads|lead:|staff:user|acad:student)/;
let flagged = 0;
for (const f of fs.readdirSync("api").filter((x) => x.endsWith(".js"))) {
  const lines = fs.readFileSync("api/" + f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (!PRIMARY.test(l)) return;
    const checked = /kvWrite\(/.test(l);
    // "SET … NX" is a once-a-day marker, not a record: if it fails the work is
    // skipped, which is the safe direction.
    if (/"NX"/.test(l)) return;
    const silent = /\.catch\(\(\) => \{\}\)|\.catch\(\(\) => \(\{\}\)\)/.test(l);
    if (!checked && silent) { flagged++; console.log(`  ✗  ${f}:${i + 1}  ${l.trim().slice(0, 100)}`); }
  });
}
console.log(flagged ? `\n${flagged} write(s) that could fail without anyone knowing` : "every primary write is checked");
