import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {assertDlqConsumerState, assertOwnerAccessRedirect, latestDeployedVersion, prepareCandidateDeployment} from "../scripts/deploy-production-candidate.mjs";

const closedTestId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function candidate() {
  return {
    name: "lumiq-production-candidate",
    workers_dev: true,
    preview_urls: false,
    vars: {
      PLATFORM_MODE: "production",
      PLATFORM_RELEASE_APPROVED: "production",
      PLATFORM_ORIGIN: "https://lumiq-production-candidate.example.workers.dev",
      PLATFORM_SUPABASE_URL: "https://prodproject123.supabase.co",
      PLATFORM_SUPABASE_PROJECT_REF: "prodproject123",
      PLATFORM_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_key",
      PLATFORM_EMAIL_FROM: "Lumiq <noreply@send.lumiq.cam>",
      R2_BUDGET_ENABLED: "true",
      R2_MAX_CLASS_A_OPS_MONTH: "10000",
      R2_MAX_CLASS_B_OPS_MONTH: "100000",
      R2_MAX_LIFETIME_WRITE_BYTES: "2147483648",
      R2_MAX_STREAM_WRITE_BYTES: "73400320",
      LUMIQ_JOBS_DLQ_NAME: "lumiq-production-jobs-dlq"
    },
    hyperdrive: [{binding: "HYPERDRIVE", id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],
    r2_buckets: [{binding: "R2_PHOTOS", bucket_name: "lumiq-production-photos", jurisdiction: "eu"}],
    queues: {
      producers: [{binding: "LUMIQ_JOBS_QUEUE", queue: "lumiq-production-jobs"}],
      consumers: [
        {queue: "lumiq-production-jobs", dead_letter_queue: "lumiq-production-jobs-dlq"},
        {queue: "lumiq-production-jobs-dlq"}
      ]
    }
  };
}

test("candidate deployment preparation fixes sender and support replies without touching source config", () => {
  const source = candidate();
  const {deployConfig, validated} = prepareCandidateDeployment(source, closedTestId);
  assert.equal(source.vars.PLATFORM_EMAIL_FROM, "Lumiq <noreply@send.lumiq.cam>");
  assert.equal(source.vars.PLATFORM_EMAIL_REPLY_TO, undefined);
  assert.equal(deployConfig.vars.PLATFORM_RELEASE_APPROVED, "production");
  assert.equal(deployConfig.vars.PLATFORM_EMAIL_FROM, "Lumiq <noreply@lumiq.cam>");
  assert.equal(deployConfig.vars.PLATFORM_EMAIL_REPLY_TO, "support@lumiq.cam");
  assert.equal(validated.worker, "lumiq-production-candidate");
});

test("candidate deployment preparation rejects any worker other than the gated candidate", () => {
  const config = candidate();
  config.name = "lumiq-cam";
  assert.throws(() => prepareCandidateDeployment(config, closedTestId), /Only lumiq-production-candidate/);
});

test("candidate deployment preparation rejects unapproved release states", () => {
  const config = candidate();
  config.vars.PLATFORM_RELEASE_APPROVED = "NOT_APPROVED";
  assert.throws(() => prepareCandidateDeployment(config, closedTestId), /already-approved production release/);
});

test("candidate deployment must keep owner-only Access redirect", () => {
  assert.doesNotThrow(() => assertOwnerAccessRedirect(302, "https://lumiq.cloudflareaccess.com/cdn-cgi/access/login"));
  assert.throws(() => assertOwnerAccessRedirect(200, "https://lumiq.cloudflareaccess.com/cdn-cgi/access/login"), /not protected/);
  assert.throws(() => assertOwnerAccessRedirect(302, "https://attacker.example/login"), /not protected/);
});

test("candidate deployment verification selects the newest fully deployed version", () => {
  assert.equal(latestDeployedVersion([
    {created_on: "2026-09-29T19:19:11.000Z", versions: [{version_id: "old", percentage: 100}]},
    {created_on: "2026-09-30T12:51:31.000Z", versions: [{version_id: "new", percentage: 100}]}
  ]), "new");
  assert.equal(latestDeployedVersion([]), null);
});

test("candidate deploy can be rechecked after it has attached its own flat DLQ consumer", () => {
  assert.doesNotThrow(() => assertDlqConsumerState([]));
  assert.doesNotThrow(() => assertDlqConsumerState([{script: "lumiq-production-candidate"}]));
  assert.throws(() => assertDlqConsumerState([{script: "other-worker"}]), /unexpected consumer/);
  assert.throws(() => assertDlqConsumerState([{script: "lumiq-production-candidate", dead_letter_queue: "nested"}]), /unexpected consumer/);
});

test("deployment command stays explicit and the generic Cloudflare deploy guard remains intact", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const guard = await readFile(new URL("../scripts/block-deploy.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts["cloudflare:deploy"], "node platform/scripts/block-deploy.mjs");
  assert.equal(packageJson.scripts["production:candidate:deploy"], "node platform/scripts/deploy-production-candidate.mjs");
  assert.match(guard, /process\.exitCode=1/);
});
