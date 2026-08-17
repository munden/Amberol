#!/usr/bin/env node
// Runs the API and the Vite dev server together, and shuts both down as one.
import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'dev', '--prefix', 'server'], { stdio: 'inherit', shell: false }),
  spawn('npm', ['run', 'dev', '--prefix', 'web'], { stdio: 'inherit', shell: false }),
];

let shuttingDown = false;
const stopAll = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
};

for (const child of children) {
  child.on('exit', (code) => stopAll(code ?? 0));
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
