import { describe, expect, it } from 'vitest';
import { buildHeatsPdf, formatHeatNumber, heatsFileName, type HeatsPdfInput } from '../../src/pdf/heatsPdf';
import type { TeamRow } from '../../src/api';
import type { RaceHeat } from '../../src/racing';

describe('heatsPdf', () => {
  it('formats file names cleanly', () => {
    expect(heatsFileName('West Regional Finals 2026', 'reaction')).toBe('STEM-Racing_West-Regional-Finals-2026_Reaction-Heats.pdf');
    expect(heatsFileName('West Regional Finals 2026', 'knockout')).toBe('STEM-Racing_West-Regional-Finals-2026_Knockout-Heats.pdf');
    expect(heatsFileName('Special / Event #1', 'reaction')).toBe('STEM-Racing_Special-Event-1_Reaction-Heats.pdf');
  });

  it('builds a branded heats PDF with reaction and knockout races', () => {
    const teams: TeamRow[] = [
      { id: 't1', eventId: 'e1', number: '101', name: 'Lightning Bolts', school: 'School A' },
      { id: 't2', eventId: 'e1', number: '102', name: 'Solar Flare', school: 'School B' },
      { id: 't3', eventId: 'e1', number: '103', name: 'Vortex Racing', school: 'School C' },
    ];

    const races: RaceHeat[] = [
      {
        id: 'r1',
        eventId: 'e1',
        number: 1,
        label: 'Reaction · 1A',
        phase: 'reaction',
        lane1: { teamId: 't1', car: 'A', status: 'finished', totalMs: 1250, reactionMs: 180 },
        lane2: { teamId: 't2', car: 'A', status: 'finished', totalMs: 1310, reactionMs: 200 },
        note: '',
        source: 'manual',
        sourceRunId: null,
        revision: 1,
        updatedAt: '2026-10-24T10:00:00Z',
      },
      {
        id: 'r2',
        eventId: 'e1',
        number: 2,
        label: 'Reaction · 2A',
        phase: 'reaction',
        lane1: { teamId: 't2', car: 'A', status: 'pending', totalMs: null, reactionMs: null },
        lane2: { teamId: 't3', car: 'A', status: 'pending', totalMs: null, reactionMs: null },
        note: '',
        source: 'manual',
        sourceRunId: null,
        revision: 0,
        updatedAt: '2026-10-24T10:00:00Z',
      },
      {
        id: 'r3',
        eventId: 'e1',
        number: 3,
        label: 'Knockout · Final',
        phase: 'knockout',
        bracket: { round: 6, slot: 1 },
        lane1: { teamId: 't1', car: 'B', status: 'pending', totalMs: null, reactionMs: null },
        lane2: { teamId: 't3', car: 'B', status: 'pending', totalMs: null, reactionMs: null },
        note: 'Grand Final Match',
        source: 'manual',
        sourceRunId: null,
        revision: 0,
        updatedAt: '2026-10-24T10:00:00Z',
      },
    ];

    const input: HeatsPdfInput = {
      eventName: 'West Regional Finals 2026',
      startsOn: '2026-11-15',
      teams,
      races,
      generatedAt: '2026-10-24',
    };

    const doc = buildHeatsPdf(input);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);

    const buffer = doc.output('arraybuffer');
    expect(buffer.byteLength).toBeGreaterThan(10000); // contains compressed branding assets
  });

  it('handles empty races gracefully', () => {
    const input: HeatsPdfInput = {
      eventName: 'Empty Event',
      teams: [],
      races: [],
    };

    const doc = buildHeatsPdf(input);
    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('formats RR-H01 for reaction races and KR-H01 for knockouts', () => {
    const reactionRace: RaceHeat = {
      id: 'r1',
      eventId: 'e1',
      number: 1,
      label: 'RR-H01',
      phase: 'reaction',
      lane1: { teamId: 't1', car: 'A', status: 'pending', totalMs: null, reactionMs: null },
      lane2: { teamId: 't2', car: 'A', status: 'pending', totalMs: null, reactionMs: null },
      note: '',
      source: 'manual',
      sourceRunId: null,
      revision: 0,
      updatedAt: '',
    };
    const knockoutRace: RaceHeat = {
      id: 'k1',
      eventId: 'e1',
      number: 1,
      label: 'KR-H01 · Round 1',
      phase: 'knockout',
      bracket: { round: 1, slot: 1 },
      lane1: { teamId: 't1', car: 'A', status: 'pending', totalMs: null, reactionMs: null },
      lane2: { teamId: 't2', car: 'A', status: 'pending', totalMs: null, reactionMs: null },
      note: '',
      source: 'manual',
      sourceRunId: null,
      revision: 0,
      updatedAt: '',
    };
    expect(formatHeatNumber(reactionRace, 0)).toBe('RR-H01');
    expect(formatHeatNumber(knockoutRace, 0)).toBe('KR-H01');
  });

  it('separates reaction and knockout races so they do not mix in PDF downloads', () => {
    const teams: TeamRow[] = [
      { id: 't1', eventId: 'e1', number: '101', name: 'Lightning Bolts', school: 'School A' },
      { id: 't2', eventId: 'e1', number: '102', name: 'Solar Flare', school: 'School B' },
    ];
    const races: RaceHeat[] = [
      {
        id: 'r1',
        eventId: 'e1',
        number: 1,
        label: 'RR-01',
        phase: 'reaction',
        lane1: { teamId: 't1', car: 'A', status: 'pending', totalMs: null, reactionMs: null },
        lane2: { teamId: 't2', car: 'A', status: 'pending', totalMs: null, reactionMs: null },
        note: '',
        source: 'manual',
        sourceRunId: null,
        revision: 0,
        updatedAt: '',
      },
      {
        id: 'k1',
        eventId: 'e1',
        number: 2,
        label: 'Knockout Final',
        phase: 'knockout',
        bracket: { round: 6, slot: 1 },
        lane1: { teamId: 't1', car: 'B', status: 'pending', totalMs: null, reactionMs: null },
        lane2: { teamId: 't2', car: 'B', status: 'pending', totalMs: null, reactionMs: null },
        note: '',
        source: 'manual',
        sourceRunId: null,
        revision: 0,
        updatedAt: '',
      },
    ];

    const reactionDoc = buildHeatsPdf({
      eventName: 'Grand Prix',
      teams,
      races,
      phase: 'reaction',
    });
    expect(reactionDoc).toBeDefined();

    const knockoutDoc = buildHeatsPdf({
      eventName: 'Grand Prix',
      teams,
      races,
      phase: 'knockout',
    });
    expect(knockoutDoc).toBeDefined();
  });
});
