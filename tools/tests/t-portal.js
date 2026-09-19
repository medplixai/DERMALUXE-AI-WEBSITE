// The patient's own page. What matters: only the patient's own things come
// back; a code goes only to numbers the clinic knows, and the page answers
// the same either way so it cannot be used to find out who is a patient;
// five wrong codes end the code; a request to move or cancel reaches the
// desk as a lead and never changes the diary by itself.
const h = require("./harness.js");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.UPI_VPA = "dermaluxe@okaxis";
const path = require("path");
const n = require(path.join(process.env.DL_API, "_notify.js"));
let code = null;
n.sendWaAuthCode = async (ph, c) => { code = c; h.sent.push(["otp", ph, c]); return { ok: true }; };
const me = h.load("me"), money = h.load("money");
const SITE = (ip) => ({ headers: { origin: "https://www.dermaluxe.ai", "x-forwarded-for": ip || "3.3.3.3" } });
const PH = "9876501701", OTHER = "9876501702";

(async () => {
  console.log("THE PATIENT PORTAL\n");
  const future = Date.now() + 2 * 86400000;
  h.run(["LPUSH", "dl_leads", JSON.stringify({ ts: Date.now() - 86400000, name: "Sita Rani", phone: PH, type: "whatsapp" })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ id: "a1", ph: PH, name: "Sita", at: future, concern: "PICO 2" })]);
  h.run(["LPUSH", "appt:q", JSON.stringify({ id: "a2", ph: OTHER, name: "Ravi", at: future, concern: "PRP" })]);
  const bill = (await h.call(money, {}, { a: "bill", phone: PH, name: "Sita", items: [{ name: "PICO", price: 6000 }], paid: 2000, mode: "cash" })).body.bill;
  await h.call(money, {}, { a: "bill", phone: OTHER, name: "Ravi", items: [{ name: "PRP", price: 9000 }] });

  console.log("  — signing in —");
  h.sent.length = 0;
  const stranger = await h.call(me, {}, { a: "send", phone: "9876509999" }, SITE("4.4.4.1"));
  is([stranger.code, h.sent.length], [200, 0], "a number the clinic does not know gets no WhatsApp");
  const known = await h.call(me, {}, { a: "send", phone: PH }, SITE("4.4.4.2"));
  is([known.body.msg === stranger.body.msg, h.sent.length], [true, 1], "and the page says the same thing either way");
  is((await h.call(me, {}, { a: "send", phone: PH }, { headers: { origin: "https://evil.example" } })).code, 403, "only from our own site");
  let last = 0;
  for (let i = 0; i < 5; i++) last = (await h.call(me, {}, { a: "verify", phone: PH, code: code === "111111" ? "222222" : "111111" }, SITE("5.5.5." + i))).code;
  is((await h.call(me, {}, { a: "verify", phone: PH, code }, SITE("5.5.5.9"))).code, 429, "five wrong codes and the right one no longer works");
  await h.call(me, {}, { a: "send", phone: PH }, SITE("4.4.4.3"));
  const v = await h.call(me, {}, { a: "verify", phone: PH, code }, SITE("4.4.4.4"));
  is(v.code, 200, "a fresh code signs them in");
  const auth = { headers: { authorization: "Bearer " + v.body.token } };
  is((await h.call(me, {}, { a: "verify", phone: PH, code }, SITE("4.4.4.5"))).code, 401, "a code works once");

  console.log("\n  — what they see —");
  const home = (await h.call(me, { a: "home" }, null, auth)).body;
  is([home.name, home.upcoming.length, home.upcoming[0].concern], ["Sita", 1, "PICO 2"], "their own appointment, and not anybody else's");
  is([home.bills.length, home.due], [1, 4000], "their own bill and what is still owed");
  is(home.bills[0].pay.includes(`/pay.html?b=${bill.id}&t=`), true, "with a link to pay it");
  is(JSON.stringify(home).includes(OTHER), false, "the other patient's number is nowhere in it");
  const forged = Buffer.from(`pt.${OTHER}.${Date.now() + 86400000}.deadbeef`).toString("base64url");
  is((await h.call(me, { a: "home" }, null, { headers: { authorization: "Bearer " + forged } })).code, 401, "a token edited to another number is refused");

  console.log("\n  — what they can do —");
  await h.call(me, {}, { a: "confirm", at: future }, auth);
  is(JSON.parse(h.run(["LRANGE", "appt:q", "0", "-1"]).find((x) => JSON.parse(x).id === "a1")).cf, true, "they can confirm their appointment");
  is((await h.call(me, {}, { a: "confirm", at: future + 5 }, { headers: { authorization: "Bearer " + v.body.token } })).code, 200, "within the same minute");
  const before = h.run(["LRANGE", "appt:q", "0", "-1"]).length;
  const rq = await h.call(me, {}, { a: "request", kind: "reschedule", at: future, when: "Saturday evening", note: "office undi" }, auth);
  is(rq.code, 200, "asking to move it is taken");
  is(h.run(["LRANGE", "appt:q", "0", "-1"]).length, before, "but the diary is not touched");
  const lead = JSON.parse(h.run(["LRANGE", "dl_leads", "0", "0"])[0]);
  is([lead.type, lead.phone, /Appointment marchali/.test(lead.concern), /Saturday evening/.test(lead.concern)], ["portal", PH, true, true], "it reaches the desk as a lead saying what they asked for");
  is(h.sent.some((s) => s[0] === "lead"), true, "and the team is alerted");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe portal behaves");
  process.exit(fails ? 1 : 0);
})();
