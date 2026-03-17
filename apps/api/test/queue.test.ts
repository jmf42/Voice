import { describe, expect, it, vi } from 'vitest';

const addMock = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    add = addMock;
    close = vi.fn();
  },
}));

describe('BullQueueClient', () => {
  it('sanitizes BullMQ job ids while preserving the original idempotency key payload', async () => {
    addMock.mockReset();

    const { BullQueueClient } = await import('../src/queue.js');
    const queue = new BullQueueClient('redis://localhost:6379');

    await queue.enqueue('sms-retry', {
      tenantId: 'demo-tenant',
      idempotencyKey: 'call-1:normal',
      payload: { callId: 'call-1' },
    });

    expect(addMock).toHaveBeenCalledWith(
      'call-1:normal',
      expect.objectContaining({
        idempotencyKey: 'call-1:normal',
      }),
      expect.objectContaining({
        jobId: 'sms-retry__call-1_normal',
      }),
    );
  });
});
