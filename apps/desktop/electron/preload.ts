import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DetectedApp, NativeBridge, ProctorEvent } from '../src/lib/types';
import { CH } from './channels';

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const fn = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

let kioskActive = false;

const bridge: NativeBridge = {
  native: true,
  relaxed: process.argv.includes('--proctor-relaxed'),
  deviceId: () => invoke<string>(CH.deviceId),
  window: {
    minimize: () => invoke(CH.winMinimize),
    toggleMaximize: () => invoke<boolean>(CH.winToggleMax),
    close: () => invoke(CH.winClose),
    isMaximized: () => invoke<boolean>(CH.winIsMax),
    capture: () => invoke<string | null>(CH.winCapture),
    onMaximizeChange: (cb) => listen<boolean>(CH.evMaximize, cb),
  },
  system: { closeApps: (ids) => invoke<string[]>(CH.closeApps, ids) },
  listBlacklistedApps: () => invoke<DetectedApp[]>(CH.scanProcesses),
  windowTitles: () => invoke<{ app: string; title: string }[]>(CH.windowTitles),
  closeApp: async (pid) => {
    await invoke<boolean>(CH.closeProcess, pid);
  },
  getDisplays: () => invoke<{ count: number; mirrored: boolean }>(CH.displays),
  detectVm: () => invoke<{ vm: boolean; remote: boolean; detail: string }>(CH.vm),
  enterKiosk: () => bridge.kiosk.enter(),
  exitKiosk: () => bridge.kiosk.exit(),
  onEvent: (cb) => listen<ProctorEvent>(CH.evViolation, cb),
  kiosk: {
    enter: async () => {
      await invoke(CH.kioskEnter);
      kioskActive = true;
    },
    exit: async () => {
      await invoke(CH.kioskExit);
      kioskActive = false;
    },
    isActive: () => kioskActive,
  },
  events: { onViolation: (cb) => listen<ProctorEvent>(CH.evViolation, cb) },
  guards: { start: () => invoke(CH.guardsStart), stop: () => invoke(CH.guardsStop) },
  sandbox: { setPolicy: (sites) => invoke(CH.sandboxPolicy, sites) },
  store: {
    get: <T>(key: string) => invoke<T | null>(CH.storeGet, key),
    set: (key, value) => invoke(CH.storeSet, key, value),
    del: (key) => invoke(CH.storeDel, key),
  },
  clipboard: { clear: () => invoke(CH.clipboardClear) },
  onDeepLink: (cb) => listen<string>(CH.evDeepLink, cb),
};

contextBridge.exposeInMainWorld('proctor', bridge);
