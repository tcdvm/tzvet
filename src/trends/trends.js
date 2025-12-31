import '../styles.css';

const statusEl = document.getElementById('status');
const panelsEl = document.getElementById('panels');
const refreshBtn = document.getElementById('refresh');
const patientEl = document.getElementById('patient');

function asDateKey(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(dateKey) {
  if (dateKey === 'Unknown') return 'Unknown';
  const d = new Date(dateKey);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const now = new Date();
  const monthsDiff = Math.abs(now - d) / (1000 * 60 * 60 * 24 * 30.4375);
  const rounded = Math.round(monthsDiff * 10) / 10;
  const unit = rounded === 1 ? 'month' : 'months';
  const when = d <= now ? 'ago' : 'from now';
  return `${label} (~${rounded} ${unit} ${when})`;
}

function sortDateKeys(keys) {
  return [...keys].sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    return a.localeCompare(b);
  });
}

function formatCell(observations) {
  if (!observations || observations.length === 0) return '';
  return observations
    .map((obs) => {
      const parts = [];
      if (obs.valueRaw) parts.push(obs.valueRaw);
      if (obs.qualifier) parts.push(`(${obs.qualifier})`);
      return parts.join(' ');
    })
    .join('; ');
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

function buildPanelTables(observations) {
  const panels = new Map();
  observations.forEach((obs) => {
    if (!obs.panel || !obs.testName) return;
    if (!panels.has(obs.panel)) panels.set(obs.panel, []);
    panels.get(obs.panel).push(obs);
  });

  panelsEl.innerHTML = '';
  if (!panels.size) {
    statusEl.textContent = 'No panel data found.';
    return;
  }

  statusEl.textContent = `Panels found: ${panels.size}`;

  for (const [panelName, panelObs] of panels.entries()) {
    const dateSet = new Set(panelObs.map((o) => asDateKey(o.collectedAt)));
    const dates = sortDateKeys(dateSet);

    const byTest = new Map();
    panelObs.forEach((o) => {
      const testKey = o.testName;
      if (!byTest.has(testKey)) byTest.set(testKey, new Map());
      const dateKey = asDateKey(o.collectedAt);
      if (!byTest.get(testKey).has(dateKey)) byTest.get(testKey).set(dateKey, []);
      byTest.get(testKey).get(dateKey).push(o);
    });

    const section = document.createElement('section');
    section.className = 'card bg-base-200 shadow-sm';

    const header = document.createElement('div');
    header.className = 'card-body';
    header.innerHTML = `<h2 class="card-title text-lg">${panelName}</h2>`;

    const tableWrap = document.createElement('div');
    tableWrap.className = 'overflow-x-auto';

    const table = document.createElement('table');
    table.className = 'table table-zebra w-full text-sm';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const testTh = document.createElement('th');
    testTh.textContent = 'Test';
    headRow.appendChild(testTh);
    dates.forEach((d) => {
      const th = document.createElement('th');
      th.textContent = formatDateLabel(d);
      headRow.appendChild(th);
    });
    const rangeTh = document.createElement('th');
    rangeTh.textContent = 'Ref Range';
    headRow.appendChild(rangeTh);
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const testNames = Array.from(byTest.keys());
    testNames.forEach((testName) => {
      const row = document.createElement('tr');
      const nameTd = document.createElement('td');
      const testObs = panelObs.filter((o) => o.testName === testName);
      const unit = getTestUnit(testObs);
      nameTd.textContent = unit ? `${testName} (${unit})` : testName;
      row.appendChild(nameTd);

      dates.forEach((d) => {
        const td = document.createElement('td');
        const obsList = byTest.get(testName).get(d) || [];
        td.textContent = formatCell(obsList);
        row.appendChild(td);
      });
      const rangeTd = document.createElement('td');
      rangeTd.textContent = getReferenceRange(testObs);
      row.appendChild(rangeTd);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    tableWrap.appendChild(table);
    header.appendChild(tableWrap);
    section.appendChild(header);
    panelsEl.appendChild(section);
  }
}

async function loadFromSession() {
  const params = new URLSearchParams(window.location.search);
  const key = params.get('key') || 'labTrends';
  const data = await chrome.storage.session.get(key);
  const payload = data[key];
  if (!payload || !payload.observations) {
    statusEl.textContent = 'No data found. Extract from the side panel first.';
    panelsEl.innerHTML = '';
    if (patientEl) patientEl.textContent = '';
    return;
  }
  if (patientEl) {
    const animal = payload.patient?.name || 'Unknown';
    const owner = payload.patient?.ownerLastName || 'Unknown';
    patientEl.textContent = `"${animal}" ${owner}`;
  }
  buildPanelTables(payload.observations);
}

refreshBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Refreshing…';
  await loadFromSession();
});

loadFromSession();
