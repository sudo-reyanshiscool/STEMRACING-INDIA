import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeDb, seedWorld, type World } from './harness';

describe('0041_team_photos migration', () => {
  let db: PGlite;
  let world: World;

  beforeAll(async () => {
    db = await makeDb();
    world = await seedWorld(db);
  });

  afterAll(async () => {
    await db.close();
  });

  const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('allows team manager to upload official team photo with consent', async () => {
    const input = {
      name: 'team-photo.png',
      mime: 'image/png',
      base64: samplePngBase64,
      mediaConsent: true,
      width: 3840,
      height: 2160,
    };

    const res = await as(db, 'mgr1', (q) =>
      q('select upload_team_photo($1, $2, $3, $4::jsonb) as res', [
        world.eventId,
        world.team1,
        0,
        JSON.stringify(input),
      ]),
    );

    expect(res.rows[0].res.status).toBe('pending');
    expect(res.rows[0].res.version).toBe(1);

    // Verify metadata row exists in team_photos
    const photos = await as(db, 'mgr1', (q) =>
      q('select * from list_team_photos($1)', [world.eventId]),
    );
    expect(photos.rows).toHaveLength(1);
    expect(photos.rows[0].teamId).toBe(world.team1);
    expect(photos.rows[0].processingStatus).toBe('pending');
    expect(photos.rows[0].approvalStatus).toBe('pending');
    expect(photos.rows[0].mediaConsent).toBe(true);
    expect(photos.rows[0].originalWidth).toBe(3840);
    expect(photos.rows[0].originalHeight).toBe(2160);

    // Verify job queued in photo_processing_jobs
    const jobs = await db.query(
      'select * from photo_processing_jobs where event_id = $1 and team_id = $2',
      [world.eventId, world.team1],
    );
    expect(jobs.rows).toHaveLength(1);
    expect((jobs.rows[0] as any).status).toBe('pending');
  });

  it('rejects uploads without media consent', async () => {
    const input = {
      name: 'team-photo.png',
      mime: 'image/png',
      base64: samplePngBase64,
      mediaConsent: false,
    };

    await expect(
      as(db, 'mgr1', (q) =>
        q('select upload_team_photo($1, $2, $3, $4::jsonb)', [
          world.eventId,
          world.team1,
          1,
          JSON.stringify(input),
        ]),
      ),
    ).rejects.toThrow(/media consent/i);
  });

  it('prevents outsiders from accessing private original photograph', async () => {
    // mgr1 can download original
    const own = await as(db, 'mgr1', (q) =>
      q("select download_team_photo($1, $2, 'original') as res", [world.eventId, world.team1]),
    );
    expect(own.rows[0].res.which).toBe('original');

    // outsider cannot download original
    await expect(
      as(db, 'outsider', (q) =>
        q("select download_team_photo($1, $2, 'original')", [world.eventId, world.team1]),
      ),
    ).rejects.toThrow(/only event staff or your team/i);

    // judgeV cannot download original unedited photo
    await expect(
      as(db, 'judgeV', (q) =>
        q("select download_team_photo($1, $2, 'original')", [world.eventId, world.team1]),
      ),
    ).rejects.toThrow(/only event staff or your team/i);
  });

  it('processes, approves, rejects, overrides, and retrieves broadcast photos', async () => {
    // Organiser lists photos
    const photos = await as(db, 'organiser', (q) =>
      q('select * from list_team_photos($1)', [world.eventId]),
    );
    expect(photos.rows.length).toBeGreaterThanOrEqual(1);

    // Get queued job
    const jobRes = await db.query(
      'select id from photo_processing_jobs where team_id = $1 order by created_at desc limit 1',
      [world.team1],
    );
    const jobId = (jobRes.rows[0] as any).id;

    // Worker completes job
    await as(db, 'organiser', (q) =>
      q('select complete_photo_processing($1, $2, $3, $4)', [
        jobId,
        'completed',
        samplePngBase64,
        null,
      ]),
    );

    // Check status is completed
    const updated = await as(db, 'organiser', (q) =>
      q('select * from list_team_photos($1)', [world.eventId]),
    );
    const p1 = updated.rows.find((r) => r.teamId === world.team1);
    expect(p1.processingStatus).toBe('completed');
    expect(p1.approvalStatus).toBe('pending');

    // Broadcast photo before approval is NOT available
    const bcastBefore = await as(db, 'outsider', (q) =>
      q('select get_broadcast_team_photo($1, $2) as res', [world.eventId, world.team1]),
    );
    expect(bcastBefore.rows[0].res.isApprovedPhoto).toBe(false);
    expect(bcastBefore.rows[0].res.photoBase64).toBeNull();

    // Organiser approves photo
    await as(db, 'organiser', (q) =>
      q("select approve_team_photo($1, $2, 'Excellent sharp cutout')", [
        world.eventId,
        world.team1,
      ]),
    );

    // Broadcast photo is now approved and accessible
    const bcastAfter = await as(db, 'outsider', (q) =>
      q('select get_broadcast_team_photo($1, $2) as res', [world.eventId, world.team1]),
    );
    expect(bcastAfter.rows[0].res.isApprovedPhoto).toBe(true);
    expect(bcastAfter.rows[0].res.photoBase64).toBe(samplePngBase64);

    // Organiser uploads manual corrected PNG
    await as(db, 'organiser', (q) =>
      q('select upload_corrected_team_photo($1, $2, $3::jsonb)', [
        world.eventId,
        world.team1,
        JSON.stringify({ base64: samplePngBase64, notes: 'Photoshop hair feathering' }),
      ]),
    );

    // History contains previous approved version
    const history = await as(db, 'organiser', (q) =>
      q('select * from list_team_photo_history($1, $2)', [world.eventId, world.team1]),
    );
    expect(history.rows.length).toBeGreaterThanOrEqual(1);

    // Restore previous version from history
    await as(db, 'organiser', (q) =>
      q('select restore_team_photo_version($1, $2, $3)', [
        world.eventId,
        world.team1,
        history.rows[0].id,
      ]),
    );

    // Delete photo
    await as(db, 'mgr1', (q) => q('select delete_team_photo($1, $2)', [world.eventId, world.team1]));
    const afterDelete = await as(db, 'organiser', (q) =>
      q('select * from list_team_photos($1)', [world.eventId]),
    );
    expect(afterDelete.rows.find((r) => r.teamId === world.team1)).toBeUndefined();
  });
});
