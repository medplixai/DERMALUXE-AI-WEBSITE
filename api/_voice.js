// Shared voice stack for every channel agent (WhatsApp / Instagram / Messenger)
// and the phone line: Gemini speech-to-text in, Gemini TTS out, encoded to MP3
// in-process (no ffmpeg on serverless) with the pure-JS lamejs port.
//
// CRITICAL model lesson: API keys created after mid-2026 only get the Gemini
// 3.x lineup — 2.5-era names are still listed by the API but 404 for new keys,
// and 2.0-flash's free tier is literally limit:0. The '-latest' aliases track
// the current generation, so they lead the fallback chains. Each model carries
// its own quota, so 429/404 falls through to the next instead of giving up.
const crypto = require("crypto");
const guard = require("./_guard.js");

// Ask Claude for a spoken version of its reply (appended as one extra line).
const VOICE_CTX = "[The patient sent this as a VOICE note. After your normal reply, append ONE extra final line formatted exactly as VOICE_SCRIPT: <script> — a natural spoken version of your reply for text-to-speech: the same language the patient spoke (if they spoke Telugu, write the script in Telugu script), warm receptionist tone, digits and times spoken naturally, no emojis, no URLs, no lists, under 55 words.] ";

// Pull "VOICE_SCRIPT: ..." off the reply → { reply, script }.
function parseVoiceScript(reply) {
  const m = String(reply || "").match(/\n?\s*VOICE_SCRIPT\s*:\s*([\s\S]+?)\s*$/);
  if (!m) return { reply: String(reply || ""), script: "" };
  return { reply: String(reply).slice(0, m.index).trim(), script: m[1].trim().slice(0, 450) };
}

// Emojis, markdown and URLs are noise when spoken aloud.
function stripForTts(s) {
  return String(s || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_`#>·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Voice note → text. Claude has no audio input, so this is the STT leg only.
async function transcribe(base64, mime, channel) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !base64) return null;
  const models = [];
  if (process.env.STT_MODEL) models.push(process.env.STT_MODEL);
  ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash"].forEach((m) => {
    if (models.indexOf(m) === -1) models.push(m);
  });
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `Transcribe this ${channel || "WhatsApp"} voice note exactly. It may be Telugu, Tenglish (Telugu in English letters), English, or mixed. If Telugu is spoken, transcribe in Telugu script. Output ONLY the transcription, nothing else.` },
              { inline_data: { mime_type: mime || "audio/ogg", data: base64 } },
            ],
          }],
        }),
      });
      if (r.status === 429 || r.status === 404) { // per-model quota / renamed model
        let d = ""; try { d = (await r.text()).slice(0, 400); } catch (e) {}
        console.error("voice: stt skipping model", model, r.status, d);
        continue;
      }
      if (!r.ok) {
        let d = ""; try { d = (await r.text()).slice(0, 400); } catch (e) {}
        console.error("voice: stt failed", model, r.status, d);
        return null;
      }
      const d = await r.json();
      const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
      const text = parts.map((p) => p.text || "").join(" ").trim();
      if (text) return text;
    } catch (e) {
      console.error("voice: stt error", model, e && e.message);
      return null;
    }
  }
  return null;
}

// Gemini TTS returns raw 16-bit mono PCM; every channel wants a real container,
// so encode MP3 here. The Int16Array view needs a 2-byte-aligned buffer, hence
// the copy into a fresh ArrayBuffer.
async function pcmToMp3(pcm, rate) {
  const lame = await import("@breezystack/lamejs"); // ESM-only package
  const Mp3Encoder = lame.Mp3Encoder || (lame.default && lame.default.Mp3Encoder);
  const byteLen = pcm.length - (pcm.length % 2);
  const ab = new ArrayBuffer(byteLen);
  new Uint8Array(ab).set(pcm.subarray(0, byteLen));
  const samples = new Int16Array(ab);
  const enc = new Mp3Encoder(1, rate || 24000, 48);
  const out = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const buf = enc.encodeBuffer(samples.subarray(i, i + 1152));
    if (buf.length) out.push(Buffer.from(buf));
  }
  const end = enc.flush();
  if (end.length) out.push(Buffer.from(end));
  return Buffer.concat(out);
}

// Text → MP3 Buffer (null on any failure; callers fall back to text-only).
async function synthesize(script) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !script) return null;
  const models = [process.env.TTS_MODEL || "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"];
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: script }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.TTS_VOICE || "Aoede" } } },
          },
        }),
      });
      if (r.status === 404 || r.status === 429) {
        let d = ""; try { d = (await r.text()).slice(0, 400); } catch (e) {}
        console.error("voice: tts skipping model", model, r.status, d);
        continue;
      }
      if (!r.ok) {
        let d = ""; try { d = (await r.text()).slice(0, 400); } catch (e) {}
        console.error("voice: tts failed", model, r.status, d);
        return null;
      }
      const d = await r.json();
      const part = ((((d.candidates || [])[0] || {}).content || {}).parts || [])
        .find((p) => (p.inlineData || p.inline_data || {}).data);
      const inline = part && (part.inlineData || part.inline_data);
      if (!inline) return null;
      const m = String(inline.mimeType || inline.mime_type || "").match(/rate=(\d+)/);
      return await pcmToMp3(Buffer.from(inline.data, "base64"), m ? Number(m[1]) : 24000);
    } catch (e) {
      console.error("voice: tts error", e && e.message);
      return null;
    }
  }
  return null;
}

// Instagram, Messenger and Twilio all want a PUBLIC URL rather than an upload,
// so park the MP3 in KV for a few minutes; api/media.js?aud=<id> serves it.
async function parkAudio(cfg, mp3, ttl) {
  if (!cfg || !mp3 || !mp3.length) return "";
  try {
    const id = crypto.randomBytes(16).toString("hex");
    await guard.kvCommand(cfg, ["SET", `adm:aud:${id}`, mp3.toString("base64"), "EX", String(ttl || 900)]);
    return id;
  } catch (e) {
    console.error("voice: park failed", e && e.message);
    return "";
  }
}

// Public base URL of this deployment, from the incoming request.
function publicBase(req) {
  const host = String((req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "www.dermaluxe.ai");
  return `https://${host}`;
}

module.exports = { VOICE_CTX, parseVoiceScript, stripForTts, transcribe, synthesize, pcmToMp3, parkAudio, publicBase };
