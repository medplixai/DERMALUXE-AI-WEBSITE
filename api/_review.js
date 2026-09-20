// The daily review: a second reading of yesterday's chats.
//
// A strict clinic manager reads the day's WhatsApp conversations and says
// where the agent was wrong, weak, or missed a booking — so the owner sees it
// and the prompt can be fixed, instead of the same mistake running all month.
// The findings go to the owner on WhatsApp and to the app's Inbox.
//
// KV: review:<day> — the review, kept 60 days.
const guard = require("./_guard.js");
const inbox = require("./_inbox.js");

const istDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

function extractJson(text) {
  const t = String(text || "").replace(/```json|```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const slice = t.slice(a, b + 1);
  try { return JSON.parse(slice); } catch (e) {}
  const flat = slice.replace(/\r?\n/g, " ");
  for (const tail of ["", '"}]}', '"}}', "]}", "}"]) { try { return JSON.parse(flat + tail); } catch (e) {} }
  return null;
}

const RUBRIC = `You are the quality reviewer for "DermaLuxe Assistant", the WhatsApp receptionist of DermaLuxe by Medicare, a skin & hair clinic in Eluru. The agent's job: understand the concern, give 2-4 useful care tips, explain the matching treatment simply, learn four facts (problem, how long, town, when they can come), and close with a booked consultation — never diagnose, never quote treatment prices, never name medicines, and follow up until the patient visits.

Judge yesterday's conversations like a strict clinic manager, against THIS policy (anything else is a wrong finding):
- Prices: treatment prices are NEVER quoted ("consultation lo doctor exact plan istaru" is correct). Academy course fees (₹9,999 seat, ₹49,999, ₹99,999) MAY be quoted.
- Medicines, drug names, doses: never. Lifestyle/home-care tips: correct and encouraged.
- Naming a condition the patient did not name, or giving a safety verdict ("bhayapadoddu", "normal"), is a fault. In a photo pre-assessment, "may be" findings with the "not a diagnosis" note are fine.
- Language: Tenglish (Telugu in English letters) is the default; English only when the patient wrote real English of their own. Meta's ad prefill ("Hello! Can I get more info on this?") is not the patient's language — answering it in English is a fault.
- One question per message. Every reply ends with one next step (question, buttons or slots) unless it is a confirmation, an emergency, a goodbye after booking, or the reply to STOP.
- A far-away patient (80 km+) should be offered a VIDEO consultation; chasing clinic slots is a fault, and so is talking them out of coming.
- Emergencies (post-treatment swelling/bleeding/infection, severe allergy, burns) → call the clinic now, no booking chat.
- Not a patient (job seeker, sales) → one polite line and close; a slot offer to them is a fault.
- After STOP → one line, no question. After a booking is confirmed → no re-asking whether the time suits.
- Repeating the same message, or asking something the patient already answered, is a fault.
- Messages starting with 🔊 are the voice copy of the reply before — count as one.

Return JSON only:
{"score": 0-100, "summary": "3 short Tenglish sentences for the owner separated by ' · ' (no line breaks inside strings): what went well, the biggest problem, one concrete fix",
 "findings": [{"phone": "last 4 digits", "who": "patient name", "severity": "high|medium|low", "issue": "one Tenglish line — what the agent did wrong or missed", "fix": "one line — what it should have said/done"}]}
Look for: prices or medicines named, diagnosis, wrong language, missed emergency, no slot asked, too many questions, repeats, gave up early, a booking that should have happened. Max 6 findings, most important first. Keep every string under 160 characters. If a chat was handled well, do not list it.`;

async function run(cfg, day) {
  if (!cfg || !process.env.ANTHROPIC_API_KEY) return null;
  const d = day || istDay(Date.now() - 86400000);
  const threads = (await inbox.threads(cfg, 300)).filter((t) => t.ts && istDay(t.ts) === d);
  const convs = [];
  for (const t of threads.slice(0, 40)) {
    const th = await inbox.thread(cfg, t.phone);
    const msgs = (th.msgs || []).filter((m) => istDay(m.ts) === d);
    if (!msgs.some((m) => m.dir === "in") || !msgs.some((m) => m.dir === "out" && m.by === "ai")) continue;
    convs.push({ phone: t.phone, name: t.name || "", msgs: msgs.slice(-16) });
    if (convs.length >= 15) break;
  }
  const lintRows = (((await guard.kvCommand(cfg, ["LRANGE", "lint:log", "0", "999"]).catch(() => ({}))).result) || [])
    .map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter((x) => x && istDay(x.ts) === d);
  const byFault = {};
  for (const r of lintRows) for (const f of (r.faults || [])) byFault[f] = (byFault[f] || 0) + 1;
  const lint = { checked: lintRows.length, rewritten: lintRows.filter((r) => r.rewritten).length, byFault };

  let review;
  if (!convs.length) review = { day: d, checked: 0, score: null, summary: "Ninna agent handle chesina patient chats levu.", findings: [], lint };
  else {
    const transcripts = convs.map((c) => `### ${c.name || "patient"} (…${c.phone.slice(-4)})\n` + c.msgs.map((m) => `${m.dir === "in" ? "PATIENT" : m.by === "ai" ? "AGENT" : "STAFF"}: ${String(m.text).replace(/\s+/g, " ").slice(0, 260)}`).join("\n")).join("\n\n");
    const editor = lint.checked ? `\n\nEDITOR (automatic reply check) YESTERDAY: ${lint.checked} replies had a fault, ${lint.rewritten} were fixed before sending — ${Object.entries(byFault).map(([k, v]) => `${k}×${v}`).join(", ")}. What you read is what was sent.` : "";
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.REVIEW_MODEL || process.env.AI_MODEL || "claude-opus-5", max_tokens: 3000, system: RUBRIC + require("./_prices.js").judgeNote(await require("./_prices.js").load(cfg).catch(() => null)), messages: [{ role: "user", content: transcripts + editor }] }),
    });
    if (!r.ok) throw new Error("review: claude HTTP " + r.status);
    const data = await r.json();
    const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
    const p = extractJson(text) || { score: 0, summary: text.slice(0, 300), findings: [] };
    review = { day: d, checked: convs.length, score: Math.max(0, Math.min(100, Number(p.score) || 0)), summary: String(p.summary || "").slice(0, 600),
      findings: (Array.isArray(p.findings) ? p.findings : []).slice(0, 8).map((f) => ({ phone: String(f.phone || "").slice(-4), who: String(f.who || "").slice(0, 40), severity: ["high", "medium", "low"].includes(f.severity) ? f.severity : "low", issue: String(f.issue || "").slice(0, 200), fix: String(f.fix || "").slice(0, 200) })), lint };
  }
  await guard.kvCommand(cfg, ["SET", `review:${d}`, JSON.stringify(review), "EX", String(60 * 86400)]).catch(() => {});
  await guard.kvCommand(cfg, ["SET", "review:latest", d, "EX", String(60 * 86400)]).catch(() => {});

  if (review.checked) {
    const notify = require("./_notify.js");
    const sev = { high: "🔴", medium: "🟠", low: "🟡" };
    const body = [
      `🧐 *Agent review — ${d}* · ${review.checked} chats · score *${review.score}/100*`,
      "",
      review.summary,
      "",
      ...review.findings.slice(0, 5).map((f) => `${sev[f.severity]} ${f.who || "…" + f.phone}: ${f.issue}\n   ↳ ${f.fix}`),
      lint.checked ? `\n✍️ Editor: ${lint.checked} replies sarichesindi (${lint.rewritten} rewritten)` : "",
      "\nApp → Inbox lo full review undi.",
    ].filter((l) => l !== undefined).join("\n").slice(0, 3500);
    for (const ph of guard.ownerPhones()) await notify.sendWa(ph, body).catch(() => {});
  }
  return review;
}

async function latest(cfg) {
  const d = ((await guard.kvCommand(cfg, ["GET", "review:latest"]).catch(() => ({}))) || {}).result;
  if (!d) return null;
  try { return JSON.parse(((await guard.kvCommand(cfg, ["GET", `review:${d}`])) || {}).result || "null"); } catch (e) { return null; }
}

module.exports = { run, latest, extractJson };
