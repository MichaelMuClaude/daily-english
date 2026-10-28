// Text to speech with an Azure neural voice (runs in the cloud, same sound on every device).
// Uses the same AI Services resource as the language model, authenticated with Entra (no key).
const { cognitiveToken } = require('./azure');

const FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const MAX_TEXT = 400;

const escapeXml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function buildSsml(text, voice) {
  return `<speak version='1.0' xml:lang='en-AU'><voice name='${escapeXml(voice)}'><prosody rate='-5%'>${escapeXml(text)}</prosody></voice></speak>`;
}

/** Returns an MP3 Buffer for the text. Throws if the service refuses. */
async function synthesize(text, { fetchImpl = fetch, getToken = cognitiveToken, env = process.env } = {}) {
  const clean = String(text ?? '').trim();
  if (!clean || clean.length > MAX_TEXT) throw new Error('Bad text for speech');
  const endpoint = env.AOAI_ENDPOINT.replace(/\/$/, '');
  const res = await fetchImpl(`${endpoint}/tts/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': FORMAT,
      'User-Agent': 'daily-english',
    },
    body: buildSsml(clean, env.SPEECH_VOICE || 'en-AU-NatashaNeural'),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Speech HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 1000) throw new Error('Speech returned almost no audio');
  return audio;
}

module.exports = { synthesize, buildSsml };
