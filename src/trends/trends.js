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
const IS_PRODUCTION = import.meta.env.PROD;
const panelButtons = {
  CBC: document.getElementById('panelCbc'),
  Chemistry: document.getElementById('panelChem'),
  Urinalysis: document.getElementById('panelUa'),
  Other: document.getElementById('panelOther')
};

const DEBUG_PANEL_KEY = 'tzvet.trends.debugPayloadVisible';
const DEFAULT_PANEL_DISPLAY_OPTIONS = Object.freeze({
  groupAnnotations: true,
  hideBlankRows: false,
  hideBlankColumns: false,
  showDateSourceLabels: false
});
const DEFAULT_TABLE_FILTERS = Object.freeze({
  testName: '',
  sourceLabel: ''
});

let panelOrder = [];
let panelSections = new Map();
let activePanel = null;
let lastObservations = [];
const refDateByPanel = new Map();
let globalPanelDisplayOptions = { ...DEFAULT_PANEL_DISPLAY_OPTIONS };
let globalTableFilters = { ...DEFAULT_TABLE_FILTERS };
let pendingFilterFocus = null;
let sourceLabelPreviewPanel = null;
let trendSettings = { disablePanels: new Set(), disableTests: new Set() };
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

function openResultModal(contentHtml) {
  if (!resultModal || !resultModalContent) return;
  resultModalContent.innerHTML = contentHtml;
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

function getPanelDisplayOptions(panelName) {
  return { ...DEFAULT_PANEL_DISPLAY_OPTIONS, ...globalPanelDisplayOptions };
}

function updatePanelDisplayOptions(panelName, nextOptions) {
  globalPanelDisplayOptions = {
    ...getPanelDisplayOptions(panelName),
    ...nextOptions
  };
}

function getEffectivePanelDisplayOptions(panelName) {
  const panelOptions = getPanelDisplayOptions(panelName);
  if (sourceLabelPreviewPanel !== panelName) return panelOptions;
  return {
    ...panelOptions,
    showDateSourceLabels: true
  };
}

function getTableFilters() {
  return { ...DEFAULT_TABLE_FILTERS, ...globalTableFilters };
}

function updateTableFilters(nextFilters) {
  globalTableFilters = {
    ...getTableFilters(),
    ...nextFilters
  };
}

function captureFilterFocusState(input, key) {
  if (!input || !key) {
    pendingFilterFocus = null;
    return;
  }
  pendingFilterFocus = {
    key,
    selectionStart: input.selectionStart ?? null,
    selectionEnd: input.selectionEnd ?? null
  };
}

function restorePendingFilterFocus(root = document) {
  if (!pendingFilterFocus) return;
  const selector = `[data-filter-key="${pendingFilterFocus.key}"]`;
  const input = root.querySelector(selector);
  if (!input) return;
  input.focus();
  if (pendingFilterFocus.selectionStart !== null && pendingFilterFocus.selectionEnd !== null) {
    input.setSelectionRange(pendingFilterFocus.selectionStart, pendingFilterFocus.selectionEnd);
  }
  pendingFilterFocus = null;
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

function initializeDebugUi() {
  if (!toggleDebugPayload || !debugPayloadSection) return;
  if (IS_PRODUCTION) {
    toggleDebugPayload.remove();
    debugPayloadSection.remove();
    return;
  }

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

function formatCompactDateParts(dateKey, options = {}) {
  const showTime = !!options.showTime;
  if (dateKey === 'Unknown') {
    return { primary: 'Unknown', secondary: '' };
  }

  const parsed = dateKey.includes('T') ? new Date(dateKey) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const primary = `${monthNames[parsed.getMonth()]} ${parsed.getDate()}`;
    if (!showTime) return { primary, secondary: '' };
    const hours = parsed.getHours();
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 || 12;
    return { primary, secondary: `${displayHour} ${period}` };
  }

  return {
    primary: formatDateLabel(dateKey, { short: true, showTime: false }),
    secondary: ''
  };
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
      let isLow = false;
      let isHigh = false;
      if (obs.valueRaw) {
        const measurement = parseMeasurementValue(obs.valueRaw);
        const value = measurement.plotValue;
        const low = parseNumber(refLow);
        const high = parseNumber(refHigh);
        const rangeState = getMeasurementRangeState(measurement, low, high);
        const isAbnormal = rangeState === 'low' || rangeState === 'high';
        isLow = rangeState === 'low';
        isHigh = rangeState === 'high';
        const valueText = escapeHtml(formatDisplayValue(obs.valueRaw));
        let rendered = isAbnormal ? `<span class="lab-flag-value">${valueText}</span>` : `<span class="lab-normal-value">${valueText}</span>`;
        if (isLow) rendered += ' <span class="lab-flag lab-flag-low">L</span>';
        else if (isHigh) rendered += ' <span class="lab-flag lab-flag-high">H</span>';
        parts.push(rendered);
      }
      const qualifierKey = normalizeKey(obs.qualifier);
      const isRedundantQualifier = (isLow && qualifierKey === 'low') || (isHigh && qualifierKey === 'high');
      if (obs.qualifier && !isRedundantQualifier) parts.push(`(${escapeHtml(obs.qualifier)})`);
      const result = parts.join(' ');
      if (!obs.comment) return result;
      const comment = `<div class="lab-cell-comment">${escapeHtml(obs.comment)}</div>`;
      return result ? `${result}${comment}` : comment;
    })
    .join('; ');
}

function applyCellTruncation(cell, rawText, tooltipText = rawText) {
  if (!cell || !rawText) return;
  const text = String(tooltipText || cell.textContent || rawText).trim();
  if (text.length <= TRUNCATE_LENGTH) return;
  const originalHtml = cell.innerHTML;
  const wrap = document.createElement('span');
  wrap.className = 'cell-truncate cell-modal';
  wrap.innerHTML = cell.innerHTML;
  cell.innerHTML = '';
  cell.appendChild(wrap);
  cell.classList.add('cursor-pointer');
  cell.title = `Click to view full result: ${tooltipText || 'details'}`;
  cell.addEventListener('click', () => openResultModal(originalHtml));
}

function parseNumber(value) {
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).replace(/[^\d.+-]/g, '');
  if (!cleaned) return NaN;
  return Number(cleaned);
}

function parseMeasurementValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return { comparator: null, plotValue: NaN, raw };
  const inequalityMatch = raw.match(/^(<=|>=|<|>)\s*([-+]?\d*\.?\d+)/);
  if (inequalityMatch) {
    return {
      comparator: inequalityMatch[1],
      plotValue: Number(inequalityMatch[2]),
      raw
    };
  }
  return {
    comparator: null,
    plotValue: parseNumber(raw),
    raw
  };
}

function formatDisplayValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  const match = raw.match(/^(\s*)(<=|>=|<|>)?\s*([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s*)$/);
  if (!match) return raw;
  const comparator = match[2] || '';
  const numeric = Number(match[3].replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return raw;
  const rendered = Number.isInteger(numeric) ? String(numeric) : String(numeric);
  return `${comparator}${rendered}`;
}

function getMeasurementRangeState(measurement, low, high) {
  const value = measurement?.plotValue;
  if (!Number.isFinite(value)) return 'unknown';
  const comparator = measurement?.comparator || null;
  if (!comparator) {
    if (Number.isFinite(low) && value < low) return 'low';
    if (Number.isFinite(high) && value > high) return 'high';
    return 'normal';
  }
  if ((comparator === '<' && Number.isFinite(low) && value <= low)
    || (comparator === '<=' && Number.isFinite(low) && value < low)) {
    return 'low';
  }
  if ((comparator === '>' && Number.isFinite(high) && value >= high)
    || (comparator === '>=' && Number.isFinite(high) && value > high)) {
    return 'high';
  }
  return 'normal';
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
    .map((v, idx) => {
      const measurement = parseMeasurementValue(v);
      return {
        x: idx,
        y: measurement.plotValue,
        comparator: measurement.comparator,
        raw: measurement.raw
      };
    })
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
  const markers = points
    .map((p, i) => {
      if (!p.comparator) return '';
      const cx = padding + i * xStep;
      const cy = toY(p.y);
      const size = 4.4;
      const x = cx - size / 2;
      const y = cy - size / 2;
      const label = `${escapeHtml(p.raw)} plotted at ${p.y}`;
      return `
        <rect
          x="${x.toFixed(2)}"
          y="${y.toFixed(2)}"
          width="${size}"
          height="${size}"
          transform="rotate(45 ${cx.toFixed(2)} ${cy.toFixed(2)})"
          fill="var(--color-base-100)"
          stroke="currentColor"
          stroke-width="1.2"
        >
          <title>${label}</title>
        </rect>
      `.trim();
    })
    .join('');
  const lastPoint = points[points.length - 1];
  const lastMarker = lastPoint?.comparator
    ? ''
    : `<circle cx="${padding + (points.length - 1) * xStep}" cy="${toY(lastPoint.y).toFixed(2)}" r="2.25" fill="currentColor" />`;

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
      ${markers}
      ${lastMarker}
    </svg>
  `.trim();
}

function getTestUnit(observations) {
  for (const obs of observations) {
    if (obs.unit) return obs.unit;
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

function parseGroupedAnnotationTestName(testName) {
  const text = String(testName || '').trim();
  const patterns = [
    /^((?:RBC|WBC)\s+Morphology)(?:\s*-\s*(.+))?$/i,
    /^(Casts)(?:\s*-\s*(.+))?$/i,
    /^(Crystals)(?:\s*-\s*(.+))?$/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    return {
      groupName: match[1].replace(/\s+/g, ' ').trim(),
      detailName: String(match[2] || '').replace(/\s+/g, ' ').trim()
    };
  }
  return null;
}

function hasRenderableGroupedAnnotationValue(obs) {
  if (!obs) return false;
  return Boolean(
    String(obs.valueRaw || '').trim()
    || String(obs.qualifier || '').trim()
    || String(obs.comment || '').trim()
  );
}

function buildGroupedAnnotationCell(observations) {
  if (!observations || observations.length === 0) return '';
  const entries = observations
    .map((obs) => {
      const annotation = parseGroupedAnnotationTestName(obs.testName);
      if (!annotation || !hasRenderableGroupedAnnotationValue(obs)) return '';
      const label = annotation.detailName || annotation.groupName;
      const value = String(obs.valueRaw || '').trim();
      const qualifier = String(obs.qualifier || '').trim();
      const parts = [];
      if (value) parts.push(`<span class="lab-morphology-value">${escapeHtml(value)}</span>`);
      if (qualifier) parts.push(`<span class="lab-morphology-qualifier">(${escapeHtml(qualifier)})</span>`);
      const body = parts.length ? `: ${parts.join(' ')}` : '';
      const comment = obs.comment
        ? `<div class="lab-cell-comment">${escapeHtml(obs.comment)}</div>`
        : '';
      return `<div class="lab-morphology-entry"><span class="lab-morphology-label">${escapeHtml(label)}</span>${body}${comment}</div>`;
    })
    .filter(Boolean);
  return entries.join('');
}

function attachModifiedWheelHorizontalScroll(scroller) {
  if (!scroller) return;
  scroller.addEventListener('wheel', (event) => {
    if (!event.shiftKey) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    scroller.scrollLeft += delta;
  }, { passive: false });
}

function hasRenderablePlainObservation(obs) {
  if (!obs) return false;
  return Boolean(
    String(obs.valueRaw || '').trim()
    || String(obs.qualifier || '').trim()
    || String(obs.comment || '').trim()
  );
}

function hasRenderableRowContent(row, dates) {
  if (!row || !dates?.length) return false;
  return dates.some((dateKey) => {
    const obsList = row.observationsByDate?.get(dateKey) || [];
    if (row.groupedAnnotation) {
      return obsList.some((obs) => hasRenderableGroupedAnnotationValue(obs));
    }
    return obsList.some((obs) => hasRenderablePlainObservation(obs));
  });
}

function matchesFilterText(value, filterText) {
  const needle = normalizeKey(filterText);
  if (!needle) return true;
  return normalizeKey(value).includes(needle);
}

function buildDisplayRows(panelName, testEntries, byTest, options = DEFAULT_PANEL_DISPLAY_OPTIONS) {
  if (!options.groupAnnotations) {
    return testEntries.map((entry) => ({
      key: entry.key,
      name: entry.name,
      unit: entry.unit,
      groupedAnnotation: false,
      observationsByDate: byTest.get(entry.key)?.observationsByDate || new Map()
    }));
  }

  const rows = [];
  const groupedAnnotationRows = new Map();

  testEntries.forEach((entry) => {
    const info = byTest.get(entry.key);
    const annotation = parseGroupedAnnotationTestName(entry.name);
    const shouldGroup = annotation && (
      panelName === 'CBC'
      || (panelName === 'Urinalysis' && /^(casts|crystals)$/i.test(annotation.groupName))
    );
    if (shouldGroup) {
      const groupKey = normalizeTestKey(annotation.groupName);
      if (!groupedAnnotationRows.has(groupKey)) {
        groupedAnnotationRows.set(groupKey, {
          key: `grouped-annotation::${groupKey}`,
          name: annotation.groupName,
          unit: '',
          groupedAnnotation: true,
          children: []
        });
      }
      groupedAnnotationRows.get(groupKey).children.push(entry.key);
      return;
    }
    rows.push({
      key: entry.key,
      name: entry.name,
      unit: entry.unit,
      groupedAnnotation: false,
      observationsByDate: info?.observationsByDate || new Map()
    });
  });

  groupedAnnotationRows.forEach((group) => {
    const hasData = group.children.some((childKey) => {
      const childInfo = byTest.get(childKey);
      if (!childInfo?.observationsByDate) return false;
      for (const [, obsList] of childInfo.observationsByDate.entries()) {
        if (obsList.some((obs) => hasRenderableGroupedAnnotationValue(obs))) return true;
      }
      return false;
    });
    if (!hasData) return;

    const observationsByDate = new Map();
    group.children.forEach((childKey) => {
      const childInfo = byTest.get(childKey);
      if (!childInfo?.observationsByDate) return;
      childInfo.observationsByDate.forEach((obsList, dateKey) => {
        const filtered = obsList.filter((obs) => hasRenderableGroupedAnnotationValue(obs));
        if (!filtered.length) return;
        if (!observationsByDate.has(dateKey)) observationsByDate.set(dateKey, []);
        observationsByDate.get(dateKey).push(...filtered);
      });
    });

    rows.push({
      key: group.key,
      name: group.name,
      unit: '',
      groupedAnnotation: true,
      observationsByDate
    });
  });

  return rows;
}

function buildPanelTables(observations) {
  lastObservations = observations;
  if (panelsEl) {
    panelsEl.className = 'relative';
    panelsEl.innerHTML = '';
  }
  panelSections = new Map();
  const panels = new Map();
  observations.forEach((obs) => {
    if (!obs.panel || !obs.testName) return;
    const panelName = normalizePanelName(obs.panel);
    if (!panels.has(panelName)) panels.set(panelName, []);
    panels.get(panelName).push(obs);
  });

  if (!panels.size) {
    statusEl.textContent = 'No panel data found.';
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
    const panelOptions = getPanelDisplayOptions(panelName);
    const effectivePanelOptions = getEffectivePanelDisplayOptions(panelName);
    const tableFilters = getTableFilters();
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
    const displayRows = buildDisplayRows(panelName, testEntries, byTest, effectivePanelOptions);
    const filteredRows = displayRows.filter((row) => matchesFilterText(row.name, tableFilters.testName));
    const filteredDates = dates.filter((dateKey) => {
      const sourceLabel = originalPanelByDate.get(dateKey) || panelName;
      return matchesFilterText(sourceLabel, tableFilters.sourceLabel);
    });
    const visibleRows = effectivePanelOptions.hideBlankRows
      ? filteredRows.filter((row) => hasRenderableRowContent(row, filteredDates))
      : filteredRows;
    const visibleDates = effectivePanelOptions.hideBlankColumns
      ? filteredDates.filter((dateKey) => visibleRows.some((row) => {
        const obsList = row.observationsByDate?.get(dateKey) || [];
        if (row.groupedAnnotation) return obsList.some((obs) => hasRenderableGroupedAnnotationValue(obs));
        return obsList.some((obs) => hasRenderablePlainObservation(obs));
      }))
      : filteredDates;

    const hasAnyRef = refDates.length > 0;
    const hasTrendData = visibleRows.some((entry) => {
      if (entry.groupedAnnotation || isTrendDisabled(panelName, entry.name)) return false;
      const byDate = entry.observationsByDate;
      const values = visibleDates
        .map((d) => {
          const obsList = byDate.get(d) || [];
          return obsList.length ? obsList[0].valueRaw : null;
        })
        .filter((v) => v !== null && v !== undefined)
        .map((v) => parseNumber(v))
        .filter((n) => Number.isFinite(n));
      return values.length >= 2;
    });
    const showTrendColumn = visibleDates.length > 1
      && !isTrendDisabled(panelName, null)
      && hasTrendData;

    const section = document.createElement('section');
    section.className = 'lab-panel card bg-base-200 shadow-sm w-full border border-base-300';

    const header = document.createElement('div');
    header.className = 'card-body gap-3 p-0';
    const headerBar = document.createElement('div');
    headerBar.className = 'lab-panel-header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'lab-panel-title-wrap';
    titleWrap.innerHTML = `
      <h2 class="card-title lab-panel-title text-base md:text-lg">${panelName}</h2>
    `;
    headerBar.appendChild(titleWrap);

    const controlsWrap = document.createElement('div');
    controlsWrap.className = 'lab-panel-controls';

    const filtersWrap = document.createElement('div');
    filtersWrap.className = 'lab-panel-filters';
    [
      ['testName', 'Filter by test name (rows)'],
      ['sourceLabel', 'Filter by source name (cols)']
    ].forEach(([key, placeholder]) => {
      const input = document.createElement('input');
      input.type = 'search';
      input.className = 'input input-xs input-bordered lab-panel-filter-input';
      input.placeholder = placeholder;
      input.value = tableFilters[key] || '';
      input.dataset.filterKey = key;
      input.dataset.panelName = panelName;
      input.setAttribute('aria-label', placeholder);
      input.addEventListener('input', (e) => {
        captureFilterFocusState(e.target, key);
        updateTableFilters({ [key]: e.target.value });
        buildPanelTables(lastObservations);
        setActivePanel(panelName);
      });
      if (key === 'sourceLabel') {
        input.addEventListener('focus', () => {
          if (panelOptions.showDateSourceLabels) return;
          if (sourceLabelPreviewPanel === panelName) return;
          captureFilterFocusState(input, key);
          sourceLabelPreviewPanel = panelName;
          buildPanelTables(lastObservations);
          setActivePanel(panelName);
        });
        input.addEventListener('blur', () => {
          window.setTimeout(() => {
            if (panelOptions.showDateSourceLabels) return;
            const activeEl = document.activeElement;
            if (
              activeEl?.dataset?.filterKey === 'sourceLabel'
              && activeEl?.dataset?.panelName === panelName
            ) {
              return;
            }
            if (sourceLabelPreviewPanel !== panelName) return;
            sourceLabelPreviewPanel = null;
            buildPanelTables(lastObservations);
            setActivePanel(panelName);
          }, 0);
        });
      }
      filtersWrap.appendChild(input);
    });
    controlsWrap.appendChild(filtersWrap);

    const optionsDetails = document.createElement('details');
    optionsDetails.className = 'dropdown dropdown-end';
    const summary = document.createElement('summary');
    summary.className = 'btn btn-xs btn-outline';
    summary.textContent = 'Table options';
    optionsDetails.appendChild(summary);

    const menu = document.createElement('div');
    menu.className = 'lab-panel-options-menu';
    [
      ['groupAnnotations', 'Group Morphology / Casts / Crystals'],
      ['hideBlankRows', 'Hide blank rows'],
      ['hideBlankColumns', 'Hide blank columns'],
      ['showDateSourceLabels', 'Show source label above date']
    ].forEach(([key, label]) => {
      const row = document.createElement('label');
      row.className = 'lab-panel-option-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'checkbox checkbox-xs';
      checkbox.checked = !!panelOptions[key];
      checkbox.addEventListener('change', () => {
        updatePanelDisplayOptions(panelName, { [key]: checkbox.checked });
        buildPanelTables(lastObservations);
        setActivePanel(panelName);
      });
      const text = document.createElement('span');
      text.className = 'text-xs';
      text.textContent = label;
      row.appendChild(checkbox);
      row.appendChild(text);
      menu.appendChild(row);
    });
    optionsDetails.appendChild(menu);
    controlsWrap.appendChild(optionsDetails);
    headerBar.appendChild(controlsWrap);
    header.appendChild(headerBar);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'lab-table-wrap overflow-x-auto max-w-full';
    attachModifiedWheelHorizontalScroll(tableWrap);

    const table = document.createElement('table');
    table.className = 'lab-table table table-xs table-pin-rows bg-base-100 border border-base-300 border-separate border-spacing-0 rounded-none';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const testTh = document.createElement('th');
    testTh.className = 'w-48 sticky-col sticky-col-header lab-test-header-cell';
    const testHeader = document.createElement('div');
    testHeader.className = 'lab-col-title';
    testHeader.innerHTML = 'Test <span class="lab-col-hint">Hold Shift + wheel to scroll horizontally</span>';
    const refRow = document.createElement('div');
    refRow.className = 'lab-ref-row';
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

    visibleDates.forEach((d) => {
      const th = document.createElement('th');
      th.className = 'lab-date-header-cell';
      const span = document.createElement('span');
      span.className = 'lab-date-chip cursor-help';
      const tip = originalPanelByDate.get(d) || panelName;
      span.title = tip;
      const dayKey = getDayKey(d);
      const showTime = (dayCounts.get(dayKey) || 0) > 1;
      if (effectivePanelOptions.showDateSourceLabels) {
        const source = document.createElement('span');
        source.className = 'lab-date-chip-source';
        source.textContent = tip;
        span.appendChild(source);
      }
      const dateParts = formatCompactDateParts(d, { showTime });
      const primary = document.createElement('span');
      primary.className = 'lab-date-chip-primary';
      primary.textContent = dateParts.primary;
      span.appendChild(primary);
      if (dateParts.secondary) {
        const secondary = document.createElement('span');
        secondary.className = 'lab-date-chip-secondary';
        secondary.textContent = dateParts.secondary;
        span.appendChild(secondary);
      }
      th.appendChild(span);
      headRow.appendChild(th);
    });
    if (showTrendColumn) {
      const trendTh = document.createElement('th');
      trendTh.className = 'w-28 lab-trend-header-cell';
      trendTh.textContent = 'Trendline';
      headRow.appendChild(trendTh);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    visibleRows.forEach((entry) => {
      const testName = entry.name;
      const testKey = entry.key;
      const byDate = entry.observationsByDate || new Map();
      const row = document.createElement('tr');
      row.className = 'lab-row';
      const nameTd = document.createElement('td');
      nameTd.className = 'w-48 max-w-48 break-words sticky-col lab-test-cell';
      const testObs = visibleDates.flatMap((d) => byDate.get(d) || []);
      const unit = normalizeUnit(getTestUnit(testObs));
      const displayName = `<span class="font-medium text-base-content">${testName}</span>`;
      const ref = entry.groupedAnnotation ? { low: null, high: null } : getReferenceForTestDate(panelObs, testKey, selectedRefDate);
      const range = formatRangeText(ref);
      const metaParts = [];
      if (range) metaParts.push(range);
      else if (hasAnyRef && !entry.groupedAnnotation) metaParts.push('<span class="text-[11px] text-gray-400 italic">no ref</span>');
      if (unit && !entry.groupedAnnotation) metaParts.push(`<span class="text-[11px] text-gray-400">(${escapeHtml(unit)})</span>`);
      const meta = metaParts.length
        ? `<div class="lab-test-meta">${metaParts.join(' ')}</div>`
        : '';
      nameTd.innerHTML = `${displayName}${meta}`;
      row.appendChild(nameTd);

      visibleDates.forEach((d) => {
        const td = document.createElement('td');
        td.className = 'lab-value-cell';
        const obsList = byDate.get(d) || [];
        const cellText = entry.groupedAnnotation
          ? buildGroupedAnnotationCell(obsList)
          : formatCell(obsList, ref?.low, ref?.high);
        td.innerHTML = cellText;
        applyCellTruncation(td, cellText);
        row.appendChild(td);
      });

      if (showTrendColumn) {
        const trendTd = document.createElement('td');
        trendTd.className = 'lab-trend-cell text-slate-500';
        if (!entry.groupedAnnotation && !isTrendDisabled(panelName, testName)) {
          const series = visibleDates.map((d) => {
            const obsList = byDate.get(d) || [];
            return obsList.length ? obsList[0].valueRaw : null;
          });
          trendTd.innerHTML = buildSparkline(series, ref?.low, ref?.high);
        }
        row.appendChild(trendTd);
      }
      tbody.appendChild(row);
    });
    if (!visibleRows.length) {
      const emptyRow = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.className = 'text-gray-500 text-sm italic';
      emptyTd.colSpan = Math.max(2, visibleDates.length + 1 + (showTrendColumn ? 1 : 0));
      emptyTd.textContent = 'No tests available for this panel with the current display options.';
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
  restorePendingFilterFocus(panelSections.get(activePanel) || document);
}

async function loadFromSession() {
  const payload = await getStoredPayload();
  if (!payload || !payload.observations) {
    statusEl.textContent = '(No data found. Extract from the side panel first.)';
    panelsEl.innerHTML = '';
    if (patientEl) patientEl.textContent = '';
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

initializeDebugUi();

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
  if (!e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const available = panelOrder.filter((p) => panelSections.has(p));
  if (!available.length) return;
  e.preventDefault();
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

