import { beforeAll, describe, expect, it } from 'vitest';
import { INDIA_2026 } from '../../src/rulesets';
import { as, denied, ids, makeDb, seedWorld, type World } from './harness';

let w: World;
beforeAll(async () => {
  w = await seedWorld(await makeDb());
});

// Runs as `invitee`: the creator becomes organiser of the new event, so using `outsider` would make
// them a legitimate reader of that event's audit log and defeat the audit-visibility test below.
describe('create_event', () => {
  it('creates the event, makes the caller its organiser and audits it', async () => {
    const ev = await as(w.db, 'invitee', async (q) =>
      (await q('select * from create_event($1, $2, $3::jsonb)', ['Nationals', '2026-11-01', JSON.stringify(INDIA_2026)])).rows[0]);
    expect(ev.name).toBe('Nationals');
    expect(ev.results_released).toBe(false);
    const roles = await as(w.db, 'invitee', async (q) => (await q('select role from event_roles where event_id = $1', [ev.id])).rows);
    expect(roles).toEqual([{ role: 'organiser' }]);
    const audit = await as(w.db, 'invitee', async (q) => (await q('select entity, action from audit_log where event_id = $1', [ev.id])).rows);
    expect(audit).toContainEqual({ entity: 'event_roles', action: 'insert' });
  });

  it('needs a signed-in user and a ruleset with areas', async () => {
    await expect(as(w.db, null, (q) => q(`select * from create_event('x', null, '{"areas":[]}'::jsonb)`))).rejects.toThrow(/permission denied/);
    await expect(as(w.db, 'judgeV', (q) => q(`select * from create_event('x', null, '{}'::jsonb)`))).rejects.toThrow();
  });
});

describe('events', () => {
  it('shows an event only to its members until results are released', async () => {
    const mine = await as(w.db, 'organiser', async (q) => (await q('select id from events where id = $1', [w.eventId])).rows);
    expect(mine).toHaveLength(1);
    for (const who of ['outsider', null] as const) {
      const rows = await as(w.db, who, async (q) => (await q('select id from events where id = $1', [w.eventId])).rows);
      expect(rows, String(who)).toEqual([]);
    }
  });

  it('freezes the pinned ruleset', async () => {
    // The API roles no longer have the column at all (0004); the trigger still holds against a privileged session.
    await expect(as(w.db, 'organiser', (q) => q(`update events set ruleset = '{"areas":[]}'::jsonb where id = $1`, [w.eventId]))).rejects.toThrow(/permission denied/);
    await expect(w.db.query(`update events set ruleset = '{"areas":[]}'::jsonb where id = $1`, [w.eventId])).rejects.toThrow(/ruleset/);
  });

  it('releases only through the Chair-only functions, and hides results again when withdrawn', async () => {
    await denied(as(w.db, 'judgeV', (q) => q('update events set results_released = true where id = $1', [w.eventId])));
    await denied(as(w.db, 'organiser', (q) => q('update events set results_released = true where id = $1', [w.eventId])));
    // A matching published snapshot is what release_results() needs (it is exercised in full in final.test.ts).
    await as(w.db, 'chair', (q) => q(`insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows) values ($1, 'india-national-finals-2026', $2, '{}', '[]')`, [w.eventId, 'd'.repeat(64)]));
    await as(w.db, 'chair', (q) => q('select release_results($1)', [w.eventId]));
    try {
      for (const who of ['outsider', null] as const) {
        const ev = await as(w.db, who, async (q) => (await q('select id from events where id = $1', [w.eventId])).rows);
        const teams = await as(w.db, who, async (q) => (await q('select id from teams where event_id = $1', [w.eventId])).rows);
        expect(ev, String(who)).toHaveLength(1);
        expect(teams.length, String(who)).toBeGreaterThanOrEqual(2);
      }
    } finally {
      await as(w.db, 'chair', (q) => q('select withdraw_results($1)', [w.eventId]));
    }
    const hidden = await as(w.db, null, async (q) => (await q('select id from teams where event_id = $1', [w.eventId])).rows);
    expect(hidden).toEqual([]);
    const audit = await as(w.db, 'chair', async (q) => (await q(`select action from audit_log where event_id = $1 and entity = 'events'`, [w.eventId])).rows);
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe('teams', () => {
  it('lets the organiser add teams and keeps hostile text as text', async () => {
    const t = await as(w.db, 'organiser', async (q) =>
      (await q('insert into teams(event_id, number, name, school) values ($1, $2, $3, $4) returning name, school', [
        w.eventId, 'H1', '<script>alert(1)</script> 🚗 "quoted"', "O'Brien & Sons",
      ])).rows[0]);
    expect(t).toEqual({ name: '<script>alert(1)</script> 🚗 "quoted"', school: "O'Brien & Sons" });
  });

  it('rejects duplicate numbers ignoring case and spaces, and over-long names', async () => {
    await as(w.db, 'organiser', (q) => q(`insert into teams(event_id, number, name) values ($1, 'D1', 'One')`, [w.eventId]));
    await expect(as(w.db, 'organiser', (q) => q(`insert into teams(event_id, number, name) values ($1, ' d1 ', 'Two')`, [w.eventId]))).rejects.toThrow();
    await expect(as(w.db, 'organiser', (q) => q(`insert into teams(event_id, number, name) values ($1, 'D2', $2)`, [w.eventId, 'x'.repeat(81)]))).rejects.toThrow();
  });

  it('refuses team changes from anyone but the Chair or Organiser', async () => {
    await denied(as(w.db, 'judgeV', (q) => q(`insert into teams(event_id, number, name) values ($1, 'J1', 'Nope')`, [w.eventId])));
    await denied(as(w.db, 'mgr1', (q) => q(`update teams set name = 'Hacked' where id = $1`, [w.team1])));
    await denied(as(w.db, 'judgeV', (q) => q('delete from teams where id = $1', [w.team1])));
  });

  it('shows a team manager only their own team, and staff every team', async () => {
    const mine = await as(w.db, 'mgr1', async (q) => (await q('select id from teams where event_id = $1', [w.eventId])).rows);
    expect(mine).toEqual([{ id: w.team1 }]);
    const staff = await as(w.db, 'judgeV', async (q) => (await q('select id from teams where event_id = $1', [w.eventId])).rows);
    expect(staff.length).toBeGreaterThanOrEqual(2);
  });
});

describe('roles and invitations', () => {
  it('stops a judge granting themselves a role', async () => {
    await denied(as(w.db, 'judgeV', (q) => q(`insert into event_roles(event_id, user_id, role) values ($1, $2, 'chair')`, [w.eventId, ids.judgeV])));
    await denied(as(w.db, 'outsider', (q) => q(`insert into event_roles(event_id, user_id, role) values ($1, $2, 'organiser')`, [w.eventId, ids.outsider])));
    await denied(as(w.db, 'judgeV', (q) => q(`update event_roles set role = 'chair' where user_id = $1`, [ids.judgeV])));
  });

  it('shows a judge only their own role row, and the Organiser everyone', async () => {
    const own = await as(w.db, 'judgeV', async (q) => (await q('select user_id from event_roles where event_id = $1', [w.eventId])).rows);
    expect(own).toEqual([{ user_id: ids.judgeV }]);
    const all = await as(w.db, 'organiser', async (q) => (await q('select user_id from event_roles where event_id = $1', [w.eventId])).rows);
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  it('requires judge roles to carry a panel and team managers a team', async () => {
    await expect(as(w.db, 'organiser', (q) => q(`insert into invitations(event_id, email, role) values ($1, 'a@x.test', 'judge')`, [w.eventId]))).rejects.toThrow();
    await expect(as(w.db, 'organiser', (q) => q(`insert into invitations(event_id, email, role) values ($1, 'a@x.test', 'team_manager')`, [w.eventId]))).rejects.toThrow();
  });

  it('lets only the Organiser or Chair invite', async () => {
    await denied(as(w.db, 'judgeV', (q) => q(`insert into invitations(event_id, email, role, panel, display_name) values ($1, 'z@x.test', 'judge', 'verbal', 'Test Judge')`, [w.eventId])));
  });

  it('turns an invitation into a role once, matching the email case-insensitively', async () => {
    await as(w.db, 'organiser', (q) => q(`insert into invitations(event_id, email, role, panel, display_name) values ($1, 'new.judge@x.test', 'judge', 'enterprise', 'Test Judge')`, [w.eventId]));
    expect(await as(w.db, 'outsider', async (q) => (await q('select claim_invitations() as n')).rows[0].n)).toBe(0);
    expect(await as(w.db, 'invitee', async (q) => (await q('select claim_invitations() as n')).rows[0].n)).toBe(1);
    const role = await as(w.db, 'invitee', async (q) => (await q('select role, panel from event_roles where event_id = $1', [w.eventId])).rows);
    expect(role).toEqual([{ role: 'judge', panel: 'enterprise' }]);
    expect(await as(w.db, 'invitee', async (q) => (await q('select claim_invitations() as n')).rows[0].n)).toBe(0);
    const left = await as(w.db, 'organiser', async (q) => (await q(`select id from invitations where email = 'new.judge@x.test'`)).rows);
    expect(left).toEqual([]);
  });
});

describe('audit log', () => {
  it('is readable by the Chair and Organiser only', async () => {
    const chair = await as(w.db, 'chair', async (q) => (await q('select id from audit_log where event_id = $1', [w.eventId])).rows);
    expect(chair.length).toBeGreaterThan(0);
    for (const who of ['judgeV', 'mgr1', 'outsider', null] as const) {
      const rows = await as(w.db, who, async (q) => (await q('select id from audit_log').catch(() => ({ rows: [] }))).rows);
      expect(rows, String(who)).toEqual([]);
    }
  });

  it('cannot be written or changed by users', async () => {
    await denied(as(w.db, 'chair', (q) => q(`insert into audit_log(event_id, action, entity) values ($1, 'x', 'y')`, [w.eventId])));
    await denied(as(w.db, 'chair', (q) => q('delete from audit_log')));
  });
});

describe('function privileges', () => {
  it('stops anyone from forging audit entries through audit_write', async () => {
    const call = `select audit_write($1, 'forged', 'events', null, null)`;
    await expect(as(w.db, null, (q) => q(call, [w.eventId]))).rejects.toThrow(/permission denied/);
    await expect(as(w.db, 'outsider', (q) => q(call, [w.eventId]))).rejects.toThrow(/permission denied/);
    await expect(as(w.db, 'chair', (q) => q(call, [w.eventId]))).rejects.toThrow(/permission denied/);
  });

  it('keeps the RPCs away from anon but open to signed-in users', async () => {
    await expect(as(w.db, null, (q) => q('select claim_invitations()'))).rejects.toThrow(/permission denied/);
    await expect(as(w.db, null, (q) => q(`select * from create_event('x', null, '{"areas":[]}'::jsonb)`))).rejects.toThrow(/permission denied/);
    expect(await as(w.db, 'outsider', async (q) => (await q('select claim_invitations() as n')).rows[0].n)).toBe(0);
  });

  it('is not fooled by a temp table that shadows event_roles', async () => {
    const answer = await as(w.db, 'outsider', async (q) => {
      await q('create temp table event_roles (event_id uuid, user_id uuid, role app_role)');
      try {
        await q(`insert into pg_temp.event_roles values ($1, $2, 'organiser')`, [w.eventId, ids.outsider]);
        return (await q('select is_chair_or_organiser($1) as ok', [w.eventId])).rows[0].ok;
      } finally {
        await q('drop table pg_temp.event_roles');
      }
    });
    expect(answer).toBe(false);
  });
});

describe('invitation claiming needs a verified email', () => {
  it('lets an unconfirmed address claim nothing', async () => {
    await as(w.db, 'organiser', (q) => q(`insert into invitations(event_id, email, role, panel, display_name) values ($1, 'unverified@x.test', 'judge', 'verbal', 'Test Judge')`, [w.eventId]));
    expect(await as(w.db, 'unverified', async (q) => (await q('select claim_invitations() as n')).rows[0].n)).toBe(0);
    const roles = await as(w.db, 'unverified', async (q) => (await q('select 1 from event_roles where user_id = $1', [ids.unverified])).rows);
    expect(roles).toEqual([]);
  });

  it('matches on the account email, not on a claim in the token', async () => {
    await as(w.db, 'organiser', (q) => q(`insert into invitations(event_id, email, role, panel, display_name) values ($1, 'victim@x.test', 'judge', 'verbal', 'Test Judge')`, [w.eventId]));
    await w.db.exec(`set role authenticated`);
    await w.db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: ids.outsider, email: 'victim@x.test' })]);
    try {
      expect((await w.db.query<{ n: number }>('select claim_invitations() as n')).rows[0].n).toBe(0);
    } finally {
      await w.db.exec('reset role');
      await w.db.query(`select set_config('request.jwt.claims', '', false)`);
    }
  });
});

describe('teams belong to the event of the role or invitation that names them', () => {
  it('refuses a team_manager role or invitation pointing at another event\'s team', async () => {
    const e2 = await as(w.db, 'invitee', async (q) =>
      (await q('select * from create_event($1, null, $2::jsonb)', ['Second', JSON.stringify(INDIA_2026)])).rows[0]);
    await expect(as(w.db, 'invitee', (q) =>
      q(`insert into event_roles(event_id, user_id, role, team_id) values ($1, $2, 'team_manager', $3)`, [e2.id, ids.outsider, w.team1]))).rejects.toThrow(/foreign key|violates/);
    await expect(as(w.db, 'invitee', (q) =>
      q(`insert into invitations(event_id, email, role, team_id) values ($1, 'm@x.test', 'team_manager', $2)`, [e2.id, w.team1]))).rejects.toThrow(/foreign key|violates/);
  });
});

describe('audit log is append-only and retained', () => {
  it('refuses a TRUNCATE from the Chair', async () => {
    await expect(as(w.db, 'chair', (q) => q('truncate audit_log'))).rejects.toThrow(/permission denied/);
    await denied(as(w.db, 'organiser', (q) => q('update audit_log set action = $1', ['x'])));
  });

  it('keeps audit rows when someone tries to delete their event', async () => {
    await expect(w.db.query('delete from events where id = $1', [w.eventId])).rejects.toThrow(/audit_log|foreign key|violates/);
    const n = (await w.db.query<{ n: number }>('select count(*)::int as n from audit_log where event_id = $1', [w.eventId])).rows[0].n;
    expect(n).toBeGreaterThan(0);
  });
});
