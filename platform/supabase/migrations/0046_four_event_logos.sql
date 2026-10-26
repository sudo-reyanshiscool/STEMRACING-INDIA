-- Four independently uploaded variants; light/dark retain full-colour compatibility.
alter table event_logo_sets drop constraint event_logo_sets_logos_check;
alter table event_logo_sets add constraint event_logo_sets_logos_check check(jsonb_typeof(logos)='object' and octet_length(logos::text)<=11400000);
create or replace function checked_event_logos(p_logos jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare result jsonb:='{}';k text;l jsonb;b bytea;d integer[];n text;
begin
 if p_logos is null or jsonb_typeof(p_logos)<>'object' then raise exception 'all four nationals logos are required' using errcode='22023';end if;
 foreach k in array array['monoBlack','monoWhite','light','dark'] loop
  l:=p_logos->k;n:=btrim(l->>'name');
  if n is null or length(n) not between 1 and 180 or n ~ '[[:cntrl:]/\\]' or n !~* '\.png$' or l->>'mime' is distinct from 'image/png' then raise exception 'use a PNG for every monochrome and full-colour logo variant' using errcode='22023';end if;
  b:=media_bytes(l->>'base64',2097152);d:=media_dimensions(b,'image/png');
  result:=result||jsonb_build_object(k,jsonb_build_object('name',n,'mime','image/png','base64',replace(encode(b,'base64'),E'\n',''),'width',d[1],'height',d[2]));
 end loop;
 return result;
end $$;
revoke execute on function checked_event_logos(jsonb) from public,anon,authenticated;
