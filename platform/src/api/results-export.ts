import type { Ruleset } from '../engine';
import { NOMINATION_AWARDS } from '../rulesets/rubrics';
import type { EventAward } from './result-mail';
import type { NominationRow } from './review';
import type { SnapshotRow } from './types';

/** Plain shapes so the exports can be built from Api rows or from test fixtures alike. */
export interface ExportEvent { id: string; name: string; startsOn?: string | null }
export interface ExportTeam { id: string; number: string; name: string; school?: string | null }
export interface TeamRef { id: string; number: string | null; name: string | null; school: string | null }

const head = (event: ExportEvent, generatedAt?: string) => ({
  generatedAt: generatedAt ?? new Date().toISOString(),
  event: { id: event.id, name: event.name, startsOn: event.startsOn ?? null },
});

/** A team removed since the record was made keeps its id; its details are simply unknown. */
function teamRef(teams: ExportTeam[], id: string, fallback?: { number: string; name: string }): TeamRef {
  const t = teams.find((team) => team.id === id);
  return { id, number: t?.number ?? fallback?.number ?? null, name: t?.name ?? fallback?.name ?? null, school: t?.school || null };
}

export interface ResultsExport {
  schemaVersion: 1; kind: 'results'; generatedAt: string; event: { id: string; name: string; startsOn: string | null };
  /** Whether the event's results are released to teams and the public. A snapshot can be exported before that. */
  released: boolean;
  snapshot: { id: string; createdAt: string; rulesetId: string };
  areas: Array<{ id: string; name: string; max: number }>;
  categories: Array<{ id: string; name: string }>;
  standings: Array<{
    rank: number; tied: boolean; team: TeamRef; total: number; subtotal: number; penalties: number; judgedComplete: boolean;
    areas: Record<string, number | null>; categories: Record<string, number>;
  }>;
}

/** The ranking snapshot exactly as taken: one row per team, in rank order, with every area and category score. */
export function resultsExport(input: { event: ExportEvent; released: boolean; ruleset: Ruleset; snapshot: SnapshotRow; teams: ExportTeam[]; generatedAt?: string }): ResultsExport {
  const { snapshot, ruleset } = input;
  return {
    schemaVersion: 1, kind: 'results', ...head(input.event, input.generatedAt),
    released: input.released,
    snapshot: { id: snapshot.id, createdAt: snapshot.createdAt, rulesetId: snapshot.rulesetId },
    areas: ruleset.areas.map((a) => ({ id: a.id, name: a.name, max: a.max })),
    categories: ruleset.categories.map((c) => ({ id: c.id, name: c.name })),
    standings: [...snapshot.rows].sort((a, b) => a.rank - b.rank || a.number.localeCompare(b.number, 'en', { numeric: true })).map((r) => ({
      rank: r.rank, tied: r.tied, team: teamRef(input.teams, r.teamId, r), total: r.total, subtotal: r.subtotal, penalties: r.penalties,
      judgedComplete: r.judgedComplete, areas: { ...r.areas }, categories: { ...r.categories },
    })),
  };
}

export interface AwardsExport {
  schemaVersion: 1; kind: 'awards'; generatedAt: string; event: { id: string; name: string; startsOn: string | null };
  /** False while the organisers can still change the winners. */
  confirmed: boolean;
  awards: Array<{ id: string; title: string; team: TeamRef }>;
}

/** The award winners entered on the results page, in title order. */
export function awardsExport(input: { event: ExportEvent; awards: EventAward[]; confirmed: boolean; teams: ExportTeam[]; generatedAt?: string }): AwardsExport {
  return {
    schemaVersion: 1, kind: 'awards', ...head(input.event, input.generatedAt), confirmed: input.confirmed,
    awards: [...input.awards].sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id))
      .map((a) => ({ id: a.id, title: a.title, team: teamRef(input.teams, a.teamId) })),
  };
}

export interface NominationsExport {
  schemaVersion: 1; kind: 'nominations'; generatedAt: string; event: { id: string; name: string; startsOn: string | null };
  awards: Array<{ id: string; name: string; nominees: Array<{ team: TeamRef; nominations: number; panels: string[] }> }>;
}

/**
 * Award nominations from submitted cards, most nominated first. A judge counts once per award, team and panel, however
 * many sections of the card carry the nomination. Judges are not named: the short list is about teams.
 */
export function nominationsExport(input: { event: ExportEvent; rows: NominationRow[]; teams: ExportTeam[]; generatedAt?: string }): NominationsExport {
  return {
    schemaVersion: 1, kind: 'nominations', ...head(input.event, input.generatedAt),
    awards: NOMINATION_AWARDS.map((award) => {
      const byTeam = new Map<string, { votes: Set<string>; panels: Set<string> }>();
      for (const row of input.rows) {
        if (!row.nominations.includes(award.id)) continue;
        const tally = byTeam.get(row.teamId) ?? { votes: new Set<string>(), panels: new Set<string>() };
        tally.votes.add(`${row.judgeId}:${row.panel}`); tally.panels.add(row.panel); byTeam.set(row.teamId, tally);
      }
      return {
        id: award.id, name: award.name,
        nominees: [...byTeam].map(([teamId, t]) => ({ team: teamRef(input.teams, teamId), nominations: t.votes.size, panels: [...t.panels].sort() }))
          .sort((a, b) => b.nominations - a.nominations || b.panels.length - a.panels.length || a.team.id.localeCompare(b.team.id)),
      };
    }),
  };
}
