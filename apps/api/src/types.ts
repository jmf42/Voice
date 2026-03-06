import type {
  CallOutcome,
  JobStatus,
  QualifiedJob,
  TenantSettings,
  TimeWindow,
  Urgency,
} from '@dispatchos/shared';

export type CallStep = 'problem' | 'address' | 'address_confirm' | 'time_window' | 'phone_confirm';

export interface Tenant {
  id: string;
  createdAt: Date;
}

export interface TenantSettingsRecord extends TenantSettings {
  tenantId: string;
}

export interface CallRecord {
  id: string;
  tenantId: string;
  twilioCallSid: string;
  callerPhone: string;
  currentStep: CallStep;
  languageDetected?: 'fr' | 'en';
  issueText?: string;
  addressRaw?: string;
  addressConfirmed: boolean;
  preferredTimeWindow?: TimeWindow;
  urgency: Urgency;
  lowConfidenceCount: number;
  phoneConfirmed?: string;
  transcript: string[];
  outcome?: CallOutcome;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobRecord extends QualifiedJob {
  id: string;
  tenantId: string;
  callId: string;
  status: JobStatus;
  booking_status?: 'booked' | 'manual_required' | 'not_requested';
  confirmed_slot_start?: string;
  confirmed_slot_end?: string;
  external_event_id?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  tenantId: string;
  callId: string;
  toPhone: string;
  kind: 'normal' | 'urgent';
  body: string;
  providerSid?: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarConnection {
  id: string;
  tenantId: string;
  provider: 'google';
  refreshToken: string;
  accessToken?: string;
  calendarId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  callId?: string;
  jobId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}
