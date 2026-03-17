import type { Role, TenantSettings, TimeWindow } from '@dispatchos/shared';

export type UserRole = Role;

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

export interface ClientProfile extends TenantSettings {
  id: string; // Tenant ID
  workspaceId: string;
  persistence_mode?: 'memory' | 'database';
  persistence_durable?: boolean;
}

export interface CallSummary {
  id: string;
  clientId: string;
  caller_phone: string;
  call_intent: 'booking' | 'faq' | 'message' | 'urgent_escalation' | 'unknown';
  language_detected: 'fr' | 'en';
  duration_seconds: number;
  transcript: string;
  summary: string;
  // QA & Evaluation
  transcript_quality_score?: number; // 0-100
  hallucination_flag: boolean;
  missed_booking_opportunity: boolean;
  escalation_successful?: boolean; // If intent was escalation, did it work?
  agent_id?: string;
  createdAt: string;
}

export interface CallTimelineItem {
  id?: string;
  type?: string;
  createdAt?: string;
  payload?: Record<string, unknown>;
}

export interface Appointment {
  id: string;
  clientId: string;
  callId?: string; // Link to the call that created this
  caller_name?: string;
  caller_phone: string;
  status: 'requested' | 'confirmed' | 'cancelled' | 'needs_manual_booking';
  service_requested?: string;
  preferred_time_window?: TimeWindow;
  confirmed_slot_start?: string;
  confirmed_slot_end?: string;
  external_event_id?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Metrics {
  calls_total: number;
  calls_answered: number; // vs missed entirely before AI
  bookings_created: number;
  callback_requests_captured: number;
  after_hours_calls_handled: number;
  urgent_escalations: number;
  missed_calls_recovered: number; // calculated metric
  avg_call_duration_seconds: number;
  hallucination_rate: number; // percentage
}

export interface ReadinessIssue {
  code: string;
  severity: 'critical' | 'warning';
  message: string;
}

export interface ReadinessStatus {
  ok: boolean;
  service: string;
  readiness: {
    productionSafe: boolean;
    issues: ReadinessIssue[];
  };
  persistence: {
    mode: 'memory' | 'database';
    durable: boolean;
  };
  queue: {
    mode: 'memory' | 'redis';
    durable: boolean;
  };
  auth: {
    devBearerEnabled: boolean;
    firebaseAdminConfigured: boolean;
  };
  providers: {
    openai: boolean;
    twilioVoice: boolean;
    sms: boolean;
    calendar: boolean;
  };
}
