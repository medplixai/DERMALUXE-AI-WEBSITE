// "Rendu sarlu call chesam, lift avvaledu" — not one minute after "ippudu
// call chestunnaru".
//
// After a second unanswered call the patient gets one WhatsApp asking for a
// time that suits them (staff.js, outcome "noanswer"). On 13 Nov it went out
// in the same minute as the call heads-up, eleven times that evening: the
// patient read "Hemasri is calling you now" and, before they could pick up or
// ring back, "we called twice and you did not answer". Now, when the heads-up
// went less than a quarter of an hour ago, the message waits; the hourly
// follow-up sends it once the quarter hour is up — unless the patient has
// written to us, or booked, in the meantime.
//
// KV: ntf:callhd:<phone>  when the heads-up went (ms; "1" on keys from before)
//     noans:due:<phone>   the waiting message {first, by, key, at} (2 days)
//     noans:dueq          the phones with one waiting
//     ntf:noans:<phone>   it went (7 days) — once a week, however many marks
const guard = require("./_guard.js");
const notify = require("./_notify.js");

const WAIT_MS = 15 * 60000;
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const textFor = (first) => `${first} garu, DermaLuxe nunchi rendu sarlu call chesam, lift avvaledu 🙏 Meeku convenient time ikkada cheppandi — WhatsApp lo ne slot book chestam 😊`;

async function send(cfg, ph, first, by) {
  const msg = textFor(first);
  let sent = false;
  if (await notify.windowOpen(cfg, ph)) sent = !!(await notify.sendWa(ph, msg).catch(() => false));
  else sent = !!(((await notify.sendWaTemplate(ph, "clinic_update", [first, msg.slice(0, 250)]).catch(() => ({}))) || {}).ok);
  if (sent) { try { await require("./_inbox.js").log(cfg, ph, { dir: "out", text: msg, by: by || "ai" }); } catch (e) {} }
  return sent;
}

// The desk's second "no answer": send now, or hold it for the quarter hour.
// Returns {sent} or {held}.
async function after(cfg, o) {
  const { ph, first, by, key } = o;
  const hd = ((await guard.kvCommand(cfg, ["GET", `ntf:callhd:${ph}`]).catch(() => ({}))) || {}).result;
  const hdAt = Number(hd) > 1e12 ? Number(hd) : 0;
  const nx = await guard.kvCommand(cfg, ["SET", `ntf:noans:${ph}`, "1", "NX", "EX", "604800"]).catch(() => ({}));
  if (!(nx && nx.result)) return { already: true };
  if (hdAt && Date.now() - hdAt < WAIT_MS) {
    await guard.kvCommand(cfg, ["SET", `noans:due:${ph}`, JSON.stringify({ first, by, key, at: Date.now(), after: hdAt + WAIT_MS }), "EX", "172800"]).catch(() => {});
    await guard.kvCommand(cfg, ["LREM", "noans:dueq", "0", ph]).catch(() => {});
    await guard.kvCommand(cfg, ["LPUSH", "noans:dueq", ph]).catch(() => {});
    return { held: true };
  }
  const sent = await send(cfg, ph, first, by);
  if (!sent) await guard.kvCommand(cfg, ["DEL", `ntf:noans:${ph}`]).catch(() => {});   // the next mark may try again
  return { sent };
}

// The hourly follow-up: send the held ones whose quarter hour is up.
async function flush(cfg) {
  const out = { sent: 0, dropped: 0, waiting: 0 };
  if (!cfg) return out;
  const q = ((await guard.kvCommand(cfg, ["LRANGE", "noans:dueq", "0", "99"]).catch(() => ({}))) || {}).result || [];
  for (const ph of q) {
    const d = parse(((await guard.kvCommand(cfg, ["GET", `noans:due:${ph}`]).catch(() => ({}))) || {}).result || "", null);
    const done = async () => { await guard.kvCommand(cfg, ["DEL", `noans:due:${ph}`]).catch(() => {}); await guard.kvCommand(cfg, ["LREM", "noans:dueq", "0", ph]).catch(() => {}); };
    if (!d) { await done(); continue; }
    if (Date.now() < Number(d.after || 0)) { out.waiting++; continue; }
    // They wrote back, or the lead is booked: the question has been answered.
    const meta = await require("./_inbox.js").meta(cfg, ph).catch(() => null);
    const st = d.key ? ((await guard.kvCommand(cfg, ["HGET", "dl_status", d.key]).catch(() => ({}))) || {}).result : "";
    if ((meta && Number(meta.lastIn) > Number(d.at)) || st === "booked" || st === "visited" || st === "closed") { await done(); out.dropped++; continue; }
    if (await send(cfg, ph, d.first, d.by)) out.sent++;
    await done();
  }
  return out;
}

module.exports = { after, flush, send, textFor, WAIT_MS };
