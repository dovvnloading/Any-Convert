import { BROWSER_FORMATS, planMediaExports } from "@any-convert/media-core";
import type { BrowserFormatId, MediaFacts } from "@any-convert/media-core";

export const MAX_LOCAL_BYTES = 256 * 1024 * 1024;
// Experimental upper bound for disk-backed exports when browser quota and
// file system APIs allow it; not a guarantee of device/codec support.
export const MAX_STREAMING_BYTES = 1024 * 1024 * 1024;

/** Output labels and presets come from the shared, versioned registry. */
export const FORMATS = BROWSER_FORMATS.map((format) => ({
  id: format.id,
  label: format.label,
  group: format.group,
  detail: format.detail,
  description: format.description,
  mime: format.mime,
}));

export type FormatId = BrowserFormatId;
export type QualityId = "source" | "balanced" | "compact";
export type HeightLimit = "original" | "1080" | "720" | "480";
export type FormatGroup = "video" | "audio";

export type MediaInfo = {
  container: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  canDecodeVideo: boolean;
  canDecodeAudio: boolean;
  fileBytes: number;
  streamingAvailable: boolean;
  encoderSupport?: Partial<Record<"avc" | "vp9" | "opus", boolean>>;
};

export type InspectRequest = { type: "inspect"; id: number; file: File };
export type ConvertRequest = {
  type: "convert";
  id: number;
  file: File;
  preset: FormatId;
  quality: QualityId;
  height: HeightLimit;
  storageKey: string; // app-generated, allowlisted OPFS temporary output name
};
export type WorkerRequest = InspectRequest | ConvertRequest;

export type WorkerResponse =
  | { type: "inspected"; id: number; info: MediaInfo }
  | { type: "stage"; id: number; stage: "preparing" | "converting" | "verifying" }
  | { type: "progress"; id: number; progress: number }
  | { type: "complete"; id: number; buffer: ArrayBuffer; file?: never; storageKey?: never; mime: string; extension: FormatId; bytes: number }
  | { type: "complete"; id: number; file: File; storageKey: string; buffer?: never; mime: string; extension: FormatId; bytes: number }
  | { type: "error"; id: number; message: string };

export function getFormat(id: FormatId) {
  return FORMATS.find((item) => item.id === id) ?? FORMATS[0]!;
}

export function isAudioFormat(id: FormatId): boolean {
  return getFormat(id).group === "audio";
}

export function validFormats(info: MediaInfo): FormatId[] {
  const media: MediaFacts = {
    sizeBytes: info.fileBytes,
    durationSeconds: info.duration,
    width: info.width,
    height: info.height,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    hasVideo: info.hasVideo,
    hasAudio: info.hasAudio,
    canDecodeVideo: info.canDecodeVideo,
    canDecodeAudio: info.canDecodeAudio,
    ...(info.encoderSupport ? { encoderSupport: info.encoderSupport } : {}),
  };
  return planMediaExports(media, {
    localMaxBytes: info.streamingAvailable ? MAX_STREAMING_BYTES : MAX_LOCAL_BYTES,
  })
    .filter((plan) => plan.format.browser && plan.browser.status !== "blocked")
    .map((plan) => plan.format.id as FormatId);
}

export function recommendedLocalFormat(info: MediaInfo): FormatId | null {
  const eligible = validFormats(info);
  const preferred = info.hasVideo ? "mp4" : "mp3";
  return eligible.includes(preferred) ? preferred : (eligible[0] ?? null);
}

export function safeOutputName(source: string, format: FormatId): string {
  const stem = source.replace(/\.[^./\\]+$/, "").trim()
    .replace(/[/\\<>:"|?*]/g, "-")
    .split("").map((character) => character.charCodeAt(0) < 32 ? "-" : character).join("")
    .replace(/\s+/g, " ").slice(0, 100) || "converted-video";
  return [stem, "-converted.", format].join("");
}

export function validProgress(n: number): number | null {
  return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.min(99, Math.round(n * 100)) : null;
}

/**
 * A message assembled only from known conversion status codes and probed codec
 * identifiers. Ordinary library exceptions must never be forwarded verbatim
 * because they may contain local filenames or browser internals.
 */
export class MediaCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaCapabilityError";
  }
}

export type ConversionTrackIssue = {
  track: "video" | "audio";
  reason: string;
  codec: string | null;
};

function codecLabel(value: string | null): string {
  if (!value || !/^[a-z0-9._-]{1,24}$/i.test(value)) return "unknown-codec";
  const normalized = value.toLowerCase();
  switch (normalized) {
    case "avc": return "H.264/AVC";
    case "hevc": return "H.265/HEVC";
    case "vp8": return "VP8";
    case "vp9": return "VP9";
    case "av1": return "AV1";
    case "aac": return "AAC";
    case "opus": return "Opus";
    case "mp3": return "MP3";
    case "flac": return "FLAC";
    default: return normalized.toUpperCase();
  }
}

/** Explain MediaBunny's discarded-track reasons without leaking raw exceptions. */
export function explainConversionPlanFailure(
  preset: FormatId,
  issues: readonly ConversionTrackIssue[],
): string {
  const relevant = issues.filter((issue) => issue.reason !== "discarded_by_user");
  const undecodable = relevant.find((issue) => issue.reason === "undecodable_source_codec");
  if (undecodable) {
    return `This browser cannot decode the input's ${codecLabel(undecodable.codec)} ${undecodable.track} track. Changing the output format will not add a missing decoder. Try a browser with codec support or the separately self-hosted Native Engine.`;
  }
  const unknown = relevant.find((issue) => issue.reason === "unknown_source_codec");
  if (unknown) {
    return `The input's ${unknown.track} codec is unknown to the browser converter. Try a compatible source or the separately self-hosted Native Engine.`;
  }
  const encoder = relevant.find((issue) => issue.reason === "no_encodable_target_codec");
  if (encoder) {
    return `This browser cannot encode the ${encoder.track} track required for ${preset.toUpperCase()}. Try another eligible output format or the separately self-hosted Native Engine.`;
  }
  const copy = relevant.find((issue) => issue.reason === "cannot_copy");
  if (copy) {
    return `The input's ${copy.track} track cannot be copied into ${preset.toUpperCase()} with these settings. Try another output format or quality setting.`;
  }
  return `This browser cannot build a valid ${preset.toUpperCase()} conversion with the source tracks. Try another eligible output format or the separately self-hosted Native Engine.`;
}

export function explainMediaError(error: unknown): string {
  if (error instanceof MediaCapabilityError) return error.message;
  const raw = error instanceof Error ? error.message : String(error);
  const msg = raw.toLowerCase();
  if (msg.includes("unreadable") || msg.includes("cannot read") || msg.includes("invalid") ||
      msg.includes("format") || msg.includes("malformed")) {
    return "We couldn't read this media file. It may be damaged or use a format not supported by the local engine.";
  }
  if (msg.includes("no encodable") || msg.includes("not supported") || msg.includes("unsupported") ||
      msg.includes("cannot decode") || msg.includes("undecodable") || msg.includes("codec") ||
      msg.includes("not implemented")) {
    return "Your browser cannot decode or encode this codec. Try a different output format or browser. A separately self-hosted Native Engine may support this file.";
  }
  if (msg.includes("memory") || msg.includes("allocation") || msg.includes("buffer")) {
    return "This file exceeded the browser's available memory. Try a smaller file or a lower resolution.";
  }
  if (msg.includes("no audio")) return "This file doesn't contain an audio track to extract.";
  if (msg.includes("no video")) return "This file doesn't contain a video track.";
  return "Conversion didn't finish. Your original file is unchanged. Try again or choose another format.";
}
