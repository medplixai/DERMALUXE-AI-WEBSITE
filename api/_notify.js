// Instant WhatsApp lead alerts to the care team the moment any channel
// (WhatsApp / Instagram / Messenger / website) captures a lead.
// Recipients: LEAD_NOTIFY_PHONES env (comma list) — defaults to Sowmya
// (grievance/lead officer) + the hospital mobile, per the owner's request.
//
// Free-form Cloud API messages only deliver inside each recipient's 24h
// service window, so the alert footer nudges a tiny "ok" reply that keeps the
// window open. 131047 in the logs = a recipient's window closed (they should
// message the agent once to reopen it). One alert per sender per 6h window —
// the agents re-save enriched copies of the same lead as the chat progresses.
const guard = require("./_guard.js");

const DEFAULT_TO = "9989325777,9949134666";

// Bare Cloud-API text send to a local 10-digit number. Returns true on 2xx.
async function sendWa(digits, text) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!token || !phoneId || to.length !== 10) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, text: { body: String(text).slice(0, 3500) } }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("notify: send failed", to, r.status, d); // 131047 = 24h window closed
      return false;
    }
    return true;
  } catch (e) {
    console.error("notify: send error", to, e && e.message);
    return false;
  }
}

// Template message send (works OUTSIDE the 24h window — reminders/broadcasts).
// params = array of strings for {{1}}, {{2}}... in the template body.
// params: body variables. opts.urlSuffix: value for a dynamic URL button ({{1}} at the end of the link).
async function sendWaTemplate(digits, templateName, params, lang, opts) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!token || !phoneId || to.length !== 10 || !templateName) return { ok: false, msg: "bad args" };
  try {
    const payload = {
      messaging_product: "whatsapp", to: `91${to}`, type: "template",
      template: {
        name: templateName,
        language: { code: lang || "en" },
        components: (() => {
          const c = [];
          if (params && params.length) c.push({ type: "body", parameters: params.map((v) => ({ type: "text", text: String(v).slice(0, 500) })) });
          if (opts && opts.urlSuffix) c.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(opts.urlSuffix).slice(0, 200) }] });
          return c;
        })(),
      },
    };
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("notify: template send failed", to, r.status, JSON.stringify(d).slice(0, 250));
      return { ok: false, msg: (d.error && d.error.message || "send fail").slice(0, 120) };
    }
    // Volume counters for the weekly report (tpl:sent:<day>[:<name>], 40d)
    try {
      const cfg = guard.kvConfig();
      if (cfg) {
        const day = guard.today();
        for (const k of [`tpl:sent:${day}`, `tpl:sent:${day}:${templateName}`]) {
          await guard.kvCommand(cfg, ["INCR", k]);
          await guard.kvCommand(cfg, ["EXPIRE", k, "3456000"]);
        }
      }
    } catch (e) {}
    return { ok: true };
  } catch (e) {
    console.error("notify: template send error", to, e && e.message);
    return { ok: false, msg: String(e && e.message).slice(0, 120) };
  }
}

// Forward a received WhatsApp document (CV) to a team number by media id.
async function sendWaDocument(digits, mediaId, filename, caption) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!token || !phoneId || to.length !== 10 || !mediaId) return false;
  try {
    const doc = { id: mediaId };
    if (filename) doc.filename = String(filename).slice(0, 120);
    if (caption) doc.caption = String(caption).slice(0, 900);
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, type: "document", document: doc }),
    });
    if (!r.ok) {
      let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
      console.error("notify: doc send failed", to, r.status, d);
      return false;
    }
    return true;
  } catch (e) {
    console.error("notify: doc send error", to, e && e.message);
    return false;
  }
}

// Send a document by public link (PDF from our own site / api/doc.js).
async function sendWaDocLink(digits, url, filename, caption) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!token || !phoneId || to.length !== 10 || !url) return false;
  try {
    const document = { link: url };
    if (filename) document.filename = String(filename).slice(0, 120);
    if (caption) document.caption = String(caption).slice(0, 900);
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, type: "document", document }),
    });
    if (!r.ok) { let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {} console.error("notify: doclink failed", to, r.status, d); return false; }
    return true;
  } catch (e) { console.error("notify: doclink error", to, e && e.message); return false; }
}
// Send an image by public link.
async function sendWaImageLink(digits, url, caption) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!token || !phoneId || to.length !== 10 || !url) return false;
  try {
    const image = { link: url };
    if (caption) image.caption = String(caption).slice(0, 900);
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, type: "image", image }),
    });
    return r.ok;
  } catch (e) { return false; }
}

// Clinic map pin (used in interview invites).
async function sendWaLocation(digits) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!token || !phoneId || to.length !== 10) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: `91${to}`, type: "location",
        location: {
          latitude: 16.7107, longitude: 81.0952,
          name: "DermaLuxe by Medicare Skin And Hair Clinic",
          address: "Rama Mahal, R.R. Peta, Kasturi Vari Street, Opp. Happy Mobiles, Eluru 534002",
        },
      }),
    });
    return r.ok;
  } catch (e) { return false; }
}

async function leadAlert(cfg, lead) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  if (!token || !phoneId || !lead || !lead.name) return;
  const targets = String(process.env.LEAD_NOTIFY_PHONES || DEFAULT_TO)
    .split(",").map((s) => s.replace(/\D/g, "").slice(-10)).filter(Boolean);
  if (!targets.length) return;

  if (cfg && (lead.src_id || lead.phone)) {
    try {
      const nx = await guard.kvCommand(cfg,
        ["SET", `ntf:${lead.type || "lead"}:${lead.src_id || lead.phone}`, "1", "NX", "EX", "21600"]);
      if (!nx.result) return; // already alerted for this conversation window
    } catch (e) {}
  }

  const when = [lead.date, lead.slot, lead.mode].filter(Boolean).join(" · ");
  const heatTag = lead.heat === "hot" ? " 🔥 HOT" : lead.heat === "warm" ? " 🌤 Warm" : "";

  // Ring the staff app too. Every channel — website, WhatsApp, Instagram,
  // Messenger, a missed call — funnels through here, so one hook covers all of
  // them. Only people whose role lets them see leads get the notification.
  try {
    const push = require("./_push.js");
    if (push.enabled()) {
      await push.notifyCap(cfg, "leads.view", {
        title: `${lead.heat === "hot" ? "🔥 Hot lead" : "New lead"} — ${lead.name}`,
        body: [lead.concern || "", lead.phone ? `📱 ${lead.phone}` : "", when].filter(Boolean).join(" · ").slice(0, 160) || "Kotha lead vachindi",
        tab: "leads",
        urgent: lead.heat === "hot",
        data: { kind: "lead", phone: lead.phone || "", src: lead.type || "web" },
      });
    }
  } catch (e) { console.error("push: lead alert", e && e.message); }

  const body = [
    `🚨 *New Lead!*${heatTag} (${lead.type || "website"})`,
    `👤 ${lead.name}`,
    lead.phone ? `📱 ${lead.phone}` : "",
    lead.concern ? `💬 ${lead.concern}` : "",
    when ? `📅 ${when}` : "",
    lead.call_prep ? `📋 ${lead.call_prep}` : "",
    "",
    "Anni leads: dermaluxe.ai/leads.html",
    "_(Reply *ok* — next alerts kuda ravadaniki)_",
  ].filter((s) => s !== "").join("\n").slice(0, 900);

  for (const to of targets) await sendWa(to, body);
}


// One-time code via an AUTHENTICATION template (delivers outside the 24-hour
// window and shows a "Copy code" button).
async function sendWaAuthCode(digits, code, templateName) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!token || !phoneId || to.length !== 10) return { ok: false, msg: "bad args" };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: `91${to}`, type: "template",
        template: {
          name: templateName || "staff_login_code", language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: String(code) }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(code) }] },
          ],
        },
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("notify: auth code failed", to, r.status, JSON.stringify(d).slice(0, 220)); return { ok: false, msg: (d.error && d.error.message || "send fail").slice(0, 140) }; }
    return { ok: true, id: (d.messages && d.messages[0] && d.messages[0].id) || "" };
  } catch (e) { console.error("notify: auth code error", to, e && e.message); return { ok: false, msg: String(e && e.message).slice(0, 120) }; }
}

// Academy notifications. Tries the dedicated UTILITY template (delivers even
// when the 24-hour window is shut); falls back to clinic_update while the new
// templates are still in Meta review.
async function sendAcademyTemplate(digits, name, params, urlSuffix, fallbackLine) {
  const first = String((params && params[0]) || "Student");
  let out = await sendWaTemplate(digits, name, params, "en", urlSuffix ? { urlSuffix } : undefined);
  if (out && out.ok) return { ok: true, via: name };
  out = await sendWaTemplate(digits, "clinic_update", [first, String(fallbackLine || "DermaLuxe Academy nunchi update — 'hi' ani reply cheyandi.").slice(0, 250)]);
  return { ok: !!(out && out.ok), via: out && out.ok ? "clinic_update" : "none" };
}

// Instagram/Messenger → WhatsApp handoff: the moment a DM lead gives a valid
// mobile number, open a WhatsApp thread with them via an approved template so
// the WhatsApp agent (slots, reminders, follow-ups) takes over. Once per
// number per 7 days. Template order: insta_lead_followup → clinic_update.
async function waHandoff(cfg, lead, channel) {
  const ph = String((lead && lead.phone) || "").replace(/\D/g, "").slice(-10);
  if (ph.length !== 10) return { ok: false, msg: "no phone" };
  if (cfg) {
    try {
      const nx = await guard.kvCommand(cfg, ["SET", `ntf:handoff:${ph}`, "1", "NX", "EX", "604800"]);
      if (!nx || !nx.result) return { ok: false, msg: "already" };
    } catch (e) {}
  }
  const first = String(lead.name || "").trim().split(" ")[0] || "friend";
  const concern = String(lead.concern || "").trim().slice(0, 40);
  const line = `Meeru ${channel} lo${concern ? " '" + concern + "' gurinchi" : ""} adigaru kada — ikkada WhatsApp lo mana team doctor slot confirm chestundi. Free AI skin & hair analysis kuda ikkade. Reply cheyandi 😊`;
  let out = await sendWaTemplate(ph, "insta_lead_followup", [first, line]);
  if (!out.ok) out = await sendWaTemplate(ph, "clinic_update", [first, line]);
  if (!out.ok && cfg) await guard.kvCommand(cfg, ["DEL", `ntf:handoff:${ph}`]).catch(() => {});
  return out;
}

module.exports = { leadAlert, sendWa, sendWaAuthCode, sendWaDocument, sendWaDocLink, sendWaImageLink, sendWaLocation, sendWaTemplate, sendAcademyTemplate, waHandoff };
