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
  // Some tags land straight in the WhatsApp agent chat (prefilled first message)
  // instead of the website — used for IG captions, the clinic QR standee and
  // the website QR. Each still gets its own click count above.
  const WA_TAGS = {
    jobs: "JOBS", hiring: "JOBS", careers: "JOBS",
    // Training centre page (academy.html) → course enquiry straight to the agent
    academy: "ACADEMY — Hi DermaLuxe! Training centre course details kavali (Skin & Hair treatments). Batch 20 Oct 2026.",
    training: "ACADEMY — Hi DermaLuxe! Training centre course details kavali (Skin & Hair treatments). Batch 20 Oct 2026.",
    course: "ACADEMY — Hi DermaLuxe! Training centre course details kavali (Skin & Hair treatments). Batch 20 Oct 2026.",
    // Instagram bio link + story links → straight into the WhatsApp agent
    // (owner's call, 2026-09-11: "andaru WhatsApp agent ki connect avvali")
    insta: "Hi DermaLuxe! Instagram nunchi vastunna. Free AI skin & hair analysis kavali.",
    story: "Hi DermaLuxe! Instagram story nunchi vastunna. Free AI skin & hair analysis kavali.",
    fb: "Hi DermaLuxe! Facebook nunchi vastunna. Free AI skin & hair analysis kavali.",
    book: "Book Appointment", clinic: "Book Appointment", qr: "Hi",
    // site CTAs — same agent, counted per placement so the funnel report
    // shows which button actually converts
    topbar: "Hi DermaLuxe! I'd like to book a consultation.",
    footer: "Hi DermaLuxe! I'd like to book a consultation.",
    fab: "Hi DermaLuxe! I'd like to book a consultation.",
    mbar: "Hi DermaLuxe! I'd like to book a consultation.",
    assistant: "Hi DermaLuxe! Appointment book cheyali",
    webchat: "Hi DermaLuxe! Website chat nunchi vastunna — appointment book cheyali",
  };
  if (WA_TAGS[tag]) {
    let text = WA_TAGS[tag];
    // Instagram bio/story link: mention today's auto-post topic so the agent
    // knows what the patient saw (and marketing can attribute the lead).
    if ((tag === "insta" || tag === "story") && cfg) {
      try {
        const t = await guard.kvCommand(cfg, ["GET", "dp:today"]);
        const today = t && t.result ? JSON.parse(t.result) : null;
        if (today && today.h1) text = `Hi DermaLuxe! Instagram lo "${today.h1}" post chusanu. Free AI skin & hair analysis kavali.`;
      } catch (e) {}
    }
    res.setHeader("Location", "https://wa.me/919959134666?text=" + encodeURIComponent(text));
  } else {
    res.setHeader("Location", `https://www.dermaluxe.ai/?utm_source=${tag}&utm_medium=smartlink&utm_campaign=${tag}`);
  }
  return res.end();
};
