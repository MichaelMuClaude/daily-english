// The free serverless database pauses itself when idle. The first connection while it wakes up
// fails (error 40613, or "Connection is closed"). Those errors are normal and worth retrying.
const TRANSIENT_CODES = new Set(['ECONNCLOSED', 'ESOCKET', 'ETIMEOUT', 'ELOGIN', 'ECONNRESET', 'ENOTOPEN', 'ECONNREFUSED']);
const TRANSIENT_NUMBERS = new Set([40613, 40197, 40501, 49918, 49919, 49920, 4060, 10928, 10929, 18456]);

function isTransient(err) {
  if (!err) return false;
  return TRANSIENT_CODES.has(err.code)
    || TRANSIENT_NUMBERS.has(err.number)
    || /Connection is closed|is not currently available|ECONNRESET|socket hang up/i.test(String(err.message));
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run fn; on a transient error call onRetry (to drop a broken connection pool), wait, and try again.
 * Non-transient errors (a constraint violation, bad SQL) are thrown immediately.
 */
async function withRetry(fn, { delays = [4000, 8000, 12000, 16000, 20000], sleep = sleepMs, onRetry = () => {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err) || attempt >= delays.length) throw err;
      await onRetry(err);
      await sleep(delays[attempt]);
    }
  }
}

module.exports = { isTransient, withRetry };
