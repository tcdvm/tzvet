import assert from 'node:assert/strict';
import { parseRowTextForTest } from '../src/trends/extract-lab-trends.js';

const cases = [
  {
    name: 'Chemistry panel name',
    rowText: [
      '09-10-2024 12:34:56pm',
      'Reference: ABC-123',
      'Chemistry Panel'
    ].join('\n'),
    match: /Chemistry/i
  },
  {
    name: 'CBC panel name',
    rowText: [
      '11-02-2024 08:15:00am',
      'Reference: XYZ-456',
      'CBC w/ Diff'
    ].join('\n'),
    match: /\bCBC\b/i
  }
];

for (const t of cases) {
  const parsed = parseRowTextForTest(t.rowText);
  assert.ok(parsed.panel, `${t.name}: panel was not found`);
  assert.ok(t.match.test(parsed.panel), `${t.name}: panel did not match`);
}

console.log('extract-lab-trends tests passed');
