// /api/package — multi-session treatments, and the recall they should trigger.
//
// Laser and PRP are sold as six sittings, not one. The system had no idea a
// patient was on sitting three, so nobody could be told their next one was
// due — and that reminder is the thing that brings a patient back. The
// session_reminder WhatsApp template has been approved and sitting unused
// because there was no data to fire it from.
//
// A package is created automatically when a bill includes a treatment whose
// rate-card entry has more than one sitting, so reception never has to think
// about it. Logging a sitting moves the count and sets the next due date.
//
// KV:
//   pkg:<id>          the package
//   pkg:of:<phone>    that person's package ids
//   pkg:open          packages with sittings left (scanned for recalls)
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const DAY = 86400000;

const get = async (cfg, id) => parse((await guard.kvCommand(cfg, ["GET", `pkg:${id}`]).catch(() => ({}))).result || "", null);
async function put(cfg, p) {
  const r = await guard.kvCommand(cfg, ["SET", `pkg:${p.id}`, JSON.stringify(p)]);
  if (!r || r.error) throw new Error("Package save avvaledu");
  return p;
}

// Everything the UI needs, worked out rather than stored, so a change to the
// gap or the count is reflected everywhere at once.
function shape(p) {
  const done = (p.sessions || []).length;
  const left = Math.max(0, (p.total || 1) - done);
  const last = done ? (p.sessions[done - 1].at || 0) : 0;
  const nextDue = left > 0 ? (last ? last + (p.gapDays || 30) * DAY : p.ts) : 0;
  const now = Date.now();
  return Object.assign({}, p, {
    done, left, last, nextDue,
    overdueDays: nextDue && nextDue < now ? Math.floor((now - nextDue) / DAY) : 0,
    status: left === 0 ? "complete" : p.status === "dropped" ? "dropped" : "active",
  });
}

// Called from money.js when a bill is raised: any line item that the rate card
// says is a multi-sitting treatment becomes a package.
async function fromBill(cfg, bill, rates) {
  const made = [];
  for (const item of (bill.items || [])) {
    const rate = (rates || []).find((r) => r.name === item.name);
    const total = Number(rate && rate.sessions) || 0;
    if (total < 2) continue;
    for (let n = 0; n < Math.max(1, Number(item.qty || 1)); n++) {
      const p = {
        id: crypto.randomBytes(6).toString("hex"),
        phone: bill.phone, name: bill.name,
        treatment: item.name, total,
        gapDays: Number(rate.gapDays) > 0 ? Number(rate.gapDays) : 30,
        fee: Number(item.price) || 0, billId: bill.id,
        sessions: [], ts: Date.now(), by: bill.by, status: "active",
      };
      await put(cfg, p);
      await guard.kvCommand(cfg, ["LPUSH", `pkg:of:${p.phone}`, p.id]).catch(() => {});
      await guard.kvCommand(cfg, ["LTRIM", `pkg:of:${p.phone}`, "0", "49"]).catch(() => {});
      await guard.kvCommand(cfg, ["LPUSH", "pkg:open", p.id]).catch(() => {});
      made.push(p.id);
    }
  }
  return made;
}

// Who is due or overdue for their next sitting.
async function due(cfg, withinDays) {
  const r = await guard.kvCommand(cfg, ["LRANGE", "pkg:open", "0", "499"]).catch(() => ({}));
  const now = Date.now(), horizon = now + (Number(withinDays) || 0) * DAY;
  const rows = [];
  for (const id of (r.result || [])) {
    const p = await get(cfg, id);
    if (!p) { await guard.kvCommand(cfg, ["LREM", "pkg:open", "1", id]).catch(() => {}); continue; }
    const s = shape(p);
    if (s.left === 0 || s.status === "dropped") {
      await guard.kvCommand(cfg, ["LREM", "pkg:open", "1", id]).catch(() => {});
      continue;
    }
    if (s.nextDue && s.nextDue <= horizon) rows.push(s);
  }
  rows.sort((a, b) => a.nextDue - b.nextDue);
  return rows;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("leads.view")) return json(res, 403, { error: "Mee role ki idi chuse permission ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "of");

  if (a === "of") {
    const phone = digits10(q.phone || b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const r = await guard.kvCommand(cfg, ["LRANGE", `pkg:of:${phone}`, "0", "49"]).catch(() => ({}));
    const rows = [];
    for (const id of (r.result || [])) {
      const p = await get(cfg, id);
      if (p) rows.push(shape(p));
    }
    return json(res, 200, { ok: true, rows });
  }

  // The recall list: today's and anyone already past their date.
  if (a === "due") {
    const rl = await guard.rateLimit(cfg, `rl:pkg:${me.phone}`, 200, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const rows = await due(cfg, Number(q.days || 0));
    return json(res, 200, {
      ok: true, rows,
      overdue: rows.filter((r) => r.overdueDays > 0).length,
      today: rows.filter((r) => r.overdueDays === 0).length,
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (!allow("pkg.log")) return json(res, 403, { error: "Mee role ki session log chese permission ledu" });

  // Started somewhere other than a bill — a package bought earlier, say.
  if (a === "create") {
    const phone = digits10(b.phone);
    const total = Math.max(2, Math.min(24, Number(b.total) || 6));
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const treatment = clean(b.treatment, 60);
    if (!treatment) return json(res, 400, { error: "Treatment peru ivvandi" });
    const p = {
      id: crypto.randomBytes(6).toString("hex"),
      phone, name: clean(b.name, 60) || "Patient", treatment, total,
      gapDays: Math.max(3, Math.min(120, Number(b.gapDays) || 30)),
      fee: Math.max(0, Number(b.fee) || 0), billId: "",
      sessions: [], ts: Date.now(), by: me.name, status: "active",
    };
    await put(cfg, p);
    await guard.kvCommand(cfg, ["LPUSH", `pkg:of:${phone}`, p.id]).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", "pkg:open", p.id]).catch(() => {});
    return json(res, 200, { ok: true, pkg: shape(p) });
  }

  const p = await get(cfg, clean(b.id, 24));
  if (!p) return json(res, 404, { error: "Package dorakaledu" });

  // One sitting done.
  if (a === "log") {
    const s0 = shape(p);
    if (s0.left === 0) return json(res, 400, { error: "Ee package already ayipoyindi" });
    // Stopping a package means stopping it. Counting a sitting against one
    // that was cancelled makes the patient's file say something untrue.
    if (p.status === "dropped") return json(res, 400, { error: "Ee package aapesaru — malli modalu pettalante kotha package pettandi" });
    p.sessions = (p.sessions || []).concat([{
      n: s0.done + 1, at: Date.now(), by: me.name, note: clean(b.note, 200),
    }]);
    await put(cfg, p);
    const s = shape(p);
    if (s.left === 0) await guard.kvCommand(cfg, ["LREM", "pkg:open", "1", p.id]).catch(() => {});
    return json(res, 200, { ok: true, pkg: s });
  }

  if (a === "drop") {
    p.status = "dropped";
    await put(cfg, p);
    await guard.kvCommand(cfg, ["LREM", "pkg:open", "1", p.id]).catch(() => {});
    return json(res, 200, { ok: true, pkg: shape(p) });
  }

  return json(res, 400, { error: "Unknown action" });
};
module.exports.fromBill = fromBill;
module.exports.due = due;
module.exports.shape = shape;
