// Dev launcher for web frontend
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dir, '..');
const webDir = join(rootDir, 'apps', 'web');
const viteEntry = join(webDir, 'node_modules', 'vite', 'bin', 'vite.js');

const env = {
  ...process.env,
  PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH ?? ''}`,
  VITE_API_BASE_URL: 'http://localhost:4000',
  VITE_DEV_AUTH_TOKEN: 'tenant:demo-tenant:role:operator:user:1',
};

const child = spawn('/usr/local/bin/node', [viteEntry, '--port', '5173', '--host'], {
  cwd: webDir,
  env,
  stdio: 'inherit',
});

process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', (code) => process.exit(code ?? 0));
