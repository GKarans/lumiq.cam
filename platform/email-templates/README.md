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
| Magic link or OTP | `supabase-magic-link.html` | `Pieraksties Lumiq / Sign in to Lumiq` |
| Reset password | `supabase-reset-password.html` | `Atjauno Lumiq paroli / Reset your Lumiq password` |
| Reauthentication | `supabase-reauthentication.html` | `{{ if eq .Data.locale "lv" }}Lumiq drošības kods{{ else }}Lumiq verification code{{ end }}` |
| Change email address | `supabase-change-email.html` | `Apstiprini jauno Lumiq e-pastu / Confirm your new Lumiq email` |
| Password changed notification | `supabase-password-changed.html` | `Lumiq konta paroles drošības paziņojums / Lumiq password security notice` |
| Email address changed notification | `supabase-email-changed.html` | `Lumiq konta e-pasts nomainīts / Lumiq email address changed` |

Resend currently verifies both `send.lumiq.cam` and the root `lumiq.cam`
domain. Production Supabase Auth and the deployed Cloudflare candidate use
`Lumiq <noreply@lumiq.cam>`; the root sending domain has the separate
`outbound` Return-Path. Cloudflare Email Routing owns the root MX records and
root SPF (`v=spf1 include:_spf.mx.cloudflare.net ~all`); Resend's `outbound`
records and DKIM remain separate. Do not change these records without a
coordinated mail-routing review.

`support@lumiq.cam` is an active Cloudflare Email Routing forward to the
verified `guntars.karans@gmail.com` destination; an externally sent test was
received in Gmail. This is forwarding, not a separate hosted mailbox. The
candidate Worker is configured with `PLATFORM_EMAIL_REPLY_TO=support@lumiq.cam`.
Verify a real Worker message's delivered `Reply-To` header before declaring
outbound reply handling tested. Supabase hosted Auth SMTP has no documented
Reply-To field; the optional Auth Hook setting is separate and the Hook remains
disabled pending isolated testing and owner approval.

Supabase's hosted Auth template editor exposes HTML template content; it does
not provide a separate plain-text alternative field. The HTML templates include
the action URL as readable link text, but that is not an independently authored
`text/plain` MIME part. Supabase's current documentation describes hosted Auth
templates as HTML Go templates: <https://supabase.com/docs/guides/auth/auth-email-templates>.
Do not claim a plain-text fallback for Auth mail until the actual delivered MIME
message has been inspected. Worker transactional notifications already send
both `text` and `html` through Resend.

After saving, send approved test messages to a Gmail account and a second mailbox.
Check both languages, mobile width, link destinations, expired-link behavior,
and the delivered MIME types before treating the Production templates as live.
If a real text alternative is required for Supabase Auth, evaluate a supported
Auth email hook/custom sender separately; do not replace the working SMTP path
without integration tests and a verified rollback.
