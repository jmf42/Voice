export type UserRole = 'operator' | 'client_admin';

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

export interface ClientProfile {
  id: string; // Tenant ID
  workspaceId: string;
  persistence_mode?: 'memory' | 'database';
  persistence_durable?: boolean;
  enabled: boolean;
  business_name: string;
  business_phone: string;
  escalation_phone: string;
  vertical: 'salon' | 'clinic' | 'restaurant' | 'field_service' | 'other';
  calendar_enabled: boolean;
  languages: Array<'fr' | 'en' | 'de' | 'it'>;
  business_context: string;
  // New fields for SME
  website_url?: string;
  opening_hours?: Record<string, string>; // e.g., 'monday': '09:00-18:00'
  recording_consent_enabled: boolean;
  faqs?: Array<{ question: string; answer: string }>;
  services?: Array<{ name: string; description?: string; price?: string; duration_minutes?: number }>;
}

export interface CallSummary {
  id: string;
  clientId: string;
  caller_phone: string;
  call_intent: 'booking' | 'faq' | 'message' | 'urgent_escalation' | 'unknown';
  language_detected: 'fr' | 'en' | 'de' | 'it';
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

export interface Appointment {
  id: string;
  clientId: string;
  callId?: string; // Link to the call that created this
  caller_name?: string;
  caller_phone: string;
  status: 'requested' | 'confirmed' | 'cancelled' | 'needs_manual_booking';
  service_requested?: string;
  preferred_time_window?: string;
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
