import {watchGuide} from '../guide-helper';
import { describe, expect, it } from 'vitest';
import { MemoryApi } from '../../src/api';
import { extractDimensions, checkResolution } from '../../src/api/team-photos';

describe('team photos memory backend', () => {
  // Sample PNG with 3840 x 2160 in IHDR
  const samplePngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR header
    0x00, 0x00, 0x0f, 0x00, // width: 3840
    0x00, 0x00, 0x08, 0x70, // height: 2160
    0x08, 0x06, 0x00, 0x00, 0x00, 0x5d, 0x5b, 0x76, 0x4f
  ]);
  const sampleBase64 = btoa(String.fromCharCode(...samplePngBytes));
  const cutoutBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('validates dimension checking and PNG header parsing', () => {
    const dims = extractDimensions(samplePngBytes);
    expect(dims).toEqual({ width: 3840, height: 2160 });
    const check = checkResolution(dims!.width, dims!.height);
    expect(check.isRecommended).toBe(true);
    expect(check.warning).toBeUndefined();

    const lowResCheck = checkResolution(1920, 1080);
    expect(lowResCheck.isRecommended).toBe(false);
    expect(lowResCheck.warning).toContain('3840 \u00D7 2160');
  });

  it('handles the full upload, processing, approval and broadcast lifecycle', async () => {
    const api = new MemoryApi();
    api.setCreatorAllowlist(['org@x.test']);
    await api.signIn('org@x.test');

    const event = await api.createEvent({ name: 'Nationals 2026' });
    const team = await api.createTeam(event.id, { number: '01', name: 'Apex Racing', school: 'Apex Academy' });

    // Initial broadcast photo should fallback to logo since no photo is uploaded
    const initialBroadcast = await api.getBroadcastTeamPhoto(event.id, team.id);
    expect(initialBroadcast.isApprovedPhoto).toBe(false);
    expect(initialBroadcast.photoBase64).toBeNull();
    expect(initialBroadcast.logoBase64).toBeNull();

    // Invite manager
    await api.invite(event.id, { email: 'mgr@x.test', role: 'team_manager', teamId: team.id });
    await api.signIn('mgr@x.test');
    await api.claimInvitations();

    // Upload requires media consent
    await watchGuide(api, event.id);
    await expect(api.uploadTeamPhoto(event.id, team.id, 0, {
      name: 'team.png',
      mime: 'image/png',
      base64: sampleBase64,
      mediaConsent: false,
    })).rejects.toMatchObject({ code: 'invalid' });

    // Valid upload by manager
    const uploadRes = await api.uploadTeamPhoto(event.id, team.id, 0, {
      name: 'team.png',
      mime: 'image/png',
      base64: sampleBase64,
      mediaConsent: true,
    });

    expect(uploadRes.status).toBe('pending');
    expect(uploadRes.version).toBe(1);

    // List photos as organiser
    await api.signIn('org@x.test');
    const photos = await api.listTeamPhotos(event.id);
    expect(photos).toHaveLength(1);
    expect(photos[0].teamId).toBe(team.id);

    // Spectator / Judge cannot download original photo (privacy & consent protection)
    await api.signIn('judge@x.test');
    await expect(api.downloadTeamPhoto(event.id, team.id, 'original')).rejects.toMatchObject({ code: 'forbidden' });

    // Organiser queues and completes processing
    await api.signIn('org@x.test');
    const { jobId } = await api.queuePhotoProcessing(event.id, team.id);
    expect(jobId).toBeTruthy();

    await api.completePhotoProcessing(jobId, 'completed', cutoutBase64);
    const [completed] = await api.listTeamPhotos(event.id);
    expect(completed.processingStatus).toBe('completed');
    expect(completed.approvalStatus).toBe('pending');

    // Broadcast photo still not approved yet
    const preApproveBroadcast = await api.getBroadcastTeamPhoto(event.id, team.id);
    expect(preApproveBroadcast.isApprovedPhoto).toBe(false);

    // Organiser approves cutout
    await api.approveTeamPhoto(event.id, team.id);
    const [approved] = await api.listTeamPhotos(event.id);
    expect(approved.approvalStatus).toBe('approved');

    // Broadcast photo now returns the approved cutout!
    const broadcastPhoto = await api.getBroadcastTeamPhoto(event.id, team.id);
    expect(broadcastPhoto.isApprovedPhoto).toBe(true);
    expect(broadcastPhoto.photoBase64).toBeTruthy();

    // Organiser rejects photo
    await api.rejectTeamPhoto(event.id, team.id, 'Artifact on left shoulder');
    const [rejected] = await api.listTeamPhotos(event.id);
    expect(rejected.approvalStatus).toBe('rejected');

    // Organiser uploads manually corrected PNG
    await api.uploadCorrectedTeamPhoto(event.id, team.id, {
      base64: cutoutBase64,
      notes: 'manual correction',
    });
    const [corrected] = await api.listTeamPhotos(event.id);
    expect(corrected.approvalStatus).toBe('approved');

    // Verify history exists
    const history = await api.listTeamPhotoHistory(event.id, team.id);
    expect(history.length).toBeGreaterThanOrEqual(1);

    // Restore earlier version
    await api.restoreTeamPhotoVersion(event.id, team.id, history[0].id);
    const [restored] = await api.listTeamPhotos(event.id);
    expect(restored.approvalStatus).toBe('approved');

    // Delete photo
    await api.deleteTeamPhoto(event.id, team.id);
    const remaining = await api.listTeamPhotos(event.id);
    expect(remaining).toHaveLength(0);
  });
});
