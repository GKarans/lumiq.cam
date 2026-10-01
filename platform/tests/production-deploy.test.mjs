import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {assertOwnerAccessRedirect, assertQueueConsumerState, latestDeployedVersion, normalizeProductionConfig, prepareProductionDeployment} from "../scripts/deploy-production.mjs";

function sourceConfig() {
  return {
    name: "lumiq-production-candidate",
    workers_dev: true,
    preview_urls: false,
    vars: {
      PLATFORM_MODE: "production",
      PLATFORM_RELEASE_APPROVED: "production",
      PLATFORM_SERVICE_NAME: "lumiq-production-candidate",
      PLATFORM_ORIGIN: "https://lumiq-production-candidate.gkarans-events.workers.dev",
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
  const {initialConfig, routedConfig, validated} = prepareProductionDeployment(source);
  assert.equal(source.name, "lumiq-production-candidate");
  assert.equal(source.vars.PLATFORM_ORIGIN, "https://lumiq-production-candidate.gkarans-events.workers.dev");
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
  assert.equal(initialConfig.observability.enabled, true);
  assert.equal(initialConfig.observability.issues.enabled, true);
  assert.equal(routedConfig.observability.issues.enabled, true);
  assert.equal(source.observability, undefined);
  assert.equal(validated.worker, "lumiq-production");
});

test("Production adoption rejects an unreviewed migration source or release state", () => {
  const config = sourceConfig();
  config.name = "lumiq-cam";
  assert.throws(() => normalizeProductionConfig(config), /canonical Worker or its saved Production config/);
  const unapproved = sourceConfig();
  unapproved.vars.PLATFORM_RELEASE_APPROVED = "NOT_APPROVED";
  assert.throws(() => normalizeProductionConfig(unapproved), /approved Production release state/);
  const mismatchedService = sourceConfig();
  mismatchedService.vars.PLATFORM_SERVICE_NAME = "lumiq-production";
  assert.throws(() => normalizeProductionConfig(mismatchedService), /service name does not match/);
});

test("canonical Production preflight permits only the exact lumiq.cam custom domain", () => {
  const {routedConfig} = prepareProductionDeployment(sourceConfig());
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

test("Production deploy requires canonical queue consumers and never transfers queue ownership", async () => {
  const main = [{script: "lumiq-production", dead_letter_queue: "lumiq-production-jobs-dlq"}];
  const dlq = [{script: "lumiq-production"}];
  assert.deepEqual(assertQueueConsumerState(main, dlq), {main: "lumiq-production", dlq: "lumiq-production"});
  assert.throws(() => assertQueueConsumerState([{...main[0], script: "lumiq-production-candidate"}], dlq), /consumed only by the canonical Worker/);
  assert.throws(() => assertQueueConsumerState(main, [{script: "lumiq-production", dead_letter_queue: "nested"}]), /flat pair/);
  const deploy = await readFile(new URL("../scripts/deploy-production.mjs", import.meta.url), "utf8");
  assert.match(deploy, /readSecretNames\(workerName\)/);
  assert.doesNotMatch(deploy, /queues",\s*"consumer",\s*"remove/);
});

test("actual Production deploy checks the live read-only migration and runtime state first", async () => {
  const deploy = await readFile(new URL("../scripts/deploy-production.mjs", import.meta.url), "utf8");
  const dryRunReturn = deploy.indexOf("if (dryRunOnly)");
  const readinessCheck = deploy.indexOf('"run-safe-runtime-check"');
  const firstDeployment = deploy.indexOf('wrangler(["deploy", "--config", initialConfigPath])');
  assert.ok(dryRunReturn >= 0 && readinessCheck > dryRunReturn, "configuration-only dry run remains independent of DB credentials");
  assert.ok(firstDeployment > readinessCheck, "live Production readiness must pass before the first Worker version is deployed");
  assert.match(deploy, /Production database readiness verification failed; no Worker deployment was started/);
});

test("deployment command targets canonical Production and keeps generic deployment blocked", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const guard = await readFile(new URL("../scripts/block-deploy.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts["production:deploy"], "node platform/scripts/deploy-production.mjs");
  assert.equal(packageJson.scripts["cloudflare:deploy"], "node platform/scripts/block-deploy.mjs");
  assert.match(guard, /process\.exitCode=1/);
});
