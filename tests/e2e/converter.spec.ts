import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { pasteFixtureFiles } from "./clipboard";

const fixtureRoot = resolve("tests/fixtures/generated");

async function inspectDownload(download: import("@playwright/test").Download, expectedCodec: string, additionalCodec?: string) {
  const temp = await mkdtemp(join(tmpdir(), "any-convert-playwright-"));
  try {
    const file = join(temp, download.suggestedFilename());
    await download.saveAs(file);
    const bytes = await readFile(file);
    expect(bytes.byteLength).toBeGreaterThan(128);
    const json = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_name,codec_type",
      "-of", "json", file,
    ], { encoding: "utf8" }));
    expect(json.streams.some((track: { codec_name: string }) => track.codec_name === expectedCodec)).toBeTruthy();
    if (additionalCodec) {
      expect(json.streams.some((track: { codec_name: string }) => track.codec_name === additionalCodec)).toBeTruthy();
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test("video is inspected, remuxed to MOV, verified and downloaded", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Goodbye, format friction/ })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(join(fixtureRoot, "baseline-h264-aac.mp4"));
  await expect(page.getByRole("button", { name: "Convert MP4" })).toBeEnabled({ timeout: 60_000 });
  await page.locator("label.format-option").filter({ hasText: "MOV" }).click();
  await page.getByRole("button", { name: "Convert MOV" }).click();
  const downloadLink = page.getByRole("link", { name: /Download .*mov/i });
  await expect(downloadLink).toBeVisible({ timeout: 100_000 });
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  await inspectDownload(await downloadPromise, "h264", "aac");
});

test("VP9 and Opus WebM becomes a verified H.264 and AAC MP4, without upload", async ({ page }) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" || request.method() === "PUT") uploads.push(request.url());
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(join(fixtureRoot, "webm-vp9-opus.webm"));
  await expect(page.getByText(/Video: VP9/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Audio: OPUS/)).toBeVisible();
  const convert = page.getByRole("button", { name: "Convert MP4" });
  await expect(convert).toBeEnabled({ timeout: 60_000 });
  await convert.click();
  const downloadLink = page.getByRole("link", { name: /Download.*webm-vp9-opus-converted\.mp4/i });
  await expect(downloadLink).toBeVisible({ timeout: 120_000 });
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  await inspectDownload(await downloadPromise, "h264", "aac");
  expect(uploads).toEqual([]);
});

test("odd-size VP9 Opus WebM converts to MP4 with correctly encoded video and audio", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(join(fixtureRoot, "odd-vp9-opus.webm"));
  const convert = page.getByRole("button", { name: "Convert MP4" });
  await expect(convert).toBeEnabled({ timeout: 60_000 });
  await convert.click();
  const link = page.getByRole("link", { name: /Download.*odd-vp9-opus-converted\.mp4/i });
  await expect(link).toBeVisible({ timeout: 120_000 });
  const download = page.waitForEvent("download");
  await link.click();
  await inspectDownload(await download, "h264", "aac");
});

test("video with AC-3 audio can be exported without sound, with actual codec verification", async ({ page }) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" || request.method() === "PUT") uploads.push(request.url());
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(join(fixtureRoot, "mkv-h264-ac3.mkv"));
  const silent = page.getByRole("checkbox", { name: /Export video without audio/i });
  await expect(silent).toBeVisible({ timeout: 60_000 });
  await expect(silent).not.toBeChecked();
  await silent.check();
  const convert = page.getByRole("button", { name: "Convert MP4" });
  await expect(convert).toBeEnabled();
  await convert.click();
  const link = page.getByRole("link", { name: /Download.*no-audio-converted\.mp4/i });
  await expect(link).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Verified output.*video only.*no audio/i)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  const temp = await mkdtemp(join(tmpdir(), "any-convert-silent-"));
  try {
    const output = join(temp, "video-only.mp4");
    await download.saveAs(output);
    const streams = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_name,codec_type",
      "-of", "json", output,
    ], { encoding: "utf8" })).streams as { codec_name: string; codec_type: string }[];
    expect(streams.filter((s) => s.codec_type === "video").map((s) => s.codec_name)).toEqual(["h264"]);
    expect(streams.filter((s) => s.codec_type === "audio")).toEqual([]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  expect(uploads).toEqual([]);
});

test("pasting a media file imports it without hijacking text fields", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const textarea = document.createElement("textarea");
    textarea.id = "paste-text-field";
    document.body.append(textarea);
    textarea.focus();
  });
  const video = { path: join(fixtureRoot, "baseline-h264-aac.mp4"), mime: "video/mp4" };
  await pasteFixtureFiles(page, [video], "#paste-text-field");
  await expect(page.getByRole("heading", { name: "Drop something good." })).toBeVisible();

  // Plain clipboard text must not be consumed by the media importer.
  const consumedText = await page.evaluate(() => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "not a media file");
    const event = new ClipboardEvent("paste", {
      bubbles: true, cancelable: true, clipboardData: clipboard,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(consumedText).toBe(false);
  await pasteFixtureFiles(page, [video]);
  await expect(page.getByRole("button", { name: "Convert MP4" })).toBeEnabled({ timeout: 60_000 });
});

test("audio extracts to real MP3 in browser", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(join(fixtureRoot, "pcm-audio.wav"));
  await expect(page.getByRole("button", { name: "Convert MP3" })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: "Convert MP3" }).click();
  const downloadLink = page.getByRole("link", { name: /Download .*mp3/i });
  await expect(downloadLink).toBeVisible({ timeout: 100_000 });
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  await inspectDownload(await downloadPromise, "mp3");
});

test("invalid input is rejected without showing a false success", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "broken.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("this-is-not-a-media-container"),
  });
  await expect(page.locator(".error-message")).toContainText(/couldn.t complete/i, { timeout: 60_000 });
  await expect(page.getByRole("link", { name: /Download.*MP4/i })).toHaveCount(0);
});

test("mobile layout keeps import action accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const importButton = page.getByRole("button", { name: /Choose a file/i });
  await expect(importButton).toBeVisible();
  await expect(importButton).toBeEnabled();
  await expect(page.locator(".main-content")).toBeVisible();
});


test("streaming output is independently verified and temporary storage clears on reset", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(join(fixtureRoot, "baseline-h264-aac.mp4"));
  await expect(page.getByRole("button", { name: "Convert MP4" })).toBeEnabled({ timeout: 60_000 });
  const supported = await page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("any-convert-temporary-exports", { create: true });
      const probe = await dir.getFileHandle("probe-ui", { create: true });
      await (await probe.createWritable()).close();
      await dir.removeEntry("probe-ui");
      return true;
    } catch { return false; }
  });
  await page.getByRole("button", { name: "Convert MP4" }).click();
  await expect(page.getByRole("link", { name: /Download .*mp4/i })).toBeVisible({ timeout: 100_000 });
  if (supported) {
    await expect.poll(async () => page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("any-convert-temporary-exports");
      const names = [];
      for await (const [name] of dir.entries()) if (name.startsWith("ac-")) names.push(name);
      return names.length;
    })).toBe(1);
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download .*mp4/i }).click();
  await inspectDownload(await downloadPromise, "h264");
  await page.getByRole("button", { name: /Convert another format/i }).click();
  if (supported) {
    await expect.poll(async () => page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("any-convert-temporary-exports");
      const names = [];
      for await (const [name] of dir.entries()) if (name.startsWith("ac-")) names.push(name);
      return names.length;
    })).toBe(0);
  }
});
