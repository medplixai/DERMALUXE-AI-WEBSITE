// Academy enquiries, chased.
//
// Somebody taps the academy ad, writes on WhatsApp, gets the course catalog
// PDF and one conversation. Then nothing — for ever. cron-followup takes an
// academy enquiry out of every ladder it has, with a comment saying they have
// their own follow-up. They did not. Fifteen people asked about a fifty
// thousand rupee course in one week, and the launch offer that was the whole
// reason to decide ran out without one of them being reminded it existed.
//
// So: their own follow-up, the one that comment was promising.
//
//   day 1  — did the catalog reach you, any doubts
//   day 3  — seats left, and the offer's own date while it still stands
//   day 7  — offer a phone call, and put it in front of the desk
//
// The rules are the ones the rest of this app already keeps: once per person
// per rung, a small cap per run, nothing to somebody who opted out, nothing to
// somebody already enrolled, and nothing at all outside civil hours in Eluru —
// a course this expensive is not sold by a message at four in the morning.
//
// KV: ntf:acadfu<rung>:<phone> (NX) · acad:fu:log
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const docs = require("./_docs.js");

// The ONE test for "this is an academy enquiry". cron-followup holds these out
// of its other ladders using this same function, so the two cannot drift —
// which is exactly how they came to be excluded from everything with nothing
// standing in the gap.
const isAcademyLead = (l) => /^\s*academy/i.test(String((l && l.concern) || ""));

const H = 3600000;
// Bands a day wide, so an hourly job that only sends in daylight still catches
// everybody exactly once.
const RUNGS = [
  { n: 1, minH: 20, maxH: 44, ttl: 30 * 86400, cap: 8 },
  { n: 3, minH: 68, maxH: 92, ttl: 30 * 86400, cap: 8 },
  { n: 7, minH: 164, maxH: 188, ttl: 60 * 86400, cap: 6, desk: true },
];
const FROM_HOUR = 9, TO_HOUR = 20;        // 9 AM – 8:59 PM IST
const istHourOf = (ms) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date(ms)));
const ten = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const first = (s) => String(s || "").trim().split(" ")[0] || "andi";

// What each rung says. The offer's date is only spoken while the offer is
// still standing: a message that sells a deadline which has already gone is
// worse than no message, and this one would have gone out on the 1st.
function line(rung, seatsLeft, now) {
  const offerLive = (now || Date.now()) < docs.BATCH.offerEndMs;
  const offer = offerLive ? ` Launch offer ₹49,999 (regular ₹1,00,000) ${docs.BATCH.offerEnd} varaku.` : "";
  const seats = seatsLeft > 0 ? `Inka ${seatsLeft} seat${seatsLeft === 1 ? "" : "lu"} migilayi.` : "Seats dadapu nindipoయాyi.";
  if (rung === 1) {
    return `DermaLuxe Academy catalog pampam — chusara? 😊 Course, fees, batch gurinchi emaina doubt unte ikkade adagandi, nenu cheptanu.${offer}`;
  }
  if (rung === 3) {
    return `DermaLuxe Academy Batch ${docs.BATCH.no} — ${docs.BATCH.start} nunchi, ${docs.BATCH.venue}. ${seats}${offer} Seat reserve cheyalante *ACADEMY* ani reply cheyandi.`;
  }
  return `DermaLuxe Academy gurinchi meeru adigaru kada — phone lo 5 nimishalu maatladatama? Course ela untundi, placement ela untundi, mee prashnalu anni cheptam. Eppudu convenient ayithe cheppandi 🙏`;
}

// How many of the batch's seats are still open, from the one place that count
// lives. Never guessed: with no store the rungs that name it say nothing.
async function seatsLeft(cfg) {
  if (!cfg) return 0;
  const r = await guard.kvCommand(cfg, ["GET", "acad:booked"]).catch(() => ({}));
  const booked = Math.max(0, Math.min(docs.BATCH.seats, Number((r && r.result) || 0)));
  return Math.max(0, docs.BATCH.seats - booked);
}

// `opts.optout` and `opts.deskStatus` are the caller's own copies — cron-followup
// already reads both, and reading them again per lead is how the other ladders
// used to spend a whole set read on every candidate.
async function run(cfg, opts) {
  const o = opts || {};
  const res = { rung1: 0, rung3: 0, rung7: 0, looked: 0, desk: 0, skipped: "" };
  if (!cfg) return Object.assign(res, { skipped: "no kv" });
  const now = o.now || Date.now();
  const hour = istHourOf(now);
  if (!o.force && (hour < FROM_HOUR || hour > TO_HOUR)) return Object.assign(res, { skipped: "quiet hours" });

  const rows = await guard.kvCommand(cfg, ["LRANGE", "dl_leads", "0", "399"]).catch(() => ({}));
  const optout = o.optout || new Set();
  // Handed in by cron-followup, which has already read both. Called on its own
  // it reads them itself: a module that quietly skips the "has the desk closed
  // this one" check when nobody passes it is a module that writes to somebody
  // the desk has already finished with.
  const deskStatus = o.deskStatus
    || guard.hashOf(((await guard.kvCommand(cfg, ["HGETALL", "dl_status"]).catch(() => ({}))) || {}).result) || {};
  const left = await seatsLeft(cfg);
  // Once the batch has started there is nothing left to sell into it.
  if (now >= docs.BATCH.startMs) return Object.assign(res, { skipped: "batch started" });
  if (left <= 0) return Object.assign(res, { skipped: "no seats left" });

  const done = { 1: 0, 3: 0, 7: 0 };
  for (const raw of ((rows && rows.result) || [])) {
    let l; try { l = JSON.parse(raw); } catch (e) { continue; }
    if (!l || !l.ts || !isAcademyLead(l)) continue;
    const ph = ten(l.phone);
    if (ph.length !== 10) continue;
    res.looked++;
    if (optout.has(ph)) continue;
    // Already a student: they are inside, and this ladder is for getting in.
    const st = await guard.kvCommand(cfg, ["GET", `acad:ph:${ph}`]).catch(() => ({}));
    if (st && st.result) continue;
    const status = deskStatus[`${l.ts}|${ph}`];
    if (["booked", "visited", "closed"].includes(status)) continue;

    const age = now - l.ts;
    const rung = RUNGS.find((r) => age >= r.minH * H && age < r.maxH * H);
    if (!rung || done[rung.n] >= rung.cap) continue;

    const key = `ntf:acadfu${rung.n}:${ph}`;
    const nx = await guard.kvCommand(cfg, ["SET", key, "1", "NX", "EX", String(rung.ttl)]).catch(() => ({}));
    if (!nx || !nx.result) continue;

    const name = first(l.name);
    const body = line(rung.n, left, now);
    // Free inside the 24-hour window and it reads like a person; outside it,
    // the approved academy template carries the same words.
    let ok = await notify.sendWa(ph, `${name} garu 🙏 ${body}`).catch(() => false);
    let via = ok ? "message" : "";
    if (!ok) {
      const t = await notify.sendAcademyTemplate(ph, "academy_batch_update", [name, body.slice(0, 600)], undefined,
        `DermaLuxe Academy Batch ${docs.BATCH.no} — 'ACADEMY' ani reply cheyandi.`).catch(() => null);
      ok = !!(t && t.ok); via = (t && t.via) || "";
    }
    if (!ok) {
      // It did not land. Give the rung back rather than burning this person's
      // one message on something nobody saw.
      await guard.kvCommand(cfg, ["DEL", key]).catch(() => {});
      continue;
    }
    done[rung.n]++; res[`rung${rung.n}`]++;

    // Day 7 is the one a person should pick up. Tell the desk, once.
    if (rung.desk) {
      try {
        const push = require("./_push.js");
        if (push.enabled()) await push.notifyCap(cfg, "leads.edit", {
          title: `🎓 Academy enquiry — ${name || ph} ki call cheyyandi`,
          body: `7 rojula kritam adigaru, inka join avvaledu. Inka ${left} seats.`,
          tab: "leads", data: { kind: "academy", phone: ph },
        });
        res.desk++;
      } catch (e) { console.error("acadfu: desk push", e && e.message); }
    }
    await guard.kvCommand(cfg, ["LPUSH", "acad:fu:log", JSON.stringify({ ts: now, rung: rung.n, phone: ph, via })]).catch(() => {});
  }
  await guard.kvCommand(cfg, ["LTRIM", "acad:fu:log", "0", "99"]).catch(() => {});
  return res;
}

async function recent(cfg, n) {
  const r = await guard.kvCommand(cfg, ["LRANGE", "acad:fu:log", "0", String(Math.max(1, Math.min(100, n || 10)) - 1)]).catch(() => ({}));
  return ((r && r.result) || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
}

module.exports = { run, recent, isAcademyLead, line, seatsLeft, RUNGS, FROM_HOUR, TO_HOUR };
