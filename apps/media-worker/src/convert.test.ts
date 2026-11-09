import { describe, expect, it } from "vitest";
import { buildUniversalMp4Args } from "./convert";
import { parseProbe, verifyUniversalMp4 } from "./probe";

const valid = JSON.stringify({
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.033" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 320, height: 180 },
    { index: 1, codec_type: "audio", codec_name: "aac", channels: 1 },
  ],
});

describe("native conversion plan", () => {
  it("selects fixed codecs, no shell, one track and size-safe padding", () => {
    const args = buildUniversalMp4Args("clip.mkv", "temp.mp4");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("0:v:0");
    expect(args).toContain("0:a:0?");
    expect(args).toContain("pad=ceil(iw/2)*2:ceil(ih/2)*2");
    expect(args[args.length - 1]).toBe("temp.mp4");
  });
  it("parses real probe representation", () => {
    const probe = parseProbe(valid);
    expect(probe.container).toContain("mp4");
    expect(probe.durationSeconds).toBeCloseTo(1.033);
    expect(probe.streams).toHaveLength(2);
    expect(() => verifyUniversalMp4(probe)).not.toThrow();
  });
  it("rejects wrong codec, odd dimensions, and missing metadata", () => {
    const probe = parseProbe(valid);
    expect(() => verifyUniversalMp4({ ...probe, streams: [{ index: 0, codecType: "video", codecName: "hevc", width: 320, height: 180 }] })).toThrow();
    expect(() => verifyUniversalMp4({ ...probe, streams: [{ index: 0, codecType: "video", codecName: "h264", width: 319, height: 180 }] })).toThrow();
    expect(() => parseProbe("{}")).toThrow();
  });
});
