// The Chinese explanation of a sentence is stored as JSON text: {"notes":[{"phrase","zh"}],"tip":"..."}.

function serializeExplain({ notes = [], tip = '' } = {}) {
  return JSON.stringify({ notes, tip });
}

/** Parse the stored text; never throws, always returns {notes, tip}. */
function parseExplain(raw) {
  try {
    const d = JSON.parse(raw || '{}');
    return {
      notes: Array.isArray(d.notes) ? d.notes.filter((n) => n && n.phrase && n.zh) : [],
      tip: typeof d.tip === 'string' ? d.tip : '',
    };
  } catch {
    return { notes: [], tip: '' };
  }
}

module.exports = { serializeExplain, parseExplain };
