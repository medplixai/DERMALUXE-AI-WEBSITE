// The hour-by-hour nags to the desk, and the rule that replaced the timer.
//
// The owner's diagnosis of 9 Nov 2026: the agent books, the team does not
// ring (1 confirm call out of 5); a new lead waits 39 hours for a first
// touch; 28 of 33 "done" appointments were closed by a three-hour timer and
// nobody knows who came. So: a slot nobody marks is "unmarked" after two days
// and never a visit; the desk is nagged once an hour about confirm calls and
// untouched leads — once per row, once per lead, inside working hours; and an
// Instagram chat that stopped without a number is asked for it once.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
stub("_admin.js", { fmtIst: (ms) => new Date(ms + 19800000).toISOString().slice(11, 16), promoParams: (tpl, name, text) => [name, text], publishNow: async () => ({ ok: true }) });
// Pushes are switched off in the harness; here they are the point.
const pushStub = require(path.join(API, "_push.js"));
pushStub.enabled = () => true;
pushStub.notifyCap = async (cfg, cap, m) => { h.sent.push(["push", cap, m]); return { ok: true, sent: 1 }; };
const pushes = (kind) => h.sent.filter((s) => s[0] === "push" && s[2] && s[2].data && s[2].data.kind === kind);
const team = () => h.sent.filter((s) => s[0] === "wa" && s[1] === "9989325777");
const to = (ph) => h.sent.filter((s) => (s[0] === "wa" || s[0] === "tpl") && s[1] === ph);
// Instagram sends go to Meta's graph; everything else the jobs fetch is nobody's business here.
const dms = [];
global.fetch = async (url, opt) => {
  if (String(url).includes("/me/messages")) { const b = JSON.parse(opt.body); dms.push({ to: b.recipient.id, text: (b.message || {}).text || "" }); return { ok: true, json: async () => ({}) }; }
  return { ok: true, status: 200, json: async () => 0, text: async () => "" };
};
process.env.LEAD_NOTIFY_PHONES = "9989325777";
process.env.IG_PAGE_TOKEN = "page";

// The Eluru wall clock → the Date.now the jobs read. Today's date, a chosen hour.
const realNow = Date.now;
const istMidnight = (ms) => { const d = new Date(ms + 19800000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 19800000; };
const day0 = istMidnight(realNow());
const at = (hh, mm) => { const t = day0 + (hh * 60 + (mm || 0)) * 60000; Date.now = () => t; return t; };
const HOUR = 3600000, MIN = 60000;

const followup = h.load("cron-followup");
const digest = require(path.join(API, "_digest.js"));
const ig = require(path.join(API, "instagram.js"));
const cfg = { kind: "pg" };
const run = (mod) => h.call(mod, { key: "local-admin" });
const q = () => h.run(["LRANGE", "appt:q", "0", "-1"]).map((x) => JSON.parse(x));
const done = () => h.run(["LRANGE", "appt:done", "0", "-1"]).map((x) => JSON.parse(x));
const lead = (o) => h.run(["RPUSH", "dl_leads", JSON.stringify(Object.assign({ type: "whatsapp", heat: "warm", concern: "Acne" }, o))]);

(async () => {
  console.log("THE DESK'S HOURLY NAGS, AND THE SLOT NOBODY MARKED\n");

  console.log("  — the morning report files a slot only after two days, as 'unmarked' —");
  let now = at(9, 0);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500801", name: "Two Days Ago", at: now - 49 * HOUR })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500802", name: "Yesterday Evening", at: now - 14 * HOUR })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500803", name: "Marked Missed", at: now - 50 * HOUR, status: "noshow", ns: 1 })]);
  await digest.buildDigest(cfg, true);
  const filed = done().find((a) => a.ph === "9876500801");
  is([!!filed, filed && filed.status, filed && filed.doneAt > 0], [true, "unmarked", true], "a slot two days past with nobody saying who came is filed as 'unmarked'");
  is(q().some((a) => a.ph === "9876500802"), true, "yesterday evening's is still on the list — three hours used to be enough to file it as a visit");
  is((done().find((a) => a.ph === "9876500803") || {}).status, "noshow", "one already marked missed is filed as it was marked");

  console.log("\n  — confirm calls: once an hour, once per slot, working hours only —");
  h.run(["DEL", "appt:q"]); h.sent.length = 0;
  now = at(14, 0);
  const tomorrow = now + 20 * HOUR;
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500811", name: "Anu Latha", at: tomorrow, ts: now - 60 * MIN })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500812", name: "Bhanu", at: tomorrow, ts: now - 60 * MIN, cf: true, cfAt: now - 10 * MIN })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500813", name: "Chandra", at: tomorrow, ts: now - 10 * MIN })]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500814", name: "Devi", at: now - 2 * HOUR, ts: now - 5 * HOUR })]);
  const f1 = await run(followup);
  is(f1.body.confirmNags, 1, "one slot is waiting for its confirm call");
  const cp = pushes("confirm");
  is([cp.length, cp[0] && cp[0][1], cp[0] && cp[0][2].tab, cp[0] && cp[0][2].urgent], [1, "appts.edit", "appts", true], "ONE urgent push to the people who can edit appointments, on the Appts tab");
  is(/1 slot confirm call pending — Anu/.test(cp[0] ? cp[0][2].title : ""), true, "naming the patient: " + (cp[0] ? cp[0][2].title : ""));
  const txt = (team()[0] || [])[2] || "";
  is([team().length, /Anu Latha · \d\d:\d\d · 9876500811/.test(txt)], [1, true], "one team WhatsApp, with name · time · phone");
  is([/Bhanu/.test(txt), /Chandra/.test(txt), /Devi/.test(txt)], [false, false, false], "not the one already confirmed, the one booked ten minutes ago, or the one whose time has passed");
  is(q().find((a) => a.ph === "9876500811").cfn, 1, "the row remembers it has been nagged");
  h.sent.length = 0;
  const f2 = await run(followup);
  is([f2.body.confirmNags, pushes("confirm").length, team().length], [0, 0, 0], "the next hour, nothing — one nag per slot, the rest is on the Appts screen");
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500815", name: "Night Owl", at: tomorrow, ts: now - 60 * MIN })]);
  now = at(23, 0);
  const f3 = await run(followup);
  is([f3.body.confirmNags, team().length], [0, 0], "and at 11 PM nobody's phone buzzes");
  now = at(14, 0);

  console.log("\n  — a new lead nobody has touched in an hour —");
  h.run(["DEL", "dl_leads"]); h.run(["DEL", "appt:q"]); h.sent.length = 0;
  lead({ ts: now - 2 * HOUR, name: "Esha", phone: "9876500821" });                                     // untouched
  lead({ ts: now - 2 * HOUR, name: "Farhan", phone: "9876500822", type: "job" });                      // a job seeker
  lead({ ts: now - 2 * HOUR, name: "Gowri", phone: "9876500823", concern: "Academy course enquiry" }); // the academy's own ladder
  lead({ ts: now - 2 * HOUR, name: "Hema", phone: "9876500824" });                                     // the desk already called
  lead({ ts: now - 30 * MIN, name: "Indira", phone: "9876500825" });                                   // half an hour — not yet
  lead({ ts: now - 30 * HOUR, name: "Jaya", phone: "9876500826" });                                    // yesterday — the daily ladder's
  lead({ ts: now - 2 * HOUR, name: "Kiran", phone: "", type: "instagram", src_id: "ig-k" });            // no number to ring
  lead({ ts: now - 2 * HOUR, name: "Lata", phone: "9876500828" });                                     // said STOP
  lead({ ts: now - 2 * HOUR, name: "Meena", phone: "9876500829" });                                    // the agent already holds a slot
  lead({ ts: now - 2 * HOUR, name: "Nalini", phone: "9876500830" });                                   // the desk wrote a note, left it "new"
  h.run(["HSET", "dl_status", `${now - 2 * HOUR}|9876500824`, "contacted"]);
  h.run(["SADD", "optout", "9876500828"]);
  h.run(["RPUSH", "appt:q", JSON.stringify({ ph: "9876500829", name: "Meena", at: now + 20 * HOUR, ts: now - 2 * HOUR, by: "AI agent", cf: true, cfAt: now - HOUR })]);
  h.run(["HSET", "dl_notes", `${now - 2 * HOUR}|9876500830`, JSON.stringify([{ ts: now - HOUR, by: "hemasri", text: "Call chesanu, repu malli" }])]);
  const s1 = await run(followup);
  is(s1.body.slaNags, 1, "one lead has waited an hour with no call");
  const sp = pushes("sla");
  is([sp.length, sp[0] && sp[0][1], sp[0] && sp[0][2].tab, sp[0] && sp[0][2].urgent], [1, "leads.edit", "leads", true], "ONE urgent push to the people who work leads, on the Leads tab");
  is(/1 lead ki 1 ganta daatina call ledu — Esha/.test(sp[0] ? sp[0][2].title : ""), true, "naming her: " + (sp[0] ? sp[0][2].title : ""));
  const st = (team()[0] || [])[2] || "";
  is([team().length, /Esha/.test(st), /9876500821/.test(st)], [1, true, true], "one team WhatsApp with her name and number");
  is(["Farhan", "Gowri", "Hema", "Indira", "Jaya", "Kiran", "Lata", "Meena", "Nalini"].filter((n) => new RegExp(n).test(st)), [],
    "not a job seeker, an academy enquiry, one the desk called, one half an hour old, yesterday's, one with no number, one who said STOP, one the agent already slotted, or one the desk wrote a note on");
  h.sent.length = 0;
  const s2 = await run(followup);
  is([s2.body.slaNags, pushes("sla").length], [0, 0], "the next hour she is not named again — the Leads screen carries the red badge from here");

  console.log("\n  — the Instagram chat that stopped without a number —");
  h.run(["DEL", "dl_leads"]); dms.length = 0;
  lead({ ts: now - 3 * HOUR, name: "@quiet_one", phone: "", type: "instagram", src_id: "ig-q1", concern: "Pimples" });
  lead({ ts: now - 3 * HOUR, name: "Gave Number", phone: "9876500831", type: "instagram", src_id: "ig-q2" });
  lead({ ts: now - 3 * HOUR, name: "Messenger Person", phone: "", type: "messenger", src_id: "fb-q1" });
  lead({ ts: now - 1 * HOUR, name: "@still_chatting", phone: "", type: "instagram", src_id: "ig-q3" });
  lead({ ts: now - 22 * HOUR, name: "@window_shut", phone: "", type: "instagram", src_id: "ig-q4" });
  lead({ ts: now - 3 * HOUR, name: "@desk_has_it", phone: "", type: "instagram", src_id: "ig-q5" });
  h.run(["HSET", "dl_status", `${now - 3 * HOUR}|ig-q5`, "contacted"]);
  const n1 = await ig.nudgeQuiet(cfg, 10);
  is([n1.sent, dms.map((d) => d.to).sort()], [2, ["fb-q1", "ig-q1"]], "the Instagram chat and the Messenger chat that stopped without a number are each asked for it");
  is([/wa\.me\/919959134666/.test(dms[0].text), /number/.test(dms[0].text), /WhatsApp లో/.test(dms[0].text)], [true, true, true], "with the WhatsApp link, in Tenglish with the Telugu line");
  is(["ig-q2", "ig-q3", "ig-q4", "ig-q5"].filter((id) => dms.some((d) => d.to === id)), [],
    "not one who gave a number, one still chatting an hour ago, one whose 24-hour window is nearly shut, or one the desk is handling");
  dms.length = 0;
  const n2 = await ig.nudgeQuiet(cfg, 10);
  is([n2.sent, dms.length], [0, 0], "and never twice");
  const f4 = await run(followup);
  is(f4.body.igNudge && typeof f4.body.igNudge.sent === "number", true, "the hourly job runs it and reports the count: " + JSON.stringify(f4.body.igNudge));
  h.run(["DEL", `ntf:ignudge:ig-q1`]); h.run(["DEL", `ntf:ignudge:fb-q1`]); dms.length = 0;
  now = at(2, 0);
  const f5 = await run(followup);
  is([f5.body.igNudge && f5.body.igNudge.night, dms.length], [true, 0], "at 2 AM no DM leaves the clinic — the nudge waits for working hours");
  now = at(14, 0);

  console.log("\n  — a slot nobody marked gets no 'how was it?' —");
  h.run(["DEL", "appt:done"]); h.sent.length = 0;
  now = at(10, 45);
  h.run(["RPUSH", "appt:done", JSON.stringify({ ph: "9876500841", name: "Came Meena", at: now - 2 * 86400000, status: "done", doneAt: now - 2 * 86400000 })]);
  h.run(["RPUSH", "appt:done", JSON.stringify({ ph: "9876500842", name: "Unknown Nila", at: now - 2 * 86400000, status: "unmarked", doneAt: now - 10 * HOUR })]);
  h.run(["RPUSH", "appt:done", JSON.stringify({ ph: "9876500843", name: "Unknown Omi", at: now - 20 * HOUR, status: "unmarked", doneAt: now - HOUR })]);
  await run(followup);
  is(to("9876500841").map((s) => s[2]), ["visit_rating"], "a patient marked as having come is asked how it went");
  is([to("9876500842").length, to("9876500843").length], [0, 0], "one nobody marked is not — we do not know they came — on day 2 or the morning after");
  is(done().find((a) => a.ph === "9876500842").rv, undefined, "and the row is left untouched for the day somebody does mark it");

  // and the memory the agent reads never calls an unmarked row a visit
  const mem = require(path.join(API, "_memory.js"));
  const f = await mem.facts(cfg, "9876500842");
  is(f ? f.came : 0, 0, "the agent's memory does not count an unmarked slot as a visit");

  Date.now = realNow;
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe desk is nagged, and nobody is counted who was not seen");
  process.exit(fails ? 1 : 0);
})();
