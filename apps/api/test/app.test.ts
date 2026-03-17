import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { allowDevAuthToken } from '../src/auth.js';
import { InMemoryQueueClient } from '../src/queue.js';
import { InMemoryStore } from '../src/store.js';

const authHeader = {
  authorization: 'Bearer tenant:demo-tenant:role:operator:user:1',
};

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

class FakeRealtimeConversationService {
  public toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  createSession(args: {
    tools?: Record<
      string,
      {
        handler: (input: Record<string, unknown>) => Promise<unknown>;
      }
    >;
    onTextDelta: (token: string) => void;
    onTextDone: () => void;
  }) {
    const sendReply = (text: string) => {
      args.onTextDelta(text);
      args.onTextDone();
    };

    const callTool = async (name: string, input: Record<string, unknown>) => {
      this.toolCalls.push({ name, input });
      return args.tools?.[name]?.handler(input);
    };

    return {
      isConnected: () => true,
      sendUserTurn: (text: string) => {
        void (async () => {
          const normalized = text.toLowerCase();

          if (normalized.includes("company's name")) {
            const answer = (await callTool('lookup_business_answer', {
              question: text,
              language: 'en',
            })) as { answer?: string } | undefined;
            sendReply(answer?.answer ?? 'You have reached DispatchOS Demo Heating.');
            return;
          }

          if (normalized.includes('what services')) {
            const answer = (await callTool('lookup_business_answer', {
              question: text,
              language: 'en',
            })) as { answer?: string } | undefined;
            sendReply(answer?.answer ?? 'We provide heating help.');
            return;
          }

          if (normalized.includes('march 8 2026')) {
            const slot = (await callTool('check_requested_slot', {})) as
              | { status?: string }
              | undefined;
            if (slot?.status === 'available') {
              sendReply("Perfect. We'll text the confirmation shortly.");
              return;
            }
            if (slot?.status === 'unavailable') {
              sendReply("That exact time isn't available. What other time works for you?");
              return;
            }
            sendReply("Thanks. We'll have the team confirm the time by text.");
            return;
          }

          const state = (await callTool('get_intake_state', { language: 'en' })) as
            | { nextQuestion?: string | null }
            | undefined;
          sendReply(state?.nextQuestion ?? "Thanks, we'll text the confirmation shortly.");
        })();
        return true;
      },
      startAssistantResponse: () => true,
      cancelResponse: () => {},
      close: () => {},
    };
  }
}

class FakeCalendarService {
  public isSlotAvailableMock = vi.fn(
    async (args: { slotStart: string; slotEnd: string }) => {
      void args;
      return true;
    },
  );
  public createOrUpdateBookingMock = vi.fn(
    async (args: {
      slotStart: string;
      slotEnd?: string;
      job: { id: string };
      tenantId: string;
    }) => {
      void args;
      return { externalEventId: 'evt_demo' };
    },
  );
  public findNextAvailableSlotsMock = vi.fn(
    async (args: { preferredTimeWindow: string }) => {
      void args;
      return [
        {
          slotStart: '2026-03-08T20:00:00.000Z',
          slotEnd: '2026-03-08T21:00:00.000Z',
        },
      ];
    },
  );

  isLiveProviderEnabled(): boolean {
    return true;
  }

  async isSlotAvailable(args: { slotStart: string; slotEnd: string }) {
    return this.isSlotAvailableMock(args);
  }

  async createOrUpdateBooking(args: {
    slotStart: string;
    slotEnd?: string;
    job: { id: string };
    tenantId: string;
  }) {
    return this.createOrUpdateBookingMock(args);
  }

  async findNextAvailableSlots(args: { preferredTimeWindow: string }) {
    return this.findNextAvailableSlotsMock(args);
  }
}

describe('api', () => {
  it('root route returns service metadata', async () => {
    const app = createApp({ store: new InMemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      service: 'dispatchos-api',
      ok: true,
      health: '/health',
    });
  });

  it('health check works', async () => {
    const app = createApp({ store: new InMemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      service: 'dispatchos-api',
      persistence: { mode: 'memory', durable: false },
      queue: { mode: 'memory', durable: false },
    });
  });

  it('health check reports critical production-readiness issues without failing liveness', async () => {
    const app = createApp({ store: new InMemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      readiness: { productionSafe: boolean; issues: Array<{ code: string }> };
    };
    expect(body.readiness.productionSafe).toBe(false);
    expect(body.readiness.issues.map((issue) => issue.code)).toContain('inmemory-store');
    expect(body.readiness.issues.map((issue) => issue.code)).toContain('inmemory-queue');
  });

  it('health check flags production realtime misconfiguration that would break inbound calls', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVoiceFlowMode = process.env.VOICE_FLOW_MODE;
    const previousApiBaseUrl = process.env.API_BASE_URL;
    const previousStoreMode = process.env.STORE_MODE;
    const previousQueueMode = process.env.QUEUE_MODE;
    const previousAllowInmemory = process.env.ALLOW_INMEMORY_STORE;
    const previousAllowDevAuth = process.env.ALLOW_DEV_AUTH_TOKEN;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousTwilioSid = process.env.TWILIO_ACCOUNT_SID;
    const previousTwilioToken = process.env.TWILIO_AUTH_TOKEN;
    const previousKService = process.env.K_SERVICE;

    process.env.NODE_ENV = 'production';
    process.env.VOICE_FLOW_MODE = 'realtime';
    process.env.API_BASE_URL = 'http://localhost:4000';
    process.env.STORE_MODE = 'prisma';
    process.env.QUEUE_MODE = 'redis';
    process.env.ALLOW_INMEMORY_STORE = 'false';
    process.env.ALLOW_DEV_AUTH_TOKEN = 'false';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.TWILIO_ACCOUNT_SID = 'AC_LIVE_DEMO';
    process.env.TWILIO_AUTH_TOKEN = 'live-token';
    process.env.K_SERVICE = 'voice-api';

    const app = createApp({
      store: {} as never,
      queue: {} as never,
    });

    const res = await app.inject({ method: 'GET', url: '/health' });

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousVoiceFlowMode === undefined) delete process.env.VOICE_FLOW_MODE;
    else process.env.VOICE_FLOW_MODE = previousVoiceFlowMode;
    if (previousApiBaseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previousApiBaseUrl;
    if (previousStoreMode === undefined) delete process.env.STORE_MODE;
    else process.env.STORE_MODE = previousStoreMode;
    if (previousQueueMode === undefined) delete process.env.QUEUE_MODE;
    else process.env.QUEUE_MODE = previousQueueMode;
    if (previousAllowInmemory === undefined) delete process.env.ALLOW_INMEMORY_STORE;
    else process.env.ALLOW_INMEMORY_STORE = previousAllowInmemory;
    if (previousAllowDevAuth === undefined) delete process.env.ALLOW_DEV_AUTH_TOKEN;
    else process.env.ALLOW_DEV_AUTH_TOKEN = previousAllowDevAuth;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousTwilioSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = previousTwilioSid;
    if (previousTwilioToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = previousTwilioToken;
    if (previousKService === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = previousKService;

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      readiness: { productionSafe: boolean; issues: Array<{ code: string }> };
    };
    expect(body.readiness.productionSafe).toBe(false);
    expect(body.readiness.issues.map((issue) => issue.code)).toContain('api-base-url-localhost');
    expect(body.readiness.issues.map((issue) => issue.code)).toContain(
      'realtime-api-base-url-not-https',
    );
  });

  it('rejects unknown tenants on inbound webhook', async () => {
    const app = createApp({ store: new InMemoryStore() });
    const inbound = await app.inject({
      method: 'POST',
      url: '/v1/telephony/inbound/unknown-tenant',
      payload: 'CallSid=CA1&From=%2B4179000001',
      headers: formHeaders,
    });
    expect(inbound.statusCode).toBe(404);
  });

  it('routes directly to business phone when intake is disabled', async () => {
    const store = new InMemoryStore();
    await store.patchTenantSettings('demo-tenant', {
      enabled: false,
      business_phone: '+41225550999',
    });
    const app = createApp({ store });

    const inbound = await app.inject({
      method: 'POST',
      url: '/v1/telephony/inbound/demo-tenant',
      payload: 'CallSid=CA-OFF-1&From=%2B4179000020',
      headers: formHeaders,
    });

    expect(inbound.statusCode).toBe(200);
    expect(inbound.body).toContain('<Dial ');
    expect(inbound.body).toContain('+41225550999');
  });

  it('returns realtime ConversationRelay TwiML when realtime mode is enabled', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';
    process.env.API_BASE_URL = 'https://api.example.com';

    const app = createApp({ store: new InMemoryStore() });
    const inbound = await app.inject({
      method: 'POST',
      url: '/v1/telephony/inbound/demo-tenant',
      payload: 'CallSid=CA-REALTIME-1&From=%2B4179000020',
      headers: formHeaders,
    });

    if (prevMode === undefined) {
      delete process.env.VOICE_FLOW_MODE;
    } else {
      process.env.VOICE_FLOW_MODE = prevMode;
    }
    if (prevBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = prevBaseUrl;
    }

    expect(inbound.statusCode).toBe(200);
    expect(inbound.body).toContain('<ConversationRelay');
    expect(inbound.body).toContain('wss://api.example.com/v1/voice/realtime/demo-tenant');
    expect(inbound.body).toContain('welcomeGreeting=');
    expect(inbound.body).toContain('ttsProvider="Google"');
    expect(inbound.body).toContain('voice="en-US-Journey-O"');
    expect(inbound.body).toContain('interruptSensitivity="low"');
    expect(inbound.body).toContain('reportInputDuringAgentSpeech="none"');
    expect(inbound.body).toContain('sig=');
    expect(inbound.body).toContain('ts=');
  });

  it('does not auto-bootstrap the demo tenant unless explicitly enabled', () => {
    const previousBootstrap = process.env.BOOTSTRAP_DEMO_TENANT;
    delete process.env.BOOTSTRAP_DEMO_TENANT;

    const store = new InMemoryStore();
    const createTenantSpy = vi.spyOn(store, 'createTenant');

    const app = createApp({ store });

    if (previousBootstrap === undefined) {
      delete process.env.BOOTSTRAP_DEMO_TENANT;
    } else {
      process.env.BOOTSTRAP_DEMO_TENANT = previousBootstrap;
    }

    expect(app).toBeTruthy();
    expect(createTenantSpy).not.toHaveBeenCalled();
  });

  it('handles realtime websocket conversation and creates a job', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';
    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4100;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const app = createApp({ store: new InMemoryStore() });
    await app.listen({ host: '127.0.0.1', port: freePort });
    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-WS-1&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<{ token: string; lang?: string; last: boolean }> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for realtime websocket responses'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt:
                'Need boiler maintenance at Rue du Rhone 21 Geneva tomorrow morning. Call me at +41790000123.',
            }),
          );
          setTimeout(() => ws.close(), 250);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            lang?: string;
            last?: boolean;
          };
          if (payload.type === 'text') {
            realtimeReplies.push({
              token: payload.token ?? '',
              lang: payload.lang,
              last: Boolean(payload.last),
            });
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      let items: Array<{ id: string; status: string; address_raw: string }> = [];
      for (let i = 0; i < 12; i += 1) {
        const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
        expect(jobs.statusCode).toBe(200);
        items = JSON.parse(jobs.body).items as Array<{
          id: string;
          status: string;
          address_raw: string;
        }>;
        if (items.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.address_raw).toContain('Rue du Rhone 21 Geneva');
      expect(items[0]?.address_raw).not.toContain('+41790000123');
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  });

  it('asks the caller to repeat when the realtime transcript is too unclear to trust', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';
    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4101;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const app = createApp({ store: new InMemoryStore() });
    await app.listen({ host: '127.0.0.1', port: freePort });
    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-NOISE&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<{ token: string; last: boolean }> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for realtime websocket clarification'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: '[noise]' }));
          setTimeout(() => ws.close(), 250);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            last?: boolean;
          };
          if (payload.type === 'text') {
            realtimeReplies.push({
              token: payload.token ?? '',
              last: Boolean(payload.last),
            });
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      expect(
        realtimeReplies.some((reply) => reply.token.includes('Please repeat the last detail.')),
      ).toBe(true);
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  });

  it('asks for a fuller address when the captured address is incomplete', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';
    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4106;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const app = createApp({ store: new InMemoryStore() });
    await app.listen({ host: '127.0.0.1', port: freePort });
    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-ADDRESS-CLARIFY&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<{ token: string; last: boolean }> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for address clarification reply'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'I need boiler help at Rue du Rhone Geneva.' }));
          setTimeout(() => ws.close(), 250);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            last?: boolean;
          };
          if (payload.type === 'text') {
            realtimeReplies.push({
              token: payload.token ?? '',
              last: Boolean(payload.last),
            });
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      expect(
        realtimeReplies.some(
          (reply) =>
            reply.token.includes('Please repeat the street and number') ||
            reply.token.includes('What is the full service address?') ||
            reply.token.includes('répéter la rue et le numéro'),
        ),
      ).toBe(true);
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  });

  it('escalates realtime calls when intake closes before core details are captured', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';
    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4102;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const app = createApp({ store: new InMemoryStore() });
    await app.listen({ host: '127.0.0.1', port: freePort });
    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-INCOMPLETE&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<{ token: string; lang?: string; last: boolean }> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for realtime websocket close'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'Hello, I need help.' }));
          setTimeout(() => ws.close(), 250);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            lang?: string;
            last?: boolean;
          };
          if (payload.type === 'text') {
            realtimeReplies.push({
              token: payload.token ?? '',
              lang: payload.lang,
              last: Boolean(payload.last),
            });
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      let items: Array<{
        id: string;
        status: string;
        urgency: string;
        address_raw: string;
        booking_status?: string;
      }> = [];
      for (let i = 0; i < 12; i += 1) {
        const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
        expect(jobs.statusCode).toBe(200);
        items = JSON.parse(jobs.body).items as Array<{
          id: string;
          status: string;
          urgency: string;
          address_raw: string;
        }>;
        if (items.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.status).toBe('new');
      expect(items[0]?.urgency).toBe('normal');
      expect(items[0]?.address_raw).toContain('Address pending confirmation');
      expect(items[0]?.booking_status).toBe('not_requested');
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  });

  it('answers English business questions from saved settings without forcing intake', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';
    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4103;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const store = new InMemoryStore();
    await store.patchTenantSettings('demo-tenant', {
      business_name: 'Locksmith Geneva',
      business_context: 'Emergency locksmith in Geneva with rapid door opening support.',
      services: [
        { name: 'Emergency Door Opening', description: 'Fast entry help for locked-out customers.' },
        { name: 'Lock Replacement', description: 'Replace damaged or unsafe locks.' },
      ],
      faqs: [{ question: 'Can you open my door without damage?', answer: 'Yes, in most cases.' }],
      languages: ['fr', 'en'],
    });

    const app = createApp({ store });
    await app.listen({ host: '127.0.0.1', port: freePort });
    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-BIZ-INFO-EN&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<{ token: string; lang?: string; last: boolean }> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for realtime websocket responses'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'What services do you provide?',
            }),
          );
          setTimeout(() => ws.close(), 250);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            lang?: string;
            last?: boolean;
          };
          if (payload.type === 'text') {
            realtimeReplies.push({
              token: payload.token ?? '',
              lang: payload.lang,
              last: Boolean(payload.last),
            });
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      const replyText = realtimeReplies.map((reply) => reply.token).join(' ');
      expect(replyText).toContain('Emergency Door Opening');
      expect(replyText).toContain('Lock Replacement');
      expect(replyText.toLowerCase()).not.toContain('address');
      expect(realtimeReplies.some((reply) => reply.lang === 'en-US')).toBe(true);
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  }, 12_000);

  it('answers French business questions in French from saved settings', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';
    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4104;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const store = new InMemoryStore();
    await store.patchTenantSettings('demo-tenant', {
      business_name: 'Locksmith Geneva',
      services: [
        { name: 'Ouverture de porte', description: 'Aide rapide pour porte claquée.' },
        { name: 'Remplacement de serrure', description: 'Remplacement de serrure abîmée.' },
      ],
      languages: ['fr', 'en'],
    });

    const app = createApp({ store });
    await app.listen({ host: '127.0.0.1', port: freePort });
    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-BIZ-INFO-FR&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<{ token: string; lang?: string; last: boolean }> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for realtime websocket responses'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'Quels services proposez-vous ?',
              lang: 'fr-FR',
            }),
          );
          setTimeout(() => ws.close(), 250);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            lang?: string;
            last?: boolean;
          };
          if (payload.type === 'text') {
            realtimeReplies.push({
              token: payload.token ?? '',
              lang: payload.lang,
              last: Boolean(payload.last),
            });
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      const replyText = realtimeReplies.map((reply) => reply.token).join(' ');
      expect(replyText).toContain('Ouverture de porte');
      expect(replyText).toContain('Remplacement de serrure');
      expect(realtimeReplies.some((reply) => reply.lang === 'fr-FR')).toBe(true);
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  }, 12_000);

  it('rejects realtime websocket when signature is invalid', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';
    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4101;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const app = createApp({ store: new InMemoryStore() });
    await app.listen({ host: '127.0.0.1', port: freePort });
    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-WS-2&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&').replace(/sig=[^&"]+/, 'sig=invalid');

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting websocket close on invalid signature'));
        }, 2500);

        ws.on('open', () => {
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'Need maintenance at Main Street 10 Geneva',
            }),
          );
        });

        ws.on('error', () => {
          clearTimeout(timeout);
          resolve();
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
      expect(jobs.statusCode).toBe(200);
      const items = JSON.parse(jobs.body).items as Array<{ id: string }>;
      expect(items.length).toBe(0);
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  });

  it('handles normal call and creates qualified job', async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });

    const call = await store.startCall({
      tenantId: 'demo-tenant',
      callSid: 'CA3',
      callerPhone: '+4179000003',
    });

    await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/problem`,
      payload: 'SpeechResult=Need yearly maintenance and inspection',
      headers: formHeaders,
    });

    await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/address`,
      payload: 'SpeechResult=Rue du Rhone 21 Geneva',
      headers: formHeaders,
    });

    await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/address_confirm`,
      payload: 'SpeechResult=yes',
      headers: formHeaders,
    });

    const finalize = await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/time_window`,
      payload: 'SpeechResult=morning',
      headers: formHeaders,
    });

    expect(finalize.statusCode).toBe(200);
    expect(finalize.body).toContain('SMS');

    const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
    expect(jobs.statusCode).toBe(200);
    expect(JSON.parse(jobs.body).items.length).toBeGreaterThan(0);
  });

  it('routes urgent call to escalation path and finalizes fallback', async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });

    const call = await store.startCall({
      tenantId: 'demo-tenant',
      callSid: 'CA-URGENT',
      callerPhone: '+4179000005',
    });

    const urgentResponse = await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/problem`,
      payload: 'SpeechResult=urgent gas smell now',
      headers: formHeaders,
    });

    expect(urgentResponse.statusCode).toBe(200);
    expect(urgentResponse.body).toContain('<Dial');

    const fallback = await app.inject({
      method: 'POST',
      url: `/v1/telephony/transfer/status?tenantId=demo-tenant&callId=${call.id}`,
      payload: 'DialCallStatus=failed',
      headers: formHeaders,
    });

    expect(fallback.statusCode).toBe(200);

    const jobs = await app.inject({
      method: 'GET',
      url: '/v1/jobs?status=urgent',
      headers: authHeader,
    });
    expect(JSON.parse(jobs.body).items.length).toBeGreaterThan(0);
  });

  it('applies terminal fallback when twilio status arrives before flow completion', async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });

    await app.inject({
      method: 'POST',
      url: '/v1/telephony/inbound/demo-tenant',
      payload: 'CallSid=CA-STATUS-FALLBACK&From=%2B4179000010',
      headers: formHeaders,
    });

    const status = await app.inject({
      method: 'POST',
      url: '/v1/telephony/status',
      payload: 'CallSid=CA-STATUS-FALLBACK&CallStatus=completed',
      headers: formHeaders,
    });

    expect(status.statusCode).toBe(200);

    const jobs = await app.inject({
      method: 'GET',
      url: '/v1/jobs?status=urgent',
      headers: authHeader,
    });
    expect(JSON.parse(jobs.body).items.length).toBeGreaterThan(0);
  });

  it('queues sms retry when provider send fails', async () => {
    const store = new InMemoryStore();
    const queue = new InMemoryQueueClient();
    const sms = {
      send: async () => {
        throw new Error('twilio down');
      },
    };

    const app = createApp({ store, queue, sms: sms as never });
    const call = await store.startCall({
      tenantId: 'demo-tenant',
      callSid: 'CA-SMS-FAIL',
      callerPhone: '+4179000011',
    });

    await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/problem`,
      payload: 'SpeechResult=Need maintenance',
      headers: formHeaders,
    });

    await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/address`,
      payload: 'SpeechResult=Main Street 10 Geneva',
      headers: formHeaders,
    });

    await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/address_confirm`,
      payload: 'SpeechResult=yes',
      headers: formHeaders,
    });

    await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/time_window`,
      payload: 'SpeechResult=afternoon',
      headers: formHeaders,
    });

    expect(queue.jobs.find((job) => job.name === 'sms-retry')).toBeTruthy();
  });

  it('supports settings and calendar connect + booking fallback', async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });

    const settings = await app.inject({ method: 'GET', url: '/v1/settings', headers: authHeader });
    expect(settings.statusCode).toBe(200);

    const start = await app.inject({
      method: 'GET',
      url: '/v1/calendar/google/start',
      headers: authHeader,
    });
    expect(start.statusCode).toBe(200);
    const authUrl = JSON.parse(start.body).authUrl as string;
    const state = new URL(authUrl).searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: 'GET',
      url: `/v1/calendar/google/callback?state=${state}&code=demo`,
    });

    expect(callback.statusCode).toBe(200);

    const jobBootstrap = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/test-call',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });

    const createdJobId = JSON.parse(jobBootstrap.body).jobId as string;

    const confirm = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${createdJobId}/confirm-time`,
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: JSON.stringify({ slotStart: '2026-02-20T09:00:00Z' }),
    });

    expect(confirm.statusCode).toBe(200);
    expect(['booked', 'manual_required']).toContain(JSON.parse(confirm.body).job.booking_status);
  });

  it('auto-books a slot after qualified call when calendar is connected', async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });

    const start = await app.inject({
      method: 'GET',
      url: '/v1/calendar/google/start',
      headers: authHeader,
    });
    expect(start.statusCode).toBe(200);
    const authUrl = JSON.parse(start.body).authUrl as string;
    const state = new URL(authUrl).searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: 'GET',
      url: `/v1/calendar/google/callback?state=${state}&code=demo`,
    });
    expect(callback.statusCode).toBe(200);

    const seeded = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/test-call',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(seeded.statusCode).toBe(200);

    const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
    expect(jobs.statusCode).toBe(200);
    const items = JSON.parse(jobs.body).items as Array<{
      status: string;
      booking_status?: string;
      confirmed_slot_start?: string;
      external_event_id?: string;
    }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.status).toBe('confirmed');
    expect(items[0]?.booking_status).toBe('booked');
    expect(items[0]?.confirmed_slot_start).toBeTruthy();
    expect(items[0]?.external_event_id).toBeTruthy();
  });

  it('keeps informational questions out of the issue summary and books the requested realtime slot', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';

    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4104;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const store = new InMemoryStore();
    const app = createApp({ store });
    await app.listen({ host: '127.0.0.1', port: freePort });

    try {
      const start = await app.inject({
        method: 'GET',
        url: '/v1/calendar/google/start',
        headers: authHeader,
      });
      const authUrl = JSON.parse(start.body).authUrl as string;
      const state = new URL(authUrl).searchParams.get('state');
      expect(state).toBeTruthy();

      const callback = await app.inject({
        method: 'GET',
        url: `/v1/calendar/google/callback?state=${state}&code=demo`,
      });
      expect(callback.statusCode).toBe(200);

      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-SLOT-1&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<{ token: string; lang?: string; last: boolean }> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for realtime websocket responses'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: "Can you tell me the company's name?",
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'What services do you provide?',
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'I need my apartment door opened without damaging the lock.',
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'Theodore Weber 36 Geneva, Switzerland.',
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'March 8 2026 at 9 PM works for me.',
            }),
          );
          setTimeout(() => ws.close(), 300);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            lang?: string;
            last?: boolean;
          };
          if (payload.type === 'text') {
            realtimeReplies.push({
              token: payload.token ?? '',
              lang: payload.lang,
              last: Boolean(payload.last),
            });
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      let items: Array<{
        job_summary: string;
        booking_status?: string;
        confirmed_slot_start?: string;
      }> = [];

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
        expect(jobs.statusCode).toBe(200);
        items = JSON.parse(jobs.body).items;
        if (items.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.job_summary.toLowerCase()).not.toContain("company's name");
      expect(items[0]?.booking_status).toBe('booked');
      expect(items[0]?.confirmed_slot_start).toBe('2026-03-08T20:00:00.000Z');
      expect(realtimeReplies.some((reply) => reply.lang === 'en-US')).toBe(true);
      const replyText = realtimeReplies.map((reply) => reply.token).join(' ');
      expect(replyText).toContain('Theodore Weber 36 Geneva');
      expect(replyText).toContain("We'll text the confirmation shortly.");
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  }, 12_000);

  it('books the requested slot through the OpenAI-led realtime tool flow and writes the job', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';

    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4107;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const store = new InMemoryStore();
    await store.patchTenantSettings('demo-tenant', { calendar_enabled: true });
    await store.upsertCalendarConnection({
      tenantId: 'demo-tenant',
      provider: 'google',
      refreshToken: 'demo-refresh',
      accessToken: 'demo-access',
      calendarId: 'primary',
    });
    const realtimeConversation = new FakeRealtimeConversationService();
    const calendar = new FakeCalendarService();
    const app = createApp({ store, calendar: calendar as never, realtimeConversation });
    await app.listen({ host: '127.0.0.1', port: freePort });

    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-OPENAI-BOOKED&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<string> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for OpenAI-led realtime responses'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: "Can you tell me the company's name?" }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'I need my apartment door opened without damaging the lock.' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'Theodore Weber 36 Geneva, Switzerland.' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'March 8 2026 at 9 PM works for me.' }));
          setTimeout(() => ws.close(), 300);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as { type?: string; token?: string };
          if (payload.type === 'text' && payload.token) {
            realtimeReplies.push(payload.token);
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      let items: Array<{
        job_summary: string;
        booking_status?: string;
        confirmed_slot_start?: string;
        external_event_id?: string;
      }> = [];

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
        expect(jobs.statusCode).toBe(200);
        items = JSON.parse(jobs.body).items;
        if (items.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.job_summary.toLowerCase()).not.toContain("company's name");
      expect(items[0]?.booking_status).toBe('booked');
      expect(items[0]?.confirmed_slot_start).toBe('2026-03-08T20:00:00.000Z');
      expect(items[0]?.external_event_id).toBe('evt_demo');
      expect(realtimeReplies.join(' ')).toContain("We'll text the confirmation shortly.");
      expect(realtimeConversation.toolCalls.map((call) => call.name)).toContain('check_requested_slot');
      expect(calendar.isSlotAvailableMock).toHaveBeenCalled();
      expect(calendar.createOrUpdateBookingMock).toHaveBeenCalled();
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  }, 12_000);

  it('marks the job manual when the OpenAI-led flow checks a requested slot that is unavailable', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';

    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4108;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const store = new InMemoryStore();
    await store.patchTenantSettings('demo-tenant', { calendar_enabled: true });
    await store.upsertCalendarConnection({
      tenantId: 'demo-tenant',
      provider: 'google',
      refreshToken: 'demo-refresh',
      accessToken: 'demo-access',
      calendarId: 'primary',
    });
    const realtimeConversation = new FakeRealtimeConversationService();
    const calendar = new FakeCalendarService();
    calendar.isSlotAvailableMock.mockResolvedValue(false);
    const app = createApp({ store, calendar: calendar as never, realtimeConversation });
    await app.listen({ host: '127.0.0.1', port: freePort });

    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-OPENAI-UNAVAILABLE&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');
      const realtimeReplies: Array<string> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for unavailable-slot realtime responses'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'I need my apartment door opened without damaging the lock.' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'Theodore Weber 36 Geneva, Switzerland.' }));
          ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'March 8 2026 at 9 PM works for me.' }));
          setTimeout(() => ws.close(), 300);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('message', (raw) => {
          const payload = JSON.parse(raw.toString()) as { type?: string; token?: string };
          if (payload.type === 'text' && payload.token) {
            realtimeReplies.push(payload.token);
          }
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      let items: Array<{
        booking_status?: string;
        confirmed_slot_start?: string;
      }> = [];

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
        expect(jobs.statusCode).toBe(200);
        items = JSON.parse(jobs.body).items;
        if (items.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.booking_status).toBe('manual_required');
      expect(items[0]?.confirmed_slot_start).toBeUndefined();
      expect(realtimeReplies.join(' ')).toContain("isn't available");
      expect(calendar.isSlotAvailableMock).toHaveBeenCalled();
      expect(calendar.createOrUpdateBookingMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  }, 12_000);

  it('marks the job manual when a caller requests a specific slot but no live calendar connection is available', async () => {
    const prevMode = process.env.VOICE_FLOW_MODE;
    const prevBaseUrl = process.env.API_BASE_URL;
    process.env.VOICE_FLOW_MODE = 'realtime';

    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4109;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
    process.env.API_BASE_URL = `http://127.0.0.1:${freePort}`;

    const store = new InMemoryStore();
    await store.patchTenantSettings('demo-tenant', { calendar_enabled: true });
    const realtimeConversation = new FakeRealtimeConversationService();
    const calendar = new FakeCalendarService();
    const app = createApp({ store, calendar: calendar as never, realtimeConversation });
    await app.listen({ host: '127.0.0.1', port: freePort });

    try {
      const inbound = await app.inject({
        method: 'POST',
        url: '/v1/telephony/inbound/demo-tenant',
        payload: 'CallSid=CA-REALTIME-OPENAI-NO-CALENDAR&From=%2B4179000020',
        headers: formHeaders,
      });
      expect(inbound.statusCode).toBe(200);

      const match = inbound.body.match(/url="([^"]+)"/);
      expect(match?.[1]).toBeTruthy();
      const url = (match?.[1] ?? '').replaceAll('&amp;', '&');

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timed out waiting for no-calendar realtime responses'));
        }, 4000);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'setup' }));
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'I need my apartment door opened without damaging the lock.',
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'Theodore Weber 36 Geneva, Switzerland.',
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'prompt',
              voicePrompt: 'March 8 2026 at 9 PM works for me.',
            }),
          );
          setTimeout(() => ws.close(), 300);
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      let items: Array<{
        booking_status?: string;
        confirmed_slot_start?: string;
      }> = [];

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
        expect(jobs.statusCode).toBe(200);
        items = JSON.parse(jobs.body).items;
        if (items.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.booking_status).toBe('manual_required');
      expect(items[0]?.confirmed_slot_start).toBeUndefined();
      expect(calendar.isSlotAvailableMock).not.toHaveBeenCalled();
      expect(calendar.createOrUpdateBookingMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
      if (prevMode === undefined) {
        delete process.env.VOICE_FLOW_MODE;
      } else {
        process.env.VOICE_FLOW_MODE = prevMode;
      }
      if (prevBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = prevBaseUrl;
      }
    }
  }, 12_000);

  it('streams live job updates for the dashboard', async () => {
    const freePort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? Number(address.port) : 4200;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });

    const app = createApp({ store: new InMemoryStore() });
    await app.listen({ host: '127.0.0.1', port: freePort });
    try {
      const streamResponse = await fetch(`http://127.0.0.1:${freePort}/v1/jobs/stream`, {
        headers: { Authorization: authHeader.authorization, Accept: 'text/event-stream' },
      });
      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');
      expect(streamResponse.body).toBeTruthy();

      const reader = streamResponse.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const readItemsWithTimeout = async (timeoutMs: number): Promise<Array<{ id: string }>> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundaryIndex = buffer.indexOf('\n\n');
          while (boundaryIndex >= 0) {
            const block = buffer.slice(0, boundaryIndex);
            buffer = buffer.slice(boundaryIndex + 2);
            const line = block.split('\n').find((entry) => entry.startsWith('data:'));
            if (line) {
              const payload = JSON.parse(line.slice(5).trim()) as { items?: Array<{ id: string }> };
              if (payload.items) {
                return payload.items;
              }
            }
            boundaryIndex = buffer.indexOf('\n\n');
          }
        }
        return [];
      };

      const initialItems = await readItemsWithTimeout(2000);
      expect(Array.isArray(initialItems)).toBe(true);

      const seeded = await app.inject({
        method: 'POST',
        url: '/v1/onboarding/test-call',
        headers: { ...authHeader, 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(seeded.statusCode).toBe(200);

      const nextItems = await readItemsWithTimeout(3000);
      expect(nextItems.length).toBeGreaterThan(0);
      await reader.cancel();
    } finally {
      await app.close();
    }
  });

  it('expires stale oauth state during calendar callback', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-17T10:00:00.000Z'));

      const store = new InMemoryStore();
      const app = createApp({ store });

      const start = await app.inject({
        method: 'GET',
        url: '/v1/calendar/google/start',
        headers: authHeader,
      });
      expect(start.statusCode).toBe(200);

      const authUrl = JSON.parse(start.body).authUrl as string;
      const state = new URL(authUrl).searchParams.get('state');
      expect(state).toBeTruthy();

      vi.setSystemTime(new Date('2026-02-17T10:11:00.000Z'));

      const callback = await app.inject({
        method: 'GET',
        url: `/v1/calendar/google/callback?state=${state}&code=demo`,
      });

      expect(callback.statusCode).toBe(400);
      const parsed = JSON.parse(callback.body) as { error: string };
      expect(parsed.error === 'OAuth state expired' || parsed.error === 'Invalid OAuth state').toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces auth for dashboard routes', async () => {
    const app = createApp({ store: new InMemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/v1/jobs' });
    expect(res.statusCode).toBe(401);
  });

  it('returns operational metrics including SLA and quality indicators', async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });

    await app.inject({
      method: 'POST',
      url: '/v1/onboarding/test-call',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });

    const res = await app.inject({ method: 'GET', url: '/v1/metrics', headers: authHeader });
    expect(res.statusCode).toBe(200);

    const metrics = JSON.parse(res.body) as Record<string, number>;
    expect(typeof metrics.open_jobs).toBe('number');
    expect(typeof metrics.overdue_urgent_jobs).toBe('number');
    expect(typeof metrics.unconfirmed_address_jobs).toBe('number');
    expect(typeof metrics.manual_booking_jobs).toBe('number');
  });

  it('stores and returns business context in tenant settings', async () => {
    const app = createApp({ store: new InMemoryStore() });
    const context =
      'Service area: Geneva center only. Emergency surcharge after 20:00 is CHF 90. Weekend appointments by callback confirmation.';

    const patch = await app.inject({
      method: 'PATCH',
      url: '/v1/settings',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: JSON.stringify({ business_context: context }),
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).settings.business_context).toBe(context);

    const get = await app.inject({ method: 'GET', url: '/v1/settings', headers: authHeader });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.body).settings.business_context).toBe(context);
  });

  it('stores FAQs and services in tenant settings and uses services for job tagging', async () => {
    const app = createApp({ store: new InMemoryStore() });

    const patch = await app.inject({
      method: 'PATCH',
      url: '/v1/settings',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: JSON.stringify({
        business_context: 'We serve central Geneva only.',
        faqs: [{ question: 'Do you work weekends?', answer: 'Yes, for urgent repairs only.' }],
        services: [
          {
            name: 'Boiler Maintenance',
            description: 'Preventive maintenance and annual servicing',
            duration_minutes: 60,
          },
          { name: 'Radiator Repair', description: 'Leak and pressure fixes', duration_minutes: 45 },
        ],
      }),
    });

    expect(patch.statusCode).toBe(200);
    const patchedSettings = JSON.parse(patch.body).settings as {
      faqs: Array<{ question: string; answer: string }>;
      services: Array<{ name: string }>;
    };
    expect(patchedSettings.faqs).toEqual([
      { question: 'Do you work weekends?', answer: 'Yes, for urgent repairs only.' },
    ]);
    expect(patchedSettings.services.map((service) => service.name)).toEqual([
      'Boiler Maintenance',
      'Radiator Repair',
    ]);

    const seeded = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/test-call',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: JSON.stringify({ issue: 'Customer needs boiler maintenance next week.' }),
    });
    expect(seeded.statusCode).toBe(200);

    const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
    expect(jobs.statusCode).toBe(200);
    const items = JSON.parse(jobs.body).items as Array<{ service_hint?: string }>;
    expect(items[0]?.service_hint).toBe('Boiler Maintenance');
  });

  it('rejects weak phone settings payload', async () => {
    const app = createApp({ store: new InMemoryStore() });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/settings',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: JSON.stringify({ escalation_phone: 'abc' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('disables dev bearer token auth when ALLOW_DEV_AUTH_TOKEN is false', async () => {
    const previous = process.env.ALLOW_DEV_AUTH_TOKEN;
    process.env.ALLOW_DEV_AUTH_TOKEN = 'false';

    const app = createApp({ store: new InMemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });

    if (previous === undefined) {
      delete process.env.ALLOW_DEV_AUTH_TOKEN;
    } else {
      process.env.ALLOW_DEV_AUTH_TOKEN = previous;
    }

    expect(res.statusCode).toBe(401);
  });

  it('allows dev bearer token in production only when explicitly enabled', () => {
    const previousAllow = process.env.ALLOW_DEV_AUTH_TOKEN;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.ALLOW_DEV_AUTH_TOKEN = 'true';
    process.env.NODE_ENV = 'production';

    const allowedWhenTrue = allowDevAuthToken();
    process.env.ALLOW_DEV_AUTH_TOKEN = 'false';
    const deniedWhenFalse = allowDevAuthToken();
    delete process.env.ALLOW_DEV_AUTH_TOKEN;
    const deniedByDefaultInProd = allowDevAuthToken();

    if (previousAllow === undefined) {
      delete process.env.ALLOW_DEV_AUTH_TOKEN;
    } else {
      process.env.ALLOW_DEV_AUTH_TOKEN = previousAllow;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    expect(allowedWhenTrue).toBe(true);
    expect(deniedWhenFalse).toBe(false);
    expect(deniedByDefaultInProd).toBe(false);
  });

  it('blocks production startup when in-memory store is configured', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllow = process.env.ALLOW_INMEMORY_STORE;
    const prevStoreMode = process.env.STORE_MODE;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_INMEMORY_STORE = 'false';
    process.env.STORE_MODE = 'memory';

    expect(() => createApp({ store: new InMemoryStore() })).toThrow();

    if (prevNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = prevNodeEnv;
    }
    if (prevAllow === undefined) {
      delete process.env.ALLOW_INMEMORY_STORE;
    } else {
      process.env.ALLOW_INMEMORY_STORE = prevAllow;
    }
    if (prevStoreMode === undefined) {
      delete process.env.STORE_MODE;
    } else {
      process.env.STORE_MODE = prevStoreMode;
    }
  });

  it('retries a queued calendar booking through the internal recovery endpoint', async () => {
    const previousSecret = process.env.QUEUE_SHARED_SECRET;
    process.env.QUEUE_SHARED_SECRET = 'queue-secret';

    const store = new InMemoryStore();
    await store.patchTenantSettings('demo-tenant', { calendar_enabled: true });
    await store.upsertCalendarConnection({
      tenantId: 'demo-tenant',
      provider: 'google',
      refreshToken: 'refresh-token',
      accessToken: 'access-token',
      calendarId: 'primary',
    });

    const call = await store.startCall({
      tenantId: 'demo-tenant',
      callSid: 'CA_RETRY_CALENDAR',
      callerPhone: '+41225550123',
    });
    const finalized = await store.finalizeCall({
      callId: call.id,
      outcome: 'QUALIFIED_JOB',
      jobDraft: {
        caller_phone: '+41225550123',
        address_raw: 'Rue du Rhone 21 Geneva',
        address_confirmed: true,
        urgency: 'normal',
        preferred_time_window: 'morning',
        job_summary: 'Boiler service request',
        service_hint: 'Boiler service',
        risk_flags: [],
        language_detected: 'en',
      },
    });

    const calendar = new FakeCalendarService();
    const app = createApp({ store, calendar: calendar as never });

    const res = await app.inject({
      method: 'POST',
      url: '/internal/queue/calendar-write',
      headers: {
        'content-type': 'application/json',
        'x-queue-secret': 'queue-secret',
      },
      payload: JSON.stringify({
        tenantId: 'demo-tenant',
        jobId: finalized.job.id,
        slotStart: '2026-03-08T20:00:00.000Z',
        slotEnd: '2026-03-08T21:00:00.000Z',
      }),
    });

    if (previousSecret === undefined) delete process.env.QUEUE_SHARED_SECRET;
    else process.env.QUEUE_SHARED_SECRET = previousSecret;

    expect(res.statusCode).toBe(200);
    const updated = await store.getJob('demo-tenant', finalized.job.id);
    expect(updated?.booking_status).toBe('booked');
    expect(updated?.external_event_id).toBe('evt_demo');
    expect(calendar.createOrUpdateBookingMock).toHaveBeenCalled();
  });
});
