import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(name => ({
  name,
  sql: readFileSync(new URL(name, dir), 'utf8')
}));

// Installed migrations that were later edited only to take personal email addresses out of the repository.
// Their effect on an installed database is unchanged, so the earlier checksum is accepted and replaced.
const REDACTED = {
  '0015_platform_organisers.sql': '4a88fd190d8b968a02a2619b496f1e841dd4fd983339c130dc78a58516b50e2e',
  '0043_submission_guide_exemptions.sql': '9f2f44ad30a382e5076c7f272e2ed11c7ba8494074ee22e7d63735b73eb9bfaf',
};

// Addresses a brand-new database needs, kept out of the repository: PLATFORM_OWNER_EMAIL (migration 0015)
// and SUBMISSION_GUIDE_EXEMPT_EMAILS, comma-separated (migration 0043). An existing database ignores them.
function installerSettings() {
  const email = /^[^@\s',$]+@[^@\s',$]+$/;
  const owner = (process.env.PLATFORM_OWNER_EMAIL ?? '').trim();
  const exempt = (process.env.SUBMISSION_GUIDE_EXEMPT_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean);
  for (const e of [owner, ...exempt]) if (e && !email.test(e)) throw new Error('Invalid email address in the installer settings');
  return `select set_config('stem_racing.owner_email', '${owner}', true), set_config('stem_racing.guide_exempt_emails', '${exempt.join(',')}', true);`;
}

function isolatedMigrations(files, schema = 'stem_racing') {
  const identifier = /^[a-z][a-z0-9_]{0,62}$/;
  if (!identifier.test(schema) || schema === 'public' || schema.startsWith('pg_')) throw new Error('Use a dedicated application schema');
  const steps = files.map(({ name, sql }, index) => {
    if (!/^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name)) throw new Error('Invalid migration name');
    const digest = createHash('sha256').update(sql).digest('hex');
    let body = sql
      .replace(/^alter default privileges revoke execute on functions from public;\s*/m, '')
      .replace(/\bin schema public\b/g, `in schema ${schema}`)
      .replace(/\bsearch_path = public, pg_temp\b/g, `search_path = ${schema}, pg_temp`);
    if (name.startsWith('0001_')) body += `
      grant select, insert, update, delete on events, teams, event_roles, invitations to authenticated;
      grant select on audit_log to authenticated;
    `;
    const tag = `$stem_migration_${index}$`;
    if (body.includes(tag)) throw new Error('Migration delimiter collision');
    const earlier = REDACTED[name] ? `update ${schema}.schema_migrations set checksum = '${digest}' where version = '${name}' and checksum = '${REDACTED[name]}';\n  ` : '';
    return `do $apply$ begin
  ${earlier}if exists (select 1 from ${schema}.schema_migrations where version = '${name}' and checksum <> '${digest}') then
    raise exception 'Installed migration differs: ${name}';
  end if;
  if not exists (select 1 from ${schema}.schema_migrations where version = '${name}') then
    execute ${tag}${body}${tag};
    insert into ${schema}.schema_migrations(version, checksum) values ('${name}', '${digest}');
  end if;
end $apply$;`;
  });
  const grants = files.flatMap(({ sql }) => sql.match(/grant execute on function\s+[\s\S]*?;/g) ?? []);
  return `begin;
create schema if not exists ${schema};
set local search_path = ${schema}, pg_temp;
${installerSettings()}
create table if not exists ${schema}.schema_migrations(version text primary key, checksum text not null);
revoke all on ${schema}.schema_migrations from public, anon, authenticated;
${steps.join('\n')}
revoke execute on all functions in schema ${schema} from public, anon, authenticated;
${grants.join('\n')}
grant usage on schema ${schema} to anon, authenticated;
notify pgrst, 'reload schema';
commit;\n`;
}

const sql = isolatedMigrations(files, 'stem_racing');
const target = new URL('../supabase/.temp/live-migrations.sql', import.meta.url);
writeFileSync(target, sql, 'utf8');
console.log('Rendered', files.length, 'migrations to ./supabase/.temp/live-migrations.sql');
