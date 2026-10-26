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

it('completes the real queued job and saves the processor result instead of using a team ID',async()=>{
 const api=new MemoryApi();api.setCreatorAllowlist(['org@x.test']);await api.signIn('org@x.test');const event=await api.createEvent({name:'Event'}),team=await api.createTeam(event.id,{number:'1',name:'Apex'});
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
 await api.uploadTeamPhoto(event.id,team.id,0,{name:'team.png',mime:'image/png',base64,mediaConsent:true});
 const complete=vi.spyOn(api,'completePhotoProcessing');vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({base64,width:1,height:1})}));
 const {ctx}=makeCtx(api),screen=await mediaAssetsScreen(ctx,event.id);document.body.append(screen);
 (screen.querySelector('#media-process-pending-btn') as HTMLButtonElement).click();
 await vi.waitFor(async()=>expect((await api.listTeamPhotos(event.id))[0].processingStatus).toBe('completed'));
 expect(complete.mock.calls[0][0]).not.toBe(team.id);expect((await api.downloadTeamPhoto(event.id,team.id,'processed')).base64).toBe(base64);
 vi.unstubAllGlobals();
});

it('marks processing failed and preserves the original when the worker is unavailable',async()=>{
 const api=new MemoryApi();api.setCreatorAllowlist(['org@x.test']);await api.signIn('org@x.test');const event=await api.createEvent({name:'Event'}),team=await api.createTeam(event.id,{number:'1',name:'Apex'});
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
 await api.uploadTeamPhoto(event.id,team.id,0,{name:'team.png',mime:'image/png',base64,mediaConsent:true});vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
 const {ctx}=makeCtx(api),screen=await mediaAssetsScreen(ctx,event.id);document.body.append(screen);(screen.querySelector('#media-process-pending-btn') as HTMLButtonElement).click();
 await vi.waitFor(async()=>expect((await api.listTeamPhotos(event.id))[0].processingStatus).toBe('failed'));
 expect((await api.downloadTeamPhoto(event.id,team.id,'original')).base64).toBe(base64);await expect(api.downloadTeamPhoto(event.id,team.id,'processed')).rejects.toBeDefined();vi.unstubAllGlobals();
});
