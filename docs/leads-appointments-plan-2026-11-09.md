# Leads & appointments — em jarugutondi, em cheyyali (9 Nov 2026)

Staff app, database, WhatsApp agent logs, Instagram/ads records, Vercel errors — anni chusi rasina report. Numbers anni live database nunchi (dl_leads, appt:q/appt:done, wa:*, utm:*, boost:log, tpl:sent, review:*).

## 1. Leads enni vastunnayi — week wise

| Week (Monday) | Leads total | WhatsApp patients (unique) | Note |
|---|---|---|---|
| 14 Sep | 10 | 5 | |
| 21 Sep | 54 | 28 | broadcasts + academy campaign |
| 28 Sep | 111 | 49 | peak — we_miss_you / lead_checkin broadcasts |
| 5 Oct | 32 | 14 | NMC rules 6 Oct nunchi, broadcasts aagayi |
| 12 Oct | 10 | 4 | |
| 19 Oct | 5 | 3 | |
| 26 Oct | 5 | 2 | **lowest** |
| 2 Nov | 82 | 37 | grand opening 6 Nov, owner Instagram promotions |
| 9 Nov (Mon only) | 17 | 8 | |

Last 3 weeks lo leads ekkadi nunchi (job enquiries teesesi):

| Source | Leads | Phone undi | Slot book ayindi |
|---|---|---|---|
| WhatsApp organic (website, QR, Insta bio, word of mouth) | 66 | 50 | 13 |
| Owner Instagram promotions (5 Nov nunchi, 2 ads) | 37 | 37 | 9 |
| Instagram DM | 7 | 3 | 0 |
| Instagram comments (praise — ippudu separate group) | 12 | 0 | 0 |
| Phone / walk-in / website form | 4 | 4 | 1 |

**October lo leads endhuku padipoyayi:**
1. September surge WhatsApp broadcasts valla vachindi (we_miss_you 40, lead_checkin 49 messages). NMC rules 6 Oct nunchi promo broadcasts aapesam — aa source pothe weekly 3–5 ki padipoyindi.
2. Automatic poster boosts (₹300 / 3 rojulu / 30 km, roju oka poster) 15 Oct nunchi 31 boosts, ₹7,200 kharchu — kaani 10 Oct nunchi 4 Nov varaku **oka WhatsApp chat kuda ee ads nunchi raledu** (ad referral records zero; 30-day records anni unnayi, so idi miss kaadu). Ads run ayyayi, results raledu.
3. 5 Nov nunchi meeru Instagram lo direct ga promote chesina 2 ads → 5 rojullo 37 leads, 9 slot bookings. **Idi work ayindi.** Automatic boosts kante idi chala better.
4. Home campaigns (clinic ₹100/day, academy ₹100/day) results ee Mac lo chudalem (Meta token Vercel lo matrame undi) — Ads Manager lo chudali.
5. Google side: GBP API approval pending, Vercel Web Analytics on lo ledu — website ki entha mandi vastunnaro ekkada kanipinchadu (gtag undi, GA4 lo chudali).
6. Website → WhatsApp button clicks week ki ~100–150 unnayi, kaani aa weeks lo WhatsApp lo 2–4 mandi matrame matladaru. Click chesi message pampakunda vellipotunnaru (leda bots). Real conversion ~5–10%.

## 2. Appointments endhuku book avvatledhu

1. **Agent book chestondi, team confirm cheyyatledu.** Opening week lo agent 14 slots hold chesindi, ee week 4. Queue lo 5 waiting — **1 matrame confirm call ayindi**. Agent patient ki "team call chesi confirm chestundi" ani cheptondi; aa call raakapothe patient raadu.
2. **Evaru vacharo app ki teliyadu.** 33 "done" appointments lo 28 slot time tarvata 3 gantalaki automatic ga close ayyayi — evaru "vacharu / raledu" ani mark cheyyaledu. Mottam 1 note matrame (hemasri, ee roju). So "appointments avvatledu" ani app lo kanipistondi kaani actual ga enta mandi vacharo record ledu.
3. **Desk first touch late.** WhatsApp leads ki first status average **39 gantalu** tarvata; 53 lo 39 leads 4 gantalu daati touch ayyayi. Instagram comment leads 11 inka "new".
4. **Calls lift cheyyatledu.** Desk outcomes lo 121 lo **80 "no answer"**, 24 "not interested". Telliyani number nunchi call vasthe patients lift cheyyaru.
5. **Agent quality 42–58 / 100** (daily AI review, 5–8 Nov): HT ki ₹59,999 price cheppindi, oka chat lo 8 sarlu "please wait" repeat, "Hi" cheppina patient ki concern adagakunda tips ichindi, town telisaka slot offer cheyyaledu. Ee roju 40 chats lo **10 first message tarvata aagipoyayi** (language adigina chota drop).
6. **Anthropic (Claude) credits 7 Nov madhyahnam ayipoyayi** (15:28–16:50 IST): 4 WhatsApp patients, Instagram, website chat ki fallback line matrame vellindi; re-engage follow-ups 24 Sep nunchi 12 sarlu fail ayyayi ide karanam tho. Auto-reload pettali.
7. **Billing app lo ledu** (0 bills, 0 consultations). Revenue per source, cost per patient — emi lekka vesthalem.
8. Staff logins: hemasri roju (6 Nov nunchi), Vineetha last 7 Nov, Sowmya 9 Nov. 289 leads lo 257 inka Sowmya peru meeda (old default owner). Push notifications 8 devices.

## 3. Plan — order lo

### Ee week (leaks aapadam — kharchu ledu)

| # | Em cheyyali | Evaru | Eppudu |
|---|---|---|---|
| 1 | Anthropic console lo auto-reload on cheyyandi (credits ayipothe agent mute avutundi) | Owner | ee roju |
| 2 | Queue lo unna 5 slots ki confirm call | hemasri | ee roju |
| 3 | Appts tab paina **"Confirm pending"** list + reception ki push; slot hold ayina 30 nimishallo call rule (9 AM–9 PM) | Claude (code) + hemasri | 1–2 rojulu |
| 4 | Auto "done" teeseyadam → slot time + 1 ganta ki reception ki "vacharu / raledu?" prompt; no answer aithe "no-show?" status | Claude (code) | 2 rojulu |
| 5 | Kotha lead → reception + manager ki push, 15 nimishala SLA; 1 ganta daatithe red badge; default lead owner Sowmya → hemasri | Claude (code), owner ok | 2 rojulu |
| 6 | Call mundu WhatsApp: "DermaLuxe nunchi hemasri 5 nimishallo 99491 34666 nunchi call chestaru" (utility template) — pickup rate perugutundi; 2 no-answer tarvata WhatsApp-only follow-up | Claude (template + code) | 3 rojulu |
| 7 | Agent fixes: language mundu adagadam teesi concern buttons (Skin / Hair / Book) tho start; HT/treatment price eppudu cheppoddu (hard block); town telisaka ventane 2 slot buttons; "please wait" loop 1 sari matrame | Claude (code + tests) | 3 rojulu |
| 8 | Instagram DM lo "number share" quick reply + 2 gantala tarvata insta_lead_followup | Claude | 3 rojulu |

### 2nd week (demand)

| # | Em cheyyali | Evaru |
|---|---|---|
| 9 | Automatic poster boosts **pause** (₹300/day → 0 chats). Aa money meeru 5 Nov chesina laanti promotions ki | Owner ok → Claude |
| 10 | Ads Manager lo last 30 days spend + results screenshot (leda staff app → Ads tab → overview) | Owner |
| 11 | Oka proper click-to-WhatsApp campaign: ₹500/day, Eluru 30 km, 3 creatives (hair fall, acne/pigmentation, laser hair removal) — NMC lo ne: doctor photos ledu, price/"free" ledu, patient result photos ledu. Creatives nenu draft chestanu, meeru ok cheppali | Claude draft → owner ok |
| 12 | GBP: API approval vachhe varaku weekly manual post; "Book on WhatsApp" link; visit ayina prathi patient ki visit_rating (already undi) | Owner / hemasri |
| 13 | Vercel dashboard → Analytics → Enable (free). Website traffic kanipistundi | Owner |
| 14 | 326 paata leads ki NMC-safe informational message (clinic open, doctors, timings — promo kaadu, discount kaadu). Content nenu rastanu, meeru ok cheppali | Owner decision |
| 15 | Referral codes (56 unnayi) — visit tarvata automatic ga share | Claude |

### 3rd–4th week (measure)

| # | Em cheyyali |
|---|---|
| 16 | Prathi visit app lo bill — appudu source wise revenue, cost per patient weekly scoreboard lo vastundi |
| 17 | Prathi Monday 9 AM owner ki: leads by source, first-call speed, booked, vacharu, revenue — oka message |

### Targets (4 weeks)

| Metric | Ippudu | Target |
|---|---|---|
| Leads / week | ~17 (ee week pace) | 40 |
| Slots booked / week | 4 | 15 |
| Confirm call within 30 min | 1 of 5 | 100% |
| First touch time | 39 h | < 1 h (9 AM–9 PM) |
| Arrived / no-show marked | 1 of 33 | 100% |

## 4. Owner nunchi kavalsinavi
1. Anthropic auto-reload (meeru console lo; key chat lo paste cheyyoddu).
2. Auto-boosts pause ki ok, kotha campaign budget ki ok.
3. hemasri default lead owner + tana phone lo staff app notifications on — ok?
4. Ads Manager spend/results (screenshot chalu).
5. Paata leads ki informational message pampala — avuna kaada?
