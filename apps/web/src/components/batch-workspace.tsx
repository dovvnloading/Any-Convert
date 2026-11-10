"use client";

import { useEffect, useRef, useState } from "react";
import {
  FORMATS, MAX_LOCAL_BYTES, MAX_STREAMING_BYTES, getFormat,
  safeOutputName, validFormats, validProgress, recommendedLocalFormat,
} from "@/lib/converter-contract";
import type {
  FormatId, HeightLimit, MediaInfo, QualityId, WorkerRequest, WorkerResponse,
} from "@/lib/converter-contract";
import { formatBytes } from "@/lib/media";
import {
  makeTemporaryExportKey, removeTemporaryExport, sweepStaleTemporaryExports,
} from "@/lib/output-storage";
import { createStoredZip, MAX_ZIP_CONTENT_BYTES } from "@/lib/stored-zip";

type Phase = "idle" | "inspecting" | "ready" | "running" | "complete";
type JobStage = "queued" | "preparing" | "converting" | "verifying" | "ready" | "failed" | "cancelled";
type Asset = {
  id: string; file: File; info: MediaInfo | null; error: string | null;
};
type OutputFile = {
  name: string; blob: Blob; url: string; bytes: number; storageKey: string | null;
};
type BatchJob = {
  id: string; assetId: string; filename: string; format: FormatId;
  stage: JobStage; progress: number | null; error: string | null; result: OutputFile | null;
};
type Archive = {
  status: "idle" | "packing" | "ready" | "failed";
  progress: number | null; error: string | null; output: OutputFile | null;
};

const MAX_FILES = 8;
const MAX_TASKS = 24;
const emptyArchive: Archive = { status: "idle", progress: null, error: null, output: null };

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message && !message.includes("Cancelled")
    ? message.slice(0, 260)
    : "The operation was cancelled or could not finish.";
}

function stageLabel(stage: JobStage): string {
  switch (stage) {
    case "queued": return "In queue";
    case "preparing": return "Preparing";
    case "converting": return "Converting";
    case "verifying": return "Verifying output";
    case "ready": return "Verified and ready";
    case "failed": return "Needs attention";
    case "cancelled": return "Cancelled";
  }
}

export function BatchWorkspace() {
  const picker = useRef<HTMLInputElement>(null);
  const activeWorker = useRef<Worker | null>(null);
  const rejectActive = useRef<(() => void) | null>(null);
  const activeStorageKey = useRef<string | null>(null);
  const generation = useRef(0);
  const operation = useRef(0);
  const cancelled = useRef(false);
  const runToken = useRef(0);
  const outputRefs = useRef(new Map<string, OutputFile>());
  const archiveRef = useRef<OutputFile | null>(null);
  const archiveAbort = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [formats, setFormats] = useState<FormatId[]>(["mp4", "mp3"]);
  const [quality, setQuality] = useState<QualityId>("source");
  const [height, setHeight] = useState<HeightLimit>("original");
  const [archive, setArchive] = useState<Archive>(emptyArchive);
  const [notice, setNotice] = useState<string | null>(null);

  function stopActiveWorker() {
    const reject = rejectActive.current;
    rejectActive.current = null;
    activeWorker.current?.terminate();
    activeWorker.current = null;
    reject?.();
    if (activeStorageKey.current) {
      void removeTemporaryExport(activeStorageKey.current);
      activeStorageKey.current = null;
    }
  }

  function clearArchive() {
    archiveAbort.current?.abort();
    archiveAbort.current = null;
    if (archiveRef.current) {
      URL.revokeObjectURL(archiveRef.current.url);
      if (archiveRef.current.storageKey) {
        void removeTemporaryExport(archiveRef.current.storageKey);
      }
      archiveRef.current = null;
    }
    setArchive(emptyArchive);
  }

  function clearOutputs() {
    for (const output of outputRefs.current.values()) {
      URL.revokeObjectURL(output.url);
      if (output.storageKey) void removeTemporaryExport(output.storageKey);
    }
    outputRefs.current.clear();
    clearArchive();
  }

  useEffect(() => {
    void sweepStaleTemporaryExports();
    // Capture the maps once: this cleanup must not change on each render.
    const outputs = outputRefs.current;
    return () => {
      cancelled.current = true;
      generation.current += 1;
      runToken.current += 1;
      activeWorker.current?.terminate();
      rejectActive.current?.();
      if (activeStorageKey.current) void removeTemporaryExport(activeStorageKey.current);
      archiveAbort.current?.abort();
      for (const output of outputs.values()) {
        URL.revokeObjectURL(output.url);
        if (output.storageKey) void removeTemporaryExport(output.storageKey);
      }
      outputs.clear();
      const packed = archiveRef.current;
      if (packed) {
        URL.revokeObjectURL(packed.url);
        if (packed.storageKey) void removeTemporaryExport(packed.storageKey);
      }
    };
  }, []);

  function requestWorker(
    request: WorkerRequest, onUpdate?: (value: WorkerResponse) => void,
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let worker: Worker;
      try {
        worker = new Worker(new URL("../lib/media.worker.ts", import.meta.url), { type: "module" });
      } catch {
        reject(new Error("Your browser cannot start the local media worker."));
        return;
      }
      activeWorker.current = worker;
      const finish = (response?: WorkerResponse, error?: Error) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        if (activeWorker.current === worker) activeWorker.current = null;
        if (rejectActive.current === abort) rejectActive.current = null;
        if (error) reject(error);
        else if (response) resolve(response);
        else reject(new Error("Local media processing stopped."));
      };
      const abort = () => finish(undefined, new Error("Cancelled"));
      rejectActive.current = abort;
      worker.onerror = () => finish(undefined, new Error("The local media worker could not finish."));
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.id !== request.id) return;
        if (message.type === "inspected" || message.type === "complete") finish(message);
        else if (message.type === "error") finish(undefined, new Error(message.message));
        else onUpdate?.(message);
      };
      worker.postMessage(request);
    });
  }

  async function importFiles(selected: File[]) {
    if (phase === "running" || phase === "inspecting" || archive.status === "packing") return;
    const files = selected.slice(0, MAX_FILES);
    if (files.length === 0) return;
    const sequence = ++generation.current;
    cancelled.current = false;
    stopActiveWorker();
    clearOutputs();
    setJobs([]);
    setNotice(selected.length > MAX_FILES ? "Only the first eight files were selected for this local batch." : null);
    const initial = files.map((file) => ({
      id: crypto.randomUUID(), file, info: null, error: null,
    }));
    setAssets(initial);
    setPhase("inspecting");
    for (const asset of initial) {
      if (generation.current !== sequence) return;
      let info: MediaInfo | null = null;
      let error: string | null = null;
      if (asset.file.size < 1 || asset.file.size > MAX_STREAMING_BYTES) {
        error = "Choose a non-empty file under 1 GB.";
      } else {
        try {
          const inspected = await requestWorker({
            type: "inspect", id: ++operation.current, file: asset.file,
          });
          if (inspected.type !== "inspected") throw new Error("Could not inspect media.");
          info = inspected.info;
          if (asset.file.size > MAX_LOCAL_BYTES && !info.streamingAvailable) {
            error = "This browser has insufficient private storage for a large local export.";
          } else if (validFormats(info).length === 0) {
            error = "No usable local export formats. Try different media or a compatible device.";
          }
        } catch (reason) {
          error = shortError(reason);
        }
      }
      if (generation.current !== sequence) return;
      setAssets((previous) => previous.map((item) =>
        item.id === asset.id ? { ...item, info, error } : item));
    }
    setPhase("ready");
  }

  function toggleFormat(format: FormatId) {
    if (phase === "running" || phase === "inspecting") return;
    setFormats((previous) => previous.includes(format)
      ? previous.filter((item) => item !== format)
      : [...previous, format]);
  }

  function updateJob(id: string, patch: Partial<BatchJob>) {
    setJobs((previous) => previous.map((job) => job.id === id ? { ...job, ...patch } : job));
  }

  async function runOne(job: BatchJob, asset: Asset, token: number) {
    const storageKey = makeTemporaryExportKey(job.format);
    activeStorageKey.current = storageKey;
    updateJob(job.id, { stage: "preparing", progress: null, error: null, result: null });
    try {
      const message = await requestWorker({
        type: "convert", id: ++operation.current, file: asset.file, preset: job.format,
        quality, height, storageKey,
      }, (update) => {
        if (token !== runToken.current) return;
        if (update.type === "stage") updateJob(job.id, { stage: update.stage });
        if (update.type === "progress") {
          updateJob(job.id, { stage: "converting", progress: validProgress(update.progress) });
        }
      });
      if (message.type !== "complete") throw new Error("The output was not verified");
      if (token !== runToken.current) {
        if (message.storageKey) await removeTemporaryExport(message.storageKey);
        return;
      }
      const blob = message.file ?? new Blob([message.buffer], { type: message.mime });
      const output: OutputFile = {
        blob, url: URL.createObjectURL(blob),
        name: safeOutputName(asset.file.name, job.format),
        bytes: blob.size,
        storageKey: message.storageKey ?? null,
      };
      outputRefs.current.set(job.id, output);
      updateJob(job.id, { stage: "ready", progress: 100, result: output, error: null });
    } catch (error) {
      if (token === runToken.current) {
        updateJob(job.id, {
          stage: cancelled.current ? "cancelled" : "failed",
          progress: null, error: cancelled.current ? "Cancelled" : shortError(error),
        });
      }
    } finally {
      if (activeStorageKey.current === storageKey) activeStorageKey.current = null;
      if (!outputRefs.current.has(job.id)) void removeTemporaryExport(storageKey);
    }
  }

  async function runBatch() {
    if (phase !== "ready" && phase !== "complete") return;
    const planned: BatchJob[] = assets.flatMap((asset) => {
      if (!asset.info || asset.error) return [];
      const supported = validFormats(asset.info);
      return formats.filter((format) => supported.includes(format)).map((format) => ({
        id: crypto.randomUUID(), assetId: asset.id, filename: asset.file.name, format,
        stage: "queued" as const, progress: null, error: null, result: null,
      }));
    });
    if (planned.length === 0) {
      setNotice("No selected formats can be converted locally. Choose a compatible format.");
      return;
    }
    if (planned.length > MAX_TASKS) {
      setNotice("Limit each local batch to 24 exports. Select fewer formats or files.");
      return;
    }
    clearOutputs();
    setJobs(planned);
    setNotice(null);
    cancelled.current = false;
    const token = ++runToken.current;
    setPhase("running");
    for (const job of planned) {
      if (cancelled.current || token !== runToken.current) break;
      const asset = assets.find((item) => item.id === job.assetId);
      if (asset) await runOne(job, asset, token);
    }
    if (token !== runToken.current) return;
    if (cancelled.current) {
      setJobs((previous) => previous.map((job) =>
        job.stage === "queued" ? { ...job, stage: "cancelled" } : job));
    }
    setPhase("complete");
  }

  function stopBatch() {
    if (phase !== "running") return;
    cancelled.current = true;
    runToken.current += 1;
    stopActiveWorker();
    setJobs((previous) => previous.map((job) =>
      ["queued", "preparing", "converting", "verifying"].includes(job.stage)
        ? { ...job, stage: "cancelled", progress: null, error: "Cancelled" }
        : job));
    setPhase("complete");
  }

  async function retry(job: BatchJob) {
    if (phase !== "complete" || job.stage !== "failed") return;
    const asset = assets.find((item) => item.id === job.assetId);
    if (!asset?.info) return;
    cancelled.current = false;
    clearArchive();
    const token = ++runToken.current;
    setPhase("running");
    await runOne(job, asset, token);
    if (token === runToken.current) setPhase("complete");
  }

  async function prepareArchive() {
    if (phase !== "complete" || archive.status === "packing") return;
    const completed = jobs.filter((job) => job.stage === "ready" && job.result);
    if (completed.length === 0) return;
    clearArchive();
    const sources = completed.flatMap((job, index) => job.result ? [{
      name: `${String(index + 1).padStart(2, "0")}-${job.result.name}`,
      blob: job.result.blob,
    }] : []);
    const controller = new AbortController();
    archiveAbort.current = controller;
    setArchive({ status: "packing", progress: 0, error: null, output: null });
    try {
      const packed = await createStoredZip(sources, (done, total) => {
        if (total > 0) setArchive((previous) => ({
          ...previous, progress: Math.min(99, Math.floor(100 * done / total)),
        }));
      }, controller.signal);
      const output: OutputFile = {
        blob: packed.file, url: URL.createObjectURL(packed.file),
        name: "Any-Convert-Pack.zip", bytes: packed.file.size, storageKey: packed.storageKey,
      };
      archiveRef.current = output;
      setArchive({ status: "ready", progress: 100, error: null, output });
    } catch (error) {
      setArchive({ status: "failed", progress: null, error: shortError(error), output: null });
    } finally {
      archiveAbort.current = null;
    }
  }

  const busy = phase === "running" || phase === "inspecting";
  const completed = jobs.filter((job) => job.stage === "ready" && job.result);
  const failed = jobs.filter((job) => job.stage === "failed");
  const skipped = assets.reduce((sum, asset) => {
    if (!asset.info || asset.error) return sum;
    const supported = validFormats(asset.info);
    return sum + formats.filter((format) => !supported.includes(format)).length;
  }, 0);
  const eligible = assets.reduce((sum, asset) => {
    if (!asset.info || asset.error) return sum;
    const supported = validFormats(asset.info);
    return sum + formats.filter((format) => supported.includes(format)).length;
  }, 0);
  const packTooLarge = completed.reduce((total, job) => total + (job.result?.bytes ?? 0), 0) > MAX_ZIP_CONTENT_BYTES;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#batch-workspace">Skip to batch workspace</a>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Any-Convert home"><span>any<span className="brand-divider">/</span>convert</span></a>
        <nav className="top-nav" aria-label="Main navigation">
          <a href="/">Single file</a>
          <a className="nav-active" href="#batch-workspace">Batch studio</a>
          <a href="#privacy">Privacy</a>
          <a href="https://github.com/dovvnloading/Any-Convert" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        </nav>
        <div className="header-status"><span className="status-dot"/> <span>ON-DEVICE BATCH</span></div>
      </header>
      <main className="main-content" id="batch-workspace">
        <div className="section-kicker"><span>THE MEDIA WORKSPACE</span><span className="section-kicker-line"/><span>LOCAL / BATCH</span></div>
        <section className="batch-hero">
          <div>
            <p className="batch-kicker">ONE INPUT. MANY POSSIBILITIES.</p>
            <h1>Everything you need.<span> In one run.</span></h1>
          </div>
          <p>Queue several files, create multiple verified exports, and package results without uploading your media.</p>
        </section>
        <section className="batch-panel" aria-labelledby="batch-source-heading">
          <div className="batch-panel-heading">
            <div><span>01 / SOURCE</span><h2 id="batch-source-heading">Your media</h2></div>
            <span className="batch-muted">{assets.length} / {MAX_FILES} files</span>
          </div>
          <div role="group" aria-label="Media drop area" className="batch-drop" onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy && archive.status !== "packing") void importFiles(Array.from(event.dataTransfer.files));
            }}>
            <input ref={picker} aria-label="Choose media files" type="file" multiple
              accept="video/*,audio/*,.mkv,.avi,.mov,.flac,.wav,.webm,.mp4,.mp3"
              disabled={busy || archive.status === "packing"}
              onChange={(event) => {
                void importFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }} />
            <p>Drag up to eight video or audio files here, or choose them below.</p>
            <button type="button" className="batch-button" disabled={busy || archive.status === "packing"}
              onClick={() => picker.current?.click()}>Choose media files</button>
            <small>On-device only · 256 MB fallback · experimental 1 GB disk-backed mode</small>
          </div>
          <div className="batch-assets" aria-live="polite">
            {assets.map((asset) => (
              <div className="batch-asset" key={asset.id}>
                <span className="batch-asset-icon" aria-hidden="true">▣</span>
                <div className="batch-asset-info">
                  <strong title={asset.file.name}>{asset.file.name}</strong>
                  <span>{formatBytes(asset.file.size)} · {asset.error ? asset.error
                    : asset.info ? `Ready · Suggested ${String(recommendedLocalFormat(asset.info) ?? "none").toUpperCase()}`
                    : "Inspecting codecs…"}</span>
                </div>
                <span className={`batch-chip ${asset.error ? "is-error" : asset.info ? "is-ready" : ""}`}>
                  {asset.error ? "Unsupported" : asset.info ? "Inspected" : "Inspecting"}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="batch-panel" aria-labelledby="batch-recipe-heading">
          <div className="batch-panel-heading">
            <div><span>02 / RECIPE</span><h2 id="batch-recipe-heading">Choose your exports</h2></div>
            <button className="batch-text-button" type="button" disabled={busy}
              onClick={() => setFormats(["mp4", "webm", "mp3"])}>Use creator pack</button>
          </div>
          <div className="batch-format-grid">
            {FORMATS.map((format) => (
              <label className={`batch-format ${formats.includes(format.id) ? "is-selected" : ""}`} key={format.id}>
                <input type="checkbox" name="batch-format" checked={formats.includes(format.id)}
                  onChange={() => toggleFormat(format.id)} disabled={busy}/>
                <span><strong>{format.label}</strong><small>{format.detail}</small></span>
              </label>
            ))}
          </div>
          <div className="batch-settings">
            <label>QUALITY <select aria-label="Export quality" value={quality} disabled={busy}
              onChange={(event) => setQuality(event.target.value as QualityId)}>
              <option value="source">Keep source when compatible</option>
              <option value="balanced">Balanced</option>
              <option value="compact">Smaller</option>
            </select></label>
            <label>MAXIMUM HEIGHT <select aria-label="Maximum export height" value={height} disabled={busy}
              onChange={(event) => setHeight(event.target.value as HeightLimit)}>
              <option value="original">Original</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
            </select></label>
          </div>
          <p className="batch-muted">Only source/codec-compatible formats are queued. Browser encoding support varies; Native Engine uploads never start here.</p>
          <div className="batch-runbar">
            <div>
              <strong>{eligible} eligible exports</strong>
              <span>{skipped} unsupported source/format combinations skipped</span>
            </div>
            {phase === "running"
              ? <button type="button" className="batch-button is-cancel" onClick={stopBatch}>Cancel remaining</button>
              : <button type="button" className="batch-button is-primary"
                  disabled={busy || archive.status === "packing" || !eligible || !formats.length}
                  onClick={() => void runBatch()}>Run {eligible} exports</button>}
          </div>
        </section>
        {(jobs.length > 0 || notice) && (
          <section className="batch-panel" aria-labelledby="batch-outputs-heading">
            <div className="batch-panel-heading">
              <div><span>03 / EXPORT</span><h2 id="batch-outputs-heading">Verified outputs</h2></div>
              <span className="batch-muted">{completed.length} ready · {failed.length} failed · {jobs.length} jobs</span>
            </div>
            {notice && <p role="status" className="batch-notice">{notice}</p>}
            <div className="batch-job-list" aria-live="polite">
              {jobs.map((job) => (
                <div className="batch-job" key={job.id}>
                  <div className="batch-job-summary">
                    <div><strong>{job.filename}</strong><span>{getFormat(job.format).label} · {stageLabel(job.stage)}</span></div>
                    <span className={`batch-chip ${job.stage === "ready" ? "is-ready" : job.stage === "failed" ? "is-error" : ""}`}>{job.stage}</span>
                  </div>
                  {job.stage === "converting" && (
                    <progress max={100} value={job.progress ?? undefined}
                      aria-label={`Conversion progress for ${job.filename} to ${job.format}`}/>
                  )}
                  {job.error && <p className="batch-error" role="alert">{job.error}</p>}
                  {job.result && <a className="batch-download" href={job.result.url}
                    download={job.result.name}>Download {job.format.toUpperCase()} · {formatBytes(job.result.bytes)}</a>}
                  {job.stage === "failed" && <button type="button" className="batch-text-button"
                    disabled={busy} onClick={() => void retry(job)}>Retry this export</button>}
                </div>
              ))}
            </div>
            {completed.length > 0 && (
              <div className="batch-package">
                <div>
                  <strong>Export pack</strong>
                  <span>{completed.length} completed files · stored without ZIP recompression</span>
                </div>
                {archive.status === "ready" && archive.output
                  ? <a className="batch-button is-primary" href={archive.output.url} download={archive.output.name}>
                      Download ZIP · {formatBytes(archive.output.bytes)}</a>
                  : archive.status === "packing"
                    ? <button className="batch-button" type="button" onClick={() => archiveAbort.current?.abort()}>
                        Cancel packing {archive.progress ?? 0}%</button>
                    : <button type="button" className="batch-button" disabled={busy || packTooLarge}
                        onClick={() => void prepareArchive()}>Prepare ZIP</button>}
                {archive.error && <p role="alert" className="batch-error">{archive.error}</p>}
                {packTooLarge && <p className="batch-muted">The ZIP32 limit is 2 GB. Download outputs separately.</p>}
              </div>
            )}
          </section>
        )}
        <section className="batch-privacy" id="privacy">
          <strong>Private means private.</strong>
          <p>Your media is processed only on this device. Temporary origin-private files help handle large output and packaging.
            Exports are removed on reset or a later visit; abrupt tab closure may leave local temporary files until cleanup.</p>
        </section>
      </main>
    </div>
  );
}
