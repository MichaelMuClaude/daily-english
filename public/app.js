'use strict';
const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const res = await fetch(`/api${path}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function say(text, isError = false) {
  const el = $('message');
  el.textContent = text || '';
  el.hidden = !text;
  el.className = isError ? 'message error' : 'message';
}

// ---------- Today ----------
function card(s) {
  const div = document.createElement('div');
  div.className = 'card';
  const en = document.createElement('p'); en.className = 'en'; en.textContent = s.english;
  const zh = document.createElement('p'); zh.className = 'zh'; zh.textContent = s.chinese;
  const meta = document.createElement('p'); meta.className = 'meta';
  if (s.sourceUrl) {
    const a = document.createElement('a');
    a.href = s.sourceUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = 'Story: ' + (s.sourceTitle || 'source');
    meta.append(a);
  }
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'primary';
  const setDone = () => { btn.textContent = 'Learned'; btn.disabled = true; };
  btn.textContent = 'Got it';
  if (s.learned) setDone();
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await api('/learn', { sentenceId: s.id }); setDone(); refreshDue(); }
    catch (e) { btn.disabled = false; say(e.message, true); }
  });
  div.append(en, zh, meta, btn);
  return div;
}

async function loadToday() {
  say('Loading today\'s sentences… (the first visit of the day can take up to a minute)');
  try {
    const data = await api('/today');
    $('cards').replaceChildren(...data.sentences.map(card));
    say('');
  } catch (e) { say(e.message, true); }
}

// ---------- Review ----------
let current = null;

async function refreshDue() {
  try {
    const { due } = await api('/review/next');
    $('due-badge').textContent = due; $('due-badge').hidden = due === 0;
  } catch { /* the badge is optional */ }
}

async function loadReview() {
  $('result').hidden = true;
  $('answer').value = '';
  try {
    const { due, item } = await api('/review/next');
    $('due-badge').textContent = due; $('due-badge').hidden = due === 0;
    current = item;
    $('review-empty').hidden = !!item;
    $('review-card').hidden = !item;
    if (item) { $('review-zh').textContent = item.chinese; $('answer').focus(); }
    say('');
  } catch (e) { say(e.message, true); }
}

async function submit() {
  const answer = $('answer').value.trim();
  if (!answer || !current) return;
  $('submit').disabled = true;
  say('Marking…');
  try {
    const r = await api('/review/answer', { sentenceId: current.id, answer });
    $('score').textContent = `${r.score} / 100 ${r.correct ? '✓ correct' : '✗ not yet'}`;
    $('score').className = r.correct ? 'good' : 'bad';
    $('feedback').textContent = r.feedback;
    $('original').textContent = r.original;
    $('result').hidden = false;
    say('');
  } catch (e) { say(e.message, true); }
  $('submit').disabled = false;
}

// ---------- wiring ----------
function show(view) {
  $('view-today').hidden = view !== 'today';
  $('view-review').hidden = view !== 'review';
  $('tab-today').classList.toggle('active', view === 'today');
  $('tab-review').classList.toggle('active', view === 'review');
  if (view === 'review') loadReview();
}
$('tab-today').addEventListener('click', () => show('today'));
$('tab-review').addEventListener('click', () => show('review'));
$('submit').addEventListener('click', submit);
$('next').addEventListener('click', loadReview);
$('answer').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });

api('/me').then((m) => { $('who').textContent = m.email || ''; }).catch(() => {});
loadToday();
refreshDue();
