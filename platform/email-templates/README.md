# Lumiq email templates

These Supabase Auth templates use the supported Go-template variables
`ConfirmationURL`, `NewEmail`, and user metadata `Data.locale`. Registration
stores `locale` as `lv` or `en`; other Auth messages fall back to English.

## Supabase Authentication templates

Paste the matching HTML into the Production project's **Authentication → Email
Templates**:

| Supabase template | File | Suggested subject |
|---|---|---|
| Confirm signup | `supabase-confirm-signup.html` | `Apstiprini Lumiq e-pastu / Confirm your Lumiq email` |
| Invite user | `supabase-invite.html` | `Uzaicinājums uz Lumiq / Invitation to Lumiq` |
| Reset password | `supabase-reset-password.html` | `Atjauno Lumiq paroli / Reset your Lumiq password` |
| Change email address | `supabase-change-email.html` | `Apstiprini jauno Lumiq e-pastu / Confirm your new Lumiq email` |
| Password changed notification | `supabase-password-changed.html` | `Lumiq konta paroles drošības paziņojums / Lumiq password security notice` |
| Email address changed notification | `supabase-email-changed.html` | `Lumiq konta e-pasts nomainīts / Lumiq email address changed` |

Resend has verified both `send.lumiq.cam` and the root `lumiq.cam` domain. The
Both `lumiq.cam` and `send.lumiq.cam` are currently verified in Resend. The
Production Supabase Auth sender and the prepared Cloudflare Worker release
configuration use `Lumiq <noreply@lumiq.cam>`. The root domain uses its
separate `outbound` Return-Path. Existing root MX and SPF records must remain
unchanged unless an approved receiving-mail migration requires a coordinated
change. The Worker sender must still be added to the candidate and tested after
an explicitly approved candidate deployment.

`support@lumiq.cam` is not yet a verified receiving mailbox. Do not set it as
the `Reply-To` address until incoming mail has been configured and a message
to that address has been received successfully. Worker transactional messages
accept `PLATFORM_EMAIL_REPLY_TO` for this purpose; it is intentionally
optional.

Supabase's hosted Auth template editor exposes HTML template content; it does
not provide a separate plain-text alternative field. The HTML templates include
the action URL as readable link text, but that is not an independently authored
`text/plain` MIME part. Supabase's current documentation describes hosted Auth
templates as HTML Go templates: <https://supabase.com/docs/guides/auth/auth-email-templates>.
Do not claim a plain-text fallback for Auth mail until the actual delivered MIME
message has been inspected. Worker transactional notifications already send
both `text` and `html` through Resend.

After saving, send test messages to a Gmail account and a second mailbox.
Check both languages, mobile width, link destinations, expired-link behavior,
and the delivered MIME types before treating the Production templates as live.
If a real text alternative is required for Supabase Auth, evaluate a supported
Auth email hook/custom sender separately; do not replace the working SMTP path
without integration tests and a verified rollback.
