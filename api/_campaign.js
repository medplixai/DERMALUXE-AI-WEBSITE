// Campaigns the owner approves in the app — and then sees the result of.
//
// The owner could already broadcast from WhatsApp ("broadcast hair: …"). What
// that never had: a calendar (Sankranti, wedding season, summer pigmentation,
// monsoon fungal — the clinic's year), an audience beyond "everyone" or "one
// word", a limit on how often one person is marketed to, and any answer to
// "did it work?". This adds those. The sending itself stays with the queue
// cron-post already drains at thirty every ten minutes — spaced, STOP-aware.
//
// KV: cmp:<id> the campaign · cmp:list ids · cmp:stat:<id> sent count
//     cmp:touch:<phone> one campaign per person per 14 days
const guard = require("./_guard.js");

const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const DAY = 86400000;

// The clinic's year. `m` = months (1-12) the suggestion shows in.
const SEASONS = [
  { key: "sankranti", m: [12, 1], name: "Sankranti glow", seg: "", tpl: "festival_offer", p2: "Sankranti", text: "Panduga ki mundu skin glow kosam Hydrafacial / peel slots open — ee vaaram book cheskondi, doctor consultation tho ✨" },
  { key: "wedding", m: [11, 12, 1, 2], name: "Wedding season", seg: "", tpl: "clinic_update", text: "Pelli season vachesindi 💍 Bride/groom & family ki skin & hair glow plans — 4-6 vaaralu mundu start chesthe best results. Doctor consultation ki reply cheyandi." },
  { key: "summer", m: [3, 4, 5], name: "Summer pigmentation & tan", seg: "pigment", tpl: "seasonal_tips", text: "Enda lo tan & pigmentation penugutayi ☀️ 1) SPF 50 prathi 3 gantalaki 2) 3L neellu 3) Madhyahnam 12-3 enda avoid — tan/pigmentation ki peel & PICO sessions unnayi, doubt unte reply cheyandi." },
  { key: "monsoon", m: [6, 7, 8, 9], name: "Monsoon fungal care", seg: "", tpl: "seasonal_tips", text: "Varsha kalam lo fungal infections & dandruff ekkuva 🌧 1) Tadi battalu ventane marchandi 2) Feet & folds dry ga unchandi 3) Sharing towels vaddu — itching/rash unte doctor ni chupinchandi, reply cheyandi." },
  { key: "diwali", m: [10, 11], name: "Diwali offer", seg: "", tpl: "festival_offer", p2: "Diwali", text: "Deepavali ki mundu glow package — Hydrafacial + peel slots limited. Doctor consultation tho mee skin ki correct plan. Book cheyalante reply cheyandi 🪔" },
  { key: "hairfall", m: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], name: "Hair fall check-in", seg: "hair", tpl: "clinic_update", text: "Hair fall gurinchi adigaru kada — PRP/GFC sessions tho 3 nelallo visible difference chala mandiki vachindi. Doctor tho okasari scalp check cheyinchukondi — slot ki reply cheyandi 💆‍♀️" },
  { key: "newyear", m: [12, 1], name: "New year skin plan", seg: "", tpl: "clinic_update", text: "Kotha samvatsaram — kotha skin routine ✨ Doctor consultation lo mee skin/hair ki 3-month plan istaru. Ee vaaram slots ki reply cheyandi." },
];
const suggest = (now) => { const m = new Date((now || Date.now()) + 330 * 60000).getUTCMonth() + 1; return SEASONS.filter((s) => s.m.includes(m)).map((s) => Object.assign({}, s, { m: undefined })); };

// Who a campaign goes to.
//   all      — every opted-in number in the lead book (the old broadcast)
//   seg      — those whose concern mentions a word
//   visited  — people who actually came (appointments done, or a bill)
//   cold     — enquiries 7–90 days old that never booked
async function audience(cfg, aud, seg) {
  const admin = require("./_admin.js");
  if (aud === "visited") {
    const opt = new Set((((await guard.kvCommand(cfg, ["SMEMBERS", "optout"]).catch(() => ({}))) || {}).result) || []);
    const seen = new Map();
    for (const s of ((((await guard.kvCommand(cfg, ["LRANGE", "appt:done", "0", "499"]).catch(() => ({}))) || {}).result) || [])) {
      const a = parse(s, null);
      if (!a || a.ns || a.status === "noshow" || a.status === "cancelled") continue;
      const ph = ten(a.ph); if (ph.length === 10 && !opt.has(ph) && !seen.has(ph)) seen.set(ph, String(a.name || "").split(" ")[0] || "friend");
    }
    return [...seen].map(([ph, name]) => ({ ph, name }));
  }
  if (aud === "cold") {
    const rows = await admin.bcTargets(cfg, "", { cold: true });
    return rows;
  }
  return admin.bcTargets(cfg, aud === "seg" ? String(seg || "").toLowerCase().slice(0, 20) : "");
}

async function preview(cfg, o) {
  const list = await audience(cfg, o.aud, o.seg);
  const fresh = [];
  for (const t of list) {
    const touched = await guard.kvCommand(cfg, ["GET", `cmp:touch:${t.ph}`]).catch(() => ({}));
    if (!(touched && touched.result)) fresh.push(t);
  }
  return { count: fresh.length, rested: list.length - fresh.length, sample: fresh.slice(0, 5).map((t) => t.name) };
}

async function send(cfg, o, by) {
  const text = String(o.text || "").trim().slice(0, 550);
  if (text.length < 10) return { ok: false, error: "Message konchem pedda ga raayandi" };
  const tpl = ["clinic_update", "festival_offer", "flash_offer", "new_service", "seasonal_tips", "free_camp"].includes(o.tpl) ? o.tpl : "clinic_update";
  const list = await audience(cfg, o.aud, o.seg);
  const targets = [];
  for (const t of list) {
    const nx = await guard.kvCommand(cfg, ["SET", `cmp:touch:${t.ph}`, "1", "NX", "EX", String(14 * 86400)]).catch(() => ({}));
    if (nx && nx.result) targets.push(t);
  }
  if (!targets.length) return { ok: false, error: "Ee audience lo evariki pampaleru — andaru 14 rojullo already oka campaign andukunnaru, leda evaru leru" };
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const rec = { id, name: String(o.name || "Campaign").slice(0, 60), text, tpl, p2: String(o.p2 || "").slice(0, 40), aud: o.aud || "all", seg: String(o.seg || "").slice(0, 20), targets: targets.map((t) => t.ph), n: targets.length, by: String(by || "").slice(0, 40), ts: Date.now() };
  await guard.kvCommand(cfg, ["SET", `cmp:${id}`, JSON.stringify(rec), "EX", String(400 * 86400)]);
  await guard.kvCommand(cfg, ["LPUSH", "cmp:list", id]).catch(() => {});
  await guard.kvCommand(cfg, ["LTRIM", "cmp:list", "0", "99"]).catch(() => {});
  for (const t of targets) await guard.kvCommand(cfg, ["LPUSH", "bc:q", JSON.stringify({ ph: t.ph, name: t.name, text, tpl, p2: rec.p2, cmp: id })]).catch(() => {});
  return { ok: true, id, queued: targets.length, minutes: Math.ceil(targets.length / 30) * 10 };
}

// Did it work: how many went, how many wrote back, how many fixed a slot after it.
async function stats(cfg, rec) {
  const sentR = await guard.kvCommand(cfg, ["GET", `cmp:stat:${rec.id}`]).catch(() => ({}));
  const sent = Number((sentR && sentR.result) || 0);
  const phones = rec.targets || [];
  let replied = 0, booked = 0;
  if (phones.length) {
    const metas = await guard.kvCommand(cfg, ["MGET"].concat(phones.map((p) => `ib:t:${p}`))).catch(() => ({}));
    for (const m of ((metas && metas.result) || [])) { const t = parse(m, null); if (t && Number(t.lastIn) > rec.ts) replied++; }
    const set = new Set(phones), seen = new Set();
    for (const key of ["appt:q", "appt:done"]) {
      for (const s of ((((await guard.kvCommand(cfg, ["LRANGE", key, "0", "399"]).catch(() => ({}))) || {}).result) || [])) {
        const a = parse(s, null);
        if (a && set.has(ten(a.ph)) && a.at > rec.ts && !seen.has(ten(a.ph)) && a.status !== "cancelled") { seen.add(ten(a.ph)); booked++; }
      }
    }
  }
  return { sent, pending: Math.max(0, rec.n - sent), replied, booked };
}

async function list(cfg, n) {
  const ids = (((await guard.kvCommand(cfg, ["LRANGE", "cmp:list", "0", String((n || 20) - 1)]).catch(() => ({}))) || {}).result) || [];
  const out = [];
  for (const id of ids) {
    const rec = parse(((await guard.kvCommand(cfg, ["GET", `cmp:${id}`]).catch(() => ({}))) || {}).result || "", null);
    if (!rec) continue;
    out.push(Object.assign({}, rec, { targets: undefined }, await stats(cfg, rec)));
  }
  return out;
}

module.exports = { SEASONS, suggest, audience, preview, send, stats, list };
