import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { InMemoryStore } from '../src/store.js';

const authHeader = {
  authorization: 'Bearer tenant:demo-tenant:role:operator:user:1',
};

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

describe('twilio contract and concurrency', () => {
  it('accepts twilio-compatible inbound payload shape', async () => {
    const app = createApp({ store: new InMemoryStore() });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/telephony/inbound/demo-tenant',
      headers: formHeaders,
      payload:
        'CallSid=CA-CONTRACT-1&From=%2B4179000100&To=%2B41225550000&AccountSid=AC123&CallStatus=ringing&Direction=inbound',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<Gather');
  });

  it('rejects forged webhook without signature when verification is active', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousTwilioToken = process.env.TWILIO_AUTH_TOKEN;
    process.env.NODE_ENV = 'development';
    process.env.TWILIO_AUTH_TOKEN = 'super-secret';

    const app = createApp({ store: new InMemoryStore() });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sms/status',
      headers: formHeaders,
      payload: 'MessageSid=SM1&MessageStatus=delivered',
    });

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousTwilioToken === undefined) {
      delete process.env.TWILIO_AUTH_TOKEN;
    } else {
      process.env.TWILIO_AUTH_TOKEN = previousTwilioToken;
    }

    expect(response.statusCode).toBe(403);
  });

  it('stays idempotent under concurrent terminal requests', async () => {
    const store = new InMemoryStore();
    const app = createApp({ store });

    const call = await store.startCall({
      tenantId: 'demo-tenant',
      callSid: 'CA-CONCURRENT',
      callerPhone: '+4179000101',
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
      payload: 'SpeechResult=Main Street 25 Geneva',
      headers: formHeaders,
    });

    await app.inject({
      method: 'POST',
      url: `/v1/telephony/gather/demo-tenant/${call.id}/address_confirm`,
      payload: 'SpeechResult=yes',
      headers: formHeaders,
    });

    await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/telephony/gather/demo-tenant/${call.id}/time_window`,
        payload: 'SpeechResult=morning',
        headers: formHeaders,
      }),
      app.inject({
        method: 'POST',
        url: `/v1/telephony/gather/demo-tenant/${call.id}/time_window`,
        payload: 'SpeechResult=morning',
        headers: formHeaders,
      }),
    ]);

    const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: authHeader });
    expect(JSON.parse(jobs.body).items).toHaveLength(1);
  });
});
