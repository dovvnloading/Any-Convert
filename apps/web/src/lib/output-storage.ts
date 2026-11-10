/**
 * Temporary private browser output. Never expose paths from user filenames.
 * OPFS is on-device storage, not a server upload, and is quota-controlled.
 */
export const TEMP_EXPORT_DIR = "any-convert-temporary-exports";
const KEY = /^ac-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm|mp3|wav|flac|zip)$/;
const EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isTemporaryExportKey(value: string): boolean {
  return KEY.test(value);
}

export function makeTemporaryExportKey(extension: string): string {
  if (!/^(mp4|mov|webm|mp3|wav|flac|zip)$/.test(extension)) {
    throw new Error("Unsupported temporary output extension");
  }
  return "ac-" + crypto.randomUUID() + "." + extension;
}

export async function removeTemporaryExport(key: string): Promise<void> {
  if (!isTemporaryExportKey(key)) return;
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(TEMP_EXPORT_DIR);
    await directory.removeEntry(key);
  } catch {
    // If the output is already gone, the user's download is unaffected.
  }
}

/** Best-effort crash recovery cleanup; never delete fresh results from other tabs. */
export async function sweepStaleTemporaryExports(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(TEMP_EXPORT_DIR);
    for await (const [key, handle] of directory.entries()) {
      if (!isTemporaryExportKey(key) || handle.kind !== "file") continue;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        if (Date.now() - file.lastModified > EXPIRE_AFTER_MS) {
          await directory.removeEntry(key);
        }
      } catch {
        // Ignore files locked by an active tab or revoked storage.
      }
    }
  } catch {
    // Storage may be disabled (private browsing); memory exports still work.
  }
}
