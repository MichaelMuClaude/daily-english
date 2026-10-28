// Compares what the learner said (speech-to-text output) with the sentence they should have said.
// Word by word, in order: the score is the longest common run of words divided by the longer of the two
// sentences, so missing words and extra words both cost points. Case, punctuation and "five" vs "5" do not matter.
const PASS_SCORE = 80;

const NUMBER_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20',
};

function normaliseWord(w) {
  const x = w.toLowerCase().replace(/’/g, "'").replace(/(?<=\d)[,.](?=\d)/g, '').replace(/\./g, '');
  return NUMBER_WORDS[x] ?? x;
}

/** Splits into words, keeping the original spelling for display and a normalised form for comparing. */
function tokens(text) {
  const found = String(text ?? '').match(/[A-Za-z0-9]+(?:['’.,][A-Za-z0-9]+)*/g) || [];
  return found.map((w) => ({ word: w, key: normaliseWord(w) })).filter((t) => t.key);
}

/** Returns { score 0-100, passed, words: [{ word, ok }] } where words are the TARGET words (ok = said correctly). */
function compare(target, heard) {
  const a = tokens(target);
  const b = tokens(heard);
  const words = a.map((t) => ({ word: t.word, ok: false }));
  if (!a.length || !b.length) return { score: 0, passed: false, words };
  // Longest common subsequence of words.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i].key === b[j].key ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i].key === b[j].key) { words[i].ok = true; i++; j++; } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++; else j++;
  }
  const score = Math.round((100 * lcs[0][0]) / Math.max(a.length, b.length));
  return { score, passed: score >= PASS_SCORE, words };
}

module.exports = { compare, tokens, PASS_SCORE };
