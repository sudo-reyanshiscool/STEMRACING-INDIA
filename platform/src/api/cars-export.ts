import type { Inspection } from '../technical';
import type { ExportEvent, ExportTeam, TeamRef } from './results-export';

/** The scrutineering readings that describe a car's size, by rule article. */
const ARTICLES = { widthMm: 'T3.4', heightMm: 'T3.5', weightG: 'T3.6', wheelbaseMm: 'T7.3' } as const;

export interface CarsExport {
  schemaVersion: 1; kind: 'cars'; generatedAt: string; event: { id: string; name: string; startsOn: string | null };
  /** One entry per inspected car. A reading not yet taken is null. */
  cars: Array<{
    team: TeamRef; car: 'A' | 'B';
    /** Only a submitted inspection is final; the others can still change. */
    status: Inspection['status'];
    widthMm: number | null; heightMm: number | null; weightG: number | null; wheelbaseMm: number | null;
  }>;
}

const reading = (i: Inspection, article: string): number | null => {
  const v = i.measurements[article];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/**
 * Car dimensions as measured at scrutineering, for analysis graphics: total width, total height, weight and wheelbase.
 * Penalties, pass or fail and the inspector are left out; this file is about the cars' shape, not their compliance.
 */
export function carsExport(input: { event: ExportEvent; inspections: Inspection[]; teams: ExportTeam[]; generatedAt?: string }): CarsExport {
  const ref = (id: string): TeamRef => {
    const t = input.teams.find((team) => team.id === id);
    return { id, number: t?.number ?? null, name: t?.name ?? null, school: t?.school || null };
  };
  const number = (id: string) => input.teams.find((t) => t.id === id)?.number ?? id;
  return {
    schemaVersion: 1, kind: 'cars',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    event: { id: input.event.id, name: input.event.name, startsOn: input.event.startsOn ?? null },
    cars: [...input.inspections]
      .sort((a, b) => number(a.teamId).localeCompare(number(b.teamId), 'en', { numeric: true }) || a.car.localeCompare(b.car))
      .map((i) => ({
        team: ref(i.teamId), car: i.car, status: i.status,
        widthMm: reading(i, ARTICLES.widthMm), heightMm: reading(i, ARTICLES.heightMm),
        weightG: reading(i, ARTICLES.weightG), wheelbaseMm: reading(i, ARTICLES.wheelbaseMm),
      })),
  };
}
