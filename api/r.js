// GET /r/<tag>  (rewritten to /api/r?tag=<tag>) — smart marketing links.
// Counts the click in KV (utm:<tag>:<date>, 90d TTL) and redirects to the
// site with UTM params so GA4 attributes the visit to the channel.
// Known tags: insta, wa, fb, gbp, story — but any short tag works.
const guard = require("./_guard.js");

module.exports = async (req, res) => {
  const tag = String((req.query || {}).tag || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "unknown";
  const cfg = guard.kvConfig();
  if (cfg) {
    const key = `utm:${tag}:${guard.today()}`;
    try {
      const n = await guard.kvCommand(cfg, ["INCR", key]);
      if (Number(n.result) === 1) await guard.kvCommand(cfg, ["EXPIRE", key, "7776000"]);
    } catch (e) {}
  }
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 302;
  // Careers links land straight in the WhatsApp hiring flow (prefilled JOBS).
  if (tag === "jobs" || tag === "hiring" || tag === "careers") {
    res.setHeader("Location", "https://wa.me/919959134666?text=JOBS");
  } else {
    res.setHeader("Location", `https://www.dermaluxe.ai/?utm_source=${tag}&utm_medium=smartlink&utm_campaign=${tag}`);
  }
  return res.end();
};
