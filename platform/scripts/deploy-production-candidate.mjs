import {execFileSync} from "node:child_process";
import {mkdtemp, readFile, rm, unlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getRemoteHyperdriveConfig, validateProductionConfig, validateRemoteHyperdriveProject} from "./production-preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerDir = path.join(root, "cloudflare/worker");
const workerName = "lumiq-production-candidate";
const productionProject = "baqebydtinysosueksgr";
const productionRuntime = "lumiq_production_runtime";
const queueName = "lumiq-production-jobs";
const dlqName = "lumiq-production-jobs-dlq";

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(output, label) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  requireThat(start >= 0 && end >= start, `Cloudflare returned no parseable ${label}.`);
  try { return JSON.parse(output.slice(start, end + 1)); }
  catch { throw new Error(`Cloudflare returned invalid ${label}.`); }
}

export function prepareCandidateDeployment(source, closedTestHyperdriveId) {
  requireThat(source?.name === workerName, "Only lumiq-production-candidate may be deployed by this command.");
  requireThat(source.vars?.PLATFORM_MODE === "production" && source.vars.PLATFORM_RELEASE_APPROVED === "production", "The candidate must retain its already-approved production release state.");

  const deployConfig = structuredClone(source);
  deployConfig.vars.PLATFORM_EMAIL_FROM = "Lumiq <noreply@lumiq.cam>";
  deployConfig.vars.PLATFORM_EMAIL_REPLY_TO = "support@lumiq.cam";
  const preflightConfig = structuredClone(deployConfig);
  preflightConfig.vars.PLATFORM_RELEASE_APPROVED = "NOT_APPROVED";
  const validated = validateProductionConfig(preflightConfig, closedTestHyperdriveId);
  return {deployConfig, validated};
}

export function assertOwnerAccessRedirect(status, location) {
  let redirect;
  try { redirect = new URL(location); } catch { throw new Error("Candidate Access check did not return a valid redirect."); }
  requireThat(status === 302 && redirect.protocol === "https:" && redirect.hostname.endsWith(".cloudflareaccess.com"), "Candidate is not protected by the expected Cloudflare Access login redirect.");
}

export function latestDeployedVersion(deployments) {
  const latest = [...(Array.isArray(deployments) ? deployments : [])]
    .filter(deployment => Number.isFinite(Date.parse(deployment.created_on || "")))
    .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  return latest?.versions?.find(item => item.percentage === 100)?.version_id || null;
}

export function assertDlqConsumerState(consumers) {
  requireThat(Array.isArray(consumers) && (consumers.length === 0 || (consumers.length === 1 && consumers[0].script === workerName && !consumers[0].dead_letter_queue)), "The Production DLQ already has an unexpected consumer; stop for a separate review.");
}

function wrangler(args, {json = false} = {}) {
  const command = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  try {
    return execFileSync(process.execPath, [command, ...args], {cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024});
  } catch (error) {
    if (json) throw new Error(`Cloudflare read/deploy command failed: ${String(error.stderr || error.message).split("\n").slice(-4).join(" ")}`);
    throw new Error("Cloudflare command failed; inspect Wrangler authentication and the candidate state before retrying.");
  }
}

async function assertAccess(origin) {
  let response;
  try { response = await fetch(`${origin}/healthz`, {redirect: "manual", signal: AbortSignal.timeout(15000)}); }
  catch { throw new Error("Could not verify the candidate's anonymous Access boundary."); }
  assertOwnerAccessRedirect(response.status, response.headers.get("location"));
}

function readConsumer(queue) {
  const output = wrangler(["queues", "consumer", "list", queue, "--json"], {json: true});
  return parseJson(output, `consumer list for ${queue}`);
}

function readSecretNames() {
  const output = wrangler(["secret", "list", "--name", workerName, "--format", "json"], {json: true});
  return parseJson(output, "Worker secret list").map(entry => entry.name);
}

async function main() {
  const dryRunOnly = process.argv.includes("--dry-run-only");
  if (!dryRunOnly) requireThat(process.argv.includes("--owner-approved"), "Run only after explicit owner approval: add --owner-approved.");
  const sourcePath = path.join(workerDir, "wrangler.production.preflight.local.jsonc");
  const closedTestPath = path.join(workerDir, "wrangler.closed-test.jsonc");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const closedTest = JSON.parse(await readFile(closedTestPath, "utf8"));
  const {deployConfig, validated} = prepareCandidateDeployment(source, closedTest.hyperdrive?.[0]?.id);

  requireThat(deployConfig.workers_dev === true && deployConfig.preview_urls === false && !deployConfig.routes?.length, "Candidate deploy must stay workers.dev-only with no custom routes.");
  requireThat(deployConfig.main === "src/index.js" && path.resolve(workerDir, deployConfig.assets?.directory || "") === path.join(root, "platform/dist"), "Candidate must use the reviewed Worker entry point and built Production assets.");
  requireThat(deployConfig.queues?.producers?.length === 1 && deployConfig.queues.producers[0].queue === queueName, "Candidate must keep the single Production producer Queue.");
  requireThat(deployConfig.queues?.consumers?.length === 2 && deployConfig.queues.consumers.some(c => c.queue === queueName && c.dead_letter_queue === dlqName) && deployConfig.queues.consumers.some(c => c.queue === dlqName && !c.dead_letter_queue), "Candidate Queue consumers must include the main queue and a flat DLQ consumer.");

  const remote = validateRemoteHyperdriveProject(getRemoteHyperdriveConfig(validated.hyperdriveId), validated.hyperdriveId, productionProject, productionRuntime);
  const secretsBefore = readSecretNames();
  for (const required of ["PLATFORM_EMAIL_KEY", "PLATFORM_SESSION_ENCRYPTION_KEY"]) requireThat(secretsBefore.includes(required), `Candidate is missing the existing ${required} secret binding.`);

  const queues = wrangler(["queues", "list"]);
  requireThat(queues.includes(queueName) && queues.includes(dlqName), "Both existing Production Queue resources must be present before deployment.");
  const mainConsumers = readConsumer(queueName);
  requireThat(mainConsumers.length === 1 && mainConsumers[0].script === workerName && mainConsumers[0].dead_letter_queue === dlqName, "The existing Production queue consumer differs from the reviewed candidate configuration.");
  assertDlqConsumerState(readConsumer(dlqName));

  await assertAccess(validated.origin);
  const tempDir = await mkdtemp(path.join(workerDir, ".candidate-deploy-"));
  requireThat(path.dirname(tempDir) === workerDir, "Temporary deployment files escaped the Worker directory.");
  const configPath = path.join(workerDir, `${path.basename(tempDir)}.jsonc`);
  try {
    const outDir = path.join(tempDir, "bundle");
    await writeFile(configPath, JSON.stringify(deployConfig, null, 2), {flag: "wx"});
    const dryRun = wrangler(["deploy", "--dry-run", "--config", configPath, "--outdir", outDir]);
    for (const binding of [`env.LUMIQ_JOBS_QUEUE (${queueName})`, `env.HYPERDRIVE (${validated.hyperdriveId})`, `env.R2_PHOTOS (${validated.bucket} (eu))`, "env.ASSETS"]) {
      requireThat(dryRun.includes(binding), `Wrangler dry-run did not show the expected ${binding} binding.`);
    }
    if (dryRunOnly) {
      console.log(`Candidate preflight and Wrangler dry-run passed for ${workerName}; no deployment or Cloudflare resource changes were performed.`);
      return;
    }

    wrangler(["deploy", "--config", configPath]);
    await assertAccess(validated.origin);
    const mainConsumersAfter = readConsumer(queueName);
    requireThat(mainConsumersAfter.length === 1 && mainConsumersAfter[0].script === workerName && mainConsumersAfter[0].dead_letter_queue === dlqName, "The deployed candidate no longer consumes the Production jobs Queue as reviewed.");
    const dlqConsumers = readConsumer(dlqName);
    requireThat(dlqConsumers.length === 1 && dlqConsumers[0].script === workerName && !dlqConsumers[0].dead_letter_queue, "The deployed candidate did not attach the expected flat DLQ consumer.");
    const secretsAfter = readSecretNames();
    requireThat(["PLATFORM_EMAIL_KEY", "PLATFORM_SESSION_ENCRYPTION_KEY"].every(name => secretsAfter.includes(name)), "A required pre-existing Worker secret is no longer configured.");
    const version = latestDeployedVersion(parseJson(wrangler(["deployments", "list", "--name", workerName, "--json"], {json: true}), "Worker deployment list"));
    requireThat(version, "Cloudflare did not report a 100% candidate deployment version.");
    console.log(`Owner-only candidate deployed: worker=${workerName}, version=${version}, DB project=${remote.projectRef}, runtime=${remote.runtimeRole}, R2=${validated.bucket}, Production DLQ consumer attached. No custom route was configured.`);
  } finally {
    await unlink(configPath).catch(() => {});
    await rm(tempDir, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Production candidate deploy failed: ${error.message}`);
    process.exitCode = 1;
  });
}
