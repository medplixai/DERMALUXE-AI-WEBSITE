// ─── EXOTEL BRIDGE ───────────────────────────────────────────────────────────
// Indian cloud telephony → the WhatsApp agent. Twilio has no Indian numbers to
// sell, so the phone side runs on Exotel; this endpoint is what their call
// flow calls into.
//
//   /api/exotel?token=<EXOTEL_TOKEN>&event=missed         ExoPhone "missed call"
//                                                        webhook (Status=missed-call)
//   /api/exotel?token=...&event=passthru                 Passthru applet — fires
//                                                        after a Connect leg;
//                                                        rescues unanswered calls
//   /api/exotel?token=...&event=ivr&d=book               Menu/Gather keypad choice
//
// Exotel sends form-encoded POST or query-string GET, so every field is read
// from both. Any unanswered call becomes an instant WhatsApp — which also opens
// the 24h window, so the agent can keep talking to that patient for free.
const guard = require("./_guard.js");
const notify = require("./_notify.js");

const RESCUE = "Namaste! 🙏 Meeru DermaLuxe ki call chesaru — miss ayindi, sorry!\n\nIkkade WhatsApp lo cheppandi — appointment book chestam leda mee doubts ki reply chestam 😊\n\n📍 Rama Mahal, Kasturi Vari Street, Eluru\n⏰ Mon-Sat, 9 AM - 9 PM";

const IVR = {
  book: "Namaste! 🙏 Appointment kosam call chesaru kada — ikkade book chesukovachu!\n\nMee peru mariyu em problem ani cheppandi, ventane slot fix chestam 😊",
  address: "📍 *DermaLuxe by Medicare*\nRama Mahal, Door No. 3-12, Ground Floor,\nKasturi Vari Street, R.R. Peta,\nOpposite Happy Mobiles, Eluru - 534002\n\n⏰ Mon-Sat, 9 AM - 9 PM (Sunday closed)\n\nMaps: https://www.dermaluxe.ai/r/clinic",
  services: "✨ *DermaLuxe treatments:*\n\n💆‍♀️ Hair fall, PRP/GFC, hair transplant\n🌿 Acne, pigmentation, anti-aging\n⚡ Laser hair removal, Hydrafacial\n🩺 Medical dermatology (all skin problems)\n\nEe vishayam gurinchi adagandi — MD doctors tho consultation book chestam 😊",
};

// Exotel's own numbers/short codes shouldn't get patient messages.
function localTen(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

async function rescue(cfg, from, label, extra) {
  if (!from) return { ok: false, why: "no caller" };
  let go = true;
  if (cfg) {
    const nx = await guard.kvCommand(cfg, ["SET", `ntf:miss:${from}`, "1", "NX", "EX", "21600"]).catch(() => ({}));
    go = !!(nx && nx.result); // one rescue per caller per 6h
  }
  if (!go) return { ok: true, why: "deduped" };

  let sent = await notify.sendWa(from, extra || RESCUE);
  if (!sent) {
    const t = await notify.sendWaTemplate(from, "clinic_update",
      ["friend", "Meeru DermaLuxe ki call chesaru — miss ayindi, sorry! Appointment leda doubts unte ee message ki reply cheyandi 😊"]);
    sent = !!t.ok;
  }
  const team = String(process.env.LEAD_NOTIFY_PHONES || "9989325777,9949134666")
    .split(",").map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10);
  for (const to of team) {
    await notify.sendWa(to, `📞 *${label}* — ${from}\n${sent ? "Agent WhatsApp pampindi ✅" : "⚠️ WhatsApp veladu"} — meeru kuda call cheyandi 🙏`).catch(() => {});
  }
  return { ok: true, sent };
}

module.exports = async (req, res) => {
  // Its own secret, so the telephony vendor never holds the Meta webhook token.
  const secret = process.env.EXOTEL_TOKEN || process.env.WA_WEBHOOK_TOKEN || "";
  const q = req.query || {};
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const pick = (...keys) => {
    for (const k of keys) {
      if (q[k] != null && String(q[k]) !== "") return String(q[k]);
      if (b[k] != null && String(b[k]) !== "") return String(b[k]);
    }
    return "";
  };

  if (!secret || !guard.safeEqual(String(q.token || ""), secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const cfg = guard.kvConfig();
  const event = String(q.event || "").toLowerCase();
  const from = localTen(pick("CallFrom", "From", "from"));
  const status = pick("Status", "DialCallStatus", "CallStatus").toLowerCase();
  const sid = pick("CallSid", "CallId").slice(0, 40);

  // Exotel retries on non-200, so always answer 200 — details go in the body.
  try {
    if (event === "ivr") {
      const key = String(q.d || pick("digits", "Digits") || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      const map = { "1": "book", "2": "address", "3": "services", book: "book", address: "address", services: "services" };
      const msg = IVR[map[key] || "book"];
      let sent = false;
      if (from) {
        sent = await notify.sendWa(from, msg);
        if (!sent) {
          const t = await notify.sendWaTemplate(from, "clinic_update",
            ["friend", "Meeru DermaLuxe ki call chesaru! Details WhatsApp lo pampam — ee message ki reply cheyandi, appointment book chestam 😊"]);
          sent = !!t.ok;
        }
      }
      console.log("exotel: ivr", sid, from, key, sent ? "sent" : "not sent");
      return res.status(200).json({ ok: true, event, sent });
    }

    if (event === "missed") {
      const out = await rescue(cfg, from, "Missed call");
      console.log("exotel: missed", sid, from, JSON.stringify(out));
      return res.status(200).json({ ok: true, event, ...out });
    }

    // Passthru after a Connect leg: rescue only when nobody picked up.
    const unanswered = ["no-answer", "noanswer", "busy", "failed", "canceled", "cancelled", "missed-call", "missed"].indexOf(status) !== -1
      || (!status && String(pick("DialCallDuration", "ConversationDuration") || "0") === "0");
    if (unanswered) {
      const out = await rescue(cfg, from, "Call miss ayindi");
      console.log("exotel: passthru unanswered", sid, from, status, JSON.stringify(out));
      return res.status(200).json({ ok: true, event: "passthru", status, ...out });
    }
    console.log("exotel: passthru answered", sid, from, status);
    return res.status(200).json({ ok: true, event: "passthru", status, note: "answered — no message" });
  } catch (e) {
    console.error("exotel: error", e && e.message);
    return res.status(200).json({ ok: false, error: "handled" });
  }
};
