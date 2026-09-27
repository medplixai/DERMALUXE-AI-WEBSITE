// Speaking back, and what happens when Google says no.
//
// The clinic's Gemini key is on the free tier, where the TTS models get ten
// requests a day and gemini-2.5-pro-preview-tts gets none at all. Once that is
// spent, every voice note costs three round trips to Google that cannot
// succeed — and they happen BEFORE the patient's text reply is sent, so the
// cost is somebody sitting in front of a chat with no answer in it yet.
//
// Two things matter here and nothing else does: the patient always gets their
// answer, and nobody waits on a call that is known to fail.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

process.env.GEMINI_API_KEY = "test-key";
delete process.env.TTS_MODEL;
delete require.cache[path.join(API, "_voice.js")];
const voice = require(path.join(API, "_voice.js"));
const cfg = { kind: "pg" };

const FLASH31 = "gemini-3.1-flash-tts-preview";
const FLASH25 = "gemini-2.5-flash-preview-tts";
const PRO25 = "gemini-2.5-pro-preview-tts";

// Which models were actually asked, and what each of them answers.
let asked = [];
let answer = {};                       // model → 429 | 404 | "audio" | "empty"
const quota = (m) => JSON.stringify({ error: { code: 429, message: `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ${m === PRO25 ? 0 : 10}` } });
// A short run of silence is enough: this only has to come back as a Buffer.
const pcm = Buffer.alloc(4608).toString("base64");

global.fetch = async (url) => {
  const model = String(url).match(/models\/([^:]+):/)[1];
  asked.push(model);
  const a = answer[model] || 429;
  if (a === 429) return { ok: false, status: 429, text: async () => quota(model) };
  if (a === 404) return { ok: false, status: 404, text: async () => "not found" };
  if (a === "empty") return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [] } }] }) };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: pcm } }] } }] }) };
};

const clearMarks = () => { for (const m of [FLASH31, FLASH25, PRO25]) h.run(["DEL", `voice:out:${m}`]); };

(async () => {
  console.log("SPEAKING BACK\n");

  console.log("  — when it works —");
  clearMarks(); asked = []; answer = { [FLASH31]: "audio" };
  const good = await voice.synthesize("Repu padakonda gantalaki slot undi andi", cfg);
  is(Buffer.isBuffer(good) && good.length > 0, true, "the first model answers and an MP3 comes back");
  is(asked, [FLASH31], "and nothing else is asked — the others cost money and time for nothing");
  is(h.run(["GET", `voice:out:${FLASH31}`]), null, "a model that worked is not written off");

  console.log("\n  — when the day's free quota is gone —");
  clearMarks(); asked = []; answer = {};                 // every one of them 429s
  const none = await voice.synthesize("Repu padakonda gantalaki slot undi andi", cfg);
  is(none, null, "no audio, which the caller turns into a text-only reply");
  is(asked, [FLASH31, FLASH25, PRO25], "all three are tried once");
  is([h.run(["GET", `voice:out:${FLASH31}`]), h.run(["GET", `voice:out:${PRO25}`])], ["1", "1"], "and each one is remembered as spent");

  // The whole point. The next patient's answer must not wait behind three
  // calls to Google that are already known to fail.
  asked = [];
  is(await voice.synthesize("Inko patient", cfg), null, "the next voice note still gets no audio");
  is(asked, [], "but NOTHING is asked of Google — nobody waits for a refusal we already have");

  console.log("\n  — one model spent, another not —");
  clearMarks(); asked = []; answer = { [FLASH25]: "audio" };
  const second = await voice.synthesize("Hello andi", cfg);
  is(Buffer.isBuffer(second), true, "the second model carries it");
  is(asked, [FLASH31, FLASH25], "the first is tried and spent; the third is never reached");
  asked = [];
  is(Buffer.isBuffer(await voice.synthesize("Malli", cfg)), true, "the next one still gets audio");
  is(asked, [FLASH25], "straight to the one that works — the spent one is skipped");

  console.log("\n  — a model this key cannot use at all —");
  clearMarks(); asked = []; answer = { [FLASH31]: 404, [FLASH25]: "audio" };
  await voice.synthesize("Hello andi", cfg);
  is(h.run(["GET", `voice:out:${FLASH31}`]), "1", "a 404 is written off the same way — the key does not have it");

  console.log("\n  — it heals by itself —");
  // An hour, not a day: the moment the quota rolls over or billing is switched
  // on, voice comes back without anybody touching the app.
  is(voice.OUT_TTL, 3600, "the note lasts an hour");
  is(Number(h.run(["TTL", `voice:out:${FLASH31}`])) > 3000, true, "and is set to expire, never kept for ever");
  clearMarks(); asked = []; answer = { [FLASH31]: "audio" };
  is(Buffer.isBuffer(await voice.synthesize("Malli vachchindi", cfg)), true, "once it expires, the first model is asked again and voice returns");

  console.log("\n  — with no store —");
  // The phone line and the older callers pass no cfg. Nothing is remembered,
  // which is exactly how it behaved before, and never an error.
  clearMarks(); asked = []; answer = {};
  is(await voice.synthesize("Hello"), null, "it still works without a store");
  is(asked.length, 3, "trying every model, remembering nothing");
  asked = [];
  await voice.synthesize("Hello");
  is(asked.length, 3, "so it tries them all again next time — the old behaviour, unchanged");

  console.log("\n  — nothing to say —");
  asked = [];
  is([await voice.synthesize("", cfg), asked.length], [null, 0], "an empty script asks nobody anything");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nvoice behaves");
  process.exit(fails ? 1 : 0);
})();
