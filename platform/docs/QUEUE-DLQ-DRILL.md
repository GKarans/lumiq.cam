# Isolated Queue/DLQ Drill

This Worker tests Cloudflare Queue retries without loading Lumiq application
code or binding Production/Recovery databases, R2 buckets, secrets, cron jobs,
HTTP routes, or the `lumiq.cam` hostname. It handles only synthetic messages.

## Run once

From the repository root in PowerShell:

```powershell
$main = "lumiq-queue-drill-20260930-main"
$dlq = "lumiq-queue-drill-20260930-dlq"
$config = "cloudflare/queue-drill/wrangler.jsonc"

npx wrangler queues create $main
npx wrangler queues create $dlq
npx wrangler deploy --config $config
```

In Cloudflare Dashboard, open the main drill queue's **Messages** tab, send
exactly one JSON message such as `{"synthetic":true,"case":"retry-dlq"}`,
then follow the drill Worker logs. The main consumer retries every message and
the configured retry limit routes it to the DLQ; the DLQ consumer acknowledges
it. Verify three main-queue deliveries, one DLQ acknowledgement, and zero
backlog in both queues. The Worker logs no message body or identifiers.

## Cleanup

Only after logs confirm the retry/DLQ path and both queues have zero backlog,
remove both temporary consumers first, then delete the Worker and the two
named drill queues:

```powershell
npx wrangler queues consumer remove $main "lumiq-queue-drill-20260930"
npx wrangler queues consumer remove $dlq "lumiq-queue-drill-20260930"
npx wrangler delete --config $config
npx wrangler queues delete $dlq
npx wrangler queues delete $main
```

Do not substitute either Production queue name. Never send test messages to
`lumiq-production-jobs` or `lumiq-production-jobs-dlq`.

The local handler checks run with `node --test platform/tests/queue-drill.test.mjs`;
they verify retries, DLQ ack, and that message bodies are not logged. They do
not prove Cloudflare's live retry delivery; record live metrics/logs separately
after the isolated run.

## Verified run: 2026-09-30

One synthetic JSON message was sent to the isolated main queue. Worker
Observability recorded main-queue attempts 1, 2, and 3 as `forced-retry`, then
one DLQ `dead-letter-ack`; invocation errors were zero. The dashboard showed
no unacknowledged messages in either queue. The temporary consumers, Worker,
and queues were removed. A fresh `wrangler queues list` showed only the two
Production queues, and `wrangler deployments list --name
lumiq-queue-drill-20260930 --json` confirmed that the temporary Worker no
longer exists. This verifies Cloudflare retry and DLQ delivery in isolation,
not the Production consumer's DB-side dead-letter handling or current
Production error logs.
