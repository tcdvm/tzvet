export const CANONICAL_PANEL_DISPLAY_NAMES = {
  cbc: 'CBC',
  chemistry: 'Chemistry',
  urinalysis: 'Urinalysis'
};

export const CANONICAL_TEST_DISPLAY_NAMES = {
  wbc: 'WBC',
  rbc: 'RBC',
  mchc: 'MCHC',
  mcv: 'MCV',
  reticulocyte_hemoglobin: 'Reticulocyte Hemoglobin',
  hemoglobin: 'Hemoglobin',
  hematocrit: 'Hematocrit',
  hematocrit_automated: 'Hematocrit (Automated)',
  packed_cell_volume_spun: 'Packed Cell Volume (Spun)',
  platelets: 'Platelets',
  bun: 'BUN',
  bun_creatinine_ratio: 'BUN: Creatinine Ratio',
  creatinine: 'Creatinine',
  glucose: 'Glucose',
  alt: 'Alanine aminotransferase',
  alp: 'Alk Phosphatase',
  phosphorus: 'Phosphorus',
  bilirubin_total: 'Bilirubin, Total'
};

export const DEFAULT_TENANT_ID = 'utcvm';

const sharedSelectors = {
  clinicalContainer: '.rtabdetails.clinical.active',
  animalsContainer: '.rtabdetails.animals.active',
  clinicalNotesContainer: 'div[id^="medicalnotesNotes"]',
  diagnosticsContainer: 'div[id^="diagnosticResultsListTable"]',
  diagnosticResultSelector: 'tr[data-testid="DiagnosticResult"]',
  fallbackNestedTableSelector: 'tr[data-testid="DiagnosticResult"] + tr, table tr + tr table',
  nestedTableSelector: 'table'
};

function normalizePanelLabel(value) {
  return String(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyPanelLine(value) {
  const normalized = normalizePanelLabel(value);
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/^\d{1,2}-\d{1,2}-\d{4}\b/.test(normalized)) return false;
  if (/^\d{1,2}:\d{2}:\d{2}(?:\s*(?:a\.?m\.?|p\.?m\.?))?$/i.test(normalized)) return false;
  if (/^\s*\d+\s+of\s+\d+/i.test(normalized)) return false;
  return true;
}

function extractTamuPanelFromOutcomeLine(lines) {
  const referenceIndex = lines.findIndex((line) => /^Reference:\s*US\d+-DR\d+/i.test(line));
  if (referenceIndex >= 0) {
    for (let i = referenceIndex + 1; i < lines.length; i += 1) {
      const rawLine = String(lines[i] || '').trim();
      if (!rawLine) continue;

      if (/^(?:images?|outcomes?)\b/i.test(rawLine)) break;

      const normalized = normalizePanelLabel(rawLine);
      if (!normalized) continue;
      if (/^lab\b/i.test(normalized)) continue;
      if (/^reference\b/i.test(normalized)) continue;
      if (!isLikelyPanelLine(normalized)) continue;
      console.log(`Extracted potential panel label from outcome line: "${rawLine}" -> "${normalized}"`);
      return normalized;
    }
  }

  return null;
}

const panelAliasGroups = {
  utcvm: [
    {
      canonical: 'cbc',
      display: 'CBC',
      aliases: [
        'cbc',
        'cbc and absolute reticulocyte count',
        'after hours cbc',
        /\bcbc\b/
      ]
    },
    {
      canonical: 'chemistry',
      display: 'Chemistry',
      aliases: [
        'small animal (no canine) panel and electrolytes',
        'canine chemistry panel and electrolytes',
        'canine panel and electrolytes',
        'after hours sa general chemistry panel',
        'chemistry',
        'general chemistry',
        'electrolyte',
        'renal panel',
        /animal\s+.*panel/
      ]
    },
    {
      canonical: 'urinalysis',
      display: 'Urinalysis',
      aliases: [
        'urinalysis',
        'urine analysis'
      ]
    }
  ],
  tamu: [
    {
      canonical: 'cbc',
      display: 'CBC',
      aliases: [
        'cbc',
        'hematology request',
        'hematology',
        'complete blood count',
        'hematology panel',
        'hematology (1)',
        'hematology (2)',
        /cp-hematology/
      ]
    },
    {
      canonical: 'chemistry',
      display: 'Chemistry',
      aliases: [
        'chemistry',
        'chemistry (2)',
        'chem panel',
        'blood chemistry',
        'chem panel',
        'sa-blood glucose, each',
        'sa-blood glucose',
        /cp-chemistry/,
        /mini panel/
      ]
    },
    {
      canonical: 'urinalysis',
      display: 'Urinalysis',
      aliases: [
        'urinalysis',
        'urinalysis (3)',
        'urine analysis',
        'urinalysis panel',
        /cp-urinalysis/
      ]
    }
  ]
};

const testAliasGroups = {
  utcvm: [
    {
      canonical: 'wbc',
      display: 'White Blood Cells',
      aliases: ['white blood cells', (raw, normalized) => normalized === 'wbc' || normalized === 'wbc,' || normalized === 'wbc:']
    },
    {
      canonical: 'rbc',
      display: 'RBC',
      aliases: ['red blood cells', (raw, normalized) => normalized === 'rbc' || normalized === 'rbc,' || normalized === 'rbc:']
    },
    {
      canonical: 'mchc',
      display: 'MCHC',
      aliases: [
        'mchc',
        (raw, normalized) => /mean corpuscular hemoglobin concentration/.test(normalized)
      ]
    },
    {
      canonical: 'mcv',
      display: 'MCV',
      aliases: ['mcv', 'mean corpuscular volume', /\bmcv\b/]
    },
    {
      canonical: 'reticulocyte_hemoglobin',
      display: 'Reticulocyte Hemoglobin',
      aliases: [
        'reticulocyte hemoglobin',
        'retic hemoglobin',
        (raw, normalized) => normalized.includes('reticulocyte') && normalized.includes('hemoglobin')
      ]
    },
    { canonical: 'hemoglobin', display: 'Hemoglobin', aliases: ['hemoglobin', 'hb'] },
    { canonical: 'hematocrit', display: 'Hematocrit', aliases: ['hematocrit', 'hct'] },
    {
      canonical: 'platelets',
      display: 'Platelets',
      aliases: [
        'platelets',
        'platelet count',
        (raw, normalized) => normalized === 'platelets' || normalized === 'platelet count' || normalized === 'plt'
      ]
    },
    {
      canonical: 'bun_creatinine_ratio',
      display: 'BUN: Creatinine Ratio',
      aliases: [
        'bun:creatinine ratio',
        'bun / creatinine ratio',
        'bun to creatinine ratio',
        'bun creatinine ratio',
        (raw, normalized) => {
          return (
            normalized.includes('bun') &&
            normalized.includes('creatinine') &&
            normalized.includes('ratio')
          ) || (
            normalized.includes('bun') &&
            normalized.includes('creat') &&
            normalized.includes('ratio')
          );
        }
      ]
    },
    { canonical: 'bun', display: 'BUN', aliases: ['urea nitrogen (bun)', 'bun', 'urea nitrogen', 'blood urea nitrogen'] },
    { canonical: 'phosphorus', display: 'Phosphorus', aliases: ['phosphorus', 'phosphate'] },
    { canonical: 'bilirubin_total', display: 'Bilirubin, Total', aliases: ['total bilirubin', 'bilirubin total', 'bilirubin'] },
    { canonical: 'alt', display: 'Alanine aminotransferase', aliases: ['alanine aminotransferase', 'alt'] },
    { canonical: 'alp', display: 'Alk Phosphatase', aliases: ['alkaline phosphatase', 'alk phos', 'alp', 'alk-phosphatase'] }
  ],
  tamu: [
    {
      canonical: 'wbc',
      display: 'White Blood Cells',
      aliases: ['white blood cells', (raw, normalized) => normalized === 'wbc' || normalized === 'wbc,' || normalized === 'wbc:']
    },
    {
      canonical: 'rbc',
      display: 'RBC',
      aliases: [
        'red blood cells',
        'red blood cell count',
        (raw, normalized) => normalized === 'rbc' || normalized === 'rbc,' || normalized === 'rbc:'
      ]
    },
    {
      canonical: 'mchc',
      display: 'MCHC',
      aliases: [
        'mchc',
        (raw, normalized) => /mean corpuscular hemoglobin concentration/.test(normalized)
      ]
    },
    {
      canonical: 'mcv',
      display: 'MCV',
      aliases: ['mcv', 'mean corpuscular volume', /\bmcv\b/]
    },
    {
      canonical: 'reticulocyte_hemoglobin',
      display: 'Reticulocyte Hemoglobin',
      aliases: [
        'reticulocyte hemoglobin',
        'retic hemoglobin',
        (raw, normalized) => normalized.includes('reticulocyte') && normalized.includes('hemoglobin')
      ]
    },
    { canonical: 'hemoglobin', display: 'Hemoglobin', aliases: ['hemoglobin', 'hb'] },
    {
      canonical: 'hematocrit_automated',
      display: 'Hematocrit (Automated)',
      aliases: [
        'hematocrit (automated)',
        (raw, normalized) => normalized.includes('hematocrit') && normalized.includes('automated')
      ]
    },
    {
      canonical: 'packed_cell_volume_spun',
      display: 'Packed Cell Volume (Spun)',
      aliases: [
        'packed cell volume',
        'pcv',
        (raw, normalized) => normalized.includes('packed cell volume') && normalized.includes('spun')
      ]
    },
    {
      canonical: 'hematocrit',
      display: 'Hematocrit',
      aliases: ['hematocrit', 'hct']
    },
    {
      canonical: 'platelets',
      display: 'Platelets',
      aliases: ['platelets', 'platelet count', (raw, normalized) => normalized === 'platelets' || normalized === 'platelet count' || normalized === 'plt']
    },
    {
      canonical: 'bun_creatinine_ratio',
      display: 'BUN: Creatinine Ratio',
      aliases: [
        'bun:creatinine ratio',
        'bun / creatinine ratio',
        'bun to creatinine ratio',
        'bun creatinine ratio',
        (raw, normalized) => normalized.includes('bun') && normalized.includes('creatinine') && normalized.includes('ratio')
      ]
    },
    { canonical: 'bun', display: 'BUN', aliases: ['bun', 'urea nitrogen', 'blood urea nitrogen'] },
    { canonical: 'creatinine', display: 'Creatinine', aliases: ['creatinine'] },
    { canonical: 'glucose', display: 'Glucose', aliases: ['glucose', 'blood glucose'] },
    { canonical: 'alt', display: 'Alanine aminotransferase', aliases: ['alanine aminotransferase', 'alt', 'sgpt'] },
    { canonical: 'alp', display: 'Alk Phosphatase', aliases: ['alkaline phosphatase', 'alk phos', 'alp'] },
    { canonical: 'phosphorus', display: 'Phosphorus', aliases: ['phosphorus', 'phosphate'] },
    { canonical: 'bilirubin_total', display: 'Bilirubin, Total', aliases: ['total bilirubin', 'bilirubin total', 'bilirubin'] }
  ]
};

const tenantProfiles = [
  {
    tenant: 'utcvm',
    name: 'UTCVM',
    hostnames: ['utcvm.use1.ezyvet.com'],
    selectors: sharedSelectors,
    panelAliases: panelAliasGroups.utcvm,
    testAliases: testAliasGroups.utcvm,
    parsingOverrides: {
      extractPanelFromLines: null,
      normalizeTestName: null
    }
  },
  {
    tenant: 'tamu',
    name: 'TAMU',
    hostnames: ['tamu.ezyvet.com', 'tamu.use1.ezyvet.com', 'tamu.use2.ezyvet.com'],
    selectors: sharedSelectors,
    panelAliases: panelAliasGroups.tamu,
    testAliases: testAliasGroups.tamu,
    parsingOverrides: {
      extractPanelFromLines: extractTamuPanelFromOutcomeLine,
      normalizeTestName: null
    }
  }
];

export function getTenantProfile(hostname = '') {
  const normalizedHost = String(hostname || '').toLowerCase().trim();
  const normalizedHostWithoutWww = normalizedHost.replace(/^www\./i, '');
  const hostParts = normalizedHostWithoutWww.split('.').filter(Boolean);
  const match = tenantProfiles.find((profile) => profile.hostnames.some((candidate) => {
    const normalizedCandidate = String(candidate || '').toLowerCase().trim();
    if (!normalizedCandidate) return false;
    const candidateParts = normalizedCandidate.split('.').filter(Boolean);
    if (normalizedCandidate === normalizedHost) return true;
    if (normalizedCandidate === normalizedHostWithoutWww) return true;
    if (normalizedHostWithoutWww.endsWith(`.${normalizedCandidate}`)) return true;
    if (candidateParts.length >= 2 && hostParts.length > 1) {
      const candidateFirst = candidateParts[0];
      const candidateDomain = candidateParts.slice(1).join('.');
      if (hostParts.length >= 2 && hostParts[0] === candidateFirst && normalizedHostWithoutWww.endsWith(`.${candidateDomain}`)) {
        return true;
      }
    }
    return false;
  }));
  if (match) return match;
  return tenantProfiles.find((profile) => profile.tenant === DEFAULT_TENANT_ID);
}

export const LATEST_PANEL_ALIASES_BY_TENANT = panelAliasGroups;
export const LATEST_TEST_ALIASES_BY_TENANT = testAliasGroups;
export const TENANT_PROFILES = tenantProfiles;
