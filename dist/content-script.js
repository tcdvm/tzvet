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

function extractLabTrends() {
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

function swLog(...args) {
  try {
    chrome.runtime.sendMessage({ type: 'LOG', args }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[swLog] sendMessage failed:', chrome.runtime.lastError.message);
      }
    });
  } catch (e) {
    console.warn('[swLog] sendMessage threw:', e);
  }
}

// content-script.js - runs on matched pages

console.log('TZVet content script loaded on', location.href);
const debug = (...args) => { console.log(...args); };
const debugLog = (...args) => { console.log(...args); };

// ---- Normalize species labels ----
const NORMALIZE_KEY = 'normalizeSpecies';
let normalizeEnabled = false;
let normalizeObserver = null;

const normalizePatterns = [
  { re: /\bCanine\s*\(\s*Dog\s*\)/gi, repl: 'Canine' },
  { re: /\bFeline\s*\(\s*Cat\s*\)/gi, repl: 'Feline' }
];

function isNormalizeActive() {
  const el = document.querySelector('div.rtabdetails.dashboard');
  return !!(el && el.classList && el.classList.contains('active'));
}

function shouldSkipNode(node) {
  if (!node || !node.parentElement) return true;
  const tag = node.parentElement.tagName.toLowerCase();
  const skip = ['script', 'style', 'textarea', 'input', 'code', 'pre', 'noscript'];
  return skip.includes(tag);
}

function replaceInTextNode(textNode) {
  if (!textNode || !textNode.nodeValue) return;
  let text = textNode.nodeValue;
  let changed = false;
  for (const p of normalizePatterns) {
    const newText = text.replace(p.re, p.repl);
    if (newText !== text) {
      text = newText;
      changed = true;
    }
  }
  if (changed) {
    textNode.nodeValue = text;
    debug('[normalize] text-node changed', textNode.parentElement, text);
  }
}

function normalizeElementText(el) {
  if (!el || !el.textContent) return;
  const before = el.textContent;
  let after = before;
  for (const p of normalizePatterns) {
    after = after.replace(p.re, p.repl);
  }
  if (after !== before) {
    el.textContent = after;
    debugLog('[normalize] element updated', el, '->', after);
  }
}

function applyNormalizationToDocument(root = document.body) {
  if (!isNormalizeActive()) return;
  if (!root) return;

  // Fast-path: normalize known appointment description elements as a whole
  try {
    const elems = root.querySelectorAll && root.querySelectorAll('.appointmentDescription');
    if (elems && elems.length) {
      elems.forEach((el) => normalizeElementText(el));
      // continue — still walk other text nodes to catch other occurrences
    }
  } catch (e) {
    // ignore query errors in weird contexts
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  let node = walker.nextNode();
  while (node) {
    if (!shouldSkipNode(node)) replaceInTextNode(node);
    node = walker.nextNode();
  }
}

function observeForChanges() {
  if (normalizeObserver) return;
  normalizeObserver = new MutationObserver((mutations) => {
    if (!isNormalizeActive()) return;
    debug('[normalize] mutations received', mutations.length);
    for (const m of mutations) {
      debug('[normalize] mutation', m.type);
      if (m.type === 'characterData' && m.target) {
        if (!shouldSkipNode(m.target)) {
          debug('[normalize] characterData change in', m.target.parentElement);
          replaceInTextNode(m.target);
        }
      }
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.TEXT_NODE) {
            if (!shouldSkipNode(n)) {
              debug('[normalize] added text node', n.parentElement);
              replaceInTextNode(n);
            }
          } else if (n.nodeType === Node.ELEMENT_NODE) {
            debug('[normalize] added element', n);
            applyNormalizationToDocument(n);
          }
        }
      }
    }
  });
  normalizeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  debug('[normalize] observer started');
}

function disconnectObserver() {
  if (!normalizeObserver) return;
  normalizeObserver.disconnect();
  normalizeObserver = null;
  debug('[normalize] observer disconnected');
}

function setNormalization(enabled) {
  normalizeEnabled = !!enabled;
  if (normalizeEnabled) {
    applyNormalizationToDocument();
    observeForChanges();
    console.log('Normalization enabled');
  } else {
    disconnectObserver();
    console.log('Normalization disabled (existing changes remain)');
  }
}

// Initialize from storage
chrome.storage.sync.get({ [NORMALIZE_KEY]: false }, (items) => {
  setNormalization(Boolean(items[NORMALIZE_KEY]));
});

// Also respond to storage changes (in case the setting is changed elsewhere)
chrome.storage.onChanged.addListener((changes, area) => {
  debug('[storage] changes', changes, area);
  if (area === 'sync' && changes[NORMALIZE_KEY]) {
    setNormalization(Boolean(changes[NORMALIZE_KEY].newValue));
  }
});

// ---- Header visibility toggling ----
const HEADER_KEY = 'headerHidden';
let headerHidden = false;
let headerObserver = null;

function applyHeaderVisibilityToAll() {
  // Only target the *first* <header> in the document (the main header), not all elements
  const h = document.querySelector('header');
  if (!h) return false;

  // Properties to save/restore when collapsing the header
  const props = ['display', 'height', 'minHeight', 'maxHeight', 'paddingTop', 'paddingBottom', 'marginTop', 'marginBottom', 'overflow', 'visibility', 'pointerEvents'];

  if (headerHidden) {
    // Save previous inline values as a JSON blob so we can restore exactly
    if (!h.hasAttribute('data-tzvet-prev-style')) {
      const prev = {};
      for (const p of props) prev[p] = h.style[p] || '';
      h.setAttribute('data-tzvet-prev-style', JSON.stringify(prev));
    }

    // Collapse the header so it takes no space (avoid display:none's side-effects by setting collapsing styles)
    h.style.display = 'block'; // ensure block for height control
    h.style.height = '0px';
    h.style.minHeight = '0px';
    h.style.maxHeight = '0px';
    h.style.paddingTop = '0px';
    h.style.paddingBottom = '0px';
    h.style.marginTop = '0px';
    h.style.marginBottom = '0px';
    h.style.overflow = 'hidden';
    h.style.visibility = 'hidden';
    h.style.pointerEvents = 'none';

    h.setAttribute('aria-hidden', 'true');
    h.setAttribute('data-tzvet-hidden', 'true');

    debugLog('[header] collapsed (no space)');
  } else {
    // restore previous values if we saved them
    if (h.getAttribute('data-tzvet-hidden') === 'true') {
      const prevJson = h.getAttribute('data-tzvet-prev-style');
      try {
        if (prevJson) {
          const prev = JSON.parse(prevJson);
          for (const p of props) {
            if (prev[p] !== undefined) h.style[p] = prev[p] || '';
          }
        } else {
          // fallback: clear our inline styles
          for (const p of props) h.style[p] = '';
        }
      } catch (e) {
        for (const p of props) h.style[p] = '';
      }

      h.removeAttribute('data-tzvet-prev-style');
    }
    h.removeAttribute('aria-hidden');
    h.removeAttribute('data-tzvet-hidden');

    debugLog('[header] restored');
  }
  return true;
}

function observeHeaderAdditions() {
  if (headerObserver) return;
  headerObserver = new MutationObserver((mutations) => {
    debug('[header] mutations', mutations.length);
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            debug('[header] added node', n);
            if (n.tagName && n.tagName.toLowerCase() === 'header') {
              if (applyHeaderVisibilityToAll()) disconnectHeaderObserver();
            } else if (n.querySelector && n.querySelector('header')) {
              if (applyHeaderVisibilityToAll()) disconnectHeaderObserver();
            }
          }
        }
      }
    }
  });
  headerObserver.observe(document.body, { childList: true, subtree: true });
  debug('[header] observer started');
}

function disconnectHeaderObserver() {
  if (!headerObserver) return;
  headerObserver.disconnect();
  headerObserver = null;
}

function setHeaderVisibility(hidden) {
  headerHidden = !!hidden;
  debug('[header] setHeaderVisibility', headerHidden);
  if (headerHidden) {
    const applied = applyHeaderVisibilityToAll();
    if (!applied) observeHeaderAdditions();
    console.log('[header] hidden');
  } else {
    disconnectHeaderObserver();
    applyHeaderVisibilityToAll();
    console.log('[header] visible');
  }
}

// messages from side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  debug('[cs] side panel message', msg && msg.type);
  if (msg?.type === 'HIGHLIGHT') {
    document.body.style.backgroundColor = msg.color || 'rgba(255,255,0,0.15)';
    sendResponse({ status: 'done' });
  } else if (msg?.type === 'NORMALIZE_TOGGLE') {
    setNormalization(!!msg.enabled);
    sendResponse({ status: 'ok' });
  } else if (msg?.type === 'NORMALIZE_NOW') {
    applyNormalizationToDocument();
    sendResponse({ status: 'ran' });
  } else if (msg?.type === 'HEADER_TOGGLE') {
    setHeaderVisibility(!!msg.hidden);
    sendResponse({ status: 'ok' });
  } else if (msg?.type === 'HEADER_TOGGLE_NOW') {
    applyHeaderVisibilityToAll();
    sendResponse({ status: 'ran' });
  } else if (msg?.type === 'QTIP_TOGGLE') {
    setQtipReplacement(!!msg.enabled);
    sendResponse({ status: 'ok' });
  } else if (msg?.type === 'QTIP_APPLY_NOW') {
    applyQtipPlaceholderToAll();
    sendResponse({ status: 'ran' });
  } else if (msg?.type === 'EXTRACT_LAB_TRENDS') {
    try {
      const result = extractLabTrends();
      swLog('Extract lab trends result', result);
      if (result?.ok && result.patient?.id) {
        const key = result.patient.id;
        chrome.storage.local.get({ labTrendsByPatient: {} }, (items) => {
          const store = items.labTrendsByPatient || {};
          const existing = store[key] || { patient: result.patient, observations: [] };
          const combined = existing.observations.concat(result.observations || []);
          const seen = new Set();
          const deduped = [];
          combined.forEach((obs) => {
            const sig = [
              obs.panel,
              obs.testName,
              obs.collectedAt,
              obs.valueRaw,
              obs.unit,
              obs.lowestValue,
              obs.highestValue,
              obs.qualifier
            ].join('|');
            if (seen.has(sig)) return;
            seen.add(sig);
            deduped.push(obs);
          });
          store[key] = {
            patient: result.patient,
            observations: deduped,
            updatedAt: new Date().toISOString()
          };
          chrome.storage.local.set({ labTrendsByPatient: store });
        });
      }
      sendResponse(result);
    } catch (e) {
      const errMsg = e?.message || String(e);
      console.warn('[cs] extract lab trends failed', e);
      sendResponse({ ok: false, error: errMsg });
    }
    return true;
  }
});

// Initialize header and q-tip settings from storage
chrome.storage.sync.get({ [HEADER_KEY]: false, qtipPlaceholder: false }, (items) => {
  debug('[storage] init', items);
  setHeaderVisibility(Boolean(items[HEADER_KEY]));
  setQtipReplacement(Boolean(items.qtipPlaceholder));
});

// Watch for header and q-tip setting changes
chrome.storage.onChanged.addListener((changes, area) => {
  debug('[storage] onChanged', changes, area);
  if (area === 'sync') {
    if (changes[HEADER_KEY]) setHeaderVisibility(Boolean(changes[HEADER_KEY].newValue));
    if (changes.qtipPlaceholder) setQtipReplacement(Boolean(changes.qtipPlaceholder.newValue));
  }
});
let qtipReplaced = false;
let qtipObserver = null;
const QTIP_SELECTOR = '.qtip.qtip-default.ezy-tooltip';
const QTIP_PLACEHOLDER = '<div class="tzvet-qtip-placeholder" style="padding:6px;color:#374151">(popups disabled)</div>';

// ---- q-tip helpers: wait for loading to finish and replace with first content child ----
const qtipReadyObservers = new Map();

function isQtipLoading(el) {
  try {
    const txt = el.innerText ? el.innerText.trim() : '';
    if (txt === 'Loading') return true;
    const content = el.querySelector('.qtip-content');
    if (!content) return txt.toLowerCase().includes('loading');
    return content.children.length === 0 && txt.toLowerCase().includes('loading');
  } catch (e) {
    return false;
  }
}

function applyQtipReplacement(el) {
  try {
    const content = el.querySelector('.qtip-content');
    if (content && content.children && content.children.length) {
      if (!el.hasAttribute('data-tzvet-qtip-original')) {
        el.setAttribute('data-tzvet-qtip-original', el.innerHTML);
      }
      const first = content.children[0];
      // replace content with only the first child (clone to avoid removing nodes used elsewhere)
      content.replaceChildren(first.cloneNode(true));
      el.setAttribute('data-tzvet-qtip-replaced', '1');
      return true;
    } else {
      // fallback: if no structured content yet, use placeholder
      if (!el.hasAttribute('data-tzvet-qtip-original')) el.setAttribute('data-tzvet-qtip-original', el.innerHTML);
      el.innerHTML = QTIP_PLACEHOLDER;
      el.setAttribute('data-tzvet-qtip-replaced', '1');
      return true;
    }
  } catch (e) {
    console.warn('[qtip] replace error', e);
    return false;
  }
}

function waitForQtipReadyAndApply(el, timeout = 5000) {
  if (!el || !(el instanceof HTMLElement)) return;
  if (qtipReadyObservers.has(el)) return;
  if (!isQtipLoading(el)) {
    applyQtipReplacement(el);
    return;
  }
  debugLog('[qtip] waiting for ready', el);
  const obs = new MutationObserver(() => {
    if (!isQtipLoading(el)) {
      const o = qtipReadyObservers.get(el);
      if (o) o.disconnect();
      qtipReadyObservers.delete(el);
      applyQtipReplacement(el);
    }
  });
  qtipReadyObservers.set(el, obs);
  obs.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
  const to = setTimeout(() => {
    if (qtipReadyObservers.has(el)) {
      const o = qtipReadyObservers.get(el);
      if (o) o.disconnect();
      qtipReadyObservers.delete(el);
      applyQtipReplacement(el);
      debugLog('[qtip] timed out waiting for ready, applied fallback', el);
    }
  }, timeout);
  obs._tzvet_timeout = to;
}

function clearAllQtipReadyObservers() {
  for (const [el, o] of qtipReadyObservers.entries()) {
    try {
      if (o && typeof o.disconnect === 'function') o.disconnect();
      if (o && o._tzvet_timeout) clearTimeout(o._tzvet_timeout);
    } catch (e) { }
  }
  qtipReadyObservers.clear();
}

function applyQtipPlaceholderToAll(root = document.body) {
  try {
    const items = (root.querySelectorAll && root.querySelectorAll(QTIP_SELECTOR)) || [];
    let replacedCount = 0;
    let restoredCount = 0;
    items.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (qtipReplaced) {
        if (isQtipLoading(el)) {
          waitForQtipReadyAndApply(el);
          return;
        }
        if (applyQtipReplacement(el)) replacedCount++;
      } else {
        if (el.getAttribute('data-tzvet-qtip-replaced') === '1') {
          const orig = el.getAttribute('data-tzvet-qtip-original');
          if (orig !== null) el.innerHTML = orig;
          el.removeAttribute('data-tzvet-qtip-original');
          el.removeAttribute('data-tzvet-qtip-replaced');
          restoredCount++;
        }
      }
    });
    debugLog('[qtip] applied', { replaced: replacedCount, restored: restoredCount, totalFound: items.length }, root === document.body ? 'document' : root);
  } catch (e) {
    console.warn('[qtip] apply error', e);
  }
}

function observeQtipAdditions() {
  if (qtipObserver) return;
  qtipObserver = new MutationObserver((mutations) => {
    debugLog('[qtip] mutations', mutations.length);
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n;
            debugLog('[qtip] added node', el);
            if (el.matches && el.matches(QTIP_SELECTOR)) {
              if (qtipReplaced) {
                if (isQtipLoading(el)) waitForQtipReadyAndApply(el);
                else applyQtipReplacement(el);
              }
            } else if (el.querySelector && el.querySelector(QTIP_SELECTOR)) {
              if (qtipReplaced) applyQtipPlaceholderToAll(el);
            }
          }
        }
      } else if (m.type === 'attributes') {
        const t = m.target;
        debugLog('[qtip] attribute change', m.attributeName, t);
        if (t instanceof Element) {
          if (t.matches && t.matches(QTIP_SELECTOR)) {
            if (qtipReplaced) {
              if (isQtipLoading(t)) waitForQtipReadyAndApply(t);
              else applyQtipReplacement(t);
            }
          } else if (t.querySelector && t.querySelector(QTIP_SELECTOR)) {
            const found = t.querySelector(QTIP_SELECTOR);
            if (qtipReplaced) {
              if (isQtipLoading(found)) waitForQtipReadyAndApply(found);
              else applyQtipReplacement(found);
            }
          }
        }
      }
    }
  });
  qtipObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  debugLog('[qtip] observer started');
}

function disconnectQtipObserver() {
  if (!qtipObserver) return;
  qtipObserver.disconnect();
  qtipObserver = null;
  clearAllQtipReadyObservers();
  debugLog('[qtip] observer disconnected');
}

function setQtipReplacement(enabled) {
  qtipReplaced = !!enabled;
  console.log('[qtip] setQtipReplacement', qtipReplaced);
  if (qtipReplaced) {
    applyQtipPlaceholderToAll();
    observeQtipAdditions();
    console.log('[qtip] enabled');
  } else {
    disconnectQtipObserver();
    applyQtipPlaceholderToAll();
    console.log('[qtip] disabled');
  }
}
