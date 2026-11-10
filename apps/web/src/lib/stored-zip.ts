import { makeTemporaryExportKey, removeTemporaryExport, TEMP_EXPORT_DIR } from "./output-storage";

/**
 * ZIP32, uncompressed (STORE) and streamed to private browser storage.
 * Video is already compressed, so DEFLATE would waste CPU and memory.
 * Strict bounds exclude ZIP64; no archives are built in a large JS buffer.
 */
export const MAX_ZIP_ITEMS = 48;
export const MAX_ZIP_CONTENT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_UINT32 = 0xffffffff;
const utf8 = new TextEncoder();

export type ZipSource = { name: string; blob: Blob };
export type ZipPlan = { entries: { name: string; encoded: Uint8Array; blob: Blob }[]; totalBytes: number };

export function sanitizeZipEntryName(value: string): string {
  const safe = value.normalize("NFC").replace(/[\\/<>:"|?*]/g, "-")
    .split("").map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? "-" : char;
    }).join("")
    .replace(/^\.+/, "_").replace(/\.+$/, "").trim();
  return safe.slice(0, 180) || "export.bin";
}

export function planStoredZip(sources: readonly ZipSource[]): ZipPlan {
  if (sources.length < 1 || sources.length > MAX_ZIP_ITEMS) {
    throw new Error("Choose between one and 48 completed exports");
  }
  const names = new Set<string>();
  let totalBytes = 0;
  const entries = sources.map((source, index) => {
    if (!Number.isSafeInteger(source.blob.size) || source.blob.size < 1) {
      throw new Error("An export is empty or has an invalid size");
    }
    totalBytes += source.blob.size;
    if (totalBytes > MAX_ZIP_CONTENT_BYTES) {
      throw new Error("The export pack exceeds the 2 GB ZIP32 safety limit. Download files individually.");
    }
    const baseName = sanitizeZipEntryName(source.name);
    let name = baseName;
    let suffix = index + 1;
    while (names.has(name.toLowerCase())) {
      name = `${suffix}-${baseName}`;
      suffix += 1;
    }
    names.add(name.toLowerCase());
    return { name, encoded: utf8.encode(name), blob: source.blob };
  });
  return { entries, totalBytes };
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let crc = n;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  CRC_TABLE[n] = crc >>> 0;
}
export function zipCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = ((crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}
function crcUpdate(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = ((crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!) >>> 0;
  return crc;
}

function stamp(lastModified: number): { time: number; date: number } {
  const value = new Date(lastModified);
  const year = Math.min(2107, Math.max(1980, value.getFullYear()));
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}
function buffer(length: number): { bytes: Uint8Array<ArrayBuffer>; view: DataView } {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}
function localHeader(name: Uint8Array, date: number, time: number): Uint8Array<ArrayBuffer> {
  const { bytes, view } = buffer(30 + name.byteLength);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0808, true); // data descriptor + UTF-8 names
  view.setUint16(8, 0, true); // STORE
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint16(26, name.byteLength, true);
  bytes.set(name, 30);
  return bytes;
}
function dataDescriptor(crc: number, size: number): Uint8Array<ArrayBuffer> {
  const { bytes, view } = buffer(16);
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(4, crc, true);
  view.setUint32(8, size, true);
  view.setUint32(12, size, true);
  return bytes;
}
function centralHeader(
  name: Uint8Array, date: number, time: number,
  crc: number, size: number, offset: number,
): Uint8Array<ArrayBuffer> {
  const { bytes, view } = buffer(46 + name.byteLength);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0808, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint32(42, offset, true);
  bytes.set(name, 46);
  return bytes;
}
function endOfCentralDirectory(count: number, centralLength: number, centralOffset: number): Uint8Array<ArrayBuffer> {
  const { bytes, view } = buffer(22);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralLength, true);
  view.setUint32(16, centralOffset, true);
  return bytes;
}

export type ZipBundle = { file: File; storageKey: string };

export async function createStoredZip(
  sources: readonly ZipSource[],
  onProgress?: (completedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<ZipBundle> {
  const plan = planStoredZip(sources);
  if (!navigator.storage?.getDirectory) throw new Error("Local archive storage isn't available in this browser");
  const estimate = await navigator.storage.estimate();
  const approximateBytes = plan.totalBytes + plan.entries.length * 2048 + 4096;
  if (typeof estimate.quota === "number" && typeof estimate.usage === "number" &&
      estimate.quota - estimate.usage < approximateBytes) {
    throw new Error("Not enough private browser storage to build the archive. Download exports separately.");
  }
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(TEMP_EXPORT_DIR, { create: true });
  const storageKey = makeTemporaryExportKey("zip");
  const handle = await directory.getFileHandle(storageKey, { create: true });
  let writable: FileSystemWritableFileStream | null = null;
  try {
    const outputStream = await handle.createWritable();
    writable = outputStream;
    let position = 0;
    const write = async (bytes: Uint8Array<ArrayBuffer>) => {
      if (signal?.aborted) throw new DOMException("Archive cancelled", "AbortError");
      if (position + bytes.byteLength > MAX_UINT32) throw new Error("Archive is too large for ZIP32");
      await outputStream.write(bytes);
      position += bytes.byteLength;
    };
    const records: Uint8Array<ArrayBuffer>[] = [];
    let completed = 0;
    for (const entry of plan.entries) {
      const { date, time } = stamp((entry.blob as File).lastModified ?? Date.now());
      const offset = position;
      await write(localHeader(entry.encoded, date, time));
      let count = 0;
      let crc = 0xffffffff;
      const reader = entry.blob.stream().getReader();
      try {
        for (;;) {
          if (signal?.aborted) throw new DOMException("Archive cancelled", "AbortError");
          const chunk = await reader.read();
          if (chunk.done) break;
          const value = chunk.value as Uint8Array<ArrayBuffer>;
          count += value.byteLength;
          crc = crcUpdate(crc, value);
          await write(value);
          completed += value.byteLength;
          onProgress?.(completed, plan.totalBytes);
        }
      } finally {
        reader.releaseLock();
      }
      if (count !== entry.blob.size) throw new Error("Archive input changed during writing");
      crc = (crc ^ 0xffffffff) >>> 0;
      await write(dataDescriptor(crc, count));
      records.push(centralHeader(entry.encoded, date, time, crc, count, offset));
    }
    const centralOffset = position;
    for (const record of records) await write(record);
    const centralLength = position - centralOffset;
    await write(endOfCentralDirectory(records.length, centralLength, centralOffset));
    await outputStream.close();
    writable = null;
    const file = await handle.getFile();
    if (file.size !== position) throw new Error("Archive size verification failed");
    return { file, storageKey };
  } catch (error) {
    await writable?.abort().catch(() => {});
    await removeTemporaryExport(storageKey);
    throw error;
  }
}
