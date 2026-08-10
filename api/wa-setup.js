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
      `https://graph.facebook.com/v21.0/${WABA}/message_templates?fields=name,status,category,quality_score&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const d = await r.json().catch(() => ({}));
    return res.status(200).json({
      waba: WABA,
      templates: (d.data || []).map((t) => ({ name: t.name, status: t.status, category: t.category })),
      error: d.error && d.error.message,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message) });
  }
};
