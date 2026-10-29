import { BrowserWindow, clipboard, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ProctorEvent } from '../src/lib/types';
import { GuardMonitor, closeProcess, detectVm, deviceFingerprint, displays, scanProcesses } from './security/guards';
import type { Kiosk } from './security/kiosk';
import { setPolicy } from './browser-sandbox/sandbox';
import { storeDel, storeGet, storeSet } from './secure-store';
import { CH } from './channels';

export { CH };


const KEY_RE = /^[\w-]{1,64}$/;

export function registerIpc(getWin: () => BrowserWindow | null, getKiosk: () => Kiosk | null, rendererOrigin: () => string): (e: ProctorEvent) => void {
  const emit = (e: ProctorEvent) => getWin()?.webContents.send(CH.evViolation, e);
  const guards = new GuardMonitor(emit);

  /** Only the exam window's own top frame may call the bridge (not sandbox tabs or injected frames). */
  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const win = getWin();
    if (!win || event.sender.id !== win.webContents.id || !event.senderFrame) return false;
    try {
      return event.senderFrame.parent === null && new URL(event.senderFrame.url).origin === rendererOrigin();
    } catch {
      return rendererOrigin() === 'file://' && event.senderFrame.url.startsWith('file://');
    }
  };
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted sender');
      return fn(...(args as A));
    });

  handle(CH.winMinimize, () => getWin()?.minimize());
  handle(CH.winToggleMax, () => {
    const w = getWin();
    if (!w) return false;
    if (w.isFullScreen() || w.isMaximized()) {
      w.setFullScreen(false);
      w.unmaximize();
    } else w.setFullScreen(true);
    return w.isFullScreen() || w.isMaximized();
  });
  handle(CH.winClose, () => {
    if (getKiosk()?.active) return; // the exam window cannot be closed mid-exam
    getWin()?.close();
  });
  handle(CH.winIsMax, () => Boolean(getWin()?.isFullScreen() || getWin()?.isMaximized()));
  // Content protection hides the exam window from every screen capture, but not from its own
  // compositor: this picture includes the sandbox tabs, so proctors see AI sites as the candidate does.
  handle(CH.winCapture, async () => {
    const win = getWin();
    if (!win || win.isDestroyed()) return null;
    const img = await win.webContents.capturePage();
    if (img.isEmpty()) return null;
    const scaled = img.getSize().width > 1280 ? img.resize({ width: 1280, quality: 'good' }) : img;
    return `data:image/jpeg;base64,${scaled.toJPEG(60).toString('base64')}`;
  });
  handle(CH.deviceId, () => deviceFingerprint());
  handle(CH.scanProcesses, () => scanProcesses());
  handle(CH.closeProcess, (pid: unknown) => (Number.isInteger(pid) && (pid as number) > 4 ? closeProcess(pid as number) : false));
  handle(CH.closeApps, async (ids: unknown) => {
    if (!Array.isArray(ids)) return [];
    const apps = await scanProcesses();
    const closed: string[] = [];
    for (const a of apps.filter((x) => ids.includes(x.id))) if (await closeProcess(a.pid)) closed.push(a.id);
    return closed;
  });
  handle(CH.displays, async () => {
    const d = await displays();
    return { count: d.count, mirrored: d.mirrored };
  });
  handle(CH.vm, () => detectVm());
  handle(CH.kioskEnter, () => getKiosk()?.enter());
  handle(CH.kioskExit, () => getKiosk()?.exit());
  handle(CH.guardsStart, () => guards.start());
  handle(CH.guardsStop, () => guards.stop());
  handle(CH.sandboxPolicy, (sites: unknown) => {
    if (Array.isArray(sites)) setPolicy(sites.filter((s): s is string => typeof s === 'string' && s.length < 120));
  });
  handle(CH.storeGet, (key: unknown) => (typeof key === 'string' && KEY_RE.test(key) ? storeGet(key) : null));
  handle(CH.storeSet, (key: unknown, value: unknown) => (typeof key === 'string' && KEY_RE.test(key) ? storeSet(key, value) : undefined));
  handle(CH.storeDel, (key: unknown) => (typeof key === 'string' && KEY_RE.test(key) ? storeDel(key) : undefined));
  handle(CH.clipboardClear, () => clipboard.clear());

  return emit;
}
