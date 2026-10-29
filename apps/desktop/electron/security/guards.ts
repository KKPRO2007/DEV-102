import { clipboard, screen } from 'electron';
import si from 'systeminformation';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { DetectedApp, DisplayInfo, ProctorEvent, ViolationCode } from '../../src/lib/types';

type Category = DetectedApp['category'];
type Emit = (event: ProctorEvent) => void;

/** Process names (lower-case, without .exe) grouped by why they are banned during an exam. */
const BLACKLIST: Record<string, { name: string; category: Category }> = Object.fromEntries(
  ([
    ['REMOTE', ['anydesk', 'teamviewer', 'teamviewer_service', 'rustdesk', 'parsecd', 'parsec', 'chrome remote desktop host', 'remoting_host', 'mstsc', 'vncviewer', 'vncserver', 'tvnserver', 'winvnc', 'ultravnc', 'splashtopstreamer', 'srstreamer', 'logmein', 'lmiguardiansvc', 'ammyy_admin', 'aa_v3', 'supremo', 'radmin', 'rserver3', 'dwagent', 'meshagent', 'quickassist', 'remotepc', 'zohoassist', 'getscreen', 'nomachine', 'nxplayer']],
    ['RECORDER', ['obs64', 'obs32', 'obs', 'bandicam', 'camtasia', 'camrec', 'sharex', 'fraps', 'action_x64', 'dxtory', 'screenrec', 'snagit32', 'snagiteditor', 'flashbackrecorder', 'apowerrec', 'xsplit.core', 'streamlabs obs', 'loom', 'screenpresso', 'gyazo']],
    ['MESSAGING', ['whatsapp', 'whatsapp.root', 'telegram', 'discord', 'slack', 'signal', 'skype', 'ms-teams', 'teams', 'zoom', 'viber', 'wechat', 'line', 'messenger', 'element', 'thunderbird']],
    ['AI', ['chatgpt', 'claude', 'copilot', 'perplexity', 'cursor', 'windsurf', 'githubcopilot', 'lmstudio', 'ollama', 'jan', 'gpt4all', 'msty', 'poe', 'gemini']],
    ['SCREEN_SHARE', ['spacedesk', 'spacedeskservice', 'duet', 'lonelyscreen', 'airserver', 'apowermirror', 'scrcpy', 'vysor', 'letsview', 'mirroring360', 'airparrot', 'yourphone', 'phoneexperiencehost', 'droidcam', 'iriun', 'epoccam', 'ivcam', 'manycam', 'snapcamera', 'xsplit.vcam']],
  ] as [Category, string[]][]).flatMap(([category, names]) =>
    names.map((n) => [n, { name: n.replace(/(^|[ _.])(\w)/g, (_m, s: string, c: string) => `${s === '_' || s === '.' ? ' ' : s}${c.toUpperCase()}`).trim(), category }]),
  ),
);

const VM_MARKERS = /vmware|virtualbox|vbox|qemu|kvm|xen|hyper-v|virtual machine|parallels|bochs|innotek|bhyve|amazon ec2|google compute/i;
const VM_MACS = ['00:05:69', '00:0c:29', '00:1c:14', '00:50:56', '08:00:27', '00:15:5d', '00:1c:42', '52:54:00', '00:16:3e'];
const PHONE_OR_STORAGE = /phone|android|iphone|ipad|mtp|mass storage|card reader|flash|storage|kindle|camera|capture/i;

/**
 * Coding assistants a developer has open while running `npm start`. Development builds skip them
 * in the system check list; packaged builds and PROCTOR_STRICT=1 flag them.
 */
const DEV_TOOLS = new Set(['claude', 'codex', 'cursor', 'copilot', 'githubcopilot', 'windsurf']);
/** Development builds without PROCTOR_STRICT=1: no native restrictions, so the exam can be tested on a dev machine. */
let relaxed = false;
export function setRelaxed(on: boolean): void {
  relaxed = on;
}

export async function scanProcesses(): Promise<DetectedApp[]> {
  const { list } = await si.processes();
  const seen = new Map<string, DetectedApp>();
  for (const p of list) {
    const key = p.name.toLowerCase().replace(/\.exe$/, '');
    if (relaxed && DEV_TOOLS.has(key)) continue;
    const hit = BLACKLIST[key];
    if (hit && !seen.has(key)) seen.set(key, { id: `app-${key}`, name: hit.name, category: hit.category, pid: p.pid });
  }
  return [...seen.values()];
}

const TITLES_PS = "Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + '|' + $_.MainWindowTitle }";

/**
 * Titles of the visible windows of other programs (Windows only). A browser's title is its active
 * tab, e.g. "ChatGPT - Google Chrome", so proctors learn which AI tool is open outside the exam.
 */
export function windowTitles(): Promise<{ app: string; title: string }[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', TITLES_PS], { timeout: 4000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve([]);
      const own = process.execPath.toLowerCase();
      resolve(stdout.split(/\r?\n/).flatMap((line) => {
        const at = line.indexOf('|');
        if (at < 1) return [];
        const app = line.slice(0, at).trim();
        if ((relaxed && DEV_TOOLS.has(app.toLowerCase())) || own.includes(`${app.toLowerCase()}.exe`)) return [];
        return [{ app, title: line.slice(at + 1).trim().slice(0, 200) }];
      }));
    });
  });
}

/** Ends a blacklisted process. Only called after the candidate presses Close in the system check. */
export async function closeProcess(pid: number): Promise<boolean> {
  const apps = await scanProcesses();
  if (!apps.some((a) => a.pid === pid)) return false; // never kill a process that is not on the list
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

export async function displays(): Promise<{ count: number; mirrored: boolean; list: DisplayInfo[]; casting: boolean }> {
  const electronDisplays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const g = await si.graphics().catch(() => ({ displays: [] as si.Systeminformation.GraphicsDisplayData[] }));
  const physical = g.displays.length;
  // Duplicate mode shows as more physical outputs than logical desktops; Miracast shows as a WIRELESS connection.
  const mirrored = physical > electronDisplays.length;
  const casting = g.displays.some((d) => /miracast|wireless|wfd/i.test(`${d.connection ?? ''} ${d.model ?? ''}`));
  return {
    count: Math.max(electronDisplays.length, physical ? Math.min(physical, electronDisplays.length) : electronDisplays.length),
    mirrored: mirrored || casting,
    casting,
    list: electronDisplays.map((d, i) => ({ id: String(d.id), label: d.label || `Display ${i + 1}`, width: d.size.width, height: d.size.height, primary: d.id === primary.id, mirrored })),
  };
}

export async function detectVm(): Promise<{ vm: boolean; remote: boolean; detail: string }> {
  const [sys, bios, iface, nets] = await Promise.all([si.system(), si.bios(), si.networkInterfaceDefault(), si.networkInterfaces()]);
  const reasons: string[] = [];
  if (sys.virtual) reasons.push(`hypervisor reported (${sys.virtualHost || 'virtual'})`);
  if (VM_MARKERS.test(`${sys.manufacturer} ${sys.model}`)) reasons.push(`system "${sys.manufacturer} ${sys.model}"`);
  if (VM_MARKERS.test(`${bios.vendor} ${bios.version}`)) reasons.push(`BIOS "${bios.vendor}"`);
  // Only the default adapter counts: hosts running VMware, WSL or Docker have virtual adapters too.
  const main = (Array.isArray(nets) ? nets : [nets]).find((n) => n.iface === iface);
  if (main?.mac && VM_MACS.some((p) => main.mac.toLowerCase().startsWith(p)) && !main.virtual) reasons.push(`network adapter ${main.mac.slice(0, 8)}`);
  const rdp = /^rdp-/i.test(process.env.SESSIONNAME ?? '');
  const apps = await scanProcesses();
  const remoteApps = apps.filter((a) => a.category === 'REMOTE').map((a) => a.name);
  const vm = reasons.length > 0;
  const remote = rdp || remoteApps.length > 0;
  const detail = vm ? `Virtual machine detected: ${reasons.join(', ')}` : remote ? `Remote session detected${rdp ? ' (Windows Remote Desktop)' : ''}${remoteApps.length ? `: ${remoteApps.join(', ')}` : ''}` : 'No virtual machine or remote session detected';
  return { vm, remote, detail };
}

export async function deviceFingerprint(): Promise<string> {
  const id = await si.uuid();
  return createHash('sha256').update(`dev102:${id.os}:${id.hardware}`).digest('hex').slice(0, 32);
}

async function usbSnapshot(): Promise<Map<string, string>> {
  const [usb, blocks] = await Promise.all([si.usb().catch(() => []), si.blockDevices().catch(() => [])]);
  const out = new Map<string, string>();
  for (const u of usb) out.set(`usb:${u.vendor}:${u.name}:${u.serialNumber ?? u.id}`, `${u.name} (${u.type || 'USB'})`);
  for (const b of blocks) if (b.removable) out.set(`blk:${b.name}:${b.serial}`, `${b.label || b.name} removable drive`);
  return out;
}

/**
 * Continuous monitoring while the exam runs: processes, displays, VM/remote sessions, new USB
 * devices and the clipboard. Each detector reports a code once and again only after it clears.
 */
export class GuardMonitor {
  private timers: NodeJS.Timeout[] = [];
  private active = new Set<string>();
  private usbBaseline: Map<string, string> | null = null;

  constructor(private readonly emit: Emit) {}

  private flag(key: string, on: boolean, code: ViolationCode, message: string): void {
    if (on && !this.active.has(key)) {
      this.active.add(key);
      this.emit({ code, message, at: new Date().toISOString() });
    } else if (!on) this.active.delete(key);
  }

  private hashClip(): string {
    const text = clipboard.readText();
    const img = clipboard.readImage();
    return text || !img.isEmpty() ? createHash('sha1').update(text).update(img.isEmpty() ? '' : img.toDataURL().slice(0, 2048)).digest('hex') : '';
  }

  async start(): Promise<void> {
    this.stop();
    if (relaxed) return;
    clipboard.clear();
    this.usbBaseline = await usbSnapshot();
    const every = (ms: number, fn: () => Promise<void> | void) => {
      const run = () => Promise.resolve(fn()).catch(() => undefined);
      void run();
      this.timers.push(setInterval(run, ms));
    };
    every(10_000, async () => {
      const apps = await scanProcesses();
      const names = new Set(apps.map((a) => a.id));
      for (const a of apps) this.flag(a.id, true, a.category === 'REMOTE' ? 'REMOTE_DESKTOP' : 'BLACKLISTED_APP', `${a.name} (${a.category.toLowerCase().replace('_', ' ')}) started during the exam`);
      for (const k of [...this.active]) if (k.startsWith('app-') && !names.has(k)) this.active.delete(k);
    });
    every(6_000, async () => {
      const d = await displays();
      this.flag('multi-monitor', d.count > 1, 'MULTI_MONITOR', `${d.count} displays are connected`);
      this.flag('mirroring', d.mirrored, 'SCREEN_MIRRORING', d.casting ? 'Wireless casting (Miracast) is active' : 'Display duplication or mirroring is active');
    });
    every(60_000, async () => {
      const v = await detectVm();
      this.flag('vm', v.vm, 'VM_DETECTED', v.detail);
      this.flag('remote', v.remote && !v.vm, 'REMOTE_DESKTOP', v.detail);
    });
    every(8_000, async () => {
      const now = await usbSnapshot();
      for (const [key, label] of now) {
        if (this.usbBaseline?.has(key)) continue;
        this.usbBaseline?.set(key, label);
        if (PHONE_OR_STORAGE.test(label) || key.startsWith('blk:')) this.emit({ code: 'EXTERNAL_DEVICE', message: `New device attached: ${label}`, at: new Date().toISOString() });
      }
    });
    every(1_500, () => {
      // Copying inside the exam is blocked, so any content came from outside (another app, phone link).
      if (this.hashClip()) {
        clipboard.clear();
        this.emit({ code: 'CLIPBOARD_USE', message: 'Clipboard content from outside the exam was cleared', at: new Date().toISOString() });
      }
    });
    screen.on('display-added', this.onDisplayAdded);
  }

  private onDisplayAdded = (): void => {
    this.flag('multi-monitor', true, 'MULTI_MONITOR', 'A display was connected during the exam');
  };

  stop(): void {
    this.timers.splice(0).forEach(clearInterval);
    screen.removeListener('display-added', this.onDisplayAdded);
    this.active.clear();
  }
}
