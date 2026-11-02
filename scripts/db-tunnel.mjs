// Opens an SSH tunnel to the live Contabo database: localhost:5433 -> the server's PostgreSQL,
// and opens it again whenever it drops (sleep, Wi-Fi change). `npm run dev` starts it too.
// Keep it running while the local API uses DATABASE_URL=postgresql://dellvit:...@127.0.0.1:5433/dellvit.
// Everything done through it changes the live data.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const key = join(homedir(), '.ssh', 'dellvit_contabo');
const free = () =>
  new Promise((resolve) => {
    const s = connect(5433, '127.0.0.1');
    s.on('connect', () => (s.destroy(), resolve(false)));
    s.on('error', () => resolve(true));
  });

async function open() {
  // Another tunnel (for example from a second terminal) already serves the port.
  if (!(await free())) {
    setTimeout(open, 10000);
    return;
  }
  const ssh = spawn(
    'ssh',
    [
      '-i', key,
      '-N',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-L', '5433:127.0.0.1:5432',
      'dellvit@169.58.62.26',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  console.log('Tunnel to the Contabo database is open on 127.0.0.1:5433.');
  ssh.on('exit', (code) => {
    console.log(`Tunnel closed (code ${code}). Opening it again in 3 seconds…`);
    setTimeout(open, 3000);
  });
}
open();
