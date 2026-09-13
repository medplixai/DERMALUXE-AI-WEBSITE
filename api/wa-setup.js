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
        text: "Hi {{1}}! ✨ DermaLuxe by Medicare, Eluru nunchi update:\n\n{{2}}\n\n📲 Appointment ki ee message ki reply cheyandi, leda call: +91 99491 34666",
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
        text: "Hi {{1}}! 🪔 *{{2}} Subhakankshalu* from DermaLuxe! ✨\n\n{{3}}\n\n📲 Book cheyalante ee message ki reply cheyandi, leda call: +91 99491 34666\n📍 Rama Mahal, Kasturi Vari Street, Eluru",
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
        text: "Hi {{1}}! 🎉 DermaLuxe lo *kotha service*:\n\n✨ *{{2}}*\n{{3}}\n\n📲 Details & booking ki ee message ki reply cheyandi, leda call: +91 99491 34666",
        example: { body_text: [["Priya", "HydraFacial Platinum", "Launch offer: first 20 bookings ki 30% off + free skin analysis!"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "daily_digest_ping",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "📊 *DermaLuxe Daily Report* ready!\n\n{{1}}\n\nFull report chudalante *report* ani reply cheyandi 👍",
        example: { body_text: [["Ninna 3 leads · ivala 2 appointments"]] },
      },
    ],
  },
  {
    name: "preop_instructions",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🙏 Mee *{{2}}* ki prepare avvadaniki konni simple instructions:\n\n• Mundu roju baga nidra povadam chala important 😴\n• 24 gantalu munde alcohol & smoking avoid cheyandi\n• Procedure roju udayam light food teeskondi (doctor fasting cheppithe adhe follow avvandi)\n• Comfortable, front-open dress vesukoni randi\n• Mundu roju head/skin clean ga wash cheyandi\n• Doctor prescribe chesina medicines regular ga continue cheyandi\n\n⚠️ Doctor personal ga cheppina instructions ivi kanna final. Emaina doubts unte ee message ki reply cheyandi 💖",
        example: { body_text: [["Priya", "FUE Hair Transplant (Aug 20, udayam 9 AM)"]] },
      },
    ],
  },
  {
    name: "aftercare_instructions",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 💖 Mee *{{2}}* successful ga complete ayindi — congratulations!\n\nIppudu care ila teeskondi:\n• Treated area ni cheyyi tho touch/rub cheyakandi\n• Direct sunlight avoid cheyandi — bayataki velithe protection tho\n• Konni rojulu heavy exercise, swimming, steam avoid\n• Doctor iccina medicines/creams full course complete cheyandi\n• Baga nidra + neellu ekkuva tagadam results ki help avutundi 💧\n\n⚠️ Ekkuva pain, swelling leda emaina worry anipisthe ventane call cheyandi: +91 99491 34666\nDoubts unte ee message ki reply cheyandi 🙏",
        example: { body_text: [["Priya", "Hydrafacial treatment"]] },
      },
    ],
  },
  {
    name: "payment_confirmed",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! ✅ Mee *₹{{2}}* advance receive ayindi — thank you! 🙏\n\n📅 Mee appointment *{{3}}* ki CONFIRMED.\nEe amount mee final bill lo adjust chestam.\n\n📍 Rama Mahal, Kasturi Vari Street, Opp. Happy Mobiles, Eluru\nTime marchali ante ee message ki reply cheyandi. See you! ✨",
        example: { body_text: [["Priya", "200", "Aug 20, 6:30 PM"]] },
      },
    ],
  },
  {
    name: "birthday_wish",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🎂 *Happy Birthday* from the DermaLuxe family! 🎉\n\nEe special roju meeku andanga, healthy ga undali ani korukuntunnam ✨\n\n🎁 {{2}}\n\n📲 Book cheyalante ee message ki reply cheyandi. Have a wonderful day! 💖",
        example: { body_text: [["Priya", "Birthday gift ga ee nela lo e treatment pai aina 20% off — mee kosam!"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "seasonal_tips",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🌿 *DermaLuxe Care Tips:*\n\n{{2}}\n\nMee skin/hair gurinchi emaina doubts unte ee message ki reply cheyandi — free ga guide chestam 💖\n\n— DermaLuxe by Medicare, Eluru",
        example: { body_text: [["Priya", "Varsha kalam lo fungal infections ekkuva — 1) Tadi battalu ventane marchandi 2) Roju rendu sarlu mild soap tho snanam 3) Chemmalu unna chotla powder vadandi"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "appointment_confirm",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🙏 Repu mee DermaLuxe appointment:\n\n📅 {{2}}\n📍 Rama Mahal, Kasturi Vari Street, Opp. Happy Mobiles, Eluru\n\nVastunnara? Okka tap tho confirm cheyandi 👇 Time maarchali ante Reschedule nokkandi.",
        example: { body_text: [["Priya", "Sep 11, 6:30 PM"]] },
      },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Vastanu" }, { type: "QUICK_REPLY", text: "Reschedule" }] },
    ],
  },
  {
    name: "visit_rating",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🙏 Mee recent DermaLuxe visit ({{2}}) ela anipinchindi?\n\nMee feedback tho manam inka better avutham — okka tap tho rating ivvandi 👇",
        example: { body_text: [["Priya", "Hydrafacial"]] },
      },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "5 Excellent" }, { type: "QUICK_REPLY", text: "4 Good" }, { type: "QUICK_REPLY", text: "3 or below" }] },
    ],
  },
  {
    name: "lead_checkin",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 🙏 Konni rojula mundu meeru DermaLuxe lo *{{2}}* gurinchi adigaru — inka aa problem undha?\n\nFirst step chala simple: MD doctor consultation lo mee skin/hair chusi exact plan cheptaru. Ee week slots available unnayi — ee message ki reply cheyandi, mee convenient time fix chestam 😊\n\n— DermaLuxe by Medicare, Eluru",
        example: { body_text: [["Priya", "hair fall"]] },
      },
      { type: "FOOTER", text: "Offers vaddu ante STOP ani reply cheyandi" },
    ],
  },
  {
    name: "we_miss_you",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}! 💖 DermaLuxe nunchi oka chinna hello!\n\nMeeru adigina *{{2}}* ki ippudu manchi time — mana Dr. Nikhitha Priyanka garu (MD DVL) tho consultation book cheskondi. Ee message ki reply cheyandi, slot fix chestam 😊\n\n📍 Rama Mahal, Kasturi Vari Street, Eluru · Mon-Sat 9 AM - 9 PM",
        example: { body_text: [["Priya", "pigmentation"]] },
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
  // ---- DermaLuxe Academy (student lifecycle) ----------------------------
  // All UTILITY: they are sent only to enrolled students about a course they
  // have paid for. Each carries a dynamic URL button so the student gets the
  // file even when the 24-hour service window is closed.
  {
    name: "academy_welcome",
    category: "UTILITY",
    language: "en",
    components: [
      { type: "BODY",
        text: "Hi {{1}}! Mee DermaLuxe Academy seat confirm ayindi.\n\nStudent ID: {{2}}\nCourse: {{3}}\nBatch starts: {{4}}\n\nOnboarding form fill cheyandi — kinda button nokkandi. Form submit chesaka receipt, admission form mariyu ID card ikkade vastayi.",
        example: { body_text: [["Priya", "DLA-1042", "Advanced Skin Care Treatments", "20 October 2026"]] } },
      { type: "FOOTER", text: "DermaLuxe Academy, Eluru" },
      { type: "BUTTONS", buttons: [
        { type: "URL", text: "Open form", url: "https://www.dermaluxe.ai/academy-join.html?t={{1}}", example: ["https://www.dermaluxe.ai/academy-join.html?t=DLA-1042.ab12cd34ef56"] },
      ] },
    ],
  },
  {
    name: "academy_daily_material",
    category: "UTILITY",
    language: "en",
    components: [
      { type: "BODY",
        text: "Hi {{1}}! Day {{2}} of 30 — {{3}}\n\nEe roju study material ready undi. Kinda button nokki mee PDF download cheskondi. Class ki mundu okasari chadavandi.",
        example: { body_text: [["Priya", "5", "Cleansing, exfoliation and the basic facial protocol"]] } },
      { type: "FOOTER", text: "Mee personal link — share cheyakandi" },
      { type: "BUTTONS", buttons: [
        { type: "URL", text: "Open material", url: "https://www.dermaluxe.ai/api/material?k={{1}}", example: ["https://www.dermaluxe.ai/api/material?k=DLA-1042.ab12cd34ef56~skin~5"] },
      ] },
    ],
  },
  {
    name: "academy_document",
    category: "UTILITY",
    language: "en",
    components: [
      { type: "BODY",
        text: "Hi {{1}}! Mee DermaLuxe Academy {{2}} ready ayindi.\n\nStudent ID: {{3}}\n\nKinda button nokki download cheskondi. Admission form aithe print chesi, sign chesi first day teesukuni randi.",
        example: { body_text: [["Priya", "admission form", "DLA-1042"]] } },
      { type: "FOOTER", text: "DermaLuxe Academy, Eluru" },
      { type: "BUTTONS", buttons: [
        { type: "URL", text: "Open document", url: "https://www.dermaluxe.ai/api/doc?id={{1}}", example: ["https://www.dermaluxe.ai/api/doc?id=9f2c1a7b4e6d8c0a"] },
      ] },
    ],
  },
  {
    name: "academy_fee_reminder",
    category: "UTILITY",
    language: "en",
    components: [
      { type: "BODY",
        text: "Hi {{1}}! DermaLuxe Academy fee reminder.\n\nStudent ID: {{2}}\nBalance: {{3}}\nDue: {{4}}\n\nPayment details kavalante ee message ki reply cheyandi, leda clinic lo direct ga pay cheyochu.",
        example: { body_text: [["Priya", "DLA-1042", "Rs 40,000", "20 October 2026 (course starting day)"]] } },
      { type: "FOOTER", text: "DermaLuxe Academy, Eluru" },
    ],
  },
  {
    name: "academy_certificate",
    category: "UTILITY",
    language: "en",
    components: [
      { type: "BODY",
        text: "Congratulations {{1}}! Meeru {{2}} course successfully complete chesaru.\n\nCertificate No: {{3}}\nGrade: {{4}}\n\nMee certificate kinda button lo undi. Job opportunities kosam ee message ki reply cheyandi.",
        example: { body_text: [["Priya", "Advanced Skin Care Treatments", "DLA/2026/0042", "A"]] } },
      { type: "FOOTER", text: "DermaLuxe Academy, Eluru" },
      { type: "BUTTONS", buttons: [
        { type: "URL", text: "Open certificate", url: "https://www.dermaluxe.ai/api/doc?id={{1}}", example: ["https://www.dermaluxe.ai/api/doc?id=9f2c1a7b4e6d8c0a"] },
      ] },
    ],
  },
  {
    name: "academy_batch_update",
    category: "UTILITY",
    language: "en",
    components: [
      { type: "BODY",
        text: "Hi {{1}}! DermaLuxe Academy batch update:\n\n{{2}}\n\nEdaina doubt unte ee message ki reply cheyandi.",
        example: { body_text: [["Priya", "Repu class 10 AM ki shift ayindi — PRP practical session undi, scrubs teesukuni randi."]] } },
      { type: "FOOTER", text: "DermaLuxe Academy, Eluru" },
    ],
  },
  // ---- Staff dashboard login code (AUTHENTICATION) ----------------------
  // Authentication templates are the only reliable way to deliver a one-time
  // code: they bypass the 24-hour service window and render a copy button.
  {
    name: "staff_login_code",
    category: "AUTHENTICATION",
    language: "en",
    message_send_ttl_seconds: 600,
    components: [
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: 5 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
    ],
  },
  // Patient-facing one-time code (website AI analysis / portal login).
  {
    name: "verification_code",
    category: "AUTHENTICATION",
    language: "en",
    message_send_ttl_seconds: 600,
    components: [
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: 5 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
    ],
  },
];

// Meta's generic "Invalid parameter" hides the useful part — surface it.
function errText(d) {
  const e = (d && d.error) || {};
  const parts = [e.message, e.error_user_title, e.error_user_msg, e.error_data ? JSON.stringify(e.error_data) : ""].filter(Boolean);
  return parts.length ? parts.join(" · ").slice(0, 400) : d;
}

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

  // &action=edit&names=a,b,c — push corrected BODY text to templates that are
  // already live at Meta. An edit sends the template back into review, so it
  // is deliberately opt-in per name rather than a blanket re-submit.
  if (String((req.query && req.query.action) || "") === "edit") {
    const wanted = String((req.query && req.query.names) || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!wanted.length) return res.status(400).json({ error: "names= required" });
    let live = [];
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${WABA}/message_templates?fields=name,id,status&limit=100`,
        { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({}));
      live = d.data || [];
      if (!r.ok) return res.status(200).json({ error: (d.error && d.error.message) || "list failed" });
    } catch (e) {
      return res.status(200).json({ error: String(e && e.message) });
    }
    const out = [];
    for (const name of wanted) {
      const tpl = TEMPLATES.find((t) => t.name === name);
      const row = live.find((t) => t.name === name);
      if (!tpl) { out.push({ name, ok: false, resp: "not in source" }); continue; }
      if (!row) { out.push({ name, ok: false, resp: "not found at Meta" }); continue; }
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${row.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ components: tpl.components }), // category can't change on edit
        });
        const d = await r.json().catch(() => ({}));
        out.push({ name, id: row.id, was: row.status, ok: r.ok, resp: r.ok ? d : errText(d) });
      } catch (e) {
        out.push({ name, ok: false, resp: String(e && e.message) });
      }
    }
    return res.status(200).json({ edited: out });
  }

  if (String((req.query && req.query.action) || "") === "create") {
    // Only submit what Meta does not already have — re-POSTing an existing
    // template just returns "Content in this language already exists" and
    // buries the real errors of the new ones.
    const have = new Set();
    try {
      const lr = await fetch(`https://graph.facebook.com/v21.0/${WABA}/message_templates?fields=name&limit=200`, { headers: { Authorization: `Bearer ${token}` } });
      const ld = await lr.json().catch(() => ({}));
      (ld.data || []).forEach((t) => have.add(String(t.name)));
    } catch (e) {}
    // &only=a,b — retry just these (ignores the "already there" skip).
    const only = String((req.query && req.query.only) || "").split(",").map((x) => x.trim()).filter(Boolean);
    const out = [];
    for (const tpl of TEMPLATES) {
      if (only.length && only.indexOf(tpl.name) === -1) continue;
      if (!only.length && have.has(tpl.name)) { out.push({ name: tpl.name, ok: false, skipped: true, resp: "already in Meta" }); continue; }
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${WABA}/message_templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(tpl),
        });
        const d = await r.json().catch(() => ({}));
        out.push({ name: tpl.name, ok: r.ok, resp: r.ok ? d : errText(d) });
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
