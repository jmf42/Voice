import fastify, { type FastifyReply } from 'fastify';
import formBody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import twilio from 'twilio';
import {
  isUrgentText,
  VerticalSchema,
  FaqSchema,
  ServiceSchema,
  type CallOutcome,
  type TimeWindow,
} from '@dispatchos/shared';
import { parseEnv } from '@dispatchos/config';
import { allowDevAuthToken, requireAuth, type AuthContext } from './auth.js';
import { BullQueueClient, InMemoryQueueClient, type QueueClient } from './queue.js';
import { InMemoryStore, type Store } from './store.js';
import { PrismaStore } from './store-prisma.js';
import {
  CalendarService,
  ClassificationService,
  RealtimeConversationService,
  type RealtimeToolDefinition,
  SmsService,
  answerBusinessQuestionFromSettings,
  buildKnowledgeInstruction,
  twimlConversationRelay,
  buildQualifiedJobDraft,
  twimlGatherPrompt,
  twimlSayAndHangup,
  twimlTransfer,
} from './services.js';
import type { JobRecord } from './types.js';
import { verifyTwilioRequest } from './twilio.js';
import {
  extractRequestedSchedule,
  inferTimeWindowFromText,
  isBusinessQuestion,
  isLikelyUnclearRealtimeTranscript,
  isSmallTalkText,
  shouldCaptureIssueText,
  type RequestedSchedule,
} from './realtime-intake.js';

const gatherBodySchema = z.object({
  SpeechResult: z.string().optional().default(''),
  CallSid: z.string().optional().default(''),
});
const calendarWriteRetrySchema = z.object({
  tenantId: z.string().min(1),
  jobId: z.string().min(1),
  slotStart: z.string().min(1).optional(),
  slotEnd: z.string().min(1).optional(),
});

const settingsPhoneSchema = z
  .string()
  .regex(/^\+?[0-9][0-9\s()-]{5,20}$/, 'Invalid phone number format');
const realtimeSocketQuerySchema = z.object({
  callSid: z.string().min(1),
  ts: z.string().min(1),
  sig: z.string().min(1),
});
const realtimeInboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setup') }),
  z.object({
    type: z.literal('prompt'),
    voicePrompt: z.string().min(1).max(4000),
    lang: z.string().optional(),
  }),
  z.object({
    type: z.literal('interrupt'),
    utteranceUntilInterrupt: z.string().min(1).max(4000),
    lang: z.string().optional(),
  }),
]);
const REALTIME_SOCKET_TTL_MS = 15 * 60 * 1000;
const REALTIME_MAX_TURNS = 120;
const REALTIME_MAX_TURN_CHARS = 500;
const REALTIME_STATE_TTL_MS = 2 * 60 * 60 * 1000;

interface RealtimeTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface RealtimeIntakeState {
  issueText?: string;
  addressRaw?: string;
  addressConfirmed: boolean;
  preferredTimeWindow?: TimeWindow;
  requestedSchedule?: RequestedSchedule;
  requestedScheduleAvailability?: 'available' | 'unavailable';
  phoneConfirmed?: string;
  urgent: boolean;
  urgentPendingConfirmation?: boolean;
}

interface RealtimeSocket {
  send: (payload: string) => void;
  close: () => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

function resolveRealtimeSocket(connection: unknown): RealtimeSocket | null {
  const candidate = connection as {
    socket?: unknown;
    send?: unknown;
    close?: unknown;
    on?: unknown;
  };
  const options = [candidate, candidate.socket as RealtimeSocket | undefined];
  for (const option of options) {
    if (
      option &&
      typeof option.send === 'function' &&
      typeof option.close === 'function' &&
      typeof option.on === 'function'
    ) {
      return option as RealtimeSocket;
    }
  }
  return null;
}

function resolveTargetTenant(auth: AuthContext, clientId?: string): string | null {
  if (!clientId || clientId === auth.tenantId) return auth.tenantId;
  if (auth.role !== 'client_admin') return null;
  return clientId;
}

function yesIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return ['yes', 'oui', 'correct', 'exact'].some((token) => normalized.includes(token));
}

function humanRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    'human',
    'person',
    'someone now',
    'agent',
    "quelqu'un",
    'quelquun',
    "parler a quelqu'un",
    'parler a quelquun',
  ].some((token) => normalized.includes(token));
}

function hasActiveRealtimeServiceNeed(state: RealtimeIntakeState): boolean {
  return Boolean(
    state.issueText ||
      state.addressRaw ||
      state.preferredTimeWindow ||
      state.requestedSchedule,
  );
}

function cloneRealtimeState(state?: RealtimeIntakeState): RealtimeIntakeState | undefined {
  return state
    ? {
        issueText: state.issueText,
        addressRaw: state.addressRaw,
        addressConfirmed: state.addressConfirmed,
        preferredTimeWindow: state.preferredTimeWindow,
        requestedSchedule: state.requestedSchedule,
        requestedScheduleAvailability: state.requestedScheduleAvailability,
        phoneConfirmed: state.phoneConfirmed,
        urgent: state.urgent,
        urgentPendingConfirmation: state.urgentPendingConfirmation,
      }
    : undefined;
}

function normalizeRealtimeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeAssistantEcho(userText: string, lastAssistantText?: string): boolean {
  if (!lastAssistantText) return false;

  const normalizedUser = normalizeRealtimeSpeech(userText);
  const normalizedAssistant = normalizeRealtimeSpeech(lastAssistantText);
  if (normalizedUser.length < 8 || normalizedAssistant.length < 8) return false;
  if (normalizedAssistant.includes(normalizedUser)) return true;

  const userTokens = normalizedUser.split(' ').filter((token) => token.length >= 4);
  if (userTokens.length < 2) return false;
  const overlap = userTokens.filter((token) => normalizedAssistant.includes(token)).length;
  return overlap >= Math.min(userTokens.length, 3);
}

function localizedRealtimeText(language: 'en' | 'fr', english: string, french: string): string {
  return language === 'fr' ? french : english;
}

function looksLikeInformationalQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('?')) return true;

  return [
    /^(what|when|where|who|how|do you|can you|are you|is there|does)\b/,
    /^(quel|quelle|quels|quelles|quand|ou|où|comment|est-ce que|avez-vous|faites-vous|proposez-vous)\b/,
  ].some((pattern) => pattern.test(normalized));
}

function describeRealtimeTimePreference(
  state: Pick<RealtimeIntakeState, 'requestedSchedule' | 'preferredTimeWindow'>,
  language: 'en' | 'fr',
): string | undefined {
  if (state.requestedSchedule?.label) {
    return state.requestedSchedule.label;
  }

  if (state.preferredTimeWindow === 'morning') {
    return language === 'fr' ? 'le matin' : 'in the morning';
  }
  if (state.preferredTimeWindow === 'afternoon') {
    return language === 'fr' ? "l'après-midi" : 'in the afternoon';
  }
  if (state.preferredTimeWindow === 'evening') {
    return language === 'fr' ? 'en soirée' : 'in the evening';
  }

  return undefined;
}

function buildRealtimeCompletionMessage(args: {
  language: 'en' | 'fr';
  state: Pick<RealtimeIntakeState, 'addressRaw' | 'requestedSchedule' | 'preferredTimeWindow'>;
  businessHasCalendar: boolean;
}): string {
  const timeText = describeRealtimeTimePreference(args.state, args.language);
  const address = args.state.addressRaw?.trim();

  if (address && timeText) {
    return localizedRealtimeText(
      args.language,
      `Perfect. I have your request for ${address} for ${timeText}. We'll text the confirmation shortly.`,
      `Parfait. J'ai bien votre demande pour ${address} pour ${timeText}. Nous vous envoyons la confirmation par SMS rapidement.`,
    );
  }

  if (address) {
    return localizedRealtimeText(
      args.language,
      `Thanks. I have the address as ${address}. We'll text the confirmation shortly.`,
      `Merci. J'ai bien l'adresse ${address}. Nous vous envoyons la confirmation par SMS rapidement.`,
    );
  }

  if (args.businessHasCalendar && timeText) {
    return localizedRealtimeText(
      args.language,
      `Perfect. I have your preferred time ${timeText}. We'll text the confirmation shortly.`,
      `Parfait. J'ai bien noté l'horaire ${timeText}. Nous vous envoyons la confirmation par SMS rapidement.`,
    );
  }

  return localizedRealtimeText(
    args.language,
    "Thanks, I have the details. We'll text the confirmation shortly.",
    "Merci, j'ai bien noté les détails. Nous vous envoyons la confirmation par SMS rapidement.",
  );
}

function nextMissingRealtimeQuestion(
  state: RealtimeIntakeState,
  language: 'en' | 'fr' = 'en',
): string | null {
  if (!state.issueText) {
    return localizedRealtimeText(
      language,
      'What do you need help with today?',
      "De quoi avez-vous besoin aujourd'hui ?",
    );
  }
  if (state.urgentPendingConfirmation) {
    return localizedRealtimeText(
      language,
      'Just to confirm, do you need the on-call team right now?',
      "Juste pour confirmer, avez-vous besoin de l'équipe d'urgence tout de suite ?",
    );
  }
  if (!state.addressRaw) {
    return localizedRealtimeText(
      language,
      'What is the full service address?',
      "Quelle est l'adresse complète ?",
    );
  }
  if (!state.addressConfirmed) {
    return localizedRealtimeText(
      language,
      'Please repeat the street and number so I get the address right.',
      "Pouvez-vous répéter la rue et le numéro pour que je note la bonne adresse ?",
    );
  }
  if (!state.preferredTimeWindow) {
    return localizedRealtimeText(
      language,
      'What time works best for you?',
      'Quel horaire vous convient le mieux ?',
    );
  }
  if (!state.phoneConfirmed) {
    return localizedRealtimeText(
      language,
      'What number should we use for confirmation?',
      'Quel numéro devons-nous utiliser pour la confirmation ?',
    );
  }
  return null;
}

function buildRealtimeAcknowledgement(
  language: 'en' | 'fr',
  args: { previousState?: RealtimeIntakeState; state: RealtimeIntakeState },
): string | undefined {
  const previous = args.previousState;
  const current = args.state;

  if (!previous?.issueText && current.issueText) {
    return localizedRealtimeText(language, 'Got it.', "D'accord.");
  }
  if (!previous?.addressRaw && current.addressRaw) {
    return localizedRealtimeText(language, 'Thanks.', 'Merci.');
  }
  if (!previous?.addressConfirmed && current.addressConfirmed) {
    return localizedRealtimeText(language, 'Perfect.', 'Parfait.');
  }
  if (!previous?.preferredTimeWindow && current.preferredTimeWindow) {
    return localizedRealtimeText(language, 'Perfect.', 'Parfait.');
  }
  if (!previous?.phoneConfirmed && current.phoneConfirmed) {
    return localizedRealtimeText(language, 'Thanks.', 'Merci.');
  }
  return undefined;
}

function buildRealtimeAgentTurnInstruction(args: {
  language: 'en' | 'fr';
  state: RealtimeIntakeState;
  businessHasCalendar: boolean;
}): string {
  const needsSlotCheck =
    Boolean(args.state.requestedSchedule) &&
    Boolean(args.state.issueText) &&
    Boolean(args.state.addressRaw) &&
    Boolean(args.state.phoneConfirmed) &&
    args.state.requestedScheduleAvailability === undefined;

  return [
    `Handle the caller's latest turn in ${args.language === 'fr' ? 'French' : 'English'}.`,
    'Use the available tools before answering when you need saved business facts, the current intake state, or schedule availability.',
    'For service intake, call get_intake_state before asking another question unless the caller turn is only small talk or a pure business-information question.',
    'Ask only one short follow-up question when a detail is still missing.',
    'Do not ask for city, postal code, or address repetition when the current intake state already has a confirmed street-and-number address.',
    'If the caller gives a short numeric time like 1208 or 1 2 0 8 after you asked for time, treat it as a time. If you are not sure whether digits are a time or something else, ask one targeted clarification question.',
    needsSlotCheck
      ? 'Before you say a requested specific time works, call check_requested_slot.'
      : 'If the intake is incomplete, use get_intake_state and ask only for the next missing detail.',
    'If check_requested_slot says the time is unavailable, ask for another time.',
    'If check_requested_slot says calendar_disabled, calendar_not_connected, or availability_unknown, do not present the time as booked. Say the team will confirm by text.',
    'Do not say you booked, scheduled, or requested something in the background unless a tool result supports that statement.',
    'If the caller only wants business information, answer it directly and do not force service intake.',
    'If the intake is complete and the requested time is unavailable, ask for another time.',
    args.businessHasCalendar
      ? "If the intake is complete and the requested time is available, close briefly and say you'll text the confirmation."
      : "If the intake is complete, close briefly and say you'll text the confirmation.",
    'Do not repeat a full summary unless you are correcting a conflict.',
  ].join(' ');
}

function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function buildWebsiteFetchCandidates(input: string): string[] {
  const normalized = normalizeWebsiteUrl(input);
  const parsed = new URL(normalized);
  const candidates = [parsed.toString()];

  if (parsed.protocol === 'http:') {
    const httpsUrl = new URL(parsed.toString());
    httpsUrl.protocol = 'https:';
    candidates.unshift(httpsUrl.toString());
  }

  if (!parsed.hostname.startsWith('www.')) {
    const withWww = new URL(parsed.toString());
    withWww.hostname = `www.${parsed.hostname}`;
    candidates.push(withWww.toString());
  }

  return [...new Set(candidates)];
}

function sanitizeWebsiteText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

async function fetchWebsiteText(input: string): Promise<string> {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (compatible; DispatchOS/1.0; +https://dispatchos-web-277626955710.us-central1.run.app)',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };

  let lastStatus: number | undefined;

  for (const candidate of buildWebsiteFetchCandidates(input)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(candidate, {
        signal: controller.signal,
        headers,
        redirect: 'follow',
      });

      if (!res.ok) {
        lastStatus = res.status;
        continue;
      }

      const raw = sanitizeWebsiteText(await res.text());
      if (raw.length >= 120) {
        return raw;
      }
    } catch {
      // Try the next candidate or the text-reader fallback below.
    } finally {
      clearTimeout(timeout);
    }
  }

  const normalized = normalizeWebsiteUrl(input);
  const jinaUrl = `https://r.jina.ai/http://${normalized.replace(/^https?:\/\//i, '')}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': headers['User-Agent'],
        Accept: 'text/plain,text/html;q=0.9,*/*;q=0.7',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      lastStatus = res.status;
    } else {
      const raw = sanitizeWebsiteText(await res.text());
      if (raw.length > 0) {
        return raw;
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  if (lastStatus) {
    throw new Error(`Could not fetch URL (HTTP ${lastStatus}).`);
  }

  throw new Error('Could not fetch the URL. Check that it is publicly accessible.');
}

function mapTransferStatusToOutcome(status: string): CallOutcome {
  const normalized = status.toLowerCase();
  return normalized === 'completed' || normalized === 'answered'
    ? 'ESCALATED_LIVE_TRANSFER'
    : 'ESCALATED_CALLBACK_SLA';
}

function tenantNotFound(reply: FastifyReply) {
  return reply.status(404).send({ error: 'Tenant not found' });
}

function terminalTwilioStatus(status: string): boolean {
  return ['completed', 'canceled', 'busy', 'no-answer', 'failed'].includes(status.toLowerCase());
}

function buildRealtimeSocketSig(
  secret: string,
  tenantId: string,
  callSid: string,
  timestamp: string,
): string {
  return createHmac('sha256', secret).update(`${tenantId}:${callSid}:${timestamp}`).digest('hex');
}

function isValidRealtimeSocketSig(args: {
  secret: string;
  tenantId: string;
  callSid: string;
  timestamp: string;
  signature: string;
}): boolean {
  const parsedTs = Number(args.timestamp);
  if (!Number.isFinite(parsedTs)) return false;
  if (Math.abs(Date.now() - parsedTs) > REALTIME_SOCKET_TTL_MS) return false;

  const expected = buildRealtimeSocketSig(args.secret, args.tenantId, args.callSid, args.timestamp);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const givenBuffer = Buffer.from(args.signature, 'utf8');
  if (expectedBuffer.length !== givenBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, givenBuffer);
}

interface ReadinessIssue {
  code: string;
  severity: 'critical' | 'warning';
  message: string;
}

function buildHealthSnapshot(args: {
  env: ReturnType<typeof parseEnv>;
  persistence: { mode: 'memory' | 'database'; durable: boolean };
  usingInMemoryQueue: boolean;
  runningInManagedRuntime: boolean;
  devAuthEnabled: boolean;
  demoTenantBootstrapEnabled: boolean;
  openAiConfigured: boolean;
  twilioVoiceConfigured: boolean;
  smsConfigured: boolean;
  calendarConfigured: boolean;
}) {
  const issues: ReadinessIssue[] = [];
  const apiBaseUrl = parseApiBaseUrl(args.env.API_BASE_URL);

  if (!args.persistence.durable) {
    issues.push({
      code: 'inmemory-store',
      severity: 'critical',
      message: 'Settings and job data are not durable because the app is using in-memory storage.',
    });
  }

  if (args.usingInMemoryQueue) {
    issues.push({
      code: 'inmemory-queue',
      severity: 'critical',
      message: 'Retry jobs are not durable because the worker queue is using in-memory mode.',
    });
  }

  if (args.runningInManagedRuntime && args.env.NODE_ENV !== 'production') {
    issues.push({
      code: 'managed-runtime-nonprod',
      severity: 'critical',
      message: 'The service is running in a managed runtime without NODE_ENV=production.',
    });
  }

  if (args.env.NODE_ENV === 'production' && args.devAuthEnabled) {
    issues.push({
      code: 'dev-auth-enabled',
      severity: 'critical',
      message: 'Production still accepts developer bearer tokens. Turn off ALLOW_DEV_AUTH_TOKEN.',
    });
  }

  if (args.env.NODE_ENV === 'production' && args.demoTenantBootstrapEnabled) {
    issues.push({
      code: 'demo-bootstrap-enabled',
      severity: 'critical',
      message: 'Production is configured to auto-create the demo tenant. Disable BOOTSTRAP_DEMO_TENANT.',
    });
  }

  if (args.env.VOICE_FLOW_MODE === 'realtime' && !args.openAiConfigured) {
    issues.push({
      code: 'realtime-without-openai',
      severity: 'warning',
      message: 'Realtime voice mode is enabled but OPENAI_API_KEY is missing, so the assistant will fall back to generic replies.',
    });
  }

  if (!apiBaseUrl) {
    issues.push({
      code: 'api-base-url-invalid',
      severity: 'critical',
      message: 'API_BASE_URL is not a valid absolute URL, so telephony callbacks cannot be built safely.',
    });
  } else {
    if (isLocalhostHostname(apiBaseUrl.hostname) && args.runningInManagedRuntime) {
      issues.push({
        code: 'api-base-url-localhost',
        severity: 'critical',
        message: 'API_BASE_URL points to localhost in a managed runtime, so Twilio cannot reach the inbound call endpoints.',
      });
    }

    if (
      args.env.VOICE_FLOW_MODE === 'realtime' &&
      apiBaseUrl.protocol !== 'https:' &&
      args.env.NODE_ENV === 'production'
    ) {
      issues.push({
        code: 'realtime-api-base-url-not-https',
        severity: 'critical',
        message: 'Realtime voice mode in production requires API_BASE_URL to use https so Twilio can connect over wss.',
      });
    }
  }

  if (!args.twilioVoiceConfigured) {
    issues.push({
      code: 'twilio-voice-simulated',
      severity: 'warning',
      message: 'Twilio voice credentials are missing or test-only, so live phone actions are not fully enabled.',
    });
  }

  if (!args.smsConfigured) {
    issues.push({
      code: 'sms-simulated',
      severity: 'warning',
      message: 'SMS confirmations are running in simulated mode because live Twilio messaging credentials are not configured.',
    });
  }

  if (!args.calendarConfigured) {
    issues.push({
      code: 'calendar-not-configured',
      severity: 'warning',
      message: 'Google Calendar OAuth is not configured, so live calendar sync is unavailable.',
    });
  }

  return {
    productionSafe: !issues.some((issue) => issue.severity === 'critical'),
    issues,
    runtime: {
      nodeEnv: args.env.NODE_ENV,
      managedRuntime: args.runningInManagedRuntime,
      voiceFlowMode: args.env.VOICE_FLOW_MODE,
      realtimeModel: args.env.REALTIME_AGENT_MODEL,
      demoTenantBootstrap: args.demoTenantBootstrapEnabled,
    },
    persistence: args.persistence,
    queue: {
      mode: args.usingInMemoryQueue ? 'memory' : 'redis',
      durable: !args.usingInMemoryQueue,
    },
    auth: {
      devBearerEnabled: args.devAuthEnabled,
      firebaseAdminConfigured: Boolean(process.env.FIREBASE_PROJECT_ID),
    },
    providers: {
      openai: args.openAiConfigured,
      twilioVoice: args.twilioVoiceConfigured,
      sms: args.smsConfigured,
      calendar: args.calendarConfigured,
    },
  } as const;
}

function parseApiBaseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalhostHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

export function createApp(deps?: {
  store?: Store;
  classifier?: ClassificationService;
  sms?: SmsService;
  calendar?: CalendarService;
  realtimeConversation?: Pick<RealtimeConversationService, 'createSession'>;
  queue?: QueueClient;
}) {
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'headers.authorization',
          'req.body.SpeechResult',
          'req.body.Body',
          'req.body.From',
          'req.body.To',
          'req.body.phone',
          'req.body.address',
        ],
        censor: '[Redacted]',
      },
    },
  });
  app.register(formBody);
  app.register(websocket);

  const env = parseEnv({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    APP_BASE_URL: process.env.APP_BASE_URL,
    API_BASE_URL: process.env.API_BASE_URL,
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://dispatch:dispatch@localhost:5432/dispatchos',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? 'AC_TEST',
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? 'token',
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ?? '+41000000000',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    QUEUE_SHARED_SECRET: process.env.QUEUE_SHARED_SECRET,
    ALLOW_DEV_AUTH_TOKEN: process.env.ALLOW_DEV_AUTH_TOKEN,
    ALLOW_INMEMORY_STORE: process.env.ALLOW_INMEMORY_STORE,
    BOOTSTRAP_DEMO_TENANT: process.env.BOOTSTRAP_DEMO_TENANT,
    STORE_MODE: process.env.STORE_MODE,
    QUEUE_MODE: process.env.QUEUE_MODE,
    VOICE_FLOW_MODE: process.env.VOICE_FLOW_MODE,
    REALTIME_AGENT_MODEL: process.env.REALTIME_AGENT_MODEL,
  });

  const useInMemoryStore = deps?.store
    ? false
    : env.STORE_MODE === 'memory' ||
      (env.NODE_ENV !== 'production' && env.ALLOW_INMEMORY_STORE !== false);
  const useInMemoryQueue = deps?.queue ? false : env.QUEUE_MODE === 'memory';
  const usingInMemoryStoreInstance = deps?.store
    ? deps.store instanceof InMemoryStore
    : useInMemoryStore;
  const persistence = {
    mode: usingInMemoryStoreInstance ? 'memory' : 'database',
    durable: !usingInMemoryStoreInstance,
  } as const;

  if (
    env.NODE_ENV === 'production' &&
    (usingInMemoryStoreInstance || env.ALLOW_INMEMORY_STORE === true)
  ) {
    throw new Error(
      'In-memory store is not allowed in production. Set STORE_MODE=prisma and ALLOW_INMEMORY_STORE=false.',
    );
  }
  if (env.NODE_ENV === 'production' && useInMemoryQueue) {
    throw new Error('In-memory queue is not allowed in production. Set QUEUE_MODE=redis.');
  }

  const runningInManagedRuntime = Boolean(
    process.env.K_SERVICE || process.env.K_REVISION || process.env.RENDER,
  );
  if (runningInManagedRuntime && env.NODE_ENV !== 'production') {
    app.log.warn(
      { nodeEnv: env.NODE_ENV },
      'service is running in a managed runtime without NODE_ENV=production; this is not production-safe',
    );
  }
  if (runningInManagedRuntime && useInMemoryStore) {
    app.log.warn(
      'service is using in-memory store in managed runtime; data will be lost on restart/scale events',
    );
  }
  if (runningInManagedRuntime && useInMemoryQueue) {
    app.log.warn(
      'service is using in-memory queue in managed runtime; retries/deferred jobs are not durable',
    );
  }

  const allowedOrigins = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.register(helmet, {
    contentSecurityPolicy: false,
  });
  app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'), false);
    },
  });
  app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  const store: Store = deps?.store ?? (useInMemoryStore ? new InMemoryStore() : new PrismaStore());
  const demoTenantBootstrapEnabled = env.BOOTSTRAP_DEMO_TENANT === true;
  if (demoTenantBootstrapEnabled) {
    void store
      .createTenant({
        tenantId: 'demo-tenant',
        businessName: 'DispatchOS Demo Heating',
        businessPhone: '+41225550999',
        escalationPhone: '+41225550123',
      })
      .catch((error) => {
        app.log.error({ err: error }, 'failed to bootstrap default tenant');
      });
  }
  const classifier =
    deps?.classifier ?? new ClassificationService(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  const realtimeConversation =
    deps?.realtimeConversation ??
    new RealtimeConversationService(env.OPENAI_API_KEY, env.REALTIME_AGENT_MODEL, env.OPENAI_MODEL);
  const queue: QueueClient =
    deps?.queue ??
    (useInMemoryQueue ? new InMemoryQueueClient() : new BullQueueClient(env.REDIS_URL));
  const smsService =
    deps?.sms ??
    new SmsService({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      fromPhone: env.TWILIO_PHONE_NUMBER,
      statusCallbackUrl: `${env.API_BASE_URL}/v1/sms/status`,
    });
  const calendarService =
    deps?.calendar ??
    new CalendarService({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    });
  const twilioVoiceClient =
    env.TWILIO_ACCOUNT_SID.startsWith('AC_TEST') || env.TWILIO_AUTH_TOKEN === 'token'
      ? null
      : twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const smsConfigured =
    typeof smsService.isLiveProviderEnabled === 'function'
      ? smsService.isLiveProviderEnabled()
      : Boolean(deps?.sms);
  const calendarConfigured =
    typeof calendarService.isLiveProviderEnabled === 'function'
      ? calendarService.isLiveProviderEnabled()
      : Boolean(deps?.calendar);
  const healthSnapshot = buildHealthSnapshot({
    env,
    persistence,
    usingInMemoryQueue: useInMemoryQueue,
    runningInManagedRuntime,
    devAuthEnabled: allowDevAuthToken(),
    demoTenantBootstrapEnabled,
    openAiConfigured: Boolean(env.OPENAI_API_KEY),
    twilioVoiceConfigured: Boolean(twilioVoiceClient),
    smsConfigured,
    calendarConfigured,
  });

  const oauthStates = new Map<string, { tenantId: string; createdAt: number }>();
  const realtimeTranscriptByCallSid = new Map<string, RealtimeTurn[]>();
  const realtimeStateByCallSid = new Map<string, RealtimeIntakeState>();
  const realtimeLastSeenByCallSid = new Map<string, number>();
  const realtimeLastAssistantOutputAtByCallSid = new Map<string, number>();
  const jobStreamClientsByTenant = new Map<string, Set<ServerResponse>>();
  const oauthStateTtlMs = 10 * 60 * 1000;

  function toWebSocketUrl(baseUrl: string): string {
    if (baseUrl.startsWith('https://')) return baseUrl.replace('https://', 'wss://');
    if (baseUrl.startsWith('http://')) return baseUrl.replace('http://', 'ws://');
    return baseUrl;
  }

  function addRealtimeTurn(callSid: string, turn: RealtimeTurn): RealtimeTurn[] {
    const normalizedText = turn.text.trim().slice(0, REALTIME_MAX_TURN_CHARS);
    const existing = realtimeTranscriptByCallSid.get(callSid) ?? [];
    const next = [...existing, { role: turn.role, text: normalizedText }].slice(
      -REALTIME_MAX_TURNS,
    );
    realtimeTranscriptByCallSid.set(callSid, next);
    realtimeLastSeenByCallSid.set(callSid, Date.now());
    return next;
  }

  function pruneRealtimeCaches(): void {
    const nowTs = Date.now();
    for (const [callSid, lastSeen] of realtimeLastSeenByCallSid.entries()) {
      if (nowTs - lastSeen > REALTIME_STATE_TTL_MS) {
        realtimeLastSeenByCallSid.delete(callSid);
        realtimeTranscriptByCallSid.delete(callSid);
        realtimeStateByCallSid.delete(callSid);
        realtimeLastAssistantOutputAtByCallSid.delete(callSid);
      }
    }
  }

  function removeJobStreamClient(tenantId: string, stream: ServerResponse): void {
    const clients = jobStreamClientsByTenant.get(tenantId);
    if (!clients) return;
    clients.delete(stream);
    if (clients.size === 0) {
      jobStreamClientsByTenant.delete(tenantId);
    }
  }

  function writeSse(stream: ServerResponse, event: string, payload: unknown): boolean {
    if (stream.destroyed || stream.writableEnded) return false;
    try {
      stream.write(`event: ${event}\n`);
      stream.write(`data: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      return false;
    }
  }

  async function enqueueOrLog(
    name: 'sms-retry' | 'calendar-write' | 'transcript-persist' | 'dead-letter',
    payload: { tenantId: string; idempotencyKey: string; payload: Record<string, unknown> },
    context: string,
  ): Promise<void> {
    try {
      await queue.enqueue(name, payload);
    } catch (error) {
      app.log.error(
        {
          err: error,
          queueName: name,
          idempotencyKey: payload.idempotencyKey,
          tenantId: payload.tenantId,
          context,
        },
        'queue enqueue failed',
      );
    }
  }

  function hasValidQueueSecret(headerValue: string | string[] | undefined): boolean {
    if (!env.QUEUE_SHARED_SECRET) return false;
    if (Array.isArray(headerValue)) return headerValue.includes(env.QUEUE_SHARED_SECRET);
    return headerValue === env.QUEUE_SHARED_SECRET;
  }

  async function recoverCalendarWriteRetry(payload: z.infer<typeof calendarWriteRetrySchema>): Promise<JobRecord | null> {
    const job = await store.getJob(payload.tenantId, payload.jobId);
    if (!job) return null;

    const calendarConnection =
      (calendarService.isLiveProviderEnabled() || process.env.NODE_ENV === 'test')
      ? await store.getCalendarConnection(payload.tenantId)
      : undefined;

    if (!calendarConnection) {
      const updated = await store.updateJob(payload.tenantId, payload.jobId, {
        booking_status: 'manual_required',
      });
      await store.addAudit(
        payload.tenantId,
        'CALENDAR_WRITE_RECOVERY_SKIPPED',
        { reason: 'calendar_not_connected' },
        { callId: updated.callId, jobId: updated.id },
      );
      await broadcastJobSnapshot(payload.tenantId);
      return updated;
    }

    const slot =
      payload.slotStart
        ? {
            slotStart: payload.slotStart,
            slotEnd:
              payload.slotEnd ??
              new Date(new Date(payload.slotStart).getTime() + 60 * 60 * 1000).toISOString(),
          }
        : (
            await calendarService.findNextAvailableSlots({
              connection: calendarConnection,
              preferredTimeWindow: job.preferred_time_window,
              count: 1,
            })
          )[0];

    if (!slot) {
      const updated = await store.updateJob(payload.tenantId, payload.jobId, {
        booking_status: 'manual_required',
      });
      await store.addAudit(
        payload.tenantId,
        'CALENDAR_WRITE_RECOVERY_SKIPPED',
        { reason: 'no_available_slots' },
        { callId: updated.callId, jobId: updated.id },
      );
      await broadcastJobSnapshot(payload.tenantId);
      return updated;
    }

    if (payload.slotStart) {
      const available = await calendarService.isSlotAvailable({
        connection: calendarConnection,
        slotStart: slot.slotStart,
        slotEnd: slot.slotEnd,
      });
      if (!available) {
        const updated = await store.updateJob(payload.tenantId, payload.jobId, {
          booking_status: 'manual_required',
        });
        await store.addAudit(
          payload.tenantId,
          'CALENDAR_WRITE_RECOVERY_SKIPPED',
          {
            reason: 'requested_slot_unavailable',
            slotStart: slot.slotStart,
            slotEnd: slot.slotEnd,
          },
          { callId: updated.callId, jobId: updated.id },
        );
        await broadcastJobSnapshot(payload.tenantId);
        return updated;
      }
    }

    const booking = await calendarService.createOrUpdateBooking({
      job,
      tenantId: payload.tenantId,
      connection: calendarConnection,
      slotStart: slot.slotStart,
      slotEnd: slot.slotEnd,
    });
    const updated = await store.updateJob(payload.tenantId, payload.jobId, {
      status: 'confirmed',
      booking_status: 'booked',
      confirmed_slot_start: slot.slotStart,
      confirmed_slot_end: slot.slotEnd,
      external_event_id: booking.externalEventId,
    });
    await store.addAudit(
      payload.tenantId,
      'CALENDAR_WRITE_RECOVERED',
      {
        slotStart: slot.slotStart,
        slotEnd: slot.slotEnd,
        externalEventId: booking.externalEventId,
      },
      { callId: updated.callId, jobId: updated.id },
    );
    await broadcastJobSnapshot(payload.tenantId);
    return updated;
  }

  async function broadcastJobSnapshot(tenantId: string): Promise<void> {
    const clients = jobStreamClientsByTenant.get(tenantId);
    if (!clients || clients.size === 0) return;

    const items = await store.listJobs(tenantId);
    const payload = { items, at: new Date().toISOString() };
    for (const stream of [...clients]) {
      const ok = writeSse(stream, 'jobs', payload);
      if (!ok) {
        removeJobStreamClient(tenantId, stream);
      }
    }
  }

  function extractAddressCandidate(text: string): string | undefined {
    const normalized = text.trim();
    if (normalized.length < 8) return undefined;
    const segments = normalized
      .split(/[.!?\n]/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const callbackTailPattern =
      /\b(call me at|reach me at|phone number is|my number is|callback at|tel(?:ephone)?|phone)\b.*$/i;
    const streetPattern = /(rue|avenue|av\.?|route|road|street|st\.?|chemin|lane|blvd|boulevard)/i;
    const callbackPattern = /(call me at|phone number|callback|tel)/i;
    const dateOrTimePattern =
      /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec|today|tomorrow|demain|aujourd'hui|morning|afternoon|evening|matin|soir)\b|\b\d{1,2}\s*(am|pm)\b|\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/i;
    const schedulingPhrasePattern = /\b(works for me|available|availability|disponible|me convient)\b/i;

    for (const segment of segments) {
      const cleaned = segment.replace(callbackTailPattern, '').trim();
      if (cleaned.length < 8) continue;
      if (callbackPattern.test(cleaned) && !streetPattern.test(cleaned)) continue;
      const hasStreetKeyword = streetPattern.test(cleaned);
      const hasNumber = /\d/.test(cleaned);
      const hasLetters = /[a-z]/i.test(cleaned);
      if (!hasStreetKeyword && (dateOrTimePattern.test(cleaned) || schedulingPhrasePattern.test(cleaned))) {
        continue;
      }
      if (hasStreetKeyword || (hasNumber && hasLetters)) return cleaned;
    }

    const fallback = normalized.replace(callbackTailPattern, '').trim();
    const hasStreetKeyword = streetPattern.test(fallback);
    const hasNumber = /\d/.test(fallback);
    const hasLetters = /[a-z]/i.test(fallback);
    if (!hasStreetKeyword && (dateOrTimePattern.test(fallback) || schedulingPhrasePattern.test(fallback))) {
      return undefined;
    }
    if (hasStreetKeyword || (hasNumber && hasLetters)) return fallback;
    return undefined;
  }

  function extractIssueCandidate(text: string): string | undefined {
    const normalized = text.trim();
    if (!shouldCaptureIssueText(normalized)) return undefined;
    return normalized;
  }

  function containsTimeWindowHint(text: string): boolean {
    return (
      /(morning|afternoon|evening|specific|matin|apres-midi|soir)/i.test(text) ||
      Boolean(inferTimeWindowFromText(text)) ||
      Boolean(extractRequestedSchedule(text))
    );
  }

  async function captureRealtimeUserTurn(
    callSid: string,
    userText: string,
    referenceDate = new Date(),
    lastAssistantText?: string,
  ): Promise<RealtimeIntakeState> {
    const state = realtimeStateByCallSid.get(callSid) ?? {
      addressConfirmed: false,
      urgent: false,
    };
    const normalized = userText.trim();
    if (!state.issueText) {
      state.issueText = extractIssueCandidate(normalized);
    }

    const extractedAddress = extractAddressCandidate(normalized);
    if (extractedAddress) {
      state.addressRaw = extractedAddress;
      state.addressConfirmed = (await classifier.addressConfidence(extractedAddress)) >= 0.75;
    } else if (state.addressRaw && !state.addressConfirmed && yesIntent(normalized)) {
      state.addressConfirmed = true;
    }

    const assistantAskedForTime = Boolean(
      lastAssistantText &&
        /\b(what time works best|what time works|which time works|preferred time|do you mean.*(?:am|pm|\d[:h]\d{2}|\d{3,4}))\b/i.test(
          lastAssistantText,
        ),
    );
    const requestedSchedule = extractRequestedSchedule(normalized, {
      now: referenceDate,
      assumeTodayOnBareTime: assistantAskedForTime,
    });
    if (requestedSchedule) {
      state.requestedSchedule = requestedSchedule;
      state.requestedScheduleAvailability = undefined;
    }

    if (containsTimeWindowHint(normalized)) {
      state.preferredTimeWindow =
        inferTimeWindowFromText(normalized) ?? classifier.inferTimeWindow(normalized);
    }

    if (!state.phoneConfirmed) {
      const extractedPhone = classifier.extractPhone(normalized);
      if (/\d{7,}/.test(extractedPhone)) {
        state.phoneConfirmed = extractedPhone;
      }
    }

    const urgentByKeyword = isUrgentText(normalized) || humanRequest(normalized);
    if (state.urgentPendingConfirmation) {
      if (yesIntent(normalized)) {
        state.urgent = true;
        state.urgentPendingConfirmation = false;
      } else if (/\b(no|not urgent|non|pas urgent|ce n['’]est pas urgent)\b/i.test(normalized)) {
        state.urgentPendingConfirmation = false;
      }
    }

    if (!state.urgent && urgentByKeyword) {
      const lifeSafetyRisk = /\b(fire|smoke|gas leak|flood|flooding|injury|bleeding|danger)\b/i.test(
        normalized,
      );
      if (lifeSafetyRisk || state.issueText) {
        state.urgentPendingConfirmation = true;
      } else {
        state.urgentPendingConfirmation = true;
      }
    }

    realtimeStateByCallSid.set(callSid, state);
    realtimeLastSeenByCallSid.set(callSid, Date.now());
    return state;
  }

  async function finalizeRealtimeConversation(args: {
    tenantId: string;
    callSid: string;
    transcriptTurns: RealtimeTurn[];
    intakeState?: RealtimeIntakeState;
    settings: Awaited<ReturnType<Store['getTenantSettings']>>;
    forceUrgent?: boolean;
  }): Promise<void> {
    const call =
      (await store.getCallBySid(args.tenantId, args.callSid)) ??
      (await store.findCallBySid(args.callSid));
    if (!call || call.outcome) return;

    const transcriptTurns = args.transcriptTurns;
    const intakeState = args.intakeState;
    const callerTurns = transcriptTurns
      .filter((turn) => turn.role === 'user')
      .map((turn) => turn.text.trim())
      .filter(Boolean);
    const fullCallerText = callerTurns.join(' ');
    const language = await classifier.detectLanguage(fullCallerText || call.issueText || 'hello');
    const capturedIssueText =
      intakeState?.issueText ??
      callerTurns.map(extractIssueCandidate).find(Boolean) ??
      call.issueText;
    const inferredAddress =
      intakeState?.addressRaw ??
      callerTurns.map(extractAddressCandidate).find(Boolean) ??
      call.addressRaw;
    const inferredTimeWindow = containsTimeWindowHint(fullCallerText)
      ? classifier.inferTimeWindow(fullCallerText)
      : undefined;
    const capturedTimeWindow =
      intakeState?.preferredTimeWindow ?? inferredTimeWindow ?? call.preferredTimeWindow;
    const requestedSchedule =
      intakeState?.requestedScheduleAvailability === 'unavailable'
        ? undefined
        : intakeState?.requestedSchedule ??
      [...callerTurns]
        .reverse()
        .map((turn) => extractRequestedSchedule(turn, { now: call.createdAt }))
        .find((value): value is RequestedSchedule => Boolean(value));
    const phoneConfirmed =
      intakeState?.phoneConfirmed ??
      call.phoneConfirmed ??
      (call.callerPhone !== 'unknown' ? call.callerPhone : undefined);
    const hasServiceIntent = Boolean(capturedIssueText?.trim());
    const urgent =
      args.forceUrgent ||
      intakeState?.urgent ||
      (hasServiceIntent && (await classifier.isUrgent(fullCallerText)));
    const issueText = capturedIssueText ?? 'Information request only';
    const preferredTimeWindow = capturedTimeWindow ?? 'specific';

    const updated = await store.updateCall(call.id, {
      issueText,
      addressRaw: inferredAddress ?? 'Address pending confirmation',
      addressConfirmed:
        intakeState?.addressConfirmed ?? Boolean(inferredAddress && inferredAddress.length >= 8),
      preferredTimeWindow,
      languageDetected: language,
      urgency: urgent ? 'urgent' : 'normal',
      phoneConfirmed,
      transcript: transcriptTurns
        .map((turn) => `[realtime:${turn.role}] ${turn.text}`)
        .slice(0, 200),
    });

    const draft = await buildQualifiedJobDraft({
      call: updated,
      settings: args.settings,
      classifier,
    });

    await finalizeAndNotify({
      callId: updated.id,
      settings: args.settings,
      outcome: urgent ? 'ESCALATED_CALLBACK_SLA' : 'QUALIFIED_JOB',
      urgent,
      jobDraft: draft,
      requestedSchedule,
      skipAutoBooking: intakeState?.requestedScheduleAvailability === 'unavailable',
    });
  }

  function pruneExpiredOauthStates(): void {
    const now = Date.now();
    for (const [state, value] of oauthStates.entries()) {
      if (now - value.createdAt > oauthStateTtlMs) {
        oauthStates.delete(state);
      }
    }
  }

  async function sendPostCallSms(args: {
    callId: string;
    tenantId: string;
    toPhone: string;
    urgent: boolean;
    bookedSlotStart?: string;
    settings: {
      business_name: string;
      callback_sla_minutes: number;
    };
  }): Promise<void> {
    const kind = args.urgent ? 'urgent' : 'normal';
    const bookedAtText = args.bookedSlotStart
      ? new Date(args.bookedSlotStart).toLocaleString('en-CH', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null;
    const customBody =
      !args.urgent && bookedAtText
        ? `${args.settings.business_name}: Appointment booked for ${bookedAtText}. Reply YES to confirm or call us to reschedule.`
        : undefined;

    try {
      const sent = await smsService.send({
        company: args.settings.business_name,
        to: args.toPhone,
        urgent: args.urgent,
        slaMinutes: args.settings.callback_sla_minutes,
        customBody,
      });

      await store.createMessage({
        tenantId: args.tenantId,
        callId: args.callId,
        toPhone: args.toPhone,
        kind,
        body: sent.body,
        providerSid: sent.sid,
        status: sent.provider === 'simulated' ? 'queued' : 'sent',
      });
    } catch (error) {
      await store.createMessage({
        tenantId: args.tenantId,
        callId: args.callId,
        toPhone: args.toPhone,
        kind,
        body: args.urgent
          ? `Urgent request received. We will call within ${args.settings.callback_sla_minutes} minutes.`
          : (customBody ?? 'Request received. We will confirm your appointment shortly.'),
        status: 'failed',
      });

      await enqueueOrLog(
        'sms-retry',
        {
          tenantId: args.tenantId,
          idempotencyKey: `${args.callId}:${kind}`,
          payload: {
            callId: args.callId,
            toPhone: args.toPhone,
            urgent: args.urgent,
            body: args.urgent
              ? `Urgent request received. We will call within ${args.settings.callback_sla_minutes} minutes.`
              : (customBody ?? 'Request received. We will confirm your appointment shortly.'),
            error: error instanceof Error ? error.message : 'Unknown SMS send error',
          },
        },
        'sendPostCallSms:retry',
      );
    }
  }

  async function finalizeAndNotify(args: {
    callId: string;
    settings: {
      business_name: string;
      callback_sla_minutes: number;
    };
    outcome: CallOutcome;
    urgent: boolean;
    jobDraft: Record<string, unknown>;
    requestedSchedule?: RequestedSchedule;
    skipAutoBooking?: boolean;
  }) {
    const finalized = await store.finalizeCall({
      callId: args.callId,
      outcome: args.outcome,
      jobDraft: args.jobDraft,
    });

    if (finalized.created) {
      let finalJob = finalized.job;
      if (!args.urgent) {
        const calendarConnection =
          (calendarService.isLiveProviderEnabled() || process.env.NODE_ENV === 'test')
          ? await store.getCalendarConnection(finalized.call.tenantId)
          : undefined;
        if (!calendarConnection && args.requestedSchedule) {
          finalJob = await store.updateJob(finalized.call.tenantId, finalJob.id, {
            booking_status: 'manual_required',
          });
          await store.addAudit(
            finalized.call.tenantId,
            'AUTO_BOOKING_SKIPPED',
            { reason: 'calendar_not_connected_for_requested_slot' },
            { callId: finalized.call.id, jobId: finalJob.id },
          );
        } else if (calendarConnection) {
          try {
            if (args.skipAutoBooking) {
              finalJob = await store.updateJob(finalized.call.tenantId, finalJob.id, {
                booking_status: 'manual_required',
              });
              await store.addAudit(
                finalized.call.tenantId,
                'AUTO_BOOKING_SKIPPED',
                { reason: 'requested_slot_unavailable' },
                { callId: finalized.call.id, jobId: finalJob.id },
              );
            } else if (args.requestedSchedule) {
              const available = await calendarService.isSlotAvailable({
                connection: calendarConnection,
                slotStart: args.requestedSchedule.slotStart,
                slotEnd: args.requestedSchedule.slotEnd,
              });

              if (available) {
                const booking = await calendarService.createOrUpdateBooking({
                  job: finalJob,
                  tenantId: finalized.call.tenantId,
                  connection: calendarConnection,
                  slotStart: args.requestedSchedule.slotStart,
                  slotEnd: args.requestedSchedule.slotEnd,
                });
                finalJob = await store.updateJob(finalized.call.tenantId, finalJob.id, {
                  status: 'confirmed',
                  booking_status: 'booked',
                  confirmed_slot_start: args.requestedSchedule.slotStart,
                  confirmed_slot_end: args.requestedSchedule.slotEnd,
                  external_event_id: booking.externalEventId,
                });
                await store.addAudit(
                  finalized.call.tenantId,
                  'REQUESTED_SLOT_BOOKED',
                  {
                    slotStart: args.requestedSchedule.slotStart,
                    slotEnd: args.requestedSchedule.slotEnd,
                    externalEventId: booking.externalEventId,
                  },
                  { callId: finalized.call.id, jobId: finalJob.id },
                );
              } else {
                finalJob = await store.updateJob(finalized.call.tenantId, finalJob.id, {
                  booking_status: 'manual_required',
                });
                await store.addAudit(
                  finalized.call.tenantId,
                  'REQUESTED_SLOT_UNAVAILABLE',
                  {
                    slotStart: args.requestedSchedule.slotStart,
                    slotEnd: args.requestedSchedule.slotEnd,
                  },
                  { callId: finalized.call.id, jobId: finalJob.id },
                );
              }
            } else {
              const [slot] = await calendarService.findNextAvailableSlots({
                connection: calendarConnection,
                preferredTimeWindow: finalJob.preferred_time_window,
                count: 1,
              });
              if (slot) {
                const booking = await calendarService.createOrUpdateBooking({
                  job: finalJob,
                  tenantId: finalized.call.tenantId,
                  connection: calendarConnection,
                  slotStart: slot.slotStart,
                  slotEnd: slot.slotEnd,
                });
                finalJob = await store.updateJob(finalized.call.tenantId, finalJob.id, {
                  status: 'confirmed',
                  booking_status: 'booked',
                  confirmed_slot_start: slot.slotStart,
                  confirmed_slot_end: slot.slotEnd,
                  external_event_id: booking.externalEventId,
                });
                await store.addAudit(
                  finalized.call.tenantId,
                  'AUTO_BOOKED',
                  {
                    slotStart: slot.slotStart,
                    slotEnd: slot.slotEnd,
                    externalEventId: booking.externalEventId,
                  },
                  { callId: finalized.call.id, jobId: finalJob.id },
                );
              } else {
                finalJob = await store.updateJob(finalized.call.tenantId, finalJob.id, {
                  booking_status: 'manual_required',
                });
                await store.addAudit(
                  finalized.call.tenantId,
                  'AUTO_BOOKING_SKIPPED',
                  { reason: 'no_available_slots' },
                  { callId: finalized.call.id, jobId: finalJob.id },
                );
              }
            }
          } catch (error) {
            finalJob = await store.updateJob(finalized.call.tenantId, finalJob.id, {
              booking_status: 'manual_required',
            });
            await enqueueOrLog(
              'calendar-write',
              {
                tenantId: finalized.call.tenantId,
                idempotencyKey: `${finalized.call.id}:auto-book`,
                payload: {
                  callId: finalized.call.id,
                  jobId: finalJob.id,
                  error: error instanceof Error ? error.message : 'auto booking failed',
                },
              },
              'finalizeAndNotify:auto-book-failure',
            );
          }
        }
      }

      await sendPostCallSms({
        callId: finalized.call.id,
        tenantId: finalized.call.tenantId,
        toPhone: finalized.call.phoneConfirmed ?? finalized.call.callerPhone,
        urgent: args.urgent,
        bookedSlotStart: finalJob.confirmed_slot_start,
        settings: args.settings,
      });

      await enqueueOrLog(
        'transcript-persist',
        {
          tenantId: finalized.call.tenantId,
          idempotencyKey: finalized.call.id,
          payload: {
            callId: finalized.call.id,
            transcript: finalized.call.transcript.join('\n').slice(0, 10000),
          },
        },
        'finalizeAndNotify:transcript-persist',
      );
      await broadcastJobSnapshot(finalized.call.tenantId);
    }

    return finalized;
  }

  app.addHook('onClose', async () => {
    for (const clients of jobStreamClientsByTenant.values()) {
      for (const stream of clients) {
        if (!stream.writableEnded) {
          stream.end();
        }
      }
    }
    jobStreamClientsByTenant.clear();
    if (store.close) {
      await store.close();
    }
    if (queue.close) {
      await queue.close();
    }
  });

  app.get('/', async () => ({
    service: 'dispatchos-api',
    ok: true,
    health: '/health',
    readiness: '/health',
    docs: '/README.md',
  }));

  app.get('/health', async () => ({
    ok: true,
    service: 'dispatchos-api',
    readiness: {
      productionSafe: healthSnapshot.productionSafe,
      issues: healthSnapshot.issues,
    },
    runtime: healthSnapshot.runtime,
    persistence: healthSnapshot.persistence,
    queue: healthSnapshot.queue,
    auth: healthSnapshot.auth,
    providers: healthSnapshot.providers,
  }));

  app.register(async function registerRealtimeRoutes(realtimeApp) {
    realtimeApp.get(
      '/v1/voice/realtime/:tenantId',
      { websocket: true },
      async (connection, request) => {
        const socket = resolveRealtimeSocket(connection);
        if (!socket) {
          app.log.error(
            { tenantId: (request.params as { tenantId?: string })?.tenantId },
            'unable to resolve websocket connection object',
          );
          return;
        }
        const params = request.params as { tenantId: string };
        const parsedQuery = realtimeSocketQuerySchema.safeParse(request.query ?? {});
        if (!parsedQuery.success) {
          socket.send(
            JSON.stringify({
              type: 'text',
              token: 'Invalid realtime connection request.',
              last: true,
            }),
          );
          socket.close();
          return;
        }
        const { callSid, ts, sig } = parsedQuery.data;
        pruneRealtimeCaches();
        if (
          !isValidRealtimeSocketSig({
            secret: env.TWILIO_AUTH_TOKEN,
            tenantId: params.tenantId,
            callSid,
            timestamp: ts,
            signature: sig,
          })
        ) {
          socket.send(
            JSON.stringify({
              type: 'text',
              token: 'Unauthorized realtime connection.',
              last: true,
            }),
          );
          socket.close();
          return;
        }
        const pendingMessages: unknown[] = [];
        let processRealtimeMessage: ((raw: unknown) => Promise<void>) | null = null;
        let realtimeMessageQueue = Promise.resolve();
        socket.on('message', (raw: unknown) => {
          if (!processRealtimeMessage) {
            pendingMessages.push(raw);
            return;
          }
          realtimeMessageQueue = realtimeMessageQueue
            .then(() => processRealtimeMessage?.(raw))
            .catch((error) => {
              app.log.error({ err: error, callSid }, 'realtime message queue failed');
            });
        });

        const call = await store.getCallBySid(params.tenantId, callSid);
        if (!call) {
          socket.send(
            JSON.stringify({
              type: 'text',
              token: 'Call not found for this realtime session.',
              last: true,
            }),
          );
          socket.close();
          return;
        }

        let settings;
        try {
          settings = await store.getTenantSettings(params.tenantId);
        } catch {
          socket.send(
            JSON.stringify({
              type: 'text',
              token: 'Tenant not found. Please call again in a moment.',
            }),
          );
          socket.close();
          return;
        }

        if (!realtimeTranscriptByCallSid.has(callSid)) {
          realtimeTranscriptByCallSid.set(callSid, []);
        }
        realtimeLastSeenByCallSid.set(callSid, Date.now());
        if (!realtimeStateByCallSid.has(callSid)) {
          realtimeStateByCallSid.set(callSid, {
            issueText: call.issueText,
            addressRaw: call.addressRaw,
            addressConfirmed: call.addressConfirmed,
            preferredTimeWindow: call.preferredTimeWindow,
            phoneConfirmed:
              call.phoneConfirmed ??
              (call.callerPhone !== 'unknown' ? call.callerPhone : undefined),
            urgent: call.urgency === 'urgent',
          });
        }

        let assistantBuffer = '';
        let startedGreeting = false;
        let transferRequested = false;
        const supportedRealtimeLanguages = settings.languages.length
          ? [...new Set(settings.languages)]
          : (['en'] as Array<'fr' | 'en'>);
        const defaultRealtimeLanguage = supportedRealtimeLanguages.includes('en') ? 'en' : 'fr';
        let currentSpeechLang: 'en-US' | 'fr-FR' =
          defaultRealtimeLanguage === 'fr' ? 'fr-FR' : 'en-US';
        const sendRealtimeText = (
          token: string,
          last: boolean,
          lang: 'en-US' | 'fr-FR' = currentSpeechLang,
        ): void => {
          socket.send(
            JSON.stringify({
              type: 'text',
              token,
              last,
              lang,
            }),
          );
        };
        const sendAssistantMessage = (
          text: string,
          lang: 'en-US' | 'fr-FR' = currentSpeechLang,
        ): void => {
          const trimmed = text.trim();
          if (!trimmed) return;
          addRealtimeTurn(callSid, { role: 'assistant', text: trimmed });
          realtimeLastAssistantOutputAtByCallSid.set(callSid, Date.now());
          sendRealtimeText(trimmed, true, lang);
        };
        const realtimeTools: Record<string, RealtimeToolDefinition> = {
          lookup_business_answer: {
            description:
              'Answer a caller question from the saved business details, services, FAQs, and hours.',
            parameters: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                language: { type: 'string', enum: ['en', 'fr'] },
              },
              required: ['question', 'language'],
              additionalProperties: false,
            },
            handler: async (input) => {
              const question = typeof input.question === 'string' ? input.question : '';
              const language = input.language === 'fr' ? 'fr' : 'en';
              const answer = answerBusinessQuestionFromSettings({
                text: question,
                language,
                settings,
              });

              return {
                answered: Boolean(answer),
                answer:
                  answer ??
                  localizedRealtimeText(
                    language,
                    'I can have the team confirm that for you shortly.',
                    "Je peux demander à l'équipe de vous le confirmer rapidement.",
                  ),
              };
            },
          },
          get_intake_state: {
            description:
              'Return the current extracted intake state and the single next question still needed.',
            parameters: {
              type: 'object',
              properties: {
                language: { type: 'string', enum: ['en', 'fr'] },
              },
              additionalProperties: false,
            },
            handler: async (input) => {
              const language =
                input.language === 'fr' || currentSpeechLang === 'fr-FR' ? 'fr' : 'en';
              const state = cloneRealtimeState(realtimeStateByCallSid.get(callSid)) ?? {
                addressConfirmed: false,
                urgent: false,
              };
              const missingQuestion = nextMissingRealtimeQuestion(state, language);

              return {
                issueText: state.issueText ?? null,
                addressRaw: state.addressRaw ?? null,
                addressConfirmed: state.addressConfirmed,
                preferredTimeWindow: state.preferredTimeWindow ?? null,
                requestedScheduleLabel: state.requestedSchedule?.label ?? null,
                requestedScheduleAvailability: state.requestedScheduleAvailability ?? null,
                phoneConfirmed: state.phoneConfirmed ?? null,
                urgent: state.urgent,
                urgentPendingConfirmation: Boolean(state.urgentPendingConfirmation),
                nextQuestion: missingQuestion,
                readyToClose: !missingQuestion,
              };
            },
          },
          check_requested_slot: {
            description:
              'Check whether the current requested appointment time is available for this caller.',
            parameters: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            handler: async () => {
              const state = cloneRealtimeState(realtimeStateByCallSid.get(callSid));
              if (!state?.requestedSchedule) {
                return { status: 'missing_schedule' };
              }

              if (!settings.calendar_enabled) {
                return {
                  status: 'calendar_disabled',
                  requestedScheduleLabel: state.requestedSchedule.label,
                  nextAction: 'say_team_will_confirm',
                };
              }

              const calendarConnection =
                calendarService.isLiveProviderEnabled() || process.env.NODE_ENV === 'test'
                  ? await store.getCalendarConnection(params.tenantId)
                  : undefined;
              if (!calendarConnection) {
                return {
                  status: 'calendar_not_connected',
                  requestedScheduleLabel: state.requestedSchedule.label,
                  nextAction: 'say_team_will_confirm',
                };
              }

              try {
                const available = await calendarService.isSlotAvailable({
                  connection: calendarConnection,
                  slotStart: state.requestedSchedule.slotStart,
                  slotEnd: state.requestedSchedule.slotEnd,
                });

                state.requestedScheduleAvailability = available ? 'available' : 'unavailable';
                realtimeStateByCallSid.set(callSid, state);

                return {
                  status: available ? 'available' : 'unavailable',
                  requestedScheduleLabel: state.requestedSchedule.label,
                  nextAction: available ? 'close_with_confirmation' : 'ask_for_another_time',
                };
              } catch {
                return {
                  status: 'availability_unknown',
                  requestedScheduleLabel: state.requestedSchedule.label,
                  nextAction: 'say_team_will_confirm',
                };
              }
            },
          },
        };
        const realtimeSession = realtimeConversation.createSession({
          businessName: settings.business_name,
          knowledgeInstruction: buildKnowledgeInstruction(settings),
          escalationPhone: settings.escalation_phone,
          callbackSlaMinutes: settings.callback_sla_minutes,
          languages: settings.languages,
          tools: realtimeTools,
          onTextDelta: (token) => {
            assistantBuffer += token;
            sendRealtimeText(token, false);
          },
          onTextDone: () => {
            if (assistantBuffer.trim()) {
              addRealtimeTurn(callSid, { role: 'assistant', text: assistantBuffer.trim() });
              realtimeLastAssistantOutputAtByCallSid.set(callSid, Date.now());
            }
            assistantBuffer = '';
            sendRealtimeText('', true);
          },
          onError: (message) => {
            app.log.warn({ callSid, message }, 'realtime session warning');
          },
        });
        processRealtimeMessage = async (raw: unknown) => {
          try {
            const rawText =
              typeof raw === 'string'
                ? raw
                : Buffer.isBuffer(raw)
                  ? raw.toString('utf8')
                  : String(raw);
            let parsedJson: unknown;
            try {
              parsedJson = JSON.parse(rawText);
            } catch {
              socket.send(
                JSON.stringify({
                  type: 'text',
                  token: 'Invalid realtime message payload.',
                  last: true,
                }),
              );
              return;
            }

            const parsedPayload = realtimeInboundMessageSchema.safeParse(parsedJson);
            if (!parsedPayload.success) {
              socket.send(
                JSON.stringify({ type: 'text', token: 'Unsupported realtime event.', last: true }),
              );
              return;
            }
            const payload = parsedPayload.data;

            if (payload.type === 'prompt') {
              const userText = String(payload.voicePrompt);
              const detectedLanguage = payload.lang?.toLowerCase().startsWith('fr')
                ? 'fr'
                : await classifier.detectLanguage(userText || 'hello');
              currentSpeechLang =
                detectedLanguage === 'fr' && supportedRealtimeLanguages.includes('fr')
                  ? 'fr-FR'
                  : 'en-US';
              if (isLikelyUnclearRealtimeTranscript(userText)) {
                sendAssistantMessage(
                  localizedRealtimeText(
                    detectedLanguage,
                    'I did not catch that clearly. Please repeat the last detail.',
                    "Je n'ai pas bien compris. Pouvez-vous répéter le dernier détail ?",
                  ),
                );
                return;
              }
              const lastAssistantText = [...(realtimeTranscriptByCallSid.get(callSid) ?? [])]
                .reverse()
                .find((turn) => turn.role === 'assistant')?.text;
              const lastAssistantAt = realtimeLastAssistantOutputAtByCallSid.get(callSid) ?? 0;
              if (
                Date.now() - lastAssistantAt < 4000 &&
                looksLikeAssistantEcho(userText, lastAssistantText)
              ) {
                app.log.info({ callSid, userText }, 'ignoring likely assistant echo');
                return;
              }

              const previousState = cloneRealtimeState(realtimeStateByCallSid.get(callSid));
              const transcript = addRealtimeTurn(callSid, { role: 'user', text: userText });
              const intakeState = await captureRealtimeUserTurn(
                callSid,
                userText,
                call.createdAt,
                lastAssistantText,
              );
              const callerNeedsService = hasActiveRealtimeServiceNeed(intakeState);
              const smallTalk = isSmallTalkText(userText);
              const informationalQuestion = looksLikeInformationalQuestion(userText);
              const directBusinessAnswer = isBusinessQuestion(userText)
                ? answerBusinessQuestionFromSettings({
                    text: userText,
                    language: detectedLanguage,
                    settings,
                  })
                : undefined;
              const missingQuestion = nextMissingRealtimeQuestion(intakeState, detectedLanguage);
              const acknowledgement = buildRealtimeAcknowledgement(detectedLanguage, {
                previousState,
                state: intakeState,
              });

              if (smallTalk && !callerNeedsService && !directBusinessAnswer) {
                sendAssistantMessage(
                  localizedRealtimeText(
                    detectedLanguage,
                    "I'm well, thanks. How can I help you today?",
                    "Je vais bien, merci. Comment puis-je vous aider aujourd'hui ?",
                  ),
                );
                return;
              }

              if (informationalQuestion && !callerNeedsService) {
                sendAssistantMessage(
                  directBusinessAnswer ||
                    localizedRealtimeText(
                      detectedLanguage,
                      'I can have the team confirm that for you shortly.',
                      "Je peux demander à l'équipe de vous le confirmer rapidement.",
                    ),
                );
                return;
              }

              if (intakeState.urgent && !transferRequested) {
                transferRequested = true;
                const transferPath = `${env.API_BASE_URL}/v1/telephony/transfer/status?tenantId=${params.tenantId}&callId=${call.id}`;

                if (twilioVoiceClient && !call.twilioCallSid.startsWith('TEST-')) {
                  try {
                    await store.updateCall(call.id, { urgency: 'urgent' });
                    await twilioVoiceClient.calls(call.twilioCallSid).update({
                      twiml: twimlTransfer(settings.escalation_phone, transferPath),
                    });
                    sendAssistantMessage('Understood. Transferring you to the on-call team now.');
                    socket.close();
                    return;
                  } catch (error) {
                    transferRequested = false;
                    app.log.error(
                      { err: error, callSid },
                      'live transfer failed, falling back to urgent callback workflow',
                    );
                  }
                }

                await finalizeRealtimeConversation({
                  tenantId: params.tenantId,
                  callSid,
                  transcriptTurns: transcript,
                  intakeState,
                  settings,
                  forceUrgent: true,
                });
                sendAssistantMessage(
                  `Urgent request captured. We will call within ${settings.callback_sla_minutes} minutes.`,
                );
                socket.close();
                return;
              }

              const openAiHandledTurn =
                realtimeSession?.sendUserTurn(
                  userText,
                  buildRealtimeAgentTurnInstruction({
                    language: detectedLanguage,
                    state: intakeState,
                    businessHasCalendar: settings.calendar_enabled,
                  }),
                ) ?? false;
              if (openAiHandledTurn) {
                return;
              }

              if (
                intakeState.requestedSchedule &&
                intakeState.issueText &&
                intakeState.addressRaw &&
                intakeState.phoneConfirmed &&
                !missingQuestion
              ) {
                const calendarConnection =
                  settings.calendar_enabled &&
                  (calendarService.isLiveProviderEnabled() || process.env.NODE_ENV === 'test')
                  ? await store.getCalendarConnection(params.tenantId)
                  : undefined;
                if (calendarConnection) {
                  try {
                    const slotAvailable = await calendarService.isSlotAvailable({
                      connection: calendarConnection,
                      slotStart: intakeState.requestedSchedule.slotStart,
                      slotEnd: intakeState.requestedSchedule.slotEnd,
                    });
                    intakeState.requestedScheduleAvailability = slotAvailable
                      ? 'available'
                      : 'unavailable';
                  } catch {
                    intakeState.requestedScheduleAvailability = undefined;
                  }
                }
              }

              if (intakeState.urgentPendingConfirmation && !intakeState.urgent && missingQuestion) {
                sendAssistantMessage(
                  localizedRealtimeText(
                    detectedLanguage,
                    'Just to confirm, do you need the on-call team right now?',
                    "Juste pour confirmer, avez-vous besoin de l'équipe d'urgence tout de suite ?",
                  ),
                );
                return;
              }

              if (directBusinessAnswer && callerNeedsService) {
                sendAssistantMessage(
                  missingQuestion
                  ? `${directBusinessAnswer} ${missingQuestion}`
                  : `${directBusinessAnswer} ${localizedRealtimeText(
                      detectedLanguage,
                      "Thanks, I have what I need. We'll text the confirmation shortly.",
                      "Merci, j'ai tout ce qu'il faut. Nous vous envoyons la confirmation par SMS rapidement.",
                    )}`,
                );
                return;
              }

              if (missingQuestion) {
                sendAssistantMessage(
                  acknowledgement ? `${acknowledgement} ${missingQuestion}` : missingQuestion,
                );
                return;
              }

              if (intakeState.requestedScheduleAvailability === 'unavailable') {
                sendAssistantMessage(
                  localizedRealtimeText(
                    detectedLanguage,
                    "That exact time isn't available. What other time works for you?",
                    "Cet horaire précis n'est pas disponible. Quel autre horaire vous conviendrait ?",
                  ),
                );
                return;
              }

              if (intakeState.requestedScheduleAvailability === 'available') {
                sendAssistantMessage(
                  buildRealtimeCompletionMessage({
                    language: detectedLanguage,
                    state: intakeState,
                    businessHasCalendar: settings.calendar_enabled,
                  }),
                );
                return;
              }

              sendAssistantMessage(
                buildRealtimeCompletionMessage({
                  language: detectedLanguage,
                  state: intakeState,
                  businessHasCalendar: settings.calendar_enabled,
                }),
              );
              return;
            }

            if (payload.type === 'interrupt') {
              const interruptText = String(payload.utteranceUntilInterrupt);
              currentSpeechLang =
                payload.lang?.toLowerCase().startsWith('fr') && supportedRealtimeLanguages.includes('fr')
                  ? 'fr-FR'
                  : currentSpeechLang;
              addRealtimeTurn(callSid, { role: 'user', text: interruptText });
              await captureRealtimeUserTurn(callSid, interruptText, call.createdAt);
              realtimeSession?.cancelResponse();
              return;
            }

            if (payload.type === 'setup') {
              if (startedGreeting) {
                return;
              }
              startedGreeting = true;
              return;
            }
          } catch (error) {
            app.log.error({ err: error, callSid }, 'realtime inbound message processing failed');
            socket.send(
              JSON.stringify({
                type: 'text',
                token: 'Sorry, I did not catch that. Could you repeat?',
                last: true,
              }),
            );
          }
        };
        for (const bufferedMessage of pendingMessages.splice(0)) {
          await processRealtimeMessage(bufferedMessage);
        }

        socket.on('close', () => {
          void (async () => {
            await realtimeMessageQueue.catch(() => undefined);
            realtimeSession?.close();
            const transcriptSnapshot = [...(realtimeTranscriptByCallSid.get(callSid) ?? [])];
            const intakeSnapshot = realtimeStateByCallSid.get(callSid);
            let finalizedSuccessfully = false;
            try {
              if (!transferRequested) {
                await finalizeRealtimeConversation({
                  tenantId: params.tenantId,
                  callSid,
                  transcriptTurns: transcriptSnapshot,
                  intakeState: intakeSnapshot,
                  settings,
                });
                finalizedSuccessfully = true;
              }
            } catch (error) {
              app.log.error(
                {
                  err: error,
                  callSid,
                  tenantId: params.tenantId,
                },
                'realtime finalization failed after socket close',
              );
            } finally {
              if (transferRequested || finalizedSuccessfully) {
                realtimeTranscriptByCallSid.delete(callSid);
                realtimeStateByCallSid.delete(callSid);
                realtimeLastSeenByCallSid.delete(callSid);
                realtimeLastAssistantOutputAtByCallSid.delete(callSid);
              }
            }
          })();
        });
      },
    );
  });

  app.post('/v1/telephony/inbound/:tenantId', async (request, reply) => {
    if (!verifyTwilioRequest(request)) {
      return reply.status(403).send('Invalid Twilio signature');
    }

    const tenantId = (request.params as { tenantId: string }).tenantId;
    const body = request.body as Record<string, string>;
    const callSid = body.CallSid ?? `SIM-${Date.now()}`;
    const from = body.From ?? 'unknown';

    let settings;
    try {
      settings = await store.getTenantSettings(tenantId);
    } catch {
      return tenantNotFound(reply);
    }

    const call = await store.startCall({ tenantId, callSid, callerPhone: from });

    if (env.VOICE_FLOW_MODE === 'realtime' && settings.enabled) {
      const wsBase = toWebSocketUrl(env.API_BASE_URL);
      const issuedAt = `${Date.now()}`;
      const sig = buildRealtimeSocketSig(env.TWILIO_AUTH_TOKEN, tenantId, callSid, issuedAt);
      const wsUrl = `${wsBase}/v1/voice/realtime/${tenantId}?callSid=${encodeURIComponent(callSid)}&ts=${encodeURIComponent(issuedAt)}&sig=${encodeURIComponent(sig)}`;
      reply.header('Content-Type', 'text/xml');
      return reply.send(
        twimlConversationRelay({
          websocketUrl: wsUrl,
          welcomeGreeting: `Thanks for calling ${settings.business_name}. I'm the live service assistant. What do you need help with today?`,
          defaultLanguage: settings.languages.includes('en') ? 'en' : 'fr',
          supportedLanguages: settings.languages.length
            ? settings.languages
            : (['en'] as Array<'fr' | 'en'>),
          hints: [
            settings.business_name,
            ...settings.services.map((service) => service.name),
            ...settings.faqs.map((faq) => faq.question),
          ].filter(Boolean),
        }),
      );
    }

    if (!settings.enabled) {
      reply.header('Content-Type', 'text/xml');
      return reply.send(
        twimlTransfer(
          settings.business_phone,
          `/v1/telephony/transfer/status?tenantId=${tenantId}&callId=${call.id}`,
        ),
      );
    }

    await store.addAudit(tenantId, 'STEP_CAPTURED', { step: 'problem' }, { callId: call.id });
    reply.header('Content-Type', 'text/xml');
    return reply.send(
      twimlGatherPrompt({
        text: `Automated assistant for ${settings.business_name}. I can take your request and have the team confirm a time. What do you need help with?`,
        actionPath: `/v1/telephony/gather/${tenantId}/${call.id}/problem`,
      }),
    );
  });

  app.post('/v1/telephony/gather/:tenantId/:callId/:step', async (request, reply) => {
    if (!verifyTwilioRequest(request)) {
      return reply.status(403).send('Invalid Twilio signature');
    }

    const params = request.params as { tenantId: string; callId: string; step: string };
    const body = gatherBodySchema.parse(request.body);
    const call = await store.getCall(params.callId);
    if (!call) return reply.status(404).send('Call not found');
    if (call.tenantId !== params.tenantId) return reply.status(404).send('Call not found');

    if (call.outcome) {
      reply.header('Content-Type', 'text/xml');
      return reply.send(
        twimlSayAndHangup("This request is already captured. You'll receive an SMS confirmation."),
      );
    }

    let settings;
    try {
      settings = await store.getTenantSettings(params.tenantId);
    } catch {
      return tenantNotFound(reply);
    }

    const speech = body.SpeechResult.trim();
    if (speech) {
      await store.appendTranscript(call.id, `[${params.step}] ${speech}`);
    }

    const transferPath = `/v1/telephony/transfer/status?tenantId=${params.tenantId}&callId=${call.id}`;

    if (params.step === 'problem') {
      const language = await classifier.detectLanguage(speech || 'hello');
      const urgentByKeyword = isUrgentText(speech) || humanRequest(speech);
      const urgentByModel = urgentByKeyword ? false : await classifier.isUrgent(speech);
      const urgent = urgentByKeyword || urgentByModel;

      const updatedCall = await store.updateCall(call.id, {
        issueText: speech || 'Customer needs support',
        languageDetected: language,
        urgency: urgent ? 'urgent' : 'normal',
      });

      if (urgent) {
        reply.header('Content-Type', 'text/xml');
        return reply.send(twimlTransfer(settings.escalation_phone, transferPath));
      }

      await store.setStep(updatedCall.id, 'address');
      reply.header('Content-Type', 'text/xml');
      return reply.send(
        twimlGatherPrompt({
          text:
            language === 'fr'
              ? 'Merci. Quelle est votre adresse exacte?'
              : 'Thanks. What is your full address?',
          actionPath: `/v1/telephony/gather/${params.tenantId}/${call.id}/address`,
        }),
      );
    }

    if (params.step === 'address') {
      const confidence = await classifier.addressConfidence(speech);
      let updatedCall = await store.updateCall(call.id, { addressRaw: speech });

      if (confidence < 0.6) {
        updatedCall = await store.updateCall(call.id, {
          lowConfidenceCount: updatedCall.lowConfidenceCount + 1,
        });
        if (updatedCall.lowConfidenceCount > 1) {
          await store.updateCall(call.id, { urgency: 'urgent' });
          reply.header('Content-Type', 'text/xml');
          return reply.send(twimlTransfer(settings.escalation_phone, transferPath));
        }
      }

      await store.setStep(call.id, 'address_confirm');
      reply.header('Content-Type', 'text/xml');
      return reply.send(
        twimlGatherPrompt({
          text: `I heard ${speech}. Is that correct? Please say yes or no.`,
          actionPath: `/v1/telephony/gather/${params.tenantId}/${call.id}/address_confirm`,
        }),
      );
    }

    if (params.step === 'address_confirm') {
      const isYes = yesIntent(speech);
      if (!isYes) {
        const updated = await store.updateCall(call.id, {
          lowConfidenceCount: call.lowConfidenceCount + 1,
        });
        if (updated.lowConfidenceCount > 1) {
          await store.updateCall(call.id, { urgency: 'urgent' });
          reply.header('Content-Type', 'text/xml');
          return reply.send(twimlTransfer(settings.escalation_phone, transferPath));
        }

        reply.header('Content-Type', 'text/xml');
        return reply.send(
          twimlGatherPrompt({
            text: 'Please repeat your address carefully.',
            actionPath: `/v1/telephony/gather/${params.tenantId}/${call.id}/address`,
          }),
        );
      }

      await store.updateCall(call.id, { addressConfirmed: true });
      await store.setStep(call.id, 'time_window');
      reply.header('Content-Type', 'text/xml');
      return reply.send(
        twimlGatherPrompt({
          text: 'What time works best: morning, afternoon, evening, or a specific time?',
          actionPath: `/v1/telephony/gather/${params.tenantId}/${call.id}/time_window`,
        }),
      );
    }

    if (params.step === 'time_window') {
      const window = classifier.inferTimeWindow(speech);
      const updated = await store.updateCall(call.id, { preferredTimeWindow: window });
      const callerMissing = updated.callerPhone === 'unknown';

      if (callerMissing) {
        await store.setStep(call.id, 'phone_confirm');
        reply.header('Content-Type', 'text/xml');
        return reply.send(
          twimlGatherPrompt({
            text: 'Please say your phone number so the team can call you back.',
            actionPath: `/v1/telephony/gather/${params.tenantId}/${call.id}/phone_confirm`,
          }),
        );
      }

      const draft = await buildQualifiedJobDraft({ call: updated, settings, classifier });
      await finalizeAndNotify({
        callId: updated.id,
        settings,
        outcome: 'QUALIFIED_JOB',
        urgent: false,
        jobDraft: draft,
      });

      reply.header('Content-Type', 'text/xml');
      return reply.send(
        twimlSayAndHangup(
          "Thanks, your request is received. You'll receive an SMS confirmation now.",
        ),
      );
    }

    if (params.step === 'phone_confirm') {
      const phone = classifier.extractPhone(speech);
      const updated = await store.updateCall(call.id, { phoneConfirmed: phone });
      const draft = await buildQualifiedJobDraft({ call: updated, settings, classifier });

      await finalizeAndNotify({
        callId: updated.id,
        settings,
        outcome: 'QUALIFIED_JOB',
        urgent: false,
        jobDraft: draft,
      });

      reply.header('Content-Type', 'text/xml');
      return reply.send(twimlSayAndHangup("Perfect. You'll receive an SMS confirmation now."));
    }

    return reply.status(400).send('Unsupported step');
  });

  app.post('/v1/telephony/transfer/status', async (request, reply) => {
    if (!verifyTwilioRequest(request)) {
      return reply.status(403).send('Invalid Twilio signature');
    }

    const query = request.query as { tenantId: string; callId: string };
    const body = request.body as Record<string, string>;
    const status = body.DialCallStatus ?? 'failed';

    const call = await store.getCall(query.callId);
    if (!call || call.tenantId !== query.tenantId) return reply.status(404).send('Call not found');

    let settings;
    try {
      settings = await store.getTenantSettings(query.tenantId);
    } catch {
      return tenantNotFound(reply);
    }

    const outcome = mapTransferStatusToOutcome(status);
    const normalizedCall = await store.updateCall(call.id, { urgency: 'urgent' });

    const draft = await buildQualifiedJobDraft({
      call: normalizedCall,
      settings,
      classifier,
    });

    await finalizeAndNotify({
      callId: normalizedCall.id,
      settings,
      outcome,
      urgent: true,
      jobDraft: draft,
    });

    reply.header('Content-Type', 'text/xml');
    return reply.send(
      twimlSayAndHangup(
        outcome === 'ESCALATED_LIVE_TRANSFER'
          ? 'Your urgent request was transferred. Thank you.'
          : `Urgent request received. We will call within ${settings.callback_sla_minutes} minutes.`,
      ),
    );
  });

  app.post('/v1/telephony/status', async (request, reply) => {
    if (!verifyTwilioRequest(request)) {
      return reply.status(403).send({ error: 'Invalid Twilio signature' });
    }

    const body = request.body as Record<string, string>;
    const callSid = body.CallSid;
    const callStatus = body.CallStatus ?? 'unknown';

    if (callSid && terminalTwilioStatus(callStatus)) {
      const call = await store.findCallBySid(callSid);
      if (call && !call.outcome) {
        let settings;
        try {
          settings = await store.getTenantSettings(call.tenantId);
        } catch {
          return reply.send({ ok: true });
        }
        const realtimeTranscript = [...(realtimeTranscriptByCallSid.get(callSid) ?? [])];
        const realtimeState = realtimeStateByCallSid.get(callSid);
        const isRealtimeCall =
          env.VOICE_FLOW_MODE === 'realtime' &&
          (realtimeTranscript.length > 0 || Boolean(realtimeState));

        if (isRealtimeCall) {
          try {
            await finalizeRealtimeConversation({
              tenantId: call.tenantId,
              callSid,
              transcriptTurns: realtimeTranscript,
              intakeState: realtimeState,
              settings,
            });
            realtimeTranscriptByCallSid.delete(callSid);
            realtimeStateByCallSid.delete(callSid);
            realtimeLastSeenByCallSid.delete(callSid);
            realtimeLastAssistantOutputAtByCallSid.delete(callSid);
            app.log.warn(
              { callSid, callId: call.id, callStatus },
              'terminal status finalized using realtime transcript',
            );
          } catch (error) {
            app.log.error(
              { err: error, callSid, callId: call.id },
              'realtime status finalization failed; falling back to urgent callback',
            );
            const escalated = await store.updateCall(call.id, { urgency: 'urgent' });
            const draft = await buildQualifiedJobDraft({ call: escalated, settings, classifier });
            await finalizeAndNotify({
              callId: escalated.id,
              settings,
              outcome: 'ESCALATED_CALLBACK_SLA',
              urgent: true,
              jobDraft: draft,
            });
          }
        } else {
          const escalated = await store.updateCall(call.id, { urgency: 'urgent' });
          const draft = await buildQualifiedJobDraft({ call: escalated, settings, classifier });
          await finalizeAndNotify({
            callId: escalated.id,
            settings,
            outcome: 'ESCALATED_CALLBACK_SLA',
            urgent: true,
            jobDraft: draft,
          });
          app.log.warn(
            { callSid, callId: call.id, callStatus },
            'call reached terminal status without outcome; fallback escalation applied',
          );
        }
      }
    }

    app.log.info({ callSid, callStatus }, 'twilio call status callback');
    return reply.send({ ok: true });
  });

  app.post('/v1/sms/status', async (request, reply) => {
    if (!verifyTwilioRequest(request)) {
      return reply.status(403).send({ error: 'Invalid Twilio signature' });
    }

    const body = request.body as Record<string, string>;
    const providerSid = body.MessageSid;
    const status = body.MessageStatus;

    const mapping: Record<string, 'queued' | 'sent' | 'delivered' | 'failed'> = {
      queued: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      undelivered: 'failed',
      failed: 'failed',
    };

    if (providerSid && status) {
      await store.updateMessageStatus(providerSid, mapping[status] ?? 'failed');
    }

    return reply.send({ ok: true });
  });

  app.post('/v1/sms/inbound', async (request, reply) => {
    if (!verifyTwilioRequest(request)) {
      return reply.status(403).send({ error: 'Invalid Twilio signature' });
    }

    const body = request.body as Record<string, string> | undefined;
    app.log.info(
      {
        from_present: Boolean(body?.From),
        body_present: Boolean(body?.Body),
      },
      'inbound sms captured (ignored in v1)',
    );
    return reply.send({ ok: true });
  });

  app.get('/v1/jobs/stream', { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as typeof request & { auth: { tenantId: string } }).auth;
    reply.hijack();
    const stream = reply.raw;
    stream.statusCode = 200;
    stream.setHeader('Content-Type', 'text/event-stream');
    stream.setHeader('Cache-Control', 'no-cache, no-transform');
    stream.setHeader('Connection', 'keep-alive');
    stream.setHeader('X-Accel-Buffering', 'no');
    stream.flushHeaders?.();

    const clients = jobStreamClientsByTenant.get(auth.tenantId) ?? new Set<ServerResponse>();
    clients.add(stream);
    jobStreamClientsByTenant.set(auth.tenantId, clients);

    const heartbeat = setInterval(() => {
      if (!stream.destroyed && !stream.writableEnded) {
        stream.write(': ping\n\n');
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      removeJobStreamClient(auth.tenantId, stream);
    };
    request.raw.once('close', cleanup);
    stream.once('close', cleanup);

    const items = await store.listJobs(auth.tenantId);
    writeSse(stream, 'jobs', { items, at: new Date().toISOString() });
  });

  app.get('/v1/jobs', { preHandler: requireAuth }, async (request) => {
    const auth = (request as typeof request & { auth: { tenantId: string } }).auth;
    const status = (request.query as { status?: 'urgent' | 'new' | 'confirmed' | 'closed' }).status;
    return { items: await store.listJobs(auth.tenantId, status) };
  });

  app.get('/v1/jobs/:jobId', { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as typeof request & { auth: { tenantId: string } }).auth;
    const { jobId } = request.params as { jobId: string };
    const job = await store.getJob(auth.tenantId, jobId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const audits = await store.getAudits(job.callId);
    return { job, timeline: audits };
  });

  app.post('/internal/queue/calendar-write', async (request, reply) => {
    if (!env.QUEUE_SHARED_SECRET) {
      return reply.status(503).send({ error: 'Queue recovery is not configured.' });
    }
    if (!hasValidQueueSecret(request.headers['x-queue-secret'])) {
      return reply.status(401).send({ error: 'Unauthorized queue request.' });
    }

    const payload = calendarWriteRetrySchema.parse(request.body ?? {});
    const job = await recoverCalendarWriteRetry(payload);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return { ok: true, job };
  });

  app.post('/v1/jobs/:jobId/confirm-time', { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as typeof request & { auth: { tenantId: string } }).auth;
    const { jobId } = request.params as { jobId: string };
    const body = z
      .object({ slotStart: z.string().min(1), slotEnd: z.string().optional() })
      .parse(request.body ?? {});

    const job = await store.getJob(auth.tenantId, jobId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    let patch: Partial<JobRecord> = {
      status: 'confirmed',
      confirmed_slot_start: body.slotStart,
      confirmed_slot_end: body.slotEnd,
      booking_status: 'manual_required',
    };

    const calendarConnection =
      (calendarService.isLiveProviderEnabled() || process.env.NODE_ENV === 'test')
      ? await store.getCalendarConnection(auth.tenantId)
      : undefined;
    if (calendarConnection) {
      try {
        const booking = await calendarService.createOrUpdateBooking({
          job,
          tenantId: auth.tenantId,
          slotStart: body.slotStart,
          slotEnd: body.slotEnd,
          connection: calendarConnection,
        });
        patch = {
          ...patch,
          booking_status: 'booked',
          external_event_id: booking.externalEventId,
        };
      } catch (error) {
        await enqueueOrLog(
          'calendar-write',
          {
            tenantId: auth.tenantId,
            idempotencyKey: `${jobId}:${body.slotStart}`,
            payload: {
              jobId,
              slotStart: body.slotStart,
              slotEnd: body.slotEnd,
              error: error instanceof Error ? error.message : 'calendar booking failed',
            },
          },
          'confirm-time:calendar-write-failure',
        );
      }
    }

    const updatedJob = await store.updateJob(auth.tenantId, jobId, patch);
    await broadcastJobSnapshot(auth.tenantId);
    return { job: updatedJob };
  });

  app.post('/v1/jobs/:jobId/callback', { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as typeof request & { auth: { tenantId: string } }).auth;
    const { jobId } = request.params as { jobId: string };
    const job = await store.getJob(auth.tenantId, jobId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const updated = await store.updateJob(auth.tenantId, jobId, {
      status: job.urgency === 'urgent' ? 'urgent' : 'new',
    });
    await broadcastJobSnapshot(auth.tenantId);
    return { job: updated };
  });

  app.post('/v1/jobs/:jobId/close', { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as typeof request & { auth: { tenantId: string } }).auth;
    const { jobId } = request.params as { jobId: string };
    const job = await store.getJob(auth.tenantId, jobId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const updatedJob = await store.updateJob(auth.tenantId, jobId, { status: 'closed' });
    await broadcastJobSnapshot(auth.tenantId);
    return { job: updatedJob };
  });

  app.get('/v1/settings', { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as typeof request & { auth: AuthContext }).auth;
    const query = request.query as { clientId?: string };
    const targetTenant = resolveTargetTenant(auth, query.clientId);
    if (!targetTenant) {
      return reply.status(403).send({ error: 'Only client_admin role can access other tenants.' });
    }
    try {
      const raw = await store.getTenantSettings(targetTenant);
      return {
        settings: {
          ...raw,
          calendar_enabled:
            raw.calendar_enabled && (calendarConfigured || process.env.NODE_ENV === 'test'),
          id: raw.tenantId,
          workspaceId: raw.tenantId,
        },
        persistence,
      };
    } catch {
      return tenantNotFound(reply);
    }
  });

  app.patch('/v1/settings', { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as typeof request & { auth: AuthContext }).auth;
    const query = request.query as { clientId?: string };
    const targetTenant = resolveTargetTenant(auth, query.clientId);
    if (!targetTenant) {
      return reply.status(403).send({ error: 'Only client_admin role can modify other tenants.' });
    }

    const patch = z
      .object({
        enabled: z.boolean().optional(),
        escalation_phone: settingsPhoneSchema.optional(),
        callback_sla_minutes: z.number().int().min(5).max(240).optional(),
        business_name: z.string().min(2).optional(),
        business_phone: settingsPhoneSchema.optional(),
        calendar_enabled: z.boolean().optional(),
        languages: z
          .array(z.enum(['fr', 'en']))
          .min(1)
          .optional(),
        business_context: z.string().max(5000).optional(),
        vertical: VerticalSchema.optional(),
        website_url: z.string().url().optional().or(z.literal('')),
        opening_hours: z.record(z.string(), z.string()).optional(),
        recording_consent_enabled: z.boolean().optional(),
        faqs: z.array(FaqSchema).optional(),
        services: z.array(ServiceSchema).optional(),
      })
      .parse(request.body ?? {});

    let raw;
    try {
      raw = await store.patchTenantSettings(targetTenant, patch);
    } catch {
      return tenantNotFound(reply);
    }
    return {
      settings: {
        ...raw,
        calendar_enabled:
          raw.calendar_enabled && (calendarConfigured || process.env.NODE_ENV === 'test'),
        id: raw.tenantId,
        workspaceId: raw.tenantId,
      },
      persistence,
    };
  });

  app.get('/v1/calendar/google/start', { preHandler: requireAuth }, async (request, reply) => {
    if (!calendarConfigured && process.env.NODE_ENV !== 'test') {
      return reply.status(503).send({ error: 'Google Calendar is not configured on this server.' });
    }
    const auth = (request as typeof request & { auth: { tenantId: string } }).auth;
    const state = `${auth.tenantId}:${Date.now()}`;
    pruneExpiredOauthStates();
    oauthStates.set(state, { tenantId: auth.tenantId, createdAt: Date.now() });

    const authUrl =
      calendarService.createAuthUrl(state) ??
      `${env.API_BASE_URL}/v1/calendar/google/callback?state=${encodeURIComponent(state)}&code=demo`;

    return reply.send({ authUrl });
  });

  app.get('/v1/calendar/google/callback', async (request, reply) => {
    if (!calendarConfigured && process.env.NODE_ENV !== 'test') {
      return reply.status(503).send({ error: 'Google Calendar is not configured on this server.' });
    }
    pruneExpiredOauthStates();
    const query = request.query as { code?: string; state?: string };
    if (!query.state || !oauthStates.has(query.state)) {
      return reply.status(400).send({ error: 'Invalid OAuth state' });
    }

    const stateRecord = oauthStates.get(query.state)!;
    if (Date.now() - stateRecord.createdAt > oauthStateTtlMs) {
      oauthStates.delete(query.state);
      return reply.status(400).send({ error: 'OAuth state expired' });
    }

    oauthStates.delete(query.state);

    const connected = await calendarService.connectWithCode(
      query.code ?? 'demo',
      stateRecord.tenantId,
    );

    await store.upsertCalendarConnection({
      tenantId: stateRecord.tenantId,
      provider: 'google',
      refreshToken: connected.refreshToken,
      accessToken: connected.accessToken,
      calendarId: connected.calendarId,
    });

    await store.patchTenantSettings(stateRecord.tenantId, { calendar_enabled: true });

    if ((request.headers.accept ?? '').toString().includes('text/html')) {
      return reply
        .type('text/html')
        .send('<html><body>Calendar connected. You can close this window.</body></html>');
    }

    return reply.send({ ok: true, tenantId: stateRecord.tenantId, calendarConnected: true });
  });

  app.post('/v1/onboarding/test-call', { preHandler: requireAuth }, async (request) => {
    const auth = (request as typeof request & { auth: { tenantId: string } }).auth;
    const body = z
      .object({
        phone: settingsPhoneSchema.default('+41790000000'),
        address: z.string().min(6).default('Rue du Rhone 21, Geneve'),
        issue: z.string().min(5).default('Test call: boiler maintenance'),
        time_window: z.enum(['morning', 'afternoon', 'evening', 'specific']).default('afternoon'),
      })
      .parse(request.body ?? {});

    const call = await store.startCall({
      tenantId: auth.tenantId,
      callSid: `TEST-${Date.now()}`,
      callerPhone: body.phone,
    });

    await store.updateCall(call.id, {
      issueText: body.issue,
      addressRaw: body.address,
      addressConfirmed: true,
      preferredTimeWindow: body.time_window,
      phoneConfirmed: body.phone,
      transcript: [
        `[problem] ${body.issue}`,
        `[address] ${body.address}`,
        `[time_window] ${body.time_window}`,
      ],
      urgency: 'normal',
    });

    const settings = await store.getTenantSettings(auth.tenantId);
    const updatedCall = (await store.getCall(call.id))!;
    const draft = await buildQualifiedJobDraft({ call: updatedCall, settings, classifier });

    const finalized = await finalizeAndNotify({
      callId: call.id,
      settings,
      outcome: 'QUALIFIED_JOB',
      urgent: false,
      jobDraft: draft,
    });

    return {
      ok: true,
      jobId: finalized.job.id,
    };
  });

  app.get('/v1/metrics', { preHandler: requireAuth }, async (request) => {
    const auth = (request as typeof request & { auth: AuthContext }).auth;
    const query = request.query as { clientId?: string };
    const targetTenant = resolveTargetTenant(auth, query.clientId) ?? auth.tenantId;
    const raw = await store.getMetrics(targetTenant);

    return {
      calls_total: raw.calls_total,
      calls_answered: raw.calls_completed,
      bookings_created:
        raw.manual_booking_jobs + (raw.calls_completed - raw.open_jobs - raw.manual_booking_jobs),
      callback_requests_captured: raw.manual_booking_jobs,
      after_hours_calls_handled: 0,
      urgent_escalations: raw.urgent_jobs,
      missed_calls_recovered: Math.max(0, raw.calls_total - raw.calls_completed),
      avg_call_duration_seconds: 0,
      hallucination_rate: 0,
      open_jobs: raw.open_jobs,
      overdue_urgent_jobs: raw.overdue_urgent_jobs,
      unconfirmed_address_jobs: raw.unconfirmed_address_jobs,
      manual_booking_jobs: raw.manual_booking_jobs,
    };
  });

  app.post('/v1/website/extract', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ url: z.string().min(1) }).parse(request.body ?? {});

    if (!env.OPENAI_API_KEY) {
      return reply
        .status(501)
        .send({ error: 'Website extraction requires OPENAI_API_KEY to be configured.' });
    }

    let pageText: string;
    try {
      pageText = await fetchWebsiteText(body.url);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not fetch the URL. Check that it is publicly accessible.';
      return reply.status(422).send({ error: message });
    }

    try {
      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Extract structured business info from the following website text. Return JSON with these optional fields:
- business_name (string)
- business_phone (string, with country code if visible)
- vertical (one of: salon, clinic, restaurant, field_service, other)
- website_url (string)
- services (array of {name, description?, price?, duration_minutes?})
- faqs (array of {question, answer})
- opening_hours (object mapping day names to hours, e.g. {"monday":"09:00-18:00"})
Only include fields you can confidently extract. Return {} if nothing is found.`,
          },
          { role: 'user', content: pageText },
        ],
      });

      const extracted = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      return { extracted };
    } catch (err) {
      request.log.error({ err }, 'OpenAI extraction failed');
      return reply.status(500).send({ error: 'AI extraction failed. Please try again.' });
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof z.ZodError) {
      request.log.warn(
        {
          issues: error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
        },
        'validation failed',
      );
      return reply.status(400).send({ error: 'Validation failed', details: error.issues });
    }
    request.log.error({ err: error }, 'request failed');
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      const typed = error as { validation: unknown };
      return reply.status(400).send({ error: 'Validation failed', details: typed.validation });
    }

    return reply.status(500).send({ error: 'Internal server error' });
  });

  return app;
}
