import { INDIA_2026 } from '../rulesets';
import { MemoryApi, type ShowcaseSeed } from './memory';
import { buildShowcaseExamples } from './showcase-examples';
import type { EventRow } from './types';

/**
 * The demo sign-in: the six-team example event in memory, with no account and no shared backend.
 * Reached from the sign-in screen (see main.ts for when it is offered), or directly:
 *
 *   ?preview=organiser  organiser and Chair (also plain ?preview)
 *   ?preview=judge      the first example judge
 *   ?preview=team       the manager of team 002
 *   ?preview=signed-out the sign-in screen, with the role choices
 */
export const PREVIEW_EVENT_ID = 'design-preview';
const JUDGE = 'judge-1@example.invalid', MANAGER = 'manager@example.invalid';

export async function loadDesignPreview(persona: string): Promise<MemoryApi> {
  const event: EventRow = {
    id: PREVIEW_EVENT_ID, name: 'National Finals 2026-27, Mumbai', startsOn: '2026-10-24',
    ruleset: INDIA_2026, resultsReleased: false,
  };
  let seed: ShowcaseSeed = buildShowcaseExamples(event);
  // The in-memory sign-in names accounts `user:<email>`, so the example judge's records are re-keyed to match.
  const judgeId = seed.roles.find(r => r.email === JUDGE)?.userId;
  if (judgeId) seed = JSON.parse(JSON.stringify(seed).split(`"${judgeId}"`).join(`"user:${JUDGE}"`)) as ShowcaseSeed;
  seed.roles.push({ id: 'preview-manager', eventId: event.id, userId: `user:${MANAGER}`, role: 'team_manager', panel: null, teamId: seed.teams[1].id, email: MANAGER, name: 'Team manager' });
  const api = MemoryApi.forShowcase(seed);
  if (persona !== '' && persona !== 'organiser') await api.signOut();
  if (persona === 'judge') await api.signIn(JUDGE);
  if (persona === 'team') await api.signIn(MANAGER);
  return api;
}
