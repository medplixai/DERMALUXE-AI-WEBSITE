// /api/patient — one person, one record.
//
// Until now a person existed only as leads: every time Sirisha messaged she
// became a new card, and her notes and clinical photos hung off whichever card
// was current. A before photo from September and an after photo from December
// therefore lived on different records, which defeats the reason for taking
// them.
//
// A patient is identified by phone number. Nothing was migrated: the record is
// assembled on read from everything that already mentions that number —
// every lead, the notes on each of those leads, photos filed against any of
// them, appointments, and the academy student record if there is one. On top
// of that sits `pt:<phone>`, which holds only what has nowhere else to live:
// the preferred name, date of birth, allergies, tags, and notes about the
// person rather than about one enquiry.
const guard = require("./_guard.js");
const staff = require("./staff.js");
const notify = require("./_notify.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

const LEADS = "dl_leads", STATUS = "dl_status", NOTES = "dl_notes";
const leadKey = (l) => `${l.ts}|${digits10(l.phone) || l.src_id || ""}`;

function hash(r) {
  const a = (r && r.result) || {}, out = {};
  if (Array.isArray(a)) { for (let i = 0; i + 1 < a.length; i += 2) out[a[i]] = a[i + 1]; }
  else Object.assign(out, a);
  return out;
}
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

async function readLeads(cfg) {
  const r = await guard.kvCommand(cfg, ["LRANGE", LEADS, "0", "799"]).catch(() => ({}));
  return (r.result || []).map((x) => parse(x, null)).filter(Boolean);
}

// Everything the clinic knows about this number, in one shape.
async function build(cfg, phone, opts) {
  const [all, st, nt, extraR, apptR] = await Promise.all([
    readLeads(cfg),
    guard.kvCommand(cfg, ["HGETALL", STATUS]).catch(() => ({})),
    guard.kvCommand(cfg, ["HGETALL", NOTES]).catch(() => ({})),
    guard.kvCommand(cfg, ["GET", `pt:${phone}`]).catch(() => ({})),
    guard.kvCommand(cfg, ["LRANGE", "appt:q", "0", "299"]).catch(() => ({})),
  ]);
  const statuses = hash(st), notesBy = hash(nt);
  const extra = parse((extraR && extraR.result) || "", {}) || {};

  const mine = all.filter((l) => digits10(l.phone) === phone)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (!mine.length && !extra.name && !opts.allowEmpty) return null;

  // every enquiry, each with where it got to
  const visits = mine.map((l) => {
    const k = leadKey(l);
    return {
      key: k, ts: l.ts,
      concern: l.concern || l.message || "",
      src: l.src || l.type || "web",
      heat: l.heat || "",
      slot: l.slot || "", mode: l.mode || "",
      status: statuses[k] || "new",
      callPrep: l.call_prep || "",
    };
  });

  // notes from every enquiry plus the ones written about the person
  let notes = [];
  for (const v of visits) {
    for (const n of (parse(notesBy[v.key] || "[]", []) || [])) {
      notes.push({ ts: n.ts, by: n.by, text: n.text, from: "visit" });
    }
  }
  for (const n of (extra.notes || [])) notes.push({ ts: n.ts, by: n.by, text: n.text, from: "patient" });
  notes.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  notes = notes.slice(0, 120);

  // photos: new ones are filed against the person, older ones against whichever
  // enquiry was open at the time — read both so the timeline is complete
  const photoKeys = [`ph:of:patient:${phone}`].concat(visits.map((v) => `ph:of:lead:${v.key}`));
  const photos = [];
  for (const key of photoKeys) {
    const r = await guard.kvCommand(cfg, ["LRANGE", key, "0", "49"]).catch(() => ({}));
    for (const x of (r.result || [])) {
      const p = parse(x, null);
      if (p && p.id) photos.push(p);
    }
  }
  photos.sort((a, b) => (a.ts || 0) - (b.ts || 0));          // oldest first: before → after

  const now = Date.now();
  const appts = (apptR.result || []).map((x) => parse(x, null)).filter(Boolean)
    .filter((a) => digits10(a.ph) === phone)
    .sort((a, b) => (a.at || 0) - (b.at || 0));

  const name = extra.name || (mine.find((l) => l.name) || {}).name || "Patient";
  const first = mine.length ? mine[mine.length - 1].ts : (extra.since || now);

  return {
    phone, name,
    since: first,
    dob: extra.dob || "",
    allergies: extra.allergies || "",
    tags: Array.isArray(extra.tags) ? extra.tags : [],
    concerns: Array.from(new Set(visits.map((v) => v.concern).filter(Boolean))).slice(0, 12),
    visits, notes, photos, appts,
    counts: {
      visits: visits.length,
      photos: photos.length,
      booked: visits.filter((v) => v.status === "booked" || v.status === "visited").length,
      upcoming: appts.filter((a) => a.at > now).length,
    },
    lastTouch: Math.max(notes[0] ? notes[0].ts : 0, visits[0] ? visits[0].ts : 0),
  };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("leads.view")) return json(res, 403, { error: "Mee role ki patient records chuse permission ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "get");

  if (a === "get") {
    const phone = digits10(q.phone || b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid 10-digit number ivvandi" });
    const rl = await guard.rateLimit(cfg, `rl:pt:${me.phone}`, 300, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const p = await build(cfg, phone, { allowEmpty: true });
    return json(res, 200, { ok: true, patient: p });
  }

  // One row per person, newest contact first — the patient book.
  if (a === "list") {
    const rl = await guard.rateLimit(cfg, `rl:ptl:${me.phone}`, 120, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const term = clean(q.q || b.q, 40).toLowerCase();
    const [all, st] = await Promise.all([
      readLeads(cfg),
      guard.kvCommand(cfg, ["HGETALL", STATUS]).catch(() => ({})),
    ]);
    const statuses = hash(st);
    const by = new Map();
    for (const l of all) {
      const phone = digits10(l.phone);
      if (!phone) continue;
      const k = leadKey(l);
      const prev = by.get(phone);
      const row = prev || { phone, name: l.name || "Patient", visits: 0, first: l.ts, last: l.ts, concern: "", statuses: [] };
      row.visits++;
      row.first = Math.min(row.first, l.ts);
      if (l.ts >= row.last) { row.last = l.ts; row.concern = l.concern || row.concern; if (l.name) row.name = l.name; }
      row.statuses.push(statuses[k] || "new");
      by.set(phone, row);
    }
    let rows = Array.from(by.values()).map((r) => ({
      phone: r.phone, name: r.name, visits: r.visits, first: r.first, last: r.last,
      concern: r.concern,
      repeat: r.visits > 1,
      everBooked: r.statuses.some((s) => s === "booked" || s === "visited"),
    }));
    if (term) {
      rows = rows.filter((r) => (r.name || "").toLowerCase().includes(term) ||
        r.phone.includes(term) || (r.concern || "").toLowerCase().includes(term));
    }
    rows.sort((a2, b2) => b2.last - a2.last);
    return json(res, 200, {
      ok: true,
      rows: rows.slice(0, 200),
      total: rows.length,
      repeats: rows.filter((r) => r.repeat).length,
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (!allow("leads.edit")) return json(res, 403, { error: "Mee role ki idi marche permission ledu" });
  const phone = digits10(b.phone);
  if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid 10-digit number ivvandi" });
  const cur = parse((await guard.kvCommand(cfg, ["GET", `pt:${phone}`]).catch(() => ({}))).result || "", {}) || {};

  // the person's own details, not one enquiry's
  if (a === "save") {
    const next = Object.assign({}, cur, {
      name: clean(b.name, 80) || cur.name || "",
      dob: clean(b.dob, 12) || cur.dob || "",
      allergies: clean(b.allergies, 200),
      tags: Array.isArray(b.tags) ? b.tags.map((t) => clean(t, 24)).filter(Boolean).slice(0, 8) : (cur.tags || []),
      since: cur.since || Date.now(),
      by: me.phone,
    });
    await guard.kvCommand(cfg, ["SET", `pt:${phone}`, JSON.stringify(next)]);
    return json(res, 200, { ok: true, patient: await build(cfg, phone, { allowEmpty: true }) });
  }

  if (a === "note") {
    const text = clean(b.text, 400);
    if (!text) return json(res, 400, { error: "text required" });
    const notes = (cur.notes || []).slice(0, 119);
    notes.unshift({ ts: Date.now(), by: me.name, text });
    await guard.kvCommand(cfg, ["SET", `pt:${phone}`, JSON.stringify(Object.assign({}, cur, { notes }))]);
    return json(res, 200, { ok: true, patient: await build(cfg, phone, { allowEmpty: true }) });
  }

  // Send this person a message, from here, without leaving for WhatsApp and
  // coming back. The clinic could already do this — but only if the AI Office
  // suggested it first, which is a strange way round. Same permission, same
  // record in the patient's file, same fallback when the 24-hour window has
  // closed.
  if (a === "message") {
    if (!allow("msg.send")) return json(res, 403, { error: "Mee role ki message pampe permission ledu" });
    const text = clean(b.text, 900);
    if (text.length < 5) return json(res, 400, { error: "Message chala chinnaga undi" });
    let via = "message";
    let sent = await notify.sendWa(phone, text).catch(() => false);
    if (!sent) {
      const first = String(cur.name || b.name || "").trim().split(" ")[0] || "Hi";
      const t = await notify.sendWaTemplate(phone, "clinic_update", [first, text.slice(0, 250)]).catch(() => ({ ok: false }));
      sent = !!(t && t.ok); via = "template";
    }
    if (!sent) return json(res, 502, { error: "Pampaleka poyam — WhatsApp lo direct ga pampandi" });
    // it goes in the file, so the next person knows what was said
    const notes = (cur.notes || []).slice(0, 119);
    notes.unshift({ ts: Date.now(), by: me.name, text: "📤 " + text.slice(0, 300) });
    // The message has already gone. If writing it into the file fails, say
    // so — otherwise the next person sees nothing and sends it again.
    const saved = await guard.kvWrite(cfg, ["SET", `pt:${phone}`, JSON.stringify(Object.assign({}, cur, { notes }))], "patient message note");
    return json(res, 200, { ok: true, via, noteSaved: saved,
      warn: saved ? undefined : "Message vellindi, kaani file lo raayaleka poyam",
      patient: await build(cfg, phone, { allowEmpty: true }) });
  }

  return json(res, 400, { error: "Unknown action" });
};
