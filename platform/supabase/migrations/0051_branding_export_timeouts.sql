-- PostgREST hoists these bounded settings before serialising large base64 files.
-- Keep the shared role timeout unchanged for ordinary database operations.
alter function team_branding_profile(uuid,uuid) set statement_timeout = '30s';
alter function download_team_brand_asset(uuid,uuid,text,text) set statement_timeout = '45s';
alter function download_compulsory_asset(uuid,uuid,text) set statement_timeout = '45s';
alter function download_team_file(uuid,uuid) set statement_timeout = '45s';
alter function download_team_photo(uuid,uuid,text) set statement_timeout = '45s';
