'use strict';
const $ = (id) => document.getElementById(id);
const card = $('card');
const primary = $('primary');
const progress = $('progress');
const session = { learned: 0, reviewed: 0 };

async function api(path, body) {
  const res = await fetch(`/api${path}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function setPrimary(label, onClick) {
  primary.hidden = !label;
  primary.disabled = false;
  primary.textContent = label || '';
  primary.onclick = onClick || null;
}

function setProgress(text) {
  progress.hidden = !text;
  progress.textContent = text || '';
}

function setTotal(n) {
  if (typeof n !== 'number') return;
  const t = $('total');
  t.hidden = false;
  t.textContent = `📚 ${n} sentence${n === 1 ? '' : 's'} learned so far`;
}

function show(...nodes) {
  card.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function status(text) {
  setPrimary(null);
  show(el('p', 'status', text));
}

function showError(message) {
  setProgress(null);
  setPrimary('Try again', load);
  show(el('p', 'error', message));
}

// ---------- shared pieces ----------
// The sentence read aloud by the cloud neural voice (/api/speak). If that is unavailable,
// fall back to the voice built into the device.
function speakWithDevice(text, b, reset) {
  if (!('speechSynthesis' in window)) { b.textContent = '🔇 No voice available'; setTimeout(reset, 4000); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-AU';
  u.rate = 0.9;
  u.onend = reset;
  u.onerror = (e) => {
    if (e.error === 'canceled' || e.error === 'interrupted') return;
    b.textContent = '🔇 No voice on this device';
    setTimeout(reset, 4000);
  };
  window.speechSynthesis.speak(u);
}

function listenButton(id, text) {
  const b = el('button', 'listen', '🔊 Listen');
  b.type = 'button';
  b.setAttribute('aria-label', 'Listen to the sentence');
  let audio = null;
  const reset = () => { b.textContent = '🔊 Listen'; b.disabled = false; };
  const fallback = () => { speakWithDevice(text, b, reset); };
  b.addEventListener('click', () => {
    if (audio) { audio.pause(); audio.currentTime = 0; }
    b.disabled = true;
    b.textContent = '🔊 …';
    // Created and played inside the tap, which phones require before they allow sound.
    audio = audio || new Audio(`/api/speak/${id}`);
    audio.onended = reset;
    audio.onerror = () => { audio = null; fallback(); };
    audio.play().then(() => { b.textContent = '🔊 Playing…'; }).catch((err) => {
      if (err && err.name === 'AbortError') return;
      audio = null;
      fallback();
    });
  });
  return b;
}

function notesBlock({ notes, tip }) {
  const frag = document.createDocumentFragment();
  if (notes && notes.length) {
    const ul = el('ul', 'notes');
    ul.append(el('h2', null, '重点词句'));
    for (const n of notes) {
      const li = el('li');
      li.append(el('b', null, n.phrase), document.createTextNode(` — ${n.zh}`));
      ul.append(li);
    }
    frag.append(ul);
  }
  if (tip) frag.append(el('p', 'tip', tip));
  return frag;
}

// ---------- a new sentence ----------
function renderLearn(data) {
  const s = data.sentence;
  setProgress(`New ${data.step.n} / ${data.step.of}`);
  const c = el('section', 'card');
  c.append(el('p', 'label', 'New sentence'), el('p', 'en', s.english));
  const listen = listenButton(s.id, s.english);
  if (listen) c.append(listen);
  c.append(el('p', 'zh', s.chinese), notesBlock(s));
  show(c);
  setPrimary('Got it', async () => {
    primary.disabled = true;
    try {
      await api('/learn', { sentenceId: s.id });
      session.learned += 1;
      load();
    } catch (e) { primary.disabled = false; showError(e.message); }
  });
  primary.focus({ preventScroll: true });
}

// ---------- an old sentence to review ----------
function renderReview(data) {
  const item = data.item;
  setProgress(`Review · ${data.left} left`);
  const c = el('section', 'card');
  c.append(el('p', 'label', 'Say it in English'), el('p', 'zh big', item.chinese));
  const box = el('textarea');
  box.rows = 3; box.maxLength = 300; box.placeholder = 'Type the English sentence';
  box.setAttribute('aria-label', 'Your English sentence');
  box.autocapitalize = 'sentences'; box.spellcheck = false;
  const result = el('div', 'result');
  c.append(box, result);
  show(c);

  const check = async () => {
    const answer = box.value.trim();
    if (!answer) return;
    primary.disabled = true; box.disabled = true;
    result.replaceChildren(el('p', 'status', 'Marking…'));
    try {
      const r = await api('/review/answer', { sentenceId: item.id, answer });
      session.reviewed += 1;
      const score = el('p', `score ${r.correct ? 'good' : 'bad'}`, `${r.score} / 100  ${r.correct ? '✓ Good' : '✗ Not yet'}`);
      const ref = el('p', 'ref');
      ref.append('Original: ', el('b', null, r.original));
      const nodes = [score, el('p', 'feedback', r.feedback), ref];
      const listen = listenButton(item.id, r.original);
      if (listen) nodes.push(listen);
      nodes.push(notesBlock(r));
      result.replaceChildren(...nodes);
      setPrimary('Next', load);
      primary.focus({ preventScroll: true });
    } catch (e) {
      result.replaceChildren(el('p', 'error', e.message));
      box.disabled = false; primary.disabled = false;
    }
  };
  setPrimary('Check', check);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); } });
  box.focus({ preventScroll: true });
}

// ---------- finished ----------
function renderDone() {
  setProgress(null);
  setPrimary(null);
  const c = el('section', 'card done');
  const parts = [];
  if (session.learned) parts.push(`${session.learned} new`);
  if (session.reviewed) parts.push(`${session.reviewed} reviewed`);
  c.append(
    el('p', 'big', '🎉'),
    el('p', 'en', 'All done for today'),
    el('p', 'zh', parts.length ? `${parts.join(' · ')}. See you tomorrow!` : 'Nothing to review yet. See you tomorrow!'),
  );
  show(c);
}

// ---------- the one loop ----------
async function load() {
  status("Getting your next sentence… (the first visit of the day can take up to a minute)");
  setProgress(null);
  try {
    const data = await api('/next');
    setTotal(data.learnedTotal);
    if (data.kind === 'learn') renderLearn(data);
    else if (data.kind === 'review') renderReview(data);
    else renderDone();
  } catch (e) { showError(e.message); }
}

api('/me').then((m) => { $('who').textContent = m.email || ''; }).catch(() => {});
load();
