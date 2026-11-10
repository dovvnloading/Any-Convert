/// <reference lib="webworker" />

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  StreamTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import {
  explainMediaError,
  getFormat,
  isAudioFormat,
  MAX_LOCAL_BYTES,
  MAX_STREAMING_BYTES,
} from "./converter-contract";
import type {
  ConvertRequest, FormatId, MediaInfo, WorkerRequest, WorkerResponse,
} from "./converter-contract";
import { TEMP_EXPORT_DIR, isTemporaryExportKey } from "./output-storage";

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Each conversion runs in its own worker: the parent can terminate it
 * immediately, freeing the pipeline without blocking the UI.
 * No data is transmitted to a service or remote endpoint.
 */
function send(message: WorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

async function supportsDiskTarget(fileBytes: number): Promise<boolean> {
  try {
    if (!navigator.storage?.getDirectory) return false;
    const estimated = await navigator.storage.estimate();
    if (Number.isFinite(estimated.quota) && Number.isFinite(estimated.usage) &&
        (estimated.quota ?? 0) - (estimated.usage ?? 0) < fileBytes) return false;
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(TEMP_EXPORT_DIR, { create: true });
    const key = "probe-" + crypto.randomUUID();
    const handle = await directory.getFileHandle(key, { create: true });
    try {
      const writable = await handle.createWritable();
      await writable.close();
      return true;
    } finally {
      await directory.removeEntry(key).catch(() => {});
    }
  } catch {
    return false;
  }
}

function makeInput(file: File): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
}

async function inspect(file: File): Promise<MediaInfo> {
  const input = makeInput(file);
  if (!(await input.canRead())) throw new Error("Unreadable or unsupported media format");
  const [video, audio, sourceFormat, duration] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
    input.getFormat(),
    input.getDurationFromMetadata(),
  ]);
  if (!video && !audio) throw new Error("Invalid media file: no audio or video tracks");

  const [width, height, videoCodec, audioCodec, canDecodeVideo, canDecodeAudio] = await Promise.all([
    video ? video.getDisplayWidth() : Promise.resolve(null),
    video ? video.getDisplayHeight() : Promise.resolve(null),
    video ? video.getCodec() : Promise.resolve(null),
    audio ? audio.getCodec() : Promise.resolve(null),
    video ? video.canDecode().catch(() => false) : Promise.resolve(false),
    audio ? audio.canDecode().catch(() => false) : Promise.resolve(false),
  ]);
  // This preflight measures the active browser rather than relying on a UA list.
  // Bundled AAC/MP3/FLAC encoders are loaded on demand at conversion time.
  const [avc, vp9, opus] = await Promise.all([
    video ? canEncodeVideo("avc").catch(() => false) : Promise.resolve(false),
    video ? canEncodeVideo("vp9").catch(() => false) : Promise.resolve(false),
    audio ? canEncodeAudio("opus").catch(() => false) : Promise.resolve(false),
  ]);
  return {
    container: sourceFormat.constructor.name.replace(/InputFormat$/, "").toUpperCase(),
    duration: duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null,
    width, height, videoCodec, audioCodec,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    canDecodeVideo,
    canDecodeAudio,
    fileBytes: file.size,
    streamingAvailable: await supportsDiskTarget(file.size),
    encoderSupport: { avc, vp9, opus },
  };
}

async function loadEncoder(id: FormatId): Promise<void> {
  if (id === "mp3" && !(await canEncodeAudio("mp3"))) {
    const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
    registerMp3Encoder();
  }
  if (id === "flac" && !(await canEncodeAudio("flac"))) {
    const { registerFlacEncoder } = await import("@mediabunny/flac-encoder");
    registerFlacEncoder();
  }
  if ((id === "mp4" || id === "mov") && !(await canEncodeAudio("aac"))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }
}

function makeFormat(id: FormatId, streaming: boolean) {
  switch (id) {
    // Never use in-memory faststart for a streaming target: it buffers media
    // until finalization. Non-faststart is seekable and keeps memory bounded.
    case "mp4": return new Mp4OutputFormat({ fastStart: streaming ? false : "in-memory" });
    case "webm": return new WebMOutputFormat();
    case "mov": return new MovOutputFormat({ fastStart: streaming ? false : "in-memory" });
    case "mp3": return new Mp3OutputFormat();
    case "wav": return new WavOutputFormat();
    case "flac": return new FlacOutputFormat();
  }
}

async function convert(request: ConvertRequest): Promise<void> {
  if (request.file.size > MAX_STREAMING_BYTES) throw new Error("The file is larger than the experimental disk-backed limit");
  if (!isTemporaryExportKey(request.storageKey) || !request.storageKey.endsWith("." + request.preset)) {
    throw new Error("Invalid temporary output key");
  }
  send({ type: "stage", id: request.id, stage: "preparing" });
  const input = makeInput(request.file);
  if (!(await input.canRead())) throw new Error("Unreadable media input");
  const [sourceVideo, sourceAudio] = await Promise.all([
    input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack(),
  ]);
  const audioOnly = isAudioFormat(request.preset);
  if (audioOnly && !sourceAudio) throw new Error("No audio track");
  if (!audioOnly && !sourceVideo) throw new Error("No video track");

  await loadEncoder(request.preset);
  const streaming = await supportsDiskTarget(request.file.size);
  if (!streaming && request.file.size > MAX_LOCAL_BYTES) {
    throw new Error("Disk-backed conversion is unavailable or storage quota is too small");
  }
  const format = makeFormat(request.preset, streaming);
  let diskDirectory: FileSystemDirectoryHandle | null = null;
  let diskHandle: FileSystemFileHandle | null = null;
  const memory = streaming ? null : new BufferTarget();
  if (streaming) {
    const root = await navigator.storage.getDirectory();
    diskDirectory = await root.getDirectoryHandle(TEMP_EXPORT_DIR, { create: true });
    diskHandle = await diskDirectory.getFileHandle(request.storageKey, { create: true });
  }
  let finished = false;
  try {
    const writable = diskHandle ? await diskHandle.createWritable() : null;
    const target = writable
      ? new StreamTarget(writable, { chunked: true, chunkSize: 1024 * 1024 })
      : memory!;
    const output = new Output({ format, target });
  const quality = request.quality === "source" ? undefined
    : new Quality(request.quality === "compact" ? "medium" : "high");
  const resize = !audioOnly && sourceVideo && request.height !== "original"
    ? Math.min(await sourceVideo.getDisplayHeight(), Number(request.height))
    : null;

  const conversion = await Conversion.init({
    input, output,
    tracks: "primary",
    video: audioOnly
      ? { discard: true }
      : {
          codec: request.preset === "webm" ? "vp9" : "avc",
          ...(quality ? { quality } : {}),
          ...(resize ? { height: resize } : {}),
        },
    audio: sourceAudio
      ? {
          codec: request.preset === "webm" ? "opus"
            : request.preset === "mp3" ? "mp3"
            : request.preset === "flac" ? "flac"
            : request.preset === "wav" ? "pcm-s16"
            : "aac",
          ...(!audioOnly && quality ? { quality } : {}),
        }
      : { discard: true },
  });

  const retainedVideo = conversion.utilizedTracks.some((track) => track.type === "video");
  const retainedAudio = conversion.utilizedTracks.some((track) => track.type === "audio");
  if (!conversion.isValid || (!audioOnly && !retainedVideo) ||
      (audioOnly && !retainedAudio) || (sourceAudio && !retainedAudio)) {
    const reasons = conversion.discardedTracks.map((discarded) => discarded.reason).join(", ");
    throw new Error(["Unsupported codec:", reasons || "No compatible encoder on this device"].join(" "));
  }

  conversion.onProgress = (progress: number) => {
    if (Number.isFinite(progress) && progress >= 0 && progress <= 1) {
      send({ type: "progress", id: request.id, progress });
    }
  };
  send({ type: "stage", id: request.id, stage: "converting" });
  await conversion.execute();
  send({ type: "stage", id: request.id, stage: "verifying" });

  const outputBlob = memory
    ? (memory.buffer ? new Blob([memory.buffer], { type: format.mimeType }) : null)
    : await diskHandle!.getFile();
  if (!outputBlob || outputBlob.size < 64) throw new Error("Invalid empty conversion output");
  // Verify the completed file from disk rather than reassembling it in RAM.
  const verification = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(outputBlob),
  });
  if (!(await verification.canRead())) throw new Error("Invalid output after encoding");
  const [video, audio] = await Promise.all([
    verification.getPrimaryVideoTrack(), verification.getPrimaryAudioTrack(),
  ]);
  if ((!audioOnly && !video) || (audioOnly && !audio) || (sourceAudio && !audio)) {
    throw new Error("Invalid output: expected media tracks were lost");
  }
  if (video && !audioOnly) {
    const actual = await video.getCodec();
    if (actual !== (request.preset === "webm" ? "vp9" : "avc")) {
      throw new Error("Invalid output video codec");
    }
  }
  if (audio && audioOnly) {
    const actual = await audio.getCodec();
    if (actual !== (request.preset === "wav" ? "pcm-s16" : request.preset)) {
      throw new Error("Invalid output audio codec");
    }
  }

  const mime = getFormat(request.preset).mime;
  if (memory) {
    const buffer = memory.buffer;
    if (!buffer || buffer.byteLength < 64) throw new Error("Invalid empty conversion output");
    send({ type: "complete", id: request.id, buffer, mime,
      extension: request.preset, bytes: buffer.byteLength }, [buffer]);
  } else {
    const file = await diskHandle!.getFile();
    send({ type: "complete", id: request.id, file, storageKey: request.storageKey,
      mime, extension: request.preset, bytes: file.size });
  }
  finished = true;
  } finally {
    if (!finished && diskDirectory) {
      await diskDirectory.removeEntry(request.storageKey).catch(() => {});
    }
  }
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const handle = async () => {
    try {
      if (request.type === "inspect") {
        const info = await inspect(request.file);
        send({ type: "inspected", id: request.id, info });
      } else {
        await convert(request);
      }
    } catch (error) {
      send({ type: "error", id: request.id, message: explainMediaError(error) });
    }
  };
  void handle();
};
