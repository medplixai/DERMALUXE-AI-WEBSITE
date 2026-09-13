// /api/act — carries out one action the AI Office proposed and a person approved.
//
// The assistant has no privileges of its own and never will. It can only
// suggest; the suggestion is shown to the colleague as a card, and if they tap
// Approve, that action runs **under their own session** and is checked against
// their own capabilities here, from scratch. Nothing the model returned is
// trusted beyond its shape — every phone number, timestamp and status is
// re-validated, and every approval is written to the audit log with who
// approved it and what it did.
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
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const STATUSES = ["new", "contacted", "booked", "visited", "closed"];

// What each action needs before it may run.
const NEEDS = {
  book: "appts.edit",
  note: "leads.edit",
  status: "leads.edit",
  message: "msg.send",
  pkglog: "pkg.log",
};

async function audit(cfg, me, what) {
  const rec = JSON.stringify({ ts: Date.now(), by: me.name, phone: me.phone, what: clean("AI Office: " + what, 200) });
  await guard.kvCommand(cfg, ["LPUSH", "staff:audit", rec]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "staff:audit", "0", "199"]).catch(() => {});
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("ai.use")) return json(res, 403, { error: "Mee role ki AI Office access ledu" });

  const b = req.body || {};
  const type = clean(b.type, 16);
  const need = NEEDS[type];
  if (!need) return json(res, 400, { error: "Idi cheyyagaligedi kaadu" });
  if (!allow(need)) return json(res, 403, { error: "Mee role ki idi chese permission ledu" });

  const rl = await guard.rateLimit(cfg, `rl:act:${me.phone}`, 60, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Konchem aagandi" });

  const phone = digits10(b.phone);

  if (type === "message") {
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const text = clean(b.text, 900);
    if (text.length < 5) return json(res, 400, { error: "Message chala chinnaga undi" });
    // Free-form only reaches someone who wrote to us in the last 24 hours;
    // the approved utility template is the fallback so it still arrives.
    let sent = await notify.sendWa(phone, text);
    let via = "message";
    if (!sent) {
      const first = clean(b.name, 30).split(" ")[0] || "Hi";
      const t = await notify.sendWaTemplate(phone, "clinic_update", [first, text.slice(0, 250)]);
      sent = !!(t && t.ok); via = "template";
    }
    if (!sent) return json(res, 502, { error: "Pampaleka poyam — WhatsApp lo direct ga pampandi" });
    await audit(cfg, me, `message → ${phone} (${via})`);
    return json(res, 200, { ok: true, via, did: "Message pampamu" });
  }

  if (type === "book") {
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const at = Number(b.at);
    if (!at) return json(res, 400, { error: "Sarpaina time ivvandi" });
    // the schedule's own booking path, so a booking made from a suggestion
    // gets the same clash check and the same message to the patient
    const sch = require("./schedule.js");
    const out = await sch.createAppt(cfg, me, {
      ph: phone, name: clean(b.name, 60), at, mins: Number(b.mins) || 30,
      concern: clean(b.concern, 80), staff: b.staff, staffName: b.staffName, force: !!b.force,
    });
    if (out.code !== 200) return json(res, out.code, out.body);
    await audit(cfg, me, `booked ${phone} at ${new Date(at).toISOString()}`);
    return json(res, 200, { ok: true, did: "Appointment book ayindi", appt: out.body.appt });
  }

  if (type === "note" || type === "status") {
    const key = clean(b.key, 80);
    if (!key) return json(res, 400, { error: "Lead key ledu" });
    if (type === "note") {
      const text = clean(b.text, 400);
      if (!text) return json(res, 400, { error: "Note khaali" });
      const cur = await guard.kvCommand(cfg, ["HGET", "dl_notes", key]).catch(() => ({}));
      const list = parse((cur && cur.result) || "[]", []) || [];
      list.unshift({ ts: Date.now(), by: me.name, text });
      await guard.kvCommand(cfg, ["HSET", "dl_notes", key, JSON.stringify(list.slice(0, 30))]);
      await audit(cfg, me, `note on ${key.split("|")[1] || key}`);
      return json(res, 200, { ok: true, did: "Note save ayindi" });
    }
    const st = clean(b.status, 12).toLowerCase();
    if (!STATUSES.includes(st)) return json(res, 400, { error: "bad status" });
    await guard.kvCommand(cfg, ["HSET", "dl_status", key, st]);
    await guard.kvCommand(cfg, ["HSET", "dl_status_ts", key, String(Date.now())]).catch(() => {});
    await audit(cfg, me, `status ${st} on ${key.split("|")[1] || key}`);
    return json(res, 200, { ok: true, did: "Status " + st });
  }

  if (type === "pkglog") {
    const id = clean(b.id, 24);
    const raw = await guard.kvCommand(cfg, ["GET", `pkg:${id}`]).catch(() => ({}));
    const p = parse((raw && raw.result) || "", null);
    if (!p) return json(res, 404, { error: "Package dorakaledu" });
    const pkg = require("./package.js");
    const before = pkg.shape(p);
    if (before.left === 0) return json(res, 400, { error: "Ee package already ayipoyindi" });
    p.sessions = (p.sessions || []).concat([{ n: before.done + 1, at: Date.now(), by: me.name, note: clean(b.text, 200) }]);
    await guard.kvCommand(cfg, ["SET", `pkg:${id}`, JSON.stringify(p)]);
    const after = pkg.shape(p);
    if (after.left === 0) await guard.kvCommand(cfg, ["LREM", "pkg:open", "1", id]).catch(() => {});
    await audit(cfg, me, `sitting ${after.done}/${after.total} for ${p.phone}`);
    return json(res, 200, { ok: true, did: `Sitting ${after.done}/${after.total}` });
  }

  return json(res, 400, { error: "Unknown action" });
};
