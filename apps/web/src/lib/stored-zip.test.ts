import { describe, expect, it } from "vitest";
import {
  MAX_ZIP_CONTENT_BYTES, MAX_ZIP_ITEMS, planStoredZip, sanitizeZipEntryName, zipCrc32,
} from "./stored-zip";

describe("bounded stored ZIP export packs", () => {
  it("matches the well-known CRC32 reference", () => {
    expect(zipCrc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(zipCrc32(new Uint8Array())).toBe(0);
  });
  it("sanitizes archive paths and resolves collisions without directory traversal", () => {
    expect(sanitizeZipEntryName("../private\\clip.mp4")).not.toContain("/");
    const a = new Blob(["first"]);
    const b = new Blob(["second"]);
    const plan = planStoredZip([{ name: "clip.mp4", blob: a }, { name: "clip.mp4", blob: b }]);
    expect(plan.entries.map((item) => item.name)).toEqual(["clip.mp4", "2-clip.mp4"]);
    expect(plan.totalBytes).toBe(11);
    const collision = planStoredZip([
      { name: "a.mp4", blob: a }, { name: "a.mp4", blob: b },
      { name: "2-a.mp4", blob: a },
    ]);
    expect(new Set(collision.entries.map((entry) => entry.name)).size).toBe(3);
  });
  it("rejects empty and unsafe-sized export packs", () => {
    expect(() => planStoredZip([])).toThrow();
    expect(() => planStoredZip([{ name: "empty", blob: new Blob() }])).toThrow();
    expect(() => planStoredZip(Array.from({ length: MAX_ZIP_ITEMS + 1 }, (_, i) => ({
      name: String(i), blob: new Blob(["x"]),
    })))).toThrow();
    expect(() => planStoredZip([{ name: "oversize", blob: { size: MAX_ZIP_CONTENT_BYTES + 1 } as Blob }])).toThrow();
  });
});
