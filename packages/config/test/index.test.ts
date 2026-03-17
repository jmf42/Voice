import { describe, expect, it } from 'vitest';
import { buildRedisConnectionOptions, parseEnv } from '../src/index.js';

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

  it('preserves redis credentials, db, and tls settings', () => {
    const options = buildRedisConnectionOptions('rediss://user:secret@example.redis:6380/2');

    expect(options).toMatchObject({
      host: 'example.redis',
      port: 6380,
      username: 'user',
      password: 'secret',
      db: 2,
    });
    expect(options.tls).toEqual({});
  });
});
