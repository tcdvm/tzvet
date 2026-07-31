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
  urine_protein_creatinine_ratio: 'Urine Protein:Creatinine Ratio',
  urine_cortisol_creatinine_ratio: 'Urine Cortisol:Creatinine Ratio',
  urine_creatinine: 'Urine Creatinine',
  urine_microprotein: 'Urine Microprotein',
  glucose: 'Glucose',
  alt: 'Alanine aminotransferase',
  ast: 'Aspartate aminotransferase',
  alp: 'Alk phosphatase',
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

function hasTamuUrinePanelSignals(text) {
  const normalized = normalizePanelLabel(text).toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('urine protein creatinine ratio')
    || normalized.includes('urine protein:creatinine ratio')
    || normalized.includes('urine protein creatinine')
    || normalized.includes('urine microprotein')
    || normalized.includes('urine creatinine')
    || normalized.includes('urine creatine')
    || /\bupc\b/.test(normalized)
  );
}

function extractTamuUrinePanelOverride(lines) {
  const normalizedLines = lines.map((line) => normalizePanelLabel(line));
  const outcomeLines = normalizedLines.filter((line) => /outcome\s*:?\s*$/i.test(line) || /\boutcome\b/i.test(line));
  const forLines = normalizedLines.filter((line) => /^for:\s*/i.test(line));

  if (outcomeLines.some((line) => hasTamuUrinePanelSignals(line))) {
    return 'Urinalysis';
  }

  if (forLines.some((line) => hasTamuUrinePanelSignals(line))) {
    return 'Urinalysis';
  }

  if (normalizedLines.some((line) => /^cp-chemistry-/i.test(line) && hasTamuUrinePanelSignals(line))) {
    return 'Urinalysis';
  }

  return null;
}

function extractTamuPanelFromOutcomeLine(lines) {
  const urineOverride = extractTamuUrinePanelOverride(lines);
  if (urineOverride) return urineOverride;

  const referenceIndex = lines.findIndex((line) => /^Reference:\s*US\d+-DR(?:\d+)?/i.test(line));
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
      canonical: 'urine_protein_creatinine_ratio',
      display: 'Urine Protein:Creatinine Ratio',
      aliases: [
        'urine protein:creatinine ratio',
        'urine protein creatinine ratio',
        'urine protein/creatinine ratio',
        'urine protein to creatinine ratio',
        'urine protein creatinine',
        'upc',
        (raw, normalized) => normalized.includes('urine') && normalized.includes('protein') && normalized.includes('creatinine')
      ]
    },
    {
      canonical: 'urine_creatinine',
      display: 'Urine Creatinine',
      aliases: [
        'urine creatinine',
        (raw, normalized) => normalized.includes('urine') && normalized.includes('creatinine')
      ]
    },
    {
      canonical: 'urine_microprotein',
      display: 'Urine Microprotein',
      aliases: [
        'urine microprotein',
        'microprotein',
        (raw, normalized) => normalized.includes('urine') && normalized.includes('microprotein')
      ]
    },
    {
      canonical: 'urine_protein_creatinine_ratio',
      display: 'Urine Protein:Creatinine Ratio',
      aliases: [
        'urine protein:creatinine ratio',
        'urine protein creatinine ratio',
        'urine protein/creatinine ratio',
        'urine protein to creatinine ratio',
        'upc',
        (raw, normalized) => (
          normalized.includes('urine')
          && normalized.includes('protein')
          && normalized.includes('creatinine')
          && normalized.includes('ratio')
        )
      ]
    },
    {
      canonical: 'urine_cortisol_creatinine_ratio',
      display: 'Urine Cortisol:Creatinine Ratio',
      aliases: [
        'urine cortisol:creatinine ratio',
        'urine cortisol creatinine ratio',
        'urine cortisol/creatinine ratio',
        'urine cortisol to creatinine ratio',
        (raw, normalized) => (
          normalized.includes('urine')
          && normalized.includes('cortisol')
          && normalized.includes('creatinine')
          && normalized.includes('ratio')
        )
      ]
    },
    {
      canonical: 'urine_creatinine',
      display: 'Urine Creatinine',
      aliases: [
        'urine creatinine',
        'urine creatine',
        (raw, normalized, group, ctx, matchContext) => (
          (normalized.includes('urine') && (normalized.includes('creatinine') || normalized.includes('creatine')))
          || (
            matchContext?.panelCanonical === 'urinalysis'
            && /^(creatinine|creatine)$/.test(normalized)
          )
        )
      ]
    },
    {
      canonical: 'urine_microprotein',
      display: 'Urine Microprotein',
      aliases: [
        'urine microprotein',
        'microprotein',
        (raw, normalized, group, ctx, matchContext) => (
          normalized.includes('microprotein')
          && (normalized.includes('urine') || matchContext?.panelCanonical === 'urinalysis')
        )
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
    { canonical: 'alp', display: 'Alk phosphatase', aliases: ['alkaline phosphatase', 'alk phos', 'alp', 'alk-phosphatase'] },
    { canonical: 'ast', display: 'Aspartate aminotransferase', aliases: ['aspartate aminotransferase', 'ast'] },
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
    {
      canonical: 'creatinine',
      display: 'Creatinine',
      aliases: [
        (raw, normalized) => normalized === 'creatinine' || normalized === 'creatine'
      ]
    },
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
