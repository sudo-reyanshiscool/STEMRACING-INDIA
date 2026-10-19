import type { NominationRow, TeamRow } from '../api';
import { NOMINATION_AWARDS } from '../rulesets/rubrics';
import { h } from './dom';

/** A judge can nominate in several sections; one award vote per judge and panel counts for the team. */
export function tallyNominations(rows: NominationRow[]) {
  return NOMINATION_AWARDS.map((award) => {
    const teams = new Map<string, { votes: Set<string>; panels: Set<string> }>();
    for (const row of rows.filter((r) => r.nominations.includes(award.id))) {
      const tally = teams.get(row.teamId) ?? { votes: new Set<string>(), panels: new Set<string>() };
      tally.votes.add(`${row.judgeId}:${row.panel}`); tally.panels.add(row.panel); teams.set(row.teamId, tally);
    }
    return { award, teams: [...teams].map(([teamId, t]) => ({ teamId, votes: t.votes.size, panels: t.panels.size }))
      .sort((a, b) => b.votes - a.votes || b.panels - a.panels || a.teamId.localeCompare(b.teamId)) };
  });
}

export function nominationSummary(rows: NominationRow[], teams: TeamRow[]): HTMLElement {
  const tallies = tallyNominations(rows).filter((t) => t.teams.length);
  return h('section', { class: 'section stack' }, h('h2', null, 'Star Quality nominations'),
    h('p', { class: 'small muted' }, 'Submitted cards only. Each judge has one nomination per award, team and panel, even when it appears in several sections. Nominations inform the short list; they do not select winners.'),
    tallies.length ? h('div', { class: 'grid' }, tallies.map(({ award, teams: nominated }) => h('article', { class: 'card stack' },
      h('h3', null, award.name), h('ul', { class: 'list' }, nominated.map((t) => {
        const team = teams.find((team) => team.id === t.teamId);
        return h('li', null, h('strong', null, team ? `Team ${team.number} · ${team.name}` : 'Unknown team'),
          h('span', { class: 'small' }, ` — ${t.votes} nomination${t.votes === 1 ? '' : 's'} across ${t.panels} panel${t.panels === 1 ? '' : 's'}`));
      }))))) : h('p', { class: 'muted' }, 'No award nominations on submitted cards yet.'));
}
