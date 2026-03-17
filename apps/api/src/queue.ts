import { Queue, type JobsOptions } from 'bullmq';
import { buildRedisConnectionOptions } from '@dispatchos/config';

export type QueueName = 'sms-retry' | 'calendar-write' | 'transcript-persist' | 'dead-letter';

export interface QueuePayload {
  tenantId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface QueueClient {
  enqueue(name: QueueName, payload: QueuePayload): Promise<void>;
  close?(): Promise<void>;
}

export function queueRetryPolicy(): JobsOptions {
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

function buildQueueJobId(name: QueueName, idempotencyKey: string): string {
  return `${name}__${idempotencyKey.replaceAll(':', '_')}`;
}

export class BullQueueClient implements QueueClient {
  private readonly queues: Record<QueueName, Queue<QueuePayload>>;

  constructor(redisUrl: string) {
    const connection = buildRedisConnectionOptions(redisUrl);
    this.queues = {
      'sms-retry': new Queue<QueuePayload>('sms-retry', { connection }),
      'calendar-write': new Queue<QueuePayload>('calendar-write', { connection }),
      'transcript-persist': new Queue<QueuePayload>('transcript-persist', { connection }),
      'dead-letter': new Queue<QueuePayload>('dead-letter', { connection }),
    };
  }

  async enqueue(name: QueueName, payload: QueuePayload): Promise<void> {
    await this.queues[name].add(payload.idempotencyKey, payload, {
      ...queueRetryPolicy(),
      jobId: buildQueueJobId(name, payload.idempotencyKey),
    });
  }

  async close(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }
}

export class InMemoryQueueClient implements QueueClient {
  jobs: Array<{ name: QueueName; payload: QueuePayload }> = [];

  async enqueue(name: QueueName, payload: QueuePayload): Promise<void> {
    const exists = this.jobs.find((job) => job.name === name && job.payload.idempotencyKey === payload.idempotencyKey);
    if (exists) return;
    this.jobs.push({ name, payload });
  }
}
