import { describe, expect, it } from 'vitest';
import twilio from 'twilio';

import { verifyTwilioRequest } from '../src/twilio.js';

describe('verifyTwilioRequest', () => {
  it('accepts requests signed for the actual Cloud Run host even when API_BASE_URL differs', () => {
    process.env.NODE_ENV = 'production';
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.API_BASE_URL = 'https://voice-api-277626955710.us-central1.run.app';

    const actualUrl = 'https://voice-api-75kbf2tmna-uc.a.run.app/v1/telephony/inbound/demo-tenant';
    const body = {
      CallSid: 'CA123',
      From: '+41220000000',
    };
    const signature = twilio.getExpectedTwilioSignature(
      process.env.TWILIO_AUTH_TOKEN,
      actualUrl,
      body,
    );

    const request = {
      headers: {
        'x-twilio-signature': signature,
        host: 'voice-api-75kbf2tmna-uc.a.run.app',
        'x-forwarded-proto': 'https',
      },
      hostname: 'voice-api-75kbf2tmna-uc.a.run.app',
      protocol: 'https',
      url: '/v1/telephony/inbound/demo-tenant',
      raw: {
        url: '/v1/telephony/inbound/demo-tenant',
      },
      body,
    } as never;

    expect(verifyTwilioRequest(request)).toBe(true);
  });
});
