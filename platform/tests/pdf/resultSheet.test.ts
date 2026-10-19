// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildResultSheet, sheetFileName, sheetRows } from '../../src/pdf/resultSheet';
import { INDIA_TECHNICAL, summarise } from '../../src/technical';

describe('resultSheet PDF export', () => {
  it('generates expected filename', () => {
    const fn = sheetFileName({
      eventName: 'Nationals 2026',
      teamNumber: '001',
      carLabel: 'A',
    });
    expect(fn).toBe('STEM-Racing-Scrutineering_Nationals-2026_Team-001_Car-A.pdf');
  });

  it('formats sheetRows with status and class', () => {
    const s = summarise(INDIA_TECHNICAL.rules, {
      'T2.7': true,
      'T3.4': 65,
      'T3.6': 48, // Fail (min is 50.0)
    });
    const rows = sheetRows(s.results);
    expect(rows.length).toBeGreaterThan(0);
    const t36 = rows.find((r) => r[0] === 'T3.6');
    expect(t36).toBeDefined();
    expect(t36![2]).toBe('Fail');
    expect(t36![3]).toBe('Performance');
    expect(Number(t36![4])).toBeGreaterThan(0);
  });

  it('buildResultSheet returns a valid jsPDF document with multiple pages', () => {
    const s = summarise(INDIA_TECHNICAL.rules, {
      'T2.7': true,
      'T3.1.3': true,
      'T3.4': 65,
    });
    const doc = buildResultSheet({
      eventName: 'Nationals 2026',
      teamNumber: '001',
      teamName: 'SUPERCHARGED',
      school: 'Delhi Public School',
      carLabel: 'A',
      scrutineer: 'wanderlust.wired@gmail.com',
      date: '2026-10-19',
      rulesetName: INDIA_TECHNICAL.name,
      rulesetIssued: INDIA_TECHNICAL.issued,
      summary: s,
    });
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
