import { randomUUID } from 'node:crypto';
import { chooseJobStatus, ensureQualifiedJob, type CallOutcome } from '@dispatchos/shared';
import { auditTypeForMessageStatus } from './message-audit.js';
import type {
  AuditLog,
  CalendarConnection,
  CallRecord,
  CallStep,
  JobRecord,
  MessageRecord,
  Tenant,
  TenantSettingsRecord,
} from './types.js';

function now(): Date {
  return new Date();
}

export interface Store {
  createTenant(args: {
    tenantId: string;
    businessName: string;
    businessPhone: string;
    escalationPhone: string;
  }): Promise<Tenant>;
  getTenantSettings(tenantId: string): Promise<TenantSettingsRecord>;
  patchTenantSettings(tenantId: string, patch: Partial<TenantSettingsRecord>): Promise<TenantSettingsRecord>;
  startCall(args: { tenantId: string; callSid: string; callerPhone: string }): Promise<CallRecord>;
  getCall(callId: string): Promise<CallRecord | undefined>;
  getCallBySid(tenantId: string, callSid: string): Promise<CallRecord | undefined>;
  findCallBySid(callSid: string): Promise<CallRecord | undefined>;
  updateCall(callId: string, patch: Partial<CallRecord>): Promise<CallRecord>;
  appendTranscript(callId: string, text: string): Promise<CallRecord>;
  setStep(callId: string, step: CallStep): Promise<CallRecord>;
  addAudit(
    tenantId: string,
    type: string,
    payload: Record<string, unknown>,
    refs?: { callId?: string; jobId?: string },
  ): Promise<void>;
  getAudits(callId: string): Promise<AuditLog[]>;
  finalizeCall(args: {
    callId: string;
    outcome: CallOutcome;
    jobDraft: Record<string, unknown>;
  }): Promise<{ call: CallRecord; job: JobRecord; created: boolean }>;
  listJobs(tenantId: string, status?: JobRecord['status']): Promise<JobRecord[]>;
  getJob(tenantId: string, jobId: string): Promise<JobRecord | undefined>;
  updateJob(tenantId: string, jobId: string, patch: Partial<JobRecord>): Promise<JobRecord>;
  createMessage(data: Omit<MessageRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MessageRecord>;
  updateMessageStatus(providerSid: string, status: MessageRecord['status']): Promise<MessageRecord | undefined>;
  upsertCalendarConnection(data: Omit<CalendarConnection, 'id' | 'createdAt' | 'updatedAt'>): Promise<CalendarConnection>;
  getCalendarConnection(tenantId: string): Promise<CalendarConnection | undefined>;
  getMetrics(tenantId: string): Promise<{
    calls_total: number;
    calls_completed: number;
    qualification_completion_rate: number;
    urgent_jobs: number;
    sms_delivery_success: number;
    open_jobs: number;
    overdue_urgent_jobs: number;
    unconfirmed_address_jobs: number;
    manual_booking_jobs: number;
  }>;
  close?(): Promise<void>;
}

export class InMemoryStore implements Store {
  private tenants = new Map<string, Tenant>();
  private settings = new Map<string, TenantSettingsRecord>();
  private calls = new Map<string, CallRecord>();
  private callsBySid = new Map<string, string>();
  private jobs = new Map<string, JobRecord>();
  private jobsByCallId = new Map<string, string>();
  private messages = new Map<string, MessageRecord>();
  private calendars = new Map<string, CalendarConnection>();
  private audits: AuditLog[] = [];

  constructor() {
    this.createTenant({
      tenantId: 'demo-tenant',
      businessName: 'DispatchOS Demo Heating',
      businessPhone: '+41225550999',
      escalationPhone: '+41225550123',
    });
  }

  async createTenant(args: {
    tenantId: string;
    businessName: string;
    businessPhone: string;
    escalationPhone: string;
  }): Promise<Tenant> {
    const existing = this.tenants.get(args.tenantId);
    if (existing) return existing;
    const created = { id: args.tenantId, createdAt: now() };
    this.tenants.set(args.tenantId, created);
    this.settings.set(args.tenantId, {
      tenantId: args.tenantId,
      enabled: true,
      business_name: args.businessName,
      escalation_phone: args.escalationPhone,
      callback_sla_minutes: 30,
      business_phone: args.businessPhone,
      languages: ['fr', 'en'],
      calendar_enabled: false,
      business_context: '',
      vertical: 'other',
      website_url: '',
      opening_hours: {},
      recording_consent_enabled: false,
      faqs: [],
      services: [],
    });
    return created;
  }

  async getTenantSettings(tenantId: string): Promise<TenantSettingsRecord> {
    if (!this.tenants.has(tenantId)) {
      throw new Error(`Unknown tenant ${tenantId}`);
    }
    const settings = this.settings.get(tenantId);
    if (!settings) {
      throw new Error(`Missing settings for tenant ${tenantId}`);
    }
    return settings;
  }

  async patchTenantSettings(tenantId: string, patch: Partial<TenantSettingsRecord>): Promise<TenantSettingsRecord> {
    const current = await this.getTenantSettings(tenantId);
    const next = { ...current, ...patch, tenantId };
    this.settings.set(tenantId, next);
    return next;
  }

  async startCall(args: { tenantId: string; callSid: string; callerPhone: string }): Promise<CallRecord> {
    await this.getTenantSettings(args.tenantId);
    const existingId = this.callsBySid.get(`${args.tenantId}:${args.callSid}`);
    if (existingId) {
      const existing = this.calls.get(existingId);
      if (!existing) {
        throw new Error('Corrupted call index');
      }
      return existing;
    }

    const record: CallRecord = {
      id: randomUUID(),
      tenantId: args.tenantId,
      twilioCallSid: args.callSid,
      callerPhone: args.callerPhone,
      currentStep: 'problem',
      addressConfirmed: false,
      urgency: 'normal',
      lowConfidenceCount: 0,
      transcript: [],
      createdAt: now(),
      updatedAt: now(),
    };

    this.calls.set(record.id, record);
    this.callsBySid.set(`${args.tenantId}:${args.callSid}`, record.id);
    await this.addAudit(args.tenantId, 'CALL_STARTED', { callId: record.id, callSid: args.callSid });
    return record;
  }

  async getCall(callId: string): Promise<CallRecord | undefined> {
    return this.calls.get(callId);
  }

  async getCallBySid(tenantId: string, callSid: string): Promise<CallRecord | undefined> {
    const callId = this.callsBySid.get(`${tenantId}:${callSid}`);
    if (!callId) return undefined;
    return this.calls.get(callId);
  }

  async findCallBySid(callSid: string): Promise<CallRecord | undefined> {
    for (const [key, callId] of this.callsBySid.entries()) {
      const [, sid] = key.split(':');
      if (sid === callSid) {
        return this.calls.get(callId);
      }
    }
    return undefined;
  }

  async updateCall(callId: string, patch: Partial<CallRecord>): Promise<CallRecord> {
    const existing = this.calls.get(callId);
    if (!existing) throw new Error('Call not found');
    const next: CallRecord = { ...existing, ...patch, updatedAt: now() };
    this.calls.set(callId, next);
    return next;
  }

  async appendTranscript(callId: string, text: string): Promise<CallRecord> {
    const call = await this.getCall(callId);
    if (!call) throw new Error('Call not found');
    return this.updateCall(callId, { transcript: [...call.transcript, text] });
  }

  async setStep(callId: string, step: CallStep): Promise<CallRecord> {
    return this.updateCall(callId, { currentStep: step });
  }

  async addAudit(
    tenantId: string,
    type: string,
    payload: Record<string, unknown>,
    refs?: { callId?: string; jobId?: string },
  ): Promise<void> {
    this.audits.push({
      id: randomUUID(),
      tenantId,
      callId: refs?.callId,
      jobId: refs?.jobId,
      type,
      payload,
      createdAt: now(),
    });
  }

  async getAudits(callId: string): Promise<AuditLog[]> {
    return this.audits.filter((a) => a.callId === callId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async finalizeCall(args: {
    callId: string;
    outcome: CallOutcome;
    jobDraft: Record<string, unknown>;
  }): Promise<{ call: CallRecord; job: JobRecord; created: boolean }> {
    const call = await this.getCall(args.callId);
    if (!call) throw new Error('Call not found');

    const existingJobId = this.jobsByCallId.get(args.callId);
    if (existingJobId) {
      const existingJob = this.jobs.get(existingJobId);
      if (!existingJob) throw new Error('Corrupted job index');
      return { call, job: existingJob, created: false };
    }

    const validated = ensureQualifiedJob(args.jobDraft);
    const job: JobRecord = {
      id: randomUUID(),
      tenantId: call.tenantId,
      callId: call.id,
      status: chooseJobStatus(validated.urgency),
      booking_status: 'not_requested',
      ...validated,
      createdAt: now(),
      updatedAt: now(),
    };

    const finalizedCall = await this.updateCall(call.id, { outcome: args.outcome });
    this.jobs.set(job.id, job);
    this.jobsByCallId.set(call.id, job.id);
    await this.addAudit(call.tenantId, 'CALL_TERMINATED', { outcome: args.outcome }, { callId: call.id, jobId: job.id });
    return { call: finalizedCall, job, created: true };
  }

  async listJobs(tenantId: string, status?: JobRecord['status']): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.tenantId === tenantId)
      .filter((job) => (status ? job.status === status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getJob(tenantId: string, jobId: string): Promise<JobRecord | undefined> {
    const job = this.jobs.get(jobId);
    if (!job || job.tenantId !== tenantId) return undefined;
    return job;
  }

  async updateJob(tenantId: string, jobId: string, patch: Partial<JobRecord>): Promise<JobRecord> {
    const existing = await this.getJob(tenantId, jobId);
    if (!existing) throw new Error('Job not found');
    const next = { ...existing, ...patch, updatedAt: now() };
    this.jobs.set(jobId, next);
    await this.addAudit(tenantId, 'JOB_UPDATED', patch as Record<string, unknown>, {
      callId: existing.callId,
      jobId: jobId,
    });
    return next;
  }

  async createMessage(data: Omit<MessageRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MessageRecord> {
    const message: MessageRecord = {
      ...data,
      id: randomUUID(),
      createdAt: now(),
      updatedAt: now(),
    };
    this.messages.set(message.id, message);
    await this.addAudit(
      data.tenantId,
      auditTypeForMessageStatus(message.status),
      { messageId: message.id, status: message.status },
      { callId: data.callId },
    );
    return message;
  }

  async updateMessageStatus(providerSid: string, status: MessageRecord['status']): Promise<MessageRecord | undefined> {
    const target = [...this.messages.values()].find((msg) => msg.providerSid === providerSid);
    if (!target) return undefined;
    const next = { ...target, status, updatedAt: now() };
    this.messages.set(next.id, next);
    return next;
  }

  async upsertCalendarConnection(
    data: Omit<CalendarConnection, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CalendarConnection> {
    const existing = [...this.calendars.values()].find(
      (conn) => conn.tenantId === data.tenantId && conn.provider === 'google',
    );

    if (existing) {
      const next = { ...existing, ...data, updatedAt: now() };
      this.calendars.set(existing.id, next);
      return next;
    }

    const created: CalendarConnection = {
      ...data,
      id: randomUUID(),
      createdAt: now(),
      updatedAt: now(),
    };

    this.calendars.set(created.id, created);
    return created;
  }

  async getCalendarConnection(tenantId: string): Promise<CalendarConnection | undefined> {
    return [...this.calendars.values()].find((conn) => conn.tenantId === tenantId && conn.provider === 'google');
  }

  async getMetrics(tenantId: string): Promise<{
    calls_total: number;
    calls_completed: number;
    qualification_completion_rate: number;
    urgent_jobs: number;
    sms_delivery_success: number;
    open_jobs: number;
    overdue_urgent_jobs: number;
    unconfirmed_address_jobs: number;
    manual_booking_jobs: number;
  }> {
    const calls = [...this.calls.values()].filter((c) => c.tenantId === tenantId);
    const jobs = await this.listJobs(tenantId);
    const messages = [...this.messages.values()].filter((m) => m.tenantId === tenantId);
    const settings = await this.getTenantSettings(tenantId);
    const nowTs = Date.now();
    const overdueCutoff = nowTs - settings.callback_sla_minutes * 60_000;

    const completedCalls = calls.filter((c) => Boolean(c.outcome)).length;
    const openJobs = jobs.filter((job) => job.status === 'urgent' || job.status === 'new');
    const overdueUrgentJobs = jobs.filter(
      (job) => job.status === 'urgent' && job.createdAt.getTime() <= overdueCutoff,
    );

    return {
      calls_total: calls.length,
      calls_completed: completedCalls,
      qualification_completion_rate: calls.length ? completedCalls / calls.length : 0,
      urgent_jobs: jobs.filter((job) => job.status === 'urgent').length,
      sms_delivery_success: messages.length
        ? messages.filter((m) => m.status === 'delivered' || m.status === 'sent').length / messages.length
        : 1,
      open_jobs: openJobs.length,
      overdue_urgent_jobs: overdueUrgentJobs.length,
      unconfirmed_address_jobs: openJobs.filter((job) => !job.address_confirmed).length,
      manual_booking_jobs: jobs.filter((job) => job.status === 'confirmed' && job.booking_status === 'manual_required')
        .length,
    };
  }
}
