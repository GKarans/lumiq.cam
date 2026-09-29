import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {validateProductionConfig, validateRemoteHyperdriveProject} from "../scripts/production-preflight.mjs";

function candidate() {
  return {
    name: "lumiq-production-candidate",
    workers_dev: true,
    preview_urls: false,
    vars: {
      PLATFORM_MODE: "production",
      PLATFORM_RELEASE_APPROVED: "NOT_APPROVED",
      PLATFORM_ORIGIN: "https://lumiq-production-candidate.example.workers.dev",
      PLATFORM_SUPABASE_URL: "https://prodproject123.supabase.co",
      PLATFORM_SUPABASE_PROJECT_REF: "prodproject123",
      PLATFORM_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_key",
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
      consumers: [{queue: "lumiq-production-jobs", dead_letter_queue: "lumiq-production-jobs-dlq"}]
    }
  };
}

const testHyperdriveId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("production starter template stays locked and has no automatic cleanup schedule", async () => {
  const template = JSON.parse(await readFile(new URL("../../cloudflare/worker/wrangler.production.template.json", import.meta.url), "utf8"));
  assert.equal(template.vars.PLATFORM_RELEASE_APPROVED, "NOT_APPROVED");
  assert.equal(template.triggers?.crons, undefined);
});

test("production preflight accepts isolated candidate with budget and queue recovery", () => {
  const result = validateProductionConfig(candidate(), testHyperdriveId);
  assert.equal(result.worker, "lumiq-production-candidate");
  assert.equal(result.bucket, "lumiq-production-photos");
  assert.equal(result.queue, "lumiq-production-jobs");
});

test("production candidate preflight refuses an approved release state", () => {
  const approved = candidate();
  approved.vars.PLATFORM_RELEASE_APPROVED = "production";
  assert.throws(() => validateProductionConfig(approved, testHyperdriveId), /must stay release-locked/);
});

test("production R2 binding must explicitly target the EU jurisdiction", () => {
  const missing = candidate();
  delete missing.r2_buckets[0].jurisdiction;
  assert.throws(() => validateProductionConfig(missing, testHyperdriveId), /EU R2 jurisdiction/);
  const wrong = candidate();
  wrong.r2_buckets[0].jurisdiction = "default";
  assert.throws(() => validateProductionConfig(wrong, testHyperdriveId), /EU R2 jurisdiction/);
});

test("production preflight rejects closed-test resources, retired names and missing budget or DLQ", () => {
  const sharedDb = candidate();
  sharedDb.hyperdrive[0].id = testHyperdriveId;
  assert.throws(() => validateProductionConfig(sharedDb, testHyperdriveId), /must not reuse/);

  const retiredWorker = candidate();
  retiredWorker.name = "lumiq-cam";
  assert.throws(() => validateProductionConfig(retiredWorker, testHyperdriveId), /separate Worker name/);

  for (const bucket of ["lumiq-staging-photos", "lumiq-closed-test-photos", "app-images"]) {
    const sharedBucket = candidate();
    sharedBucket.r2_buckets[0].bucket_name = bucket;
    assert.throws(() => validateProductionConfig(sharedBucket, testHyperdriveId), /production-\*/);
  }

  const customDomain = candidate();
  customDomain.routes = [{pattern: "lumiq.cam", custom_domain: true}];
  assert.throws(() => validateProductionConfig(customDomain, testHyperdriveId), /must not claim/);

  const noBudget = candidate();
  noBudget.vars.R2_BUDGET_ENABLED = "false";
  assert.throws(() => validateProductionConfig(noBudget, testHyperdriveId), /hard stop/);

  const noDlq = candidate();
  noDlq.queues.consumers[0].dead_letter_queue = undefined;
  assert.throws(() => validateProductionConfig(noDlq, testHyperdriveId), /DLQ/);
});

test("production preflight rejects unsafe public variables and disabled preview protection", () => {
  const wrongDbProject = candidate();
  wrongDbProject.vars.PLATFORM_SUPABASE_PROJECT_REF = "otherproject123";
  assert.throws(() => validateProductionConfig(wrongDbProject, testHyperdriveId), /project reference must match/);

  const secretInVars = candidate();
  secretInVars.vars.PLATFORM_SESSION_ENCRYPTION_KEY = "must-not-be-inline";
  assert.throws(() => validateProductionConfig(secretInVars, testHyperdriveId), /secret bindings/);

  const databaseUrlInVars = candidate();
  databaseUrlInVars.vars.PLATFORM_DATABASE_URL = "postgres://must-not-be-inline";
  assert.throws(() => validateProductionConfig(databaseUrlInVars, testHyperdriveId), /secret bindings/);

  const previews = candidate();
  previews.preview_urls = true;
  assert.throws(() => validateProductionConfig(previews, testHyperdriveId), /preview URLs disabled/);

  const otherWorkersOrigin = candidate();
  otherWorkersOrigin.vars.PLATFORM_ORIGIN = "https://another-worker.example.workers.dev";
  assert.throws(() => validateProductionConfig(otherWorkersOrigin, testHyperdriveId), /own bare HTTPS/);

  const environmentOverride = candidate();
  environmentOverride.env = {production: {vars: {PLATFORM_MODE: "production"}}};
  assert.throws(() => validateProductionConfig(environmentOverride, testHyperdriveId), /Named Wrangler environments/);

  const extraService = candidate();
  extraService.services = [{binding: "STAGING_WORKER", service: "lumiq-cam"}];
  assert.throws(() => validateProductionConfig(extraService, testHyperdriveId), /Unexpected services/);
});

test("remote Hyperdrive identity must match the isolated Supabase project", () => {
  const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const expected = "prodproject123";
  const remote = {
    id,
    caching: {disabled: true},
    origin: {
      host: "aws-0-eu-central-1.pooler.supabase.com",
      user: `lumiq_runtime.${expected}`
    }
  };
  assert.deepEqual(validateRemoteHyperdriveProject(remote, id, expected), {
    id,
    host: "aws-0-eu-central-1.pooler.supabase.com",
    projectRef: expected,
    runtimeRole: "lumiq_runtime"
  });
  assert.throws(() => validateRemoteHyperdriveProject({
    ...remote,
    origin: {...remote.origin, user: `postgres.${expected}`}
  }, id, expected), /dedicated lumiq_runtime/);
  assert.throws(() => validateRemoteHyperdriveProject(remote, id, "anotherproject"), /does not match/);
  assert.throws(() => validateRemoteHyperdriveProject({...remote, id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}, id, expected), /ID does not match/);
  assert.deepEqual(validateRemoteHyperdriveProject({id, caching: {disabled: true}, origin: {host: "db.prodproject123.supabase.co", user: "lumiq_runtime"}}, id, expected), {
    id,
    host: "db.prodproject123.supabase.co",
    projectRef: expected,
    runtimeRole: "lumiq_runtime"
  });
  assert.throws(() => validateRemoteHyperdriveProject({id, caching: {disabled: true}, origin: {host: "db.prodproject123.supabase.co", user: "postgres"}}, id, expected), /dedicated lumiq_runtime/);
  assert.throws(() => validateRemoteHyperdriveProject({...remote, caching: {disabled: false}}, id, expected), /caching must be explicitly disabled/);
  assert.throws(() => validateRemoteHyperdriveProject({id, origin: remote.origin}, id, expected), /caching must be explicitly disabled/);
  assert.deepEqual(validateRemoteHyperdriveProject({...remote, origin: {...remote.origin, user: `lumiq_production_runtime.${expected}`}}, id, expected, "lumiq_production_runtime"), {
    id,
    host: "aws-0-eu-central-1.pooler.supabase.com",
    projectRef: expected,
    runtimeRole: "lumiq_production_runtime"
  });
  assert.throws(() => validateRemoteHyperdriveProject(remote, id, expected, "postgres"), /not an allowed dedicated identity/);
});
