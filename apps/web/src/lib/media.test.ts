import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, isPotentialVideo } from "./media";

describe("metadata formatters", () => {
  it("formats bytes without inventing unknown values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(-1)).toBe("Unknown size");
    expect(formatBytes(Number.NaN)).toBe("Unknown size");
  });
  it("formats duration with hours when needed", () => {
    expect(formatDuration(65.9)).toBe("01:05");
    expect(formatDuration(3601)).toBe("01:00:01");
    expect(formatDuration(Infinity)).toBe("Unknown duration");
  });
  it("allows plausible videos without pretending to validate their bytes", () => {
    expect(isPotentialVideo({ name: "clip.MKV", type: "", size: 20 })).toBe(true);
    expect(isPotentialVideo({ name: "clip.xyz", type: "video/mp4", size: 20 })).toBe(true);
    expect(isPotentialVideo({ name: "clip.pdf", type: "application/pdf", size: 20 })).toBe(false);
    expect(isPotentialVideo({ name: "clip.mp4", type: "video/mp4", size: 0 })).toBe(false);
  });
});
