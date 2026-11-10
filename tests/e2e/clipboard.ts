import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Page } from "@playwright/test";

/** Dispatch a real FileList-shaped paste event without operating-system clipboard permissions. */
export async function pasteFixtureFiles(
  page: Page,
  files: readonly { path: string; mime: string }[],
  targetSelector?: string,
): Promise<void> {
  const payload = await Promise.all(files.map(async ({ path, mime }) => ({
    name: basename(path),
    mime,
    base64: (await readFile(path)).toString("base64"),
  })));
  await page.evaluate(({ payload, targetSelector }) => {
    const clipboard = new DataTransfer();
    for (const { name, mime, base64 } of payload) {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      clipboard.items.add(new File([bytes], name, { type: mime }));
    }
    const target = targetSelector ? document.querySelector(targetSelector) : document;
    if (!target) throw new Error("Missing clipboard paste target");
    target.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true, cancelable: true, clipboardData: clipboard,
    }));
  }, { payload, targetSelector });
}
