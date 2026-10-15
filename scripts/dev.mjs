// Starts the Node API (port 5301) and the Vite dev server (port 5300)
// together, and stops both when either exits or on Ctrl+C. Set API_PORT and
// WEB_PORT to use other ports; Vite reads both, and the API reads PORT.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npm, ['run', 'dev', '-w', '@drop-win/api'], {
    stdio: 'inherit',
    env: process.env.API_PORT ? { ...process.env, PORT: process.env.API_PORT } : process.env,
  }),
  spawn(npm, ['run', 'dev', '-w', '@drop-win/web'], { stdio: 'inherit' }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) child.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
