import type { MediaProbe, MediaStream } from "@any-convert/contracts";
import { runCommand, type RunOptions } from "./process";

type RawStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
};

type RawProbe = {
  format?: { format_name?: string; duration?: string };
  streams?: RawStream[];
};

function streamType(raw: string | undefined): MediaStream["codecType"] {
  if (raw === "video" || raw === "audio" || raw === "subtitle" || raw === "data" || raw === "attachment") return raw;
  return "unknown";
}

export function parseProbe(json: string): MediaProbe {
  const raw = JSON.parse(json) as RawProbe;
  if (!raw || !Array.isArray(raw.streams) || !raw.format?.format_name) {
    throw new Error("ffprobe returned incomplete format or stream information.");
  }
  const seconds = Number(raw.format.duration);
  const durationSeconds = raw.format.duration && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  return {
    container: raw.format.format_name,
    durationSeconds,
    streams: raw.streams.map((stream, index) => {
      const result: MediaStream = {
        index: stream.index ?? index,
        codecType: streamType(stream.codec_type),
        codecName: stream.codec_name ?? "unknown",
      };
      if (typeof stream.width === "number") result.width = stream.width;
      if (typeof stream.height === "number") result.height = stream.height;
      if (typeof stream.channels === "number") result.channels = stream.channels;
      return result;
    }),
  };
}

export async function probeMedia(path: string, options?: RunOptions): Promise<MediaProbe> {
  const result = await runCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "format=format_name,duration:stream=index,codec_type,codec_name,width,height,channels",
    "-of", "json",
    path,
  ], options);
  return parseProbe(result.stdout);
}

export function verifyUniversalMp4(media: MediaProbe): void {
  if (!media.container.split(",").includes("mp4") && !media.container.split(",").includes("mov")) {
    throw new Error("Expected an MP4 container.");
  }
  const videos = media.streams.filter((stream) => stream.codecType === "video");
  if (videos.length !== 1 || videos[0]?.codecName !== "h264") {
    throw new Error("Expected exactly one H.264 video stream.");
  }
  const video = videos[0];
  if (!video?.width || !video.height || video.width % 2 || video.height % 2) {
    throw new Error("Expected nonzero even video dimensions.");
  }
  const audio = media.streams.filter((stream) => stream.codecType === "audio");
  if (audio.length > 1 || audio.some((stream) => stream.codecName !== "aac")) {
    throw new Error("Expected at most one AAC audio stream.");
  }
  if (media.durationSeconds === null || media.durationSeconds <= 0) {
    throw new Error("Expected positive media duration.");
  }
}
