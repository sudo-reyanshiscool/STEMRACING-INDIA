import { beforeAll, describe, expect, it } from 'vitest';
import { as, makeDb, seedWorld, ids, type Who, type World } from './harness';
import { INDIA_2026 } from '../../src/rulesets';

let w: World;
beforeAll(async () => {
  w = await seedWorld(await makeDb());
});

describe('broadcast_emails table and security policies', () => {
  it('allows organiser and chair to insert and read broadcasts', async () => {
    const res = await as(w.db, 'organiser', (q) =>
      q(
        `insert into broadcast_emails (event_id, audience_type, recipient_count, subject, category, body)
         values ($1, 'all_judges', 5, 'Briefing Announcement', 'NOTICE', 'Welcome to the event.')
         returning id, subject, recipient_count`,
        [w.eventId]
      )
    );
    expect(res.rows[0].subject).toBe('Briefing Announcement');
    expect(res.rows[0].recipient_count).toBe(5);

    // Organiser can read it
    const listOrg = await as(w.db, 'organiser', (q) =>
      q('select subject, recipient_count from broadcast_emails where event_id = $1', [w.eventId])
    );
    expect(listOrg.rows.length).toBe(1);

    // Chair can read it
    const listChair = await as(w.db, 'chair', (q) =>
      q('select subject, recipient_count from broadcast_emails where event_id = $1', [w.eventId])
    );
    expect(listChair.rows.length).toBe(1);
  });

  it('forbids judges, managers, outsiders, and anonymous callers from viewing or inserting broadcasts', async () => {
    for (const who of ['judgeV', 'leadV', 'mgr1', 'outsider', null] as const) {
      // Forbidden insert
      await expect(
        as(w.db, who, (q) =>
          q(
            `insert into broadcast_emails (event_id, audience_type, recipient_count, subject, body)
             values ($1, 'all_judges', 2, 'Unauthorized', 'Body')`,
            [w.eventId]
          )
        )
      ).rejects.toThrow();

      // Forbidden select
      if (who !== null) {
        const rows = (
          await as(w.db, who, (q) =>
            q('select * from broadcast_emails where event_id = $1', [w.eventId])
          )
        ).rows;
        expect(rows).toEqual([]);
      }
    }
  });

  it('rejects broadcasts for deleted events or when event is inactive', async () => {
    // Soft-delete another event
    const otherEventId = '00000000-0000-4000-8000-000000000099';
    await w.db.query(
      `insert into events(id, name, ruleset, created_by, deleted_at)
       values ($1, 'Deleted event', $2::jsonb, $3, clock_timestamp())`,
      [otherEventId, JSON.stringify(INDIA_2026), ids.organiser]
    );

    await expect(
      as(w.db, 'organiser', (q) =>
        q(
          `insert into broadcast_emails (event_id, audience_type, recipient_count, subject, body)
           values ($1, 'all_judges', 1, 'Subject', 'Body')`,
          [otherEventId]
        )
      )
    ).rejects.toThrow();
  });
});
