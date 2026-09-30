import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../cloudflare/queue-drill/worker.mjs";

test("isolated queue drill retries main-queue messages without reading their bodies", async () => {
  const calls = [];
  const message = {
    attempts: 1,
    body: {secret: "must-not-be-logged"},
    retry: options => calls.push(["retry", options]),
    ack: () => calls.push(["ack"])
  };
  const originalLog = console.log;
  const logs = [];
  console.log = value => logs.push(value);
  try {
    await worker.queue({queue: "main", messages: [message]}, {DRILL_DLQ_QUEUE: "dlq"});
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(calls, [["retry", {delaySeconds: 1}]]);
  assert.deepEqual(JSON.parse(logs[0]), {
    component: "queue-drill", queue: "main", attempt: 1, outcome: "forced-retry"
  });
  assert.doesNotMatch(logs.join(""), /must-not-be-logged/);
});

test("isolated queue drill acknowledges messages only on its DLQ", async () => {
  const calls = [];
  const message = {
    attempts: 3,
    retry: options => calls.push(["retry", options]),
    ack: () => calls.push(["ack"])
  };
  const originalLog = console.log;
  const logs = [];
  console.log = value => logs.push(value);
  try {
    await worker.queue({queue: "dlq", messages: [message]}, {DRILL_DLQ_QUEUE: "dlq"});
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(calls, [["ack"]]);
  assert.deepEqual(JSON.parse(logs[0]), {
    component: "queue-drill", queue: "dlq", attempt: 3, outcome: "dead-letter-ack"
  });
});
