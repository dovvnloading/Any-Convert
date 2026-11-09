import { randomUUID } from "node:crypto";
import { access, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { MediaProbe } from "@any-convert/contracts";
import { probeMedia, verifyUniversalMp4 } from "./probe";
import { runCommand, type RunOptions } from "./process";

/** M0: single local-file encoder proof. NOT exposed as a public upload API. */
export function buildUniversalMp4Args(input: string, tempOutput: string): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
    "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-sn", "-dn",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    "-f", "mp4",
    tempOutput,
  ];
}

/**
 * Convert and validate BEFORE publishing a result.
 * Refuses to overwrite an existing output; future shared workers need atomic
 * object-store ownership and idempotency keys before accepting user uploads.
 */
export async function convertUniversalMp4(
  input: string,
  output: string,
  options: RunOptions = {},
): Promise<MediaProbe> {
  if (resolve(input) === resolve(output)) throw new Error("Input and output paths must differ.");
  const inputStat = await stat(input);
  if (!inputStat.isFile()) throw new Error("Input must be a local file.");
  try {
    await access(output);
    throw new Error("Output already exists; refusing overwrite.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const tempOutput = join(dirname(output), `.${basename(output)}.${randomUUID()}.mp4`);
  try {
    await runCommand("ffmpeg", buildUniversalMp4Args(input, tempOutput), {
      ...options,
      timeoutMs: options.timeoutMs ?? 120_000,
    });
    const result = await probeMedia(tempOutput, options);
    verifyUniversalMp4(result);
    await rename(tempOutput, output);
    return result;
  } finally {
    await rm(tempOutput, { force: true });
  }
}
