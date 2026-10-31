// Builds the Chrome extension against the production API and zips it for uploading to the store.
// Bump "version" in apps/extension/manifest.json first.
//
//   API_URL=https://<api> npm run package:extension
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(root, 'apps', 'extension');
const { version } = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));

if (!/^https:\/\//.test(process.env.API_URL ?? '')) {
  console.error('Set API_URL to the production API (https://...), which the extension is built against.');
  process.exit(1);
}
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, STORE_BUILD: '1' }, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npm', ['run', 'build', '-w', 'apps/extension']);
const out = join(extension, 'store');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const zip = join(out, `Where-U-Elevate-Extension-${version}.zip`);
// Windows' own tar writes zips (-a picks the format from the file name). Git Bash's tar comes first on PATH there and cannot.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
run(tar, ['-a', '-c', '-f', zip, '-C', join(extension, 'dist'), '.']);
console.log(`[package] ${zip} is ready to upload to the store.`);
