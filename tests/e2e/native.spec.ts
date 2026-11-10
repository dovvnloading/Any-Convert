import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const fixtures = resolve("tests/fixtures/generated");

test("self-hosted GIF conversion requires consent and yields actual GIF output", async ({ page }) => {
  await page.goto("/native");
  await expect(page.getByRole("heading", { name: /Built to be yours/ })).toBeVisible();
  const button = page.getByRole("button", { name: "Convert to MP4" });
  await expect(button).toBeDisabled();
  await page.locator('input[type="file"]').setInputFiles(join(fixtures, "baseline-h264-aac.mp4"));
  await page.getByRole("radio", { name: /GIF/ }).check();
  await expect(page.getByRole("button", { name: "Convert to GIF" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I approve uploading this file/ }).check();
  await page.getByRole("button", { name: "Convert to GIF" }).click();
  const download = page.getByRole("link", { name: /Download GIF/ });
  await expect(download).toBeVisible({ timeout: 60_000 });
  const pending = page.waitForEvent("download");
  await download.click();
  const file = await pending;
  const temp = await mkdtemp(join(tmpdir(), "any-native-gif-"));
  try {
    const path = join(temp, file.suggestedFilename());
    await file.saveAs(path);
    const probe = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_name", "-of", "json", path,
    ], { encoding: "utf8" }));
    expect(probe.streams.some((stream: { codec_name: string }) => stream.codec_name === "gif")).toBe(true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  await page.getByRole("button", { name: "Delete file now" }).click();
  await expect(page.getByRole("heading", { name: /baseline-h264-aac.mp4/i })).toBeVisible();
});

test("native server does not upload before explicit consent", async ({ page }) => {
  await page.goto("/native");
  await page.locator('input[type="file"]').setInputFiles(join(fixtures, "baseline-h264-aac.mp4"));
  await expect(page.getByRole("checkbox", { name: /I approve uploading this file/ })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Convert to MP4" })).toBeDisabled();
  await expect(page.getByText(/Ready for native processing/)).toBeVisible();
});
