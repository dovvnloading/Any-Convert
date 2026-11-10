export const NATIVE_ENDPOINT = "/api/native";

export const NATIVE_FORMATS = [
  { id: "mp4", title: "MP4", subtitle: "H.264 · AAC", kind: "video" },
  { id: "mov", title: "MOV", subtitle: "H.264 · AAC", kind: "video" },
  { id: "webm", title: "WebM", subtitle: "VP9 · Opus", kind: "video" },
  { id: "mp3", title: "MP3", subtitle: "Audio only", kind: "audio" },
  { id: "wav", title: "WAV", subtitle: "Uncompressed", kind: "audio" },
  { id: "flac", title: "FLAC", subtitle: "Lossless", kind: "audio" },
  { id: "gif", title: "GIF", subtitle: "Animated · 12fps", kind: "image" },
] as const;

export type NativeFormat = (typeof NATIVE_FORMATS)[number]["id"];
export type NativeQuality = "high" | "balanced" | "small";
export type NativeHeight = null | 480 | 720 | 1080;
export type NativeJobState =
  | "awaiting-upload" | "uploading" | "uploaded" | "queued"
  | "probing" | "processing" | "verifying" | "ready" | "failed" | "cancelled";

export type NativeHealth = {
  status: "ok";
  engine: "native-ffmpeg";
  formats: string[];
  maxUploadBytes: number;
  maxDurationSeconds: number;
  maxDimension: number;
  maxActiveJobs: number;
  retentionSeconds: number;
  release: string;
};

export type NativeJob = {
  id: string;
  filename: string;
  expectedBytes: number;
  uploadedBytes: number;
  state: NativeJobState;
  stage: string;
  progress: number | null;
  format: NativeFormat | null;
  outputBytes: number | null;
  error: string | null;
  createdAt: number;
  expiresAt: number;
};

export class NativeRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "NativeRequestError";
  }
}

async function parse<T>(response: Response): Promise<T> {
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error
        : "The self-hosted engine could not complete this request.";
    throw new NativeRequestError(message, response.status);
  }
  return result as T;
}

export async function getNativeHealth(): Promise<NativeHealth> {
  const response = await fetch(NATIVE_ENDPOINT + "/health", { cache: "no-store" });
  const health = await parse<NativeHealth>(response);
  if (health.engine !== "native-ffmpeg" || health.status !== "ok") throw new Error("Unknown native engine");
  return health;
}

export async function createNativeJob(file: File): Promise<NativeJob> {
  return parse<NativeJob>(await fetch(NATIVE_ENDPOINT + "/jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, bytes: file.size }),
  }));
}

export async function uploadNativeFile(
  id: string, file: File, onProgress: (fraction: number) => void, signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => { xhr.abort(); finish(new Error("Upload cancelled")); };
    if (signal.aborted) { reject(new Error("Upload cancelled")); return; }
    signal.addEventListener("abort", abort, { once: true });
    xhr.open("PUT", NATIVE_ENDPOINT + "/jobs/" + encodeURIComponent(id) + "/input");
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.floor(event.loaded / event.total * 99)));
      }
    };
    xhr.onerror = () => finish(new Error("Upload interrupted. Please check your connection."));
    xhr.onabort = () => finish(new Error("Upload cancelled"));
    xhr.onload = () => {
      if (xhr.status === 200) finish();
      else {
        let message = "The native server refused this upload.";
        try {
          const parsed: unknown = JSON.parse(xhr.responseText);
          if (parsed && typeof parsed === "object" && "error" in parsed &&
              typeof parsed.error === "string") message = parsed.error;
        } catch { /* Preserve the safe fallback message. */ }
        finish(new NativeRequestError(message, xhr.status));
      }
    };
    xhr.send(file);
  });
}

export async function startNativeJob(
  id: string, format: NativeFormat, quality: NativeQuality, height: NativeHeight,
): Promise<NativeJob> {
  return parse<NativeJob>(await fetch(NATIVE_ENDPOINT + "/jobs/" + encodeURIComponent(id) + "/start", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, quality, height }),
  }));
}

export async function getNativeJob(id: string): Promise<NativeJob> {
  return parse<NativeJob>(await fetch(NATIVE_ENDPOINT + "/jobs/" + encodeURIComponent(id), {
    credentials: "same-origin", cache: "no-store",
  }));
}

export async function deleteNativeJob(id: string): Promise<void> {
  const response = await fetch(NATIVE_ENDPOINT + "/jobs/" + encodeURIComponent(id), {
    method: "DELETE", credentials: "same-origin",
  });
  if (response.status === 404) return;
  if (!response.ok) await parse<unknown>(response);
}

export function getNativeDownload(id: string): string {
  return NATIVE_ENDPOINT + "/jobs/" + encodeURIComponent(id) + "/download";
}
