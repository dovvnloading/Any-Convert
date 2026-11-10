export const MAX_LOCAL_BYTES = 256 * 1024 * 1024;

export const FORMATS = [
  { id: "mp4", label: "MP4", group: "video", detail: "H.264 · AAC", description: "Best for sharing everywhere", mime: "video/mp4" },
  { id: "webm", label: "WebM", group: "video", detail: "VP9 · Opus", description: "Modern web video", mime: "video/webm" },
  { id: "mov", label: "MOV", group: "video", detail: "H.264 · AAC", description: "Editing-friendly container", mime: "video/quicktime" },
  { id: "mp3", label: "MP3", group: "audio", detail: "Lossy audio", description: "Portable audio", mime: "audio/mpeg" },
  { id: "wav", label: "WAV", group: "audio", detail: "Uncompressed", description: "Editing-quality audio", mime: "audio/wav" },
  { id: "flac", label: "FLAC", group: "audio", detail: "Lossless", description: "Archival-quality audio", mime: "audio/flac" },
] as const;

export type FormatId = (typeof FORMATS)[number]["id"];
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
};

export type InspectRequest = { type: "inspect"; id: number; file: File };
export type ConvertRequest = {
  type: "convert";
  id: number;
  file: File;
  preset: FormatId;
  quality: QualityId;
  height: HeightLimit;
};
export type WorkerRequest = InspectRequest | ConvertRequest;

export type WorkerResponse =
  | { type: "inspected"; id: number; info: MediaInfo }
  | { type: "stage"; id: number; stage: "preparing" | "converting" | "verifying" }
  | { type: "progress"; id: number; progress: number }
  | { type: "complete"; id: number; buffer: ArrayBuffer; mime: string; extension: FormatId; bytes: number }
  | { type: "error"; id: number; message: string };

export function getFormat(id: FormatId) {
  return FORMATS.find((item) => item.id === id) ?? FORMATS[0];
}

export function isAudioFormat(id: FormatId): boolean {
  return getFormat(id).group === "audio";
}

export function validFormats(info: MediaInfo): FormatId[] {
  const formats: FormatId[] = [];
  if (info.hasVideo) formats.push("mp4", "webm", "mov");
  if (info.hasAudio) formats.push("mp3", "wav", "flac");
  return formats;
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

export function explainMediaError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const msg = raw.toLowerCase();
  if (msg.includes("unreadable") || msg.includes("cannot read") || msg.includes("invalid") ||
      msg.includes("format") || msg.includes("malformed")) {
    return "We couldn't read this media file. It may be damaged or use a format not supported by the local engine.";
  }
  if (msg.includes("no encodable") || msg.includes("not supported") || msg.includes("unsupported") ||
      msg.includes("cannot decode") || msg.includes("undecodable") || msg.includes("codec") ||
      msg.includes("not implemented")) {
    return "Your browser cannot decode or encode this codec. Try a different output format or browser. Broader server conversion is coming.";
  }
  if (msg.includes("memory") || msg.includes("allocation") || msg.includes("buffer")) {
    return "This file exceeded the browser's available memory. Try a smaller file or a lower resolution.";
  }
  if (msg.includes("no audio")) return "This file doesn't contain an audio track to extract.";
  if (msg.includes("no video")) return "This file doesn't contain a video track.";
  return "Conversion didn't finish. Your original file is unchanged. Try again or choose another format.";
}
