import {execFileSync} from "node:child_process";
import https from "node:https";
import {mkdtemp, readFile, rm, unlink, writeFile} from "node:fs/promises";
import {isIP} from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getRemoteHyperdriveConfig, validateProductionConfig, validateRemoteHyperdriveProject} from "./production-preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerDir = path.join(root, "cloudflare/worker");
const workerName = "lumiq-production";
const legacyConfigName = "lumiq-production-candidate";
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

export function normalizeProductionConfig(source) {
  requireThat(source && [workerName, legacyConfigName].includes(source.name), "Only the canonical Worker or its saved Production config may supply bindings.");
  requireThat(source.vars?.PLATFORM_MODE === "production" && source.vars.PLATFORM_RELEASE_APPROVED === "production", "The saved config must retain its approved Production release state.");
  requireThat(source.vars.PLATFORM_SERVICE_NAME === source.name, "The saved config service name does not match its Worker name.");
  const origin = source.vars.PLATFORM_ORIGIN;
  const expectedOrigin = source.name === workerName ? "https://lumiq.cam" : "https://lumiq-production-candidate.gkarans-events.workers.dev";
  requireThat(origin === expectedOrigin, "The saved Production config has an unexpected origin.");
  const base = structuredClone(source);
  base.name = workerName;
  base.workers_dev = false;
  base.preview_urls = false;
  base.vars.PLATFORM_SERVICE_NAME = workerName;
  base.vars.PLATFORM_ORIGIN = "https://lumiq.cam";
  base.vars.PLATFORM_EMAIL_FROM = "Lumiq <noreply@lumiq.cam>";
  base.vars.PLATFORM_EMAIL_REPLY_TO = "support@lumiq.cam";
  base.vars.PLATFORM_SUPPORT_EMAIL = "support@lumiq.cam";
  base.observability = {...(base.observability || {}), enabled: true, issues: {...(base.observability?.issues || {}), enabled: true}};
  return base;
}

export function prepareProductionDeployment(savedConfig, closedTestHyperdriveId) {
  const source = normalizeProductionConfig(savedConfig);

  const initialConfig = structuredClone(source);
  delete initialConfig.routes;
  initialConfig.queues.consumers = [];
  const routedConfig = structuredClone(source);
  routedConfig.routes = [{pattern: "lumiq.cam", custom_domain: true}];
  routedConfig.queues.consumers = [];
  const preflightConfig = structuredClone(routedConfig);
  preflightConfig.queues.consumers = structuredClone(source.queues.consumers);
  preflightConfig.vars.PLATFORM_RELEASE_APPROVED = "NOT_APPROVED";
  const validated = validateProductionConfig(preflightConfig, closedTestHyperdriveId);
  return {initialConfig, routedConfig, validated};
}

export function assertOwnerAccessRedirect(status, location) {
  let redirect;
  try { redirect = new URL(location); } catch { throw new Error("Production Access check did not return a valid redirect."); }
  requireThat(status === 302 && redirect.protocol === "https:" && redirect.hostname.endsWith(".cloudflareaccess.com"), "Production domain is not protected by the expected Cloudflare Access login redirect.");
}

export function latestDeployedVersion(deployments) {
  const latest = [...(Array.isArray(deployments) ? deployments : [])]
    .filter(deployment => Number.isFinite(Date.parse(deployment.created_on || "")))
    .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  return latest?.versions?.find(item => item.percentage === 100)?.version_id || null;
}

export function assertQueueConsumerState(main, dlq) {
  const mainConsumer = Array.isArray(main) && main.length === 1 ? main[0] : null;
  const dlqConsumer = Array.isArray(dlq) && dlq.length === 1 ? dlq[0] : null;
  requireThat(mainConsumer && dlqConsumer, "Both Production queues must each have exactly one Worker consumer.");
  requireThat(mainConsumer.dead_letter_queue === dlqName && !dlqConsumer.dead_letter_queue, "Production Queue and DLQ consumer settings are not the reviewed flat pair.");
  requireThat(mainConsumer.script === workerName && dlqConsumer.script === workerName, "Both Production queues must be consumed only by the canonical Worker.");
  return {main: mainConsumer.script, dlq: dlqConsumer.script};
}

function wrangler(args, {json = false} = {}) {
  const command = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  try {
    return execFileSync(process.execPath, [command, ...args], {cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024});
  } catch (error) {
    if (json) throw new Error(`Cloudflare read/change command failed: ${String(error.stderr || error.message).split("\n").slice(-4).join(" ")}`);
    throw new Error("Cloudflare command failed; inspect Wrangler authentication and the Production state before retrying.");
  }
}

function readConsumer(queue) {
  return parseJson(wrangler(["queues", "consumer", "list", queue, "--json"], {json: true}), `consumer list for ${queue}`);
}

function readSecretNames(name) {
  return parseJson(wrangler(["secret", "list", "--name", name, "--format", "json"], {json: true}), "Worker secret list").map(entry => entry.name);
}

function setProductionSecrets() {
  const script = path.join(root, "platform/scripts/production-secrets.ps1");
  for (const command of ["set-production-session-secret", "set-production-email-secret"]) {
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, command], {
        cwd: root,
        encoding: "utf8",
        timeout: 120000,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"]
      });
    } catch {
      throw new Error("Could not copy the existing DPAPI-protected Production Worker secrets to lumiq-production. No secret values were printed.");
    }
  }
}

async function assertAccess(origin) {
  let response;
  try {
    response = await fetch(`${origin}/healthz`, {redirect: "manual", signal: AbortSignal.timeout(20000)});
    assertOwnerAccessRedirect(response.status, response.headers.get("location"));
    return;
  } catch (error) {
    if (error.message.includes("not protected")) throw error;
  }

  const host = new URL(origin).hostname;
  let dns;
  try {
    const answer = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      headers: {accept: "application/dns-json"},
      signal: AbortSignal.timeout(10000)
    });
    if (!answer.ok) throw new Error("DNS-over-HTTPS lookup failed.");
    dns = await answer.json();
  } catch {
    throw new Error("Could not resolve the Production domain to verify its Access boundary.");
  }
  const addresses = (dns.Answer || []).filter(record => record.type === 1 && isIP(record.data) === 4).map(record => record.data);
  for (const address of addresses) {
    try {
      const result = await new Promise((resolve, reject) => {
        const request = https.request({
          hostname: address,
          servername: host,
          port: 443,
          path: "/healthz",
          method: "GET",
          headers: {host},
          timeout: 15000,
          agent: false
        }, incoming => {
          incoming.resume();
          resolve({status: incoming.statusCode, location: incoming.headers.location});
        });
        request.once("timeout", () => request.destroy(new Error("Access check timed out.")));
        request.once("error", reject);
        request.end();
      });
      assertOwnerAccessRedirect(result.status, result.location);
      return;
    } catch (error) {
      if (error.message.includes("not protected")) throw error;
    }
  }
  throw new Error("Could not verify the Production domain Access boundary using its public DNS records.");
}

function assertQueueState() {
  const main = readConsumer(queueName);
  const dlq = readConsumer(dlqName);
  return assertQueueConsumerState(main, dlq);
}

async function main() {
  const dryRunOnly = process.argv.includes("--dry-run-only");
  if (!dryRunOnly) requireThat(process.argv.includes("--owner-approved"), "Run only after explicit owner approval: add --owner-approved.");
  const sourcePath = path.join(workerDir, "wrangler.production.preflight.local.jsonc");
  const closedTestPath = path.join(workerDir, "wrangler.closed-test.jsonc");
  const savedConfig = JSON.parse(await readFile(sourcePath, "utf8"));
  const source = normalizeProductionConfig(savedConfig);
  const closedTest = JSON.parse(await readFile(closedTestPath, "utf8"));
  const {initialConfig, routedConfig, validated} = prepareProductionDeployment(source, closedTest.hyperdrive?.[0]?.id);

  requireThat(!routedConfig.workers_dev && routedConfig.preview_urls === false, "The canonical Worker must not expose workers.dev or preview URLs.");
  requireThat(routedConfig.routes?.length === 1 && routedConfig.routes[0].pattern === "lumiq.cam" && routedConfig.routes[0].custom_domain, "Only the protected lumiq.cam custom domain may route to the canonical Worker.");
  requireThat(routedConfig.queues?.producers?.length === 1 && routedConfig.queues.producers[0].queue === queueName && routedConfig.queues.consumers.length === 0, "The canonical Worker must publish to the existing Production queue without changing its verified consumers.");

  const remote = validateRemoteHyperdriveProject(getRemoteHyperdriveConfig(validated.hyperdriveId), validated.hyperdriveId, productionProject, productionRuntime);
  const productionSecrets = readSecretNames(workerName);
  for (const required of ["PLATFORM_EMAIL_KEY", "PLATFORM_SESSION_ENCRYPTION_KEY"]) requireThat(productionSecrets.includes(required), `The canonical Worker is missing the existing ${required} secret.`);
  const queues = wrangler(["queues", "list"]);
  requireThat(queues.includes(queueName) && queues.includes(dlqName), "Both existing Production Queue resources must be present.");
  assertQueueState();

  const tempDir = await mkdtemp(path.join(workerDir, ".production-deploy-"));
  requireThat(path.dirname(tempDir) === workerDir, "Temporary deployment files escaped the Worker directory.");
  const initialConfigPath = path.join(workerDir, `${path.basename(tempDir)}-initial.jsonc`);
  const routedConfigPath = path.join(workerDir, `${path.basename(tempDir)}-routed.jsonc`);
  try {
    await writeFile(initialConfigPath, JSON.stringify(initialConfig, null, 2), {flag: "wx"});
    await writeFile(routedConfigPath, JSON.stringify(routedConfig, null, 2), {flag: "wx"});
    const initialDryRun = wrangler(["deploy", "--dry-run", "--config", initialConfigPath, "--outdir", path.join(tempDir, "initial-bundle")]);
    for (const binding of [`env.LUMIQ_JOBS_QUEUE (${validated.queue})`, `env.HYPERDRIVE (${validated.hyperdriveId})`, `env.R2_PHOTOS (${validated.bucket} (eu))`, "env.ASSETS"]) {
      requireThat(initialDryRun.includes(binding), `Wrangler dry-run did not show the expected ${binding} binding.`);
    }
    if (dryRunOnly) {
      console.log(`Canonical Production preflight and Wrangler dry-run passed for ${workerName}; no deployment or Cloudflare resource changes were performed.`);
      return;
    }

    wrangler(["deploy", "--config", initialConfigPath]);
    setProductionSecrets();
    const newSecrets = readSecretNames(workerName);
    requireThat(["PLATFORM_EMAIL_KEY", "PLATFORM_SESSION_ENCRYPTION_KEY"].every(name => newSecrets.includes(name)), "The canonical Worker is missing a required DPAPI-managed secret.");

    const routedDryRun = wrangler(["deploy", "--dry-run", "--config", routedConfigPath, "--outdir", path.join(tempDir, "routed-bundle")]);
    requireThat(routedDryRun.includes(`env.LUMIQ_JOBS_QUEUE (${validated.queue})`) && routedDryRun.includes(`env.R2_PHOTOS (${validated.bucket} (eu))`), "The routed Worker dry-run lost a Production binding.");
    wrangler(["deploy", "--config", routedConfigPath]);
    await assertAccess("https://lumiq.cam");
    assertQueueState();

    const version = latestDeployedVersion(parseJson(wrangler(["deployments", "list", "--name", workerName, "--json"], {json: true}), "Production deployment list"));
    requireThat(version, "Cloudflare did not report a 100% canonical Production deployment version.");
    console.log(`Canonical Production deployed: worker=${workerName}, version=${version}, DB project=${remote.projectRef}, runtime=${remote.runtimeRole}, R2=${validated.bucket}, queues transferred, lumiq.cam Access redirect verified.`);
  } finally {
    await unlink(initialConfigPath).catch(() => {});
    await unlink(routedConfigPath).catch(() => {});
    await rm(tempDir, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Production deploy failed: ${error.message}`);
    process.exitCode = 1;
  });
}
