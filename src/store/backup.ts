import type { Measurements, Value } from '../engine';
import { StoreError, type Car, type EventRec, type Inspection, type Team } from './types';

export interface Backup {
  app: 'stem-racing-india-scrutineering';
  version: 1;
  exportedAt: number;
  events: EventRec[];
  teams: Team[];
  cars: Car[];
  inspections: Inspection[];
}

export interface ImportReport {
  added: { events: number; teams: number; cars: number; inspections: number };
  updated: number;
}

const bad = (msg: string): never => {
  throw new StoreError('invalid-backup', `Not a valid STEM Racing scrutineering backup: ${msg}`);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => (typeof v === 'string' ? v : bad(`${what} must be text`));
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : bad(`${what} must be a number`));
const arr = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(`${what} must be a list`));

/** Rebuild a measurement value copying only own, non-prototype keys. */
function cleanValue(v: unknown): Value {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (isObj(v)) {
    const out: Record<string, number | boolean | undefined> = {};
    for (const key of Object.keys(v)) {
      if (key === '__proto__') continue;
      const inner = v[key];
      if (typeof inner === 'number' && Number.isFinite(inner)) out[key] = inner;
      else if (typeof inner === 'boolean') out[key] = inner;
    }
    return out;
  }
  return undefined;
}

function cleanMeasurements(raw: unknown): Measurements {
  if (!isObj(raw)) return bad('measurements must be an object');
  const out: Measurements = {};
  for (const key of Object.keys(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const v = cleanValue(raw[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function cleanNotes(raw: unknown): Record<string, string> {
  if (!isObj(raw)) return bad('notes must be an object');
  const out: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (key === '__proto__') continue;
    if (typeof raw[key] === 'string') out[key] = raw[key] as string;
  }
  return out;
}

export function parseBackup(raw: unknown): Backup {
  if (!isObj(raw)) return bad('expected an object');
  if (raw.app !== 'stem-racing-india-scrutineering') return bad('wrong app marker');
  if (raw.version !== 1) return bad('unsupported version');
  const events = arr(raw.events, 'events').map((e): EventRec => {
    if (!isObj(e)) return bad('event must be an object');
    return {
      id: str(e.id, 'event id'), name: str(e.name, 'event name'), date: str(e.date, 'event date'),
      venue: typeof e.venue === 'string' ? e.venue : '', rulesetId: str(e.rulesetId, 'rulesetId'),
      createdAt: num(e.createdAt, 'event createdAt'),
    };
  });
  const teams = arr(raw.teams, 'teams').map((t): Team => {
    if (!isObj(t)) return bad('team must be an object');
    return {
      id: str(t.id, 'team id'), eventId: str(t.eventId, 'team eventId'), number: str(t.number, 'team number'),
      name: str(t.name, 'team name'), school: typeof t.school === 'string' ? t.school : '',
      createdAt: num(t.createdAt, 'team createdAt'),
    };
  });
  const cars = arr(raw.cars, 'cars').map((c): Car => {
    if (!isObj(c)) return bad('car must be an object');
    const label = c.label;
    if (label !== 'A' && label !== 'B') return bad('car label must be A or B');
    return { id: str(c.id, 'car id'), teamId: str(c.teamId, 'car teamId'), label };
  });
  const inspections = arr(raw.inspections, 'inspections').map((i): Inspection => {
    if (!isObj(i)) return bad('inspection must be an object');
    return {
      carId: str(i.carId, 'inspection carId'), scrutineer: typeof i.scrutineer === 'string' ? i.scrutineer : '',
      startedAt: num(i.startedAt, 'inspection startedAt'), updatedAt: num(i.updatedAt, 'inspection updatedAt'),
      measurements: cleanMeasurements(i.measurements), notes: cleanNotes(i.notes),
    };
  });
  return { app: 'stem-racing-india-scrutineering', version: 1, exportedAt: num(raw.exportedAt, 'exportedAt'), events, teams, cars, inspections };
}
