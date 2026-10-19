import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { INDIA_2026 } from '../../src/rulesets';

export const ids = {
  organiser: '00000000-0000-4000-8000-000000000001',
  chair: '00000000-0000-4000-8000-000000000002',
  judgeV: '00000000-0000-4000-8000-000000000003',
  judgeD: '00000000-0000-4000-8000-000000000004',
  leadV: '00000000-0000-4000-8000-000000000005',
  mgr1: '00000000-0000-4000-8000-000000000006',
  mgr2: '00000000-0000-4000-8000-000000000007',
  outsider: '00000000-0000-4000-8000-000000000008',
  invitee: '00000000-0000-4000-8000-000000000009',
  unverified: '00000000-0000-4000-8000-00000000000a',
} as const;
export type Who = keyof typeof ids;

export const EMAIL: Record<Who, string> = {
  organiser: 'organiser@x.test', chair: 'chair@x.test', judgeV: 'judgev@x.test', judgeD: 'judged@x.test',
  leadV: 'leadv@x.test', mgr1: 'mgr1@x.test', mgr2: 'mgr2@x.test', outsider: 'outsider@x.test',
  invitee: 'New.Judge@X.TEST', unverified: 'unverified@x.test',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Q = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }>;

export interface World { db: PGlite; eventId: string; team1: string; team2: string }

export async function makeDb(): Promise<PGlite> {
  const db = new PGlite();
  // Stand-ins for what Supabase provides: the auth schema, its helpers and the two API roles.
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    -- Supabase also grants execute on every new function to the API roles; migrations must revoke what they do not expose.
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  for (const [who, id] of Object.entries(ids)) {
    // Everyone is a confirmed user except `unverified`, whose email address was never confirmed.
    await db.query('insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)', [
      id, EMAIL[who as Who], who === 'unverified' ? null : new Date().toISOString(),
    ]);
  }
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  return db;
}

export async function seedWorld(db: PGlite): Promise<World> {
  const eventId = randomUUID();
  const team1 = randomUUID();
  const team2 = randomUUID();
  await db.query('insert into events(id, name, ruleset, created_by) values ($1, $2, $3::jsonb, $4)', [
    eventId, 'Test event', JSON.stringify(INDIA_2026), ids.organiser,
  ]);
  await db.query('insert into teams(id, event_id, number, name) values ($1, $2, $3, $4), ($5, $2, $6, $7)', [
    team1, eventId, '1', 'Team One', team2, '2', 'Team Two',
  ]);
  const roles: [Who, string, string | null, string | null][] = [
    ['organiser', 'organiser', null, null],
    ['chair', 'chair', null, null],
    ['judgeV', 'judge', 'verbal', null],
    ['judgeD', 'judge', 'design_engineering', null],
    ['leadV', 'lead_judge', 'verbal', null],
    ['mgr1', 'team_manager', null, team1],
    ['mgr2', 'team_manager', null, team2],
  ];
  for (const [who, role, panel, team] of roles) {
    await db.query(
      'insert into event_roles(event_id, user_id, role, panel, team_id, email) values ($1, $2, $3::app_role, $4::judging_panel, $5, $6)',
      [eventId, ids[who], role, panel, team, EMAIL[who].toLowerCase()],
    );
  }
  await db.query('insert into event_creators(email) values ($1) on conflict do nothing', [EMAIL.invitee.toLowerCase()]);
  return { db, eventId, team1, team2 };
}

/** Run `fn` as a signed-in user (or as the anonymous role when `who` is null), then restore superuser. */
export async function as<T>(db: PGlite, who: Who | null, fn: (q: Q) => Promise<T>): Promise<T> {
  await db.exec(`set role ${who ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    who ? JSON.stringify({ sub: ids[who], email: EMAIL[who] }) : '{}',
  ]);
  try {
    return await fn((sql, params) => db.query(sql, params) as ReturnType<Q>);
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

/** Row-level security blocks either by raising an error or by touching zero rows. Both count as denied. */
export async function denied(p: Promise<{ rows: unknown[]; affectedRows?: number }>): Promise<void> {
  let changed: number;
  try {
    const r = await p;
    changed = r.affectedRows ?? r.rows.length;
  } catch {
    return;
  }
  if (changed !== 0) throw new Error(`expected the statement to be denied but ${changed} row(s) were affected`);
}
