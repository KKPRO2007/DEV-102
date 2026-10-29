// One command to run the whole platform locally:
//   node scripts/start.mjs            -> database, API, AI agent, web, desktop
//   node scripts/start.mjs --no-desktop
//   node scripts/start.mjs --lan          -> join links and the website use this laptop's Wi-Fi address,
//                                            so a friend's laptop on the same network can take the exam
// First run creates .env (with fresh secrets), the Python venv, the schema and the demo seed.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanAddresses } from './lan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const npm = isWin ? 'npm.cmd' : 'npm';
const COLORS = { DB: 33, API: 34, AGENT: 35, WEB: 32, DESKTOP: 36, SETUP: 37 };
const children = [];

const log = (tag, line) => process.stdout.write(`\x1b[${COLORS[tag] ?? 37}m${tag.padEnd(7)}\x1b[0m ${line}\n`);

function ensureEnv() {
  const env = join(root, '.env');
  if (!existsSync(env)) {
    copyFileSync(join(root, '.env.example'), env);
    const text = readFileSync(env, 'utf8')
      .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${randomBytes(32).toString('hex')}"`)
      .replace(/^AGENT_API_KEY=.*$/m, `AGENT_API_KEY="${randomBytes(24).toString('hex')}"`);
    writeFileSync(env, text);
    log('SETUP', 'Created .env with fresh JWT_SECRET and AGENT_API_KEY');
  }
}

const envValue = (key) => readFileSync(join(root, '.env'), 'utf8').match(new RegExp(`^${key}="?([^"\n]*)`, 'm'))?.[1] ?? '';

/**
 * With --lan, the API builds join links and signed photo URLs on this laptop's Wi-Fi address and the
 * website calls the API there, so emailed links open on another laptop. Localhost keeps working too.
 */
function lanEnv(webPort) {
  if (!args.has('--lan')) return { lan: null, api: {}, web: {} };
  const lan = lanAddresses()[0]?.address;
  if (!lan) throw new Error('--lan: no Wi-Fi or Ethernet address found. Connect to a network, or run "npm start" for this laptop only.');
  const origins = [`http://${lan}:${webPort}`, ...envValue('CLIENT_URL').split(','), `http://localhost:${webPort}`].map((s) => s.trim()).filter(Boolean);
  return {
    lan,
    api: { CLIENT_URL: [...new Set(origins)].join(','), PUBLIC_API_URL: `http://${lan}:4000`, APP_DOWNLOAD_URL: `http://${lan}:${webPort}/download` },
    web: { NEXT_PUBLIC_API_URL: `http://${lan}:4000`, LAN_HOST: lan },
  };
}

// With shell: true on Windows, an unquoted path like C:\Program Files\nodejs\node.exe splits at the space.
const quote = (cmd) => (isWin && cmd.includes(' ') ? `"${cmd}"` : cmd);

function run(tag, cmd, cmdArgs, opts = {}) {
  const child = spawn(quote(cmd), cmdArgs, { cwd: opts.cwd ?? root, env: { ...process.env, FORCE_COLOR: '1', ...opts.env }, shell: isWin, windowsHide: true });
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) log(tag, l);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    log(tag, `exited with code ${code}`);
    if (opts.critical && !stopping) shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function step(tag, cmd, cmdArgs) {
  log(tag, `$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(quote(cmd), cmdArgs, { cwd: root, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed`);
}

async function stepWhenDatabaseReady(tag, cmd, cmdArgs, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (true) {
    log(tag, `$ ${cmd} ${cmdArgs.join(' ')}`);
    const r = spawnSync(quote(cmd), cmdArgs, { cwd: root, encoding: 'utf8', shell: isWin });
    if (r.status === 0) {
      process.stdout.write(r.stdout ?? '');
      process.stderr.write(r.stderr ?? '');
      return;
    }

    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    if (!/database system is starting up/i.test(output) || Date.now() >= until) {
      process.stdout.write(r.stdout ?? '');
      process.stderr.write(r.stderr ?? '');
      throw Object.assign(new Error(`${cmd} ${cmdArgs.join(' ')} failed`), { output });
    }
    log(tag, 'PostgreSQL is still starting; retrying in 1 second.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Applies pending migrations. A database first created with `prisma db push` (before migrations
// existed) already matches the initial migration, so it is recorded as applied instead of re-run.
async function migrateDatabase() {
  const schema = ['--schema', 'database/prisma/schema.prisma'];
  try {
    await stepWhenDatabaseReady('SETUP', npx, ['prisma', 'migrate', 'deploy', ...schema]);
  } catch (err) {
    if (!/P3005/.test(err.output ?? '')) throw err;
    const init = readdirSync(join(root, 'database', 'prisma', 'migrations')).filter((d) => /^\d+_/.test(d)).sort()[0];
    log('SETUP', `Existing database without migration history; marking ${init} as applied.`);
    step('SETUP', npx, ['prisma', 'migrate', 'resolve', '--applied', init, ...schema]);
    await stepWhenDatabaseReady('SETUP', npx, ['prisma', 'migrate', 'deploy', ...schema]);
  }
}

async function generatePrismaClient() {
  const sourceSchema = join(root, 'database', 'prisma', 'schema.prisma');
  const generatedSchema = join(root, 'node_modules', '.prisma', 'client', 'schema.prisma');
  if (existsSync(generatedSchema) && readFileSync(generatedSchema, 'utf8') === readFileSync(sourceSchema, 'utf8')) {
    log('SETUP', 'Prisma client is current; skipping generation.');
    return;
  }

  const cmdArgs = ['prisma', 'generate', '--schema', 'database/prisma/schema.prisma'];
  const lockedHint = 'The Prisma query engine is loaded by a running process, usually the API from another "npm start" or an editor\'s TypeScript server.';
  const until = Date.now() + 30_000;
  let warned = false;
  while (true) {
    if (!warned) log('SETUP', `$ ${npx} ${cmdArgs.join(' ')}`);
    const r = spawnSync(quote(npx), cmdArgs, { cwd: root, encoding: 'utf8', shell: isWin });
    if (r.status === 0) {
      process.stdout.write(r.stdout ?? '');
      process.stderr.write(r.stderr ?? '');
      return;
    }

    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}\n${r.error?.message ?? ''}`;
    const lockedEngineRename = isWin && /EPERM.*rename|rename.*EPERM/i.test(output);
    if (!lockedEngineRename) {
      process.stdout.write(r.stdout ?? '');
      process.stderr.write(r.stderr ?? '');
      throw new Error(`${npx} ${cmdArgs.join(' ')} failed`);
    }
    if (Date.now() >= until) throw new Error(`${lockedHint} Stop that process and run "npm start" again.`);
    if (!warned) log('SETUP', `${lockedHint} Retrying for up to 30 seconds…`);
    warned = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const waitForPort = (port, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    const until = Date.now() + timeoutMs;
    const attempt = () => {
      const s = createConnection({ port, host: '127.0.0.1' }, () => {
        s.end();
        resolve();
      });
      s.on('error', () => (Date.now() > until ? reject(new Error(`port ${port} did not open`)) : setTimeout(attempt, 500)));
    };
    attempt();
  });

async function availablePort(start = 3000) {
  for (let port = start; port < start + 20; port += 1) {
    const available = await new Promise((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`No available web port between ${start} and ${start + 19}`);
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  log('SETUP', 'Stopping all services…');
  for (const c of children.reverse()) {
    if (c.exitCode === null) {
      if (isWin) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else c.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 800);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  // Next 15 / React 19 streaming needs ArrayBuffer.prototype.detached (Node 22+); on Node 20 pages hang.
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) throw new Error(`Node.js 22 or newer is required (found ${process.versions.node}). Install Node 22 LTS or 24 LTS and make sure it comes first in PATH.`);
  ensureEnv();

  run('DB', process.execPath, ['scripts/db.mjs'], { critical: true });
  await waitForPort(Number(new URL(readFileSync(join(root, '.env'), 'utf8').match(/DATABASE_URL="?([^"\n]+)/)?.[1] ?? 'postgresql://x@localhost:5432/x').port || 5432));

  await migrateDatabase();
  await generatePrismaClient();
  const seeded = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('@prisma/client').then(async({PrismaClient})=>{const p=new PrismaClient();const n=await p.user.count();await p.$disconnect();process.exit(n>0?0:3)})"], { cwd: root, shell: false });
  if (seeded.status === 3 || args.has('--reseed')) step('SETUP', npx, ['tsx', 'database/prisma/seed.ts']);
  else {
    // The demo exam's window is relative to the seed; reopen it once it has aged out instead of reseeding everything.
    const r = spawnSync(quote(npx), ['tsx', 'database/prisma/seed.ts', '--refresh-demo'], { cwd: root, stdio: 'inherit', shell: isWin });
    if (r.status !== 0) log('SETUP', 'Could not refresh the demo exam window; continuing.');
  }

  const venvPython = join(root, 'backend-services', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  if (!args.has('--no-agent')) {
    if (!existsSync(venvPython)) step('SETUP', process.execPath, ['scripts/python.cjs', 'install']);
    run('AGENT', process.execPath, ['scripts/python.cjs', 'run']);
  }
  const webPort = await availablePort();
  const net = lanEnv(webPort);
  run('API', npm, ['run', 'dev', '-w', 'apps/api'], { critical: true, env: net.api });
  await waitForPort(4000);
  run('WEB', npm, ['run', 'dev', '-w', 'apps/web', '--', '--port', String(webPort)], { env: net.web });
  if (!args.has('--no-desktop')) run('DESKTOP', npm, ['run', 'dev', '-w', 'apps/desktop']);

  setTimeout(() => {
    console.log(`
\x1b[1mWhere U Elevate · Smart Proctor is running\x1b[0m
  Web (admin, mentor, candidate)  http://localhost:${webPort}
  API                             http://localhost:4000/api/v1
  AI agent                        http://127.0.0.1:8000/health
  Desktop app                     opens as a window
${net.lan ? `
  [1mSame Wi-Fi (--lan)[0m: emailed join links use http://${net.lan}:${webPort}
  Your friend pastes the link in the Smart Proctor app; it connects to ${net.lan}:4000 by itself.
  If it cannot connect, allow Node.js through Windows Defender Firewall for private networks.
` : ''}  Dev toolbar                     Ctrl+Shift+D in the web or desktop app

  Admin      admin@wue.in / Admin@123
  Mentor     mentor@wue.in / Mentor@123
  Candidate  exam CPA-26 · user WUE26DEMO · password Demo@2026 (desktop app)

  Ctrl+C stops everything.
`);
  }, 4000);
}

main().catch((err) => {
  log('SETUP', `\x1b[31m${err.message}\x1b[0m`);
  shutdown(1);
});
