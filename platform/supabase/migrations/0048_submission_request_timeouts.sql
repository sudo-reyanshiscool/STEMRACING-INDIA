-- PostgREST includes JSON/base64 argument decoding in the request's statement
-- timeout. Large permitted files can exceed the shared authenticated-role 8s
-- budget even though validation/storage itself completes quickly. Hoist this
-- bounded setting for these file writes only; ordinary API queries stay at 8s.
alter function upload_compulsory_asset(uuid,uuid,text,jsonb,integer) set statement_timeout = '30s';
alter function upload_team_photo(uuid,uuid,integer,jsonb) set statement_timeout = '30s';
alter function upload_team_file(uuid,uuid,integer,jsonb) set statement_timeout = '30s';
alter function save_team_media_details(uuid,uuid,text,jsonb,integer) set statement_timeout = '30s';
