import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store.js';

describe('store invariants', () => {
  it('enforces one job per call on finalize retries', async () => {
    const store = new InMemoryStore();
    const call = await store.startCall({ tenantId: 'demo-tenant', callSid: 'CA-INVARIANT', callerPhone: '+4179000010' });

    await store.updateCall(call.id, {
      issueText: 'Leak under sink',
      addressRaw: 'Rue 10 Geneva',
      addressConfirmed: true,
      preferredTimeWindow: 'morning',
      urgency: 'normal',
    });

    const draft = {
      caller_phone: '+4179000010',
      address_raw: 'Rue 10 Geneva',
      address_confirmed: true,
      urgency: 'normal' as const,
      preferred_time_window: 'morning' as const,
      job_summary: 'Leak under sink',
    };

    const first = await store.finalizeCall({ callId: call.id, outcome: 'QUALIFIED_JOB', jobDraft: draft });
    const second = await store.finalizeCall({ callId: call.id, outcome: 'ESCALATED_CALLBACK_SLA', jobDraft: draft });

    expect(first.job.id).toBe(second.job.id);
    expect(await store.listJobs('demo-tenant')).toHaveLength(1);
  });

  it('is tenant isolated for jobs list', async () => {
    const store = new InMemoryStore();
    await store.createTenant({
      tenantId: 'tenant-b',
      businessName: 'Tenant B Heating',
      businessPhone: '+4179000012',
      escalationPhone: '+4179000013',
    });
    const call = await store.startCall({ tenantId: 'tenant-b', callSid: 'CA-B', callerPhone: '+4179000011' });

    await store.finalizeCall({
      callId: call.id,
      outcome: 'QUALIFIED_JOB',
      jobDraft: {
        caller_phone: '+4179000011',
        address_raw: 'Address B',
        address_confirmed: true,
        urgency: 'normal',
        preferred_time_window: 'afternoon',
        job_summary: 'Maintenance call',
      },
    });

    expect(await store.listJobs('demo-tenant')).toHaveLength(0);
    expect(await store.listJobs('tenant-b')).toHaveLength(1);
  });
});
