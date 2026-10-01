import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function oneBinding(items, name, field) {
  const matches = (Array.isArray(items) ? items : []).filter(item => item?.binding === name);
  requireThat(matches.length === 1, `Expected exactly one ${name} ${field} binding.`);
  return matches[0];
}

export function validateProductionConfig(candidate) {
  requireThat(candidate && typeof candidate === "object", "Production config must be an object.");
  requireThat(typeof candidate.name === "string" && candidate.name.length > 0, "Production worker name is required.");
  requireThat(["lumiq-production", "lumiq-production-candidate"].includes(candidate.name), "Production must use the canonical Worker or the existing migration source.");
  requireThat(candidate.preview_urls === false, "Production preview URLs must remain disabled.");
  requireThat(candidate.workers_dev === (candidate.name === "lumiq-production-candidate"), "Only the existing migration source may expose its workers.dev hostname.");
  requireThat(!candidate.env || Object.keys(candidate.env).length === 0, "Named Wrangler environments require a separate reviewed preflight.");
  if (candidate.name === "lumiq-production") {
    requireThat(Array.isArray(candidate.routes) && candidate.routes.length === 1 && candidate.routes[0].pattern === "lumiq.cam" && candidate.routes[0].custom_domain === true, "The canonical Production Worker must own only the lumiq.cam custom domain.");
  } else {
    requireThat(!candidate.routes?.length, "The existing migration source must not claim custom domains or routes.");
  }
  for (const bindingGroup of ["services", "d1_databases", "kv_namespaces", "durable_objects", "workflows", "dispatch_namespaces", "vectorize", "r2_data_catalogs"]) {
    requireThat(!candidate[bindingGroup]?.length, `Unexpected ${bindingGroup} binding requires separate review.`);
  }

  const vars = candidate.vars || {};
  requireThat(vars.PLATFORM_MODE === "production" && vars.PLATFORM_RELEASE_APPROVED === "NOT_APPROVED", "Production preflight config must stay release-locked as NOT_APPROVED.");
  let origin;
  try { origin = new URL(vars.PLATFORM_ORIGIN); } catch { throw new Error("Production origin is invalid."); }
  const validOrigin = candidate.name === "lumiq-production"
    ? origin.origin === "https://lumiq.cam"
    : origin.hostname.startsWith(`${candidate.name}.`) && origin.hostname.endsWith(".workers.dev") && origin.origin === vars.PLATFORM_ORIGIN;
  requireThat(origin.protocol === "https:" && validOrigin, "Production origin must be the canonical domain or the existing Worker workers.dev origin.");
  requireThat(typeof vars.PLATFORM_SUPABASE_URL === "string" && /^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(vars.PLATFORM_SUPABASE_URL), "Production Supabase project URL is required.");
  const authProjectRef = new URL(vars.PLATFORM_SUPABASE_URL).hostname.split(".")[0].toLowerCase();
  requireThat(typeof vars.PLATFORM_SUPABASE_PROJECT_REF === "string" && /^[a-z0-9]+$/i.test(vars.PLATFORM_SUPABASE_PROJECT_REF) && vars.PLATFORM_SUPABASE_PROJECT_REF.toLowerCase() === authProjectRef, "Production Auth URL and verified database project reference must match.");
  requireThat(typeof vars.PLATFORM_SUPABASE_PUBLISHABLE_KEY === "string" && vars.PLATFORM_SUPABASE_PUBLISHABLE_KEY.length > 0, "Supabase publishable key is required.");
  requireThat(vars.PLATFORM_EMAIL_FROM === "Lumiq <noreply@lumiq.cam>", "Production email sender must use the verified Lumiq root domain.");
  requireThat(vars.PLATFORM_EMAIL_REPLY_TO === "support@lumiq.cam", "Production email replies must route to the verified Lumiq support address.");
  requireThat(vars.PLATFORM_SUPPORT_EMAIL === "support@lumiq.cam", "Production support notifications must route to the verified Lumiq support address.");
  requireThat(!Object.keys(vars).some(key => /(?:SECRET|TOKEN|PASSWORD|DATABASE_URL|ACCESS_KEY|SERVICE_ROLE|PRIVATE_KEY|SESSION_ENCRYPTION_KEY|EMAIL_KEY)/i.test(key)), "Secrets must be configured with secret bindings, not vars.");

  const prodDb = oneBinding(candidate.hyperdrive, "HYPERDRIVE", "Hyperdrive");
  requireThat(candidate.hyperdrive.length === 1, "Production config must not include additional Hyperdrive bindings.");
  requireThat(/^[a-f0-9]{32}$/i.test(prodDb.id || ""), "Production Hyperdrive ID is invalid.");

  const prodR2 = oneBinding(candidate.r2_buckets, "R2_PHOTOS", "R2");
  requireThat(candidate.r2_buckets.length === 1, "Production config must not include additional R2 buckets.");
  requireThat(typeof prodR2.bucket_name === "string" && /^lumiq-production-[a-z0-9-]+$/.test(prodR2.bucket_name), "Production R2 bucket must use the lumiq-production-* namespace.");
  requireThat(prodR2.jurisdiction === "eu", "Production photo storage must explicitly bind the EU R2 jurisdiction.");
  requireThat(!["lumiq-staging-photos", "lumiq-closed-test-photos", "app-images"].includes(prodR2.bucket_name), "Production must not reuse a staging, test or legacy bucket.");

  requireThat(vars.R2_BUDGET_ENABLED === "true", "Production requires the R2 usage hard stop.");
  for (const key of ["R2_MAX_CLASS_A_OPS_MONTH", "R2_MAX_CLASS_B_OPS_MONTH", "R2_MAX_LIFETIME_WRITE_BYTES", "R2_MAX_STREAM_WRITE_BYTES"]) {
    requireThat(Number.isSafeInteger(Number(vars[key])) && Number(vars[key]) > 0, `Production requires a positive ${key} limit.`);
  }

  const producer = (candidate.queues?.producers || []).filter(item => item?.binding === "LUMIQ_JOBS_QUEUE");
  requireThat(producer.length === 1 && candidate.queues.producers.length === 1 && /^lumiq-production-[a-z0-9-]+$/.test(producer[0].queue || ""), "Production jobs Queue binding is missing or not isolated.");
  const consumers = candidate.queues?.consumers || [];
  const mainConsumer = consumers.find(item => item?.queue === producer[0].queue);
  requireThat(consumers.length === 2 && mainConsumer && /^lumiq-production-[a-z0-9-]+$/.test(mainConsumer.dead_letter_queue || ""), "Production jobs require a main consumer and a separate production DLQ consumer.");
  const dlqConsumer = consumers.find(item => item?.queue === mainConsumer.dead_letter_queue);
  requireThat(mainConsumer.dead_letter_queue !== producer[0].queue && dlqConsumer && !dlqConsumer.dead_letter_queue && vars.LUMIQ_JOBS_DLQ_NAME === mainConsumer.dead_letter_queue, "Production DLQ must have one matching consumer and no unhandled nested DLQ.");

  return {worker: candidate.name, origin: origin.origin, hyperdriveId: prodDb.id, bucket: prodR2.bucket_name, queue: producer[0].queue, dlq: mainConsumer.dead_letter_queue};
}

export function validateRemoteHyperdriveProject(config, expectedId, expectedProjectRef, expectedRuntimeRole = "lumiq_runtime") {
  requireThat(config && config.id === expectedId, "Remote Hyperdrive ID does not match the candidate binding.");
  requireThat(config.caching?.disabled === true, "Production Hyperdrive caching must be explicitly disabled.");
  requireThat(["lumiq_runtime", "lumiq_production_runtime"].includes(expectedRuntimeRole), "Production runtime role is not an allowed dedicated identity.");
  const host = config.origin?.host?.toLowerCase();
  const username = config.origin?.user?.toLowerCase();
  requireThat(typeof host === "string" && typeof username === "string", "Remote Hyperdrive origin metadata is incomplete.");

  let projectRef;
  if (host.endsWith(".pooler.supabase.com")) {
    projectRef = username.split(".").at(-1);
  } else {
    projectRef = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(host)?.[1]?.toLowerCase();
  }
  requireThat(projectRef === expectedProjectRef.toLowerCase(), "Remote Hyperdrive origin does not match the candidate Supabase project reference.");
  if (host.endsWith(".pooler.supabase.com")) {
    requireThat(username === `${expectedRuntimeRole}.${expectedProjectRef.toLowerCase()}`, `Production Hyperdrive must use the selected dedicated ${expectedRuntimeRole} role, not postgres/admin.`);
  } else {
    requireThat(username === expectedRuntimeRole, `Production Hyperdrive must use the selected dedicated ${expectedRuntimeRole} role, not postgres/admin.`);
  }
  return {id: config.id, host, projectRef, runtimeRole: expectedRuntimeRole};
}

export function getRemoteHyperdriveConfig(id) {
  const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  let output;
  try {
    output = execFileSync(process.execPath, [wrangler, "hyperdrive", "get", id], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
  } catch {
    throw new Error("Unable to read the candidate Hyperdrive from Cloudflare; authenticate Wrangler and retry.");
  }
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  requireThat(start >= 0 && end > start, "Cloudflare returned no parseable Hyperdrive configuration.");
  try { return JSON.parse(output.slice(start, end + 1)); }
  catch { throw new Error("Cloudflare returned an invalid Hyperdrive configuration."); }
}

async function readConfig(file) {
  let parsed;
  try { parsed = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error(`Cannot parse ${file}; use valid JSON syntax in the Wrangler config.`); }
  return parsed;
}

async function main() {
  const [candidatePath, ...args] = process.argv.slice(2);
  const runtimeRoleArg = args.find(value => value.startsWith("--runtime-role="));
  requireThat(candidatePath, "Usage: npm run production:preflight -- <production-wrangler-config.jsonc> [--runtime-role=lumiq_runtime|lumiq_production_runtime]");
  const candidateFile = path.resolve(candidatePath);
  const candidate = await readConfig(candidateFile);
  const runtimeRole = runtimeRoleArg?.split("=", 2)[1] || "lumiq_runtime";
  const result = validateProductionConfig(candidate);
  const remoteDatabase = validateRemoteHyperdriveProject(
    getRemoteHyperdriveConfig(result.hyperdriveId),
    result.hyperdriveId,
    candidate.vars.PLATFORM_SUPABASE_PROJECT_REF,
    runtimeRole
  );
  console.log(`Production candidate passed static isolation and remote DB identity checks: worker=${result.worker}, origin=${result.origin}, Hyperdrive=${remoteDatabase.id}, DB project=${remoteDatabase.projectRef}, runtime=${remoteDatabase.runtimeRole}, R2=${result.bucket}, Queue=${result.queue}, DLQ=${result.dlq}.`);
  console.log("No deployment or resource changes were performed. Verify Cloudflare Access, R2/Queue existence and Wrangler dry-run bindings separately.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Production preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
