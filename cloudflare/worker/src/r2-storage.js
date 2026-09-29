import {Readable} from "node:stream";
import {Fault} from "../../../platform/server/security.mjs";

function validKey(key) {
  if (typeof key !== "string" || !/^[a-zA-Z0-9/_ .-]+$/.test(key) || key.startsWith("/") || key.split("/").some(part => part === ".." || part === ".")) {
    throw new TypeError("Invalid R2 object key.");
  }
  return key;
}

function readLimits(limits) {
  const value = (name) => {
    const parsed = Number(limits?.[name]);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new TypeError(`A positive integer R2 safety limit is required: ${name}.`);
    }
    return parsed;
  };
  return {
    classAOpsPerMonth: value("classAOpsPerMonth"),
    classBOpsPerMonth: value("classBOpsPerMonth"),
    lifetimeWriteBytes: value("lifetimeWriteBytes"),
    streamWriteBytes: value("streamWriteBytes")
  };
}

function fixedLengthStream(length) {
  if (typeof globalThis.FixedLengthStream === "function") return new globalThis.FixedLengthStream(length);
  let bytes = 0;
  return new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > length) throw new TypeError("Stream exceeded its declared length.");
      controller.enqueue(chunk);
    },
    flush() {
      if (bytes !== length) throw new TypeError("Stream did not match its declared length.");
    }
  });
}

export function createR2Storage(bucket, options = {}) {
  if (!bucket || typeof bucket.put !== "function" || typeof bucket.get !== "function") {
    throw new TypeError("An R2 bucket binding is required.");
  }
  const budget = options.db ? {db: options.db, limits: readLimits(options.limits)} : null;
  if (Boolean(options.db) !== Boolean(options.limits)) {
    throw new TypeError("Both a database and explicit R2 safety limits are required.");
  }

  async function reserve({classA = 0, classB = 0, bytes = 0}) {
    if (!budget) return;
    if (classA > budget.limits.classAOpsPerMonth || classB > budget.limits.classBOpsPerMonth || bytes > budget.limits.lifetimeWriteBytes) {
      throw new Fault(413, "This storage operation exceeds the configured safety limit.");
    }
    const result = await budget.db.query(
      "select public.reserve_r2_budget($1,$2,$3,$4,$5,$6) as reserved",
      [classA, classB, bytes, budget.limits.classAOpsPerMonth, budget.limits.classBOpsPerMonth, budget.limits.lifetimeWriteBytes]
    );
    if (result.rows[0]?.reserved !== true) {
      throw new Fault(429, "The configured photo-storage safety allowance has been reached. New storage operations are paused.");
    }
  }

  return {
    remote: true,
    async put(key, bytes, contentType = "image/webp") {
      await reserve({classA: 1, bytes: bytes.byteLength});
      await bucket.put(validKey(key), bytes, { httpMetadata: { contentType } });
    },
    async putStream(key, stream, contentType = "application/octet-stream", {maxBytes, contentLength} = {}) {
      let body = typeof stream?.getReader === "function" ? stream : Readable.toWeb(stream);
      if (budget) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > budget.limits.streamWriteBytes || !Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maxBytes) {
          throw new Fault(413, "This export exceeds the configured storage safety limit.");
        }
        await reserve({classA: 1, bytes: contentLength});
        let actualBytes = 0;
        body = body.pipeThrough(new TransformStream({
          transform(chunk, controller) {
            actualBytes += chunk.byteLength;
            if (actualBytes > maxBytes) throw new Fault(413, "This export exceeds the configured storage safety limit.");
            controller.enqueue(chunk);
          }
        }));
      }
      if (Number.isSafeInteger(contentLength) && contentLength > 0) {
        const fixed = fixedLengthStream(contentLength);
        await Promise.all([
          body.pipeTo(fixed.writable),
          bucket.put(validKey(key), fixed.readable, { httpMetadata: { contentType } })
        ]);
      } else {
        await bucket.put(validKey(key), body, { httpMetadata: { contentType } });
      }
    },
    async get(key) {
      await reserve({classB: 1});
      const object = await bucket.get(validKey(key));
      if (!object) throw new Error("R2 object not found.");
      return Buffer.from(await object.arrayBuffer());
    },
    async getStream(key) {
      await reserve({classB: 1});
      const object = await bucket.get(validKey(key));
      if (!object) throw new Error("R2 object not found.");
      return object.body;
    },
    async remove(key) {
      await reserve({classA: 1});
      await bucket.delete(validKey(key));
    },
    async size(key) {
      await reserve({classB: 1});
      const object = await bucket.head(validKey(key));
      if (!object) throw new Error("R2 object not found.");
      return object.size;
    }
  };
}
