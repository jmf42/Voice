import { PrismaClient, type Prisma } from '@prisma/client';
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
import type { Store } from './store.js';

function parseTranscript(input?: string | null): string[] {
  if (!input) return [];
  return input.split('\n').filter((line) => line.length > 0);
}

function serializeTranscript(input: string[]): string {
  return input.join('\n').slice(0, 10000);
}

function mapCallRecord(db: {
  id: string;
  tenantId: string;
  twilioCallSid: string;
  callerPhone: string;
  currentStep: string;
  languageDetected: string | null;
  issueText: string | null;
  addressRaw: string | null;
  addressConfirmed: boolean;
  preferredTimeWindow: string | null;
  urgency: string;
  lowConfidenceCount: number;
  phoneConfirmed: string | null;
  transcript: string | null;
  outcome: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CallRecord {
  return {
    id: db.id,
    tenantId: db.tenantId,
    twilioCallSid: db.twilioCallSid,
    callerPhone: db.callerPhone,
    currentStep: db.currentStep as CallStep,
    languageDetected: (db.languageDetected ?? undefined) as 'fr' | 'en' | undefined,
    issueText: db.issueText ?? undefined,
    addressRaw: db.addressRaw ?? undefined,
    addressConfirmed: db.addressConfirmed,
    preferredTimeWindow: (db.preferredTimeWindow ?? undefined) as
      | 'morning'
      | 'afternoon'
      | 'evening'
      | 'specific'
      | undefined,
    urgency: db.urgency as 'urgent' | 'normal',
    lowConfidenceCount: db.lowConfidenceCount,
    phoneConfirmed: db.phoneConfirmed ?? undefined,
    transcript: parseTranscript(db.transcript),
    outcome: (db.outcome ?? undefined) as CallOutcome | undefined,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

function mapJobRecord(db: {
  id: string;
  tenantId: string;
  callId: string;
  status: string;
  callerPhone: string;
  addressRaw: string;
  addressConfirmed: boolean;
  urgency: string;
  preferredTimeWindow: string;
  jobSummary: string;
  accessNotes: string | null;
  serviceHint: string | null;
  riskFlags: string[];
  languageDetected: string | null;
  transcript: string | null;
  bookingStatus: string | null;
  confirmedSlotStart: Date | null;
  confirmedSlotEnd: Date | null;
  externalEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): JobRecord {
  return {
    id: db.id,
    tenantId: db.tenantId,
    callId: db.callId,
    status: db.status as JobRecord['status'],
    caller_phone: db.callerPhone,
    address_raw: db.addressRaw,
    address_confirmed: db.addressConfirmed,
    urgency: db.urgency as 'urgent' | 'normal',
    preferred_time_window: db.preferredTimeWindow as 'morning' | 'afternoon' | 'evening' | 'specific',
    job_summary: db.jobSummary,
    access_notes: db.accessNotes ?? undefined,
    service_hint: db.serviceHint ?? undefined,
    risk_flags: db.riskFlags,
    language_detected: (db.languageDetected ?? undefined) as 'fr' | 'en' | undefined,
    transcript: db.transcript ?? undefined,
    booking_status: (db.bookingStatus ?? 'not_requested') as 'booked' | 'manual_required' | 'not_requested',
    confirmed_slot_start: db.confirmedSlotStart?.toISOString(),
    confirmed_slot_end: db.confirmedSlotEnd?.toISOString(),
    external_event_id: db.externalEventId ?? undefined,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

function mapMessageRecord(db: {
  id: string;
  tenantId: string;
  callId: string;
  toPhone: string;
  kind: string;
  body: string;
  providerSid: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): MessageRecord {
  return {
    id: db.id,
    tenantId: db.tenantId,
    callId: db.callId,
    toPhone: db.toPhone,
    kind: db.kind as MessageRecord['kind'],
    body: db.body,
    providerSid: db.providerSid ?? undefined,
    status: db.status as MessageRecord['status'],
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

function mapCalendarConnection(db: {
  id: string;
  tenantId: string;
  provider: string;
  refreshToken: string;
  accessToken: string | null;
  calendarId: string;
  createdAt: Date;
  updatedAt: Date;
}): CalendarConnection {
  return {
    id: db.id,
    tenantId: db.tenantId,
    provider: 'google',
    refreshToken: db.refreshToken,
    accessToken: db.accessToken ?? undefined,
    calendarId: db.calendarId,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

function mapAuditLog(db: {
  id: string;
  tenantId: string;
  callId: string | null;
  jobId: string | null;
  type: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): AuditLog {
  return {
    id: db.id,
    tenantId: db.tenantId,
    callId: db.callId ?? undefined,
    jobId: db.jobId ?? undefined,
    type: db.type,
    payload: (db.payload ?? {}) as Record<string, unknown>,
    createdAt: db.createdAt,
  };
}

function toCallPatch(patch: Partial<CallRecord>): Prisma.CallUpdateInput {
  const data: Prisma.CallUpdateInput = {};

  if (patch.callerPhone !== undefined) data.callerPhone = patch.callerPhone;
  if (patch.currentStep !== undefined) data.currentStep = patch.currentStep;
  if (patch.languageDetected !== undefined) data.languageDetected = patch.languageDetected;
  if (patch.issueText !== undefined) data.issueText = patch.issueText;
  if (patch.addressRaw !== undefined) data.addressRaw = patch.addressRaw;
  if (patch.addressConfirmed !== undefined) data.addressConfirmed = patch.addressConfirmed;
  if (patch.preferredTimeWindow !== undefined) data.preferredTimeWindow = patch.preferredTimeWindow;
  if (patch.urgency !== undefined) data.urgency = patch.urgency;
  if (patch.lowConfidenceCount !== undefined) data.lowConfidenceCount = patch.lowConfidenceCount;
  if (patch.phoneConfirmed !== undefined) data.phoneConfirmed = patch.phoneConfirmed;
  if (patch.outcome !== undefined) data.outcome = patch.outcome;
  if (patch.transcript !== undefined) data.transcript = serializeTranscript(patch.transcript);

  return data;
}

function toJobPatch(patch: Partial<JobRecord>): Prisma.JobUpdateInput {
  const data: Prisma.JobUpdateInput = {};

  if (patch.status !== undefined) data.status = patch.status;
  if (patch.caller_phone !== undefined) data.callerPhone = patch.caller_phone;
  if (patch.address_raw !== undefined) data.addressRaw = patch.address_raw;
  if (patch.address_confirmed !== undefined) data.addressConfirmed = patch.address_confirmed;
  if (patch.urgency !== undefined) data.urgency = patch.urgency;
  if (patch.preferred_time_window !== undefined) data.preferredTimeWindow = patch.preferred_time_window;
  if (patch.job_summary !== undefined) data.jobSummary = patch.job_summary;
  if (patch.access_notes !== undefined) data.accessNotes = patch.access_notes;
  if (patch.service_hint !== undefined) data.serviceHint = patch.service_hint;
  if (patch.risk_flags !== undefined) data.riskFlags = patch.risk_flags;
  if (patch.language_detected !== undefined) data.languageDetected = patch.language_detected;
  if (patch.transcript !== undefined) data.transcript = patch.transcript;
  if (patch.booking_status !== undefined) data.bookingStatus = patch.booking_status;
  if (patch.confirmed_slot_start !== undefined) data.confirmedSlotStart = patch.confirmed_slot_start ? new Date(patch.confirmed_slot_start) : null;
  if (patch.confirmed_slot_end !== undefined) data.confirmedSlotEnd = patch.confirmed_slot_end ? new Date(patch.confirmed_slot_end) : null;
  if (patch.external_event_id !== undefined) data.externalEventId = patch.external_event_id;

  return data;
}

export class PrismaStore implements Store {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  async createTenant(args: {
    tenantId: string;
    businessName: string;
    businessPhone: string;
    escalationPhone: string;
  }): Promise<Tenant> {
    const tenant = await this.prisma.tenant.upsert({
      where: { id: args.tenantId },
      update: {},
      create: {
        id: args.tenantId,
        name: args.businessName,
      },
    });

    await this.prisma.tenantSettings.upsert({
      where: { tenantId: args.tenantId },
      update: {},
      create: {
        tenantId: args.tenantId,
        businessName: args.businessName,
        businessPhone: args.businessPhone,
        escalationPhone: args.escalationPhone,
        callbackSlaMinutes: 30,
        enabled: true,
        languages: ['fr', 'en'],
        calendarEnabled: false,
        businessContext: '',
      },
    });

    return {
      id: tenant.id,
      createdAt: tenant.createdAt,
    };
  }

  async getTenantSettings(tenantId: string): Promise<TenantSettingsRecord> {
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings) {
      throw new Error(`Unknown tenant ${tenantId}`);
    }

    return {
      tenantId: settings.tenantId,
      enabled: settings.enabled,
      business_name: settings.businessName,
      escalation_phone: settings.escalationPhone,
      callback_sla_minutes: settings.callbackSlaMinutes,
      business_phone: settings.businessPhone,
      languages: settings.languages as Array<'fr' | 'en'>,
      calendar_enabled: settings.calendarEnabled,
      business_context: settings.businessContext,
      vertical: (settings.vertical ?? 'other') as TenantSettingsRecord['vertical'],
      website_url: settings.websiteUrl ?? '',
      opening_hours: (settings.openingHours ?? {}) as Record<string, string>,
      recording_consent_enabled: settings.recordingConsentEnabled ?? false,
      faqs: (settings.faqs ?? []) as TenantSettingsRecord['faqs'],
      services: (settings.services ?? []) as TenantSettingsRecord['services'],
    };
  }

  async patchTenantSettings(tenantId: string, patch: Partial<TenantSettingsRecord>): Promise<TenantSettingsRecord> {
    await this.getTenantSettings(tenantId);

    const data: Record<string, unknown> = {};
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.business_name !== undefined) data.businessName = patch.business_name;
    if (patch.escalation_phone !== undefined) data.escalationPhone = patch.escalation_phone;
    if (patch.callback_sla_minutes !== undefined) data.callbackSlaMinutes = patch.callback_sla_minutes;
    if (patch.business_phone !== undefined) data.businessPhone = patch.business_phone;
    if (patch.languages !== undefined) data.languages = patch.languages;
    if (patch.calendar_enabled !== undefined) data.calendarEnabled = patch.calendar_enabled;
    if (patch.business_context !== undefined) data.businessContext = patch.business_context;
    if (patch.vertical !== undefined) data.vertical = patch.vertical;
    if (patch.website_url !== undefined) data.websiteUrl = patch.website_url;
    if (patch.opening_hours !== undefined) data.openingHours = patch.opening_hours;
    if (patch.recording_consent_enabled !== undefined) data.recordingConsentEnabled = patch.recording_consent_enabled;
    if (patch.faqs !== undefined) data.faqs = patch.faqs;
    if (patch.services !== undefined) data.services = patch.services;

    const updated = await this.prisma.tenantSettings.update({
      where: { tenantId },
      data,
    });

    return {
      tenantId: updated.tenantId,
      enabled: updated.enabled,
      business_name: updated.businessName,
      escalation_phone: updated.escalationPhone,
      callback_sla_minutes: updated.callbackSlaMinutes,
      business_phone: updated.businessPhone,
      languages: updated.languages as Array<'fr' | 'en'>,
      calendar_enabled: updated.calendarEnabled,
      business_context: updated.businessContext,
      vertical: (updated.vertical ?? 'other') as TenantSettingsRecord['vertical'],
      website_url: updated.websiteUrl ?? '',
      opening_hours: (updated.openingHours ?? {}) as Record<string, string>,
      recording_consent_enabled: updated.recordingConsentEnabled ?? false,
      faqs: (updated.faqs ?? []) as TenantSettingsRecord['faqs'],
      services: (updated.services ?? []) as TenantSettingsRecord['services'],
    };
  }

  async startCall(args: { tenantId: string; callSid: string; callerPhone: string }): Promise<CallRecord> {
    await this.getTenantSettings(args.tenantId);
    const existing = await this.prisma.call.findUnique({
      where: {
        tenantId_twilioCallSid: {
          tenantId: args.tenantId,
          twilioCallSid: args.callSid,
        },
      },
    });

    if (existing) {
      return mapCallRecord(existing);
    }

    const created = await this.prisma.call.create({
      data: {
        tenantId: args.tenantId,
        twilioCallSid: args.callSid,
        callerPhone: args.callerPhone,
        currentStep: 'problem',
        addressConfirmed: false,
        urgency: 'normal',
        lowConfidenceCount: 0,
      },
    });

    await this.addAudit(args.tenantId, 'CALL_STARTED', { callId: created.id, callSid: args.callSid }, { callId: created.id });

    return mapCallRecord(created);
  }

  async getCall(callId: string): Promise<CallRecord | undefined> {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    return call ? mapCallRecord(call) : undefined;
  }

  async getCallBySid(tenantId: string, callSid: string): Promise<CallRecord | undefined> {
    const call = await this.prisma.call.findUnique({
      where: {
        tenantId_twilioCallSid: {
          tenantId,
          twilioCallSid: callSid,
        },
      },
    });
    return call ? mapCallRecord(call) : undefined;
  }

  async findCallBySid(callSid: string): Promise<CallRecord | undefined> {
    const call = await this.prisma.call.findFirst({ where: { twilioCallSid: callSid } });
    return call ? mapCallRecord(call) : undefined;
  }

  async updateCall(callId: string, patch: Partial<CallRecord>): Promise<CallRecord> {
    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: toCallPatch(patch),
    });

    return mapCallRecord(updated);
  }

  async appendTranscript(callId: string, text: string): Promise<CallRecord> {
    const call = await this.getCall(callId);
    if (!call) {
      throw new Error('Call not found');
    }

    const transcript = [...call.transcript, text];
    return this.updateCall(callId, { transcript });
  }

  async setStep(callId: string, step: CallStep): Promise<CallRecord> {
    await this.prisma.callStep.create({
      data: {
        callId,
        step,
        payload: {},
      },
    });

    return this.updateCall(callId, { currentStep: step });
  }

  async addAudit(
    tenantId: string,
    type: string,
    payload: Record<string, unknown>,
    refs?: { callId?: string; jobId?: string },
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        type,
        payload: payload as Prisma.InputJsonValue,
        callId: refs?.callId,
        jobId: refs?.jobId,
      },
    });
  }

  async getAudits(callId: string): Promise<AuditLog[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: { callId },
      orderBy: { createdAt: 'asc' },
    });

    return logs.map(mapAuditLog);
  }

  async finalizeCall(args: {
    callId: string;
    outcome: CallOutcome;
    jobDraft: Record<string, unknown>;
  }): Promise<{ call: CallRecord; job: JobRecord; created: boolean }> {
    const validated = ensureQualifiedJob(args.jobDraft);

    return this.prisma.$transaction(async (tx) => {
      const existingJob = await tx.job.findUnique({ where: { callId: args.callId } });
      if (existingJob) {
        const call = await tx.call.findUnique({ where: { id: args.callId } });
        if (!call) {
          throw new Error('Call not found');
        }
        return {
          call: mapCallRecord(call),
          job: mapJobRecord(existingJob),
          created: false,
        };
      }

      const call = await tx.call.update({
        where: { id: args.callId },
        data: {
          outcome: args.outcome,
        },
      });

      const job = await tx.job.create({
        data: {
          tenantId: call.tenantId,
          callId: call.id,
          status: chooseJobStatus(validated.urgency),
          callerPhone: validated.caller_phone,
          addressRaw: validated.address_raw,
          addressConfirmed: validated.address_confirmed,
          urgency: validated.urgency,
          preferredTimeWindow: validated.preferred_time_window,
          jobSummary: validated.job_summary,
          accessNotes: validated.access_notes,
          serviceHint: validated.service_hint,
          riskFlags: validated.risk_flags ?? [],
          languageDetected: validated.language_detected,
          transcript: validated.transcript,
          bookingStatus: 'not_requested',
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: call.tenantId,
          callId: call.id,
          jobId: job.id,
          type: 'CALL_TERMINATED',
          payload: { outcome: args.outcome },
        },
      });

      return {
        call: mapCallRecord(call),
        job: mapJobRecord(job),
        created: true,
      };
    });
  }

  async listJobs(tenantId: string, status?: JobRecord['status']): Promise<JobRecord[]> {
    const jobs = await this.prisma.job.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return jobs.map(mapJobRecord);
  }

  async getJob(tenantId: string, jobId: string): Promise<JobRecord | undefined> {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        tenantId,
      },
    });

    return job ? mapJobRecord(job) : undefined;
  }

  async updateJob(tenantId: string, jobId: string, patch: Partial<JobRecord>): Promise<JobRecord> {
    const existing = await this.getJob(tenantId, jobId);
    if (!existing) {
      throw new Error('Job not found');
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: toJobPatch(patch),
    });

    await this.addAudit(tenantId, 'JOB_UPDATED', patch as Record<string, unknown>, {
      callId: updated.callId,
      jobId: updated.id,
    });

    return mapJobRecord(updated);
  }

  async createMessage(data: Omit<MessageRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MessageRecord> {
    const created = await this.prisma.message.create({
      data: {
        tenantId: data.tenantId,
        callId: data.callId,
        toPhone: data.toPhone,
        kind: data.kind,
        body: data.body,
        providerSid: data.providerSid,
        status: data.status,
      },
    });
    const messageStatus = created.status as MessageRecord['status'];

    await this.addAudit(
      data.tenantId,
      auditTypeForMessageStatus(messageStatus),
      { messageId: created.id, status: messageStatus },
      { callId: data.callId },
    );

    return mapMessageRecord(created);
  }

  async updateMessageStatus(providerSid: string, status: MessageRecord['status']): Promise<MessageRecord | undefined> {
    const existing = await this.prisma.message.findUnique({ where: { providerSid } });
    if (!existing) {
      return undefined;
    }

    const updated = await this.prisma.message.update({
      where: { id: existing.id },
      data: { status },
    });

    return mapMessageRecord(updated);
  }

  async upsertCalendarConnection(
    data: Omit<CalendarConnection, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CalendarConnection> {
    const existing = await this.prisma.calendarConnection.findFirst({
      where: {
        tenantId: data.tenantId,
        provider: data.provider,
      },
    });

    if (existing) {
      const updated = await this.prisma.calendarConnection.update({
        where: { id: existing.id },
        data: {
          refreshToken: data.refreshToken,
          accessToken: data.accessToken,
          calendarId: data.calendarId,
        },
      });

      return mapCalendarConnection(updated);
    }

    const created = await this.prisma.calendarConnection.create({
      data: {
        tenantId: data.tenantId,
        provider: data.provider,
        refreshToken: data.refreshToken,
        accessToken: data.accessToken,
        calendarId: data.calendarId,
      },
    });

    return mapCalendarConnection(created);
  }

  async getCalendarConnection(tenantId: string): Promise<CalendarConnection | undefined> {
    const connection = await this.prisma.calendarConnection.findFirst({
      where: {
        tenantId,
        provider: 'google',
      },
    });

    return connection ? mapCalendarConnection(connection) : undefined;
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
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const callbackSlaMinutes = settings?.callbackSlaMinutes ?? 30;
    const overdueCutoff = new Date(Date.now() - callbackSlaMinutes * 60_000);

    const callsTotal = await this.prisma.call.count({ where: { tenantId } });
    const callsCompleted = await this.prisma.call.count({ where: { tenantId, outcome: { not: null } } });
    const urgentJobs = await this.prisma.job.count({ where: { tenantId, status: 'urgent' } });
    const openJobs = await this.prisma.job.count({ where: { tenantId, status: { in: ['urgent', 'new'] } } });
    const overdueUrgentJobs = await this.prisma.job.count({
      where: {
        tenantId,
        status: 'urgent',
        createdAt: { lte: overdueCutoff },
      },
    });
    const unconfirmedAddressJobs = await this.prisma.job.count({
      where: {
        tenantId,
        status: { in: ['urgent', 'new'] },
        addressConfirmed: false,
      },
    });
    const manualBookingJobs = await this.prisma.job.count({
      where: {
        tenantId,
        status: 'confirmed',
        bookingStatus: 'manual_required',
      },
    });
    const messagesTotal = await this.prisma.message.count({ where: { tenantId } });
    const deliveredMessages = await this.prisma.message.count({
      where: {
        tenantId,
        status: { in: ['delivered', 'sent'] },
      },
    });

    return {
      calls_total: callsTotal,
      calls_completed: callsCompleted,
      qualification_completion_rate: callsTotal ? callsCompleted / callsTotal : 0,
      urgent_jobs: urgentJobs,
      sms_delivery_success: messagesTotal ? deliveredMessages / messagesTotal : 1,
      open_jobs: openJobs,
      overdue_urgent_jobs: overdueUrgentJobs,
      unconfirmed_address_jobs: unconfirmedAddressJobs,
      manual_booking_jobs: manualBookingJobs,
    };
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
