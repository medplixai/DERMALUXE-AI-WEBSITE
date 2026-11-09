// The academy board's "Vaddannaru" card says why the enquiry was closed, by
// whom and when (desk PDF, 9 Nov 2026, point 8) — read from the lead book's
// own outcome, never typed again.
const crypto = require("crypto");
const h = require("./harness.js");
const academy = h.load("academy");
// The academy endpoint reads the staff token itself before asking staff.js,
// so the call carries a properly signed one.
const mk = (o) => { const p = Buffer.from(JSON.stringify(o)).toString("base64url");
  return p + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(p).digest("hex"); };
const OWNER = mk({ p: "9010427777", n: "Owner", r: "owner", e: 0, exp: Date.now() + 86400000 });
const A = (q, b) => h.call(academy, q, b, { headers: { authorization: "Bearer " + OWNER } });
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("ACADEMY BOARD — why an enquiry was closed\n");
  const now = Date.now(), DAY = 86400000;
  h.run(["DEL", "dl_leads"]);
  h.run(["HSET", "staff:users", "9876500052", JSON.stringify({ name: "Sowmya", role: "manager" })]);
  const k1 = `${now - 43 * DAY}|9876500061`, k2 = `${now - 5 * DAY}|9876500062`;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: now - 43 * DAY, type: "whatsapp", name: "Kavya", phone: "9876500061", concern: "Academy course enquiry – course TBD" })]);
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: now - 5 * DAY, type: "whatsapp", name: "Divya", phone: "9876500062", concern: "Academy course enquiry – Skin" })]);
  h.run(["HSET", "dl_status", k1, "closed"]);
  h.run(["HSET", "dl_outcome", k1, "notinterested"]);
  h.run(["HSET", "dl_status_by", k1, "9876500052"]);
  h.run(["HSET", "dl_status_ts", k1, String(now - 40 * DAY)]);
  h.run(["HSET", "dl_notes", k1, JSON.stringify([{ ts: now - 40 * DAY, by: "Sowmya", text: "Call — interest ledu" }])]);

  const f = await A({ a: "funnel" });
  is(f.code, 200, "the board loads");
  const kavya = (f.body.rows || []).find((r) => r.phone === "9876500061") || {};
  is([kavya.stage, kavya.outcome, kavya.closedBy, kavya.closedAt > 0], ["lost", "notinterested", "Sowmya", true],
    "a closed enquiry carries the reason (not interested), the colleague's name — not her number — and when");
  const divya = (f.body.rows || []).find((r) => r.phone === "9876500062") || {};
  is([divya.stage, divya.outcome, divya.closedBy, divya.closedAt], ["enquiry", "", "", 0], "an open enquiry carries none of that");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe board explains itself");
  process.exit(fails ? 1 : 0);
})();
