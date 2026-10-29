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

export interface ExamSettings {
  shuffle: boolean;
  negativeMarking: boolean;
  allowedSites: string[];
  maxWarnings: number;
  autoSubmit: boolean;
  /** Voice and microphone checks on the candidate's computer. No audio leaves the device. */
  audioMonitoring: boolean;
  /** Violations only flag to the proctor: no candidate warnings, no automatic submit. */
  proctorOnly?: boolean;
  /** Questions are answered in order and cannot be revisited. */
  oneWay?: boolean;
  /** Microphone streamed live to proctors (never recorded). */
  liveAudio?: boolean;
}

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
  settings: ExamSettings;
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  examId: string;
  text: string;
  options: QuestionOption[];
  correctIds: string[];
  multi: boolean;
  /** Absent on older data, which is all multiple choice. */
  type?: 'MCQ' | 'NUMERIC';
  /** NUMERIC only: correct when |answer - value| <= tolerance. Staff views only. */
  answerKey?: NumericKey;
  /** NUMERIC only: shown next to the answer box. */
  unit?: string;
  marks: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  tags: string[];
}

export interface NumericKey {
  value: number;
  tolerance: number;
  unit: string | null;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  userId: string;
  examId: string;
  status: 'INVITED' | 'EMAILED' | 'IN_EXAM' | 'SUBMITTED' | 'DISQUALIFIED';
  emailStatus: 'PENDING' | 'SENT' | 'FAILED';
  /** Signed URL of the reference photo captured at face verification. */
  photoUrl?: string;
  /** Newest emailed join link, when one was sent. */
  invite?: { id: string; status: InviteStatus; deviceBound: boolean };
}

export type InviteStatus = 'PENDING' | 'USED' | 'REVOKED' | 'EXPIRED';

export interface Session {
  id: string;
  candidateId: string;
  examId: string;
  status: 'WAITING' | 'LIVE' | 'SUBMITTED' | 'TERMINATED';
  progress: number;
  /** 0 to 100 */
  riskScore: number;
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
