// /api/post — Instagram and Facebook, from the app.
//
// The engine for this has been here a long time and it is good: it builds the
// media container, waits for Instagram to finish processing, publishes, cross-
// posts to the Facebook page, and a cron drains anything scheduled. What it
// has never had is a way in other than WhatsApp — the owner had to send a
// photo to the clinic's own number and type "post: <idea>". Nobody else could
// post at all, and the app's "Today's post" tab could only watch.
//
// So this drives the same engine from the dashboard. It does not reimplement
// any of it: publishing still goes through _admin.publishNow, scheduling still
// lands in the same adm:queue the cron reads, and images still live in the
// adm:img key space that /api/media serves.
//
// KV used here:
//   adm:img:<id>   the image (shared with the WhatsApp path)
//   adm:queue      scheduled posts, drained by /api/cron-post
//   post:log       what actually went out (written by publishNow)
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");
const admin = require("./_admin.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

// An image large enough to look good and small enough to survive the KV
// request limit. The WhatsApp path leans on WhatsApp's own compression; a
// phone camera straight into the app does not, so the app resizes before it
// gets here and this is the backstop.
const MAX_IMG = 1_400_000;

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("posts.view")) return json(res, 403, { error: "Mee role ki posts chuse permission ledu" });
  const canPost = allow("posts.toggle");

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "list");

  // What is waiting to go out, and what already went.
  if (a === "list") {
    const rl = await guard.rateLimit(cfg, `rl:post:${me.phone}`, 300, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Too many requests" });
    const [qRaw, lRaw] = await guard.kvPipeline(cfg, [
      ["LRANGE", "adm:queue", "0", "49"],
      ["LRANGE", "post:log", "0", "49"],
    ]).catch(() => [[], []]);

    const queue = (Array.isArray(qRaw) ? qRaw : []).map((x) => parse(x, null)).filter(Boolean)
      .map((x) => ({
        imgId: x.imgId || "", vidId: x.vidId || "",
        caption: x.caption || "", due: x.due || 0,
        kind: x.story ? "story" : x.vidId ? "reel" : "post",
        tries: x.tries || 0, by: x.by || "",
      }))
      .sort((x, y) => x.due - y.due);

    const posted = (Array.isArray(lRaw) ? lRaw : []).map((x) => parse(x, null)).filter(Boolean);

    return json(res, 200, {
      ok: true, queue, posted,
      canPost,
      // Said plainly, because it is the thing people get wrong: the account
      // these go to is the clinic's, not the person's who pressed the button.
      account: "@dermaluxe.ai",
      crossPosts: process.env.FB_CROSSPOST !== "0",
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });
  if (!canPost) return json(res, 403, { error: "Mee role ki post pette permission ledu" });
  const rlw = await guard.rateLimit(cfg, `rl:postw:${me.phone}`, 60, 3600);
  if (!rlw.allowed) return json(res, 429, { error: "Konchem aagandi" });

  // Put it out, or put it in the queue for later. One action, because from
  // the desk's side it is one decision.
  if (a === "create") {
    const m = String(b.image || "").match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
    if (!m) return json(res, 400, { error: "Photo kavali (JPEG leda PNG)" });
    const base64 = m[2];
    if (base64.length > MAX_IMG) return json(res, 413, { error: "Photo chala pedda undi — konchem chinnadi teeyandi" });

    const caption = clean(b.caption, 2200);
    const story = !!b.story;
    if (!story && !caption) return json(res, 400, { error: "Caption raayandi" });

    // Nothing may be scheduled into the past, and nothing beyond a month —
    // a typo in a date should not park a post for a year.
    let due = Number(b.due) || 0;
    if (due) {
      if (due < Date.now() - 60000) return json(res, 400, { error: "Ade poyina time ki schedule cheyyalemu" });
      if (due > Date.now() + 31 * 86400000) return json(res, 400, { error: "Nela kanna ekkuva mundu schedule cheyyalemu" });
    }

    const imgId = crypto.randomBytes(16).toString("hex");
    // A scheduled image has to outlive the wait; one going out now does not.
    const ttl = due ? Math.max(3600, Math.ceil((due - Date.now()) / 1000) + 7200) : 21600;
    const ok = await guard.kvWrite(cfg, ["SET", `adm:img:${imgId}`, base64, "EX", String(ttl)], "post image");
    if (!ok) return json(res, 500, { error: "Photo save avvaledu — malli try cheyandi" });

    if (due) {
      await guard.kvWrite(cfg, ["LPUSH", "adm:queue", JSON.stringify({
        imgId, caption, story, due, by: me.name, tries: 0,
      })], "post queue");
      console.log("post queued by", me.phone.slice(-4), "for", new Date(due).toISOString());
      return json(res, 200, { ok: true, scheduled: true, due });
    }

    const out = await admin.publishNow(cfg, { imgId, caption, story, by: me.name });
    if (!out.ok) {
      await guard.kvCommand(cfg, ["DEL", `adm:img:${imgId}`]).catch(() => {});
      return json(res, out.transient ? 503 : 400, {
        error: out.transient
          ? "Instagram inka process chestundi — oka nimisham agi malli try cheyandi"
          : `Publish kaledu: ${out.msg}`,
      });
    }
    console.log("post published by", me.phone.slice(-4), out.link || "");
    return json(res, 200, { ok: true, link: out.link || "", fb: !!out.fb, id: out.id || "" });
  }

  // Taken out of the queue before it goes anywhere.
  if (a === "cancel") {
    const imgId = clean(b.imgId, 40);
    if (!imgId) return json(res, 400, { error: "imgId kavali" });
    const r = await guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "99"]).catch(() => ({}));
    let removed = false;
    for (const raw of (r.result || [])) {
      const it = parse(raw, null);
      if (it && it.imgId === imgId) {
        await guard.kvCommand(cfg, ["LREM", "adm:queue", "1", raw]).catch(() => {});
        await guard.kvCommand(cfg, ["DEL", `adm:img:${imgId}`]).catch(() => {});
        removed = true;
        break;
      }
    }
    if (!removed) return json(res, 404, { error: "Aa post queue lo ledu — ippatike velli undochu" });
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Unknown action" });
};
