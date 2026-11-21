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

// Meta takes a plain message to a shut 24-hour window with a 200 and drops it
// a moment later (131047, on the status webhook). So "sendWa said true" never
// meant delivered, and the code all over the app that reads
//   if (!(await sendWa(...))) await sendWaTemplate(...)
// never reached its template. 20 Nov: twenty messages lost that way — the
// morning poster and digest to the owners, the academy material, patients'
// follow-ups — with a working template beside each one. Every free-form send
// now asks first; a shut window is a false, and the caller's template runs.
// When the store cannot be read the message goes anyway, as it used to.
async function windowShut(to) {
  try {
    const cfg = guard.kvConfig();
    if (!cfg) return false;
    return !(await windowOpen(cfg, to));
  } catch (e) { return false; }
}

// Bare Cloud-API text send to a local 10-digit number. True when Meta took it
// for a window that is open; false otherwise.
async function sendWa(digits, text) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!token || !phoneId || to.length !== 10) return false;
  if (await windowShut(to)) return false;
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

// Free text with up to three tappable reply buttons. Inside the 24-hour
// window only, like sendWa; a body over WhatsApp's 1024-character cap goes
// as plain text first, the buttons after it. Falls back to plain text if
// the interactive message is refused.
async function sendWaButtons(digits, text, titles) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  const btns = Array.from(new Set((titles || []).map((s) => String(s || "").trim().slice(0, 20)).filter(Boolean))).slice(0, 3);
  if (!token || !phoneId || to.length !== 10) return false;
  if (!btns.length) return sendWa(to, text);
  if (await windowShut(to)) return false;
  let body = String(text || "");
  if (body.length > 1000) { if (!(await sendWa(to, body))) return false; body = "👇"; }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, type: "interactive", interactive: {
        type: "button", body: { text: body },
        action: { buttons: btns.map((t, i) => ({ type: "reply", reply: { id: `b${i + 1}`, title: t } })) },
      } }),
    });
    if (r.ok) return true;
    let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
    console.error("notify: buttons failed", to, r.status, d);
    if (/131047|re-engagement/i.test(d)) return false;      // window closed — text would fail too
    return sendWa(to, text);
  } catch (e) { console.error("notify: buttons error", to, e && e.message); return false; }
}

// A tap-to-pick list (up to 10 rows) — the desk's "⏰ Slots pampu". Inside
// the 24-hour window only; false when it did not go (the caller falls back to
// a template, which cannot carry a list).
async function sendWaList(digits, text, rowsIn, button) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  const to = String(digits || "").replace(/\D/g, "").slice(-10);
  const rows = Array.from(new Set((rowsIn || []).map((s) => String(s || "").trim().slice(0, 24)).filter(Boolean))).slice(0, 10);
  if (!token || !phoneId || to.length !== 10 || !rows.length) return false;
  if (await windowShut(to)) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, type: "interactive", interactive: {
        type: "list", body: { text: String(text || "").slice(0, 1024) },
        action: { button: String(button || "🗓 Slot select").slice(0, 20), sections: [{ title: "Available times", rows: rows.map((t, i) => ({ id: `slot_${i}`, title: t })) }] },
      } }),
    });
    if (r.ok) return true;
    let d = ""; try { d = (await r.text()).slice(0, 200); } catch (e) {}
    console.error("notify: list failed", to, r.status, d);
    return false;
  } catch (e) { console.error("notify: list error", to, e && e.message); return false; }
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
  if (await windowShut(to)) return false;
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
  if (await windowShut(to)) return false;
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
  if (await windowShut(to)) return false;
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
  if (await windowShut(to)) return false;
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

// Team alerts went as plain text only. Meta takes a plain text outside the
// 24-hour window with a 200 and drops it later (131047 comes back on the
// status webhook, so sendWa still says "sent"). On 6 November 9949134666 had
// never written to the clinic number, and not one lead alert had reached it.
//
// Now an alert checks the window first: open → the full text; shut → the
// daily_digest_ping UTILITY template carrying the same alert on one line,
// which delivers anyway. Replying to it opens the window, and the next
// alerts come in full.
const WIN_SECS = 86100; // just under 24h

// Every inbound WhatsApp message marks its sender's window. Owner commands
// stay out of the staff inbox, so the inbox's own lastIn can't see them.
async function markWindow(cfg, digits) {
  const d = String(digits || "").replace(/\D/g, "").slice(-10);
  if (!cfg || d.length !== 10) return;
  await guard.kvCommand(cfg, ["SET", `win:${d}`, String(Date.now()), "EX", String(WIN_SECS)]).catch(() => {});
  await flushHeld(cfg, d).catch(() => {});
}

// Team alerts held back by teamSend's daily cap, sent the moment that phone
// writes in (its window is open now, so they go as full text, free). Taken
// off the list before sending, so two quick messages cannot send them twice.
async function flushHeld(cfg, d) {
  const k = `tq:hold:${d}`;
  const r = await guard.kvCommand(cfg, ["LRANGE", k, "0", "-1"]).catch(() => null);
  const rows = ((r && r.result) || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter((x) => x && x.text);
  if (!rows.length) return 0;
  await guard.kvCommand(cfg, ["DEL", k]).catch(() => {});
  const at = (ts) => new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  const parts = rows.map((x) => `🕐 ${at(x.ts)}\n${x.text}`);
  let chunk = `📥 *Aagi unna alerts (${rows.length})*`, sent = 0;
  for (const p of parts) {
    if ((chunk + "\n\n———\n\n" + p).length > 3500) { if (await sendWa(d, chunk)) sent++; chunk = p; }
    else chunk += "\n\n———\n\n" + p;
  }
  if (await sendWa(d, chunk)) sent++;
  return sent;
}

async function windowOpen(cfg, digits) {
  if (!cfg) return false;
  try {
    const r = await guard.kvCommand(cfg, ["GET", `win:${digits}`]);
    if (r && r.result && Date.now() - Number(r.result) < 23.5 * 3600000) return true;
  } catch (e) {}
  try {
    const r = await guard.kvCommand(cfg, ["GET", `ib:t:${digits}`]);
    const t = r && r.result ? JSON.parse(r.result) : null;
    if (t && t.lastIn && Date.now() - t.lastIn < 23.5 * 3600000) return true;
  } catch (e) {}
  return false;
}

// Template parameters refuse newlines and runs of spaces; the footer lines
// that only make sense in the full text are dropped.
function alertLine(text) {
  return String(text || "").split("\n").map((s) => s.trim())
    .filter((s) => s && !/^Anni leads:|^_\(Reply/.test(s))
    .join(" · ").replace(/\s{2,}/g, " ").slice(0, 900);
}

// 19 Nov, 6:45 PM: the "calls inka cheyyaledu" alert went to the owner and
// three managers as plain text, with a template fallback that never ran —
// sendWa says true the moment Meta answers 200, and the 131047 comes later on
// the status webhook. Five alerts, none delivered. The cash-close, backup,
// database, exam, review, ads, HR, digest and evening-report messages to the
// team were built the same way. Every message to a team phone comes through
// here now. tpl = {name, params}: a template of its own for a shut window
// (staff_calls_pending, say); daily_digest_ping carries anything else.
//
// 21 Nov: with every alert now a template, the owner's, the manager's and the
// clinic phones were sent several a day that nobody answered, and Meta began
// refusing them (131049) — the manager's login code among them. So a shut
// window gets at most TEAM_TPL_CAP templates a day per phone. The next alert
// sends one more, saying alerts are waiting and asking for an "ok"; after
// that they are held (tq:hold) and arrive in full the moment that phone
// writes in (markWindow → flushHeld). An open window is not counted: those
// go as text, as many as there are.
const TEAM_TPL_CAP = 3;
const eluruDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
async function teamSend(cfg, to, text, tpl) {
  const d = String(to || "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return false;
  if (await windowOpen(cfg, d)) return sendWa(d, text);
  let n = 0;
  if (cfg) {
    try {
      const k = `tq:n:${d}:${eluruDay()}`;
      n = Number(((await guard.kvCommand(cfg, ["INCR", k])) || {}).result) || 0;
      if (n === 1) await guard.kvCommand(cfg, ["EXPIRE", k, String(2 * 86400)]).catch(() => {});
    } catch (e) { n = 0; }   // the store cannot count: send, as before
  }
  if (n > TEAM_TPL_CAP) {
    const k = `tq:hold:${d}`;
    const held = await guard.kvWrite(cfg, ["RPUSH", k, JSON.stringify({ ts: Date.now(), text: String(text || "").slice(0, 3000) })], "held team alert");
    if (held) {
      await guard.kvCommand(cfg, ["LTRIM", k, "-30", "-1"]).catch(() => {});
      await guard.kvCommand(cfg, ["EXPIRE", k, String(3 * 86400)]).catch(() => {});
      if (n === TEAM_TPL_CAP + 1) {
        const t = await sendWaTemplate(d, "daily_digest_ping", ["📥 Inka alerts aagi unnayi — ee number ki 'ok' ani reply cheyandi, anni okesari vastayi."]).catch(() => null);
        if (!(t && t.ok)) console.error("notify: held-alerts notice failed", d.slice(-4));
        return true;
      }
      return true;
    }
    // Could not hold it: better one template too many than an alert lost.
  }
  if (tpl && tpl.name) {
    const own = await sendWaTemplate(d, tpl.name, tpl.params || []).catch(() => null);
    if (own && own.ok) return true;
  }
  const t = await sendWaTemplate(d, "daily_digest_ping", [alertLine(text)]);
  return !!(t && t.ok);
}

// The AI account ran out of credit at about 2:27 PM on 7 November. Every
// agent kept answering with the fixed fallback message, and nobody at the
// clinic knew until the owner asked for a check. Any failed AI call now passes
// its error text through here; an out-of-credit one tells the team once every
// three hours. Returns the error text for the caller's log line.
async function aiFailed(resp) {
  let text = "";
  try { text = String(await resp.text()).replace(/\s+/g, " ").slice(0, 200); } catch (e) {}
  if (/credit balance|billing|quota/i.test(text)) {
    try {
      const cfg = guard.kvConfig();
      const nx = cfg ? await guard.kvCommand(cfg, ["SET", "ai:down", String(Date.now()), "NX", "EX", "10800"]).catch(() => ({})) : {};
      if (nx && nx.result) {
        const msg = "⚠️ *AI agent aagipoyindi*\n\nAnthropic account lo credits aipoyayi — WhatsApp, Instagram, website agents patients ki fixed message matrame pampistunnayi.\n\nconsole.anthropic.com → Plans & Billing lo recharge cheyandi. Appatidaka staff app → Inbox lo patients ki meere reply cheyandi.";
        const to = new Set(String(process.env.LEAD_NOTIFY_PHONES || DEFAULT_TO).split(",").concat(guard.ownerPhones()).map((x) => String(x).replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10));
        for (const t of to) await teamSend(cfg, t, msg).catch(() => {});
      }
    } catch (e) {}
  }
  return text;
}

// Who the desk alerts go to. The list used to be the LEAD_NOTIFY_PHONES env
// var and nothing else: hemasri's reception login was added on 6 November and
// not one lead alert had reached her phone, because nobody had edited an env
// var on Vercel. Reception is who answers the clinic phone, so every live
// reception login is on the list now, beside the env numbers. Distinct
// ten-digit numbers; a login switched off is left out.
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
async function notifyTargets(cfg) {
  const out = new Set(String(process.env.LEAD_NOTIFY_PHONES || DEFAULT_TO).split(",").map(ten).filter((x) => x.length === 10));
  if (cfg) {
    try {
      const users = guard.hashOf((await guard.kvCommand(cfg, ["HGETALL", "staff:users"])).result) || {};
      for (const [phone, raw] of Object.entries(users)) {
        let u = null; try { u = JSON.parse(raw); } catch (e) { u = null; }
        if (u && !u.off && String(u.role || "") === "reception" && ten(phone).length === 10) out.add(ten(phone));
      }
    } catch (e) {}
  }
  return [...out];
}

async function leadAlert(cfg, lead) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = String(process.env.WA_PHONE_ID_ALLOWLIST || "1237387512796539").split(",")[0].trim();
  if (!token || !phoneId || !lead || !lead.name) return;
  const targets = await notifyTargets(cfg);
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
    `👤 ${lead.name}${lead.lang === "hi" ? " · 🗣 Hindi lo matladandi" : ""}`,
    lead.phone ? `📱 ${lead.phone}` : "",
    lead.concern ? `💬 ${lead.concern}` : "",
    when ? `📅 ${when}` : "",
    lead.call_prep ? `📋 ${lead.call_prep}` : "",
    // The agent tells the patient "team call chesi confirm chestundi". In the
    // week of 9 November five slots were waiting and one had had that call,
    // so a lead that already holds a slot says what the call is for, and by
    // when (the owner's rule: 30 minutes, 9 AM to 9 PM).
    (lead.slot_ts || lead.slot || lead.date) ? "☎️ 30 nimishallo call chesi slot confirm cheyandi" : "",
    "",
    "Anni leads: dermaluxe.ai/leads.html",
    "_(Reply *ok* — next alerts kuda ravadaniki)_",
  ].filter((s) => s !== "").join("\n").slice(0, 900);

  for (const to of targets) await teamSend(cfg, to, body);
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
  const first = require("./_greet.js").greetName(lead.name) || "friend";
  const concern = String(lead.concern || "").trim().slice(0, 40);
  const line = `Meeru ${channel} lo${concern ? " '" + concern + "' gurinchi" : ""} adigaru kada — ikkada WhatsApp lo mana team doctor slot confirm chestundi. Free AI skin & hair analysis kuda ikkade. Reply cheyandi 😊`;
  let out = await sendWaTemplate(ph, "insta_lead_followup", [first, line]);
  if (!out.ok) out = await sendWaTemplate(ph, "clinic_update", [first, line]);
  if (!out.ok && cfg) await guard.kvCommand(cfg, ["DEL", `ntf:handoff:${ph}`]).catch(() => {});
  return out;
}

module.exports = { leadAlert, notifyTargets, aiFailed, teamSend, markWindow, flushHeld, TEAM_TPL_CAP, windowOpen, alertLine, sendWa, sendWaButtons, sendWaList, sendWaAuthCode, sendWaDocument, sendWaDocLink, sendWaImageLink, sendWaLocation, sendWaTemplate, sendAcademyTemplate, waHandoff };
