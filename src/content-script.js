// content-script.js — runs on matched pages
console.log('TZVet content script loaded on', location.href);

// Example: highlight all paragraphs
for (const p of document.querySelectorAll('p')) {
  p.style.outline = '1px dashed rgba(0, 150, 136, 0.4)';
}

// Listen to messages from extension
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.debug('[cs] onMessage received', msg);
  if (msg?.type === 'HIGHLIGHT') {
    console.debug('[cs] HIGHLIGHT', msg);
    document.body.style.backgroundColor = msg.color || 'rgba(255,255,0,0.15)';
    sendResponse({ status: 'done' });
  } else if (msg?.type === 'NORMALIZE_TOGGLE') {
    console.debug('[cs] NORMALIZE_TOGGLE', msg.enabled);
    setNormalization(!!msg.enabled);
    sendResponse({ status: 'ok' });
  } else if (msg?.type === 'NORMALIZE_NOW') {
    console.debug('[cs] NORMALIZE_NOW');
    applyNormalizationToDocument();
    sendResponse({ status: 'ran' });
  }
});

// ---- Normalize species labels ----
const NORMALIZE_KEY = 'normalizeSpecies';
let normalizeEnabled = false;
let normalizeObserver = null;

const normalizePatterns = [
  { re: /\bCanine\s*\(\s*Dog\s*\)/gi, repl: 'Canine' },
  { re: /\bFeline\s*\(\s*Cat\s*\)/gi, repl: 'Feline' }
];

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
    console.debug('[normalize] text-node changed', textNode.parentElement, text);
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
    console.log('[normalize] element updated', el, '->', after);
  }
}

function applyNormalizationToDocument(root = document.body) {
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
    console.debug('[normalize] mutations received', mutations.length);
    for (const m of mutations) {
      console.debug('[normalize] mutation', m.type);
      if (m.type === 'characterData' && m.target) {
        if (!shouldSkipNode(m.target)) {
          console.debug('[normalize] characterData change in', m.target.parentElement);
          replaceInTextNode(m.target);
        }
      }
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.TEXT_NODE) {
            if (!shouldSkipNode(n)) {
              console.debug('[normalize] added text node', n.parentElement);
              replaceInTextNode(n);
            }
          } else if (n.nodeType === Node.ELEMENT_NODE) {
            console.debug('[normalize] added element', n);
            applyNormalizationToDocument(n);
          }
        }
      }
    }
  });
  normalizeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  console.debug('[normalize] observer started');
}

function disconnectObserver() {
  if (!normalizeObserver) return;
  normalizeObserver.disconnect();
  normalizeObserver = null;
  console.debug('[normalize] observer disconnected');
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
  console.debug('[storage] changes', changes, area);
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
  if (!h) return;

  // Properties to save/restore when collapsing the header
  const props = ['display','height','minHeight','maxHeight','paddingTop','paddingBottom','marginTop','marginBottom','overflow','visibility','pointerEvents'];

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

    console.log('[header] collapsed (no space)');
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

    console.log('[header] restored');
  }
}

function observeHeaderAdditions() {
  if (headerObserver) return;
  headerObserver = new MutationObserver((mutations) => {
    console.debug('[header] mutations', mutations.length);
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            console.debug('[header] added node', n);
            if (n.tagName && n.tagName.toLowerCase() === 'header') applyHeaderVisibilityToAll();
            else if (n.querySelector && n.querySelector('header')) applyHeaderVisibilityToAll();
          }
        }
      }
    }
  });
  headerObserver.observe(document.body, { childList: true, subtree: true });
  console.debug('[header] observer started');
}

function disconnectHeaderObserver() {
  if (!headerObserver) return;
  headerObserver.disconnect();
  headerObserver = null;
}

function setHeaderVisibility(hidden) {
  headerHidden = !!hidden;
  console.debug('[header] setHeaderVisibility', headerHidden);
  if (headerHidden) {
    applyHeaderVisibilityToAll();
    observeHeaderAdditions();
    console.log('[header] hidden');
  } else {
    disconnectHeaderObserver();
    applyHeaderVisibilityToAll();
    console.log('[header] visible');
  }
}

// messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.debug('[cs] popup message', msg && msg.type);
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
  }
});

// Initialize header and q-tip settings from storage
chrome.storage.sync.get({ [HEADER_KEY]: false, qtipPlaceholder: false }, (items) => {
  console.debug('[storage] init', items);
  setHeaderVisibility(Boolean(items[HEADER_KEY]));
  setQtipReplacement(Boolean(items.qtipPlaceholder));
});

// Watch for header and q-tip setting changes
chrome.storage.onChanged.addListener((changes, area) => {
  console.debug('[storage] onChanged', changes, area);
  if (area === 'sync') {
    if (changes[HEADER_KEY]) setHeaderVisibility(Boolean(changes[HEADER_KEY].newValue));
    if (changes.qtipPlaceholder) setQtipReplacement(Boolean(changes.qtipPlaceholder.newValue));
  }
});

// ---- Q-tip replacement ----
const QTIP_KEY = 'qtipPlaceholder';
let qtipReplaced = false;
let qtipObserver = null;
const QTIP_SELECTOR = '.qtip.qtip-default.ezy-tooltip';
const QTIP_PLACEHOLDER = '<div class="tzvet-qtip-placeholder" style="padding:6px;color:#374151">(tooltip hidden)</div>';

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
  console.log('[qtip] waiting for ready', el);
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
      console.log('[qtip] timed out waiting for ready, applied fallback', el);
    }
  }, timeout);
  obs._tzvet_timeout = to;
}

function clearAllQtipReadyObservers() {
  for (const [el, o] of qtipReadyObservers.entries()) {
    try {
      if (o && typeof o.disconnect === 'function') o.disconnect();
      if (o && o._tzvet_timeout) clearTimeout(o._tzvet_timeout);
    } catch (e) {}
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
    console.log('[qtip] applied', { replaced: replacedCount, restored: restoredCount, totalFound: items.length }, root === document.body ? 'document' : root);
  } catch (e) {
    console.warn('[qtip] apply error', e);
  }
}

function observeQtipAdditions() {
  if (qtipObserver) return;
  qtipObserver = new MutationObserver((mutations) => {
    console.log('[qtip] mutations', mutations.length);
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n;
            console.log('[qtip] added node', el);
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
        console.log('[qtip] attribute change', m.attributeName, t);
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
  console.log('[qtip] observer started');
}

function disconnectQtipObserver() {
  if (!qtipObserver) return;
  qtipObserver.disconnect();
  qtipObserver = null;
  clearAllQtipReadyObservers();
  console.log('[qtip] observer disconnected');
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

