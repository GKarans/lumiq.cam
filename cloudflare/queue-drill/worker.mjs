const logAttempt = (queue, attempt, outcome) => {
  console.log(JSON.stringify({component: "queue-drill", queue, attempt, outcome}));
};

export default {
  async queue(batch, env) {
    const isDeadLetter = batch.queue === env.DRILL_DLQ_QUEUE;

    for (const message of batch.messages) {
      if (isDeadLetter) {
        logAttempt(batch.queue, message.attempts, "dead-letter-ack");
        message.ack();
      } else {
        logAttempt(batch.queue, message.attempts, "forced-retry");
        message.retry({delaySeconds: 1});
      }
    }
  }
};
