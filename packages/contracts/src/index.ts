/**
 * A contract describes a real verified capability, not a filename suffix.
 * These are version-0 shapes. Wire validation and persistence arrive in M2.
 */
export const JOB_STATES = [
  "created", "probing", "queued", "processing", "validating",
  "ready", "failed", "cancelled", "expired",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_JOB_STATES = ["ready", "failed", "cancelled", "expired"] as const;

export type Engine = "browser" | "native" | "gpu";
export type MediaTask = "convert" | "extract-audio" | "gif" | "frames" | "matte";

export type MediaStream = {
  index: number;
  codecType: "video" | "audio" | "subtitle" | "data" | "attachment" | "unknown";
  codecName: string;
  width?: number;
  height?: number;
  channels?: number;
};

export type MediaProbe = {
  container: string;
  durationSeconds: number | null;
  streams: MediaStream[];
};

export type ConversionPreset = "universal-mp4";

export type ConversionRecipe = {
  version: 1;
  task: "convert";
  preset: ConversionPreset;
  preserveAudio: boolean;
};

export type JobEvent = {
  sequence: number;
  jobId: string;
  state: JobState;
  at: string;
  message?: string;
  progress?: number; // 0..1, only for measured stages
};

const allowedTransitions: Record<JobState, ReadonlySet<JobState>> = {
  created: new Set(["probing", "cancelled", "failed"]),
  probing: new Set(["queued", "failed", "cancelled"]),
  queued: new Set(["processing", "cancelled", "failed"]),
  processing: new Set(["validating", "cancelled", "failed"]),
  validating: new Set(["ready", "cancelled", "failed"]),
  ready: new Set(["expired"]),
  failed: new Set([]),
  cancelled: new Set([]),
  expired: new Set([]),
};

export function canTransition(from: JobState, to: JobState): boolean {
  return allowedTransitions[from].has(to);
}

export function isJobState(value: string): value is JobState {
  return (JOB_STATES as readonly string[]).includes(value);
}

export function assertProgress(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError("Progress must be a finite fraction between 0 and 1.");
  }
}
