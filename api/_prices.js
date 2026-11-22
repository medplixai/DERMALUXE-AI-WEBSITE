// What the agent may say about money — the owner's call, not the prompt's.
//
// The standing rule is "never quote a price": a receptionist who quotes a
// laser course over WhatsApp loses the consultation. But the person asking
// "entha avutundi?" is the strongest buyer we get, and answering with nothing
// at all loses some of them to the clinic that answers. So the owner chooses,
// from the control panel, without a deploy:
//
//   none     — the old rule, nothing is said (default)
//   consult  — the consultation fee may be told when asked
//   bands    — the fee, plus "starts from" ranges for a few named treatments
//   list     — the fee, plus the clinic's whole price list (api/_pricelist.js)
//
// Whatever is chosen reaches the agent's prompt, the editor's list of numbers
// it may let through, and the judges that score it — from the same record.
//
// KV: agent:prices — {mode, consult, bands:[{name, from, to}], by, ts}
const guard = require("./_guard.js");

const KEY = "agent:prices";
const MODES = ["none", "consult", "bands", "list"];
const pricelist = require("./_pricelist.js");
// The consultation used to be advertised as free in four places while the rate
// card billed ₹500. It is ₹300, and NMC 8.1(x) is explicit that a lawful
// disclosure of charges "shall be factual, transparent and not misleading" —
// so the default is now to tell a patient the fee when they ask, rather than
// to say nothing and leave them guessing after "free" was taken away. The
// owner's own setting in the staff app still overrides this.
//
// 14 Nov 2026: the owner confirmed the rate card's starting prices for the
// agent to give when asked ("ok" to the list of seven) — of the chats that
// asked "cost entha?" and heard only "consultation lo cheptaru", several
// ended on "later". Always said as "starts from", always with the exact plan
// left to the consultation (block() below). These are the rate card's own
// numbers (money.js DEFAULT_RATES), so the bill and the chat agree.
//
// 21 Nov 2026: the owner sent the full price list "for agent and web". The
// default is now that list (mode "list"); the seven bands stay below as what
// the control panel offers if somebody switches back to "bands".
const DEFAULT = { mode: "list", consult: 300, bands: [
  { name: "HydraFacial", from: 3500, to: 0 },
  { name: "Chemical peel", from: 2500, to: 0 },
  { name: "Laser hair removal — face, per sitting", from: 2500, to: 0 },
  { name: "PRP hair — per sitting", from: 5000, to: 0 },
  { name: "GFC hair — per sitting", from: 7000, to: 0 },
  { name: "Acne treatment — per sitting", from: 2000, to: 0 },
  { name: "Pigmentation — per sitting", from: 3000, to: 0 },
] };
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN");
const money = (v) => Math.max(0, Math.min(500000, Math.round(Number(String(v == null ? "" : v).replace(/[^\d.]/g, "")) || 0)));

async function load(cfg) {
  if (!cfg) return { mode: DEFAULT.mode, consult: DEFAULT.consult, bands: DEFAULT.bands.slice() };
  const raw = ((await guard.kvCommand(cfg, ["GET", KEY]).catch(() => ({}))) || {}).result || "";
  const v = parse(raw, null);
  // The default applies only when the owner has never set a policy. Once they
  // have, what they chose is returned exactly as they chose it — including
  // "none", which has to keep meaning silence, and a zero fee, which has to
  // keep failing validation rather than being quietly filled in from here.
  if (!v) return { mode: DEFAULT.mode, consult: DEFAULT.consult, bands: DEFAULT.bands.slice(), by: "", ts: 0, set: false };
  return {
    mode: MODES.includes(v.mode) ? v.mode : "none",
    consult: money(v.consult),
    bands: (Array.isArray(v.bands) ? v.bands : []).map((b) => ({ name: String(b.name || "").trim().slice(0, 40), from: money(b.from), to: money(b.to) })).filter((b) => b.name && b.from > 0).slice(0, 8),
    by: v.by || "", ts: Number(v.ts) || 0, set: true,
  };
}

async function save(cfg, input, by) {
  const cur = await load(cfg);
  const next = {
    mode: MODES.includes(input.mode) ? input.mode : cur.mode,
    // cur.set is false when nothing has ever been saved, and in that case the
    // \u20b9300 default must not stand in for a fee the owner did not type \u2014 or
    // "set the consult mode" with no number stops being an error.
    consult: input.consult != null ? money(input.consult) : (cur.set ? cur.consult : 0),
    bands: Array.isArray(input.bands) ? input.bands.map((b) => ({ name: String(b.name || "").trim().slice(0, 40), from: money(b.from), to: money(b.to) })).filter((b) => b.name && b.from > 0).slice(0, 8) : cur.bands,
    by: String(by || "").slice(0, 40), ts: Date.now(),
  };
  if ((next.mode === "consult" || next.mode === "list") && !next.consult) return { ok: false, error: "Consultation fee ivvandi" };
  if (next.mode === "bands" && !next.bands.length) return { ok: false, error: "Kaneesam oka treatment range ivvandi" };
  for (const b of next.bands) if (b.to && b.to < b.from) return { ok: false, error: `${b.name}: 'to' 'from' kanna takkuva undi` };
  const r = await guard.kvCommand(cfg, ["SET", KEY, JSON.stringify(next)]);
  if (!r || r.error) return { ok: false, error: "Save avvaledu — malli try cheyandi" };
  return { ok: true, prices: next };
}

const bandText = (b) => `${b.name} ${rupee(b.from)}${b.to && b.to !== b.from ? "–" + rupee(b.to) : "+"}`;

// Owner, 22 Nov 2026: "prices cheppe tappudu offers untaai clinic ki visit
// cheyyandi, Dr Vinitha ni kalavandi manchi offer istundhi ani cheppali" —
// and the same day, "dr nikitha ni kalavamanu": the doctor is Dr. Nikhitha.
// The agent says an offer exists and who gives it — never a number or a
// percentage of its own, since only Dr. Nikhitha decides it at the clinic.
const OFFER_LINE = "Clinic lo offers unnayi andi — clinic ki vachi Dr. Nikhitha Priyanka garini kalavandi, meeku manchi offer istaru.";
const OFFER_RULE = `- EVERY time you give a treatment price, add this in the same message, in your own words but with the same meaning: "${OFFER_LINE}" Same when anyone asks "offer / discount undha?". NEVER name a discount amount, a percentage, a lower price or a "free" sitting yourself — the offer is Dr. Nikhitha's to give at the clinic. Then the slot question.`;

// The paragraph the agent reads. Empty under "none" — the standing rule stands.
function block(p) {
  if (!p || p.mode === "none") return "";
  const lines = [`\n\nPRICE POLICY — set by the owner; this overrides the "never quote prices" rule EXACTLY this far and no further:`];
  if (p.consult) lines.push(`- The consultation fee is ${rupee(p.consult)}. Say it when asked about consultation cost or "free na?" — in one line, adding that it is charged separately and is NOT adjusted against treatment cost. Never volunteer it. NEVER say it is free, adjusted, waived or refunded — the one exception is the hair transplant consultation from 6 Nov to 6 Dec 2026, which the HAIR TRANSPLANT PACKAGE block covers.`);
  if (p.mode === "list") {
    lines.push(`- The clinic's price list is below (owner, ${pricelist.AS_OF}). When the patient asks the price of a treatment ON IT, give that line exactly as written — the per-sitting price, and the package if it has one. One or two lines per reply, never the whole list. In the same message say which treatment and how many sittings suit them is decided by the doctor at the consultation, then ask the slot question.`);
    lines.push("- A general \"rates enti? / price list\": name the two or three lines closest to their concern and say the full list is at www.dermaluxe.ai/price-list.html.");
    lines.push("- A package is \"N sittings ₹X\" — never call any sitting free or extra, never a number that is not written here. A treatment not on the list: no number at all — the old rule.");
    lines.push(OFFER_RULE);
    lines.push("- Injections, vaccines and minor procedures (biopsy, I&D, Inj. ...) only when the patient names them; never suggest one.");
    lines.push("PRICE LIST:\n" + pricelist.text());
  }
  if (p.mode === "bands" && p.bands.length) {
    lines.push(`- When asked the price of one of THESE treatments, you may give the range, always as "starts from / approx", always followed by "exact plan & cost doctor consultation lo" and the slot question in the same message: ${p.bands.map(bandText).join(" · ")}.`);
    lines.push("- Any treatment NOT in that list: no number at all — the old rule. Never a package total, never a per-session figure the list does not carry.");
    lines.push(OFFER_RULE);
  }
  return lines.join("\n");
}
async function blockFor(cfg) { return block(await load(cfg)); }

// The numbers the editor may let through, beside the academy's fees.
async function allowed(cfg) {
  const p = await load(cfg);
  const out = new Set();
  if (p.mode !== "none" && p.consult) out.add(p.consult);
  if (p.mode === "bands") for (const b of p.bands) { out.add(b.from); if (b.to) out.add(b.to); }
  if (p.mode === "list") for (const n of pricelist.amounts()) out.add(n);
  return out;
}
// The same set from a policy already loaded (whatsapp.js's hard block).
function allowSet(p) {
  const out = new Set();
  if (!p || p.mode === "none") return out;
  if (p.consult) out.add(p.consult);
  if (p.mode === "bands") for (const b of p.bands || []) { out.add(b.from); if (b.to) out.add(b.to); }
  if (p.mode === "list") for (const n of pricelist.amounts()) out.add(n);
  return out;
}

// One line for the reviewer and the exam judge, so a permitted price is not a fault.
function judgeNote(p) {
  if (!p || p.mode === "none") return "";
  if (p.mode === "list") return `\nOWNER PRICE POLICY (a permitted number is NOT a fault): consultation fee ${p.consult ? rupee(p.consult) : "not set"} may be told when asked; any price on the clinic's list below may be given when the patient asks about that treatment. A number not on it, a discount amount or percentage, or a "free" sitting is a fault; reciting the whole list unasked is a fault. Saying the clinic has offers and Dr. Nikhitha gives them at the clinic is the owner's rule (22 Nov) and NOT a fault.\n${pricelist.text()}`;
  return `\nOWNER PRICE POLICY (a permitted number is NOT a fault): consultation fee ${p.consult ? rupee(p.consult) : "not set"} may be told when asked${p.mode === "bands" && p.bands.length ? `; these ranges may be given when asked: ${p.bands.map(bandText).join(" · ")}` : ""}. Any other treatment price is still a fault. Saying the clinic has offers and Dr. Nikhitha gives them at the clinic is the owner's rule (22 Nov) and NOT a fault; a discount amount or percentage is.`;
}

module.exports = { OFFER_LINE, load, save, block, blockFor, allowed, allowSet, judgeNote, MODES, KEY };
