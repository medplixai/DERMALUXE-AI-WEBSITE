// Meta Conversions API — telling the ads what really happened.
//
// Optimising an ad set on "started a conversation" teaches Meta to find people
// who message and never come. "QualifiedLead" (ours: near, a real problem,
// means to come) and "Schedule" (a slot fixed) are what the clinic is paid
// for. Silent until META_PIXEL_ID (the dataset id) and META_CAPI_TOKEN are set.
const crypto = require("crypto");
const sha = (v) => crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

const enabled = () => !!(process.env.META_PIXEL_ID && (process.env.META_CAPI_TOKEN || process.env.META_ADS_TOKEN));

async function send(eventName, opts) {
  if (!enabled()) return { skipped: true };
  const o = opts || {};
  const user = {};
  if (o.phone) { const d = String(o.phone).replace(/\D/g, ""); user.ph = [sha(d.length === 10 ? "91" + d : d)]; }
  const body = { data: [{
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: o.eventId || undefined,
    // A chat is neither a website nor a shop visit; Meta's own bucket for it.
    action_source: o.source || "chat",
    user_data: user,
    custom_data: o.custom || undefined,
  }] };
  if (process.env.META_CAPI_TEST) body.test_event_code = process.env.META_CAPI_TEST;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN || process.env.META_ADS_TOKEN)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) console.error("capi:", eventName, r.status, JSON.stringify(d).slice(0, 200));
    return d;
  } catch (e) { console.error("capi:", eventName, e && e.message); return { error: String(e && e.message) }; }
}

module.exports = { enabled, send };
