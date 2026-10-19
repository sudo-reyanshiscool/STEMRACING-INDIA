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
or without a trailing slash, plus the exact `/?invite=1` callback. Invitations
use the same secure verification links with invitation-specific copy. Requests from other applications retain the original
generic Supabase message. Add a new explicitly trusted URL to both checks if the
Events Platform moves.

The CTA and fallback link use Supabase's `ConfirmationURL` without rebuilding or
changing the authentication URL. Preview with a synthetic link, never a live
token. The layout uses presentation tables, inline styles, a public PNG logo,
and a small-screen media query. It remains usable when images or the media query
are blocked. Avoid adding web fonts, scripts, large banners or tracking pixels.

The email logo at `public/brand/logo-india-colour-white.png` was exported from
page 2 of the supplied `STEM Racing TM_Location_Logo_RGB_India.ai` artwork. It
preserves the official India lockup and transparency, with only the surrounding
empty artboard trimmed. Display at 180 × 74 pixels without stretching.
