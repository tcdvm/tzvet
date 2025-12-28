function getRowTextWithoutNestedTables(row) {
  const clone = row.cloneNode(true);
  clone.querySelectorAll('table').forEach((t) => t.remove());
  return clone.innerText.trim();
}

function tableToMatrix(table) {
  return Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th,td')).map((cell) => cell.innerText.trim())
  );
}

function cleanRowText(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseDateFromLine(line) {
  const m = line.match(/\b(\d{1,2}-\d{1,2}-\d{4})\s+(\d{1,2}:\d{2}:\d{2})(am|pm)\b/i);
  if (!m) return null;
  const iso = new Date(`${m[1]} ${m[2]} ${m[3]}`.toUpperCase());
  if (Number.isNaN(iso.getTime())) return null;
  return iso.toISOString();
}

function extractReference(lines) {
  for (const line of lines) {
    const m = line.match(/Reference:\s*([A-Za-z0-9-]+)/i);
    if (m) return m[1];
  }
  return null;
}

function extractPanelAfterReference(lines) {
  const idx = lines.findIndex((line) => /Reference:\s*/i.test(line));
  if (idx === -1) return null;
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i]) return lines[i];
  }
  return null;
}

function extractSpecies(lines) {
  const speciesMap = [
    { re: /\bcanine\b/i, value: 'Canine' },
    { re: /\bfeline\b/i, value: 'Feline' },
    { re: /\bavian\b/i, value: 'Avian' },
    { re: /\bequine\b/i, value: 'Equine' }
  ];
  const found = [];
  for (const line of lines) {
    for (const s of speciesMap) {
      if (s.re.test(line)) found.push(s.value);
    }
  }
  return Array.from(new Set(found));
}

function parseRowText(rowText) {
  const lines = cleanRowText(rowText);
  return {
    rawLines: lines,
    sampleDate: lines.length ? parseDateFromLine(lines[0]) : null,
    reference: extractReference(lines),
    panel: extractPanelAfterReference(lines),
    species: extractSpecies(lines)
  };
}

export function extractLabTrends() {
  const container = document.querySelector('.rtabdetails.clinical.active');
  if (!container) return { ok: false, error: 'No active clinical tab found' };

  const notes = container.querySelector('div[id^="medicalnotesNotes"]');
  if (!notes) return { ok: false, error: 'No medical notes container found' };

  const table = notes.querySelector('table');
  if (!table) return { ok: false, error: 'No notes table found' };

  const rows = [];
  const trs = table.querySelectorAll('tr');
  trs.forEach((tr, idx) => {
    const nested = tr.querySelector('table');
    if (!nested) return;
    const rowText = getRowTextWithoutNestedTables(tr);
    const meta = parseRowText(rowText);
    rows.push({
      rowIndex: idx,
      rowText,
      meta,
      nestedTableText: nested.innerText.trim(),
      nestedTableMatrix: tableToMatrix(nested)
    });
  });

  return {
    ok: true,
    notesContainerId: notes.id || null,
    count: rows.length,
    rows
  };
}
