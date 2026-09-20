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
//
// Whatever is chosen reaches the agent's prompt, the editor's list of numbers
// it may let through, and the judges that score it — from the same record.
//
// KV: agent:prices — {mode, consult, bands:[{name, from, to}], by, ts}
const guard = require("./_guard.js");

const KEY = "agent:prices";
const MODES = ["none", "consult", "bands"];
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN");
const money = (v) => Math.max(0, Math.min(500000, Math.round(Number(String(v == null ? "" : v).replace(/[^\d.]/g, "")) || 0)));

async function load(cfg) {
  if (!cfg) return { mode: "none", consult: 0, bands: [] };
  const v = parse(((await guard.kvCommand(cfg, ["GET", KEY]).catch(() => ({}))) || {}).result || "", null) || {};
  return {
    mode: MODES.includes(v.mode) ? v.mode : "none",
    consult: money(v.consult),
    bands: (Array.isArray(v.bands) ? v.bands : []).map((b) => ({ name: String(b.name || "").trim().slice(0, 40), from: money(b.from), to: money(b.to) })).filter((b) => b.name && b.from > 0).slice(0, 8),
    by: v.by || "", ts: Number(v.ts) || 0,
  };
}

async function save(cfg, input, by) {
  const cur = await load(cfg);
  const next = {
    mode: MODES.includes(input.mode) ? input.mode : cur.mode,
    consult: input.consult != null ? money(input.consult) : cur.consult,
    bands: Array.isArray(input.bands) ? input.bands.map((b) => ({ name: String(b.name || "").trim().slice(0, 40), from: money(b.from), to: money(b.to) })).filter((b) => b.name && b.from > 0).slice(0, 8) : cur.bands,
    by: String(by || "").slice(0, 40), ts: Date.now(),
  };
  if (next.mode === "consult" && !next.consult) return { ok: false, error: "Consultation fee ivvandi" };
  if (next.mode === "bands" && !next.bands.length) return { ok: false, error: "Kaneesam oka treatment range ivvandi" };
  for (const b of next.bands) if (b.to && b.to < b.from) return { ok: false, error: `${b.name}: 'to' 'from' kanna takkuva undi` };
  const r = await guard.kvCommand(cfg, ["SET", KEY, JSON.stringify(next)]);
  if (!r || r.error) return { ok: false, error: "Save avvaledu — malli try cheyandi" };
  return { ok: true, prices: next };
}

const bandText = (b) => `${b.name} ${rupee(b.from)}${b.to && b.to !== b.from ? "–" + rupee(b.to) : "+"}`;

// The paragraph the agent reads. Empty under "none" — the standing rule stands.
function block(p) {
  if (!p || p.mode === "none") return "";
  const lines = [`\n\nPRICE POLICY — set by the owner; this overrides the "never quote prices" rule EXACTLY this far and no further:`];
  if (p.consult) lines.push(`- The consultation fee is ${rupee(p.consult)}. Say it when asked about consultation cost or "free na?" — in one line, adding that it is adjusted in the treatment if they take one. Never volunteer it.`);
  if (p.mode === "bands" && p.bands.length) {
    lines.push(`- When asked the price of one of THESE treatments, you may give the range, always as "starts from / approx", always followed by "exact plan & cost doctor consultation lo" and the slot question in the same message: ${p.bands.map(bandText).join(" · ")}.`);
    lines.push("- Any treatment NOT in that list: no number at all — the old rule. Never a discount, never a package total, never a per-session figure the list does not carry.");
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
  return out;
}

// One line for the reviewer and the exam judge, so a permitted price is not a fault.
function judgeNote(p) {
  if (!p || p.mode === "none") return "";
  return `\nOWNER PRICE POLICY (a permitted number is NOT a fault): consultation fee ${p.consult ? rupee(p.consult) : "not set"} may be told when asked${p.mode === "bands" && p.bands.length ? `; these ranges may be given when asked: ${p.bands.map(bandText).join(" · ")}` : ""}. Any other treatment price is still a fault.`;
}

module.exports = { load, save, block, blockFor, allowed, judgeNote, MODES, KEY };
