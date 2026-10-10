import { beforeEach, describe, expect, it } from 'vitest';
import { StoreError, openStore, type Store } from '../../src/store';

let store: Store;
beforeEach(async () => {
  store = await openStore(`test-${Math.random().toString(36).slice(2)}`);
});

describe('events and teams', () => {
  it('creates an event with a ruleset and lists it', async () => {
    const e = await store.createEvent({ name: ' Regional round ', date: '2026-11-01', venue: 'Pune' });
    expect(e.name).toBe('Regional round');
    expect(e.rulesetId).toBe('wf26-professional');
    expect((await store.listEvents()).map((x) => x.id)).toEqual([e.id]);
  });

  it('rejects an event with no name', async () => {
    await expect(store.createEvent({ name: '   ', date: '2026-11-01' })).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('creates a team with cars A and B', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    const { team, cars } = await store.createTeam(e.id, { number: '12', name: 'Apex' });
    expect(cars.map((c) => c.label)).toEqual(['A', 'B']);
    expect((await store.carsForTeam(team.id)).map((c) => c.label)).toEqual(['A', 'B']);
    expect((await store.getCar(cars[0].id))?.teamId).toBe(team.id);
  });

  it('rejects a duplicate team number in the same event, ignoring case and spaces', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    await store.createTeam(e.id, { number: 'A12', name: 'One' });
    await expect(store.createTeam(e.id, { number: ' a12 ', name: 'Two' })).rejects.toMatchObject({ code: 'duplicate-team-number' });
    const other = await store.createEvent({ name: 'F', date: '2026-11-02' });
    await expect(store.createTeam(other.id, { number: 'A12', name: 'Two' })).resolves.toBeDefined();
  });

  it('keeps hostile and very long names as plain text, within limits', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    const { team } = await store.createTeam(e.id, { number: '1', name: '<script>alert(1)</script> 🚗 "quoted"' });
    expect(team.name).toBe('<script>alert(1)</script> 🚗 "quoted"');
    await expect(store.createTeam(e.id, { number: '2', name: 'x'.repeat(500) })).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(store.createTeam(e.id, { number: '', name: 'No number' })).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('lists teams in natural number order', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    for (const n of ['10', '2', '1']) await store.createTeam(e.id, { number: n, name: `T${n}` });
    expect((await store.listTeams(e.id)).map((t) => t.number)).toEqual(['1', '2', '10']);
  });

  it('rejects a team for an unknown event', async () => {
    await expect(store.createTeam('nope', { number: '1', name: 'X' })).rejects.toBeInstanceOf(StoreError);
  });
});

describe('inspections', () => {
  it('saves and reads an inspection, stamping updatedAt', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    const { cars } = await store.createTeam(e.id, { number: '1', name: 'A' });
    expect(await store.getInspection(cars[0].id)).toBeUndefined();
    const saved = await store.saveInspection({
      carId: cars[0].id, scrutineer: 'R', startedAt: 1, updatedAt: 1, measurements: { 'T3.6': 46.5 }, notes: {},
    });
    expect(saved.updatedAt).toBeGreaterThan(1);
    expect((await store.getInspection(cars[0].id))?.measurements['T3.6']).toBe(46.5);
  });

  it('drops NaN measurements instead of persisting them', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    const { cars } = await store.createTeam(e.id, { number: '1', name: 'A' });
    await store.saveInspection({
      carId: cars[0].id, scrutineer: '', startedAt: 1, updatedAt: 1,
      measurements: { 'T3.6': NaN, 'T7.4': { FL: NaN, FR: 12 } }, notes: {},
    });
    const back = await store.getInspection(cars[0].id);
    expect(back?.measurements['T3.6']).toBeUndefined();
    expect((back?.measurements['T7.4'] as Record<string, number | undefined>).FL).toBeUndefined();
    expect((back?.measurements['T7.4'] as Record<string, number | undefined>).FR).toBe(12);
  });
});
