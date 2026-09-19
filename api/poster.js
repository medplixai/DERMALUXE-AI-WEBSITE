// /api/poster — daily posters made in the app, kept, and put out from there.
//
// The first version built a poster and showed it, and that was all: the
// picture expired after two hours, nothing listed it, and there was no way to
// do anything with it. The owner made one, liked it, and it was gone. So this
// now works the way the Medicare staff app's daily content does — every
// poster made here is saved as a card, with the owner's options on it:
//   regenerate   the same poster again, with "what to change" in their words
//   post         put it on Instagram (and Facebook) now
//   schedule     make it tomorrow's 8:30 post, in place of the automatic one
//   remove       throw it away
//
// Building runs the real pipeline — planner, the photograph drawn for the
// headline, the vision check and redraws, the doctor at the foot — with
// preview on, so making one changes nothing else: nothing queued, the topic
// and look not marked as used.
//
// KV:
//   pv:list        ids of saved posters, newest first (30 kept)
//   pv:<id>        one poster: image, words, status, what happened to it
//   adm:img:<id>   the picture itself, shared with the publisher (14 days)
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");
const daily = require("./_daily.js");
const admin = require("./_admin.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const KEEP = 14 * 86400;          // a saved poster outlives a fortnight's indecision
const MAX = 30;
const IST = 330 * 60000;

// 8:30 tomorrow in Eluru, and that day's date — the slot the automatic poster
// would otherwise take.
function tomorrow830() {
  const ist = new Date(Date.now() + IST);
  const due = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1, 8, 30, 0) - IST;
  const d = new Date(due + IST);
  const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { due, day };
}

async function getRow(cfg, id) {
  if (!/^[a-f0-9]{16}$/.test(String(id || ""))) return null;
  const r = await guard.kvCommand(cfg, ["GET", `pv:${id}`]).catch(() => ({}));
  return parse(r && r.result, null);
}
const putRow = (cfg, row) => guard.kvWrite(cfg, ["SET", `pv:${row.id}`, JSON.stringify(row), "EX", String(KEEP)], "saved poster");

function fromBuild(out, extra) {
  return Object.assign({
    imgId: out.imgId,
    topic: out.topic.key, pillar: out.topic.pillar || "",
    h1: out.topic.h1, te: out.topic.te || "", sub: out.topic.sub || "",
    look: (out.topic.look && out.topic.look.key) || "",
    doctor: out.doctor || "", hadImage: !!out.hadImage,
    caption: out.caption || "",
  }, extra);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  // The same people who may put a post out may make one and look at it first.
  if (!allow("posts.toggle")) return json(res, 403, { error: "Mee role ki posts permission ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "list");

  // What can be made: every poster in the library, academy ones first.
  if (a === "topics") {
    const row = (t) => ({ key: t.key, h1: t.h1, pillar: t.pillar });
    return json(res, 200, { ok: true, topics: daily.ACADEMY_TOPICS.map(row).concat(daily.TOPICS.map(row)) });
  }

  // The saved posters, and — for any that were handed to the queue — whether
  // they have actually gone out yet.
  if (a === "list") {
    const ids = ((await guard.kvCommand(cfg, ["LRANGE", "pv:list", "0", String(MAX - 1)]).catch(() => ({}))).result) || [];
    const [rows, logRaw] = await Promise.all([
      ids.length ? guard.kvPipeline(cfg, ids.map((id) => ["GET", `pv:${id}`])).catch(() => []) : [],
      guard.kvCommand(cfg, ["LRANGE", "post:log", "0", "99"]).catch(() => ({})),
    ]);
    const went = {};
    ((logRaw && logRaw.result) || []).forEach((x) => { const p = parse(x, null); if (p && p.imgId && p.kind !== "story") went[p.imgId] = p; });
    const posters = [];
    for (const raw of (Array.isArray(rows) ? rows : [])) {
      const r = parse(raw, null);
      if (!r) continue;
      if (r.status === "scheduled" && went[r.imgId]) {
        r.status = "posted"; r.link = went[r.imgId].link || ""; r.postedAt = went[r.imgId].at || Date.now();
        await putRow(cfg, r).catch(() => {});
      }
      posters.push(r);
    }
    return json(res, 200, { ok: true, posters, keepDays: KEEP / 86400 });
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });

  // Each build is a planner call, up to three image generations and a render.
  // Enough to compare a handful; not enough to run up a bill by leaning on it.
  const buildLimit = async () => (await guard.rateLimit(cfg, `rl:poster:${me.phone}`, 12, 3600)).allowed;

  if (a === "create" || a === "preview") {
    if (!(await buildLimit())) return json(res, 429, { error: "Ee gantalo chaala posters ayyayi — konchem taruvata try cheyandi" });
    const known = daily.ACADEMY_TOPICS.concat(daily.TOPICS).map((t) => t.key);
    const topic = clean(b.topic, 40);
    if (topic && known.indexOf(topic) === -1) return json(res, 400, { error: "Aa topic ledu" });
    const t0 = Date.now();
    let out;
    try {
      out = await daily.createDailyPost(cfg, { preview: true, keepSec: KEEP, topic: topic || undefined, note: clean(b.note, 300), by: me.name });
    } catch (e) {
      console.error("poster: build failed", e && e.message);
      return json(res, 502, { error: "Poster ready avvaledu — malli try cheyandi" });
    }
    const row = fromBuild(out, {
      id: crypto.randomBytes(8).toString("hex"),
      status: "draft", by: me.name, at: Date.now(), ms: Date.now() - t0, note: clean(b.note, 300),
    });
    if (!(await putRow(cfg, row))) return json(res, 500, { error: "Save avvaledu — malli try cheyandi" });
    await guard.kvCommand(cfg, ["LPUSH", "pv:list", row.id]).catch(() => {});
    await guard.kvCommand(cfg, ["LTRIM", "pv:list", "0", String(MAX - 1)]).catch(() => {});
    return json(res, 200, { ok: true, poster: row });
  }

  const row = await getRow(cfg, b.id);
  if (!row) return json(res, 404, { error: "Aa poster dorakaledu — expire ayyi undochu" });

  // The same poster again, with the owner's "what to change" in their words.
  if (a === "regenerate") {
    if (row.status === "posted") return json(res, 400, { error: "Idi ippatike post ayyindi" });
    if (!(await buildLimit())) return json(res, 429, { error: "Ee gantalo chaala posters ayyayi — konchem taruvata try cheyandi" });
    const note = clean(b.note, 300);
    const t0 = Date.now();
    let out;
    try {
      out = await daily.createDailyPost(cfg, { preview: true, keepSec: KEEP, topic: row.topic, note, by: me.name });
    } catch (e) {
      console.error("poster: regenerate failed", e && e.message);
      return json(res, 502, { error: "Poster ready avvaledu — malli try cheyandi" });
    }
    const old = row.imgId;
    // A scheduled poster that is redrawn stays scheduled — with the new picture.
    if (row.status === "scheduled") {
      const qr = ((await guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "99"]).catch(() => ({}))).result) || [];
      for (const raw of qr) {
        const it = parse(raw, null);
        if (it && it.imgId === old) {
          await guard.kvCommand(cfg, ["LREM", "adm:queue", "1", raw]).catch(() => {});
          await guard.kvCommand(cfg, ["LPUSH", "adm:queue", JSON.stringify(Object.assign({}, it, { imgId: out.imgId, caption: out.caption || it.caption }))]).catch(() => {});
        }
      }
    }
    const next = Object.assign(row, fromBuild(out, { note, at: Date.now(), ms: Date.now() - t0, by: me.name, redone: (row.redone || 0) + 1 }));
    await putRow(cfg, next);
    if (next.status !== "scheduled") await guard.kvCommand(cfg, ["DEL", `adm:img:${old}`]).catch(() => {});
    return json(res, 200, { ok: true, poster: next });
  }

  // On Instagram (and Facebook) now.
  if (a === "post") {
    if (row.status === "posted") return json(res, 400, { error: "Idi ippatike post ayyindi" });
    const rl = await guard.rateLimit(cfg, `rl:postw:${me.phone}`, 60, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Konchem aagandi" });
    const out = await admin.publishNow(cfg, { imgId: row.imgId, caption: row.caption, by: me.name });
    if (!out.ok) {
      return json(res, out.transient ? 503 : 400, {
        error: out.transient ? "Instagram inka process chestundi — oka nimisham agi malli try cheyandi" : `Publish kaledu: ${out.msg}`,
      });
    }
    Object.assign(row, { status: "posted", link: out.link || "", fb: !!out.fb, postedAt: Date.now(), postedBy: me.name });
    await putRow(cfg, row);
    await guard.kvCommand(cfg, ["LPUSH", "dp:hist", `${row.topic}|${new Date(Date.now() + IST).toISOString().slice(0, 10)}`]).catch(() => {});
    return json(res, 200, { ok: true, poster: row });
  }

  // Tomorrow's 8:30 post, instead of the automatic one — the feed post, and
  // the same picture as a story three minutes later, exactly as the automatic
  // one would go. Marking tomorrow as done is what stops two posts going out.
  if (a === "schedule") {
    if (row.status === "posted") return json(res, 400, { error: "Idi ippatike post ayyindi" });
    if (row.status === "scheduled") return json(res, 400, { error: "Idi ippatike schedule ayyindi" });
    const { due, day } = tomorrow830();
    const claim = await guard.kvCommand(cfg, ["SET", `dp:done:${day}`, "app", "NX", "EX", "172800"]).catch(() => ({}));
    if (!claim || !claim.result) return json(res, 409, { error: "Repati poster ippatike ready ayyindi — queue lo chudandi" });
    await guard.kvWrite(cfg, ["LPUSH", "adm:queue", JSON.stringify({ imgId: row.imgId, caption: row.caption, due, by: me.name, tries: 0, auto: true, topic: row.topic })], "poster schedule");
    await guard.kvCommand(cfg, ["LPUSH", "adm:queue", JSON.stringify({ imgId: row.imgId, story: true, due: due + 180000, by: me.name, tries: 0, auto: true, quiet: true })]).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", "dp:hist", `${row.topic}|${day}`]).catch(() => {});
    Object.assign(row, { status: "scheduled", due, scheduledBy: me.name });
    await putRow(cfg, row);
    return json(res, 200, { ok: true, poster: row });
  }

  // Thrown away. A scheduled one is taken back out of the queue first, and
  // tomorrow is handed back to the automatic poster.
  if (a === "remove") {
    if (row.status === "scheduled") {
      const qr = ((await guard.kvCommand(cfg, ["LRANGE", "adm:queue", "0", "99"]).catch(() => ({}))).result) || [];
      for (const raw of qr) { const it = parse(raw, null); if (it && it.imgId === row.imgId) await guard.kvCommand(cfg, ["LREM", "adm:queue", "1", raw]).catch(() => {}); }
      const d = new Date(Number(row.due || 0) + IST).toISOString().slice(0, 10);
      const held = await guard.kvCommand(cfg, ["GET", `dp:done:${d}`]).catch(() => ({}));
      if (held && held.result === "app") await guard.kvCommand(cfg, ["DEL", `dp:done:${d}`]).catch(() => {});
    }
    await guard.kvCommand(cfg, ["LREM", "pv:list", "0", row.id]).catch(() => {});
    await guard.kvCommand(cfg, ["DEL", `pv:${row.id}`]).catch(() => {});
    if (row.status !== "posted") await guard.kvCommand(cfg, ["DEL", `adm:img:${row.imgId}`]).catch(() => {});
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Unknown action" });
};
