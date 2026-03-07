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

      let items: Array<{ id: string; status: string; urgency: string; address_raw: string }> = [];
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
      expect(items[0]?.status).toBe('urgent');
      expect(items[0]?.urgency).toBe('urgent');
      expect(items[0]?.address_raw).toContain('Address pending confirmation');
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
});
