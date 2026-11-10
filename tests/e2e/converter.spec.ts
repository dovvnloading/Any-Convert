import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const fixtureRoot = resolve("tests/fixtures/generated");

async function inspectDownload(download: import("@playwright/test").Download, expectedCodec: string) {
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
  await inspectDownload(await downloadPromise, "h264");
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
  await expect(page.getByRole("alert")).toContainText(/couldn't read|format not supported/i, { timeout: 60_000 });
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
