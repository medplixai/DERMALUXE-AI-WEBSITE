# Medicare Connector — Integration Guide

Bridge between **www.dermaluxe.ai** and the **Medicare clinic platform** (patient
billing / doctor Rx / pharmacy — multi-tenant). The website is already wired;
connecting the DermaLuxe tenant is **configuration only** — no code changes.

```
dermaluxe.ai (website)                    Medicare platform (multi-tenant)
┌───────────────────────┐                 ┌────────────────────────────────┐
│ Booking form          │──┐              │                                │
│ Teleconsult form      │──┼─ /api/lead ─▶│  CLINIC_SYNC_URL (webhook/API) │
│ AI Analysis leads     │──┘   +KV store  │  → tenant: DermaLuxe Eluru     │
│                       │                 │                                │
│ portal.html ──────────┼── link ────────▶│  CLINIC_PORTAL_URL (patient    │
│ (Patient Portal page) │                 │   login: Rx/medicines/bills)   │
└───────────────────────┘                 └────────────────────────────────┘
```

## 1. Environment variables (set in Vercel → Project → Settings → Environment Variables)

| Variable | Required | Purpose |
|---|---|---|
| `CLINIC_SYNC_URL` | to enable sync | HTTPS endpoint on the Medicare platform that receives bookings/leads (POST JSON) |
| `CLINIC_API_KEY` | recommended | Sent as `Authorization: Bearer <key>` |
| `CLINIC_TENANT_ID` | recommended | DermaLuxe Eluru tenant id; sent as `X-Tenant-ID` header and `tenant_id` in payload |
| `CLINIC_PORTAL_URL` | for patient portal | Tenant-specific patient login URL; activates the button on `/portal.html` |
| `CLINIC_BOOKING_URL` | optional | Hosted booking page of the tenant (exposed via `/api/config`) |

After setting env vars, **redeploy** once (Vercel → Deployments → Redeploy) so
functions pick them up. Until `CLINIC_SYNC_URL` is set the site works exactly as
today (leads stored in our KV only, dashboard at `/leads.html`).

## 2. Webhook contract — what the Medicare endpoint will receive

`POST CLINIC_SYNC_URL` · headers: `Content-Type: application/json`,
`Authorization: Bearer <CLINIC_API_KEY>`, `X-Tenant-ID: <CLINIC_TENANT_ID>`

```json
{
  "source": "dermaluxe.ai",
  "tenant_id": "<CLINIC_TENANT_ID>",
  "event": "booking",                       // booking | teleconsult | ai_lead | ai_report
  "external_id": "dlx-1754460000000-9949134666",   // unique & idempotent per lead
  "created_at": "2026-08-06T10:30:00.000Z",
  "patient": {
    "name": "Lakshmi Prasanna",
    "phone": "+919876543210",
    "age": "28",                            // optional
    "gender": "Female"                      // optional
  },
  "appointment": {                          // present for booking / teleconsult
    "date": "2026-08-08",
    "slot": "Morning",
    "mode": "Clinic Visit"                  // Clinic Visit | Video | Phone
  },
  "concern": "Acne & Scars",                // optional
  "message": "…",                           // optional, ≤400 chars
  "requested_treatments": ["PRP Hair Therapy"],   // optional, from AI report
  "ai_assessment": {                        // present for ai_report leads
    "skin_score": 72, "hair_score": 58,
    "skin_age": 38, "skin_type": "Oily"
  },
  "page": "https://www.dermaluxe.ai/#contact"
}
```

**Expected response:** any `2xx` = accepted. Non-2xx / timeout (>4.5s) → the lead
is parked in a retry queue on our side.

**Idempotency:** use `external_id` to de-duplicate if the same lead is re-sent
by the retry mechanism.

## 3. Retry & monitoring

- Failed forwards queue in KV (`dl_sync_pending`, capped at 1000).
- Staff dashboard `/leads.html` → **Retry Sync** button re-pushes them
  (also available as `POST /api/sync-retry` with `{ "key": ADMIN_KEY }`).
- Each lead row shows ⇅ (synced) or ⏳ (pending) once the connector is live.

## 4. Patient portal

`/portal.html` explains Appointments · Prescriptions & Medicines · Bills ·
Treatment History. Its **Open Patient Portal** button appears automatically when
`CLINIC_PORTAL_URL` is set (served via `/api/config`). Until then patients get a
WhatsApp fallback to request records.

Entry points on the site: top bar "Patient Portal", footer → Clinic column,
and a hint under the booking form.

## 5. Later: custom-domain move

When the Medicare platform moves off the vendor domain (e.g. to
`app.dermaluxe.ai` / `medicare.dermaluxe.ai`), only the same env vars change.
If deep-links/SSO (e.g. tokenised portal links per patient) become available,
extend `/api/config` — the page already consumes it.
