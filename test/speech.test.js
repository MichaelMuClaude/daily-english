const test = require('node:test');
const assert = require('node:assert/strict');
const { synthesize, buildSsml, transcribe } = require('../src/speech');

const env = { AOAI_ENDPOINT: 'https://example.cognitiveservices.azure.com/', SPEECH_VOICE: 'en-AU-NatashaNeural' };
const okFetch = (capture) => async (url, opts) => {
  Object.assign(capture, { url, opts });
  return { ok: true, arrayBuffer: async () => new Uint8Array(5000).buffer };
};

test('buildSsml escapes XML so a sentence can never break out of the markup', () => {
  const ssml = buildSsml(`Tom & Jerry's <b>"cheap"</b> ride`, 'en-AU-NatashaNeural');
  assert.doesNotMatch(ssml, /<b>/);
  assert.match(ssml, /Tom &amp; Jerry&apos;s &lt;b&gt;&quot;cheap&quot;&lt;\/b&gt; ride/);
  assert.match(ssml, /voice name='en-AU-NatashaNeural'/);
});

test('synthesize sends an Entra bearer token (no key) to the TTS endpoint and returns the MP3 bytes', async () => {
  const cap = {};
  const audio = await synthesize('Hello there, mate.', { fetchImpl: okFetch(cap), getToken: async () => 'TOKEN123', env });
  assert.equal(cap.url, 'https://example.cognitiveservices.azure.com/tts/cognitiveservices/v1');
  assert.equal(cap.opts.headers.Authorization, 'Bearer TOKEN123');
  assert.equal(cap.opts.headers['Content-Type'], 'application/ssml+xml');
  assert.match(cap.opts.headers['X-Microsoft-OutputFormat'], /mp3/);
  assert.doesNotMatch(JSON.stringify(cap.opts.headers), /Ocp-Apim|api-key/i);
  assert.equal(audio.length, 5000);
});

test('synthesize refuses empty or oversize text before calling the service', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(5000) }; };
  for (const t of ['', '   ', null, 'x'.repeat(401)]) {
    await assert.rejects(synthesize(t, { fetchImpl, getToken: async () => 't', env }), /Bad text/);
  }
  assert.equal(calls, 0);
});

test('synthesize reports a service error and rejects a nearly empty answer', async () => {
  await assert.rejects(synthesize('Hi there.', { fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'forbidden' }), getToken: async () => 't', env }), /Speech HTTP 403/);
  await assert.rejects(synthesize('Hi there.', { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) }), getToken: async () => 't', env }), /almost no audio/);
});

const sttFetch = (capture, body, status = 200) => async (url, opts) => {
  Object.assign(capture, { url, opts });
  return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) };
};

test('transcribe sends the WAV with an Entra bearer token (no key) and returns the recognised text', async () => {
  const cap = {};
  const wav = Buffer.from('RIFFxxxx');
  const text = await transcribe(wav, { fetchImpl: sttFetch(cap, { RecognitionStatus: 'Success', DisplayText: 'Hello there.' }), getToken: async () => 'TOKEN123', env });
  assert.equal(text, 'Hello there.');
  assert.match(cap.url, /^https:\/\/example\.cognitiveservices\.azure\.com\/stt\/speech\/recognition\/conversation\/cognitiveservices\/v1\?language=en-AU/);
  assert.equal(cap.opts.headers.Authorization, 'Bearer TOKEN123');
  assert.match(cap.opts.headers['Content-Type'], /audio\/wav.*samplerate=16000/);
  assert.equal(cap.opts.body, wav);
  assert.doesNotMatch(JSON.stringify(cap.opts.headers), /Ocp-Apim|api-key/i);
});

test('transcribe returns empty text when nothing clear was heard, and throws when the service fails', async () => {
  for (const RecognitionStatus of ['NoMatch', 'InitialSilenceTimeout']) {
    assert.equal(await transcribe(Buffer.alloc(10), { fetchImpl: sttFetch({}, { RecognitionStatus }), getToken: async () => 't', env }), '');
  }
  await assert.rejects(transcribe(Buffer.alloc(10), { fetchImpl: sttFetch({}, { error: 'x' }, 401), getToken: async () => 't', env }), /HTTP 401/);
  await assert.rejects(transcribe(Buffer.alloc(10), { fetchImpl: sttFetch({}, { RecognitionStatus: 'Error' }), getToken: async () => 't', env }), /status Error/);
});
