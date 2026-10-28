// Turns recorded microphone samples into a 16 kHz, 16-bit, mono WAV file (the format the speech service accepts).
// Runs in the browser; also loaded by the tests under Node.
(function (root) {
  const TARGET_RATE = 16000;

  /** Averages groups of samples down to the target rate. */
  function downsample(samples, fromRate, toRate = TARGET_RATE) {
    if (fromRate === toRate) return samples;
    if (fromRate < toRate) throw new Error('Cannot upsample');
    const ratio = fromRate / toRate;
    const out = new Float32Array(Math.floor(samples.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j];
      out[i] = end > start ? sum / (end - start) : 0;
    }
    return out;
  }

  /** samples: Float32Array in [-1, 1] at sampleRate. Returns an ArrayBuffer holding a WAV file. */
  function encodeWav(samples, sampleRate) {
    const pcm = downsample(samples, sampleRate);
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buffer);
    const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, TARGET_RATE, true); v.setUint32(28, TARGET_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    text(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  const api = { downsample, encodeWav, TARGET_RATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WavEncoder = api;
})(typeof window !== 'undefined' ? window : globalThis);
