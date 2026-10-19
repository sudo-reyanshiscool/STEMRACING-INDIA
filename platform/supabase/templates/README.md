# Auth emails

`magic-link.html` styles returning-user sign-in emails. `confirmation.html`
styles first-time email confirmation. Their subjects and local file paths are
registered in `../config.toml`. The subject templates use Go variables to stay
within Supabase’s 255-character template limit.

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

For STEM Racing, the CTA and fallback URL open the app with `TokenHash` in the
URL fragment. The app removes it from browser history, keeps it in memory, and
only calls `verifyOtp` after the user presses **Confirm and sign in**. Simply
opening the email link does not consume it. Fragments are not sent to the web
host. Both emails also include `Token`, allowing users to verify their email and
code directly in the browser where they want to sign in. Both verification
methods use Supabase's `email` OTP type for new and returning accounts.

Deploy the client before updating the hosted templates. Older messages still
use Supabase's `ConfirmationURL`; the SDK continues to accept those, while
expired or used links now show a clear explanation. Other applications retain
their original `ConfirmationURL` templates. Never change a live token or include
one in a screenshot, log, commit, or preview.

The layout uses presentation tables, inline styles, a public PNG logo, and a
small-screen media query. It remains usable when images or the media query are
blocked. Avoid web fonts, scripts, large banners or tracking pixels.

The email logo at `public/brand/logo-india-colour-white.png` was exported from
page 2 of the supplied `STEM Racing TM_Location_Logo_RGB_India.ai` artwork. It
preserves the official India lockup and transparency, with only the surrounding
empty artboard trimmed. Display at 180 × 74 pixels without stretching.
