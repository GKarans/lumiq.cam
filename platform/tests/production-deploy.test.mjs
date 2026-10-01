import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {assertOwnerAccessRedirect, assertQueueConsumerState, latestDeployedVersion, prepareProductionDeployment} from "../scripts/deploy-production.mjs";

const closedTestId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function sourceConfig() {
  return {
    name: "lumiq-production-candidate",
    workers_dev: true,
    preview_urls: false,
    vars: {
      PLATFORM_MODE: "production",
      PLATFORM_RELEASE_APPROVED: "production",
      PLATFORM_SERVICE_NAME: "lumiq-production-candidate",
      PLATFORM_ORIGIN: "https://lumiq-production-candidate.example.workers.dev",
      PLATFORM_SUPABASE_URL: "https://prodproject123.supabase.co",
      PLATFORM_SUPABASE_PROJECT_REF: "prodproject123",
      PLATFORM_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_key",
      PLATFORM_EMAIL_FROM: "Lumiq <noreply@send.lumiq.cam>",
      PLATFORM_SUPPORT_EMAIL: "support@lumiq.cam",
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

test("Production adoption prepares an unexposed Worker and a root-domain route without mutating the source", () => {
  const source = sourceConfig();
  const {initialConfig, routedConfig, validated} = prepareProductionDeployment(source, closedTestId);
  assert.equal(source.name, "lumiq-production-candidate");
  assert.equal(source.vars.PLATFORM_ORIGIN, "https://lumiq-production-candidate.example.workers.dev");
  assert.equal(initialConfig.name, "lumiq-production");
  assert.equal(initialConfig.workers_dev, false);
  assert.equal(initialConfig.preview_urls, false);
  assert.equal(initialConfig.routes, undefined);
  assert.equal(initialConfig.queues.consumers.length, 0);
  assert.equal(routedConfig.routes[0].pattern, "lumiq.cam");
  assert.equal(routedConfig.routes[0].custom_domain, true);
  assert.equal(routedConfig.vars.PLATFORM_SERVICE_NAME, "lumiq-production");
  assert.equal(routedConfig.vars.PLATFORM_ORIGIN, "https://lumiq.cam");
  assert.equal(routedConfig.vars.PLATFORM_EMAIL_FROM, "Lumiq <noreply@lumiq.cam>");
  assert.equal(routedConfig.vars.PLATFORM_EMAIL_REPLY_TO, "support@lumiq.cam");
  assert.equal(routedConfig.vars.PLATFORM_SUPPORT_EMAIL, "support@lumiq.cam");
  assert.equal(validated.worker, "lumiq-production");
});

test("Production adoption rejects an unreviewed migration source or release state", () => {
  const config = sourceConfig();
  config.name = "lumiq-cam";
  assert.throws(() => prepareProductionDeployment(config, closedTestId), /reviewed Production migration source/);
  const unapproved = sourceConfig();
  unapproved.vars.PLATFORM_RELEASE_APPROVED = "NOT_APPROVED";
  assert.throws(() => prepareProductionDeployment(unapproved, closedTestId), /approved Production release state/);
});

test("canonical Production preflight permits only the exact lumiq.cam custom domain", () => {
  const {routedConfig} = prepareProductionDeployment(sourceConfig(), closedTestId);
  assert.equal(routedConfig.routes.length, 1);
  assert.equal(routedConfig.workers_dev, false);
  assert.equal(routedConfig.preview_urls, false);
});

test("Production deploy requires the Cloudflare Access login redirect", () => {
  assert.doesNotThrow(() => assertOwnerAccessRedirect(302, "https://lumiq.cloudflareaccess.com/cdn-cgi/access/login"));
  assert.throws(() => assertOwnerAccessRedirect(200, "https://lumiq.cloudflareaccess.com/cdn-cgi/access/login"), /not protected/);
  assert.throws(() => assertOwnerAccessRedirect(302, "https://attacker.example/login"), /not protected/);
});

test("deployment verification selects the newest fully deployed version", () => {
  assert.equal(latestDeployedVersion([
    {created_on: "2026-09-29T19:19:11.000Z", versions: [{version_id: "old", percentage: 100}]},
    {created_on: "2026-09-30T12:51:31.000Z", versions: [{version_id: "new", percentage: 100}]}
  ]), "new");
  assert.equal(latestDeployedVersion([]), null);
});

test("Queue handoff accepts only reviewed source/canonical combinations and flat DLQ settings", () => {
  const main = [{script: "lumiq-production-candidate", dead_letter_queue: "lumiq-production-jobs-dlq"}];
  const dlq = [{script: "lumiq-production-candidate"}];
  assert.deepEqual(assertQueueConsumerState(main, dlq), {main: "lumiq-production-candidate", dlq: "lumiq-production-candidate"});
  assert.deepEqual(assertQueueConsumerState([{...main[0], script: "lumiq-production"}], dlq), {main: "lumiq-production", dlq: "lumiq-production-candidate"});
  assert.throws(() => assertQueueConsumerState([{script: "unknown-worker", dead_letter_queue: "lumiq-production-jobs-dlq"}], dlq), /reviewed migration source and canonical Worker/);
  assert.throws(() => assertQueueConsumerState(main, [{script: "lumiq-production-candidate", dead_letter_queue: "nested"}]), /flat pair/);
});

test("deployment command targets canonical Production and keeps generic deployment blocked", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const guard = await readFile(new URL("../scripts/block-deploy.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts["production:deploy"], "node platform/scripts/deploy-production.mjs");
  assert.equal(packageJson.scripts["cloudflare:deploy"], "node platform/scripts/block-deploy.mjs");
  assert.match(guard, /process\.exitCode=1/);
});
