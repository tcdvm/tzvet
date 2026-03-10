import '../styles.css';

const statusEl = document.getElementById('status');
const panelsEl = document.getElementById('panels');
const patientEl = document.getElementById('patient');
const resultModal = document.getElementById('resultModal');
const resultModalContent = document.getElementById('resultModalContent');
const debugPayloadSection = document.getElementById('debugPayloadSection');
const debugPayloadDisplay = document.getElementById('debugPayloadDisplay');
const toggleDebugPayload = document.getElementById('toggleDebugPayload');
const refreshDebugPayload = document.getElementById('refreshDebugPayload');
const copyDebugPayload = document.getElementById('copyDebugPayload');
const testFilterPanel = document.getElementById('testFilterPanel');
const testFilterList = document.getElementById('testFilterList');
const testFilterPanelCount = document.getElementById('testFilterPanelCount');
const selectAllTestsBtn = document.getElementById('selectAllTests');
const clearAllTestsBtn = document.getElementById('clearAllTests');
const trendsLayout = document.getElementById('trendsLayout');
const panelButtons = {
  CBC: document.getElementById('panelCbc'),
  Chemistry: document.getElementById('panelChem'),
  Urinalysis: document.getElementById('panelUa'),
  Other: document.getElementById('panelOther')
};

const DEBUG_PANEL_KEY = 'tzvet.trends.debugPayloadVisible';

let panelOrder = [];
let panelSections = new Map();
let activePanel = null;
let lastObservations = [];
const refDateByPanel = new Map();
let trendSettings = { disablePanels: new Set(), disableTests: new Set() };
let lastPayload = null;
const panelTestEntriesByPanel = new Map();
const panelTestFilterByPanel = new Map();
const TRUNCATE_LENGTH = 150;
const UNIT_NORMALIZATION_MAP = new Map([
  ['ul', 'uL'],
  ['x10^6/ul', 'x10^6/uL'],
  ['x10^6/ul', 'x10^6/uL'],
  ['x106/ul', 'x10^6/uL'],
  ['x10e6/ul', 'x10^6/uL'],
  ['10e6/ul', 'x10^6/uL'],
  ['x10^3/ul', 'x10^3/uL'],
  ['x10^3/ul', 'x10^3/uL'],
  ['m/ul', 'x10^6/uL'],
  ['k/ul', 'x10^3/uL'],
  ['fl.', 'fl']
]);

function openResultModal(text) {
  if (!resultModal || !resultModalContent) return;
  resultModalContent.textContent = text;
  resultModal.showModal();
}

function formatPaginationWarning(pagination) {
  if (!pagination || !pagination.hasMore) return '';
  return `Possible missing labs: page ${pagination.current} of ${pagination.total}. Load additional pages or increase items/page.`;
}

function normalizeKey(value) {
  return String(value || '')
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizePanelKey(value) {
  const key = normalizeKey(value);
  if (!key) return '';
  if (key === 'ua') return 'urinalysis';
  if (key.includes('urinalysis') || key.includes('urine analysis')) return 'urinalysis';
  if (key.includes('chem')) return 'chemistry';
  if (key.includes('cbc')) return 'cbc';
  return key;
}

function normalizeTestKey(value) {
  return normalizeKey(value);
}

function normalizeUnit(value) {
  const normalized = String(value || '')
    .replace(/\u00b5/g, 'u')
    .replace(/\u03BC/g, 'u')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
  const mapped = UNIT_NORMALIZATION_MAP.get(normalized);
  if (mapped) return mapped;
  return normalized;
}

function getTestSeriesKey(obs) {
  const baseTest = normalizeTestKey(obs?.canonicalTestName || obs?.testName || '');
  const unit = normalizeUnit(obs?.unit || '');
  return `${baseTest}||${unit}`;
}

function getPreferredTestName(obs) {
  return obs?.testName || obs?.canonicalTestName || '';
}

function setFilterLayoutVisible(visible) {
  if (!trendsLayout) return;
  if (visible) {
    trendsLayout.className = 'flex flex-col lg:flex-row gap-4';
  } else {
    trendsLayout.className = 'flex flex-col gap-4';
  }
}

function getTestFilterStateForPanel(panelName, fallbackEntries = []) {
  const fallback = fallbackEntries.map((entry) => entry.key);
  const saved = panelTestFilterByPanel.get(panelName);
  if (!saved || saved.size === 0) {
    return new Set(fallback);
  }
  const normalized = new Set();
  for (const key of saved) {
    if (fallback.includes(key)) normalized.add(key);
  }
  if (normalized.size === 0 && fallback.length > 0) {
    return new Set(fallback);
  }
  return normalized;
}

function updatePanelFilterState(panelName, nextFilterKeys) {
  if (!panelName) return;
  const keys = new Set(nextFilterKeys || []);
  panelTestFilterByPanel.set(panelName, keys);
}

async function loadTrendSettings() {
  const items = await chrome.storage.sync.get({
    trendsDisablePanels: [],
    trendsDisableTests: []
  });
  const panelList = Array.isArray(items.trendsDisablePanels) ? items.trendsDisablePanels : [];
  const testList = Array.isArray(items.trendsDisableTests) ? items.trendsDisableTests : [];
  trendSettings = {
    disablePanels: new Set(panelList.map((v) => normalizePanelKey(v)).filter(Boolean)),
    disableTests: new Set(testList.map((v) => normalizeTestKey(v)).filter(Boolean))
  };
}

function isTrendDisabled(panelName, testName) {
  const panelKey = normalizePanelKey(panelName);
  const testKey = normalizeTestKey(testName);
  if (trendSettings.disablePanels.has(panelKey)) return true;
  if (trendSettings.disableTests.has(testKey)) return true;
  return false;
}

function getPayloadStorageKey() {
  const params = new URLSearchParams(window.location.search);
  return params.get('key') || 'labTrends';
}

function isDebugPayloadEnabled() {
  return localStorage.getItem(DEBUG_PANEL_KEY) === '1';
}

function setDebugPayloadEnabled(enabled) {
  localStorage.setItem(DEBUG_PANEL_KEY, enabled ? '1' : '0');
}

function applyDebugPayloadVisibility(enabled) {
  if (!debugPayloadSection || !toggleDebugPayload) return;
  debugPayloadSection.classList.toggle('hidden', !enabled);
  toggleDebugPayload.textContent = enabled ? 'Hide Debug' : 'Debug';
}

async function getStoredPayload() {
  const key = getPayloadStorageKey();
  const data = await chrome.storage.session.get(key);
  return data[key] || null;
}

function renderDebugPayload(payload) {
  if (!debugPayloadDisplay) return;
  if (!payload) {
    debugPayloadDisplay.textContent = '(No payload found.)';
    return;
  }
  debugPayloadDisplay.textContent = JSON.stringify(payload, null, 2);
}

function refreshDebugPayloadFromStorage() {
  return getStoredPayload()
    .then((payload) => {
      lastPayload = payload;
      renderDebugPayload(payload);
    })
    .catch(() => {
      if (debugPayloadDisplay) debugPayloadDisplay.textContent = 'Error loading payload.';
    });
}

function copyDebugPayloadToClipboard() {
  const text = debugPayloadDisplay?.textContent || '';
  if (!text || text === '(No payload found.)' || text === 'Error loading payload.') return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => null);
  }
}

function normalizePanelName(panelName) {
  const key = normalizePanelKey(panelName);
  if (['cbc', 'chemistry', 'urinalysis'].includes(key)) {
    if (key === 'cbc') return 'CBC';
    if (key === 'chemistry') return 'Chemistry';
    return 'Urinalysis';
  }
  return 'Other';
}

function isLikelyPanelLabel(value) {
  const normalized = normalizePanelKey(value);
  if (!normalized) return false;
  if (/^\d/.test(normalized)) return false;
  if (/^\d{1,2}-\d{1,2}-\d{4}/.test(normalized)) return false;
  if (/^\d{1,2}:\d{2}:\d{2}(?:\s*(?:am|pm))?/.test(normalized)) return false;
  return true;
}

function asDateKey(iso) {
  if (!iso) return 'Unknown';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(iso)) return iso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateLabel(dateKey, options = false) {
  const opts = typeof options === 'boolean' ? { short: options } : options || {};
  const short = !!opts.short;
  const showTime = !!opts.showTime;
  const showMinutes = opts.showMinutes !== false;
  if (dateKey === 'Unknown') return 'Unknown';
  const parsed = dateKey.includes('T') ? new Date(dateKey) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const hours = parsed.getHours();
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 || 12;
    const dateText = `${monthNames[parsed.getMonth()]} ${parsed.getDate()}, ${parsed.getFullYear()}`;
    if (!showTime) {
      return short ? `${monthNames[parsed.getMonth()]} ${parsed.getDate()}` : dateText;
    }
    const timeText = showMinutes ? `${displayHour}:${minutes} ${period}` : `${displayHour} ${period}`;
    if (short) return `${monthNames[parsed.getMonth()]} ${parsed.getDate()} ${timeText}`;
    return `${dateText} ${timeText}`;
  }
  const parts = dateKey.split('-').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 'Unknown';
  const [year, month, day] = parts;
  const d = new Date(year, month - 1, day, 12);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (short) return `${monthNames[d.getMonth()]} ${d.getDate()}`;
  return `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function getDayKey(dateKey) {
  if (!dateKey || dateKey === 'Unknown') return 'Unknown';
  if (dateKey.includes('T')) return dateKey.split('T')[0];
  return dateKey;
}

function sortDateKeys(keys) {
  return [...keys].sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    const da = new Date(a);
    const db = new Date(b);
    if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime())) {
      return da.getTime() - db.getTime();
    }
    return a.localeCompare(b);
  });
}

function formatCell(observations, refLow, refHigh) {
  if (!observations || observations.length === 0) return '';
  return observations
    .map((obs) => {
      const parts = [];
      if (obs.valueRaw) {
        const value = parseNumber(obs.valueRaw);
        const low = parseNumber(refLow);
        const high = parseNumber(refHigh);
        const isAbnormal = Number.isFinite(value)
          && ((Number.isFinite(low) && value < low) || (Number.isFinite(high) && value > high));
        const isLow = Number.isFinite(value) && Number.isFinite(low) && value < low;
        const isHigh = Number.isFinite(value) && Number.isFinite(high) && value > high;
        const valueText = escapeHtml(obs.valueRaw);
        let rendered = isAbnormal ? `<strong>${valueText}</strong>` : valueText;
        if (isLow) rendered += ' <span class="status status-sm status-info align-middle" aria-label="info"></span>';
        else if (isHigh) rendered += ' <span class="status status-sm status-error align-middle" aria-label="error"></span>';
        parts.push(rendered);
      }
      if (obs.qualifier) parts.push(`(${escapeHtml(obs.qualifier)})`);
      const result = parts.join(' ');
      if (!obs.comment) return result;
      const comment = `<div class="text-xs text-gray-500 italic mt-1">${escapeHtml(obs.comment)}</div>`;
      return result ? `${result}${comment}` : comment;
    })
    .join('; ');
}

function applyCellTruncation(cell, rawText, tooltipText = rawText) {
  if (!cell || !rawText) return;
  const text = String(tooltipText || cell.textContent || rawText).trim();
  if (text.length <= TRUNCATE_LENGTH) return;
  const wrap = document.createElement('span');
  wrap.className = 'cell-truncate cell-modal';
  wrap.innerHTML = cell.innerHTML;
  cell.innerHTML = '';
  cell.appendChild(wrap);
  cell.classList.add('cursor-pointer');
  cell.title = `Click to view full result: ${tooltipText || 'details'}`;
  cell.addEventListener('click', () => openResultModal(text));
}

function parseNumber(value) {
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).replace(/[^\d.+-]/g, '');
  if (!cleaned) return NaN;
  return Number(cleaned);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildSparkline(values, refLow, refHigh) {
  const width = 90;
  const height = 24;
  const padding = 2;
  const points = values
    .map((v, idx) => ({ x: idx, y: parseNumber(v) }))
    .filter((p) => Number.isFinite(p.y));
  if (points.length < 2) return '';

  const refLowNum = parseNumber(refLow);
  const refHighNum = parseNumber(refHigh);
  const dataMin = Math.min(...points.map((p) => p.y));
  const dataMax = Math.max(...points.map((p) => p.y));
  let min = dataMin;
  let max = dataMax;
  if (Number.isFinite(refLowNum)) min = Math.min(min, refLowNum);
  if (Number.isFinite(refHighNum)) max = Math.max(max, refHighNum);
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const xStep = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const toY = (val) => {
    const t = (val - min) / (max - min);
    return height - padding - t * (height - padding * 2);
  };

  const linePoints = points
    .map((p, i) => `${padding + i * xStep},${toY(p.y).toFixed(2)}`)
    .join(' ');

  let refBand = '';
  if (Number.isFinite(refLowNum) && Number.isFinite(refHighNum)) {
    const yTop = toY(refHighNum);
    const yBottom = toY(refLowNum);
    const bandY = Math.min(yTop, yBottom);
    const bandH = Math.abs(yBottom - yTop);
    refBand = `<rect x="${padding}" y="${bandY.toFixed(2)}" width="${(width - padding * 2).toFixed(2)}" height="${bandH.toFixed(2)}" fill="rgba(148,163,184,0.35)"/>`;
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      ${refBand}
      <polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${linePoints}" />
    </svg>
  `.trim();
}

function getTestUnit(observations) {
  for (const obs of observations) {
    if (obs.unit) return obs.unit;
  }
  return '';
}

function getReferenceRange(observations) {
  for (const obs of observations) {
    const low = obs.lowestValue || '';
    const high = obs.highestValue || '';
    if (low || high) return `${low || ''}-${high || ''}`.replace(/^-|-$|^$/g, '');
  }
  return '';
}

function getReferenceForTestDate(panelObs, testSeriesKey, dateKey) {
  const match = panelObs.find((o) => getTestSeriesKey(o) === testSeriesKey && asDateKey(o.collectedAt) === dateKey);
  if (match && (match.lowestValue || match.highestValue)) {
    return { low: match.lowestValue || null, high: match.highestValue || null };
  }
  return { low: null, high: null };
}

function formatRangeText(ref) {
  if (!ref) return '';
  const low = ref.low || '';
  const high = ref.high || '';
  return `${low}${low && high ? '-' : ''}${high}`;
}

function getPreferredTestOrder(panelObs) {
  const orderByPanel = new Map();
  panelObs.forEach((obs) => {
    const key = obs.originalPanel || obs.panel || '';
    if (!key || !obs.testName) return;
    if (!orderByPanel.has(key)) orderByPanel.set(key, []);
    const list = orderByPanel.get(key);
    if (!list.includes(obs.testName)) list.push(obs.testName);
  });
  let best = [];
  for (const [, list] of orderByPanel.entries()) {
    if (list.length > best.length) best = list;
  }
  return best;
}

function renderTestFilterPanel(panelName) {
  if (!testFilterPanel || !testFilterList) return;
  const entries = panelTestEntriesByPanel.get(panelName) || [];
  if (!entries.length) {
    testFilterPanel.classList.add('hidden');
    setFilterLayoutVisible(false);
    return;
  }

  testFilterPanel.classList.remove('hidden');
  setFilterLayoutVisible(true);
  const filterState = getTestFilterStateForPanel(panelName, entries);
  updatePanelFilterState(panelName, filterState);

  if (testFilterPanelCount) {
    testFilterPanelCount.textContent = `${filterState.size}/${entries.length}`;
  }

  testFilterList.innerHTML = '';
  const list = document.createElement('div');
  entries.forEach((entry) => {
    const row = document.createElement('label');
    row.className = 'label cursor-pointer justify-start gap-2 px-0 py-1';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'checkbox checkbox-xs';
    checkbox.checked = filterState.has(entry.key);
    checkbox.addEventListener('change', () => {
      const next = getTestFilterStateForPanel(panelName, entries);
      if (checkbox.checked) next.add(entry.key);
      else next.delete(entry.key);
      updatePanelFilterState(panelName, next);
      buildPanelTables(lastObservations);
      setActivePanel(panelName);
    });

    const labelText = document.createElement('span');
    labelText.className = 'label-text text-xs';
    const unitLabel = entry.unit ? ` (${entry.unit})` : '';
    labelText.textContent = `${entry.name}${unitLabel}`;

    row.appendChild(checkbox);
    row.appendChild(labelText);
    list.appendChild(row);
  });
  testFilterList.appendChild(list);
}

function buildPanelTables(observations) {
  lastObservations = observations;
  if (panelsEl) {
    panelsEl.className = 'relative';
    panelsEl.innerHTML = '';
  }
  panelSections = new Map();
  panelTestEntriesByPanel.clear();
  const panels = new Map();
  observations.forEach((obs) => {
    if (!obs.panel || !obs.testName) return;
    const panelName = normalizePanelName(obs.panel);
    if (!panels.has(panelName)) panels.set(panelName, []);
    panels.get(panelName).push(obs);
  });

  if (!panels.size) {
    statusEl.textContent = 'No panel data found.';
    if (testFilterPanel) {
      testFilterPanel.classList.add('hidden');
    }
    setFilterLayoutVisible(false);
    return;
  }

  panelOrder = ['CBC', 'Chemistry', 'Urinalysis', 'UA', 'Other'];
  const sortedPanels = Array.from(panels.entries()).sort((a, b) => {
    const aIdx = panelOrder.indexOf(a[0]);
    const bIdx = panelOrder.indexOf(b[0]);
    const aRank = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
    const bRank = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
    if (aRank !== bRank) return aRank - bRank;
    return a[0].localeCompare(b[0]);
  });
  for (const [panelName, panelObs] of sortedPanels) {
    const dateSet = new Set(panelObs.map((o) => asDateKey(o.collectedAt)));
    const dates = sortDateKeys(dateSet);
    const dayCounts = new Map();
    dates.forEach((d) => {
      const dayKey = getDayKey(d);
      dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    });
    const refDates = dates.filter((d) => panelObs.some((o) => asDateKey(o.collectedAt) === d && (o.lowestValue || o.highestValue)));
    const defaultRefDate = refDates.length ? refDates[refDates.length - 1] : (dates.length ? dates[dates.length - 1] : 'Unknown');
    const selectedRefDate = refDateByPanel.get(panelName) || defaultRefDate;
    const originalPanelByDate = new Map();
    panelObs.forEach((obs) => {
      const dateKey = asDateKey(obs.collectedAt);
      if (!originalPanelByDate.has(dateKey)) {
        const panelLabel = isLikelyPanelLabel(obs.originalPanel) ? obs.originalPanel : obs.panel;
        originalPanelByDate.set(dateKey, panelLabel || panelName);
      }
    });

    const byTest = new Map();
    panelObs.forEach((o) => {
      const testSeriesKey = getTestSeriesKey(o);
      if (!byTest.has(testSeriesKey)) {
        byTest.set(testSeriesKey, {
          displayName: getPreferredTestName(o),
          observationsByDate: new Map(),
          unit: o.unit || ''
        });
      }
      const dateKey = asDateKey(o.collectedAt);
      if (!byTest.get(testSeriesKey).observationsByDate.has(dateKey)) {
        byTest.get(testSeriesKey).observationsByDate.set(dateKey, []);
      }
      byTest.get(testSeriesKey).observationsByDate.get(dateKey).push(o);
    });
    const panelFilterEntries = Array.from(byTest.entries()).map(([testSeriesKey, info]) => ({
      key: testSeriesKey,
      name: info.displayName,
      unit: info.unit
    }));
    const testEntries = (() => {
      let entries = panelFilterEntries;
      if (panelName === 'Chemistry') {
        const preferredOrder = getPreferredTestOrder(panelObs);
        if (preferredOrder.length) {
          const orderMap = new Map(preferredOrder.map((name, idx) => [normalizeTestKey(name), idx]));
          entries = entries
            .map((entry, idx) => ({
              ...entry,
              idx,
              rank: orderMap.has(normalizeTestKey(entry.name))
                ? orderMap.get(normalizeTestKey(entry.name))
                : Number.MAX_SAFE_INTEGER
            }))
            .sort((a, b) => (a.rank - b.rank) || (a.idx - b.idx))
            .map((item) => ({ ...item }));
        }
      }
      return entries;
    })();
    const filterState = getTestFilterStateForPanel(panelName, testEntries);
    updatePanelFilterState(panelName, filterState);
    panelTestEntriesByPanel.set(panelName, testEntries);
    const visibleTestEntries = testEntries.filter((entry) => filterState.has(entry.key));

    const hasAnyRef = refDates.length > 0;
    const hasTrendData = visibleTestEntries.some((entry) => {
      const info = byTest.get(entry.key);
      if (!info?.displayName || isTrendDisabled(panelName, info.displayName)) return false;
      const byDate = info.observationsByDate;
      const values = dates
        .map((d) => {
          const obsList = byDate.get(d) || [];
          return obsList.length ? obsList[0].valueRaw : null;
        })
        .filter((v) => v !== null && v !== undefined)
        .map((v) => parseNumber(v))
        .filter((n) => Number.isFinite(n));
      return values.length >= 2;
    });
    const showTrendColumn = dates.length > 1
      && !isTrendDisabled(panelName, null)
      && hasTrendData;

    const section = document.createElement('section');
    section.className = 'card bg-base-200 shadow-sm w-full';

    const header = document.createElement('div');
    header.className = 'card-body';
    header.innerHTML = `<h2 class="card-title text-lg">${panelName}</h2>`;

    const tableWrap = document.createElement('div');
    tableWrap.className = 'overflow-x-auto max-w-full';

    const table = document.createElement('table');
    table.className = 'table table-xs table-pin-rows table-zebra w-full text-sm bg-base-100 border border-base-300 border-separate border-spacing-0 rounded-none';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const testTh = document.createElement('th');
    testTh.className = 'w-44 sticky-col sticky-col-header';
    const testHeader = document.createElement('div');
    testHeader.textContent = 'Test';
    const refRow = document.createElement('div');
    refRow.className = 'text-[11px] text-gray-400 flex items-center gap-1';
    const refLabel = document.createElement('span');
    refLabel.textContent = 'Ref range';
    refLabel.className = 'underline underline-offset-2 decoration-dotted decoration-1 text-gray-400 cursor-help';
    refLabel.title = "Reference ranges can be 'iffy' at times from ezyVet. Confirm strange looking ranges from the source or switch to a different date (if available).";
    refRow.appendChild(refLabel);
    if (refDates.length > 1) {
      const refSelect = document.createElement('select');
      refSelect.className = 'select select-xs max-w-28';
      refDates.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = formatDateLabel(d, { short: true, showTime: false });
        if (d === selectedRefDate) opt.selected = true;
        refSelect.appendChild(opt);
      });
      refSelect.addEventListener('change', (e) => {
        refDateByPanel.set(panelName, e.target.value);
        buildPanelTables(lastObservations);
        setActivePanel(panelName);
      });
      refRow.appendChild(refSelect);
    }
    testTh.appendChild(testHeader);
    testTh.appendChild(refRow);
    headRow.appendChild(testTh);

    dates.forEach((d) => {
      const th = document.createElement('th');
      th.className = 'w-24';
      const span = document.createElement('span');
      span.className = 'cursor-help underline underline-offset-2 decoration-dotted decoration-1 text-gray-500';
      const tip = originalPanelByDate.get(d) || panelName;
      span.title = tip;
      const dayKey = getDayKey(d);
      const showTime = (dayCounts.get(dayKey) || 0) > 1;
      if (showTime && d.includes('T')) {
        const parsed = new Date(d);
        if (!Number.isNaN(parsed.getTime())) {
          const hours = parsed.getHours();
          const period = hours >= 12 ? 'PM' : 'AM';
          const displayHour = hours % 12 || 12;
          span.textContent = formatDateLabel(d, { showTime: false });
          const timeSpan = document.createElement('span');
          timeSpan.className = 'text-[11px] text-gray-400';
          timeSpan.textContent = ` (${displayHour} ${period})`;
          span.appendChild(timeSpan);
        } else {
          span.textContent = formatDateLabel(d, { showTime, showMinutes: false });
        }
      } else {
        span.textContent = formatDateLabel(d, { showTime, showMinutes: false });
      }
      th.appendChild(span);
      headRow.appendChild(th);
    });
    if (showTrendColumn) {
      const trendTh = document.createElement('th');
      trendTh.className = 'w-28';
      trendTh.textContent = 'Trendline';
      headRow.appendChild(trendTh);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    visibleTestEntries.forEach((entry) => {
      const testName = entry.name;
      const testKey = entry.key;
      const testInfo = byTest.get(testKey);
      const byDate = testInfo?.observationsByDate || new Map();
      const row = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.className = 'w-44 max-w-44 break-words sticky-col';
      const testObs = dates.flatMap((d) => byDate.get(d) || []);
      const unit = normalizeUnit(getTestUnit(testObs));
      const displayName = `<span class="font-medium text-base-content">${testName}</span>`;
      const ref = getReferenceForTestDate(panelObs, testKey, selectedRefDate);
      const range = formatRangeText(ref);
      const metaParts = [];
      if (range) metaParts.push(range);
      else if (hasAnyRef) metaParts.push('<span class="text-[11px] text-gray-400 italic">no ref</span>');
      if (unit) metaParts.push(`<span class="text-[11px] text-gray-400">(${escapeHtml(unit)})</span>`);
      const meta = metaParts.length
        ? `<div class="text-[12px] text-gray-500">${metaParts.join(' ')}</div>`
        : '';
      nameTd.innerHTML = `${displayName}${meta}`;
      row.appendChild(nameTd);

      dates.forEach((d) => {
        const td = document.createElement('td');
        const obsList = byDate.get(d) || [];
        const cellText = formatCell(obsList, ref?.low, ref?.high);
        td.innerHTML = cellText;
        applyCellTruncation(td, cellText);
        row.appendChild(td);
      });

      if (showTrendColumn) {
        const trendTd = document.createElement('td');
        trendTd.className = 'text-slate-500';
        if (!isTrendDisabled(panelName, testName)) {
          const series = dates.map((d) => {
            const obsList = byDate.get(d) || [];
            return obsList.length ? obsList[0].valueRaw : null;
          });
          trendTd.innerHTML = buildSparkline(series, ref?.low, ref?.high);
        }
        row.appendChild(trendTd);
      }
      tbody.appendChild(row);
    });
    if (!visibleTestEntries.length) {
      const emptyRow = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.className = 'text-gray-500 text-sm italic';
      emptyTd.colSpan = Math.max(2, dates.length + 1);
      emptyTd.textContent = 'No tests selected. Use the filter panel on the left.';
      emptyRow.appendChild(emptyTd);
      tbody.appendChild(emptyRow);
    }
    table.appendChild(tbody);

    tableWrap.appendChild(table);
    header.appendChild(tableWrap);
    section.appendChild(header);
    panelsEl.appendChild(section);
    panelSections.set(panelName, section);
  }

  const initial = activePanel && panelSections.has(activePanel)
    ? activePanel
    : (sortedPanels.length ? sortedPanels[0][0] : null);
  setActivePanel(initial);
}

async function loadFromSession() {
  const payload = await getStoredPayload();
  lastPayload = payload;
  if (!payload || !payload.observations) {
    statusEl.textContent = '(No data found. Extract from the side panel first.)';
    panelsEl.innerHTML = '';
    if (patientEl) patientEl.textContent = '';
    panelTestEntriesByPanel.clear();
    panelTestFilterByPanel.clear();
    if (testFilterPanel) testFilterPanel.classList.add('hidden');
    setFilterLayoutVisible(false);
    renderDebugPayload(payload);
    return;
  }
  if (patientEl) {
    const animal = payload.patient?.name || 'Unknown';
    const owner = payload.patient?.ownerLastName || 'Unknown';
    patientEl.textContent = `"${animal}" ${owner}`;
  }
  statusEl.textContent = formatPaginationWarning(payload.pagination) || '';
  if (isDebugPayloadEnabled()) {
    renderDebugPayload(payload);
  }
  await loadTrendSettings();
  buildPanelTables(payload.observations);
}

function setActivePanel(panelName) {
  if (!panelName || !panelSections.has(panelName)) return;
  activePanel = panelName;
  for (const [name, section] of panelSections.entries()) {
    if (name === panelName) {
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  }
  updatePanelButtons();
  renderTestFilterPanel(panelName);
}

function updatePanelButtons() {
  Object.entries(panelButtons).forEach(([name, btn]) => {
    if (!btn) return;
    if (!panelSections.has(name)) {
      btn.disabled = true;
      btn.classList.add('btn-disabled');
      btn.classList.remove('btn-active');
      btn.classList.remove('btn-outline');
      btn.classList.remove('btn-primary');
      return;
    }
    btn.disabled = false;
    btn.classList.remove('btn-disabled');
    if (name === activePanel) {
      btn.classList.add('btn-active', 'btn-primary');
      btn.classList.remove('btn-outline');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.classList.remove('btn-active', 'btn-primary');
      btn.classList.add('btn-outline');
      btn.setAttribute('aria-pressed', 'false');
    }
  });
}

Object.entries(panelButtons).forEach(([name, btn]) => {
  if (!btn) return;
  btn.addEventListener('click', () => setActivePanel(name));
});

if (selectAllTestsBtn) {
  selectAllTestsBtn.addEventListener('click', () => {
    if (!activePanel) return;
    const entries = panelTestEntriesByPanel.get(activePanel) || [];
    const allKeys = entries.map((entry) => entry.key);
    updatePanelFilterState(activePanel, allKeys);
    buildPanelTables(lastObservations);
    setActivePanel(activePanel);
  });
}

if (clearAllTestsBtn) {
  clearAllTestsBtn.addEventListener('click', () => {
    if (!activePanel) return;
    updatePanelFilterState(activePanel, []);
    buildPanelTables(lastObservations);
    setActivePanel(activePanel);
  });
}

if (toggleDebugPayload) {
  applyDebugPayloadVisibility(isDebugPayloadEnabled());
  toggleDebugPayload.addEventListener('click', () => {
    const next = !isDebugPayloadEnabled();
    setDebugPayloadEnabled(next);
    applyDebugPayloadVisibility(next);
    if (next) {
      refreshDebugPayloadFromStorage();
    }
  });
}

if (refreshDebugPayload) {
  refreshDebugPayload.addEventListener('click', () => {
    refreshDebugPayloadFromStorage();
  });
}

if (copyDebugPayload) {
  copyDebugPayload.addEventListener('click', () => {
    copyDebugPayloadToClipboard();
  });
}

document.addEventListener('keydown', (e) => {
  if (!activePanel || !panelOrder.length) return;
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const available = panelOrder.filter((p) => panelSections.has(p));
  if (!available.length) return;
  const idx = Math.max(0, available.indexOf(activePanel));
  const nextIdx = e.key === 'ArrowLeft' ? Math.max(0, idx - 1) : Math.min(available.length - 1, idx + 1);
  setActivePanel(available[nextIdx]);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (!changes.trendsDisablePanels && !changes.trendsDisableTests) return;
  loadTrendSettings().then(() => {
    if (!lastObservations.length) return;
    buildPanelTables(lastObservations);
    setActivePanel(activePanel);
  });
});

loadFromSession();

