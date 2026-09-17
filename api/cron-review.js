// GET /api/cron-review — Vercel Cron (daily 06:00 UTC = 11:30 IST).
//
// In Eluru, the first thing a stranger searching "skin doctor near me" sees
// is the star rating and the number beside it. The clinic has a 5.0, and a
// count small enough that every single review still moves it.
//
// The link to leave one has existed for a long time (_facts.reviewUrl, and
// the better one Google itself hands back in reviews.reviewLink). What has
// never existed is anybody sending it. A patient had to somehow think to ask
// the WhatsApp agent for it, or the owner had to type "review <number>" by
// hand — which on a clinic day does not happen. So a built thing has been
// sitting switched on, facing the wall, the same way referrals were.
//
// This asks the people who actually came and paid: bills touched two days
// ago that are fully settled. Two days because same-day is pushy and a week
// later they have moved on. Once per person per six months, however many
// times they come back.
//
// Two things it deliberately does NOT do, because both are against Google's
// policy and would put the 5.0 at risk: it does not ask for a *good* review,
// and it does not offer anything in return. It also never asks somebody who
// still owes money — being chased for a bill and asked for stars in the same
// week is how a clinic earns a one-star.
//
// Manual run: /api/cron-review?key=<ADMIN_KEY or CRON_SECRET>[&dry=1][&day=YYYY-MM-DD][&force=1]
//
// KV used here:
//   bill:day:<YYYY-MM-DD>  bill ids touched that day (written by /api/money)
//   rev:asked:<phone>      NX marker, 180 days — one ask per person
//   rev:log                what went out, newest first
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const money = require("./money.js");
const reviews = require("./reviews.js");

const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const ASKED_TTL = 180 * 86400;   // the same person is not asked twice in six months
const MAX_PER_RUN = 40;          // a quiet cap; a clinic day is nowhere near this

// The IST day, N days back. The clinic's day is not UTC's, and a bill raised
// at 8pm in Eluru belongs to that evening, not to the next morning.
function istDayBack(n) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() - (Number(n) || 0) * 86400000));
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const gate = guard.cronAuth(req);
  if (!gate.ok) return res.status(401).json({ error: "unauthorized", note: gate.note });
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(200).json({ ok: true, note: "kv not configured" });

  // No link, no ask. Sending "please review us" with nowhere to go is worse
  // than staying quiet, so this says plainly what is missing.
  const link = await reviews.reviewLink(cfg).catch(() => "");
  if (!link) return res.status(200).json({ ok: true, sent: 0, note: "REVIEW_LINK / GOOGLE_PLACE_ID unset — nothing to send" });

  const dry = q.dry === "1";
  const force = q.force === "1";
  const back = Math.max(0, Math.min(30, Number(process.env.REVIEW_ASK_DAYS || 2)));
  const day = String(q.day || "").match(/^\d{4}-\d{2}-\d{2}$/) ? String(q.day) : istDayBack(back);

  const ids = await guard.kvCommand(cfg, ["LRANGE", `bill:day:${day}`, "0", "199"]).catch(() => ({}));
  const uniq = [...new Set((ids.result || []).map((x) => String(x)))];
  if (!uniq.length) return res.status(200).json({ ok: true, day, bills: 0, sent: 0 });

  const raws = await guard.kvPipeline(cfg, uniq.map((id) => ["GET", `bill:${id}`])).catch(() => []);

  // One person, not one bill: somebody billed twice on the same day is still
  // one person, and the newest bill is the one worth naming.
  const people = new Map();
  (Array.isArray(raws) ? raws : []).forEach((raw) => {
    const b = parse(raw, null);
    if (!b) return;
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return;
    const t = money.totals(b);
    // They have to have actually paid, and to owe nothing.
    if (!(t.paid > 0) || t.balance > 0) return;
    const prev = people.get(phone);
    if (!prev || Number(b.ts || 0) > Number(prev.ts || 0)) people.set(phone, b);
  });

  const out = { ok: true, day, bills: uniq.length, eligible: people.size, sent: 0, skipped: 0, failed: 0, rows: [] };

  for (const [phone, b] of people) {
    if (out.sent >= MAX_PER_RUN) break;
    if (!dry && !force) {
      const nx = await guard.kvCommand(cfg, ["SET", `rev:asked:${phone}`, day, "NX", "EX", String(ASKED_TTL)]).catch(() => ({}));
      if (!nx || !nx.result) { out.skipped++; continue; }
    }
    const first = String(b.name || "").trim().split(" ")[0] || "Andi";
    if (dry) { out.rows.push({ phone: phone.slice(-4), name: first, dry: true }); out.sent++; continue; }

    // No adjective in front of "review", and nothing offered for it.
    const text = `${first} garu 🙏\n\nDermaLuxe ki vachchinanduku dhanyavadalu.\n\nMee anubhavam ela undo Google lo oka review ga raastara? Oka nimisham chaalu — mee maatalu, meeku anipinchindi, adi chaalu.\n\n${link}\n\nEmaina ibbandi unte ikkade cheppandi — sari chestam.\n— DermaLuxe by Medicare, Eluru`;

    let ok = await notify.sendWa(phone, text).catch(() => false);
    let via = ok ? "message" : "";
    if (!ok) {
      // Two days on, their 24-hour window has usually closed, so this is the
      // path most of these actually take.
      const t = await notify.sendWaTemplate(phone, "clinic_update", [first,
        `DermaLuxe ki vachchinanduku dhanyavadalu. Mee anubhavam Google lo review ga raastara? ${link}`.slice(0, 250),
      ]).catch(() => null);
      ok = !!(t && t.ok); via = "template";
    }
    if (ok) { out.sent++; out.rows.push({ phone: phone.slice(-4), name: first, via }); }
    else {
      out.failed++;
      // It did not go. Let the next run try again rather than burning the
      // one ask this person gets for six months on a message nobody saw.
      await guard.kvCommand(cfg, ["DEL", `rev:asked:${phone}`]).catch(() => {});
    }
  }

  if (out.sent && !dry) {
    await guard.kvCommand(cfg, ["LPUSH", "rev:log", JSON.stringify({ ts: Date.now(), day, sent: out.sent })]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "rev:log", "0", "199"]).catch(() => {});
  }
  console.log("cron-review", day, "eligible", out.eligible, "sent", out.sent, "skipped", out.skipped, "failed", out.failed);
  return res.status(200).json(out);
};
