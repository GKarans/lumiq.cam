# Lumiq Auth email hook prototype

This standalone Supabase Edge Function prototype accepts signed Supabase Auth
Send Email Hook requests and sends localized `text/plain` plus Lumiq HTML
through the Resend Email API. It handles signup confirmation, invite, magic link,
reauthentication, recovery, and email-change actions. Email-change token hashes
follow Supabase's documented mapping for secure two-address confirmation.
Signed payloads are pinned to the canonical `https://lumiq.cam` origin; candidate
and other hosts are rejected before any message is sent.

## Local checks

Run from this directory:

```powershell
npx --yes deno test --allow-net
npx --yes deno check index.ts
npx --yes deno audit
```

Tests use synthetic addresses/tokens and a mocked Resend API. They do not send
email or contact Supabase/Resend.

## Not enabled

This is not a Production deployment. Production SMTP remains the active Auth
sender. Do not configure the Supabase Send Email Hook until every Auth action
type and security notification is covered, delivered MIME and links are verified
in mail clients, provider failure/retry behavior is exercised in an isolated
project, and the owner approves the switch. Supabase routes Auth email through
the hook instead of SMTP while the hook is enabled.

Required runtime secrets are `SEND_EMAIL_HOOK_SECRET` and `RESEND_API_KEY`.
`SUPABASE_URL` is supplied by Supabase Functions. `LUMIQ_EMAIL_FROM` is a
non-secret verified sender setting. `support@lumiq.cam` now forwards to the
verified Gmail destination, so an activated, separately tested Hook may set
`LUMIQ_SUPPORT_REPLY_TO=support@lumiq.cam`. This prototype is not deployed or
enabled; Production SMTP remains active until isolated integration testing and
explicit owner approval are complete.
