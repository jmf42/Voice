export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

export function buildRedisConnectionOptions(redisUrl: string): RedisConnectionOptions {
  const parsed = new URL(redisUrl);
  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const dbPath = parsed.pathname.replace(/^\//, '');
  const db = dbPath ? Number(dbPath) : undefined;

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(Number.isInteger(db) ? { db } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
