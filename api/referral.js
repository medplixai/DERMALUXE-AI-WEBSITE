// /api/referral — word of mouth, finally visible.
//
// The engine has existed for a long time (_referral.js): every patient has a
// personal code, the friend types it to the WhatsApp agent, and both sides are
// recorded. It works. The trouble is that the only way in was for a patient to
// somehow know to type "REFER" into a chat, and the only way to look at any of
// it was a WhatsApp admin command. So a local clinic's biggest channel has
// been switched on and facing the wall.
//
// This is the desk's half: see a patient's code and send it to them, enter a
// code when the friend walks in rather than messages, see who has actually
// brought people, and — the part that was missing entirely — record that the
// thank-you was given, so nobody is promised something twice or forgotten.
//
// KV added here:
//   ref:rew:<ownerPhone>  hash of broughtPhone → { ts, by, what }
const guard = require("./_guard.js");
const staff = require("./staff.js");
const referral = require("./_referral.js");
const notify = require("./_notify.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const offer = () => process.env.REFERRAL_OFFER || "";

// Who this patient has brought, and whether we have thanked them for each one.
async function broughtBy(cfg, phone) {
  const [l, r] = await guard.kvPipeline(cfg, [
    ["LRANGE", `ref:list:${phone}`, "0", "99"],
    ["HGETALL", `ref:rew:${phone}`],
  ]).catch(() => [[], []]);
  const rewards = guard.hashOf(r);
  return (Array.isArray(l) ? l : []).map((x) => parse(x, null)).filter(Boolean).map((x) => {
    const rew = parse(rewards[x.ph], null);
    return { phone: x.ph, name: x.name || "", ts: x.ts, rewarded: rew || null };
  });
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

  // One patient: their code, and everybody they have sent us.
  if (a === "of") {
    const phone = digits10(q.phone || b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const rl = await guard.rateLimit(cfg, `rl:ref:${me.phone}`, 300, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const code = await referral.myCode(cfg, phone);
    const rows = await broughtBy(cfg, phone);
    const used = await guard.kvCommand(cfg, ["GET", `ref:used:${phone}`]).catch(() => ({}));
    return json(res, 200, {
      ok: true, code, rows,
      count: rows.length,
      unrewarded: rows.filter((x) => !x.rewarded).length,
      cameFrom: (used && used.result) ? String(used.result) : "",
      offer: offer(),
      canSend: allow("msg.send"), canEdit: allow("leads.edit"),
    });
  }

  // Who is actually bringing people in. The engine's own leaderboard reads
  // each person one at a time; with a few hundred that is a few hundred round
  // trips, so this asks for them together.
  if (a === "board") {
    if (!allow("reports.view")) return json(res, 403, { error: "Idi owner/manager ki" });
    const o = await guard.kvCommand(cfg, ["SMEMBERS", "ref:_owners"]).catch(() => ({}));
    const owners = (o.result || []).slice(0, 300);
    if (!owners.length) return json(res, 200, { ok: true, rows: [], total: 0, offer: offer() });
    const lists = await guard.kvPipeline(cfg, owners.map((ph) => ["LRANGE", `ref:list:${ph}`, "0", "99"])).catch(() => []);
    const rews = await guard.kvPipeline(cfg, owners.map((ph) => ["HGETALL", `ref:rew:${ph}`])).catch(() => []);
    const since = Number(q.since || b.since) || 0;
    const rows = [];
    owners.forEach((ph, i) => {
      const items = (Array.isArray(lists[i]) ? lists[i] : []).map((x) => parse(x, null)).filter(Boolean)
        .filter((x) => !since || Number(x.ts) >= since);
      if (!items.length) return;
      const rewarded = Object.keys(guard.hashOf(rews[i]) || {});
      rows.push({
        phone: ph, code: referral.codeFor(ph), n: items.length,
        last: items[0], names: items.slice(0, 3).map((x) => x.name || ""),
        owed: items.filter((x) => rewarded.indexOf(x.ph) < 0).length,
      });
    });
    rows.sort((x, y) => y.n - x.n || y.last.ts - x.last.ts);
    return json(res, 200, {
      ok: true, rows: rows.slice(0, 50),
      total: rows.reduce((n, x) => n + x.n, 0),
      owed: rows.reduce((n, x) => n + x.owed, 0),
      offer: offer(),
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  const rlw = await guard.rateLimit(cfg, `rl:refw:${me.phone}`, 200, 3600);
  if (!rlw.allowed) return json(res, 429, { error: "Too many requests" });

  // Give a patient their code, on the channel they already use.
  if (a === "send") {
    if (!allow("msg.send")) return json(res, 403, { error: "Mee role ki message pampe permission ledu" });
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const code = await referral.myCode(cfg, phone);
    const first = clean(b.name, 40).split(" ")[0] || "Andi";
    const what = offer()
      ? `Mee friend ki ${offer()}, meeku kuda ${offer()}.`
      : "Mee friend ki oka special benefit, meeku kuda.";
    const text = `${first} garu 🙏\n\nMee friends ki DermaLuxe cheppandi — vaallaki *${code}* ee code cheppandi.\n${what}\n\nVaaru ee number ki WhatsApp lo code pampithe chaalu, leda clinic lo cheppandi.\n📍 Kasturi Vari Street, Eluru`;
    let sent = await notify.sendWa(phone, text).catch(() => false);
    let via = sent ? "message" : "";
    if (!sent) {
      const t = await notify.sendWaTemplate(phone, "clinic_update", [first, `Mee referral code: ${code}. Friends ki cheppandi.`]).catch(() => null);
      sent = !!(t && t.ok); via = "template";
    }
    if (!sent) return json(res, 502, { error: "Pampaleka poyam — WhatsApp lo direct ga cheppandi. Code: " + code });
    return json(res, 200, { ok: true, code, via });
  }

  // The friend walked in instead of messaging. Same engine, entered by hand.
  if (a === "redeem") {
    if (!allow("leads.edit")) return json(res, 403, { error: "Mee role ki idi chese permission ledu" });
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const out = await referral.redeem(cfg, clean(b.code, 8), phone, clean(b.name, 40));
    if (!out.ok) {
      const why = out.reason === "self" ? "Adi vaari sonta code ye"
        : out.reason === "already" ? `Veeru ippatike ${out.code} code vaadaru`
        : "Aa code dorakaledu — malli chudandi";
      return json(res, 400, { error: why, reason: out.reason });
    }
    // Tell the person who sent them, straight away — that is the whole point.
    if (allow("msg.send")) {
      const first = clean(b.name, 40).split(" ")[0] || "Mee friend";
      notify.sendWa(out.owner, `🎉 ${first} garu mee code tho vachcharu — dhanyavadalu!${offer() ? ` Mee ${offer()} clinic lo cheppandi.` : ""}`).catch(() => {});
    }
    return json(res, 200, { ok: true, owner: out.owner, code: out.code });
  }

  // The thank-you was actually given. Without this nobody knows, so it gets
  // promised twice or not at all.
  if (a === "reward") {
    if (!allow("leads.edit")) return json(res, 403, { error: "Mee role ki idi chese permission ledu" });
    const owner = digits10(b.owner), brought = digits10(b.brought);
    if (!/^[6-9]\d{9}$/.test(owner) || !/^[6-9]\d{9}$/.test(brought)) return json(res, 400, { error: "Numbers sarigga ivvandi" });
    const what = clean(b.what, 80) || offer() || "Thank-you";
    const ok = await guard.kvWrite(cfg, ["HSET", `ref:rew:${owner}`, brought,
      JSON.stringify({ ts: Date.now(), by: me.name, what })], "referral reward");
    if (!ok) return json(res, 500, { error: "Save avvaledu — malli try cheyandi" });
    return json(res, 200, { ok: true });
  }

  // Given by mistake, or to the wrong person.
  if (a === "unreward") {
    if (!allow("leads.edit")) return json(res, 403, { error: "Mee role ki idi chese permission ledu" });
    const owner = digits10(b.owner), brought = digits10(b.brought);
    await guard.kvCommand(cfg, ["HDEL", `ref:rew:${owner}`, brought]).catch(() => {});
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Unknown action" });
};
module.exports.broughtBy = broughtBy;
