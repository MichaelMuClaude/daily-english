// Spaced repetition: a simple Leitner schedule.
// A sentence sits in box 1..5. Each box has a review interval in days.
const INTERVALS = [1, 3, 7, 14, 30]; // box 1 -> 1 day, ... box 5 -> 30 days
const MAX_BOX = INTERVALS.length;

/** Perth calendar day (YYYY-MM-DD) for a given instant. */
function perthDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(date);
}

/** Add whole days to a YYYY-MM-DD string (calendar arithmetic, no timezone drift). */
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Next state after a review.
 * Correct answer: move up one box (capped); wrong answer: back to box 1.
 */
function nextState(box, correct, today) {
  const nextBox = correct ? Math.min(box + 1, MAX_BOX) : 1;
  return { box: nextBox, nextReview: addDays(today, INTERVALS[nextBox - 1]) };
}

module.exports = { INTERVALS, MAX_BOX, perthDay, addDays, nextState };
