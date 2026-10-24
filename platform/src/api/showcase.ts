import { MemoryApi } from './memory';
import { ApiError, type Api, type EventRow, type RoleRow } from './types';
import { buildShowcaseExamples } from './showcase-examples';

// This feature belongs to the existing synthetic Test Event only.
export const SHOWCASE_EVENT_ID = '35af7519-5aa5-43f3-a89a-0f7efe01a57e';

export function canShowcase(event: EventRow, roles: RoleRow[]): boolean {
  return event.id === SHOWCASE_EVENT_ID && roles.some(r => r.role === 'organiser' || r.role === 'chair');
}

export function showcaseHref(eventId: string, examples = false): string {
  return `?showcase=${encodeURIComponent(eventId)}${examples ? '&examples=6' : ''}#/event/${encodeURIComponent(eventId)}`;
}

export function exitShowcaseHref(pathname = '/'): string {
  return `${pathname}#/event/${SHOWCASE_EVENT_ID}`;
}

/** All shared-backend calls are reads; the returned API cannot reach that backend. */
export async function loadShowcase(source: Api, eventId: string, examples = false): Promise<MemoryApi> {
  if (eventId !== SHOWCASE_EVENT_ID) throw new ApiError('forbidden', 'Showcase is available for Test Event only.');
  const session = await source.getSession();
  if (!session) throw new ApiError('unauthenticated', 'Sign in before opening the showcase.');
  const mfa = await source.getMfaStatus();
  if (mfa.nextLevel === 'aal2' && mfa.currentLevel !== 'aal2') throw new ApiError('unauthenticated', 'Complete two-factor sign-in before opening the showcase.');
  const [event, roles] = await Promise.all([source.getEvent(eventId), source.myRoles(eventId)]);
  if (!event || !canShowcase(event, roles)) throw new ApiError('forbidden', 'Only Test Event organisers and the Chair can open this showcase.');
  if (examples) return MemoryApi.forShowcase(buildShowcaseExamples(event));
  const [teams, allRoles, invitations, cards, feedback, nominations, conflicts, exemptions, overrides, penalties,
    inspections, races, racingSetup, broadcasts, contacts, mail, snapshot] = await Promise.all([
    source.listTeams(eventId), source.listRoles(eventId), source.listInvitations(eventId), source.listCards(eventId),
    source.listFeedback(eventId), source.listNominations(eventId), source.listConflicts(eventId), source.listJudgeExemptions(eventId),
    source.listOverrides(eventId), source.listPenalties(eventId), source.listInspections(eventId), source.listRaces(eventId),
    source.getRacingSetup(eventId), source.listBroadcasts(eventId), source.listTeamContacts(eventId), source.resultMailState(eventId), source.latestSnapshot(eventId),
  ]);
  if (!snapshot) throw new ApiError('locked', 'Publish a ranking in Test Event before opening the showcase.');
  const snapshotInputs = await source.getSnapshotInputs(snapshot.id);
  if ((await source.getSession())?.userId !== session.userId) throw new ApiError('unauthenticated', 'The signed-in account changed. Open the showcase again.');
  return MemoryApi.forShowcase({event, teams, roles: allRoles, invitations, cards, feedback, nominations, conflicts,
    exemptions, overrides, penalties, inspections, races, racingSetup, broadcasts, contacts, mail, snapshot, snapshotInputs});
}
