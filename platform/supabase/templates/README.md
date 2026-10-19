# Auth emails

`magic-link.html` styles returning-user sign-in emails. `confirmation.html`
styles first-time email confirmation. Their subjects and local file paths are
registered in `../config.toml`.

Hosted Supabase templates are configured separately in Authentication → Emails.
Copy each file into the matching template's Source editor and use the subject
from the corresponding config entry. A Git or Vercel deployment does not update
hosted email templates.

This Supabase project also hosts another application. Both subject and body
templates check `RedirectTo` against the Events Platform's production URL, with
or without a trailing slash. Requests from other applications retain the original
generic Supabase message. Add a new explicitly trusted URL to both checks if the
Events Platform moves.

The CTA and fallback link use Supabase's `ConfirmationURL` without rebuilding or
changing the authentication URL. Preview with a synthetic link, never a live
token. The layout uses presentation tables, inline styles, a public PNG logo,
and a small-screen media query. It remains usable when images or the media query
are blocked. Avoid adding web fonts, scripts, large banners or tracking pixels.
