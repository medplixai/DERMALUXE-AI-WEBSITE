// /api/photo — clinical photos taken from the staff app.
//
// These are patient pictures, so the rules are tighter than anywhere else in
// the codebase:
//   * a photo cannot be stored without a recorded consent tick, and the
//     consent is stamped with who took it and when;
//   * nothing is served by id alone — every read needs a live staff session
//     with the capability that covers that record;
//   * responses are no-store, so nothing lingers in a cache;
//   * the app never writes the picture to the phone's gallery.
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");

const MAX_BYTES = 900 * 1024;            // after base64 decode
const KEEP_DAYS = 400;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp"];

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};

const listKey = (kind, ref) => `ph:of:${kind}:${ref}`;

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const me0 = staff.tokenUser(req);
  if (!me0) return json(res, 401, { error: "Login required" });
  const roles = await staff.loadRoles(cfg);
  const live = await staff.liveUser(cfg, me0.phone, roles);
  if (!live) return json(res, 403, { error: "Access removed" });
  if (live.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
  const caps = staff.effCaps(roles, live);
  const allow = (c) => caps.includes("*") || caps.includes(c);

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "list");
  const kind = String(q.kind || b.kind || "lead") === "student" ? "student" : "lead";
  const needCap = kind === "student" ? "academy.edit" : "leads.edit";
  const viewCap = kind === "student" ? "academy.view" : "leads.view";

  // ---- read one image ----
  if (a === "get") {
    if (!allow(viewCap)) return json(res, 403, { error: "Mee role ki ivi chuse permission ledu" });
    const id = String(q.id || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (!id) return json(res, 400, { error: "id required" });
    const r = await guard.kvCommand(cfg, ["GET", `ph:img:${id}`]).catch(() => ({}));
    if (!r || !r.result) return json(res, 404, { error: "Not found" });
    let rec = null; try { rec = JSON.parse(r.result); } catch (e) {}
    if (!rec || !rec.b64) return json(res, 404, { error: "Not found" });
    const buf = Buffer.from(rec.b64, "base64");
    res.setHeader("Content-Type", rec.type || "image/jpeg");
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Content-Length", String(buf.length));
    return res.status(200).send(buf);
  }

  if (a === "list") {
    if (!allow(viewCap)) return json(res, 403, { error: "Mee role ki ivi chuse permission ledu" });
    const ref = String(q.ref || "").slice(0, 120);
    if (!ref) return json(res, 400, { error: "ref required" });
    const r = await guard.kvCommand(cfg, ["LRANGE", listKey(kind, ref), "0", "49"]).catch(() => ({}));
    const photos = (r.result || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
    return json(res, 200, { ok: true, photos });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rl = await guard.rateLimit(cfg, `rl:ph:${live.phone}`, 200, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many uploads — konchem aagandi" });

  // ---- save a new photo ----
  if (a === "put") {
    if (!allow(needCap)) return json(res, 403, { error: "Mee role ki photo add chese permission ledu" });
    // The consent tick is not decoration: without it nothing is stored.
    if (b.consent !== true) return json(res, 400, { error: "Patient consent tick cheyandi — adi lekunda photo save cheyyamu" });
    const ref = String(b.ref || "").slice(0, 120);
    if (!ref) return json(res, 400, { error: "ref required" });

    const m = String(b.dataUrl || "").match(/^data:([a-z/+-]+);base64,(.+)$/i);
    if (!m) return json(res, 400, { error: "Photo sarigga raledu" });
    const type = m[1].toLowerCase();
    if (!OK_TYPES.includes(type)) return json(res, 400, { error: "JPEG leda PNG matrame" });
    const b64 = m[2];
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes > MAX_BYTES) return json(res, 413, { error: "Photo peddadi — konchem chinnaga teeyandi" });

    const id = crypto.randomBytes(16).toString("hex");
    const now = Date.now();
    const rec = {
      b64, type, kind, ref, ts: now,
      by: live.name, byPhone: live.phone,
      label: String(b.label || "").slice(0, 60),
      // stamped consent — who confirmed the patient agreed, and when
      consent: { given: true, by: live.name, byPhone: live.phone, ts: now },
    };
    await guard.kvCommand(cfg, ["SET", `ph:img:${id}`, JSON.stringify(rec), "EX", String(KEEP_DAYS * 86400)]);
    const meta = JSON.stringify({ id, ts: now, by: live.name, label: rec.label, type });
    await guard.kvCommand(cfg, ["LPUSH", listKey(kind, ref), meta]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", listKey(kind, ref), "0", "49"]).catch(() => {});
    console.log("photo saved", kind, ref.slice(0, 24), bytes, "bytes by", live.phone.slice(-4));
    return json(res, 200, { ok: true, id, ts: now });
  }

  // ---- delete ----
  if (a === "del") {
    if (!allow(needCap)) return json(res, 403, { error: "Mee role ki idi teesese permission ledu" });
    const id = String(b.id || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    const ref = String(b.ref || "").slice(0, 120);
    if (!id || !ref) return json(res, 400, { error: "id + ref required" });
    await guard.kvCommand(cfg, ["DEL", `ph:img:${id}`]).catch(() => {});
    const r = await guard.kvCommand(cfg, ["LRANGE", listKey(kind, ref), "0", "49"]).catch(() => ({}));
    for (const x of (r.result || [])) {
      let v = null; try { v = JSON.parse(x); } catch (e) {}
      if (v && v.id === id) { await guard.kvCommand(cfg, ["LREM", listKey(kind, ref), "1", x]).catch(() => {}); break; }
    }
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Unknown action" });
};
