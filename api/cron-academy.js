// GET /api/cron-academy — daily 02:00 UTC (07:30 IST).
// • Sends each active student their Day-N study material PDF + tip (Sundays off)
// • Sends the trainer the full 30-day manual once, before the batch starts
// • Sends balance-fee reminders at T-7, T-3, T-1 and on the starting day
// Manual run: /api/cron-academy?key=<ADMIN_KEY>[&force=1][&day=5][&dry=1]
const guard = require("./_guard.js");
const notify = require("./_notify.js");
const docs = require("./_docs.js");
const DAYS = require("./_academy_days.json");

const BASE = "https://www.dermaluxe.ai";
const crypto = require("crypto");
const secret = () => process.env.STAFF_SECRET || process.env.ADMIN_KEY || process.env.WA_WEBHOOK_TOKEN || "";
const tokenFor = (id) => `${id}.${crypto.createHmac("sha256", secret()).update("acad:" + id).digest("hex").slice(0, 24)}`;
// gated links — only a paid student / listed trainer can open these
const MAT = (studentId, track, n) => `${BASE}/api/material?t=${encodeURIComponent(tokenFor(studentId))}&track=${track}&day=${n}`;
const MANUAL = (phone, track) => `${BASE}/api/material?t=${encodeURIComponent(tokenFor("t" + phone))}&book=${track}`;
const FULLBOOK = (phone) => `${BASE}/api/material?t=${encodeURIComponent(tokenFor("t" + phone))}&book=full`;
const istNow = () => new Date(Date.now() + 19800000);
const istDate = (d) => new Date(d.getTime()).toISOString().slice(0, 10);
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const phones = (s) => String(s || "").split(",").map(digits10).filter((x) => x.length === 10);

// training-day number for an IST date (1..30), skipping Sundays; 0 = not started, -1 = Sunday
function trainingDay(todayIso, startIso = docs.BATCH.startISO) {
  const start = new Date(startIso + "T00:00:00Z"), today = new Date(todayIso + "T00:00:00Z");
  if (today < start) return 0;
  if (today.getUTCDay() === 0) return -1;
  let n = 0;
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) n++;
  return n;
}
const daysUntil = (iso) => Math.round((new Date(iso + "T00:00:00Z") - new Date(istDate(istNow()) + "T00:00:00Z")) / 86400000);

module.exports = async (req, res) => {
  const q = req.query || {};
  const auth = String(req.headers.authorization || "");
  const okCron = process.env.CRON_SECRET ? auth === `Bearer ${process.env.CRON_SECRET}` : true;
  const okAdmin = process.env.ADMIN_KEY ? guard.safeEqual(String(req.headers["x-admin-key"] || q.key || ""), process.env.ADMIN_KEY) : false;
  if (!okCron && !okAdmin) return res.status(401).json({ error: "unauthorized" });
  const cfg = guard.kvConfig();
  if (!cfg) return res.status(200).json({ ok: false, note: "kv not configured" });

  const today = istDate(istNow());
  const force = q.force === "1", dry = q.dry === "1";
  const day = q.day !== undefined ? Number(q.day) : trainingDay(today);
  const out = { today, day, sent: [], reminders: [], trainer: null, skipped: null };

  if (!force) {
    const mark = await guard.kvCommand(cfg, ["SET", `acad:cron:${today}`, "1", "NX", "EX", "90000"]).catch(() => ({}));
    if (!mark || !mark.result) return res.status(200).json({ ok: true, skipped: "already ran today" });
  }

  // ---- students ----
  const lr = await guard.kvCommand(cfg, ["LRANGE", "acad:st:list", "0", "299"]).catch(() => ({}));
  const ids = lr.result || [];
  const students = [];
  for (const id of ids) {
    const r = await guard.kvCommand(cfg, ["GET", `acad:st:${id}`]).catch(() => ({}));
    try { if (r.result) students.push(JSON.parse(r.result)); } catch (e) {}
  }
  const active = students.filter((s) => ["enrolled", "active"].includes(String(s.status || "enrolled")) && digits10(s.phone).length === 10);

  // ---- trainer manual (once, from 3 days before the batch) ----
  const trainers = phones(process.env.ACADEMY_TRAINER_PHONES || process.env.ADMIN_PHONES);
  if (daysUntil(docs.BATCH.startISO) <= 3 && trainers.length) {
    for (const ph of trainers) {
      const nx = await guard.kvCommand(cfg, ["SET", `acad:manual:${ph}:${docs.BATCH.no}`, "1", "NX", "EX", "15552000"]).catch(() => ({}));
      if (!nx || !nx.result) continue;
      if (dry) { out.trainer = "would send " + ph; continue; }
      await notify.sendWa(ph, `👩‍🏫 *DermaLuxe Academy — Trainer material*\n\nBatch ${docs.BATCH.no} starts *${docs.BATCH.start}*.\nMottham 30 rojula study material (Skin + Hair) ikkada pampistunnanu — okkasare download chesukondi 📚\n\nRoju students ki aa roju material automatic ga veltundi (Sunday holiday).`);
      await notify.sendWaDocLink(ph, MANUAL(ph, "skin"), "DermaLuxe-Academy-Skin-30-Day-Trainer-Manual.pdf", "📘 Skin Care — 30-day trainer manual (all days)");
      await notify.sendWaDocLink(ph, MANUAL(ph, "hair"), "DermaLuxe-Academy-Hair-30-Day-Trainer-Manual.pdf", "📗 Hair Care — 30-day trainer manual (all days)");
      await notify.sendWaDocLink(ph, FULLBOOK(ph), "DermaLuxe-Academy-30-Day-Study-Material-Skin-and-Hair.pdf", "📚 Skin + Hair — complete 60-day study material in one book");
      out.trainer = ph;
    }
  }

  // ---- daily material + tip ----
  if (day === -1) out.skipped = "Sunday holiday";
  else if (day >= 1 && day <= 30) {
    for (const s of active) {
      const track = String(s.course) === "hair" ? "hair" : "skin";
      const tracks = String(s.course) === "both" ? ["skin", "hair"] : [track];
      const key = `acad:sent:${s.id}:${day}`;
      if (!force) { const nx = await guard.kvCommand(cfg, ["SET", key, "1", "NX", "EX", "5184000"]).catch(() => ({})); if (!nx || !nx.result) continue; }
      if (dry) { out.sent.push({ id: s.id, day, tracks, dry: true }); continue; }
      const d0 = DAYS[tracks[0]][day - 1];
      const dayLine = `📅 *Day ${day} of 30* — ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "short" })}`;
      await notify.sendWa(s.phone, `${dayLine}\n\n📚 *${d0.t}*\n${d0.te}\n\n🎯 ${d0.obj}\n🖐 ${d0.hands}\n\n💡 *Remember:* ${d0.keys.join(" · ")}\n\n✨ *Tip of the day:* ${d0.tip}\n\nEe roju material PDF ikkada 👇 Class ki mundu okasari chadavandi.\n\n🔒 Ee link mee personal link — share cheyakandi.`);
      for (const t of tracks) {
        const dd = DAYS[t][day - 1];
        await notify.sendWaDocLink(s.phone, MAT(s.id, t, day), `DermaLuxe-${t === "skin" ? "Skin" : "Hair"}-Day-${String(day).padStart(2, "0")}.pdf`,
          `📄 Day ${day} · ${t === "skin" ? "Skin Care" : "Hair Care"} — ${dd.t}`);
      }
      if (day === 1 && s.status !== "active") { s.status = "active"; await guard.kvCommand(cfg, ["SET", `acad:st:${s.id}`, JSON.stringify(s)]).catch(() => {}); }
      if (day === 30) await notify.sendWa(s.phone, `🎓 *Last day!* Ee roju final practical exam & viva. All the best ${String(s.name || "").split(" ")[0]} garu! 🌟\nPass ayyaka certificate WhatsApp lo vastundi.`);
      out.sent.push({ id: s.id, day, tracks });
    }
  }

  // ---- balance fee reminders ----
  const left = daysUntil(docs.BATCH.startISO);
  if ([7, 3, 1, 0].includes(left)) {
    for (const s of active) {
      const bal = Math.max(0, Number(s.fee || 0) - Number(s.paid || 0));
      if (bal <= 0) continue;
      const key = `acad:rem:${s.id}:${left}`;
      const nx = await guard.kvCommand(cfg, ["SET", key, "1", "NX", "EX", "2592000"]).catch(() => ({}));
      if (!nx || !nx.result) continue;
      if (dry) { out.reminders.push({ id: s.id, left, bal, dry: true }); continue; }
      const when = left === 0 ? "*ee roju* (course starting day)" : `*${left} roju${left > 1 ? "lu" : ""}* lo`;
      await notify.sendWa(s.phone, `💰 *Fee reminder — DermaLuxe Academy*\n\n${String(s.name || "").split(" ")[0]} garu, mee balance *₹${bal.toLocaleString("en-IN")}* ${when} pay cheyali.\n\n🆔 ${s.id} · ${docs.course(s).name}\n🗓 Batch ${docs.BATCH.no} — ${docs.BATCH.start}\n\nPayment details ki ikkade reply cheyandi, leda clinic lo direct ga pay cheyochu 😊`);
      out.reminders.push({ id: s.id, left, bal });
    }
  }
  return res.status(200).json({ ok: true, ...out, students: active.length });
};
module.exports.trainingDay = trainingDay;
