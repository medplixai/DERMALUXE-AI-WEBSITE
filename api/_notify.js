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
  const body = [
    `🚨 *New Lead!* (${lead.type || "website"})`,
    `👤 ${lead.name}`,
    lead.phone ? `📱 ${lead.phone}` : "",
    lead.concern ? `💬 ${lead.concern}` : "",
    when ? `📅 ${when}` : "",
    "",
    "Anni leads: dermaluxe.ai/leads.html",
    "_(Reply *ok* — next alerts kuda ravadaniki)_",
  ].filter((s) => s !== "").join("\n").slice(0, 900);

  for (const to of targets) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, text: { body } }),
      });
      if (!r.ok) {
        let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
        console.error("notify: lead alert failed", to, r.status, d);
      }
    } catch (e) {
      console.error("notify: lead alert error", to, e && e.message);
    }
  }
}

module.exports = { leadAlert };
