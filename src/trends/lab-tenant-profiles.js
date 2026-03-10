export const CANONICAL_PANEL_DISPLAY_NAMES = {
  cbc: 'CBC',
  chemistry: 'Chemistry',
  urinalysis: 'Urinalysis'
};

export const CANONICAL_TEST_DISPLAY_NAMES = {
  wbc: 'WBC',
  rbc: 'RBC',
  hemoglobin: 'Hemoglobin',
  hematocrit: 'Hematocrit',
  platelets: 'Platelets',
  bun: 'BUN',
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
        'hematology',
        'complete blood count',
        'hematology panel'
      ]
    },
    {
      canonical: 'chemistry',
      display: 'Chemistry',
      aliases: [
        'chemistry',
        'chem panel',
        'blood chemistry',
        'chem panel'
      ]
    },
    {
      canonical: 'urinalysis',
      display: 'Urinalysis',
      aliases: [
        'urinalysis',
        'urine analysis',
        'urinalysis panel'
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
      aliases: ['red blood cells', (raw, normalized) => normalized === 'rbc' || normalized === 'rbc,' || normalized === 'rbc:']
    },
    { canonical: 'hemoglobin', display: 'Hemoglobin', aliases: ['hemoglobin', 'hb'] },
    { canonical: 'hematocrit', display: 'Hematocrit', aliases: ['hematocrit', 'hct'] },
    {
      canonical: 'platelets',
      display: 'Platelets',
      aliases: ['platelets', 'platelet count', (raw, normalized) => normalized === 'platelets' || normalized === 'platelet count' || normalized === 'plt']
    },
    { canonical: 'bun', display: 'BUN', aliases: ['bun', 'urea nitrogen', 'blood urea nitrogen'] },
    { canonical: 'creatinine', display: 'Creatinine', aliases: ['creatinine', 'creat'] },
    { canonical: 'glucose', display: 'Glucose', aliases: ['glucose', 'blood glucose', 'glu'] },
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
      normalizePanelName: null,
      normalizeTestName: null
    }
  },
  {
    tenant: 'tamu',
    name: 'TAMU',
    hostnames: ['tamu.ezyvet.com'],
    selectors: sharedSelectors,
    panelAliases: panelAliasGroups.tamu,
    testAliases: testAliasGroups.tamu,
    parsingOverrides: {
      normalizePanelName: null,
      normalizeTestName: null
    }
  }
];

export function getTenantProfile(hostname = '') {
  const normalizedHost = String(hostname || '').toLowerCase();
  const match = tenantProfiles.find((profile) => profile.hostnames.some((candidate) => candidate === normalizedHost));
  if (match) return match;
  return tenantProfiles.find((profile) => profile.tenant === DEFAULT_TENANT_ID);
}

export const LATEST_PANEL_ALIASES_BY_TENANT = panelAliasGroups;
export const LATEST_TEST_ALIASES_BY_TENANT = testAliasGroups;
export const TENANT_PROFILES = tenantProfiles;
