// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { inspectionScreen } from '../../src/ui/inspection';
import { scoringScreen } from '../../src/ui/scoring';
import { EMAILS, makeCtx, world } from './helpers';

describe('inspectionScreen', () => {
  it('renders without throwing when scrutineering judge opens it', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'scrut@x.test', name:'Test Judge',role: 'judge', panel: 'scrutineering',teamId:t1.id });
    await api.signIn('scrut@x.test');
    await api.claimInvitations();

    const { ctx } = makeCtx(api);
    const node = await inspectionScreen(ctx, ev.id, t1.id, 'A');
    expect(node).toBeInstanceOf(HTMLElement);
    expect(node.textContent).toContain('Car A Technical Inspection');
    expect(node.textContent).toContain('Penalty points · Car A');
    expect(node.textContent).toContain('Export PDF');
  });

  it('renders with existing submitted inspection for Car A', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'scrut@x.test', name:'Test Judge',role: 'judge', panel: 'scrutineering',teamId:t1.id });
    await api.signIn('scrut@x.test');
    await api.claimInvitations();

    await api.saveInspection(ev.id, t1.id, 'A', {
      'T2.7': true,
      'T3.1.3': true,
      'T3.1.4': true,
      'T3.3': true,
      'T3.4': 65,
      'T3.9.2': 0,
      'T4.1': true,
      'T4.8': 0.04,
    });
    const insp = await api.getInspection(ev.id, t1.id, 'A');
    await api.submitInspection(insp!.id);

    const { ctx } = makeCtx(api);
    const node = await inspectionScreen(ctx, ev.id, t1.id, 'A');
    expect(node).toBeInstanceOf(HTMLElement);
    expect(node.textContent).toContain('Submitted');
    expect(node.textContent).toContain('Car A Technical Inspection');
  });

  it('renders Car B inspection without throwing', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'scrut@x.test', name:'Test Judge',role: 'judge', panel: 'scrutineering',teamId:t1.id });
    await api.signIn('scrut@x.test');
    await api.claimInvitations();

    const { ctx } = makeCtx(api);
    const node = await inspectionScreen(ctx, ev.id, t1.id, 'B');
    expect(node).toBeInstanceOf(HTMLElement);
    expect(node.textContent).toContain('Car B Technical Inspection');
  });

  it('renders scoringScreen with Car A and Car B inspection links', async () => {
    const { api, ev,t1 } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'scrut@x.test', name:'Test Judge',role: 'judge', panel: 'scrutineering',teamId:t1.id });
    await api.signIn('scrut@x.test');
    await api.claimInvitations();

    const { ctx } = makeCtx(api);
    const node = await scoringScreen(ctx, ev.id);
    expect(node).toBeInstanceOf(HTMLElement);
    expect(node.textContent).toContain('Car A Inspection');
    expect(node.textContent).toContain('Car B Inspection');
  });
});
