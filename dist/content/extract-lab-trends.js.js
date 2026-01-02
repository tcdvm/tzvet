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
  const parts = m[1].split('-').map((p) => p.padStart(2, '0'));
  const mm = parts[0];
  const dd = parts[1];
  const yyyy = parts[2];
  return `${yyyy}-${mm}-${dd}`;
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

function normalizePanelName(panel) {
  if (!panel) return panel;
  let name = String(panel).replace(/\s+/g, ' ').trim();
  name = name.replace(/^(after hours|stat|emergency)\s+/i, '');

  if (/^cbc\s+and\s+absolute\s+reticulocyte\s+count$/i.test(name)) return 'CBC';
  if (/^after hours cbc$/i.test(name)) return 'CBC';
  if (/\bcbc\b/i.test(name)) return 'CBC';

  if (/^small animal \(no canine\) panel and electrolytes$/i.test(name)) return 'Chemistry';
  if (/^canine chemistry panel and electrolytes$/i.test(name)) return 'Chemistry';
  if (/^canine panel and electrolytes$/i.test(name)) return 'Chemistry';
  if (/^after hours sa general chemistry panel$/i.test(name)) return 'Chemistry';
  if (/chemistry|general chemistry|electrolyte/i.test(name)) return 'Chemistry';
  if (/renal panel/i.test(name)) return 'Chemistry';

  if (/urinalysis|urine analysis/i.test(name)) return 'Urinalysis';
  if (/animal.*panel/i.test(name)) return 'Chemistry';

  return name;
}

function normalizeTestName(testName) {
  if (!testName) return testName;
  let name = String(testName)
    .replace(/\s*:\s*Value\s*$/i, '')
    .replace(/^\s*after hours\s+/i, '')
    .trim();
  name = name.replace(/\s+/g, ' ');
  // Strip trailing units accidentally embedded in the test name.
  name = name.replace(/\s*\([^)]*(mg\/dL|g\/dL|U\/L|mmol\/L|ug\/dL|%|fL|pg|K\/uL|M\/uL)[^)]*\)\s*$/i, '').trim();
  const map = {
    'alanine aminotransferase': 'Alanine aminotransferase',
    'alkaline phosphatase': 'Alk Phosphatase',
    'urea nitrogen (bun)': 'Urea Nitrogen',
    'phosphate': 'Phosphorus',
    'total bilirubin': 'Bilirubin, Total'
  };
  const key = name.toLowerCase();
  if (map[key]) return map[key];
  return name;
}

function isTargetPanel(panel) {
  if (!panel) return false;
  const name = normalizePanelName(panel);
  return /^(CBC|Chemistry|Urinalysis)$/i.test(name);
}

function isHeaderRow(nonEmptyCells) {
  const joined = nonEmptyCells.join(' ').toLowerCase();
  return /(test|resuts|unit|lowest value|highest value|qualifier)/.test(joined);
}

function parseObservationRow(cells) {
  if (!cells.length) return null;

  let testName = normalizeTestName(cells[0] || null);
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
    const originalPanel = row.meta?.panel || null;
    const panel = normalizePanelName(originalPanel);
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
        originalPanel,
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
