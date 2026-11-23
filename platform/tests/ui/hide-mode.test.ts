// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MemoryApi, OWNER_EMAIL } from '../../src/api/memory';
import { SHOWCASE_EVENT_ID } from '../../src/api/showcase';
import { INDIA_2026 } from '../../src/rulesets';
import type { EventRow } from '../../src/api';
import { securityScreen } from '../../src/ui/security';
import { eventsScreen } from '../../src/ui/events';
import { makeCtx, text } from './helpers';

const testEvent: EventRow = { id: SHOWCASE_EVENT_ID, name: 'Test Event', startsOn: '2026-12-01', ruleset: INDIA_2026, resultsReleased: false };
const otherEvent: EventRow = { id: 'other-event', name: 'Mumbai Regionals 1 2027', startsOn: '2027-01-10', ruleset: INDIA_2026, resultsReleased: false };
const flush = () => new Promise((r) => setTimeout(r, 0));

async function owner() {
  const api = new MemoryApi();
  await api.signIn(OWNER_EMAIL);
  vi.spyOn(api, 'listEvents').mockResolvedValue([otherEvent, testEvent]);
  return api;
}

describe('owner hide mode', () => {
  it('is offered on Account Security to the owner only', async () => {
    const api = await owner();
    const el = await securityScreen(makeCtx(api).ctx);
    expect(text(el)).toContain('Hide mode');
    const other = new MemoryApi();
    await other.signIn('someone@x.test');
    expect(text(await securityScreen(makeCtx(other).ctx))).not.toContain('Hide mode');
    await expect(other.setOwnerHideMode(true)).rejects.toThrow();
    expect(await other.getOwnerHideMode()).toBe(false);
  });

  it('turns on from the switch and leaves only the Test Event on the events page', async () => {
    const api = await owner();
    expect(text(await eventsScreen(makeCtx(api).ctx))).toContain('Mumbai Regionals 1 2027');
    const { ctx } = makeCtx(api);
    const el = await securityScreen(ctx);
    [...el.querySelectorAll('button')].find(b => b.textContent === 'Turn hide mode on')!.click();
    await flush();
    expect(await api.getOwnerHideMode()).toBe(true);
    expect(ctx.rerender).toHaveBeenCalled();

    const events = await eventsScreen(makeCtx(api).ctx);
    expect(events.querySelector(`a[href="#/event/${SHOWCASE_EVENT_ID}"]`)).not.toBeNull();
    expect(text(events)).not.toContain('Mumbai Regionals 1 2027');
    expect(text(events)).not.toContain('Platform Admin');
    expect(events.querySelector('input[name=name]')).toBeNull();

    await api.setOwnerHideMode(false);
    expect(text(await eventsScreen(makeCtx(api).ctx))).toContain('Mumbai Regionals 1 2027');
  });
});
