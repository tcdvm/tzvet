function getRowTextWithoutNestedTables(row) {
  const clone = row.cloneNode(true);
  clone.querySelectorAll('table').forEach((t) => t.remove());
  return clone.innerText.trim();
}

function cellToText(cell) {
  const text = cell.textContent || '';
  return text
    .replace(/Show More\.\.\.|Show Less/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableToMatrix(table) {
  return Array.from(table.querySelectorAll('tr'))
    .map((tr) => Array.from(tr.querySelectorAll('th,td')).map(cellToText))
    .filter((cells) => cells.some((cell) => cell.length > 0));
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

function extractPanelFromClinicNotes(lines) {
  const notesIdx = lines.findIndex((line) => /Clinic Notes\s*\/\s*Specifics:/i.test(line));
  if (notesIdx !== -1) {
    for (let i = notesIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (/^Lab\b/i.test(line)) continue;
      if (/^[A-Z]{2,}\d+/i.test(line)) continue;
      return line;
    }
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
    panel: extractPanelFromClinicNotes(lines),
    species: extractSpecies(lines)
  };
}

export function parseRowTextForTest(rowText) {
  return parseRowText(rowText);
}

function extractPatientInfo(container) {
  const root = container || document;
  const el = root.querySelector('div[id^="patientSideBar"]');
  if (!el) return { name: null, id: null };
  const text = el.innerText || el.textContent || '';
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let name = lines[0] || null;
  const idLineIndex = lines.findIndex((line) => /Patient ID:/i.test(line));
  if (idLineIndex > 0) name = lines[idLineIndex - 1] || name;
  if (name) name = name.replace(/\s*\([^)]*\)\s*$/i, '').trim();
  const idLine = lines.find((line) => /Patient ID:/i.test(line));
  let patientId = null;
  if (idLine) {
    const idMatch = idLine.match(/Patient ID:\s*([A-Za-z_]*\d+)/i);
    if (idMatch) patientId = idMatch[1];
  }
  const ownerEl = root.querySelector('div[id^="ownerSideBar"] span');
  let ownerLastName = null;
  if (ownerEl) {
    const ownerText = ownerEl.textContent.trim();
    const ownerMatch = ownerText.match(/^([^,]+),/);
    if (ownerMatch) ownerLastName = ownerMatch[1].trim();
  }
  return { name, id: patientId, ownerLastName };
}

function isTargetPanel(panel) {
  if (!panel) return false;
  const text = String(panel);
  const nameMatch = /(?:\bcbc\b|chemistry|electrolyte|urinalysis|urine analysis)/i.test(text);
  const smallAnimalPanelMatch = /animal.*panel/i.test(text);
  return nameMatch || smallAnimalPanelMatch;
}

function isHeaderRow(nonEmptyCells) {
  const joined = nonEmptyCells.join(' ').toLowerCase();
  return /(test|resuts|unit|lowest value|highest value|qualifier)/.test(joined);
}

function parseObservationRow(cells) {
  if (!cells.length) return null;

  let testName = cells[0] || null;
  const valueRaw = cells[1] || null;
  const unit = cells[2] || null;
  const lowestValue = cells[3] || null;
  const highestValue = cells[4] || null;
  const qualifier = cells[5] || null;

  if (!testName) return null;
  testName = testName.replace(/\s*:\s*Value\s*$/i, '');

  const valueNum = valueRaw ? Number(String(valueRaw).replace(/[^\d.+-]/g, '')) : NaN;
  const value = Number.isNaN(valueNum) ? null : valueNum;
  return {
    testName,
    valueRaw,
    value,
    unit,
    lowestValue,
    highestValue,
    qualifier
  };
}

function buildObservations(rows) {
  const observations = [];
  rows.forEach((row) => {
    const panel = row.meta?.panel || null;
    if (!isTargetPanel(panel)) return;
    let lastObservation = null;
    row.nestedTableMatrix.forEach((cells) => {
      const cleaned = cells.map((c) => c.trim());
      const nonEmpty = cleaned.filter(Boolean);
      if (nonEmpty.length === 0) return;
      if (isHeaderRow(nonEmpty)) return;

      if (cleaned.length === 1 && nonEmpty.length === 1 && lastObservation) {
        const comment = nonEmpty[0];
        if (comment) {
          if (!lastObservation.valueRaw) lastObservation.valueRaw = comment;
          lastObservation.comment = comment;
        }
        return;
      }

      const base = parseObservationRow(cleaned);
      if (!base) return;

      const obs = {
        panel,
        collectedAt: row.meta?.sampleDate || null,
        reference: row.meta?.reference || null,
        species: row.meta?.species || [],
        ...base
      };
      observations.push(obs);
      lastObservation = obs;
    });
  });
  return observations;
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

  const panelRows = rows.filter((row) => isTargetPanel(row.meta?.panel));
  const observations = buildObservations(panelRows);

  return {
    ok: true,
    patient: extractPatientInfo(container),
    notesContainerId: notes.id || null,
    count: rows.length,
    rows,
    panelRowsCount: panelRows.length,
    panelRows,
    observations
  };
}
