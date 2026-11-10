import { spawn } from "node:child_process";
import registry from "../../../packages/media-core/format-registry.json" with { type: "json" };

// Runtime catalog is shared with the browser: do not maintain a second
// container/codec allowlist in this service.
if (registry.version !== 1) throw new Error("Unsupported media registry version");
export const FORMATS = Object.freeze(Object.fromEntries(
  registry.formats.filter((format) => format.native).map((format) => [
    format.id,
    Object.freeze({
      extension: format.id, mime: format.mime, kind: format.group,
      video: format.nativeVideoCodec, audio: format.nativeAudioCodec,
    }),
  ]),
));

const QUALITIES = new Set(["high", "balanced", "small"]);
const HEIGHTS = new Set([null, 480, 720, 1080]);

export function validateRecipe(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid conversion recipe");
  const { format, quality = "balanced", height = null } = raw;
  if (!Object.hasOwn(FORMATS, format)) throw new Error("Unsupported output format");
  if (!QUALITIES.has(quality)) throw new Error("Unsupported quality setting");
  if (!HEIGHTS.has(height)) throw new Error("Unsupported resolution setting");
  return Object.freeze({ format, quality, height });
}

export function inspectProbe(raw, maxDurationSeconds = 600, maxDimension = 3840) {
  if (!raw || !Array.isArray(raw.streams) || !raw.format) throw new Error("Unreadable media");
  const streams = raw.streams;
  const video = streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg")
    ?? streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video && !audio) throw new Error("No audio or video tracks");
  const duration = Number(raw.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Media duration is unavailable");
  if (duration > maxDurationSeconds) throw new Error("Media duration exceeds the server safety limit");
  const width = video?.width ?? null;
  const height = video?.height ?? null;
  if (width && height && (width > maxDimension || height > maxDimension || width < 1 || height < 1)) {
    throw new Error("Media resolution exceeds the server safety limit");
  }
  if (streams.length > 32) throw new Error("Media has too many tracks");
  return {
    duration, width, height,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasVideo: Boolean(video), hasAudio: Boolean(audio),
    container: String(raw.format.format_name ?? ""),
  };
}

export function buildArgs(input, output, recipe, source) {
  const spec = FORMATS[recipe.format];
  if (!spec) throw new Error("Unsupported format");
  if (spec.kind === "audio" && !source.hasAudio) throw new Error("Source has no audio track");
  if (spec.kind !== "audio" && !source.hasVideo) throw new Error("Source has no video track");

  const args = [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-progress", "pipe:1", "-stats_period", "0.5",
    "-protocol_whitelist", "file,pipe",
    "-i", input, "-map_metadata", "-1",
    "-sn", "-dn", "-threads", "2", "-filter_threads", "2",
  ];

  if (spec.kind === "audio") {
    args.push("-map", "0:a:0", "-vn");
    if (recipe.format === "mp3") args.push("-c:a", "libmp3lame", "-q:a", recipe.quality === "high" ? "1" : recipe.quality === "small" ? "6" : "3");
    if (recipe.format === "wav") args.push("-c:a", "pcm_s16le");
    if (recipe.format === "flac") args.push("-c:a", "flac");
  } else if (recipe.format === "gif") {
    args.push(
      "-filter_complex",
      "[0:v:0]fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse[v]",
      "-map", "[v]", "-an", "-loop", "0",
    );
  } else {
    const crf = recipe.quality === "high" ? 18 : recipe.quality === "small" ? 30 : 23;
    const filter = recipe.height
      ? "scale=-2:min(ih\\," + recipe.height + "),pad=ceil(iw/2)*2:ceil(ih/2)*2"
      : "pad=ceil(iw/2)*2:ceil(ih/2)*2";
    args.push("-map", "0:v:0", "-map", "0:a:0?", "-vf", filter);
    if (recipe.format === "webm") {
      args.push("-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "6",
        "-b:v", "0", "-crf", String(crf + 8), "-c:a", "libopus", "-b:a", "128k");
    } else {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf),
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k");
      if (recipe.format === "mp4") args.push("-movflags", "+faststart");
    }
  }
  args.push("-y", "-f", recipe.format === "mov" ? "mov" : recipe.format, output);
  return args;
}

export function verifyOutput(probe, recipe, source) {
  const spec = FORMATS[recipe.format];
  if (!spec || !Array.isArray(probe.streams) || !probe.format) throw new Error("Output validation failed");
  const formats = String(probe.format.format_name ?? "").split(",");
  const expected = recipe.format === "webm" ? "matroska" : recipe.format === "mp4" ? "mp4" : recipe.format;
  if (!formats.includes(expected)) throw new Error("Output container mismatch");
  const video = probe.streams.filter((s) => s.codec_type === "video");
  const audio = probe.streams.filter((s) => s.codec_type === "audio");
  if (spec.kind === "audio") {
    if (video.length || audio.length !== 1 || audio[0].codec_name !== spec.audio) throw new Error("Output audio validation failed");
  } else if (video.length !== 1 || video[0].codec_name !== spec.video) {
    throw new Error("Output video validation failed");
  } else if (spec.kind === "image") {
    if (audio.length) throw new Error("GIF must not contain audio");
  } else {
    if (source.hasAudio && (audio.length !== 1 || audio[0].codec_name !== spec.audio)) throw new Error("Output lost audio");
    if (!source.hasAudio && audio.length) throw new Error("Unexpected output audio track");
    if (!video[0].width || !video[0].height || video[0].width % 2 || video[0].height % 2) {
      throw new Error("Output dimensions invalid");
    }
  }
  const duration = Number(probe.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Output duration invalid");
  return true;
}

/** No shell; processing is cancellable and log capture is bounded. */
export function runBinary(binary, args, { signal, timeoutMs = 30_000, onStdout, maxOutputBytes = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Cancelled")); return; }
    const child = spawn(binary, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], signal });
    let stdout = "";
    let stderr = "";
    let total = 0;
    let timedOut = false;
    let exceeded = false;
    let settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    timer.unref();
    function collect(type, chunk) {
      total += chunk.length;
      if (total > maxOutputBytes) {
        exceeded = true;
        child.kill("SIGKILL");
      } else {
        const text = chunk.toString("utf8");
        if (type === "stdout") {
          if (onStdout) onStdout(text);
          else stdout += text;
        } else stderr += text;
      }
    }
    child.stdout.on("data", (part) => collect("stdout", part));
    child.stderr.on("data", (part) => collect("stderr", part));
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (exceeded) return finish(new Error("Media tool log exceeded limit"));
      if (timedOut) return finish(new Error("Media processing timed out"));
      if (signal?.aborted) return finish(new Error("Cancelled"));
      if (code !== 0) return finish(new Error("Media tool exited " + code + ": " + stderr.slice(-600)));
      finish(null, { stdout, stderr });
    });
  });
}

export async function probeFile(path, signal) {
  const { stdout } = await runBinary("ffprobe", [
    "-v", "error", "-protocol_whitelist", "file,pipe",
    "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height",
    "-of", "json", path,
  ], { signal, timeoutMs: 20_000 });
  try { return JSON.parse(stdout); } catch { throw new Error("Media metadata is unreadable"); }
}

export async function encodeFile(input, output, recipe, source, signal, onProgress, timeoutMs) {
  let pending = "";
  await runBinary("ffmpeg", buildArgs(input, output, recipe, source), {
    signal, timeoutMs, maxOutputBytes: 8_000_000,
    onStdout: (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
        if (match && source.duration > 0) {
          const fraction = Number(match[1]) / 1_000_000 / source.duration;
          if (Number.isFinite(fraction)) onProgress(Math.min(99, Math.max(0, Math.floor(fraction * 99))));
        }
      }
    },
  });
}
