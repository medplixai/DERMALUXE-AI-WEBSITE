# DermaLuxe WhatsApp AI Agent — Setup Guide

Claude-powered WhatsApp receptionist on `/api/whatsapp`. Patients message the
clinic number → the agent replies in Telugu/English, shares clinic info
(never prices), collects booking details, and every booking lands in the
leads dashboard **and** the Medicare Connector queue (`type: whatsapp`).

```
Patient WhatsApp ──► Twilio number ──► POST /api/whatsapp?token=…
                                          │  Claude (AI_MODEL) + 24h memory (KV)
                                          │  booking → dl_leads + Medicare Connector
                                          ◄─ TwiML reply
```

## 1. Quick demo — Twilio Sandbox (10 minutes, free)

1. Sign up / log in at twilio.com → Console → **Messaging → Try it out →
   Send a WhatsApp message** (the Sandbox page).
2. From your phone, send the shown join code (e.g. `join xxx-xxx`) to the
   sandbox number **+1 415 523 8886**.
3. In *Sandbox settings*, set **"When a message comes in"** to
   `https://www.dermaluxe.ai/api/whatsapp?token=<WA_WEBHOOK_TOKEN>` (POST).
4. Set the env vars below, redeploy, and WhatsApp the sandbox number —
   the DermaLuxe agent replies.

## 2. Vercel environment variables

| Variable | Value | Notes |
|---|---|---|
| `WA_AGENT_ENABLED` | `1` | turns Claude replies on (else static info reply) |
| `WA_WEBHOOK_TOKEN` | any long random string | must match the `?token=` in the webhook URL |
| `TWILIO_AUTH_TOKEN` | from Twilio console | optional but recommended — validates X-Twilio-Signature |
| `ANTHROPIC_API_KEY` | already set | reused from AI analysis |
| `AI_MODEL` | optional | default `claude-sonnet-5` |

After adding env vars: Deployments → **Redeploy** once.

## 3. Production — real clinic number

WhatsApp Business API numbers **cannot simultaneously use the normal WhatsApp
app**. Recommended: keep **+91 99491 34666** on the phone app as-is, and put
the agent on the second number **+91 99591 34666** (or a new number):

1. Twilio Console → Messaging → **Senders → WhatsApp senders → New sender**.
2. Connect the number via Meta business verification (Twilio guides you;
   needs Facebook Business Manager — the DermaLuxe FB page/account works).
3. Set the same webhook URL on the sender.
4. Optional profile: DermaLuxe logo, address, dermaluxe.ai.

## 4. Behaviour & safety

- Replies mirror the patient's language (Telugu / Tenglish / English).
- No prices, no diagnoses — always steers to consultation/visit.
- Booking: name + concern + preferred day/time → lead appears in
  [leads.html](https://www.dermaluxe.ai/leads.html) under **WhatsApp** filter
  (⇅ badge when Medicare Connector is live).
- 24h conversation memory per patient (Vercel KV, auto-expires).
- Rate limits: 15 msgs/hour per patient, 400/day global; static fallback reply
  if Claude/KV are unavailable — never leaves a patient unanswered.
- Webhook locked by `?token=` + optional Twilio signature validation.

## 5. Testing without WhatsApp

```bash
curl -s -X POST "https://www.dermaluxe.ai/api/whatsapp?token=<WA_WEBHOOK_TOKEN>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "From=whatsapp:+919876543210" \
  --data-urlencode "ProfileName=Test Patient" \
  --data-urlencode "Body=hydrafacial gurinchi cheppandi"
```
Returns TwiML `<Response><Message>…</Message></Response>`.

## Media upgrades (2026-08-07)
- **📸 Photo skin analysis**: patient sends a skin/hair photo → Claude vision replies with a compact pre-assessment (scores, findings, tip, treatment suggestions, booking CTA, disclaimer). Caption becomes the concern. Limits: 3 photos/day per phone (`rl:wa:img:`), shares the site's global AI cap (`rl:an:g:` 300/day). Oversized (>4.5MB) or failed downloads get polite bilingual fallbacks.
- **🎤 Voice notes**: transcribed by Gemini (`GEMINI_API_KEY` env, model `STT_MODEL` default gemini-2.0-flash — free tier is plenty), then the normal Claude flow answers. Telugu/Tenglish/English all supported. 10 voice notes/day per phone (`rl:wa:vc:`). Without the key, voice gets a "please type" fallback — no crash.
- History markers: photo turns are stored as `[📷 photo] <caption>`, voice as `[🎤] <transcript>`, so follow-up questions keep context.
- vercel.json sets `maxDuration: 60` for api/whatsapp.js + api/analyze.js (media download + vision can exceed the 10s default).

## Engagement upgrades (2026-08-07 night)
- **Quick-menu buttons**: the first reply of every conversation ships as an interactive message with 📅 Book Now / 💆 Services / 📸 Skin Check reply buttons (falls back to plain text if rejected). Taps arrive as text and the system prompt maps them to flows.
- **Location pin**: when the patient asks address/directions (Claude sets `send_location`, plus a Telugu/English keyword fallback), a live map pin (16.7107, 81.0952) is sent after the text reply.
- **Returning-patient memory**: lead capture also writes `wa:p:<phone>` = {name, concern} with a 180-day TTL; when a conversation starts fresh (24h history expired) the profile is injected as context so the agent greets by name and continues from the last concern.
