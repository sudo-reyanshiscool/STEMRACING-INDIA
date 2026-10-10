import { describe, expect, it } from 'vitest';
import { summarise } from '../../src/engine';
import { WF26 } from '../../src/rules';
import { buildResultSheet, sheetFileName, sheetRows, type SheetInput } from '../../src/pdf/resultSheet';

const input = (m: Record<string, number>, over: Partial<SheetInput> = {}): SheetInput => ({
  eventName: 'Regional round', teamNumber: '12', teamName: 'Apex', school: 'The British School', carLabel: 'A',
  scrutineer: 'R. Gupta', date: '2026-11-01', rulesetName: WF26.name, rulesetIssued: WF26.issued,
  summary: summarise(WF26.rules, m), ...over,
});

describe('sheetRows', () => {
  it('lists every rule with words for status and points only on failures', () => {
    const s = summarise(WF26.rules, { 'T3.6': 46.5, 'T3.4': 70 });
    const rows = sheetRows(s.results);
    expect(rows).toHaveLength(WF26.rules.length);
    const w = rows.find((r) => r[0] === 'T3.6')!;
    expect(w).toEqual(['T3.6', 'Total weight (no cartridge)', 'Fail', 'Performance', '20']);
    expect(rows.find((r) => r[0] === 'T3.4')).toEqual(['T3.4', 'Total width', 'Pass', 'General', '']);
    expect(rows.find((r) => r[0] === 'T3.5')![2]).toBe('To do');
  });
});

describe('sheetFileName', () => {
  it('is safe for hostile, long and non-Latin names', () => {
    const name = sheetFileName({ eventName: '../../etc/<passwd> "x"\n', teamNumber: 'A/12', carLabel: 'B' });
    expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(sheetFileName({ eventName: 'x'.repeat(500), teamNumber: '1', carLabel: 'A' }).length).toBeLessThan(120);
    expect(sheetFileName({ eventName: 'स्टेम रेसिंग', teamNumber: '१', carLabel: 'A' })).toMatch(/^[A-Za-z0-9_.-]+\.pdf$/);
  });
});

describe('buildResultSheet', () => {
  it('produces a multi-page PDF', () => {
    const doc = buildResultSheet(input({ 'T3.6': 46.5, 'T5.1': 17 }));
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it('renders hostile and emoji team names without throwing', () => {
    const doc = buildResultSheet(input({}, { teamName: '<script>alert(1)</script> 🚗 "quoted"', eventName: 'E'.repeat(300), school: '' }));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('works for a car with nothing entered', () => {
    expect(() => buildResultSheet(input({}))).not.toThrow();
  });
});
