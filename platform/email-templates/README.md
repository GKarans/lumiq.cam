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

The current confirmed Resend sending domain is `send.lumiq.cam`. Supabase Auth
SMTP should keep using `Lumiq <noreply@send.lumiq.cam>` until the root-domain
sender has been separately verified. Do not replace root-domain MX or SPF
records as part of this step.

`support@lumiq.cam` is not yet a verified receiving mailbox. Do not set it as
the `Reply-To` address until incoming mail has been configured and a message
to that address has been received successfully. Worker transactional messages
accept `PLATFORM_EMAIL_REPLY_TO` for this purpose; it is intentionally
optional.

After saving, send test messages to a Gmail account and a second mailbox.
Check both languages, mobile width, link destinations, expired-link behavior,
and the plain-text fallback before treating the Production templates as live.
