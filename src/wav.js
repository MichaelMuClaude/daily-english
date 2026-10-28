// Checks that an uploaded recording really is a short 16 kHz, 16-bit, mono PCM WAV before it is sent on.
const MIN_SECONDS = 0.5;
const MAX_SECONDS = 20;

/** Returns { seconds } or throws an Error whose message is safe to show to the user. */
function checkWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) throw new Error('No recording received');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE' || buf.toString('ascii', 12, 16) !== 'fmt ') {
    throw new Error('The recording is not a WAV file');
  }
  const format = buf.readUInt16LE(20);
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (format !== 1 || channels !== 1 || rate !== 16000 || bits !== 16 || buf.toString('ascii', 36, 40) !== 'data') {
    throw new Error('The recording must be 16 kHz mono 16-bit');
  }
  const seconds = (buf.length - 44) / (16000 * 2);
  if (seconds < MIN_SECONDS) throw new Error('The recording is too short');
  if (seconds > MAX_SECONDS + 0.5) throw new Error('The recording is too long');
  return { seconds };
}

module.exports = { checkWav, MAX_SECONDS };
