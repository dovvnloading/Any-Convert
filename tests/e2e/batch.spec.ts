import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { pasteFixtureFiles } from "./clipboard";

const fixtureRoot = resolve("tests/fixtures/generated");

test("multi-output batch converts real codecs and downloads a valid ZIP pack", async ({ page }) => {
  await page.goto("/batch");
  await expect(page.getByRole("heading", { name: /Everything you need/i })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(join(fixtureRoot, "baseline-h264-aac.mp4"));
  await expect(page.getByText(/Inspected/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("button", { name: "Run 2 exports" })).toBeEnabled();
  await page.getByRole("button", { name: "Run 2 exports" }).click();
  await expect(page.getByRole("link", { name: /Download MP4/ })).toBeVisible({ timeout: 120000 });
  await expect(page.getByRole("link", { name: /Download MP3/ })).toBeVisible({ timeout: 120000 });
  await page.getByRole("button", { name: "Prepare ZIP" }).click();
  const zipLink = page.getByRole("link", { name: /Download ZIP/ });
  await expect(zipLink).toBeVisible({ timeout: 90000 });
  const downloadEvent = page.waitForEvent("download");
  await zipLink.click();
  const zip = await downloadEvent;
  const temp = await mkdtemp(join(tmpdir(), "any-convert-batch-"));
  try {
    const output = join(temp, "exports.zip");
    await zip.saveAs(output);
    const checked = JSON.parse(execFileSync("python3", ["-c", [
      "import zipfile,sys,json",
      "zf=zipfile.ZipFile(sys.argv[1])",
      "files=zf.namelist()",
      "bad=zf.testzip()",
      "print(json.dumps({'files':files,'bad':bad}))",
    ].join(";"), output], { encoding: "utf8" }));
    expect(checked.bad).toBeNull();
    expect(checked.files).toHaveLength(2);
    expect(checked.files.some((name: string) => name.endsWith(".mp4"))).toBe(true);
    expect(checked.files.some((name: string) => name.endsWith(".mp3"))).toBe(true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("pasted multi-file media is inspected locally and counted per output", async ({ page }) => {
  await page.goto("/batch");
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" || request.method() === "PUT") uploads.push(request.url());
  });
  await pasteFixtureFiles(page, [
    { path: join(fixtureRoot, "baseline-h264-aac.mp4"), mime: "video/mp4" },
    { path: join(fixtureRoot, "pcm-audio.wav"), mime: "audio/wav" },
  ]);
  await expect(page.locator(".batch-asset")).toHaveCount(2);
  await expect(page.getByText("Inspected", { exact: true })).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Run 3 exports" })).toBeEnabled();
  expect(uploads).toEqual([]);
});

test("batch preserves accessibility and makes no media upload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/batch");
  await expect(page.getByRole("button", { name: "Choose media files" })).toBeVisible();
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" || request.method() === "PUT") uploads.push(request.url());
  });
  await page.locator('input[type="file"]').setInputFiles(join(fixtureRoot, "pcm-audio.wav"));
  await expect(page.getByText(/Inspected/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("button", { name: "Run 1 exports" })).toBeEnabled();
  expect(uploads).toEqual([]);
});
