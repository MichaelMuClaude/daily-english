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

// ---------- the microphone ----------
const MAX_RECORD_MS = 19500; // the server accepts up to 20 s

// Starts recording. Must be called straight from a tap (phones only allow audio then). Returns { stop() -> WAV bytes }.
async function startRecording() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !window.AudioWorklet || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const err = new Error('This browser cannot record audio');
    err.name = 'NotSupportedError';
    throw err;
  }
  const ctx = new Ctx(); // created inside the tap, before any await
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    await ctx.resume();
    await ctx.audioWorklet.addModule('recorder-worklet.js');
  } catch (err) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    throw err;
  }
  const chunks = [];
  const node = new AudioWorkletNode(ctx, 'capture');
  node.port.onmessage = (e) => chunks.push(e.data);
  const silent = ctx.createGain(); // a worklet only runs while it is connected to the output; this keeps it silent
  silent.gain.value = 0;
  ctx.createMediaStreamSource(stream).connect(node);
  node.connect(silent).connect(ctx.destination);
  return {
    async stop() {
      stream.getTracks().forEach((t) => t.stop());
      node.disconnect();
      const rate = ctx.sampleRate;
      await ctx.close();
      const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) { all.set(c, at); at += c.length; }
      return WavEncoder.encodeWav(all, rate);
    },
  };
}

async function sendRecording(path, wav) {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Turns the big bottom button into a record / stop button. Tap once to start, tap again (or wait 20 s) to send.
 * onReply gets the server's answer; onNoMic is called when the microphone cannot be used at all.
 */
function micControl({ label, path, result, onReply, onNoMic }) {
  let rec = null;
  let timer = null;
  const idle = () => setPrimary(`🎤 ${label}`, toggle);

  async function toggle() {
    if (rec) return finish();
    primary.disabled = true;
    try {
      rec = await startRecording();
    } catch (err) {
      rec = null;
      idle();
      return onNoMic(err);
    }
    primary.disabled = false;
    primary.textContent = '⏹ Tap when you finish';
    result.replaceChildren(el('p', 'rec', '● Recording… speak now'));
    timer = setTimeout(finish, MAX_RECORD_MS);
  }

  async function finish() {
    const r = rec;
    rec = null;
    clearTimeout(timer);
    primary.disabled = true;
    primary.textContent = 'Listening…';
    result.replaceChildren(el('p', 'status', 'Listening to your recording…'));
    try {
      const wav = await r.stop();
      onReply(await sendRecording(path, wav), idle);
    } catch (err) {
      result.replaceChildren(el('p', 'error', err.message));
      idle();
    }
  }

  idle();
}

// Shown when the microphone is blocked or missing: explain, and allow the old "Got it" so nobody is locked out.
function noMicMessage(err, result, sentenceId) {
  const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
  const text = blocked
    ? 'The microphone is blocked. Allow it for this site in your browser settings, then tap the microphone button again.'
    : 'No microphone can be used on this device or browser.';
  const skip = el('button', 'listen', 'Continue without speaking');
  skip.type = 'button';
  skip.addEventListener('click', async () => {
    skip.disabled = true;
    try { await api('/learn', { sentenceId }); session.learned += 1; load(); } catch (e) { showError(e.message); }
  });
  result.replaceChildren(el('p', 'error', text), skip);
}

function heardBlock(r, { showWords }) {
  const frag = document.createDocumentFragment();
  if (!r.heard) {
    frag.append(el('p', 'feedback', "I couldn't hear anything clear. Hold the phone closer and try again. 请靠近麦克风再试一次。"));
    return frag;
  }
  frag.append(el('p', `score ${r.passed ? 'good' : 'bad'}`, `${r.score} / 100  ${r.passed ? '✓ Good' : '✗ Not quite — try again'}`));
  const heard = el('p', 'ref');
  heard.append('I heard: ', el('b', null, r.heard));
  frag.append(heard);
  if (showWords && r.words && !r.passed) {
    const line = el('p', 'words');
    for (const w of r.words) line.append(el('span', w.ok ? 'w ok' : 'w miss', w.word), ' ');
    frag.append(el('p', 'ref', 'Red words were missing or different:'), line);
  }
  return frag;
}

// ---------- a new sentence: step 1 read it aloud, step 2 say it from memory ----------
function renderLearn(data) {
  const s = data.sentence;
  const of = data.step.of;
  const progressText = (stage) => `New ${data.step.n} / ${of} · Step ${stage} of 2`;

  // Step 1: the English is on screen; read it out loud.
  setProgress(progressText(1));
  const c = el('section', 'card');
  c.append(el('p', 'label', 'Step 1 · Read it out loud'), el('p', 'en', s.english));
  c.append(listenButton(s.id, s.english), el('p', 'zh', s.chinese), notesBlock(s));
  const result = el('div', 'result');
  c.append(result);
  show(c);
  micControl({
    label: 'Tap and read it out loud',
    path: `/learn/read?sentenceId=${s.id}`,
    result,
    onNoMic: (err) => noMicMessage(err, result, s.id),
    onReply: (r, idle) => {
      result.replaceChildren(heardBlock(r, { showWords: true }));
      if (r.passed) { setPrimary('Next: say it without looking', () => renderRecall(data, progressText(2))); primary.focus({ preventScroll: true }); } else idle();
    },
  });
}

// Step 2: the English is hidden; the learner sees the Chinese and says the English sentence.
function renderRecall(data, progressLabel) {
  const s = data.sentence;
  setProgress(progressLabel);
  const c = el('section', 'card');
  c.append(el('p', 'label', 'Step 2 · Now say it in English'), el('p', 'zh big', s.chinese));
  const result = el('div', 'result');
  c.append(result);
  show(c);
  micControl({
    label: 'Tap and say it in English',
    path: `/learn/recall?sentenceId=${s.id}`,
    result,
    onNoMic: (err) => noMicMessage(err, result, s.id),
    onReply: (r, idle) => {
      if (!r.passed) {
        const nodes = [heardBlock(r, { showWords: false })];
        nodes.push(el('p', 'ref', 'Need help? Listen once more, then say it again.'), listenButton(s.id, s.english));
        result.replaceChildren(...nodes);
        idle();
        return;
      }
      session.learned += 1;
      const ok = el('p', 'score good', `${r.score} / 100  ✓ You said it!`);
      const ref = el('p', 'en', r.original);
      result.replaceChildren(ok, ref, listenButton(s.id, r.original), notesBlock(s));
      setPrimary('Next', load);
      primary.focus({ preventScroll: true });
    },
  });
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
function renderDone(data = {}) {
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
  if (data.waiting) c.append(el('p', 'zh', `${data.waiting} more review${data.waiting === 1 ? ' is' : 's are'} waiting for tomorrow.`));
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
    else renderDone(data);
  } catch (e) { showError(e.message); }
}

api('/me').then((m) => { $('who').textContent = m.email || ''; }).catch(() => {});
load();
