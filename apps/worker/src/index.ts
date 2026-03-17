import { parseEnv } from '@dispatchos/config';
import twilio from 'twilio';
import type { Worker } from 'bullmq';
import { QueueManager, type QueueJobPayload, type QueueName } from './queues.js';
import { buildWorkerRuntimeSummary } from './runtime.js';
import { retryCalendarWriteJob } from './calendar-retry.js';

function isTwilioConfigured(accountSid: string, authToken: string, phone: string): boolean {
  return !accountSid.startsWith('AC_TEST') && authToken !== 'token' && !phone.includes('00000000');
}

async function main() {
  const env = parseEnv({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    APP_BASE_URL: process.env.APP_BASE_URL,
    API_BASE_URL: process.env.API_BASE_URL,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://dispatch:dispatch@localhost:5432/dispatchos',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? 'AC_TEST',
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? 'token',
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ?? '+41000000000',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    QUEUE_SHARED_SECRET: process.env.QUEUE_SHARED_SECRET,
    STORE_MODE: process.env.STORE_MODE,
    QUEUE_MODE: process.env.QUEUE_MODE,
  });

  const manager = new QueueManager(env.REDIS_URL);
  const twilioClient = isTwilioConfigured(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER)
    ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
    : null;
  const runtime = buildWorkerRuntimeSummary({
    nodeEnv: env.NODE_ENV,
    queueMode: env.QUEUE_MODE,
    managedRuntime: Boolean(process.env.K_SERVICE || process.env.K_REVISION || process.env.RENDER),
    twilioConfigured: Boolean(twilioClient),
  });

  const criticalIssue = runtime.issues.find((issue) => issue.severity === 'critical');
  if (criticalIssue) {
    throw new Error(criticalIssue.message);
  }

  for (const issue of runtime.issues) {
    if (issue.severity === 'warning') {
      console.warn(issue.message);
    }
  }

  async function sendToDeadLetter(name: QueueName, payload: QueueJobPayload, message: string): Promise<void> {
    await manager.enqueue('dead-letter', {
      tenantId: payload.tenantId,
      idempotencyKey: `${name}:${payload.idempotencyKey}:dlq`,
      payload: {
        ...payload.payload,
        failedQueue: name,
        reason: message,
      },
    });
  }

  function attachFailureHook(name: QueueName, worker: Worker<QueueJobPayload>): void {
    worker.on('failed', async (job, error) => {
      if (!job) return;
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= maxAttempts) {
        await sendToDeadLetter(name, job.data, error.message);
      }
    });
  }

  const smsWorker = manager.createWorker('sms-retry', async (job) => {
    const toPhone = String(job.payload.toPhone ?? '');
    const body = String(job.payload.body ?? 'DispatchOS: request received. We will call shortly.');

    if (!toPhone) {
      throw new Error('sms-retry missing toPhone');
    }

    if (!twilioClient) {
      console.warn('sms-retry running without live Twilio credentials, skipping send', { idempotencyKey: job.idempotencyKey });
      return;
    }

    await twilioClient.messages.create({
      to: toPhone,
      from: env.TWILIO_PHONE_NUMBER,
      body,
      statusCallback: `${env.API_BASE_URL}/v1/sms/status`,
    });
  });

  const calendarWorker = manager.createWorker('calendar-write', async (job) => {
    await retryCalendarWriteJob({
      apiBaseUrl: env.API_BASE_URL,
      queueSecret: env.QUEUE_SHARED_SECRET,
      payload: {
        tenantId: job.tenantId,
        jobId: String(job.payload.jobId ?? ''),
        slotStart:
          typeof job.payload.slotStart === 'string' ? job.payload.slotStart : undefined,
        slotEnd: typeof job.payload.slotEnd === 'string' ? job.payload.slotEnd : undefined,
      },
    });
  });

  const transcriptWorker = manager.createWorker('transcript-persist', async (job) => {
    console.info('transcript-persist event captured', {
      tenantId: job.tenantId,
      idempotencyKey: job.idempotencyKey,
    });
  });

  attachFailureHook('sms-retry', smsWorker);
  attachFailureHook('calendar-write', calendarWorker);
  attachFailureHook('transcript-persist', transcriptWorker);

  console.log('DispatchOS worker running', runtime);

  const shutdown = async () => {
    await Promise.all([smsWorker.close(), calendarWorker.close(), transcriptWorker.close()]);
    await manager.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
