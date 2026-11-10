import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A self-contained, short mono PCM test tone. Avoid dependencies on FFmpeg,
 * browser codec licenses or a checked-in binary test fixture.
 */
function testWav(): Buffer {
  const sampleRate = 16_000;
  const sampleCount = sampleRate / 2;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM format chunk
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let n = 0; n < sampleCount; n += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(n * 440 * 2 * Math.PI / sampleRate) * 6000), 44 + n * 2);
  }
  return buffer;
}

const sample = testWav();
const file = { name: "compatibility.wav", mimeType: "audio/wav", buffer: sample };

async function attachCapabilities(page: import("@playwright/test").Page, testInfo: import("@playwright/test").TestInfo, status: string) {
  const detected = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    audioDecoder: "AudioDecoder" in window,
    audioEncoder: "AudioEncoder" in window,
    videoDecoder: "VideoDecoder" in window,
    videoEncoder: "VideoEncoder" in window,
    opfs: typeof navigator.storage?.getDirectory === "function",
    pointer: matchMedia("(pointer: coarse)").matches,
  }));
  const payload = { project: testInfo.project.name, status, ...detected };
  console.log("BROWSER_COMPATIBILITY " + JSON.stringify(payload));
  await testInfo.attach("detected-browser-capabilities", {
    body: Buffer.from(JSON.stringify(payload, null, 2)),
    contentType: "application/json",
  });
}

test("file inspection exposes only valid exports, and advertised WAV output works", async ({ page }, testInfo) => {
  const uploads: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (["POST", "PUT"].includes(request.method())) uploads.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Goodbye, format friction/i })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(file);

  await expect.poll(async () => {
    if (await page.locator(".error-message").isVisible()) return "error";
    if (await page.locator(".source-summary").isVisible()) return "inspected";
    return "pending";
  }, { timeout: 60_000 }).not.toBe("pending");

  if (await page.locator(".error-message").isVisible()) {
    await expect(page.locator(".error-message")).toContainText(/couldn't complete/i);
    await expect(page.locator("button.primary-action")).toBeDisabled();
    await expect(page.getByRole("link", { name: /Download/i })).toHaveCount(0);
    await attachCapabilities(page, testInfo, "inspection blocked");
  } else {
    const wav = page.locator('label.format-option').filter({ has: page.locator('input[value="wav"]') });
    if (await wav.count() === 0) {
      await expect(page.getByText(/This device cannot currently process the required tracks or codecs/i)).toBeVisible();
      await expect(page.locator("button.primary-action")).toBeDisabled();
      await attachCapabilities(page, testInfo, "no eligible outputs");
    } else {
      await wav.click();
      const convert = page.getByRole("button", { name: "Convert WAV" });
      await expect(convert).toBeEnabled();
      await convert.click();
      const link = page.getByRole("link", { name: /Download compatibility-converted\.wav/i });
      await expect(link).toBeVisible({ timeout: 90_000 });
      const downloadPromise = page.waitForEvent("download");
      await link.click();
      const download = await downloadPromise;
      const directory = await mkdtemp(join(tmpdir(), "any-convert-cross-browser-"));
      try {
        const destination = join(directory, download.suggestedFilename());
        await download.saveAs(destination);
        const data = await readFile(destination);
        expect(data.length).toBeGreaterThan(128);
        expect(data.toString("ascii", 0, 4)).toBe("RIFF");
        expect(data.toString("ascii", 8, 12)).toBe("WAVE");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      await attachCapabilities(page, testInfo, "WAV export verified");
    }
  }
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});

test("batch import stays usable on this viewport, and clipboard does not upload", async ({ page }, testInfo) => {
  const uploads: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (["POST", "PUT"].includes(request.method())) uploads.push(request.url());
  });
  await page.goto("/batch");
  await expect(page.getByRole("heading", { name: /Everything you need/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose media files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose media files" })).toBeEnabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow, "Page must not scroll horizontally on this device").toBeLessThanOrEqual(2);

  // Real clipboard file availability differs by OS. This checks the application's
  // file-bearing paste event and its DOM listener, not the native clipboard UI.
  const pasted = await page.evaluate((bytes) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([new Uint8Array(bytes)], "compatibility.wav", { type: "audio/wav" }));
    const event = new ClipboardEvent("paste", {
      bubbles: true, cancelable: true, clipboardData: clipboard,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }, [...sample]);
  expect(pasted, "Media paste should be claimed by the batch workspace").toBe(true);
  await expect(page.locator(".batch-asset")).toHaveCount(1);
  const chip = page.locator(".batch-asset .batch-chip");
  await expect(chip).toHaveText(/Inspected|Unsupported/, { timeout: 60_000 });
  if (await chip.textContent() === "Unsupported") {
    await expect(page.locator(".batch-asset-info")).not.toContainText("Inspecting codecs");
  }
  await attachCapabilities(page, testInfo, "batch inspected or explicitly unsupported");
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});
