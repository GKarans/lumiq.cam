# Queue Rollout

Status: implemented locally, not provisioned or deployed. PostgreSQL `jobs` rows
remain the durable source of truth. Cloudflare Queue messages contain only a job
UUID; the consumer validates the ID and claims exactly that due row under a DB
lock. Delivery is at least once, so duplicate messages are expected and safe.
If a queue message is lost, the minute cron republishes queued rows whose
dispatch marker is older than five minutes. Messages routed to the configured
dead-letter queue mark their eligible DB job failed and stop automatic
redispatch; the owner can retry it from the event workspace. Without the Queue
binding, cron continues to poll and process jobs itself.

The Worker must consume both the main queue and its DLQ. The main consumer
routes exhausted messages to the DLQ; the DLQ consumer calls `deadLetter()` to
mark the durable DB job failed. DLQ processing retries up to ten times. If the
database remains unavailable through those retries, Cloudflare eventually
discards that queue message; the job row remains the source of truth and the
cron dispatcher can publish it again after the database recovers. Monitor DLQ
age and Worker errors so this recovery loop is visible rather than silent.

## Closed-test sequence

Do not enable photo uploads or run load tests until the account-level R2 budget
and the current Worker plan have been reviewed. Queue has a shared daily
operation allowance; Worker Free has a 10 ms CPU limit that may be too low for
ZIP generation. Do not upgrade or create billable resources without the owner's
separate cost approval.

1. Confirm the Access-protected `lumiq-closed-test` Worker and test project are
   the only targets. Never use the `lumiq-cam` config or production domain.
2. If approved, create an isolated queue and a queue for failed-message review:

   ```powershell
   npx wrangler queues create lumiq-closed-test-jobs
   npx wrangler queues create lumiq-closed-test-jobs-dlq
   ```

3. Apply migration `011-queue-job-dispatch` to only the pinned closed-test DB:

   ```powershell
   .\platform\scripts\migrate-new-test.ps1
   ```

   Enter the closed-test Session pooler URI in the hidden prompt and confirm
   only `cpweowosocjuccjsyyic`. Then verify that all eleven migrations are
   applied. Do not run an MVP migration.
4. Add these bindings under the `queues` key in the ignored
   `cloudflare/worker/wrangler.closed-test.jsonc`. Keep the consumer bounded;
   this example starts at concurrency one for a controlled test:

   ```jsonc
   "queues": {
     "producers": [
       { "binding": "LUMIQ_JOBS_QUEUE", "queue": "lumiq-closed-test-jobs" }
     ],
     "consumers": [
       {
         "queue": "lumiq-closed-test-jobs",
         "max_batch_size": 1,
         "max_batch_timeout": 5,
         "max_retries": 10,
         "dead_letter_queue": "lumiq-closed-test-jobs-dlq",
         "max_concurrency": 1
       },
       {
         "queue": "lumiq-closed-test-jobs-dlq",
         "max_batch_size": 1,
         "max_batch_timeout": 5,
         "max_retries": 10,
         "max_concurrency": 1
       }
     ]
   }
   ```

   Also add `LUMIQ_JOBS_DLQ_NAME: "lumiq-closed-test-jobs-dlq"` to that
   config's `vars`. The Worker uses the Queue batch's source name to distinguish
   the normal consumer from the dead-letter consumer. Do not add a nested DLQ:
   the durable jobs table and cron dispatcher are the fallback if the DB is
   unavailable while a DLQ message is being processed.

5. Run `npm run check`, `npm run build`, and a Wrangler dry run with the
   closed-test config. Review every binding before a closed-test deployment.
   Do not deploy to `lumiq.cam`.
6. With a disposable event and synthetic photos, verify a single Queue message
   completes one DB job, duplicate delivery does not duplicate a ZIP object,
   failed delivery is retried or reaches the DLQ, and the DB cron republishes a
   deliberately dropped queued job. Check R2 usage and Worker CPU after each
   run. Then run a controlled concurrency increase and record backlog, ZIP
   completion time, Worker CPU, errors, and costs.
7. If any gate fails, remove the Queue binding and redeploy only the closed-test
   Worker to return to the database-polling fallback. Do not delete test data
   or Queue resources until pending messages and the DLQ have been reviewed.

## Pricing and limits to recheck

Cloudflare's current Queues documentation lists 10,000 operations/day shared
across an account on Workers Free and 24-hour message retention. Workers Paid
includes 1 million Queue operations/month, then $0.40 per additional million;
most consumed messages count one write, one read and one delete. Messages are
limited to 128 KB; `sendBatch` accepts at most 100 messages (or 256 KB) per
call. Verify current values in the Cloudflare dashboard before the experiment.

This code's dispatch ceiling is 1,000 job messages per scheduled invocation,
published in batches of at most 100. It is not a promise that ZIPs finish at
that rate: consumers, database capacity, Worker CPU and R2 response times set
the actual throughput. Load-test the complete flow before production planning.
