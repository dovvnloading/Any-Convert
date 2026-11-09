const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "flv", "mpg", "mpeg", "3gp", "ts",
]);

export function isPotentialVideo(file: Pick<File, "name" | "type" | "size">): boolean {
  if (file.size <= 0) return false;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.has(extension);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return String(bytes).concat(" B");
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  const units = ["B", "KB", "MB", "GB", "TB"];
  return [(bytes / 1024 ** unit).toFixed(bytes / 1024 ** unit >= 10 ? 0 : 1), units[unit]].join(" ");
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Unknown duration";
  const rounded = Math.floor(seconds);
  const hh = Math.floor(rounded / 3600);
  const mm = Math.floor((rounded % 3600) / 60);
  const ss = rounded % 60;
  return hh > 0
    ? [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":")
    : [mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}
