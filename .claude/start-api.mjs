// Dev launcher for API with in-memory store
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dir, '..');
// Use the tsx CJS entry directly with node
const tsxCjs = join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.cjs');

const env = {
  ...process.env,
  PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH ?? ''}`,
  NODE_ENV: 'development',
  STORE_MODE: 'memory',
  QUEUE_MODE: 'memory',
  ALLOW_DEV_AUTH_TOKEN: 'true',
  ALLOW_INMEMORY_STORE: 'true',
  TWILIO_ACCOUNT_SID: 'AC_TEST',
  TWILIO_AUTH_TOKEN: 'token',
  TWILIO_PHONE_NUMBER: '+41000000000',
  DATABASE_URL: 'postgresql://dispatch:dispatch@localhost:5432/dispatchos',
  REDIS_URL: 'redis://localhost:6379',
  PORT: '4000',
  APP_BASE_URL: 'http://localhost:5173',
  API_BASE_URL: 'http://localhost:4000',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:3000,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:3000',
};

const child = spawn('/usr/local/bin/node', [tsxCjs, 'src/server.ts'], {
  cwd: join(rootDir, 'apps', 'api'),
  env,
  stdio: 'inherit',
});

process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', (code) => process.exit(code ?? 0));
