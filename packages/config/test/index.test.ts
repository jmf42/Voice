import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/index.js';

describe('env parsing', () => {
  it('parses valid env', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://x',
      REDIS_URL: 'redis://x',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_PHONE_NUMBER: '+4179000000',
      APP_BASE_URL: 'http://localhost:3000',
      API_BASE_URL: 'http://localhost:4000',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(4000);
  });

  it('fails when required values are missing', () => {
    expect(() => parseEnv({})).toThrow();
  });
});
