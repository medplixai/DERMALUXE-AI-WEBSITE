// Saving a lead that replaces the same conversation's earlier row.
//
// Every chat channel — WhatsApp, the website chat, Instagram, Messenger, the
// phone agent — keeps one lead per conversation and replaces it as the chat
// fills in. Five copies of that loop had the same two faults:
//
//  - The desk's status and call notes are keyed "<ts>|<phone>". The new row
//    has a new timestamp, so a lead the desk had already called went back to
//    New and its notes were orphaned.
//  - The old row was removed before the new one was written. If the write
//    failed, the lead was gone from the dashboard entirely.
//
// Now: write the new row first, remove the old ones only once it is in, and
// move the desk's status and notes across.
const guard = require("./_guard.js");
const LIST_KEY = "dl_leads";

// The staff app's key for a lead (staff.js leadKey) — must match it exactly.
const deskKey = (l) => `${l.ts}|${String(l.phone || "").replace(/\D/g, "").slice(-10) || l.src_id || ""}`;

// Moves status and notes from replaced rows (newest first) to the new key.
// Status: the newest one set. Notes: all of them, newest first.
async function carryDeskState(cfg, oldKeys, newKey) {
  const hget = async (h, k) => ((await guard.kvCommand(cfg, ["HGET", h, k]).catch(() => ({}))) || {}).result || null;
  let status = null, statusTs = null, notes = [];
  for (const k of oldKeys) {
    const st = await hget("dl_status", k);
    if (st && !status) { status = st; statusTs = await hget("dl_status_ts", k); }
    try { notes = notes.concat(JSON.parse((await hget("dl_notes", k)) || "[]")); } catch (e) {}
  }
  if (status) await guard.kvCommand(cfg, ["HSET", "dl_status", newKey, status]);
  if (statusTs) await guard.kvCommand(cfg, ["HSET", "dl_status_ts", newKey, statusTs]);
  if (notes.length) await guard.kvCommand(cfg, ["HSET", "dl_notes", newKey, JSON.stringify(notes.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 30))]);
  for (const h of ["dl_status", "dl_status_ts", "dl_notes"]) await guard.kvCommand(cfg, ["HDEL", h].concat(oldKeys)).catch(() => {});
}

// same(oldLead) → true when oldLead is this conversation's earlier row.
// Returns whether the new row was stored.
async function saveLead(cfg, lead, same, scan) {
  if (!cfg) return false;
  let before = [];
  try {
    const r = await guard.kvCommand(cfg, ["LRANGE", LIST_KEY, "0", String((scan || 50) - 1)]);
    before = (r && r.result) || [];
  } catch (e) {}
  const stored = await guard.kvWrite(cfg, ["LPUSH", LIST_KEY, JSON.stringify(lead)], "new lead");
  if (!stored) return false;               // the old row stays — better a stale lead than none
  await guard.kvCommand(cfg, ["LTRIM", LIST_KEY, "0", "4999"]).catch(() => {});
  const replaced = [];
  for (const s of before) {
    let l; try { l = JSON.parse(s); } catch (e) { continue; }
    if (!l || !same(l)) continue;
    const r = await guard.kvCommand(cfg, ["LREM", LIST_KEY, "1", s]).catch(() => ({}));
    if (r && r.result) replaced.push(deskKey(l));
  }
  if (replaced.length) await carryDeskState(cfg, replaced, deskKey(lead)).catch(() => {});
  return true;
}

module.exports = { saveLead, deskKey, carryDeskState, LIST_KEY };
