// Two ways of saying hello, and which one people answer.
//
// Everything else the clinic measures is downstream of one sentence: the
// agent's first line to somebody who just tapped an ad. Change it and the
// whole funnel moves — but nobody can tell by looking, because a month is
// never like the month before it. Comparing this September to last is not
// evidence, it is a guess with a date on it.
//
// So both openers run at the same time, on the same ads, on the same day.
// Each new person is put on one of them by a hash of their own number —
// stable (they never see it change mid-conversation), even, and needing
// nothing written down to decide it. What IS written down is what happened:
//
//   leads  — somebody arrived and got this opener
//   reply  — they wrote again after it (the whole point of an opener)
//   booked — they fixed a slot
//
// The number that matters is reply ÷ leads. A booking is weeks of work after
// the opener; writing back is the opener's own doing.
//
// KV: ab:cfg · ab:of:<phone> (90 d) · ab:<v>:leads|reply|booked · ab:seen:<v>:<phone>
const guard = require("./_guard.js");
const crypto = require("crypto");

const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const VARIANTS = ["a", "b"];

const DEFAULTS = {
  on: false,
  a: { label: "Paata opener", text: "" },
  b: { label: "Kotha opener", text: "" },
};

async function load(cfg) {
  const v = cfg ? parse(((await guard.kvCommand(cfg, ["GET", "ab:cfg"]).catch(() => ({}))) || {}).result || "", null) : null;
  const c = Object.assign({}, DEFAULTS, v || {});
  const side = (x, d) => ({ label: clean((x || {}).label, 40) || d.label, text: clean((x || {}).text, 300) });
  return {
    on: c.on === true && !!clean((c.a || {}).text, 300) && !!clean((c.b || {}).text, 300),
    a: side(c.a, DEFAULTS.a), b: side(c.b, DEFAULTS.b),
    by: clean(c.by, 40), ts: Number(c.ts) || 0,
  };
}

async function save(cfg, input, by) {
  const cur = await load(cfg);
  const side = (k) => ({
    label: input[k] && input[k].label !== undefined ? clean(input[k].label, 40) : cur[k].label,
    text: input[k] && input[k].text !== undefined ? clean(input[k].text, 300) : cur[k].text,
  });
  const next = { on: input.on !== undefined ? !!input.on : cur.on, a: side("a"), b: side("b"), by: clean(by, 40), ts: Date.now() };
  // A test with one side missing is not a test — it is just the other line,
  // shown to half the people and measured as though it were being compared.
  if (next.on && (!next.a.text || !next.b.text)) return { ok: false, error: "Rendu openers raayandi — okati lekapote compare cheyalemu" };
  if (!next.a.label) next.a.label = DEFAULTS.a.label;
  if (!next.b.label) next.b.label = DEFAULTS.b.label;
  const r = await guard.kvCommand(cfg, ["SET", "ab:cfg", JSON.stringify(next)]);
  if (!r || r.error) return { ok: false, error: "Save avvaledu — malli try cheyandi" };
  return { ok: true, opener: next };
}

// Which side this person is on. The number decides it, so the same person
// gets the same opener on a second visit and nothing has to be stored to
// hand it back.
function side(phone) {
  const h = crypto.createHash("sha256").update(String(phone || "")).digest();
  return VARIANTS[h[0] % VARIANTS.length];
}

// Called on a first message. Returns the line to open with, or "" when the
// test is off — and counts the arrival exactly once per person.
async function opener(cfg, phone, opts) {
  const c = await load(cfg);
  if (!c.on || !cfg) return "";
  const v = side(phone);
  const first = await guard.kvCommand(cfg, ["SET", `ab:seen:leads:${phone}`, v, "NX", "EX", String(90 * 86400)]).catch(() => ({}));
  if (first && first.result) {
    await guard.kvCommand(cfg, ["INCR", `ab:${v}:leads`]).catch(() => {});
    await guard.kvCommand(cfg, ["SET", `ab:of:${phone}`, v, "EX", String(90 * 86400)]).catch(() => {});
  }
  return c[v].text;
}

// They wrote again, or they booked. Counted once per person per event, so a
// chatty patient does not out-vote a quiet one.
async function note(cfg, phone, event) {
  if (!cfg || !["reply", "booked"].includes(event)) return false;
  const r = await guard.kvCommand(cfg, ["GET", `ab:of:${phone}`]).catch(() => ({}));
  const v = r && r.result;
  if (!VARIANTS.includes(v)) return false;
  const once = await guard.kvCommand(cfg, ["SET", `ab:seen:${event}:${phone}`, "1", "NX", "EX", String(90 * 86400)]).catch(() => ({}));
  if (!once || !once.result) return false;
  await guard.kvCommand(cfg, ["INCR", `ab:${v}:${event}`]).catch(() => {});
  return true;
}

// Where the test stands. `lead` is the winner only when there is enough to
// call one: under MIN_EACH the gap is coin-tossing, and saying so is the
// difference between a test and a horoscope.
const MIN_EACH = 30;

async function stats(cfg) {
  const c = await load(cfg);
  const keys = [];
  for (const v of VARIANTS) for (const k of ["leads", "reply", "booked"]) keys.push(["GET", `ab:${v}:${k}`]);
  const got = cfg ? await guard.kvPipeline(cfg, keys).catch(() => []) : [];
  const num = (i) => Math.max(0, Number(got[i]) || 0);
  const sides = VARIANTS.map((v, i) => {
    const leads = num(i * 3), reply = num(i * 3 + 1), booked = num(i * 3 + 2);
    return { v, label: c[v].label, text: c[v].text, leads, reply, booked,
      rate: leads ? Math.round((reply / leads) * 100) : 0 };
  });
  const [A, B] = sides;
  const enough = A.leads >= MIN_EACH && B.leads >= MIN_EACH;
  let lead = "", by = 0;
  if (enough && A.rate !== B.rate) { lead = A.rate > B.rate ? "a" : "b"; by = Math.abs(A.rate - B.rate); }
  return { on: c.on, by: c.by, ts: c.ts, a: A, b: B, enough, need: MIN_EACH, lead, by_pts: by };
}

module.exports = { load, save, opener, note, stats, side, VARIANTS, MIN_EACH, DEFAULTS };
