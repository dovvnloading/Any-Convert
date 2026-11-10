import { useEffect, useEffectEvent } from "react";

// Clipboard file MIME types are not always preserved (for example, an MKV
// copied from the file manager may arrive as application/octet-stream).
const MEDIA_FILENAME = /\.(?:avi|flac|m4a|m4v|mkv|mov|mp3|mp4|mpeg|mpg|ogg|opus|wav|webm|wmv)$/i;
const MEDIA_MIME = /^(?:audio|video)\//i;

/** Ignore clipboard text, pasted screenshots and unrelated documents. */
export function selectPastedMediaFiles(files: readonly File[]): File[] {
  return files.filter((file) => MEDIA_MIME.test(file.type) || MEDIA_FILENAME.test(file.name));
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
  ));
}

/**
 * Import copied audio/video files only when the browser exposes real File
 * objects. Text, ordinary form editing, and other clipboard content retain
 * their default behavior. The Effect Event reads the latest busy state and
 * import callback without repeatedly subscribing to the document.
 */
export function useClipboardMediaImport(
  onFiles: (files: File[]) => void,
  disabled: boolean,
): void {
  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    if (disabled || event.defaultPrevented || isTextEntryTarget(event.target)) return;
    const files = selectPastedMediaFiles(Array.from(event.clipboardData?.files ?? []));
    if (files.length === 0) return;
    event.preventDefault();
    onFiles(files);
  });

  useEffect(() => {
    const listener = (event: ClipboardEvent) => onPaste(event);
    document.addEventListener("paste", listener);
    return () => document.removeEventListener("paste", listener);
  }, []);
}
