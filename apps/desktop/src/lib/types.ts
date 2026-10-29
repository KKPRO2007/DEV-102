// ---- SHARED CONTRACT (identical in every app) ----
export type Role = 'ADMIN' | 'MENTOR' | 'CANDIDATE';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ViolationCode =
  | 'MULTIPLE_FACES'
  | 'NO_FACE'
  | 'GAZE_AWAY'
  | 'FACE_MISMATCH'
  | 'AI_SITE_OPENED'
  | 'AI_QUERY_DETECTED'
  | 'BLACKLISTED_APP'
  | 'SCREEN_MIRRORING'
  | 'MULTI_MONITOR'
  | 'VM_DETECTED'
  | 'REMOTE_DESKTOP'
  | 'EXTERNAL_DEVICE'
  | 'CLIPBOARD_USE'
  | 'SHORTCUT_BLOCKED'
  | 'SCREEN_SHARE_STOPPED'
  | 'CAMERA_BLOCKED'
  | 'MULTI_LOGIN'
  | 'NETWORK_LOST'
  | 'WINDOW_BLUR'
  | 'VOICE_DETECTED'
  | 'MIC_BLOCKED'
  | 'PHONE_DETECTED'
  | 'NOTES_DETECTED';

export interface Exam {
  id: string;
  title: string;
  code: string;
  status: 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'COMPLETED';
  startsAt: string;
  endsAt: string;
  durationMin: number;
  totalMarks: number;
  questionCount: number;
  candidateCount: number;
  settings: {
    shuffle: boolean;
    negativeMarking: boolean;
    allowedSites: string[];
    maxWarnings: number;
    autoSubmit: boolean;
    audioMonitoring: boolean;
    /** Violations only flag to the proctor: no candidate warnings, no automatic submit. */
    proctorOnly?: boolean;
    /** Questions are answered in order and cannot be revisited. */
    oneWay?: boolean;
    /** Microphone streamed live to proctors watching the screen (never recorded). */
    liveAudio?: boolean;
  };
}

export interface Question {
  id: string;
  examId: string;
  text: string;
  options: { id: string; text: string }[];
  correctIds: string[];
  multi: boolean;
  /** Absent on older servers, which only had multiple choice. */
  type?: 'MCQ' | 'NUMERIC';
  /** Shown next to a numeric answer box, e.g. "km/h". */
  unit?: string;
  marks: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  tags: string[];
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  userId: string;
  examId: string;
  status: 'INVITED' | 'EMAILED' | 'IN_EXAM' | 'SUBMITTED' | 'DISQUALIFIED';
  emailStatus: 'PENDING' | 'SENT' | 'FAILED';
}

export interface Session {
  id: string;
  candidateId: string;
  examId: string;
  status: 'WAITING' | 'LIVE' | 'SUBMITTED' | 'TERMINATED';
  progress: number;
  riskScore: number; // 0-100
  warnings: number;
  startedAt: string;
}

export interface Violation {
  id: string;
  sessionId: string;
  code: ViolationCode;
  severity: Severity;
  at: string;
  message: string;
  evidenceUrl?: string;
  reviewed?: 'CONFIRMED' | 'OVERRULED';
}

export interface BrowsingLog {
  id: string;
  sessionId: string;
  at: string;
  url: string;
  title: string;
  query?: string;
  flaggedAi: boolean;
}

// ---- DESKTOP ADDITIONS ----
export type AppStep = 'login' | 'systemCheck' | 'faceVerify' | 'consent' | 'exam' | 'submitted';
export type AppRoute = 'candidate' | 'mentor';

export const APP_STEPS: readonly { id: AppStep; label: string }[] = [
  { id: 'login', label: 'Sign in' },
  { id: 'systemCheck', label: 'System check' },
  { id: 'faceVerify', label: 'Verify identity' },
  { id: 'consent', label: 'Consent' },
  { id: 'exam', label: 'Exam' },
  { id: 'submitted', label: 'Submitted' },
];

export const RISK_WEIGHT: Record<Severity, number> = { LOW: 3, MEDIUM: 8, HIGH: 18, CRITICAL: 40 };

export const VIOLATION_META: Record<ViolationCode, { label: string; severity: Severity; message: string }> = {
  MULTIPLE_FACES: { label: 'Multiple faces', severity: 'HIGH', message: 'More than one person was detected in the camera frame.' },
  NO_FACE: { label: 'No face detected', severity: 'MEDIUM', message: 'Your face is not visible. Please stay in front of the camera.' },
  GAZE_AWAY: { label: 'Looking away', severity: 'LOW', message: 'You looked away from the screen for an extended period.' },
  FACE_MISMATCH: { label: 'Face mismatch', severity: 'CRITICAL', message: 'The face on camera does not match the verified candidate.' },
  AI_SITE_OPENED: { label: 'AI site opened', severity: 'HIGH', message: 'An AI assistant website was opened in the exam browser.' },
  AI_QUERY_DETECTED: { label: 'AI query detected', severity: 'HIGH', message: 'A question was typed into an AI assistant.' },
  BLACKLISTED_APP: { label: 'Prohibited app', severity: 'HIGH', message: 'A prohibited application is running on your computer.' },
  SCREEN_MIRRORING: { label: 'Screen mirroring', severity: 'HIGH', message: 'Screen mirroring or casting was detected.' },
  MULTI_MONITOR: { label: 'Extra monitor', severity: 'HIGH', message: 'An additional display was connected.' },
  VM_DETECTED: { label: 'Virtual machine', severity: 'CRITICAL', message: 'The exam is running inside a virtual machine.' },
  REMOTE_DESKTOP: { label: 'Remote desktop', severity: 'CRITICAL', message: 'A remote desktop session was detected.' },
  EXTERNAL_DEVICE: { label: 'External device', severity: 'MEDIUM', message: 'An unapproved external device was connected.' },
  CLIPBOARD_USE: { label: 'Clipboard use', severity: 'MEDIUM', message: 'Copy and paste are disabled during the exam.' },
  SHORTCUT_BLOCKED: { label: 'Shortcut blocked', severity: 'LOW', message: 'A restricted keyboard shortcut was blocked.' },
  SCREEN_SHARE_STOPPED: { label: 'Screen share stopped', severity: 'HIGH', message: 'Your screen share was stopped. Please resume it immediately.' },
  CAMERA_BLOCKED: { label: 'Camera blocked', severity: 'HIGH', message: 'Your camera feed is blocked or unavailable.' },
  MULTI_LOGIN: { label: 'Multiple logins', severity: 'CRITICAL', message: 'This account was signed in on another device.' },
  NETWORK_LOST: { label: 'Network lost', severity: 'MEDIUM', message: 'Your internet connection was lost.' },
  WINDOW_BLUR: { label: 'Window focus lost', severity: 'MEDIUM', message: 'The exam window lost focus.' },
  VOICE_DETECTED: { label: 'Voice detected', severity: 'MEDIUM', message: 'Talking was detected. Stay silent during the exam.' },
  MIC_BLOCKED: { label: 'Microphone blocked', severity: 'HIGH', message: 'Your microphone is muted or disconnected. Turn it back on.' },
  PHONE_DETECTED: { label: 'Phone detected', severity: 'HIGH', message: 'A phone is visible on camera. Put it away out of reach.' },
  NOTES_DETECTED: { label: 'Notes detected', severity: 'MEDIUM', message: 'A book or notes are visible on camera. Put them away.' },
};

export const ALL_VIOLATION_CODES = Object.keys(VIOLATION_META) as ViolationCode[];

export type SubmitReason = 'MANUAL' | 'TIME_UP' | 'REPEATED_VIOLATIONS' | 'CRITICAL_VIOLATION' | 'TERMINATED_BY_MENTOR';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  examId?: string;
  token: string;
}

export interface LoginInput {
  examId: string;
  userId: string;
  password: string;
}

export interface MentorLoginInput {
  email: string;
  password: string;
}

export interface OtpChallenge {
  challengeId: string;
  sentTo: string;
  expiresInSec: number;
  resendInSec: number;
}

export interface FaceVerifyResult {
  passed: boolean;
  matchScore: number;
  livenessOk: boolean;
}

export type CandidateQuestion = Omit<Question, 'correctIds'>;

export interface SubmitReceipt {
  receiptId: string;
  submittedAt: string;
  answered: number;
  total: number;
  reason: SubmitReason;
}

export interface ToastItem {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  description?: string;
  durationMs: number;
}

export interface DisplayInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  primary: boolean;
  mirrored: boolean;
}

export interface DetectedApp {
  id: string;
  name: string;
  category: 'REMOTE' | 'RECORDER' | 'MESSAGING' | 'AI' | 'SCREEN_SHARE';
  pid: number;
}

export interface SystemReport {
  os: string;
  cameraOk: boolean;
  micLevel: number; // 0-1
  networkMbps: number;
  latencyMs: number;
  blacklistedApps: DetectedApp[];
  displays: DisplayInfo[];
  vmDetected: boolean;
  remoteDesktop: boolean;
}

export interface ScreenShareResult {
  ok: boolean;
  surface: 'monitor' | 'window' | 'browser' | 'unknown';
  reason?: string;
  simulated?: boolean;
}

export interface ProctorEvent {
  code: ViolationCode;
  message?: string;
  at: string;
}

/** Bridge exposed by the Electron preload script as window.proctor. */
export interface ProctorApi {
  readonly native: boolean;
  /** Development build: no kiosk lock, native guards or blocking system checks. */
  readonly relaxed: boolean;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizeChange(cb: (maximized: boolean) => void): () => void;
  };
  system: {
    scan(): Promise<SystemReport>;
    closeApps(ids: string[]): Promise<string[]>;
  };
  listBlacklistedApps(): Promise<DetectedApp[]>;
  closeApp(pid: number): Promise<void>;
  getDisplays(): Promise<{ count: number; mirrored: boolean }>;
  detectVm(): Promise<{ vm: boolean; remote: boolean; detail: string }>;
  enterKiosk(): Promise<void>;
  exitKiosk(): Promise<void>;
  onEvent(cb: (event: ProctorEvent) => void): () => void;
  kiosk: {
    enter(): Promise<void>;
    exit(): Promise<void>;
    isActive(): boolean;
  };
  screen: {
    requestEntireScreen(): Promise<ScreenShareResult>;
    stop(): Promise<void>;
    onEnded(cb: () => void): () => void;
  };
  events: {
    onViolation(cb: (event: ProctorEvent) => void): () => void;
  };
}

/**
 * What the Electron preload exposes as window.proctor. Screen sharing stays in the renderer
 * (getDisplayMedia, auto-routed to the entire screen by the main process), so it is not here.
 */
export interface NativeBridge extends Omit<ProctorApi, 'screen' | 'system'> {
  readonly native: true;
  deviceId(): Promise<string>;
  system: { closeApps(ids: string[]): Promise<string[]> };
  guards: { start(): Promise<void>; stop(): Promise<void> };
  sandbox: { setPolicy(allowedSites: string[]): Promise<void> };
  store: { get<T = unknown>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<void>; del(key: string): Promise<void> };
  clipboard: { clear(): Promise<void> };
  onDeepLink(cb: (url: string) => void): () => void;
}

declare global {
  interface Window {
    proctor?: NativeBridge;
  }
}
