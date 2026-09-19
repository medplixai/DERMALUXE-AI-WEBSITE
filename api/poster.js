// /api/poster — build a daily poster and show it in the app, without posting.
//
// The only way to see what tomorrow's poster would look like was a URL with
// the admin key pasted into it, which then sent the picture to WhatsApp. The
// owner asked to see it right there in the Today's post tab instead.
//
// This runs the real builder — the planner, the Gemini photograph drawn for
// the headline, the vision check and redraws, the doctor at the foot — with
// preview on, so it leaves no trace: nothing queued, nothing published, the
// topic and the look not marked as used. The picture is kept two hours so the
// app can show it, then it expires.
const guard = require("./_guard.js");
const staff = require("./staff.js");
const daily = require("./_daily.js");

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
  // The same people who may put a post out may look at one before it goes.
  if (!allow("posts.toggle")) return json(res, 403, { error: "Mee role ki posts permission ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "topics");

  // What can be previewed: every poster in the library, academy ones first.
  if (a === "topics") {
    const row = (t) => ({ key: t.key, h1: t.h1, pillar: t.pillar });
    return json(res, 200, { ok: true, topics: daily.ACADEMY_TOPICS.map(row).concat(daily.TOPICS.map(row)) });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });

  if (a === "preview") {
    // Each one is a planner call, one to three image generations and a render.
    // Enough to compare a handful; not enough to run up a bill by leaning on it.
    const rl = await guard.rateLimit(cfg, `rl:poster:${me.phone}`, 12, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Ee gantalo chaala previews ayyayi — konchem taruvata try cheyandi" });

    const known = daily.ACADEMY_TOPICS.concat(daily.TOPICS).map((t) => t.key);
    const topic = String(b.topic || "");
    if (topic && known.indexOf(topic) === -1) return json(res, 400, { error: "Aa topic ledu" });

    const t0 = Date.now();
    let out;
    try {
      out = await daily.createDailyPost(cfg, { preview: true, topic: topic || undefined, by: me.name });
    } catch (e) {
      console.error("poster: preview failed", e && e.message);
      return json(res, 502, { error: "Poster ready avvaledu — malli try cheyandi" });
    }
    return json(res, 200, {
      ok: true,
      imgId: out.imgId,
      topic: out.topic.key, h1: out.topic.h1, te: out.topic.te, sub: out.topic.sub,
      look: (out.topic.look && out.topic.look.key) || "",
      doctor: out.doctor || "",
      hadImage: out.hadImage,
      caption: out.caption,
      ms: Date.now() - t0,
    });
  }

  return json(res, 400, { error: "Unknown action" });
};
