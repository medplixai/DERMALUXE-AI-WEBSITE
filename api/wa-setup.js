// GET /api/wa-setup?key=ADMIN_KEY — WhatsApp message-template toolkit.
//   default:        list all templates with status (APPROVED/PENDING/REJECTED)
//   &action=create  create appointment_reminder (UTILITY) + clinic_update
//                   (MARKETING) via the Graph API (faster than the Meta UI).
// Safe to re-run: Meta rejects duplicate names and we surface per-template
// results instead of failing the whole call.
const WABA = process.env.WA_WABA_ID || "872031789098601";
const notify = require("./_notify.js");

const TEMPLATES = [
  {
    name: "appointment_reminder",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🙏 Mee DermaLuxe appointment reminder:\n\n📅 {{2}}\n📍 DermaLuxe by Medicare, Rama Mahal, Kasturi Vari Street, Opp. Happy Mobiles, Eluru\n\nTime maarchali ante ee message ki reply cheyandi. See you! ✨",
        example: { body_text: [["Priya", "Aug 11, 6:30 PM"]] },
      },
    ],
  },
  {
    name: "clinic_update",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! ✨ DermaLuxe by Medicare, Eluru nunchi update:\n\n{{2}}\n\n📲 Appointment ki ee message ki reply cheyandi, leda call: 099591 34666",
        example: { body_text: [["Priya", "Ee week Hydrafacial pai special offer — slots limited!"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "visit_followup",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🙏 Ninna mee DermaLuxe visit ela anipinchindi?\n\nTreatment/skin care lo emaina doubts unte ee message ki reply cheyandi — free ga answer chestam 💖\n\n— DermaLuxe by Medicare, Eluru",
        example: { body_text: [["Priya"]] },
      },
    ],
  },
  {
    name: "service_followup",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🙏 Mee {{2}} tarvata results ela unnayi?\n\nEmaina doubts leda skin/hair care questions unte ee message ki reply cheyandi — free ga guide chestam 💖\n\n— DermaLuxe by Medicare, Eluru",
        example: { body_text: [["Priya", "Hydrafacial treatment"]] },
      },
    ],
  },
  {
    name: "review_reminder",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🩺 {{2}} time vachindi.\n\nSlot book cheyalante ee message ki reply cheyandi — mee convenient time fix chestam 🙏\n\n— DermaLuxe by Medicare, Eluru",
        example: { body_text: [["Priya", "Doctor suggest chesina review checkup"]] },
      },
    ],
  },
  {
    name: "session_reminder",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! ✨ Mee {{2}} next session due date vachindi.\n\nBest results ki sessions time ki complete cheyadam chala important 🙏 Slot book cheyalante ee message ki reply cheyandi.\n\n— DermaLuxe by Medicare, Eluru",
        example: { body_text: [["Priya", "PRP hair treatment"]] },
      },
    ],
  },
  {
    name: "insta_lead_followup",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 📸 Instagram lo DermaLuxe ni contact chesaru kada — {{2}}\n\nIkkada WhatsApp lo direct ga adagochu — appointments, details, anni 😊\n\n— DermaLuxe by Medicare, Eluru",
        example: { body_text: [["Priya", "Meeru 'laser hair removal' gurinchi adigaru — ee week doctor slots available unnayi!"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "festival_offer",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🪔 *{{2}} Subhakankshalu* from DermaLuxe! ✨\n\n{{3}}\n\n📲 Book cheyalante ee message ki reply cheyandi, leda call: 099591 34666\n📍 Rama Mahal, Kasturi Vari Street, Eluru",
        example: { body_text: [["Priya", "Diwali", "Festival Glow Package — Hydrafacial pai 20% off, ee week matrame!"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "flash_offer",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! ⚡ *DermaLuxe Flash Offer:*\n\n{{2}}\n\n⏰ {{3}} varaku matrame — slots limited!\n📲 Book cheyalante ee message ki reply cheyandi 🏃‍♀️",
        example: { body_text: [["Priya", "Laser hair removal package pai 25% off", "Ee Sunday (Aug 17)"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "new_service",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🎉 DermaLuxe lo *kotha service*:\n\n✨ *{{2}}*\n{{3}}\n\n📲 Details & booking ki ee message ki reply cheyandi, leda call: 099591 34666",
        example: { body_text: [["Priya", "HydraFacial Platinum", "Launch offer: first 20 bookings ki 30% off + free skin analysis!"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "free_camp",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🩺 *FREE Skin & Hair Check-up Camp* — DermaLuxe lo!\n\n{{2}}\n\n🎟 Slots limited — mee slot book cheyalante ee message ki reply cheyandi!\n📍 Rama Mahal, Kasturi Vari Street, Eluru",
        example: { body_text: [["Priya", "Ee Sunday (Aug 17) udayam 10 – sayantram 5. Doctor consultation kuda FREE!"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
];

module.exports = async (req, res) => {
  const key = String((req.query && req.query.key) || "");
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token) return res.status(500).json({ error: "WA_CLOUD_TOKEN missing" });

  // &action=test&to=<10 digits>[&name=..] — sample appointment_reminder send
  // (verifies template approval + delivery end-to-end; team numbers only).
  if (String((req.query && req.query.action) || "") === "test") {
    const to = String((req.query && req.query.to) || "").replace(/\D/g, "").slice(-10);
    if (to.length !== 10) return res.status(400).json({ error: "to=10 digits required" });
    const name = String((req.query && req.query.name) || "Test").slice(0, 30);
    const IST = 330 * 60000;
    const d = new Date(Date.now() + 86400000 + IST); // sample slot: tomorrow ~11 AM
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
    const out = await notify.sendWaTemplate(to, "appointment_reminder", [name, `${mo} ${d.getUTCDate()}, 11:00 AM`]);
    return res.status(200).json({ to, sent: out.ok, msg: out.msg || "" });
  }

  if (String((req.query && req.query.action) || "") === "create") {
    const out = [];
    for (const tpl of TEMPLATES) {
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${WABA}/message_templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(tpl),
        });
        const d = await r.json().catch(() => ({}));
        out.push({ name: tpl.name, ok: r.ok, resp: r.ok ? d : ((d.error && d.error.message) || d) });
      } catch (e) {
        out.push({ name: tpl.name, ok: false, resp: String(e && e.message) });
      }
    }
    return res.status(200).json({ created: out });
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${WABA}/message_templates?fields=name,status,category,quality_score,rejected_reason&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const d = await r.json().catch(() => ({}));
    // WABA-level health too — a post-billing account review holds template
    // approvals, so surface it alongside the per-template status.
    let account = null;
    try {
      const w = await fetch(
        `https://graph.facebook.com/v21.0/${WABA}?fields=name,account_review_status,business_verification_status`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      account = await w.json().catch(() => null);
    } catch (e) {}
    return res.status(200).json({
      waba: WABA,
      account,
      templates: (d.data || []).map((t) => ({ name: t.name, status: t.status, category: t.category, rejected_reason: t.rejected_reason })),
      error: d.error && d.error.message,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message) });
  }
};
