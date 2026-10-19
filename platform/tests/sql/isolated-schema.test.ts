import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { isolatedMigrations } from '../../scripts/isolated-schema';
import { INDIA_2026 } from '../../src/rulesets';
import { as, makeDb, seedWorld, type World } from './harness';
let db:PGlite, original:World;
const directory=new URL('../../supabase/migrations/',import.meta.url);
const files=readdirSync(directory).filter(n=>n.endsWith('.sql')).sort().map(name=>({name,sql:readFileSync(new URL(name,directory),'utf8')}));
beforeAll(async()=>{
  db=await makeDb();original=await seedWorld(db);
  await db.exec(`alter default privileges grant execute on functions to public, anon, authenticated;
    create table public.other_app_data(id int primary key, message text);
    insert into public.other_app_data values(1,'Keep me');
    grant select on public.other_app_data to authenticated;
    create function public.other_app_function() returns text language sql as $$ select 'Keep me' $$;`);
  await db.exec(isolatedMigrations(files));
});
afterAll(async()=>{await db.close();});
describe('installation into a shared Supabase project',()=>{
  it('keeps existing tables, records, privileges, functions and global defaults intact',async()=>{
    expect((await as(db,'organiser',q=>q('select message from public.other_app_data'))).rows).toEqual([{message:'Keep me'}]);
    expect((await as(db,'organiser',q=>q('select id from public.events where id=$1',[original.eventId]))).rows).toHaveLength(1);
    expect((await as(db,null,q=>q('select public.other_app_function() as value'))).rows).toEqual([{value:'Keep me'}]);
    await db.exec("create function public.future_app_function() returns text language sql as $$ select 'Future' $$;");
    expect((await as(db,null,q=>q('select public.future_app_function() as value'))).rows).toEqual([{value:'Future'}]);
  });
  it('creates events and resolves permission helpers only inside STEM Racing’s schema',async()=>{
    const event=(await as(db,'admin',q=>q('select (stem_racing.create_event($1,$2,$3)).id as id',['Connected event','2026-10-19',INDIA_2026]))).rows[0].id;
    expect((await as(db,'admin',q=>q('select id from stem_racing.events where id=$1',[event]))).rows).toHaveLength(1);
    expect((await as(db,'judgeV',q=>q('select id from stem_racing.events where id=$1',[event]))).rows).toEqual([]);
    expect((await db.query('select id from public.events where id=$1',[event])).rows).toEqual([]);
  });
  it('never exposes trigger functions, private tables, or the migration ledger through the API',async()=>{
    const fns=await db.query<{proname:string;proconfig:string[];prosecdef:boolean;pub:boolean;anon:boolean;auth:boolean}>(`select p.proname,p.proconfig,p.prosecdef,
      has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as auth,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as pub
      from pg_proc p where p.pronamespace='stem_racing'::regnamespace`);
    for(const f of fns.rows) {expect(f.pub,f.proname).toBe(false);if(f.prosecdef)expect(f.proconfig,f.proname).toContain('search_path=stem_racing, pg_temp');}
    for(const name of ['events_freeze','audit_write','scores_guard']) {const f=fns.rows.find(f=>f.proname===name)!;expect([f.anon,f.auth]).toEqual([false,false]);}
    await expect(as(db,'organiser',q=>q('select * from stem_racing.schema_migrations'))).rejects.toBeDefined();
    expect((await as(db,'judgeV',q=>q('select * from stem_racing.scorecard_private_reviews'))).rows).toEqual([]);
  });
  it('is repeatable and rejects changes to an already applied migration',async()=>{
    await db.exec(isolatedMigrations(files));
    expect((await db.query('select version from stem_racing.schema_migrations')).rows).toHaveLength(files.length);
    await expect(db.exec(isolatedMigrations([{...files[0],sql:files[0].sql+'\n-- changed'}]))).rejects.toThrow(/differs/);
    await db.exec('rollback');
  });
});
