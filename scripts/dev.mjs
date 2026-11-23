// Ανάπτυξη: server (με επανεκκίνηση σε αλλαγές) + Vite με hot reload.
import { spawn } from 'node:child_process';

const port = process.env.KNIGHTBASE_PORT ?? '4747';
const env = { ...process.env, KNIGHTBASE_PORT: port };
const procs = [
  spawn(process.execPath, ['--watch', 'src/server/main.ts'], { stdio: 'inherit', env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
