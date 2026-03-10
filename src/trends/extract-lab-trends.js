import {
  CANONICAL_PANEL_DISPLAY_NAMES,
  CANONICAL_TEST_DISPLAY_NAMES,
  DEFAULT_TENANT_ID,
  getTenantProfile
} from './lab-tenant-profiles.js';

// ---------------------------------------------------------------------------
// Shared DOM extraction layer (tenant-agnostic)
// ---------------------------------------------------------------------------

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

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'`]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTenantNoise(value) {
  return String(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addWarning(ctx, type, rawLabel, details = null) {
  const key = `${type}::${ctx.tenant}::${normalizeLabel(rawLabel)}`;
  if (ctx.warningKeys.has(key)) return;
  ctx.warningKeys.add(key);
  const warning = {
    type,
    tenant: ctx.tenant,
    label: String(rawLabel || '').trim(),
    details
  };
  ctx.warnings.push(warning);
  console.debug('[lab parser warning]', warning);
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

function parseDateFromGenericCellText(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;

  const m = trimmed.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(am|pm)\b/i
  );
  if (m) {
    const mm = m[1].padStart(2, '0');
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

  return null;
}

function parseDateFromRowElement(row) {
  if (!row || typeof row.querySelector !== 'function') return null;
  const cells = Array.from(row.querySelectorAll(':scope > td')).map((td) =>
    String(td?.textContent || '').replace(/\s+/g, ' ').trim()
  );
  if (!cells.length) return null;

  const candidates = [];
  if (cells.length > 1) candidates.push(cells[1]);
  if (cells.length > 2) {
    candidates.push(cells[cells.length - 2]);
  }

  for (const candidate of candidates) {
    const parsed = parseDateFromGenericCellText(candidate);
    if (parsed) return parsed;
    const resultDateLike = parseDateFromLine(`Result Date: ${candidate}`);
    if (resultDateLike) return resultDateLike;
  }

  return null;
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

function extractPanelFromLines(lines, profile) {
  const tenantOverride = profile?.parsingOverrides?.extractPanelFromLines;
  if (typeof tenantOverride === 'function') {
    const panelName = tenantOverride(lines, extractPanelFromClinicNotes);
    if (typeof panelName === 'string') {
      const normalized = panelName.trim();
      if (normalized) return normalized;
    }

    if (profile?.tenant === 'tamu') {
      return null;
    }
  }

  return extractPanelFromClinicNotes(lines);
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

function parseRowText(rowText, profile = null, row = null) {
  const lines = cleanRowText(rowText);
  const dateLine = lines.find((line) => /Result Date:/i.test(line)) || '';
  const parsedDateFromLine = dateLine ? parseDateFromLine(dateLine) : null;
  const parsedDateFromRow = parseDateFromRowElement(row);
  return {
    rawLines: lines,
    sampleDate: parsedDateFromLine || parsedDateFromRow,
    reference: extractReference(lines),
    panel: extractPanelFromLines(lines, profile || getTenantProfile(DEFAULT_TENANT_ID)),
    species: extractSpecies(lines)
  };
}

export function parseRowTextForTest(rowText, profile = null, row = null) {
  return parseRowText(rowText, profile || getTenantProfile(DEFAULT_TENANT_ID), row);
}

function resolveCanonicalLabel(rawLabel, groups, ctx, matchContext = {}) {
  const value = String(rawLabel || '').trim();
  if (!value) return { canonical: null, display: null, raw: value };
  const normalized = normalizeLabel(value);
  const normalizedNoNoise = normalizeLabel(stripTenantNoise(value));

  for (const group of groups || []) {
    if (group.panelCanonical && matchContext?.panelCanonical && group.panelCanonical !== matchContext.panelCanonical) continue;
    const aliases = group.aliases || [];
    for (const alias of aliases) {
      let matched = false;
      if (typeof alias === 'string') {
        const aliasNormalized = normalizeLabel(alias);
        matched =
          normalized === aliasNormalized ||
          normalizedNoNoise === aliasNormalized ||
          normalized.includes(aliasNormalized) ||
          normalizedNoNoise.includes(aliasNormalized);
      } else if (alias instanceof RegExp) {
        matched = alias.test(normalized) || alias.test(value.toLowerCase());
      } else if (typeof alias === 'function') {
        matched = alias(value, normalized, group, ctx, matchContext);
      }
      if (matched) {
        return {
          canonical: group.canonical,
          display:
            group.display ||
            CANONICAL_TEST_DISPLAY_NAMES[group.canonical] ||
            CANONICAL_PANEL_DISPLAY_NAMES[group.canonical] ||
            group.canonical,
          raw: value
        };
      }
    }
  }

  return { canonical: null, display: value.replace(/\s+/g, ' ').trim(), raw: value };
}

function canonicalizePanel(profile, rawPanel, ctx) {
  const match = resolveCanonicalLabel(rawPanel, profile?.panelAliases || [], ctx);
  if (!match.canonical) {
    addWarning(ctx, 'unmapped_panel', rawPanel, { rowIndex: ctx.rowIndex });
    return {
      canonicalName: null,
      displayName: match.display,
      rawName: rawPanel
    };
  }

  return {
    canonicalName: match.canonical,
    displayName: CANONICAL_PANEL_DISPLAY_NAMES[match.canonical] || match.display,
    rawName: rawPanel
  };
}

function canonicalizeTest(profile, rawTest, canonicalPanelName, ctx) {
  if (!rawTest) return { canonicalName: null, displayName: '', rawName: rawTest };
  const cleaned = String(rawTest)
    .replace(/\s*:\s*Value\s*$/i, '')
    .replace(/^\s*after hours\s+/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*(mg\/dL|g\/dL|U\/L|mmol\/L|ug\/dL|%|fL|pg|K\/uL|M\/uL)[^)]*\)\s*$/i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();
  const match = resolveCanonicalLabel(cleaned, profile?.testAliases || [], ctx, { panelCanonical: canonicalPanelName });
  if (!match.canonical) {
    addWarning(ctx, 'unmapped_test', cleaned, {
      panelCanonical: canonicalPanelName,
      rowIndex: ctx.rowIndex
    });
    return { canonicalName: null, displayName: cleaned, rawName: cleaned };
  }

  return { canonicalName: match.canonical, displayName: match.display, rawName: match.raw };
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

  let testName = String(cells[0] || '')
    .replace(/\s*:\s*Value\s*$/i, '')
    .replace(/^\s*after hours\s+/i, '')
    .trim();
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

function isHeaderRow(nonEmptyCells) {
  const joined = nonEmptyCells.join(' ').toLowerCase();
  return /(test|resuts|unit|lowest value|highest value|qualifier)/.test(joined);
}

function isLikelyCommentRow(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/^\d+(\.\d+)?%?$/.test(trimmed)) return false;
  if (/^[-–]$/.test(trimmed)) return false;
  return /[a-zA-Z]/.test(trimmed);
}

function isTargetPanel(profile, panelName, ctx) {
  const info = canonicalizePanel(profile, panelName, ctx);
  return Boolean(info?.canonicalName && /^(cbc|chemistry|urinalysis)$/.test(info.canonicalName));
}

function buildObservations(rows, profile, parserCtx) {
  const observations = [];

  rows.forEach((row) => {
    const hasHoldStatus = row.nestedTableMatrix?.some((cells) => isHoldStatusPlaceholder(cells, profile?.tenant));
    if (hasHoldStatus) {
      addWarning(parserCtx, 'ignored_panel', row.meta?.panel || '', { reason: 'hold_status_placeholder' });
      return;
    }
    const originalPanel = row.meta?.panel || null;
    const panelInfo = canonicalizePanel(profile, originalPanel, {
      ...parserCtx,
      rowIndex: row.rowIndex
    });
    row.meta = {
      ...row.meta,
      canonicalPanelName: panelInfo.canonicalName,
      canonicalPanelNameDisplay: panelInfo.displayName
    };

    let lastObservation = null;
    row.nestedTableMatrix.forEach((cells) => {
      const cleaned = cells.map((c) => c.trim());
      const nonEmpty = cleaned.filter(Boolean);
      if (nonEmpty.length === 0) return;
      if (isHeaderRow(nonEmpty)) return;

      if (cleaned.length === 1 && nonEmpty.length === 1 && lastObservation && isLikelyCommentRow(nonEmpty[0])) {
        const comment = nonEmpty[0];
        if (comment) {
          lastObservation.comment = comment;
        }
        return;
      }

      const base = parseObservationRow(cleaned);
      if (!base) return;
      const testInfo = canonicalizeTest(profile, base.testName, panelInfo.canonicalName, {
        ...parserCtx,
        rowIndex: row.rowIndex
      });
      base.testName = testInfo.displayName || base.testName;

      const obs = {
        panel: panelInfo.displayName || originalPanel || null,
        originalPanel,
        canonicalPanelName: panelInfo.canonicalName,
        testName: base.testName,
        testNameRaw: testInfo.rawName,
        canonicalTestName: testInfo.canonicalName,
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

function isHoldStatusPlaceholder(cells, tenant) {
  if (!cells || tenant !== 'tamu') return false;
  const firstCell = String(cells[0] || '').trim();
  if (!firstCell) return false;
  const normalized = normalizeLabel(firstCell);
  return normalized === 'hold status' || /^hold\s*status\b/i.test(firstCell);
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

function getTenantProfileContext() {
  const hostname = String(location?.hostname || '');
  const profile = getTenantProfile(hostname);
  const exactMatch = profile?.hostnames?.includes(hostname.toLowerCase()) || false;
  const resolvedProfile = profile || getTenantProfile(DEFAULT_TENANT_ID);
  return { hostname, profile: resolvedProfile, exactMatch };
}

export function extractLabTrends() {
  const { hostname, profile, exactMatch } = getTenantProfileContext();
  const parserCtx = {
    tenant: profile?.tenant || DEFAULT_TENANT_ID,
    warnings: [],
    warningKeys: new Set()
  };
  const selectors = profile?.selectors || {};

  if (!exactMatch && parserCtx.tenant !== DEFAULT_TENANT_ID) {
    addWarning(parserCtx, 'tenant_fallback', hostname, { fallbackTenant: profile?.tenant || DEFAULT_TENANT_ID });
  }

  const clinicalContainer = document.querySelector(selectors.clinicalContainer || '.rtabdetails.clinical.active');
  const animalsContainer = document.querySelector(selectors.animalsContainer || '.rtabdetails.animals.active');
  const container = clinicalContainer || animalsContainer;
  if (!container) return { ok: false, error: 'No active clinical or animals tab found' };

  const rows = [];
  let pagination = null;
  let notesContainerId = null;

  if (clinicalContainer) {
    const notes = container.querySelector(selectors.clinicalNotesContainer || 'div[id^="medicalnotesNotes"]');
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
      const meta = parseRowText(rowText, profile, tr);
      rows.push({
        rowIndex: idx,
        rowText,
        meta,
        nestedTableText: nested.innerText.trim(),
        nestedTableMatrix: tableToMatrix(nested)
      });
    });
  } else {
    const diagnostics = container.querySelector(selectors.diagnosticsContainer || 'div[id^="diagnosticResultsListTable"]');
    if (!diagnostics) return { ok: false, error: 'No diagnostics table container found' };
    const table = diagnostics.querySelector('table');
    if (!table) return { ok: false, error: 'No diagnostics table found' };
    notesContainerId = diagnostics.id || null;
    pagination = extractPaginationInfo(table, diagnostics);

    const metaRows = diagnostics.querySelectorAll(selectors.diagnosticResultSelector || 'tr[data-testid="DiagnosticResult"]');
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
        const meta = parseRowText(rowText, profile, tr);
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
        const next = trs[i + 1];
        if (!next) continue;
        const nextNested = next.querySelector('table');
        if (!nextNested) continue;
        const rowText = getRowTextWithoutNestedTables(tr);
        const meta = parseRowText(rowText, profile, tr);
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
  const observations = buildObservations(panelRows, profile, parserCtx);
  return {
    ok: true,
    tenant: parserCtx.tenant,
    patient: extractPatientInfo(container),
    notesContainerId,
    count: rows.length,
    rows,
    panelRowsCount: panelRows.length,
    panelRows,
    observations,
    pagination,
    warnings: parserCtx.warnings
  };
}
