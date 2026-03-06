import { z } from 'zod';

export const CallOutcomeSchema = z.enum([
  'QUALIFIED_JOB',
  'ESCALATED_LIVE_TRANSFER',
  'ESCALATED_CALLBACK_SLA',
]);
export type CallOutcome = z.infer<typeof CallOutcomeSchema>;

export const UrgencySchema = z.enum(['urgent', 'normal']);
export type Urgency = z.infer<typeof UrgencySchema>;

export const TimeWindowSchema = z.enum(['morning', 'afternoon', 'evening', 'specific']);
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const JobStatusSchema = z.enum(['urgent', 'new', 'confirmed', 'closed']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const RoleSchema = z.enum(['operator', 'client_admin']);
export type Role = z.infer<typeof RoleSchema>;

export const QualifiedJobSchema = z.object({
  caller_phone: z.string().min(3),
  address_raw: z.string().min(3),
  address_confirmed: z.boolean(),
  urgency: UrgencySchema,
  preferred_time_window: TimeWindowSchema,
  job_summary: z.string().min(5).max(280),
  access_notes: z.string().max(280).optional(),
  service_hint: z.string().max(80).optional(),
  risk_flags: z.array(z.string().min(2)).optional(),
  language_detected: z.enum(['fr', 'en']).optional(),
  transcript: z.string().max(10000).optional(),
});
export type QualifiedJob = z.infer<typeof QualifiedJobSchema>;

export const VerticalSchema = z.enum(['salon', 'clinic', 'restaurant', 'field_service', 'other']);
export type Vertical = z.infer<typeof VerticalSchema>;

export const FaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const ServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
});

export const TenantSettingsSchema = z.object({
  enabled: z.boolean(),
  business_name: z.string().min(2),
  escalation_phone: z.string().min(3),
  callback_sla_minutes: z.number().int().min(5).max(240).default(30),
  business_phone: z.string().min(3),
  languages: z.array(z.enum(['fr', 'en'])).min(1),
  calendar_enabled: z.boolean().default(false),
  business_context: z.string().max(5000).default(''),
  vertical: VerticalSchema.default('other'),
  website_url: z.string().url().or(z.literal('')).default(''),
  opening_hours: z.record(z.string(), z.string()).default({}),
  recording_consent_enabled: z.boolean().default(false),
  faqs: z.array(FaqSchema).default([]),
  services: z.array(ServiceSchema).default([]),
});
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

export const TerminalOutcomeRecordSchema = z.object({
  callId: z.string().min(1),
  tenantId: z.string().min(1),
  outcome: CallOutcomeSchema,
  timestamp: z.string().datetime(),
});

const urgentKeywordsFr = [
  'inondation',
  'fuite',
  'gaz',
  'pas de chauffage',
  'urgence',
  'explosion',
  'odeur de gaz',
];

const urgentKeywordsEn = [
  'flood',
  'burst pipe',
  'gas smell',
  'no heat',
  'urgent',
  'emergency',
  'leak everywhere',
];

export const URGENT_KEYWORDS = {
  fr: urgentKeywordsFr,
  en: urgentKeywordsEn,
};

export function detectLanguage(text: string): 'fr' | 'en' {
  const normalized = text.toLowerCase();
  const frSignals = ['bonjour', 'chauffage', 'fuite', 'urgence'];
  const frMatches = frSignals.filter((token) => normalized.includes(token)).length;
  return frMatches >= 1 ? 'fr' : 'en';
}

export function normalizePhone(input: string): string {
  return input.replace(/[\s()-]/g, '');
}

export function isUrgentText(text: string, language: 'fr' | 'en' | 'auto' = 'auto'): boolean {
  const normalized = text.toLowerCase();
  const resolvedLang = language === 'auto' ? detectLanguage(text) : language;
  const dictionary = URGENT_KEYWORDS[resolvedLang];
  return dictionary.some((keyword) => normalized.includes(keyword));
}

export function chooseJobStatus(urgency: Urgency): JobStatus {
  return urgency === 'urgent' ? 'urgent' : 'new';
}

export const CallEventSchema = z.object({
  type: z.enum(['CALL_STARTED', 'STEP_CAPTURED', 'CALL_TERMINATED', 'SMS_SENT', 'ESCALATED']),
  callId: z.string(),
  tenantId: z.string(),
  createdAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type CallEvent = z.infer<typeof CallEventSchema>;

export function ensureQualifiedJob(input: unknown): QualifiedJob {
  return QualifiedJobSchema.parse(input);
}

export function buildNormalSms(company: string): string {
  return `📩 ${company}: request received. We'll confirm your appointment shortly. Reply to add details.`;
}

export function buildUrgentSms(company: string, slaMinutes: number): string {
  return `🚨 ${company}: urgent request received. We will call within ${slaMinutes} minutes. If danger, take safety steps and call emergency services.`;
}
