import { describe, expect, it } from "vitest";
import { FORMATS, MAX_LOCAL_BYTES, explainMediaError, getFormat, safeOutputName, validFormats, validProgress } from "./converter-contract";
import type { MediaInfo } from "./converter-contract";

const sample: MediaInfo = {
  container: "mp4", duration: 1.2, width: 1920, height: 1080,
  videoCodec: "avc", audioCodec: "aac", hasVideo: true, hasAudio: true,
  canDecodeVideo: true, canDecodeAudio: true,
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
  });
  it("produces a filename with a safe extension", () => {
    expect(safeOutputName("my.very.long.mov", "mp4")).toBe("my.very.long-converted.mp4");
    expect(safeOutputName("bad/name:evil?.mkv", "mp3")).toBe("bad-name-evil--converted.mp3");
    expect(getFormat("wav").mime).toBe("audio/wav");
  });
  it("never treats 100% progress as completion", () => {
    expect(validProgress(1)).toBe(99);
    expect(validProgress(0.503)).toBe(50);
    expect(validProgress(NaN)).toBeNull();
    expect(validProgress(-0.1)).toBeNull();
  });
  it("does not leak internal exception text", () => {
    expect(explainMediaError(new Error("Codec cannot decode secret/test.mp4"))).not.toContain("secret");
    expect(explainMediaError(new Error("unexpected private stack detail"))).not.toContain("private");
  });
});
