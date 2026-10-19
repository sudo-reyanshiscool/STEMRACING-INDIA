import { createHash } from 'node:crypto';

export interface MigrationSource { name: string; sql: string }
const identifier = /^[a-z][a-z0-9_]{0,62}$/;

/** Install the existing migrations in their own schema without changing another app's public tables or defaults. */
export function isolatedMigrations(files: MigrationSource[], schema = 'stem_racing'): string {
  if (!identifier.test(schema) || schema === 'public' || schema.startsWith('pg_')) throw new Error('Use a dedicated application schema');
  const steps = files.map(({ name, sql }, index) => {
    if (!/^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name)) throw new Error('Invalid migration name');
    const digest = createHash('sha256').update(sql).digest('hex');
    let body = sql
      // The legacy unscoped default changes the owner's global defaults. Apply explicit function grants below instead.
      .replace(/^alter default privileges revoke execute on functions from public;\s*/m, '')
      .replace(/\bin schema public\b/g, `in schema ${schema}`)
      .replace(/\bsearch_path = public, pg_temp\b/g, `search_path = ${schema}, pg_temp`);
    // 0001 relies on Supabase's public-schema defaults. Supply the equivalent explicit core grants here.
    if (name.startsWith('0001_')) body += `
      grant select, insert, update, delete on events, teams, event_roles, invitations to authenticated;
      grant select on audit_log to authenticated;
    `;
    const tag = `$stem_migration_${index}$`;
    if (body.includes(tag)) throw new Error('Migration delimiter collision');
    return `do $apply$ begin
  if exists (select 1 from ${schema}.schema_migrations where version = '${name}' and checksum <> '${digest}') then
    raise exception 'Installed migration differs: ${name}';
  end if;
  if not exists (select 1 from ${schema}.schema_migrations where version = '${name}') then
    execute ${tag}${body}${tag};
    insert into ${schema}.schema_migrations(version, checksum) values ('${name}', '${digest}');
  end if;
end $apply$;`;
  });
  // Do not rely on an existing project's default function permissions. Expose only the grants declared by migrations.
  const grants = files.flatMap(({ sql }) => sql.match(/grant execute on function\s+[\s\S]*?;/g) ?? []);
  return `begin;
create schema if not exists ${schema};
set local search_path = ${schema}, pg_temp;
create table if not exists ${schema}.schema_migrations(version text primary key, checksum text not null);
revoke all on ${schema}.schema_migrations from public, anon, authenticated;
${steps.join('\n')}
revoke execute on all functions in schema ${schema} from public, anon, authenticated;
${grants.join('\n')}
grant usage on schema ${schema} to anon, authenticated;
notify pgrst, 'reload schema';
commit;\n`;
}
