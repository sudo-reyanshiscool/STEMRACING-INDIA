import { beforeEach, describe, expect, it } from 'vitest';
import { openStore, parseBackup, type Store } from '../../src/store';

let a: Store;
let b: Store;
beforeEach(async () => {
  a = await openStore(`test-a-${Math.random().toString(36).slice(2)}`);
  b = await openStore(`test-b-${Math.random().toString(36).slice(2)}`);
});

async function seed(s: Store) {
  const e = await s.createEvent({ name: 'E', date: '2026-11-01' });
  const { team, cars } = await s.createTeam(e.id, { number: '1', name: 'Apex' });
  await s.saveInspection({ carId: cars[0].id, scrutineer: 'R', startedAt: 1, updatedAt: 1, measurements: { 'T3.6': 46.5 }, notes: {} });
  return { e, team, cars };
}

describe('backup', () => {
  it('round-trips everything into an empty store', async () => {
    const { cars } = await seed(a);
    const backup = await a.exportAll();
    expect(backup.app).toBe('stem-racing-india-scrutineering');
    expect(backup.version).toBe(1);
    const report = await b.importAll(JSON.parse(JSON.stringify(backup)));
    expect(report.added).toEqual({ events: 1, teams: 1, cars: 2, inspections: 1 });
    expect((await b.getInspection(cars[0].id))?.measurements['T3.6']).toBe(46.5);
  });

  it('is idempotent and keeps the newer inspection when ids collide', async () => {
    const { cars } = await seed(a);
    const backup = JSON.parse(JSON.stringify(await a.exportAll()));
    await b.importAll(backup);
    const again = await b.importAll(backup);
    expect(again.added).toEqual({ events: 0, teams: 0, cars: 0, inspections: 0 });

    backup.inspections[0].updatedAt += 1000;
    backup.inspections[0].measurements['T3.6'] = 50;
    const updated = await b.importAll(backup);
    expect(updated.updated).toBe(1);
    expect((await b.getInspection(cars[0].id))?.measurements['T3.6']).toBe(50);

    backup.inspections[0].updatedAt -= 5000;
    backup.inspections[0].measurements['T3.6'] = 1;
    await b.importAll(backup);
    expect((await b.getInspection(cars[0].id))?.measurements['T3.6']).toBe(50);
  });
});

describe('parseBackup', () => {
  const ok = { app: 'stem-racing-india-scrutineering', version: 1, exportedAt: 1, events: [], teams: [], cars: [], inspections: [] };

  it('accepts a valid empty backup', () => {
    expect(parseBackup(ok).version).toBe(1);
  });

  it('rejects malformed input with a StoreError', () => {
    const bad: unknown[] = [
      null, 'text', 5, [], {}, { ...ok, version: 2 }, { ...ok, app: 'other' }, { ...ok, events: 'x' },
      { ...ok, events: [{ id: 1 }] }, { ...ok, teams: [{ id: 't', eventId: 'e' }] },
      { ...ok, cars: [{ id: 'c', teamId: 't', label: 'Z' }] },
    ];
    for (const raw of bad) {
      expect(() => parseBackup(raw), JSON.stringify(raw)).toThrowError(/backup/i);
    }
  });

  it('does not let __proto__ keys pollute measurements', () => {
    const raw = JSON.parse(
      '{"app":"stem-racing-india-scrutineering","version":1,"exportedAt":1,"events":[],"teams":[],"cars":[],' +
        '"inspections":[{"carId":"c","scrutineer":"","startedAt":1,"updatedAt":1,"notes":{},"measurements":{"__proto__":{"polluted":true},"T3.6":5}}]}',
    );
    const parsed = parseBackup(raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed.inspections[0].measurements)).toEqual(['T3.6']);
  });

  it('refuses an import whose cars point at a missing team, leaving the store untouched', async () => {
    const raw = { ...ok, cars: [{ id: 'c1', teamId: 'ghost', label: 'A' }] };
    await expect(a.importAll(raw)).rejects.toMatchObject({ code: 'invalid-backup' });
    expect(await a.listEvents()).toEqual([]);
  });
});
