import { randomUUID } from 'node:crypto';
import {
  buildNormalSms,
  buildUrgentSms,
  detectLanguage,
  isUrgentText,
  normalizePhone,
  type TimeWindow,
} from '@dispatchos/shared';
import { google } from 'googleapis';
import OpenAI from 'openai';
import twilio from 'twilio';
import WebSocket from 'ws';
import type { CalendarConnection, CallRecord, JobRecord, TenantSettingsRecord } from './types.js';
import { inferTimeWindowFromText } from './realtime-intake.js';

function compactText(value?: string): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function normalizeSearchText(value?: string): string {
  return compactText(value).toLowerCase();
}

function buildKnowledgeInstruction(
  settings: Pick<TenantSettingsRecord, 'business_context' | 'services' | 'faqs' | 'opening_hours'>,
): string {
  const parts: string[] = [];

  if (compactText(settings.business_context)) {
    parts.push(
      `Business context and policies you must use when answering: ${compactText(settings.business_context)}.`,
    );
  }

  if (settings.services.length > 0) {
    const services = settings.services
      .map((service) => {
        const name = compactText(service.name);
        const details = [compactText(service.description), compactText(service.price)]
          .filter(Boolean)
          .join(', ');
        return details ? `${name} (${details})` : name;
      })
      .filter(Boolean)
      .join('; ');
    if (services) {
      parts.push(`Known services: ${services}.`);
    }
  }

  if (settings.faqs.length > 0) {
    const faqs = settings.faqs
      .map((faq) => `${compactText(faq.question)} -> ${compactText(faq.answer)}`)
      .filter(Boolean)
      .join('; ');
    if (faqs) {
      parts.push(`FAQ answers: ${faqs}.`);
    }
  }

  const hours = Object.entries(settings.opening_hours)
    .map(([day, value]) => `${day}: ${compactText(value)}`)
    .filter((entry) => !entry.endsWith(':'));
  if (hours.length > 0) {
    parts.push(`Opening hours: ${hours.join('; ')}.`);
  }

  return parts.join(' ');
}

function inferServiceHint(
  issueText: string,
  settings: Pick<TenantSettingsRecord, 'services'>,
): string | undefined {
  const haystack = normalizeSearchText(issueText);
  if (!haystack) return undefined;

  let bestMatch: { name: string; score: number } | undefined;

  for (const service of settings.services) {
    const name = compactText(service.name);
    if (!name) continue;

    const tokens = `${name} ${compactText(service.description)}`
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3);

    const uniqueTokens = [...new Set(tokens)];
    const score = uniqueTokens.reduce(
      (total, token) => total + (haystack.includes(token) ? 1 : 0),
      0,
    );

    if (haystack.includes(name.toLowerCase())) {
      return name;
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { name, score };
    }
  }

  return bestMatch?.score ? bestMatch.name : undefined;
}

export class ClassificationService {
  private client?: OpenAI;
  private model: string;

  constructor(apiKey?: string, model = 'gpt-4.1-mini') {
    this.model = model;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  async detectLanguage(text: string): Promise<'fr' | 'en'> {
    return detectLanguage(text);
  }

  async isUrgent(text: string): Promise<boolean> {
    if (!this.client) return isUrgentText(text);

    try {
      const prompt = `Classify as urgent or normal for plumbing/heating dispatch. Input: ${text}`;
      const response = await this.client.responses.create({
        model: this.model,
        input: prompt,
        max_output_tokens: 16,
      });

      const output = response.output_text.toLowerCase();
      return output.includes('urgent');
    } catch {
      // Keep intake moving when the model is temporarily unavailable.
      return isUrgentText(text);
    }
  }

  async addressConfidence(address: string): Promise<number> {
    const cleaned = address.trim();
    const hasNumber = /\d/.test(cleaned);
    if (cleaned.length < 8) return 0.3;
    if (!hasNumber) return 0.55;
    return 0.92;
  }

  async summarizeIssue(issue: string): Promise<string> {
    const normalized = issue.trim();
    if (normalized.length <= 140) return normalized;
    return `${normalized.slice(0, 137)}...`;
  }

  inferTimeWindow(text: string): TimeWindow {
    return inferTimeWindowFromText(text) ?? 'specific';
  }

  extractPhone(text: string): string {
    const match = text.match(/[+]?\d[\d\s()-]{7,}/);
    return normalizePhone(match?.[0] ?? text);
  }
}

export class RealtimeConversationService {
  private client?: OpenAI;
  private realtimeModel: string;
  private fallbackModel: string;
  private apiKey?: string;

  constructor(apiKey?: string, realtimeModel = 'gpt-realtime-1.5', fallbackModel = 'gpt-4.1-mini') {
    this.apiKey = apiKey;
    this.realtimeModel = realtimeModel;
    this.fallbackModel = fallbackModel;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  createSession(args: {
    businessName: string;
    knowledgeInstruction?: string;
    escalationPhone: string;
    callbackSlaMinutes: number;
    languages: Array<'fr' | 'en'>;
    onTextDelta: (token: string) => void;
    onTextDone: () => void;
    onError: (message: string) => void;
  }): {
    isConnected: () => boolean;
    sendUserTurn: (text: string) => boolean;
    startAssistantResponse: (instructions?: string) => boolean;
    cancelResponse: () => void;
    close: () => void;
  } | null {
    if (!this.apiKey) return null;

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.realtimeModel)}`;
    const languageHint =
      args.languages.includes('fr') && args.languages.includes('en')
        ? 'French or English'
        : args.languages[0];
    const instructions = [
      `You are the phone intake assistant for ${args.businessName}.`,
      args.knowledgeInstruction || 'No extra business policy context was provided.',
      `Supported language: ${languageHint}.`,
      'Keep responses concise and natural for live phone calls.',
      'Ask one follow-up question when information is missing.',
      `For urgent non-life-safety issues, promise callback in ${args.callbackSlaMinutes} minutes or transfer to ${args.escalationPhone}.`,
      'For life-safety risk, instruct caller to contact emergency services immediately.',
      'If asked a business-specific question, answer from business context first. If context is missing, say you will pass to the team.',
      'Do not start dispatch intake unless the caller clearly asks for service help right now.',
    ].join(' ');

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    let connected = false;
    let failed = false;
    const queuedActions: Array<
      { type: 'turn'; text: string } | { type: 'response'; instructions?: string }
    > = [];
    let responseActive = false;
    let sawDeltaForActiveResponse = false;

    const triggerResponse = (instructions?: string): void => {
      responseActive = true;
      sawDeltaForActiveResponse = false;
      ws.send(
        JSON.stringify({
          type: 'response.create',
          ...(instructions ? { response: { instructions } } : {}),
        }),
      );
    };

    const sendTurn = (text: string): void => {
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        }),
      );
      triggerResponse();
    };

    ws.on('open', () => {
      connected = true;
      failed = false;
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text'],
            instructions,
            max_response_output_tokens: 180,
          },
        }),
      );
      for (const action of queuedActions.splice(0)) {
        if (action.type === 'turn') {
          sendTurn(action.text);
          continue;
        }
        triggerResponse(action.instructions);
      }
    });

    ws.on('message', (raw: unknown) => {
      try {
        const rawText =
          typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        const event = JSON.parse(rawText) as {
          type?: string;
          delta?: string;
          text?: string;
          error?: { message?: string };
        };
        if (
          (event.type === 'response.output_text.delta' || event.type === 'response.text.delta') &&
          event.delta
        ) {
          sawDeltaForActiveResponse = true;
          args.onTextDelta(event.delta);
          return;
        }
        if (
          (event.type === 'response.output_text.done' || event.type === 'response.text.done') &&
          event.text
        ) {
          if (!sawDeltaForActiveResponse) {
            args.onTextDelta(event.text);
          }
        }
        if (
          event.type === 'response.output_text.done' ||
          event.type === 'response.text.done' ||
          event.type === 'response.done'
        ) {
          if (!responseActive) return;
          responseActive = false;
          sawDeltaForActiveResponse = false;
          args.onTextDone();
          return;
        }
        if (event.type === 'error') {
          args.onError(event.error?.message ?? 'OpenAI realtime error');
        }
      } catch {
        args.onError('OpenAI realtime parsing error');
      }
    });

    ws.on('error', (error) => {
      failed = true;
      const message = error instanceof Error ? error.message : 'OpenAI realtime socket error';
      args.onError(message);
    });

    ws.on('close', () => {
      connected = false;
      failed = true;
    });

    return {
      isConnected: () => connected && ws.readyState === WebSocket.OPEN,
      sendUserTurn: (text: string) => {
        if (failed || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          return false;
        }
        if (ws.readyState !== WebSocket.OPEN) {
          queuedActions.push({ type: 'turn', text });
          return true;
        }
        sendTurn(text);
        return true;
      },
      startAssistantResponse: (instructions?: string) => {
        if (failed || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          return false;
        }
        if (ws.readyState !== WebSocket.OPEN) {
          queuedActions.push({ type: 'response', instructions });
          return true;
        }
        triggerResponse(instructions);
        return true;
      },
      cancelResponse: () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        responseActive = false;
        sawDeltaForActiveResponse = false;
        ws.send(
          JSON.stringify({
            type: 'response.cancel',
          }),
        );
      },
      close: () => {
        if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return;
        ws.close();
      },
    };
  }

  async reply(args: {
    businessName: string;
    knowledgeInstruction?: string;
    escalationPhone: string;
    callbackSlaMinutes: number;
    languages: Array<'fr' | 'en'>;
    transcript: Array<{ role: 'user' | 'assistant'; text: string }>;
    userText: string;
  }): Promise<string> {
    if (!this.client) {
      return 'Thanks, I understood your request. I can help you with issue details, address, timing, and urgent escalation if needed.';
    }

    const recentTurns = args.transcript
      .slice(-8)
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join('\n');
    const languageHint =
      args.languages.includes('fr') && args.languages.includes('en')
        ? 'French or English'
        : args.languages[0];

    const response = await this.client.responses.create({
      model: this.fallbackModel,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                `You are the phone intake assistant for ${args.businessName}.`,
                args.knowledgeInstruction || 'No extra business policy context was provided.',
                `Supported language: ${languageHint}.`,
                `Keep responses concise (max 2 short sentences).`,
                'If life-safety risk (gas leak, fire, flooding, injury), tell the caller to contact emergency services immediately.',
                `If urgent but non-life-safety, promise callback within ${args.callbackSlaMinutes} minutes or transfer to ${args.escalationPhone}.`,
                'If the caller asks only a business-information question, answer it directly and do not begin intake yet.',
                'Once the caller clearly asks for service help, ask exactly one follow-up question when key details are missing (issue, address, preferred time window, callback number).',
                'If caller asks business-specific questions, answer from business context first; if unknown, route to team.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Recent transcript:\n${recentTurns}\n\nLatest caller utterance: ${args.userText}`,
            },
          ],
        },
      ],
      max_output_tokens: 120,
    });

    return response.output_text.trim() || 'Could you please repeat that in one sentence?';
  }
}

function looksConfigured(value?: string): boolean {
  if (!value) return false;
  if (value.includes('your_')) return false;
  if (value.startsWith('AC_TEST')) return false;
  return true;
}

export class SmsService {
  private readonly client?: ReturnType<typeof twilio>;
  private readonly fromPhone?: string;
  private readonly statusCallbackUrl?: string;

  constructor(args?: {
    accountSid?: string;
    authToken?: string;
    fromPhone?: string;
    statusCallbackUrl?: string;
  }) {
    const accountSid = args?.accountSid;
    const authToken = args?.authToken;
    this.fromPhone = args?.fromPhone;
    this.statusCallbackUrl = args?.statusCallbackUrl;

    if (
      looksConfigured(accountSid) &&
      looksConfigured(authToken) &&
      looksConfigured(this.fromPhone)
    ) {
      this.client = twilio(accountSid, authToken);
    }
  }

  isLiveProviderEnabled(): boolean {
    return Boolean(this.client && this.fromPhone);
  }

  async send(args: {
    company: string;
    to: string;
    urgent: boolean;
    slaMinutes: number;
    customBody?: string;
  }): Promise<{ sid: string; body: string; provider: 'twilio' | 'simulated' }> {
    const body =
      args.customBody ??
      (args.urgent ? buildUrgentSms(args.company, args.slaMinutes) : buildNormalSms(args.company));

    if (!this.client || !this.fromPhone) {
      return { sid: `SIM-${randomUUID()}`, body, provider: 'simulated' };
    }

    const created = await this.client.messages.create({
      body,
      to: args.to,
      from: this.fromPhone,
      statusCallback: this.statusCallbackUrl,
    });

    return {
      sid: created.sid,
      body,
      provider: 'twilio',
    };
  }
}

export class CalendarService {
  private readonly oauthClient?: InstanceType<typeof google.auth.OAuth2>;

  constructor(args?: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
    if (args?.clientId && args?.clientSecret && args?.redirectUri) {
      this.oauthClient = new google.auth.OAuth2(args.clientId, args.clientSecret, args.redirectUri);
    }
  }

  isLiveProviderEnabled(): boolean {
    return Boolean(this.oauthClient);
  }

  createAuthUrl(state: string): string | null {
    if (!this.oauthClient) {
      return null;
    }

    return this.oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar'],
      state,
      response_type: 'code',
    });
  }

  private async ensureCalendar(connection: CalendarConnection): Promise<string> {
    if (!this.oauthClient) {
      return connection.calendarId || 'DispatchOS Bookings';
    }

    this.oauthClient.setCredentials({
      refresh_token: connection.refreshToken,
      access_token: connection.accessToken,
    });

    const calendarApi = google.calendar({ version: 'v3', auth: this.oauthClient });

    if (connection.calendarId && connection.calendarId !== 'DispatchOS Bookings') {
      return connection.calendarId;
    }

    const list = await calendarApi.calendarList.list();
    const existing = list.data.items?.find((item) => item.summary === 'Bookings');
    if (existing?.id) {
      return existing.id;
    }

    const created = await calendarApi.calendars.insert({
      requestBody: {
        summary: 'Bookings',
        timeZone: 'Europe/Zurich',
      },
    });

    return created.data.id ?? 'Bookings';
  }

  async connectWithCode(
    code: string,
    fallbackTenantId: string,
  ): Promise<{
    refreshToken: string;
    accessToken?: string;
    calendarId: string;
    tenantId: string;
  }> {
    if (!this.oauthClient) {
      return {
        refreshToken: code || 'demo-refresh-token',
        accessToken: 'demo-access-token',
        calendarId: 'DispatchOS Bookings',
        tenantId: fallbackTenantId,
      };
    }

    const tokenResult = await this.oauthClient.getToken(code);
    const refreshToken = tokenResult.tokens.refresh_token;
    if (!refreshToken) {
      throw new Error(
        'Google OAuth did not return a refresh token. Disconnect and reconnect with consent prompt.',
      );
    }

    this.oauthClient.setCredentials(tokenResult.tokens);
    const calendarApi = google.calendar({ version: 'v3', auth: this.oauthClient });
    const list = await calendarApi.calendarList.list();
    const existing = list.data.items?.find((item) => item.summary === 'Bookings');

    let calendarId = existing?.id;
    if (!calendarId) {
      const created = await calendarApi.calendars.insert({
        requestBody: {
          summary: 'Bookings',
          timeZone: 'Europe/Zurich',
        },
      });
      calendarId = created.data.id ?? 'Bookings';
    }

    return {
      refreshToken,
      accessToken: tokenResult.tokens.access_token ?? undefined,
      calendarId,
      tenantId: fallbackTenantId,
    };
  }

  private preferredHours(window: TimeWindow): number[] {
    if (window === 'morning') return [8, 9, 10, 11];
    if (window === 'afternoon') return [13, 14, 15, 16];
    if (window === 'evening') return [17, 18, 19];
    return [8, 9, 10, 11, 13, 14, 15, 16, 17, 18];
  }

  private buildCandidateSlots(args: {
    preferredTimeWindow: TimeWindow;
    durationMinutes: number;
    count: number;
    fromDate?: Date;
  }): Array<{ slotStart: string; slotEnd: string }> {
    const from = args.fromDate ?? new Date();
    const seed = new Date(from.getTime() + 30 * 60 * 1000);
    seed.setSeconds(0, 0);

    const slots: Array<{ slotStart: string; slotEnd: string }> = [];
    const hours = this.preferredHours(args.preferredTimeWindow);
    for (let dayOffset = 0; dayOffset < 10 && slots.length < args.count * 4; dayOffset += 1) {
      const day = new Date(seed);
      day.setDate(day.getDate() + dayOffset);
      for (const hour of hours) {
        const start = new Date(day);
        start.setHours(hour, 0, 0, 0);
        if (start.getTime() <= from.getTime()) continue;
        const end = new Date(start.getTime() + args.durationMinutes * 60 * 1000);
        slots.push({ slotStart: start.toISOString(), slotEnd: end.toISOString() });
      }
    }
    return slots;
  }

  async findNextAvailableSlots(args: {
    connection: CalendarConnection;
    preferredTimeWindow: TimeWindow;
    count?: number;
    durationMinutes?: number;
    fromDate?: Date;
  }): Promise<Array<{ slotStart: string; slotEnd: string }>> {
    const count = args.count ?? 2;
    const durationMinutes = args.durationMinutes ?? 60;
    const candidates = this.buildCandidateSlots({
      preferredTimeWindow: args.preferredTimeWindow,
      durationMinutes,
      count,
      fromDate: args.fromDate,
    });

    if (!this.oauthClient) {
      return candidates.slice(0, count);
    }

    this.oauthClient.setCredentials({
      refresh_token: args.connection.refreshToken,
      access_token: args.connection.accessToken,
    });

    const calendarApi = google.calendar({ version: 'v3', auth: this.oauthClient });
    const calendarId = await this.ensureCalendar(args.connection);
    const now = args.fromDate ?? new Date();
    const horizonEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const events = await calendarApi.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: horizonEnd,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    const busyRanges = (events.data.items ?? [])
      .map((event) => {
        const startIso = event.start?.dateTime;
        const endIso = event.end?.dateTime;
        if (!startIso || !endIso) return null;
        return { start: new Date(startIso).getTime(), end: new Date(endIso).getTime() };
      })
      .filter((value): value is { start: number; end: number } => Boolean(value));

    const available = candidates.filter((candidate) => {
      const start = new Date(candidate.slotStart).getTime();
      const end = new Date(candidate.slotEnd).getTime();
      return !busyRanges.some((range) => start < range.end && end > range.start);
    });

    return available.slice(0, count);
  }

  async isSlotAvailable(args: {
    connection: CalendarConnection;
    slotStart: string;
    slotEnd: string;
  }): Promise<boolean> {
    if (!this.oauthClient) return true;

    this.oauthClient.setCredentials({
      refresh_token: args.connection.refreshToken,
      access_token: args.connection.accessToken,
    });

    const calendarApi = google.calendar({ version: 'v3', auth: this.oauthClient });
    const calendarId = await this.ensureCalendar(args.connection);
    const events = await calendarApi.events.list({
      calendarId,
      timeMin: args.slotStart,
      timeMax: args.slotEnd,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    const start = new Date(args.slotStart).getTime();
    const end = new Date(args.slotEnd).getTime();

    return !(events.data.items ?? []).some((event) => {
      const eventStart = event.start?.dateTime;
      const eventEnd = event.end?.dateTime;
      if (!eventStart || !eventEnd) return false;
      return start < new Date(eventEnd).getTime() && end > new Date(eventStart).getTime();
    });
  }

  async createOrUpdateBooking(args: {
    job: JobRecord;
    slotStart: string;
    slotEnd?: string;
    tenantId: string;
    connection: CalendarConnection;
  }): Promise<{ externalEventId: string }> {
    if (!this.oauthClient) {
      return { externalEventId: `evt_${args.job.id}_${args.slotStart}` };
    }

    this.oauthClient.setCredentials({
      refresh_token: args.connection.refreshToken,
      access_token: args.connection.accessToken,
    });

    const calendarApi = google.calendar({ version: 'v3', auth: this.oauthClient });
    const calendarId = await this.ensureCalendar(args.connection);
    const startDate = new Date(args.slotStart);
    const endDate = args.slotEnd
      ? new Date(args.slotEnd)
      : new Date(startDate.getTime() + 60 * 60 * 1000);

    const existing = args.job.external_event_id
      ? await calendarApi.events.get({
          calendarId,
          eventId: args.job.external_event_id,
        })
      : null;

    if (existing?.data.id) {
      await calendarApi.events.patch({
        calendarId,
        eventId: existing.data.id,
        requestBody: {
          summary: `${args.job.urgency === 'urgent' ? 'EMERGENCY: ' : 'APPOINTMENT: '}${args.job.job_summary}`,
          description: `Booking ID: ${args.job.id}\nPhone: ${args.job.caller_phone}\nAddress: ${args.job.address_raw}`,
          start: { dateTime: startDate.toISOString() },
          end: { dateTime: endDate.toISOString() },
        },
      });

      return {
        externalEventId: existing.data.id,
      };
    }

    const created = await calendarApi.events.insert({
      calendarId,
      requestBody: {
        summary: `${args.job.urgency === 'urgent' ? 'EMERGENCY: ' : 'APPOINTMENT: '}${args.job.job_summary}`,
        description: `Booking ID: ${args.job.id}\nPhone: ${args.job.caller_phone}\nAddress: ${args.job.address_raw}`,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
      },
    });

    return {
      externalEventId: created.data.id ?? `evt_${args.job.id}_${args.slotStart}`,
    };
  }
}

export function responseAsXml(replyObj: twilio.twiml.VoiceResponse): string {
  return replyObj.toString();
}

export function twimlTransfer(number: string, actionPath: string): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say('Please hold while we transfer your urgent request.');
  response.dial({ action: actionPath, method: 'POST' }, number);
  return responseAsXml(response);
}

export function twimlConversationRelay(args: {
  websocketUrl: string;
  welcomeGreeting?: string;
}): string {
  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  const relayOptions: Record<string, string | boolean> = {
    url: args.websocketUrl,
    interruptible: 'any',
    preemptible: true,
    reportInputDuringAgentSpeech: true,
  };
  if (args.welcomeGreeting) {
    relayOptions.welcomeGreeting = args.welcomeGreeting;
  }
  connect.conversationRelay(relayOptions);
  return responseAsXml(response);
}

export function twimlSayAndHangup(text: string): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(text);
  response.hangup();
  return responseAsXml(response);
}

export function twimlGatherPrompt(args: { text: string; actionPath: string }): string {
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ['speech'],
    speechTimeout: 'auto',
    method: 'POST',
    action: args.actionPath,
  });
  gather.say(args.text);
  response.say('We did not hear that. Please try again.');
  response.redirect(args.actionPath);
  return responseAsXml(response);
}

export async function buildQualifiedJobDraft(args: {
  call: CallRecord;
  settings: TenantSettingsRecord;
  classifier: ClassificationService;
}): Promise<Record<string, unknown>> {
  const sourceText = [args.call.issueText, ...args.call.transcript].filter(Boolean).join(' ');
  const summary = await args.classifier.summarizeIssue(
    sourceText || 'Customer called for plumbing/heating service.',
  );
  const serviceHint = inferServiceHint(sourceText, args.settings);

  return {
    caller_phone: args.call.phoneConfirmed ?? args.call.callerPhone,
    address_raw: args.call.addressRaw ?? 'Address pending confirmation',
    address_confirmed: args.call.addressConfirmed,
    urgency: args.call.urgency,
    preferred_time_window: args.call.preferredTimeWindow ?? 'specific',
    job_summary: summary,
    service_hint: serviceHint ?? 'unknown',
    risk_flags: args.call.urgency === 'urgent' ? ['urgent_triggered'] : [],
    language_detected: args.call.languageDetected,
    transcript: args.call.transcript.join('\n').slice(0, 10000),
  };
}

export { buildKnowledgeInstruction };
