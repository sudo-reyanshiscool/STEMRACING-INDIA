import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
describe('email link confirmation and code fallback',()=>{
 for(const file of ['magic-link.html','confirmation.html'])it(`${file} defers token consumption and preserves other applications`,()=>{
  const source=readFileSync(`supabase/templates/${file}`,'utf8');
  const boundary=source.lastIndexOf('{{ else }}');const branded=source.slice(0,boundary);const fallback=source.slice(boundary);
  expect(branded).toContain('href="https://stemracingindia-events.vercel.app/#token_hash={{ .TokenHash }}&amp;type=email"');
  expect(branded).toContain('{{ .Token }}');expect(branded).not.toContain('{{ .ConfirmationURL }}');
  expect(fallback).toContain('href="{{ .ConfirmationURL }}"');expect(fallback).not.toContain('stemracingindia-events');
 });
});
