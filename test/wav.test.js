const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeWav, downsample } = require('../public/wav');
const { checkWav } = require('../src/wav');

const tone = (seconds, rate) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5);
const wavOf = (seconds, rate = 48000) => Buffer.from(encodeWav(tone(seconds, rate), rate));

test('the browser encoder makes a 16 kHz 16-bit mono WAV that the server accepts', () => {
  const buf = wavOf(2);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.ok(Math.abs(checkWav(buf).seconds - 2) < 0.01);
});

test('downsampling keeps the duration and averages samples', () => {
  const out = downsample(Float32Array.from([1, 1, 1, 0, 0, 0]), 48000, 16000);
  assert.deepEqual(Array.from(out), [1, 0]);
  assert.throws(() => downsample(new Float32Array(10), 8000, 16000), /upsample/);
});

test('samples are clipped, not wrapped, when the signal is too loud', () => {
  const buf = Buffer.from(encodeWav(Float32Array.from([2, -2, 2, -2]), 16000));
  assert.equal(buf.readInt16LE(44), 32767);
  assert.equal(buf.readInt16LE(46), -32768);
});

test('the server refuses anything that is not a proper short 16 kHz mono WAV', () => {
  assert.throws(() => checkWav(Buffer.from('hello')), /No recording/);
  assert.throws(() => checkWav(Buffer.alloc(5000)), /not a WAV/);
  assert.throws(() => checkWav(wavOf(0.2)), /too short/);
  assert.throws(() => checkWav(wavOf(25)), /too long/);
  const stereo = wavOf(2);
  stereo.writeUInt16LE(2, 22);
  assert.throws(() => checkWav(stereo), /16 kHz mono/);
  const wrongRate = wavOf(2);
  wrongRate.writeUInt32LE(44100, 24);
  assert.throws(() => checkWav(wrongRate), /16 kHz mono/);
});
