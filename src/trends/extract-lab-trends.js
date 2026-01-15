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
  const m = line.match(/Result Date:\s*([A-Za-z]{3,})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)\b/i);
  if (!m) return null;
  const monthNames = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12'
  };
  const monthKey = m[1].slice(0, 3).toLowerCase();
  const mm = monthNames[monthKey];
  if (!mm) return null;
  const dd = m[2].padStart(2, '0');
  const yyyy = m[3];
  let hour = Number(m[4]);
  const minute = m[5];
  const second = m[6];
  const period = m[7].toUpperCase();
  if (Number.isNaN(hour)) return `${yyyy}-${mm}-${dd}`;
  if (period === 'AM' && hour === 12) hour = 0;
  if (period === 'PM' && hour < 12) hour += 12;
  const hh = String(hour).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${minute}:${second}`;
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
  const dateLine = lines.find((line) => /Result Date:/i.test(line)) || '';
  return {
    rawLines: lines,
    sampleDate: dateLine ? parseDateFromLine(dateLine) : null,
    reference: extractReference(lines),
    panel: extractPanelFromClinicNotes(lines),
    species: extractSpecies(lines)
  };
}

export function parseRowTextForTest(rowText) {
  return parseRowText(rowText);
}

function extractPaginationInfo(table, container) {
  const sources = [];
  if (table) {
    const tfoot = table.querySelector('tfoot');
    if (tfoot) sources.push(tfoot.innerText);
    table.querySelectorAll('tr[class*="footer"], tr[class*="pager"], tr[class*="pagination"]').forEach((row) => {
      sources.push(row.innerText);
    });
  }
  if (container) {
    container
      .querySelectorAll('[class*="pager"], [class*="pagination"], [id*="pager"], [id*="pagination"]')
      .forEach((el) => sources.push(el.innerText));
  }
  let pageSelect = null;
  let scope = table;
  while (scope && scope !== document.body && !pageSelect) {
    if (scope.querySelector) pageSelect = scope.querySelector('select.pageSelection');
    scope = scope.parentElement;
  }
  if (!pageSelect && container) pageSelect = container.querySelector('select.pageSelection');
  if (pageSelect) {
    const selected = pageSelect.querySelector('option[selected]') || pageSelect.options[pageSelect.selectedIndex];
    const current = Number(selected?.textContent || '');
    const total = pageSelect.options.length;
    if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
      return { current, total, text: `page ${current} of ${total}`, hasMore: total > current };
    }
  }
  const normalized = sources
    .map((t) => String(t || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const joined = normalized.join(' ');
  const pageMatch = joined.match(/page\s+(\d+)\s+of\s+(\d+)/i)
    || joined.match(/page\s+(\d+)\s*\/\s*(\d+)/i)
    || joined.match(/(\d+)\s+of\s+(\d+)\s+pages/i);
  if (pageMatch) {
    const current = Number(pageMatch[1]);
    const total = Number(pageMatch[2]);
    if (Number.isFinite(current) && Number.isFinite(total)) {
      return { current, total, text: pageMatch[0], hasMore: total > current };
    }
  }

  const rangeMatch = joined.match(/\b\d+\s*-\s*\d+\s+of\s+(\d+)\b/i);
  const totalPagesMatch = joined.match(/page:\s*\d+\s*of\s*(\d+)/i)
    || joined.match(/\bpage\s+\d+\s+of\s+(\d+)/i);
  if (rangeMatch && totalPagesMatch) {
    const totalItems = Number(rangeMatch[1]);
    const totalPages = Number(totalPagesMatch[1]);
    if (Number.isFinite(totalItems) && Number.isFinite(totalPages)) {
      return { current: 1, total: totalPages, text: rangeMatch[0], hasMore: totalPages > 1 };
    }
  }
  return null;
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

function normalizeTestName(testName, panelName) {
  if (!testName) return testName;
  let name = String(testName)
    .replace(/\s*:\s*Value\s*$/i, '')
    .replace(/^\s*after hours\s+/i, '')
    .trim();
  name = name.replace(/\s+/g, ' ');
  if (/^value$/i.test(name) && panelName) {
    name = String(panelName).replace(/\s*\([^)]*\)\s*$/, '').trim();
  }
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

  const cleanValueText = (value) => {
    if (!value) return value;
    return String(value)
      .replace(/\.pdf/gi, '')
      .replace(/\(click this!\)|click this!/gi, '(See ezyVet for pdf.)')
      .trim();
  };

  let testName = normalizeTestName(cells[0] || null);
  const valueRaw = cleanValueText(cells[1] || null);
  const unit = cells[2] || null;
  const lowestValue = cells[3] || null;
  const highestValue = cells[4] || null;
  const qualifier = cleanValueText(cells[5] || null);

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
      base.testName = normalizeTestName(base.testName, originalPanel || panel);

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
  const clinicalContainer = document.querySelector('.rtabdetails.clinical.active');
  const animalsContainer = document.querySelector('.rtabdetails.animals.active');
  const container = clinicalContainer || animalsContainer;
  if (!container) return { ok: false, error: 'No active clinical or animals tab found' };

  const rows = [];
  let pagination = null;

  let notesContainerId = null;
  if (clinicalContainer) {
    const notes = container.querySelector('div[id^="medicalnotesNotes"]');
    if (!notes) return { ok: false, error: 'No medical notes container found' };
    notesContainerId = notes.id || null;

    const table = notes.querySelector('table');
    if (!table) return { ok: false, error: 'No notes table found' };
    pagination = extractPaginationInfo(table, notes);

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
  } else {
    const diagnostics = container.querySelector('div[id^="diagnosticResultsListTable"]');
    if (!diagnostics) return { ok: false, error: 'No diagnostics table container found' };
    const table = diagnostics.querySelector('table');
    if (!table) return { ok: false, error: 'No diagnostics table found' };
    notesContainerId = diagnostics.id || null;
    pagination = extractPaginationInfo(table, diagnostics);

    const metaRows = diagnostics.querySelectorAll('tr[data-testid="DiagnosticResult"]');
    if (metaRows.length) {
      metaRows.forEach((tr, idx) => {
        let next = tr.nextElementSibling;
        while (next && next.tagName === 'TR' && !next.querySelector('table')) {
          if (next.matches('tr[data-testid="DiagnosticResult"]')) break;
          next = next.nextElementSibling;
        }
        if (!next) return;
        const nextNested = next.querySelector('table');
        if (!nextNested) return;
        const rowText = getRowTextWithoutNestedTables(tr);
        const meta = parseRowText(rowText);
        rows.push({
          rowIndex: idx,
          rowText,
          meta,
          nestedTableText: nextNested.innerText.trim(),
          nestedTableMatrix: tableToMatrix(nextNested)
        });
      });
    } else {
      const trs = Array.from(table.querySelectorAll('tr'));
      for (let i = 0; i < trs.length; i += 1) {
        const tr = trs[i];
        const nested = tr.querySelector('table');
        if (nested) continue;
        const tds = tr.querySelectorAll('td');
        if (tds.length < 2) continue;
        const next = trs[i + 1];
        if (!next) continue;
        const nextNested = next.querySelector('table');
        if (!nextNested) continue;
        const rowText = getRowTextWithoutNestedTables(tr);
        const meta = parseRowText(rowText);
        rows.push({
          rowIndex: i,
          rowText,
          meta,
          nestedTableText: nextNested.innerText.trim(),
          nestedTableMatrix: tableToMatrix(nextNested)
        });
      }
    }
  }

  const panelRows = rows.filter((row) => row.meta?.panel);
  const observations = buildObservations(panelRows);
  return {
    ok: true,
    patient: extractPatientInfo(container),
    notesContainerId,
    count: rows.length,
    rows,
    panelRowsCount: panelRows.length,
    panelRows,
    observations,
    pagination
  };
}
