// /api/hms — the bridge to the Medicare hospital system, and a way to see it.
//
// The connector itself has existed for a long time (_clinic.js): every lead
// the clinic gets — website, WhatsApp, Instagram, Messenger, a missed call,
// and now one typed in at the desk — is posted to the hospital platform, and
// anything that fails to get there is parked in a queue and retried.
//
// What did not exist was any way to know whether that was working. With no
// URL configured it is a silent no-op, which is correct; but once it IS
// configured, a platform that is down means leads quietly pile up in the
// queue and nobody finds out until somebody goes looking. So: a panel that
// says plainly whether it is connected, how many leads are waiting, when one
// last got through, a button to try it without inventing a patient, and a
// button to push the waiting ones again.
//
// Nothing here can be used to reach the hospital system except through the
// settings the owner has already put in the environment.
const guard = require("./_guard.js");
const staff = require("./staff.js");
const clinic = require("./_clinic.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

// Never show a key, only whether there is one.
function shape(c) {
  const host = (() => { try { return c.syncUrl ? new URL(c.syncUrl).host : ""; } catch (e) { return "set"; } })();
  return {
    connected: !!c.syncUrl,
    host,
    tenant: c.tenantId || "",
    hasKey: !!c.apiKey,
    portalUrl: c.portalUrl || "",
    bookingUrl: c.bookingUrl || "",
    // exactly what is missing, in the order it has to be filled in
    missing: [
      !c.syncUrl && "CLINIC_SYNC_URL",
      !c.tenantId && "CLINIC_TENANT_ID",
    ].filter(Boolean),
  };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  if (!auth.allow("settings.manage")) return json(res, 403, { error: "Idi owner ki matrame" });
  const me = auth.me;

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "status");
  const c = clinic.clinicConfig();

  if (a === "status") {
    const pend = await guard.kvCommand(cfg, ["LRANGE", clinic.PENDING_KEY, "0", "199"]).catch(() => ({}));
    const rows = (pend.result || []).map((x) => parse(x, null)).filter(Boolean);
    const last = parse((await guard.kvCommand(cfg, ["GET", "hms:last"]).catch(() => ({}))).result || "", null);
    return json(res, 200, Object.assign(shape(c), {
      ok: true,
      waiting: rows.length,
      oldest: rows.length ? Math.min(...rows.map((x) => Number(x.ts) || Date.now())) : 0,
      sample: rows.slice(0, 5).map((x) => ({ name: x.name || "", phone: String(x.phone || "").slice(-4), ts: x.ts })),
      last,
    }));
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });

  // Prove the connection with a lead that is obviously not a patient. The
  // hospital system sees the same shape it always sees, marked as a test, so
  // nobody has to wonder later who this person was.
  if (a === "test") {
    if (!c.syncUrl) return json(res, 400, { error: "Inka connect cheyyaledu — CLINIC_SYNC_URL pettandi" });
    const probe = {
      ts: Date.now(), type: "test", name: "DermaLuxe connection test", phone: "0000000000",
      concern: "connection test", message: `Sent from the DermaLuxe dashboard by ${me.name}. Not a patient.`,
      test: true,
    };
    const started = Date.now();
    let out;
    try { out = await clinic.forwardLead(cfg, probe); }
    catch (e) { return json(res, 502, { error: String((e && e.message) || e).slice(0, 200) }); }
    const rec = { at: Date.now(), ms: Date.now() - started, ok: !!out.synced, by: me.name };
    await guard.kvCommand(cfg, ["SET", "hms:last", JSON.stringify(rec)]).catch(() => {});
    // A failed test parks the probe in the retry queue, which would then
    // travel to the hospital as a real lead. Take it back out.
    if (!out.synced) {
      const pend = await guard.kvCommand(cfg, ["LRANGE", clinic.PENDING_KEY, "0", "99"]).catch(() => ({}));
      for (const raw of (pend.result || [])) {
        const l = parse(raw, null);
        if (l && l.test && l.ts === probe.ts) { await guard.kvCommand(cfg, ["LREM", clinic.PENDING_KEY, "1", raw]).catch(() => {}); break; }
      }
    }
    return json(res, out.synced ? 200 : 502, {
      ok: !!out.synced, ms: rec.ms,
      error: out.synced ? undefined : "Cheraledu — URL, key, leda vaari server chudandi",
    });
  }

  // Push whatever is waiting. Anything that fails is re-parked by the
  // connector itself, so this is safe to press twice.
  if (a === "retry") {
    const pend = await guard.kvCommand(cfg, ["LRANGE", clinic.PENDING_KEY, "0", "99"]).catch(() => ({}));
    const raws = pend.result || [];
    if (!raws.length) return json(res, 200, { ok: true, sent: 0, failed: 0, waiting: 0 });
    let sent = 0, failed = 0;
    for (const raw of raws) {
      const lead = parse(raw, null);
      if (!lead) continue;
      // Each one is taken out by its exact value, never by counting from the
      // front: a lead that fails somewhere else while this is running is
      // pushed onto the same end, and trimming by count would throw that one
      // away instead. A failure here is re-parked by the connector itself.
      await guard.kvCommand(cfg, ["LREM", clinic.PENDING_KEY, "1", raw]).catch(() => {});
      const r = await clinic.forwardLead(cfg, lead).catch(() => ({ synced: false }));
      if (r && r.synced) sent++; else failed++;
    }
    const left = await guard.kvCommand(cfg, ["LRANGE", clinic.PENDING_KEY, "0", "199"]).catch(() => ({}));
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
      ts: Date.now(), by: me.name, phone: me.phone,
      what: `Pushed ${sent} parked lead(s) to the hospital system (${failed} still failing)`,
    })]).catch(() => {});
    return json(res, 200, { ok: true, sent, failed, waiting: (left.result || []).length });
  }

  return json(res, 400, { error: "Unknown action" });
};
