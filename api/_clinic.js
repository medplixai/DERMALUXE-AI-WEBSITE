// ─── MEDICARE CONNECTOR ─────────────────────────────────────────────────────
// Bridge between dermaluxe.ai and the Medicare clinic platform
// (patient billing / doctor Rx / pharmacy). The platform is multi-tenant and
// currently runs on the vendor's domain, so every setting lives in env vars:
// hooking up the DermaLuxe tenant later is config-only — no code changes.
//
//   CLINIC_SYNC_URL    – endpoint that receives bookings / service bookings / leads
//   CLINIC_API_KEY     – bearer token for that endpoint (optional if URL is pre-signed)
//   CLINIC_TENANT_ID   – DermaLuxe Eluru tenant id in the multi-tenant system
//   CLINIC_PORTAL_URL  – patient portal login URL (appointments / Rx / medicines / bills)
//   CLINIC_BOOKING_URL – optional hosted booking page for the tenant
//
// Until CLINIC_SYNC_URL is set, forwardLead() is a no-op and the site behaves
// exactly as before (leads stay in our KV store only).
const guard = require("./_guard.js");
const PENDING_KEY = "dl_sync_pending";

function clinicConfig() {
  const e = process.env;
  return {
    syncUrl: e.CLINIC_SYNC_URL || "",
    apiKey: e.CLINIC_API_KEY || "",
    tenantId: e.CLINIC_TENANT_ID || "",
    portalUrl: e.CLINIC_PORTAL_URL || "",
    bookingUrl: e.CLINIC_BOOKING_URL || "",
  };
}

// Normalised payload contract (documented in INTEGRATION.md).
function toClinicPayload(lead) {
  const c = clinicConfig();
  const payload = {
    source: "dermaluxe.ai",
    tenant_id: c.tenantId || undefined,
    event: lead.type, // booking | teleconsult | ai_lead | ai_report
    external_id: `dlx-${lead.ts}-${lead.phone}`,
    created_at: new Date(lead.ts).toISOString(),
    patient: {
      name: lead.name,
      phone: `+91${lead.phone}`,
      age: lead.age || undefined,
      gender: lead.gender || undefined,
    },
    concern: lead.concern || undefined,
    message: lead.message || undefined,
    requested_treatments: lead.treatments && lead.treatments.length ? lead.treatments : undefined,
    page: lead.page || undefined,
  };
  if (lead.date || lead.slot || lead.mode) {
    payload.appointment = {
      date: lead.date || undefined,
      slot: lead.slot || undefined,
      mode: lead.mode || undefined, // Clinic Visit | Video | Phone
    };
  }
  if (lead.skin_score != null || lead.hair_score != null) {
    payload.ai_assessment = {
      skin_score: lead.skin_score,
      hair_score: lead.hair_score,
      skin_age: lead.skin_age,
      skin_type: lead.skin_type || undefined,
    };
  }
  return payload;
}

// POST the lead to the clinic platform. On failure the lead is parked in a
// pending queue so /api/sync-retry can re-push it later. Never throws.
async function forwardLead(kvCfg, lead) {
  const c = clinicConfig();
  if (!c.syncUrl) return { attempted: false, synced: false };
  try {
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toClinicPayload(lead)),
    };
    if (c.apiKey) opts.headers.Authorization = `Bearer ${c.apiKey}`;
    if (c.tenantId) opts.headers["X-Tenant-ID"] = c.tenantId;
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      opts.signal = AbortSignal.timeout(4500);
    }
    const r = await fetch(c.syncUrl, opts);
    if (!r.ok) throw new Error(`clinic sync HTTP ${r.status}`);
    return { attempted: true, synced: true };
  } catch (e) {
    try {
      if (kvCfg) {
        await guard.kvCommand(kvCfg, ["LPUSH", PENDING_KEY, JSON.stringify(lead)]);
        await guard.kvCommand(kvCfg, ["LTRIM", PENDING_KEY, "0", "999"]);
      }
    } catch (e2) {}
    return { attempted: true, synced: false };
  }
}

module.exports = { clinicConfig, toClinicPayload, forwardLead, PENDING_KEY };
