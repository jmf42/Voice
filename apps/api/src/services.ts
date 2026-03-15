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
import { inferTimeWindowFromText, shouldCaptureIssueText } from './realtime-intake.js';

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

function tokenizeSearchText(value: string): string[] {
  const stopwords = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'you',
    'your',
    'are',
    'can',
    'what',
    'how',
    'que',
    'quoi',
    'vous',
    'avec',
    'pour',
    'les',
    'des',
    'une',
    'est',
    'sur',
    'dans',
  ]);
  return normalizeSearchText(value)
    .split(/[^a-z0-9àâçéèêëîïôûùüÿñæœ]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

function joinNaturalLanguage(items: string[], language: 'en' | 'fr'): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) {
    return language === 'fr' ? `${items[0]} et ${items[1]}` : `${items[0]} and ${items[1]}`;
  }
  const head = items.slice(0, -1).join(', ');
  const tail = items[items.length - 1];
  return language === 'fr' ? `${head} et ${tail}` : `${head}, and ${tail}`;
}

function firstBusinessSentence(value?: string): string | undefined {
  const compact = compactText(value);
  if (!compact) return undefined;
  const sentence = compact.split(/(?<=[.!?])\s+/)[0]?.trim();
  return sentence || compact;
}

function pickFaqAnswer(
  text: string,
  settings: Pick<TenantSettingsRecord, 'faqs'>,
): string | undefined {
  const userTokens = new Set(tokenizeSearchText(text));
  if (userTokens.size === 0) return undefined;

  let bestMatch: { answer: string; score: number } | undefined;
  for (const faq of settings.faqs) {
    const answer = compactText(faq.answer);
    if (!answer) continue;

    const faqTokens = tokenizeSearchText(faq.question);
    if (faqTokens.length === 0) continue;

    const score = faqTokens.reduce((total, token) => total + (userTokens.has(token) ? 1 : 0), 0);
    if (score < 2) continue;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { answer, score };
    }
  }

  return bestMatch?.score ? bestMatch.answer : undefined;
}

export function answerBusinessQuestionFromSettings(args: {
  text: string;
  language: 'en' | 'fr';
  settings: Pick<
    TenantSettingsRecord,
    'business_name' | 'business_context' | 'services' | 'faqs' | 'opening_hours'
  >;
}): string | undefined {
  const normalized = normalizeSearchText(args.text);
  const faqAnswer = pickFaqAnswer(args.text, args.settings);
  if (faqAnswer) return faqAnswer;

  if (/company(?:'s)? name|nom (?:de )?l'?entreprise|nom de la societe|nom de la société/.test(normalized)) {
    return args.language === 'fr'
      ? `Vous êtes bien chez ${args.settings.business_name}.`
      : `You’ve reached ${args.settings.business_name}.`;
  }

  if (
    /\bwhat services\b|\bwhat do you provide\b|\bservices? do you offer\b|quels services|que proposez[- ]vous|que faites[- ]vous/.test(
      normalized,
    )
  ) {
    const serviceNames = args.settings.services
      .map((service) => compactText(service.name))
      .filter(Boolean)
      .slice(0, 4);
    if (serviceNames.length > 0) {
      return args.language === 'fr'
        ? `Nous proposons ${joinNaturalLanguage(serviceNames, 'fr')}.`
        : `We provide ${joinNaturalLanguage(serviceNames, 'en')}.`;
    }
  }

  if (
    /\bopening hours\b|\bwhen are you open\b|\bhours\b|horaires|quand etes-vous ouverts|quand êtes-vous ouverts/.test(
      normalized,
    )
  ) {
    const hours = Object.entries(args.settings.opening_hours)
      .map(([day, value]) => `${day}: ${compactText(value)}`)
      .filter((entry) => !entry.endsWith(':'));
    if (hours.length > 0) {
      return args.language === 'fr'
        ? `Nos horaires sont ${hours.join('; ')}.`
        : `Our opening hours are ${hours.join('; ')}.`;
    }
  }

  if (/\bprice\b|\bcost\b|\bhow much\b|prix|combien|tarif/.test(normalized)) {
    const pricedServices = args.settings.services
      .map((service) => {
        const name = compactText(service.name);
        const price = compactText(service.price);
        return name && price ? `${name}: ${price}` : '';
      })
      .filter(Boolean)
      .slice(0, 3);
    if (pricedServices.length > 0) {
      return args.language === 'fr'
        ? `Voici les tarifs enregistrés: ${joinNaturalLanguage(pricedServices, 'fr')}.`
        : `Here are the saved prices: ${joinNaturalLanguage(pricedServices, 'en')}.`;
    }
    return args.language === 'fr'
      ? 'Je peux transmettre votre demande, et l’équipe confirmera le tarif exact.'
      : 'I can note your request, and the team will confirm the exact price.';
  }

  if (
    /\bwhere are you located\b|\bservice area\b|\bwhere do you work\b|ou etes-vous situes|où êtes-vous situés|zone d'intervention|zone d’intervention/.test(
      normalized,
    )
  ) {
    const businessSentence = firstBusinessSentence(args.settings.business_context);
    if (businessSentence) {
      return businessSentence;
    }
  }

  return undefined;
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

function extractJobSummarySource(call: CallRecord): string {
  const prioritized: string[] = [];
  const callerTranscriptIssues = call.transcript
    .filter((line) => !/^\[realtime:assistant\]/i.test(line))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => shouldCaptureIssueText(line));

  if (compactText(call.issueText)) {
    prioritized.push(compactText(call.issueText));
  }

  prioritized.push(...callerTranscriptIssues);
  const merged = prioritized.filter(Boolean).join(' ').trim();
  if (merged) return merged;

  return call.transcript
    .filter((line) => !/^\[realtime:assistant\]/i.test(line))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

const REALTIME_SESSION_MAX_OUTPUT_TOKENS = 120;
const REALTIME_TRUNCATION_RETENTION_RATIO = 0.8;

export interface RealtimeToolDefinition {
  description: string;
  parameters: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

interface RealtimeFunctionCall {
  name: string;
  callId: string;
  arguments: Record<string, unknown>;
}

function buildRealtimeSessionInstructions(args: {
  businessName: string;
  knowledgeInstruction?: string;
  escalationPhone: string;
  callbackSlaMinutes: number;
  languages: Array<'fr' | 'en'>;
}): string {
  const languageHint =
    args.languages.includes('fr') && args.languages.includes('en')
      ? 'English or French'
      : args.languages[0] === 'fr'
        ? 'French'
        : 'English';
  const languageRule =
    args.languages.includes('fr') && args.languages.includes('en')
      ? [
          '- Reply only in English or French.',
          '- Use French only when the caller is clearly speaking French.',
          '- Otherwise use English.',
          '- Never switch to Spanish or any other language.',
        ].join('\n')
      : args.languages.includes('fr')
        ? [
            '- Reply only in French.',
            '- Never switch to English, Spanish, or any other language unless an operator changes the business settings.',
          ].join('\n')
        : [
            '- Reply only in English.',
            '- Never switch to French, Spanish, or any other language unless an operator changes the business settings.',
          ].join('\n');

  return [
    '# Role',
    `You are the live phone intake assistant for ${args.businessName}.`,
    '',
    '# Business context',
    args.knowledgeInstruction || 'No extra business policy context was provided.',
    '',
    '# Supported language',
    `- Supported caller language(s): ${languageHint}.`,
    languageRule,
    '',
    '# Conversation goals',
    '- Keep the call moving with short, natural responses for live phone conversations.',
    '- If the caller only wants business information, answer directly from the saved business context and do not force service intake.',
    '- Once the caller clearly asks for service help, collect only the next missing detail.',
    '',
    '# Conversation flow',
    '- Ask at most one follow-up question at a time.',
    '- Use at most one short sentence plus one short follow-up question.',
    '- Do not greet again because Twilio already greeted the caller.',
    '- Do not repeat details the caller already confirmed unless you are correcting a conflict.',
    '- Do not claim a booking is confirmed unless the system says the requested time is available.',
    '',
    '# Safety and urgency',
    '- Do not treat missing details as an emergency by themselves.',
    `- For urgent but non-life-safety issues, promise callback within ${args.callbackSlaMinutes} minutes or transfer to ${args.escalationPhone}.`,
    '- For life-safety risk, tell the caller to contact emergency services immediately.',
    '',
    '# Repair and clarification',
    '- If the transcript sounds incomplete, noisy, or unclear, ask the caller to repeat the last detail more clearly.',
    '- If business context is missing, say you will pass the question to the team instead of inventing an answer.',
    '',
    '# Style',
    '- Sound calm, concise, and human.',
    '- Avoid long explanations.',
    '- Vary short acknowledgements so the call does not sound robotic.',
    '',
    '# Example acknowledgement phrases',
    '- English: "Got it.", "Thanks.", "Understood."',
    '- French: "D\'accord.", "Merci.", "Très bien."',
  ].join('\n');
}

function buildRealtimeResponseCreateEvent(
  instructions?: string,
  toolChoice: 'auto' | 'none' = 'none',
): {
  type: 'response.create';
  response: {
    output_modalities: ['text'];
    max_output_tokens: number;
    instructions?: string;
    tool_choice?: 'auto';
  };
} {
  return {
    type: 'response.create',
    response: {
      output_modalities: ['text'],
      max_output_tokens: REALTIME_SESSION_MAX_OUTPUT_TOKENS,
      ...(toolChoice === 'auto' ? { tool_choice: 'auto' as const } : {}),
      ...(instructions ? { instructions } : {}),
    },
  };
}

function buildRealtimeToolDefinitions(
  tools: Record<string, RealtimeToolDefinition> | undefined,
): Array<{
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return Object.entries(tools ?? {}).map(([name, tool]) => ({
    type: 'function',
    name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function parseRealtimeFunctionArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function extractRealtimeFunctionCalls(event: {
  response?: { output?: Array<Record<string, unknown>> };
}): RealtimeFunctionCall[] {
  const output = Array.isArray(event.response?.output) ? event.response.output : [];

  return output
    .map((item) => {
      if (item.type !== 'function_call') return null;

      const name = typeof item.name === 'string' ? item.name : '';
      const callId = typeof item.call_id === 'string' ? item.call_id : '';
      if (!name || !callId) return null;

      return {
        name,
        callId,
        arguments: parseRealtimeFunctionArguments(item.arguments),
      };
    })
    .filter((item): item is RealtimeFunctionCall => Boolean(item));
}

function serializeRealtimeToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ ok: false, error: 'Unable to serialize tool output' });
  }
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
      const prompt = [
        'Classify this local-service caller request as urgent or normal.',
        'Urgent means immediate safety risk, active damage, lockout/access emergency, or something requiring very fast callback.',
        'Do not mark it urgent only because details are missing.',
        `Input: ${text}`,
      ].join(' ');
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
    tools?: Record<string, RealtimeToolDefinition>;
    onTextDelta: (token: string) => void;
    onTextDone: () => void;
    onError: (message: string) => void;
  }): {
    isConnected: () => boolean;
    sendUserTurn: (text: string, instructions?: string) => boolean;
    startAssistantResponse: (instructions?: string) => boolean;
    cancelResponse: () => void;
    close: () => void;
  } | null {
    if (!this.apiKey) return null;

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.realtimeModel)}`;
    const instructions = buildRealtimeSessionInstructions(args);

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    let connected = false;
    let failed = false;
    const toolChoice = Object.keys(args.tools ?? {}).length > 0 ? 'auto' : 'none';
    const queuedActions: Array<
      { type: 'turn'; text: string; instructions?: string } | { type: 'response'; instructions?: string }
    > = [];
    let responseActive = false;
    let sawDeltaForActiveResponse = false;

    const triggerResponse = (instructions?: string): void => {
      responseActive = true;
      sawDeltaForActiveResponse = false;
      ws.send(JSON.stringify(buildRealtimeResponseCreateEvent(instructions, toolChoice)));
    };

    const sendTurn = (text: string, instructions?: string): void => {
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
      triggerResponse(instructions);
    };

    ws.on('open', () => {
      connected = true;
      failed = false;
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            model: this.realtimeModel,
            instructions,
            output_modalities: ['text'],
            max_output_tokens: REALTIME_SESSION_MAX_OUTPUT_TOKENS,
            ...(toolChoice === 'auto'
              ? {
                  tools: buildRealtimeToolDefinitions(args.tools),
                }
              : {}),
            truncation: {
              type: 'retention_ratio',
              retention_ratio: REALTIME_TRUNCATION_RETENTION_RATIO,
            },
          },
        }),
      );
      for (const action of queuedActions.splice(0)) {
        if (action.type === 'turn') {
          sendTurn(action.text, action.instructions);
          continue;
        }
        triggerResponse(action.instructions);
      }
    });

    const handleFunctionCalls = async (calls: RealtimeFunctionCall[]): Promise<void> => {
      for (const call of calls) {
        const tool = args.tools?.[call.name];
        const output = tool
          ? await tool
              .handler(call.arguments)
              .catch((error: unknown) => ({
                ok: false,
                error: error instanceof Error ? error.message : 'Realtime tool failed',
              }))
          : {
              ok: false,
              error: `Unknown realtime tool: ${call.name}`,
            };

        if (ws.readyState !== WebSocket.OPEN) return;

        ws.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: call.callId,
              output: serializeRealtimeToolOutput(output),
            },
          }),
        );
      }

      if (ws.readyState !== WebSocket.OPEN) return;
      triggerResponse();
    };

    ws.on('message', (raw: unknown) => {
      try {
        const rawText =
          typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        const event = JSON.parse(rawText) as {
          type?: string;
          delta?: string;
          text?: string;
          error?: { message?: string };
          response?: { output?: Array<Record<string, unknown>> };
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
        if (event.type === 'response.done') {
          if (!responseActive) return;
          const functionCalls = extractRealtimeFunctionCalls(event);
          responseActive = false;
          sawDeltaForActiveResponse = false;
          if (functionCalls.length > 0) {
            void handleFunctionCalls(functionCalls).catch((error: unknown) => {
              args.onError(error instanceof Error ? error.message : 'Realtime tool handling failed');
            });
            return;
          }
          args.onTextDone();
          return;
        }
        if (event.type === 'response.output_text.done' || event.type === 'response.text.done') {
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
      sendUserTurn: (text: string, instructions?: string) => {
        if (failed || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          return false;
        }
        if (ws.readyState !== WebSocket.OPEN) {
          queuedActions.push({ type: 'turn', text, instructions });
          return true;
        }
        sendTurn(text, instructions);
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
    responseInstruction?: string;
    currentLanguage?: 'en' | 'fr';
    directAnswer?: string;
  }): Promise<string> {
    if (!this.client) {
      const currentLanguage = args.currentLanguage ?? (args.languages.includes('fr') ? 'fr' : 'en');
      const nextQuestion = args.responseInstruction?.match(/->\s*(.+)$/)?.[1]?.trim();
      if (args.directAnswer?.trim() && nextQuestion) {
        return `${args.directAnswer.trim()} ${nextQuestion}`;
      }
      if (args.directAnswer?.trim()) {
        return args.directAnswer.trim();
      }
      if (nextQuestion) return nextQuestion;
      if (args.responseInstruction?.includes('close unless the caller asks')) {
        return currentLanguage === 'fr'
          ? "Merci, j'ai bien noté votre demande. L'équipe vous confirmera la suite rapidement."
          : 'Thanks, I have your request. The team will confirm the next step shortly.';
      }
      return currentLanguage === 'fr'
        ? 'Pouvez-vous le redire en une phrase courte ?'
        : 'Could you repeat that in one short sentence?';
    }

    const currentLanguage =
      args.currentLanguage ??
      (args.languages.includes('fr') && !args.languages.includes('en') ? 'fr' : 'en');
    const baseInstructions = buildRealtimeSessionInstructions({
      businessName: args.businessName,
      knowledgeInstruction: args.knowledgeInstruction,
      escalationPhone: args.escalationPhone,
      callbackSlaMinutes: args.callbackSlaMinutes,
      languages: args.languages,
    });

    const response = await this.client.responses.create({
      model: this.fallbackModel,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                baseInstructions,
                '',
                '# Current turn state',
                `Current caller language for this turn: ${currentLanguage === 'fr' ? 'French' : 'English'}.`,
                'Keep this reply to at most two short sentences.',
                'Ask for only the single next missing detail.',
                args.responseInstruction
                  ? `Current turn guidance: ${args.responseInstruction}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        },
        ...args.transcript.slice(-6).map((turn) => ({
          role: turn.role,
          content: [{ type: 'input_text' as const, text: turn.text }],
        })),
        {
          role: 'user',
          content: [{ type: 'input_text', text: args.userText }],
        },
      ],
      max_output_tokens: 90,
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
  private readonly allowDemoMode: boolean;

  constructor(args?: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
    this.allowDemoMode = process.env.NODE_ENV === 'test' || process.env.ALLOW_DEMO_CALENDAR === 'true';
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
      if (!this.allowDemoMode) {
        throw new Error('Google Calendar is not configured on this server.');
      }
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
      if (!this.allowDemoMode) return [];
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
    if (!this.oauthClient) return this.allowDemoMode;

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
      if (!this.allowDemoMode) {
        throw new Error('Google Calendar is not configured on this server.');
      }
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
  defaultLanguage: 'en' | 'fr';
  supportedLanguages: Array<'en' | 'fr'>;
  hints?: string[];
}): string {
  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  const multilingual = [...new Set(args.supportedLanguages)].length > 1;
  const relayOptions: Record<string, string | boolean> = {
    url: args.websocketUrl,
    language: args.defaultLanguage === 'fr' ? 'fr-FR' : 'en-US',
    ttsProvider: 'Google',
    voice: args.defaultLanguage === 'fr' ? 'fr-FR-Neural2-B' : 'en-US-Journey-O',
    transcriptionProvider: 'Deepgram',
    speechModel: 'nova-3-general',
    transcriptionLanguage: multilingual
      ? 'multi'
      : args.defaultLanguage === 'fr'
        ? 'fr'
        : 'en',
    interruptible: 'speech',
    interruptSensitivity: 'low',
    preemptible: false,
    reportInputDuringAgentSpeech: 'none',
    welcomeGreetingInterruptible: 'none',
  };
  if (args.hints?.length) {
    relayOptions.hints = args.hints.slice(0, 25).join(',');
  }
  if (args.welcomeGreeting) {
    relayOptions.welcomeGreeting = args.welcomeGreeting;
  }
  const relay = connect.conversationRelay(relayOptions);
  for (const language of [...new Set(args.supportedLanguages)]) {
    relay.language({
      code: language === 'fr' ? 'fr-FR' : 'en-US',
      ttsProvider: 'Google',
      voice: language === 'fr' ? 'fr-FR-Neural2-B' : 'en-US-Journey-O',
    });
  }
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
  const sourceText = extractJobSummarySource(args.call);
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
