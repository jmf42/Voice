import { describe, expect, it } from 'vitest';
import { InMemoryQueueManager, retryOptions } from '../src/queues.js';
import { buildWorkerRuntimeSummary } from '../src/runtime.js';

describe('queue behavior', () => {
  it('defines retry policy', () => {
    const policy = retryOptions();
    expect(policy.attempts).toBe(4);
    expect(policy.backoff).toEqual({ type: 'exponential', delay: 1000 });
  });

  it('is idempotent on in-memory queue', async () => {
    const queue = new InMemoryQueueManager();

    await queue.enqueue('sms-retry', {
      tenantId: 'demo-tenant',
      idempotencyKey: 'abc',
      payload: { messageId: 'm1' },
    });

    await queue.enqueue('sms-retry', {
      tenantId: 'demo-tenant',
      idempotencyKey: 'abc',
      payload: { messageId: 'm1' },
    });

    expect(queue.jobs).toHaveLength(1);
  });

  it('supports dead-letter queue payloads', async () => {
    const queue = new InMemoryQueueManager();
    await queue.enqueue('dead-letter', {
      tenantId: 'demo-tenant',
      idempotencyKey: 'dead-1',
      payload: { reason: 'failure' },
    });

    expect(queue.jobs[0]?.name).toBe('dead-letter');
  });

  it('flags non-durable production worker setups', () => {
    const summary = buildWorkerRuntimeSummary({
      nodeEnv: 'production',
      queueMode: 'memory',
      managedRuntime: true,
      twilioConfigured: false,
    });

    expect(summary.queueDurable).toBe(false);
    expect(summary.issues.map((issue) => issue.code)).toContain('inmemory-queue');
    expect(summary.issues.map((issue) => issue.code)).toContain('twilio-not-configured');
  });
});
