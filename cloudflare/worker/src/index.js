import process from "node:process";
import {createApp} from "../../../platform/server/app.mjs";
import {openDatabase} from "../../../platform/server/db.mjs";
import {createR2Storage} from "./r2-storage.js";
import {createQueueConsumer, createWorkerHandler} from "./router.js";
import {validateWebp} from "./webp-validation.js";
import {isReleaseApproved} from "../../../platform/shared/release.js";
import {assertSupabaseProjectMatch} from "../../../platform/shared/supabase-project.js";
import {PLATFORM_MIGRATIONS} from "../../../platform/server/migration-manifest.mjs";

const requiredEnvironment = [
  "PLATFORM_MODE",
  "PLATFORM_RELEASE_APPROVED",
  "PLATFORM_ORIGIN",
  "PLATFORM_SUPABASE_URL",
  "PLATFORM_SUPABASE_PROJECT_REF",
  "PLATFORM_SUPABASE_PUBLISHABLE_KEY",
  "PLATFORM_SESSION_ENCRYPTION_KEY"
];
export const migrationVersions = PLATFORM_MIGRATIONS.map(({version}) => version);
export function assertMigrationsApplied(applied) {
  if (migrationVersions.some(version => !applied.has(version))) {
    throw new Error("Required database migrations are missing.");
  }
}
let migrationsVerified = false;
async function getApp(env, {authCallbackOnly = false} = {}) {
  for (const name of [...requiredEnvironment, "PLATFORM_EMAIL_KEY", "PLATFORM_EMAIL_FROM", "PLATFORM_SUPPORT_EMAIL"]) {
    if (typeof env[name] === "string") process.env[name] = env[name];
  }
  if (!env.PLATFORM_ORIGIN || !env.HYPERDRIVE?.connectionString || !env.R2_PHOTOS) {
    throw new Error("Worker backend configuration is incomplete.");
  }
  assertSupabaseProjectMatch(env.PLATFORM_SUPABASE_URL, env.PLATFORM_SUPABASE_PROJECT_REF);
  const budgetEnabled = env.R2_BUDGET_ENABLED === "true";
  if (env.PLATFORM_MODE === "production" && !budgetEnabled) {
    throw new Error("Production requires the R2 usage hard stop.");
  }
  const db = await openDatabase({connection: env.HYPERDRIVE.connectionString, skipMigrations: true, maxConnections: 5, fetchTypes: false, ssl: false});
  try {
    if (!migrationsVerified) {
      const applied = new Set((await db.query("select version from platform_migrations")).rows.map(row => row.version));
      assertMigrationsApplied(applied);
      migrationsVerified = true;
    }
    return await createApp({
      origin: env.PLATFORM_ORIGIN,
      allowedOrigins: (env.PLATFORM_ALLOWED_ORIGINS || "").split(",").map(origin => origin.trim()).filter(Boolean),
      local: false,
      db,
      files: createR2Storage(env.R2_PHOTOS, budgetEnabled ? {
        db,
        limits: {
          classAOpsPerMonth: env.R2_MAX_CLASS_A_OPS_MONTH,
          classBOpsPerMonth: env.R2_MAX_CLASS_B_OPS_MONTH,
          lifetimeWriteBytes: env.R2_MAX_LIFETIME_WRITE_BYTES,
          streamWriteBytes: env.R2_MAX_STREAM_WRITE_BYTES
        }
      } : {}),
      uploadsViaApi: true,
      authCallbackOnly,
      validateImage: validateWebp
    });
  } catch (error) {
    await db.close();
    throw error;
  }
}

const handler = createWorkerHandler(getApp);
const consumeJobs = createQueueConsumer(getApp);
export function createScheduledHandler(getApp) {
  return async (_controller, env, context) => {
    if (!isReleaseApproved(env.PLATFORM_MODE, env.PLATFORM_RELEASE_APPROVED)) return;
    if (!env.HYPERDRIVE?.connectionString) return;
    const drillEventId = env.PLATFORM_RETENTION_DRILL_EVENT_ID;
    if (drillEventId && (env.PLATFORM_MODE !== "staging" || env.PLATFORM_SERVICE_NAME !== "lumiq-restore-drill-candidate" || env.PLATFORM_SUPABASE_PROJECT_REF !== "sprzlvywzpeyuzbsyplz" || env.PLATFORM_R2_BUCKET !== "lumiq-restore-drill-20260925" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(drillEventId))) return;
    const drillPhase = env.PLATFORM_RETENTION_DRILL_PHASE || "expiry";
    if (drillEventId && !["expiry", "event-end"].includes(drillPhase)) return;
    context.waitUntil((async () => {
      const app = await getApp(env);
      try {
        if (drillEventId) {
          if (drillPhase === "event-end") {
            const result = await app.jobs.retention({eventId: drillEventId, phase: "event-end"});
            if (result.jobId) {
              await app.jobs.tick({concurrency: 1, maxJobs: 1, jobIds: [result.jobId]});
              const parts = (await app.db.query("select id from jobs where event_id=$1 and type='export-part' and payload->>'parent_id'=$2 and status='queued' order by (payload->>'part_index')::int limit 10", [drillEventId, result.jobId])).rows;
              if (parts.length) await app.jobs.tick({concurrency: 1, maxJobs: parts.length, jobIds: parts.map(part => part.id)});
            }
            const job = result.jobId ? (await app.db.query("select status,result from jobs where id=$1 and event_id=$2 and type='export' and payload->>'automatic'='true'", [result.jobId, drillEventId])).rows[0] : null;
            console.log(JSON.stringify({component: "retention-drill", phase: drillPhase, eventId: drillEventId, prepared: result.prepared, jobStatus: job?.status || null, parts: job?.result?.parts?.length ?? null}));
            return;
          }
          const result = await app.jobs.retention({eventId: drillEventId});
          if (result.jobId) await app.jobs.tick({concurrency: 1, maxJobs: 1, jobIds: [result.jobId]});
          const job = result.jobId ? (await app.db.query("select status,result from jobs where id=$1 and event_id=$2 and type='retention-cleanup'", [result.jobId, drillEventId])).rows[0] : null;
          console.log(JSON.stringify({component: "retention-drill", eventId: drillEventId, expired: result.expired, jobStatus: job?.status || null, removedMedia: job?.result?.removed ?? null}));
          return;
        }
        await app.jobs.retention();
        if (env.LUMIQ_JOBS_QUEUE) await app.jobs.dispatch(env.LUMIQ_JOBS_QUEUE);
        else await app.jobs.tick({concurrency: 1, maxJobs: 1});
        await app.deliverMail();
      } finally {
        await app.db.close();
      }
    })());
  };
}
const scheduled = createScheduledHandler(getApp);

export default {
  ...handler,
  scheduled,
  async queue(batch, env) {
    await consumeJobs(batch, env);
  }
};
