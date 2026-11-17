import { describe, expect, it } from 'vitest';
import { carsExport } from '../../src/api/cars-export';
import type { Inspection } from '../../src/technical';

const event = { id: 'e', name: 'Nationals 2026', startsOn: '2026-11-01' };
const teams = [{ id: 'a', number: '2', name: 'Two', school: 'Second School' }, { id: 'b', number: '10', name: 'Ten', school: '' }];
const at = '2026-11-01T10:00:00.000Z';
const inspection = (over: Partial<Inspection>): Inspection => ({
  id: 'i', eventId: 'e', teamId: 'a', car: 'A', inspectorId: 'inspector-1', status: 'submitted', rulesetId: 'r', measurements: {}, notes: {}, ...over,
} as Inspection);

describe('car measurements export', () => {
  it('lists each inspected car with its size readings, in team-number then car order', () => {
    const out = carsExport({ event, teams, generatedAt: at, inspections: [
      inspection({ id: '3', teamId: 'b', car: 'A', measurements: { 'T3.4': 78.2, 'T3.5': 55, 'T3.6': 50.4, 'T7.3': 130 } }),
      inspection({ id: '2', teamId: 'a', car: 'B', status: 'in_progress', measurements: { 'T3.4': 71.5 } }),
      inspection({ id: '1', teamId: 'a', car: 'A', measurements: { 'T3.4': 70, 'T3.5': 58.5, 'T3.6': true, 'T7.6': { fl: true } } }),
    ] });
    expect(out).toMatchObject({ schemaVersion: 1, kind: 'cars', generatedAt: at, event });
    expect(out.cars).toEqual([
      { team: { id: 'a', number: '2', name: 'Two', school: 'Second School' }, car: 'A', status: 'submitted', widthMm: 70, heightMm: 58.5, weightG: null, wheelbaseMm: null },
      { team: { id: 'a', number: '2', name: 'Two', school: 'Second School' }, car: 'B', status: 'in_progress', widthMm: 71.5, heightMm: null, weightG: null, wheelbaseMm: null },
      { team: { id: 'b', number: '10', name: 'Ten', school: null }, car: 'A', status: 'submitted', widthMm: 78.2, heightMm: 55, weightG: 50.4, wheelbaseMm: 130 },
    ]);
  });

  it('keeps a removed team by its id and never names the inspector', () => {
    const out = carsExport({ event, teams, generatedAt: at, inspections: [inspection({ teamId: 'gone', measurements: { 'T3.4': 66 } })] });
    expect(out.cars[0]!.team).toEqual({ id: 'gone', number: null, name: null, school: null });
    expect(JSON.stringify(out)).not.toContain('inspector-1');
  });
});
