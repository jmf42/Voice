import { Queue, Worker, type JobsOptions } from 'bullmq';

export type QueueName = 'sms-retry' | 'calendar-write' | 'transcript-persist' | 'dead-letter';

export interface QueueJobPayload {
  tenantId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

function parseRedisConnection(redisUrl: string): { host: string; port: number } {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
  };
}

export function retryOptions(): JobsOptions {
  return {
    attempts: 4,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  };
}

export class QueueManager {
  private connection: { host: string; port: number };
  private queues: Record<QueueName, Queue<QueueJobPayload>>;

  constructor(redisUrl: string) {
    this.connection = parseRedisConnection(redisUrl);
    this.queues = {
      'sms-retry': new Queue<QueueJobPayload>('sms-retry', { connection: this.connection }),
      'calendar-write': new Queue<QueueJobPayload>('calendar-write', { connection: this.connection }),
      'transcript-persist': new Queue<QueueJobPayload>('transcript-persist', { connection: this.connection }),
      'dead-letter': new Queue<QueueJobPayload>('dead-letter', { connection: this.connection }),
    };
  }

  async enqueue(name: QueueName, payload: QueueJobPayload): Promise<void> {
    await this.queues[name].add(payload.idempotencyKey, payload, {
      ...retryOptions(),
      jobId: `${name}:${payload.idempotencyKey}`,
    });
  }

  createWorker(
    name: QueueName,
    handler: (payload: QueueJobPayload) => Promise<void>,
  ): Worker<QueueJobPayload> {
    return new Worker<QueueJobPayload>(
      name,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.connection },
    );
  }

  async close(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }
}

export class InMemoryQueueManager {
  jobs: Array<{ name: QueueName; payload: QueueJobPayload }> = [];

  async enqueue(name: QueueName, payload: QueueJobPayload): Promise<void> {
    const exists = this.jobs.find((job) => job.name === name && job.payload.idempotencyKey === payload.idempotencyKey);
    if (exists) return;
    this.jobs.push({ name, payload });
  }
}
