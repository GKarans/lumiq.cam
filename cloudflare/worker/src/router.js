import {isReleaseApproved} from "../../../platform/shared/release.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function logStartupFailure(error) {
  const detail = String(error?.message || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[redacted]")
    .slice(0, 180);
  console.error(JSON.stringify({
    component: "worker-startup",
    error: typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : typeof error?.cause?.code === "string" ? error.cause.code : error?.name || "Error",
    detail,
    status: Number.isInteger(error?.status) ? error.status : undefined
  }));
}

async function withApp(getApp, env, action) {
  const app = await getApp(env);
  try {
    return await action(app);
  } finally {
    await app.db.close();
  }
}

export function createWorkerHandler(getApp) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const releaseApproved = isReleaseApproved(env.PLATFORM_MODE, env.PLATFORM_RELEASE_APPROVED);
      const authCallbackOnly = env.PLATFORM_MODE === "production" && env.PLATFORM_RELEASE_APPROVED === "NOT_APPROVED";
      if (!releaseApproved && !(authCallbackOnly && request.method === "POST" && url.pathname === "/api/auth/consume")) {
        return json({error: "Lumiq is not available."}, 503);
      }
      const service = env.PLATFORM_SERVICE_NAME || url.hostname;

      if (url.pathname === "/healthz") {
        try {
          return await withApp(getApp, env, async app => {
            await app.db.query("select 1 as ready");
            return json({status: "ok", service, database: "ready", storage: "bound"});
          });
        } catch (error) {
          logStartupFailure(error);
          return json({status: "unavailable", service, database: "unavailable"}, 503);
        }
      }

      if (url.pathname.startsWith("/api/")) {
        try {
          return await withApp(currentEnv => getApp(currentEnv, {authCallbackOnly}), env, app => app.handle(request, {clientId: request.headers.get("cf-connecting-ip") || "unknown"}));
        } catch (error) {
          logStartupFailure(error);
          return json({error: "Lumiq backend is temporarily unavailable."}, 503);
        }
      }

      return env.ASSETS.fetch(request);
    }
  };
}

export function createQueueConsumer(getApp) {
  return async (batch, env) => {
    const deadLetter = typeof env.LUMIQ_JOBS_DLQ_NAME === "string" && batch.queue === env.LUMIQ_JOBS_DLQ_NAME;
    const retry = message => message.retry({delaySeconds: 60});
    if (!isReleaseApproved(env.PLATFORM_MODE, env.PLATFORM_RELEASE_APPROVED)) {
      for (const message of batch.messages) retry(message);
      return;
    }
    for (const message of batch.messages) {
      const jobId = message.body?.jobId;
      if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
        message.ack();
        continue;
      }
      let app;
      try {
        app = await getApp(env);
        if (deadLetter) await app.jobs.deadLetter(jobId);
        else await app.jobs.tick({concurrency: 1, maxJobs: 1, jobIds: [jobId]});
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({component: "queue-consumer", error: error?.name || "processing-failed"}));
        retry(message);
      } finally {
        if (app) await app.db.close().catch(() => {});
      }
    }
  };
}
