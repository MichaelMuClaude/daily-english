// Compares what the learner said (speech-to-text output) with the sentence they should have said.
// Word by word, in order: the score is the longest common run of words divided by the longer of the two
// sentences, so missing words and extra words both cost points. Case, punctuation, "five" vs "5", "I'm" vs "I am",
// small spelling slips of the recogniser ("market" vs "markets") and a few sound-alike words do not matter.
const PASS_SCORE = 65;

const NUMBER_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20',
};

// Words a recogniser cannot tell apart by sound: all of them count as the first word in their group.
const SOUND_ALIKE = [['there', 'their'], ['to', 'too'], ['here', 'hear'], ['by', 'buy', 'bye'], ['no', 'know'], ['right', 'write'], ['hour', 'our']];
const SOUNDS_LIKE = new Map(SOUND_ALIKE.flatMap(([head, ...rest]) => rest.map((w) => [w, head])));

function normaliseWord(w) {
  const x = w.toLowerCase().replace(/’/g, "'").replace(/(?<=\d)[,.](?=\d)/g, '').replace(/\./g, '');
  return NUMBER_WORDS[x] ?? SOUNDS_LIKE.get(x) ?? x;
}

/** "don't" -> ["do", "not"], "I'm" -> ["i", "am"]: the recogniser may write either form. */
function expand(key) {
  if (key === "can't" || key === 'cannot') return ['can', 'not'];
  if (key === "won't") return ['will', 'not'];
  if (key === "let's") return ['let', 'us'];
  let m = key.match(/^(.+)n't$/);
  if (m) return [m[1], 'not'];
  m = key.match(/^(.+)'(re|m|ve|ll|s)$/);
  if (m) return [m[1], { re: 'are', m: 'am', ve: 'have', ll: 'will', s: 'is' }[m[2]]];
  return [key];
}

/** Splits into words. Each token keeps the original word it came from (`group`) for display. */
function tokens(text) {
  const found = String(text ?? '').match(/[A-Za-z0-9]+(?:['’.,][A-Za-z0-9]+)*/g) || [];
  const out = [];
  found.forEach((word, group) => {
    const key = normaliseWord(word);
    if (!key) return;
    for (const k of expand(key)) out.push({ word, key: normaliseWord(k), group });
  });
  return out;
}

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** Same word, or so close that it is almost certainly the recogniser's spelling (market/markets, stay/stays). */
function same(a, b) {
  if (a.key === b.key) return true;
  if (/\d/.test(a.key) || /\d/.test(b.key)) return false;
  const shortest = Math.min(a.key.length, b.key.length);
  if (shortest < 4) return false;
  return distance(a.key, b.key) <= (Math.max(a.key.length, b.key.length) >= 8 ? 2 : 1);
}

const phrase = (toks) => toks.filter((t, i) => i === 0 || t.group !== toks[i - 1].group).map((t) => t.word).join(' ');

/**
 * Returns { score 0-100, passed, words, notes }.
 *  words: the TARGET words, ok = said correctly.
 *  notes: what went wrong, in order: { type: 'missing', expected } | { type: 'extra', said } | { type: 'wrong', expected, said }.
 */
function compare(target, heard) {
  const a = tokens(target);
  const b = tokens(heard);
  const words = [];
  for (const t of a) if (!words[t.group]) words[t.group] = { word: t.word, ok: false };
  const wordList = words.filter(Boolean);
  if (!a.length || !b.length) {
    const notes = a.length ? [{ type: 'missing', expected: phrase(a) }] : [];
    return { score: 0, passed: false, words: wordList, notes };
  }
  // Longest common subsequence of words.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = same(a[i], b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (same(a[i], b[j])) { pairs.push([i, j]); i++; j++; } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++; else j++;
  }
  // A word is ok only when every part of it was said (both halves of "I'm").
  const matched = new Set(pairs.map(([i]) => i));
  const groupOk = new Map();
  a.forEach((t, i) => groupOk.set(t.group, (groupOk.get(t.group) ?? true) && matched.has(i)));
  for (const [group, ok] of groupOk) words[group].ok = ok;

  const notes = [];
  let pi = 0;
  let pj = 0;
  for (const [ni, nj] of [...pairs, [a.length, b.length]]) {
    const missed = a.slice(pi, ni);
    const extra = b.slice(pj, nj);
    if (missed.length && extra.length) notes.push({ type: 'wrong', expected: phrase(missed), said: phrase(extra) });
    else if (missed.length) notes.push({ type: 'missing', expected: phrase(missed) });
    else if (extra.length) notes.push({ type: 'extra', said: phrase(extra) });
    pi = ni + 1;
    pj = nj + 1;
  }
  const score = Math.round((100 * pairs.length) / Math.max(a.length, b.length));
  return { score, passed: score >= PASS_SCORE, words: wordList, notes };
}

module.exports = { compare, tokens, PASS_SCORE };
