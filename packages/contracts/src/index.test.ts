import { describe, expect, it } from "vitest";
import { assertProgress, canTransition, isJobState } from "./index";

describe("media job contract", () => {
  it("permits only defined transitions", () => {
    expect(canTransition("created", "probing")).toBe(true);
    expect(canTransition("processing", "ready")).toBe(false);
    expect(canTransition("ready", "expired")).toBe(true);
    expect(canTransition("failed", "processing")).toBe(false);
  });
  it("rejects fabricated progress", () => {
    expect(() => assertProgress(0.6)).not.toThrow();
    expect(() => assertProgress(undefined)).not.toThrow();
    for (const number of [NaN, Infinity, -0.2, 1.01]) {
      expect(() => assertProgress(number)).toThrow(RangeError);
    }
  });
  it("validates states from untrusted payloads", () => {
    expect(isJobState("queued")).toBe(true);
    expect(isJobState("readyish")).toBe(false);
  });
});
