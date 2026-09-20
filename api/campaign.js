// /api/campaign — the campaigns screen in the control panel.
//   GET  ?a=list          past campaigns with sent / replied / booked
//   GET  ?a=suggest       this month's ready drafts (the clinic's year)
//   POST {a:"preview", aud, seg}            how many would get it
//   POST {a:"send", name, text, tpl, p2, aud, seg}   queue it (settings.manage)
// Reading needs msg.send; sending money on templates needs settings.manage.
const guard = require("./_guard.js");
const staff = require("./staff.js");
const camp = require("./_campaign.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });
  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("msg.send")) return json(res, 403, { error: "Mee role ki campaigns access ledu" });
  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "list");

  if (a === "list") return json(res, 200, { ok: true, campaigns: await camp.list(cfg, 20), suggest: camp.suggest() });
  if (a === "suggest") return json(res, 200, { ok: true, suggest: camp.suggest() });
  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (a === "preview") return json(res, 200, Object.assign({ ok: true }, await camp.preview(cfg, { aud: b.aud, seg: b.seg })));
  if (a === "send") {
    if (!allow("settings.manage")) return json(res, 403, { error: "Campaign pampadam owner/manager ki matrame" });
    if (await guard.idem(cfg, b, res)) return json(res, 200, { ok: true, dup: true });
    const rl = await guard.rateLimit(cfg, `rl:cmp:${me.phone}`, 5, 86400);
    if (!rl.allowed) return json(res, 429, { error: "Roju ki 5 campaigns chaalu" });
    const out = await camp.send(cfg, b, me.name);
    if (!out.ok) return json(res, 400, { error: out.error });
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({ ts: Date.now(), by: me.name, phone: me.phone, what: `Campaign pamparu: ${String(b.name || "").slice(0, 40)} → ${out.queued}` })]).catch(() => {});
    return json(res, 200, out);
  }
  return json(res, 400, { error: "Unknown action" });
};
