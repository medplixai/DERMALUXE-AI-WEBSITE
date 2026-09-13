// /api/push — the staff app registers its device here, and the Control panel
// lists and revokes devices. Every action needs a live staff session; a token
// belonging to someone who has been suspended or removed is dropped on sight.
const guard = require("./_guard.js");
const push = require("./_push.js");
const staff = require("./staff.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  // Unauthenticated health flag: says only whether the Firebase key is
  // readable and which project it names. The project id already ships inside
  // the APK, so nothing secret is revealed.
  if (String((req.query || {}).a || "") === "health") {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    let project = null, parsed = false;
    if (raw) { try { const j = JSON.parse(raw); parsed = !!(j.client_email && j.private_key); project = j.project_id || null; } catch (e) {} }
    return json(res, 200, { ok: true, present: !!raw, parsed, configured: push.enabled(), project });
  }

  const me0 = staff.tokenUser(req);
  if (!me0) return json(res, 401, { error: "Login required" });

  const roles = await staff.loadRoles(cfg);
  const live = await staff.liveUser(cfg, me0.phone, roles);
  if (!live) return json(res, 403, { error: "Access removed" });
  if (live.off) return json(res, 403, { error: "Mee access ippudu off lo undi. Owner ni adagandi." });
  const me = { phone: live.phone, name: live.name, role: live.role };
  const caps = staff.effCaps(roles, live);
  const allow = (c) => caps.includes("*") || caps.includes(c);

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "");

  if (a === "status") {
    return json(res, 200, {
      ok: true, configured: push.enabled(), quiet: push.quietNow(),
      devices: (await push.devicesOf(cfg, me.phone)).length,
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rl = await guard.rateLimit(cfg, `rl:push:${me.phone}`, 120, 3600);
  if (!rl.allowed) return json(res, 429, { error: "Too many requests" });

  if (a === "register") {
    const token = String(b.token || "").trim();
    if (token.length < 20 || token.length > 512) return json(res, 400, { error: "Bad device token" });
    // Register even before the Firebase key is in place — then the first push
    // reaches every phone already installed, with nothing to redo.
    const known = await guard.kvCommand(cfg, ["GET", `push:dev:${token}`]).catch(() => ({}));
    const isNew = !(known && known.result);
    await push.saveDevice(cfg, token, { phone: me.phone, name: me.name, role: me.role, platform: String(b.platform || "android").slice(0, 16) });
    // A brand-new phone gets one confirmation, so the person sees for
    // themselves that notifications work — no test button to hunt for.
    if (isNew && push.enabled()) {
      push.sendToTokens(cfg, [token], {
        title: "Notifications on ✅",
        body: `${String(me.name || "").split(" ")[0] || "Hi"}, kotha leads ikkade ventane kanipistayi.`,
        tab: "leads", urgent: true,
      }).catch(() => {});
    }
    return json(res, 200, { ok: true, configured: push.enabled(), first: isNew });
  }

  if (a === "unregister") {
    const token = String(b.token || "").trim();
    if (token) await push.dropDevice(cfg, token);
    else for (const t of await push.devicesOf(cfg, me.phone)) await push.dropDevice(cfg, t);
    return json(res, 200, { ok: true });
  }

  // "Send me a test" — proves the whole chain end to end from the phone itself.
  if (a === "test") {
    if (!push.enabled()) return json(res, 501, { error: "Push inka configure cheyaledu (FIREBASE_SERVICE_ACCOUNT)" });
    const out = await push.sendToPhone(cfg, me.phone, {
      title: "DermaLuxe Staff",
      body: `Test notification — ${me.name}, notifications pani chestunnayi ✅`,
      tab: "leads", urgent: true,
    });
    if (!out.sent) return json(res, 502, { error: "Pampalekapoyam — phone lo app open chesi malli try cheyandi", detail: out });
    return json(res, 200, { ok: true, sent: out.sent });
  }

  // ---- Control panel ----
  if (!allow("team.manage")) return json(res, 403, { error: "Idi control panel access unna vallake" });

  if (a === "devices") {
    return json(res, 200, { ok: true, configured: push.enabled(), devices: await push.allDevices(cfg) });
  }
  if (a === "revoke") {
    const token = String(b.token || "").trim(), phone = digits10(b.phone);
    if (token) await push.dropDevice(cfg, token);
    else if (phone) for (const t of await push.devicesOf(cfg, phone)) await push.dropDevice(cfg, t);
    else return json(res, 400, { error: "token leda phone ivvandi" });
    return json(res, 200, { ok: true, devices: await push.allDevices(cfg) });
  }
  return json(res, 400, { error: "Unknown action" });
};
