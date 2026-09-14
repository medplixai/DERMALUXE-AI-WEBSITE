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
const store = require("./_photo-store.js");

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

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const live = auth.me, allow = auth.allow;

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "list");
  // "patient" files a photo against the person's phone number so a before and
  // an after taken months apart land on the same timeline. "lead" is kept for
  // the photos already stored against an enquiry.
  const KINDS = { lead: "leads", patient: "leads", student: "academy" };
  const kind = KINDS[String(q.kind || b.kind || "lead")] ? String(q.kind || b.kind || "lead") : "lead";
  const area = KINDS[kind];
  const needCap = area + ".edit";
  const viewCap = area + ".view";

  // ---- read one image ----
  if (a === "get") {
    if (!allow(viewCap)) return json(res, 403, { error: "Mee role ki ivi chuse permission ledu" });
    const id = String(q.id || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (!id) return json(res, 400, { error: "id required" });
    const r = await guard.kvCommand(cfg, ["GET", `ph:img:${id}`]).catch(() => ({}));
    if (!r || !r.result) return json(res, 404, { error: "Not found" });
    let rec = null; try { rec = JSON.parse(r.result); } catch (e) {}
    if (!rec || !(rec.b64 || rec.store)) return json(res, 404, { error: "Not found" });
    // The capability comes from the record, never from the query string —
    // otherwise ?kind=lead would open a student's document to anyone with
    // leads.view, and the other way round.
    const realCap = (KINDS[rec.kind] || "leads") + ".view";
    if (!allow(realCap)) return json(res, 403, { error: "Mee role ki idi chuse permission ledu" });
    let buf;
    try { buf = await store.get(cfg, id, rec); }
    catch (e) { console.error("photo: read", e && e.message); return json(res, 404, { error: "Photo teeyaleka poyam" }); }
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
    // The picture itself goes to blob storage, encrypted; Redis keeps this
    // record, which is a few hundred bytes and says where the bytes are.
    let where;
    try { where = await store.put(cfg, id, Buffer.from(b64, "base64"), { ttl: KEEP_DAYS * 86400 }); }
    catch (e) { console.error("photo: store", e && e.message); return json(res, 500, { error: "Photo save avvaledu — malli try cheyandi" }); }
    const rec = Object.assign({
      type, kind, ref, ts: now,
      by: live.name, byPhone: live.phone,
      label: String(b.label || "").slice(0, 60),
      // stamped consent — who confirmed the patient agreed, and when
      consent: { given: true, by: live.name, byPhone: live.phone, ts: now },
    }, where);
    await guard.kvCommand(cfg, ["SET", `ph:img:${id}`, JSON.stringify(rec), "EX", String(KEEP_DAYS * 86400)]);
    const meta = JSON.stringify({ id, ts: now, by: live.name, label: rec.label, type });
    await guard.kvCommand(cfg, ["LPUSH", listKey(kind, ref), meta]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", listKey(kind, ref), "0", "49"]).catch(() => {});
    console.log("photo saved", kind, ref.slice(0, 13), bytes, "bytes ->", where.store, "by", live.phone.slice(-4));  // timestamp only — never the patient's number
    return json(res, 200, { ok: true, id, ts: now });
  }

  // ---- delete ----
  // Which record this is, and therefore who may remove it, comes from the
  // record — never from the request. Otherwise ?kind=lead would let somebody
  // with leads.edit delete a student's document, and the other way round.
  if (a === "del") {
    const id = String(b.id || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (!id) return json(res, 400, { error: "id required" });
    const got = await guard.kvCommand(cfg, ["GET", `ph:img:${id}`]).catch(() => ({}));
    let rec = null; try { rec = JSON.parse((got && got.result) || ""); } catch (e) {}
    if (!rec) return json(res, 404, { error: "Photo dorakaledu" });
    const realCap = (KINDS[rec.kind] || "leads") + ".edit";
    if (!allow(realCap)) return json(res, 403, { error: "Mee role ki idi teesese permission ledu" });

    await store.del(cfg, id, rec).catch(() => {});
    await guard.kvCommand(cfg, ["DEL", `ph:img:${id}`]).catch(() => {});
    const listK = listKey(rec.kind, rec.ref);
    const r = await guard.kvCommand(cfg, ["LRANGE", listK, "0", "49"]).catch(() => ({}));
    for (const x of (r.result || [])) {
      let v = null; try { v = JSON.parse(x); } catch (e) {}
      if (v && v.id === id) { await guard.kvCommand(cfg, ["LREM", listK, "1", x]).catch(() => {}); break; }
    }
    // A clinical photograph disappearing is worth a line in the log.
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
      ts: Date.now(), by: live.name, phone: live.phone,
      what: `Deleted a ${rec.kind} photo taken ${new Date(rec.ts).toISOString().slice(0, 10)} by ${rec.by || "?"}`,
    })]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "staff:audit", "0", "199"]).catch(() => {});
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Unknown action" });
};
