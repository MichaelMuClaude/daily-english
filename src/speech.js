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

/**
 * Speech to text for a short (up to 20 s) 16 kHz mono WAV. Returns the recognised text, or '' when nothing
 * clear was heard. Throws if the service itself fails. The recording is never stored or logged.
 */
async function transcribe(wav, { fetchImpl = fetch, getToken = cognitiveToken, env = process.env } = {}) {
  const endpoint = env.AOAI_ENDPOINT.replace(/\/$/, '');
  const res = await fetchImpl(`${endpoint}/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-AU&format=simple`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      Accept: 'application/json',
      'User-Agent': 'daily-english',
    },
    body: wav,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Speech-to-text HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.RecognitionStatus === 'Success') return String(data.DisplayText ?? '');
  // These just mean "no usable speech in the recording".
  if (['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout'].includes(data.RecognitionStatus)) return '';
  throw new Error(`Speech-to-text status ${data.RecognitionStatus}`);
}

module.exports = { synthesize, buildSsml, transcribe };
