import { describe, expect, it } from "vitest";
import {
  BROWSER_FORMATS, FORMAT_CATALOG, FORMAT_IDS, NATIVE_FORMATS,
  REGISTRY_VERSION, createRecipe, planMediaExports, recommendFormat,
  toBrowserSettings, toNativeSettings,
} from "./index";
import type { MediaFacts, NativeCapabilities } from "./index";

const sample: MediaFacts = {
  sizeBytes: 12_000_000, durationSeconds: 50, width: 1920, height: 1080,
  videoCodec: "avc", audioCodec: "aac",
  hasVideo: true, hasAudio: true, canDecodeVideo: true, canDecodeAudio: true,
  encoderSupport: { avc: true, vp9: false, opus: true },
};
const native: NativeCapabilities = {
  available: true, maxUploadBytes: 512 * 1024 * 1024,
  maxDurationSeconds: 600, maxDimension: 3840,
  formats: ["mp4", "webm", "mov", "mp3", "wav", "flac", "gif"],
};
const evaluate = (media: MediaFacts = sample, server?: NativeCapabilities) =>
  planMediaExports(media, { localMaxBytes: 256 * 1024 * 1024, ...(server ? { native: server } : {}) });
const find = (plans: ReturnType<typeof evaluate>, id: string) => {
  const plan = plans.find((p) => p.format.id === id);
  if (!plan) throw new Error("Missing test plan");
  return plan;
};

describe("shared media capability and recipe core", () => {
  it("has a unique, versioned registry and explicit engine coverage", () => {
    expect(REGISTRY_VERSION).toBe(1);
    expect(FORMAT_CATALOG.map((x) => x.id)).toEqual(FORMAT_IDS);
    expect(BROWSER_FORMATS.map((x) => x.id)).toEqual(["mp4", "webm", "mov", "mp3", "wav", "flac"]);
    expect(NATIVE_FORMATS.map((x) => x.id)).toEqual(FORMAT_IDS);
    expect(new Set(FORMAT_CATALOG.map((x) => x.id)).size).toBe(FORMAT_CATALOG.length);
  });
  it("recommends the local universal format without inventing a native service", () => {
    const plans = evaluate();
    expect(recommendFormat(plans, sample)).toBe("mp4");
    expect(find(plans, "mp4").browser.status).toBe("needs-check");
    expect(find(plans, "mp4").recommendedEngine).toBe("browser");
    expect(find(plans, "mp4").native.status).toBe("blocked");
    expect(find(plans, "mp4").requiresUploadConsent).toBe(false);
  });
  it("blocks absent and undecodable tracks rather than guessing from extensions", () => {
    const silent = { ...sample, hasAudio: false, audioCodec: null };
    expect(find(evaluate(silent), "mp3").browser.reasons).toContain("no-audio");
    expect(find(evaluate(silent), "mp4").browser.status).toBe("ready");
    const unplayable = { ...sample, canDecodeVideo: false };
    expect(find(evaluate(unplayable), "mp4").browser.status).toBe("blocked");
    expect(find(evaluate(unplayable, native), "mp4").recommendedEngine).toBe("native");
    expect(find(evaluate(unplayable, native), "mp4").requiresUploadConsent).toBe(true);
  });
  it("uses measured codec capability and does not promise unsupported VP9", () => {
    const plans = evaluate(sample);
    expect(find(plans, "webm").browser.reasons).toContain("video-encoder-unavailable");
    const sameCodec = evaluate({ ...sample, encoderSupport: { avc: false, vp9: false } });
    expect(find(sameCodec, "mp4").browser.status).toBe("needs-check");
    expect(find(sameCodec, "mp4").browser.reasons).toContain("stream-copy-unverified");
  });
  it("enforces independent local/native size, duration and dimension gates", () => {
    const huge = { ...sample, sizeBytes: 300 * 1024 * 1024 };
    expect(find(evaluate(huge, native), "mp4").browser.reasons).toContain("local-size-limit");
    expect(find(evaluate(huge, native), "mp4").recommendedEngine).toBe("native");
    const tooLarge = { ...sample, sizeBytes: native.maxUploadBytes + 1 };
    expect(find(evaluate(tooLarge, native), "mp4").recommendedEngine).toBeNull();
    const tooLong = { ...sample, durationSeconds: 700 };
    expect(find(evaluate(tooLong, native), "mp4").native.reasons).toContain("native-duration-limit");
    const tooWide = { ...sample, width: 9000 };
    expect(find(evaluate(tooWide, native), "mp4").native.reasons).toContain("native-dimension-limit");
  });
  it("allows audio-only files and keeps native probe results provisional", () => {
    const audio = { ...sample, hasVideo: false, width: null, height: null, videoCodec: null };
    expect(recommendFormat(evaluate(audio), audio)).toBe("mp3");
    expect(find(evaluate(audio), "mp4").browser.status).toBe("blocked");
    expect(find(evaluate(audio, native), "flac").native.status).toBe("needs-check");
  });
  it("validates intent-level recipes and maps to fixed engine options", () => {
    const recipe = createRecipe("mp4", "smaller", 720);
    expect(recipe).toEqual({ version: 1, format: "mp4", quality: "smaller", maxHeight: 720 });
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(toBrowserSettings(recipe)).toEqual({ preset: "mp4", quality: "compact", height: "720" });
    expect(toNativeSettings(recipe)).toEqual({ format: "mp4", quality: "small", height: 720 });
    expect(toNativeSettings(createRecipe("flac", "preserve"))).toEqual({
      format: "flac", quality: "high", height: null,
    });
    expect(() => createRecipe("mp4;cat /etc/passwd")).toThrow(/Unsupported format/);
    expect(() => createRecipe("mp4", "lossless")).toThrow(/Unsupported quality/);
    expect(() => createRecipe("mp4", "balanced", 16000)).toThrow(/Unsupported height/);
    expect(() => toBrowserSettings(createRecipe("gif"))).toThrow(/Not a browser/);
  });
});
