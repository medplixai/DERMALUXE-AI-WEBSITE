// The owner's own rules for the agent, added without a deploy.
//
// The loop that makes the agent better ends here: the daily review finds a
// pattern, the owner reads it on WhatsApp, and says "ika laser offer cheppaku"
// — that sentence is appended to the agent's prompt from the next message on,
// on every channel, and the next review judges against it too.
//
// KV: agent:rules — the list, newest last, at most 25.
const guard = require("./_guard.js");

const KEY = "agent:rules";
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

async function load(cfg) {
  if (!cfg) return [];
  const r = await guard.kvCommand(cfg, ["GET", KEY]).catch(() => ({}));
  const v = parse((r && r.result) || "", null);
  return Array.isArray(v) ? v.slice(-25) : [];
}

async function add(cfg, text, by) {
  const clean = String(text || "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (!clean) return { ok: false, error: "Rule khaali" };
  const cur = await load(cfg);
  if (cur.some((r) => r.text.toLowerCase() === clean.toLowerCase())) return { ok: false, error: "Ee rule already undi" };
  const rule = { id: Math.random().toString(36).slice(2, 8), text: clean, by: String(by || "owner").slice(0, 40), ts: Date.now() };
  await guard.kvCommand(cfg, ["SET", KEY, JSON.stringify(cur.concat([rule]).slice(-25))]);
  return { ok: true, rule, rules: cur.concat([rule]) };
}

async function remove(cfg, id) {
  const cur = await load(cfg);
  const next = cur.filter((r) => r.id !== String(id));
  if (next.length === cur.length) return { ok: false, error: "Ee rule dorakaledu" };
  await guard.kvCommand(cfg, ["SET", KEY, JSON.stringify(next)]);
  return { ok: true, rules: next };
}

// What the model is told. Owner rules sit above the standing prompt, because
// they are the clinic changing its mind about something the prompt still says.
async function block(cfg) {
  const rules = await load(cfg);
  const prices = await require("./_prices.js").blockFor(cfg).catch(() => "");
  if (!rules.length) return prices;
  return `\n\nOWNER RULES — the clinic's own instructions, added after this prompt was written. They win over anything above that disagrees with them:\n${rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n")}` + prices;
}

module.exports = { load, add, remove, block, KEY };
