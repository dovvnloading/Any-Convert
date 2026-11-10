import { describe, expect, it } from "vitest";
import { selectPastedMediaFiles } from "./clipboard-media";

const file = (name: string, type = "") => new File(["sample"], name, { type });

describe("clipboard media selection", () => {
  it("accepts audio/video MIME types and generic-MIME files with media extensions", () => {
    const video = file("copied-video", "video/mp4");
    const audio = file("voice.wav", "application/octet-stream");
    const mkv = file("movie.MKV", "");
    expect(selectPastedMediaFiles([video, audio, mkv])).toEqual([video, audio, mkv]);
  });

  it("ignores text, screenshots, documents and unrecognized blobs", () => {
    const mp3 = file("track.mp3", "audio/mpeg");
    expect(selectPastedMediaFiles([
      file("note.txt", "text/plain"),
      file("screenshot.png", "image/png"),
      file("invoice.pdf", "application/pdf"),
      file("blob", "application/octet-stream"),
      mp3,
    ])).toEqual([mp3]);
    expect(selectPastedMediaFiles([])).toEqual([]);
  });

  it("preserves the original order for multi-file clipboard batches", () => {
    const first = file("one.mp4", "video/mp4");
    const second = file("two.flac", "audio/flac");
    expect(selectPastedMediaFiles([first, file("readme.md"), second])).toEqual([first, second]);
  });
});
