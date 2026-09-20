// The WhatsApp conversations, kept where the staff can see them.
//
// The agent answers patients around the clock, but its conversations lived
// only in a 24-hour memory the model reads — the desk never saw what a
// patient had been told, and when the agent was going round in circles with
// a hot lead there was no way for a person to step in.
//
// Every message in and out is written here, per patient. A colleague can
// read a thread, reply from the app, and take the conversation over: while a
// person has it, the agent stays quiet for that patient (twelve hours from
// the last human reply, or until they hand it back).
//
// KV:
//   ib:m:<phone>     the thread, newest first (last 200 messages, 90 days)
//   ib:t:<phone>     thread summary: name, last line, when, unread count
//   ib:list          phones, most recent conversation first (500)
//   ib:human:<phone> set while a person has the conversation
const guard = require("./_guard.js");

const KEEP = 90 * 86400;
const HUMAN_SEC = 12 * 3600;
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

// dir: "in" (patient) | "out" (to the patient). by: "ai" or a colleague's name.
async function log(cfg, phone, m) {
  const ph = ten(phone);
  if (!cfg || ph.length !== 10) return false;
  const text = String(m.text || "").slice(0, 2000);
  if (!text) return false;
  const now = Date.now();
  const rec = { dir: m.dir === "in" ? "in" : "out", text, ts: now };
  if (rec.dir === "out") rec.by = String(m.by || "ai").slice(0, 40);
  if (m.via) rec.via = String(m.via).slice(0, 20);
  await guard.kvCommand(cfg, ["LPUSH", `ib:m:${ph}`, JSON.stringify(rec)]);
  await guard.kvCommand(cfg, ["LTRIM", `ib:m:${ph}`, "0", "199"]).catch(() => {});
  await guard.kvCommand(cfg, ["EXPIRE", `ib:m:${ph}`, String(KEEP)]).catch(() => {});
  const meta = parse(((await guard.kvCommand(cfg, ["GET", `ib:t:${ph}`]).catch(() => ({}))) || {}).result || "", null) || { phone: ph, unread: 0 };
  if (m.name) meta.name = String(m.name).slice(0, 60);
  meta.last = text.slice(0, 140);
  meta.lastDir = rec.dir;
  meta.lastBy = rec.by || "";
  meta.ts = now;
  if (rec.dir === "in") { meta.unread = (meta.unread || 0) + 1; meta.lastIn = now; meta.inCount = (meta.inCount || 0) + 1; }
  else if (rec.by !== "ai") meta.unread = 0;          // a person answered, so somebody has read it
  await guard.kvCommand(cfg, ["SET", `ib:t:${ph}`, JSON.stringify(meta), "EX", String(KEEP)]).catch(() => {});
  await guard.kvCommand(cfg, ["LREM", "ib:list", "0", ph]).catch(() => {});
  await guard.kvCommand(cfg, ["LPUSH", "ib:list", ph]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "ib:list", "0", "499"]).catch(() => {});
  return true;
}

async function human(cfg, phone) {
  const r = await guard.kvCommand(cfg, ["GET", `ib:human:${ten(phone)}`]).catch(() => ({}));
  return parse((r && r.result) || "", null);
}
async function setHuman(cfg, phone, on, by) {
  const ph = ten(phone);
  if (on) await guard.kvCommand(cfg, ["SET", `ib:human:${ph}`, JSON.stringify({ by: String(by || "").slice(0, 40), ts: Date.now() }), "EX", String(HUMAN_SEC)]);
  else await guard.kvCommand(cfg, ["DEL", `ib:human:${ph}`]);
}

async function threads(cfg, n) {
  const r = await guard.kvCommand(cfg, ["LRANGE", "ib:list", "0", String((n || 100) - 1)]).catch(() => ({}));
  const phones = (r && r.result) || [];
  if (!phones.length) return [];
  const metas = await guard.kvCommand(cfg, ["MGET"].concat(phones.map((p) => `ib:t:${p}`))).catch(() => ({}));
  const hums = await guard.kvCommand(cfg, ["MGET"].concat(phones.map((p) => `ib:human:${p}`))).catch(() => ({}));
  return phones.map((p, i) => {
    const m = parse(((metas && metas.result) || [])[i] || "", null);
    if (!m) return null;
    const h = parse(((hums && hums.result) || [])[i] || "", null);
    return Object.assign({ phone: p }, m, { human: h });
  }).filter(Boolean);
}

async function thread(cfg, phone) {
  const ph = ten(phone);
  const r = await guard.kvCommand(cfg, ["LRANGE", `ib:m:${ph}`, "0", "199"]).catch(() => ({}));
  const msgs = ((r && r.result) || []).map((x) => parse(x, null)).filter(Boolean).reverse();
  const meta = parse(((await guard.kvCommand(cfg, ["GET", `ib:t:${ph}`]).catch(() => ({}))) || {}).result || "", null);
  return { phone: ph, msgs, meta, human: await human(cfg, ph) };
}

async function meta(cfg, phone) {
  return parse(((await guard.kvCommand(cfg, ["GET", `ib:t:${ten(phone)}`]).catch(() => ({}))) || {}).result || "", null);
}

async function markRead(cfg, phone) {
  const ph = ten(phone);
  const meta = parse(((await guard.kvCommand(cfg, ["GET", `ib:t:${ph}`]).catch(() => ({}))) || {}).result || "", null);
  if (!meta || !meta.unread) return;
  meta.unread = 0;
  await guard.kvCommand(cfg, ["SET", `ib:t:${ph}`, JSON.stringify(meta), "EX", String(KEEP)]).catch(() => {});
}

// WhatsApp only lets a business send free text within 24 hours of the
// patient's last message; after that it has to be an approved template.
const windowOpen = (meta) => !!(meta && meta.lastIn && Date.now() - meta.lastIn < 24 * 3600000 - 60000);

module.exports = { log, human, setHuman, threads, thread, meta, markRead, windowOpen, HUMAN_SEC };
