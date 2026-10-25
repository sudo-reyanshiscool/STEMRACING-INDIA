// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { MemoryApi } from '../../src/api';
import { mediaAssetsScreen } from '../../src/ui/media-assets';
import { makeCtx } from './helpers';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('renders media assets dashboard with metric cards, actions, and team list', async () => {
  const api = new MemoryApi();
  api.setCreatorAllowlist(['org@x.test']);
  await api.signIn('org@x.test');

  const event = await api.createEvent({ name: 'Nationals 2026' });
  const t1 = await api.createTeam(event.id, { number: '01', name: 'Helix Racing' });
  const t2 = await api.createTeam(event.id, { number: '02', name: 'Nova Velocity' });

  // Upload photo for t1
  const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await api.uploadTeamPhoto(event.id, t1.id, 0, {
    name: 'team1.png',
    mime: 'image/png',
    base64: sampleBase64,
    mediaConsent: true,
  });

  const { ctx } = makeCtx(api);
  const screen = await mediaAssetsScreen(ctx, event.id);
  document.body.append(screen);

  // Verify header and description
  expect(screen.textContent).toContain('Team Photography Background Removal');
  expect(screen.textContent).toContain('Background Removal');

  // Verify metric summary cards
  expect(screen.textContent).toContain('Total teams');
  expect(screen.textContent).toContain('Approved for live');
  expect(screen.textContent).toContain('Pending removal');
  expect(screen.textContent).toContain('Failed jobs');

  // Verify batch controls
  const processSelected = screen.querySelector<HTMLButtonElement>('#media-process-selected-btn');
  expect(processSelected).not.toBeNull();
  expect(processSelected?.disabled).toBe(true);

  const processPending = screen.querySelector<HTMLButtonElement>('#media-process-pending-btn');
  expect(processPending).not.toBeNull();

  const downloadAll = screen.querySelector<HTMLButtonElement>('#media-download-zip-btn');
  expect(downloadAll).not.toBeNull();

  const concurrencySelect = screen.querySelector<HTMLSelectElement>('#media-concurrency-select');
  expect(concurrencySelect).not.toBeNull();

  // Verify table rows for both teams
  expect(screen.textContent).toContain('Helix Racing');
  expect(screen.textContent).toContain('Nova Velocity');
  expect(screen.textContent).toContain('No photograph');

  // Verify inspect / compare button exists for t1
  const inspectBtn = screen.querySelector<HTMLButtonElement>(`button[data-inspect-photo="${t1.id}"]`);
  expect(inspectBtn).not.toBeNull();

  // Click inspect to open side-by-side comparison modal
  inspectBtn?.click();
  const modal = document.querySelector('.media-modal-backdrop');
  expect(modal).not.toBeNull();
  expect(modal?.textContent).toContain('Cutout Review');
  expect(modal?.textContent).toContain('Original photograph');
  expect(modal?.textContent).toContain('AI transparent cutout');

  // Clean up modal
  modal?.remove();
});
