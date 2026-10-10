import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Measurements } from '../engine';
import { parseBackup, type Backup, type ImportReport } from './backup';
import { newId } from './id';
import { StoreError, type Car, type EventRec, type Inspection, type Team } from './types';

interface Schema extends DBSchema {
  events: { key: string; value: EventRec };
  teams: { key: string; value: Team; indexes: { byEvent: string } };
  cars: { key: string; value: Car; indexes: { byTeam: string } };
  inspections: { key: string; value: Inspection };
}

export interface Store {
  createEvent(i: { name: string; date: string; venue?: string }): Promise<EventRec>;
  listEvents(): Promise<EventRec[]>;
  getEvent(id: string): Promise<EventRec | undefined>;
  createTeam(eventId: string, i: { number: string; name: string; school?: string }): Promise<{ team: Team; cars: [Car, Car] }>;
  listTeams(eventId: string): Promise<Team[]>;
  getTeam(id: string): Promise<Team | undefined>;
  carsForTeam(teamId: string): Promise<Car[]>;
  getCar(id: string): Promise<Car | undefined>;
  getInspection(carId: string): Promise<Inspection | undefined>;
  saveInspection(i: Inspection): Promise<Inspection>;
  exportAll(): Promise<Backup>;
  importAll(raw: unknown): Promise<ImportReport>;
}

const RULESET_ID = 'wf26-professional';
const LIMITS = { event: 120, number: 12, team: 80, school: 120, venue: 120 };

function text(value: string | undefined, label: string, max: number, required: boolean): string {
  const v = (value ?? '').trim();
  if (required && v === '') throw new StoreError('invalid-input', `${label} is required.`);
  if (v.length > max) throw new StoreError('invalid-input', `${label} must be ${max} characters or fewer.`);
  return v;
}

const normNumber = (n: string): string => n.trim().toLowerCase().replace(/\s+/g, '');

/** Drop NaN so an invalid half-typed value is never persisted. */
function sanitise(m: Measurements): Measurements {
  const out: Measurements = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = v;
    } else if (typeof v === 'object' && v !== null) {
      const inner: Record<string, number | boolean | undefined> = {};
      for (const [ik, iv] of Object.entries(v)) {
        if (typeof iv === 'boolean' || (typeof iv === 'number' && Number.isFinite(iv))) inner[ik] = iv;
      }
      out[k] = inner;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

export async function openStore(dbName = 'stem-racing-india-scrutineering'): Promise<Store> {
  const db: IDBPDatabase<Schema> = await openDB<Schema>(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('events', { keyPath: 'id' });
      d.createObjectStore('teams', { keyPath: 'id' }).createIndex('byEvent', 'eventId');
      d.createObjectStore('cars', { keyPath: 'id' }).createIndex('byTeam', 'teamId');
      d.createObjectStore('inspections', { keyPath: 'carId' });
    },
  });

  return {
    async createEvent(i) {
      const rec: EventRec = {
        id: newId(), name: text(i.name, 'Event name', LIMITS.event, true), date: text(i.date, 'Date', 10, true),
        venue: text(i.venue, 'Venue', LIMITS.venue, false), rulesetId: RULESET_ID, createdAt: Date.now(),
      };
      await db.put('events', rec);
      return rec;
    },
    async listEvents() {
      return (await db.getAll('events')).sort((a, b) => b.createdAt - a.createdAt);
    },
    getEvent: (id) => db.get('events', id),

    async createTeam(eventId, i) {
      const number = text(i.number, 'Team number', LIMITS.number, true);
      const name = text(i.name, 'Team name', LIMITS.team, true);
      const school = text(i.school, 'School or club', LIMITS.school, false);
      const tx = db.transaction(['events', 'teams', 'cars'], 'readwrite');
      const fail = (err: StoreError): never => {
        tx.abort();
        tx.done.catch(() => {});
        throw err;
      };
      if (!(await tx.objectStore('events').get(eventId))) fail(new StoreError('not-found', 'That event no longer exists.'));
      const existing = await tx.objectStore('teams').index('byEvent').getAll(eventId);
      if (existing.some((t) => normNumber(t.number) === normNumber(number))) {
        fail(new StoreError('duplicate-team-number', `Team number ${number} is already used in this event.`));
      }
      const team: Team = { id: newId(), eventId, number, name, school, createdAt: Date.now() };
      const cars: [Car, Car] = [
        { id: newId(), teamId: team.id, label: 'A' },
        { id: newId(), teamId: team.id, label: 'B' },
      ];
      await tx.objectStore('teams').put(team);
      await tx.objectStore('cars').put(cars[0]);
      await tx.objectStore('cars').put(cars[1]);
      await tx.done;
      return { team, cars };
    },
    async listTeams(eventId) {
      const teams = await db.getAllFromIndex('teams', 'byEvent', eventId);
      return teams.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    },
    getTeam: (id) => db.get('teams', id),
    async carsForTeam(teamId) {
      return (await db.getAllFromIndex('cars', 'byTeam', teamId)).sort((a, b) => a.label.localeCompare(b.label));
    },
    getCar: (id) => db.get('cars', id),

    getInspection: (carId) => db.get('inspections', carId),
    async saveInspection(i) {
      const prev = await db.get('inspections', i.carId);
      const rec: Inspection = {
        ...i,
        measurements: sanitise(i.measurements),
        updatedAt: Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1, i.updatedAt + 1),
      };
      await db.put('inspections', rec);
      return rec;
    },

    async exportAll() {
      const [events, teams, cars, inspections] = await Promise.all([
        db.getAll('events'), db.getAll('teams'), db.getAll('cars'), db.getAll('inspections'),
      ]);
      return { app: 'stem-racing-india-scrutineering', version: 1, exportedAt: Date.now(), events, teams, cars, inspections };
    },

    async importAll(raw) {
      const b = parseBackup(raw);
      const teamIds = new Set(b.teams.map((t) => t.id));
      const carIds = new Set(b.cars.map((c) => c.id));
      const eventIds = new Set(b.events.map((e) => e.id));
      if (
        b.teams.some((t) => !eventIds.has(t.eventId)) ||
        b.cars.some((c) => !teamIds.has(c.teamId)) ||
        b.inspections.some((i) => !carIds.has(i.carId))
      ) {
        throw new StoreError('invalid-backup', 'Not a valid STEM Racing scrutineering backup: records point at missing parents.');
      }
      const report: ImportReport = { added: { events: 0, teams: 0, cars: 0, inspections: 0 }, updated: 0 };
      const tx = db.transaction(['events', 'teams', 'cars', 'inspections'], 'readwrite');
      for (const e of b.events) if (!(await tx.objectStore('events').get(e.id))) { await tx.objectStore('events').put(e); report.added.events++; }
      for (const t of b.teams) if (!(await tx.objectStore('teams').get(t.id))) { await tx.objectStore('teams').put(t); report.added.teams++; }
      for (const c of b.cars) if (!(await tx.objectStore('cars').get(c.id))) { await tx.objectStore('cars').put(c); report.added.cars++; }
      for (const i of b.inspections) {
        const have = await tx.objectStore('inspections').get(i.carId);
        if (!have) { await tx.objectStore('inspections').put(i); report.added.inspections++; }
        else if (i.updatedAt > have.updatedAt) { await tx.objectStore('inspections').put(i); report.updated++; }
      }
      await tx.done;
      return report;
    },
  };
}
