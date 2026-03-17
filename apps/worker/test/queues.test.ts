import { describe, expect, it, vi } from 'vitest';
import { InMemoryQueueManager, retryOptions } from '../src/queues.js';
import { buildWorkerRuntimeSummary } from '../src/runtime.js';
import { retryCalendarWriteJob } from '../src/calendar-retry.js';
import { buildRedisConnectionOptions } from '@dispatchos/config';

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

  it('preserves managed redis connection details', () => {
    const options = buildRedisConnectionOptions('rediss://user:secret@example.redis:6380/2');

    expect(options).toMatchObject({
      host: 'example.redis',
      port: 6380,
      username: 'user',
      password: 'secret',
      db: 2,
    });
    expect(options.tls).toEqual({});
  });

  it('posts calendar retry jobs back to the api recovery endpoint', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return {
        ok: true,
        text: async () => '',
      } as Response;
    });

    await retryCalendarWriteJob({
      apiBaseUrl: 'https://voice.example.com',
      queueSecret: 'queue-secret',
      payload: {
        tenantId: 'demo-tenant',
        jobId: 'job-1',
        slotStart: '2026-03-08T20:00:00.000Z',
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe('https://voice.example.com/internal/queue/calendar-write');
    expect(fetchCalls[0]?.init?.method).toBe('POST');
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-queue-secret': 'queue-secret',
    });
  });
});
