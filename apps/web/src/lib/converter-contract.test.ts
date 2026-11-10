import { describe, expect, it } from "vitest";
import { FORMATS, MAX_LOCAL_BYTES, MediaCapabilityError, explainConversionPlanFailure, explainMediaError, getFormat, planVideoOutputGeometry, safeOutputName, validFormats, validProgress } from "./converter-contract";
import type { MediaInfo } from "./converter-contract";

const sample: MediaInfo = {
  container: "mp4", duration: 1.2, width: 1920, height: 1080,
  videoCodec: "avc", audioCodec: "aac", hasVideo: true, hasAudio: true,
  canDecodeVideo: true, canDecodeAudio: true, fileBytes: 1_000_000, streamingAvailable: false,
};

describe("conversion plans", () => {
  it("limits local input size", () => {
    expect(MAX_LOCAL_BYTES).toBe(268435456);
  });
  it("limits presets by actual available tracks", () => {
    expect(validFormats(sample)).toEqual(FORMATS.map((f) => f.id));
    expect(validFormats({ ...sample, hasAudio: false })).toEqual(["mp4","webm","mov"]);
    expect(validFormats({ ...sample, hasVideo: false })).toEqual(["mp3","wav","flac"]);
    expect(validFormats({ ...sample, hasVideo: false, hasAudio: false })).toEqual([]);
    expect(validFormats({ ...sample, canDecodeVideo: false })).toEqual(["mp3", "wav", "flac"]);
    expect(validFormats({ ...sample, canDecodeAudio: false })).toEqual([]);
    expect(validFormats({ ...sample, canDecodeAudio: false }, { withoutAudio: true }))
      .toEqual(["mp4", "webm", "mov"]);
    expect(validFormats({ ...sample, canDecodeVideo: false }, { withoutAudio: true })).toEqual([]);
    expect(validFormats({ ...sample, hasVideo: false }, { withoutAudio: true }))
      .toEqual(["mp3", "wav", "flac"]);
    expect(validFormats({ ...sample, fileBytes: MAX_LOCAL_BYTES + 1 })).toEqual([]);
    expect(validFormats({ ...sample, fileBytes: MAX_LOCAL_BYTES + 1, streamingAvailable: true }))
      .toEqual(FORMATS.map((format) => format.id));
    expect(validFormats({ ...sample, encoderSupport: { vp9: false } })).toEqual(["mp4", "mov", "mp3", "wav", "flac"]);
  });
  it("produces a filename with a safe extension", () => {
    expect(safeOutputName("my.very.long.mov", "mp4")).toBe("my.very.long-converted.mp4");
    expect(safeOutputName("my.very.long.mov", "mp4", true)).toBe("my.very.long-no-audio-converted.mp4");
    expect(safeOutputName("bad/name:evil?.mkv", "mp3")).toBe("bad-name-evil--converted.mp3");
    expect(getFormat("wav").mime).toBe("audio/wav");
  });
  it("never treats 100% progress as completion", () => {
    expect(validProgress(1)).toBe(99);
    expect(validProgress(0.503)).toBe(50);
    expect(validProgress(NaN)).toBeNull();
    expect(validProgress(-0.1)).toBeNull();
  });
  it("explains an unsupported input decoder instead of suggesting an unrelated output preset", () => {
    const message = explainConversionPlanFailure("mp4", [
      { track: "video", reason: "undecodable_source_codec", codec: "hevc" },
    ]);
    expect(message).toContain("H.265/HEVC video");
    expect(message).toContain("Changing the output format will not add a missing decoder");
    expect(explainMediaError(new MediaCapabilityError(message))).toBe(message);
  });
  it("distinguishes an unavailable output encoder, unknown input, and uncopyable track", () => {
    expect(explainConversionPlanFailure("mp4", [
      { track: "audio", reason: "no_encodable_target_codec", codec: "aac" },
    ])).toContain("cannot encode the audio track required for MP4");
    expect(explainConversionPlanFailure("webm", [
      { track: "video", reason: "unknown_source_codec", codec: null },
    ])).toContain("video codec is unknown");
    expect(explainConversionPlanFailure("mov", [
      { track: "video", reason: "cannot_copy", codec: "avc" },
    ])).toContain("cannot be copied into MOV");
    expect(explainConversionPlanFailure("mp3", [
      { track: "video", reason: "discarded_by_user", codec: "avc" },
    ])).toContain("cannot build a valid MP3");
  });
  it("never exposes internal metadata while forming a codec diagnostic", () => {
    expect(explainConversionPlanFailure("mp4", [
      { track: "video", reason: "undecodable_source_codec", codec: "/private/file/secret" },
    ])).not.toContain("secret");
  });
  it("pads odd screen-capture dimensions for H.264 without cropping the source", () => {
    expect(planVideoOutputGeometry(161, 91, "original", "mp4"))
      .toEqual({ width: 162, height: 92, fit: "contain" });
    expect(planVideoOutputGeometry(853, 480, "original", "mov"))
      .toEqual({ width: 854, height: 480, fit: "contain" });
    expect(planVideoOutputGeometry(1920, 1080, "720", "mp4")).toEqual({ height: 720 });
    expect(planVideoOutputGeometry(1920, 1080, "original", "mp4")).toEqual({});
    expect(planVideoOutputGeometry(161, 91, "original", "webm")).toEqual({});
    expect(planVideoOutputGeometry(161, 91, "original", "mp3")).toEqual({});
    expect(planVideoOutputGeometry(0, 91, "original", "mp4")).toEqual({});
  });
  it("does not leak internal exception text", () => {
    expect(explainMediaError(new Error("Codec cannot decode secret/test.mp4"))).not.toContain("secret");
    expect(explainMediaError(new Error("unexpected private stack detail"))).not.toContain("private");
  });
});
