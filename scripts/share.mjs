// Lets a candidate's desktop app on another laptop reach this machine's exam server (npm start must be running).
//   node scripts/share.mjs            -> prints this laptop's address for the same Wi-Fi
//   node scripts/share.mjs --tunnel   -> also opens a free Cloudflare quick tunnel for use over the internet
// The other laptop types the printed address into "Exam server" on the desktop sign-in screen.
import { spawn, spawnSync } from 'node:child_process';
import { lanAddresses } from './lan.mjs';

const API_PORT = 4000;
const isWin = process.platform === 'win32';

async function apiUp() {
  try {
    const r = await fetch(`http://localhost:${API_PORT}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

if (!(await apiUp())) {
  console.error(`The exam server is not running on port ${API_PORT}. Start it first with: npm start`);
  process.exit(1);
}

const lan = lanAddresses();
console.log('\n\x1b[1mSame Wi-Fi\x1b[0m: on the other laptop, open the Smart Proctor app, press "Change" next to Exam server and type:');
if (lan.length === 0) console.log('  (no Wi-Fi or Ethernet address found; is this laptop connected to a network?)');
for (const a of lan) console.log(`  \x1b[36m${a.address}\x1b[0m   (${a.name})`);
if (isWin) console.log('  If it cannot connect, allow Node.js through Windows Defender Firewall for private networks.');

if (!process.argv.includes('--tunnel')) {
  console.log('\nOver the internet: run  npm run share:tunnel\n');
  process.exit(0);
}

const found = spawnSync(isWin ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
if (found.status !== 0) {
  console.error('\ncloudflared is not installed. Install it once, then run this again:');
  console.error(isWin ? '  winget install --id Cloudflare.cloudflared' : '  see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
  process.exit(1);
}

console.log('\n\x1b[1mOver the internet\x1b[0m: opening a Cloudflare quick tunnel (no account needed)…');
const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${API_PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let announced = false;
const watch = (chunk) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
  if (url && !announced) {
    announced = true;
    console.log(`  On the other laptop type this as Exam server:  \x1b[36m${url}\x1b[0m`);
    console.log('  The link works while this window stays open; a new one is made each time. Ctrl+C closes it.\n');
  }
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);
tunnel.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => tunnel.kill());
