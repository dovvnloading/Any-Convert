"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/media";
import {
  NATIVE_FORMATS,
  createNativeJob,
  deleteNativeJob,
  getNativeDownload,
  getNativeHealth,
  getNativeJob,
  startNativeJob,
  uploadNativeFile,
} from "@/lib/native-client";
import type {
  NativeFormat, NativeHealth, NativeHeight, NativeJob, NativeQuality,
} from "@/lib/native-client";

type State = "loading" | "offline" | "idle" | "uploading" | "running" | "ready" | "failed";
const STORE_KEY = "any-convert:native-job";

function stageOf(job: NativeJob | null, state: State): string {
  if (state === "uploading") return "Uploading securely";
  if (job?.state === "ready") return "Your file is ready";
  if (job?.state === "failed") return "Conversion couldn't finish";
  if (job?.state === "queued") return "Waiting for a worker";
  if (job?.state === "probing") return "Inspecting the media";
  if (job?.state === "processing") return "Encoding your file";
  if (job?.state === "verifying") return "Verifying the output";
  return "Preparing your conversion";
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Only include errors deliberately authored for this application.
    if (error.name === "NativeRequestError") return error.message;
    if (error.message === "Upload cancelled") return error.message;
    if (error.message.startsWith("Upload interrupted")) return error.message;
  }
  return "The self-hosted engine is unavailable or the connection was interrupted. Your source file is unchanged.";
}

function Wordmark() {
  return (
    <a className="brand" href="/" aria-label="Any-Convert home">
      <svg className="brand-mark" aria-hidden="true" viewBox="0 0 38 38" fill="none">
        <rect x="1" y="1" width="36" height="36" rx="10" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 9v20m14-20v20M12 14h14m-14 11h14" stroke="currentColor" strokeWidth="1.4"/>
        <path d="m17 17 6 2-6 2v-4Z" fill="currentColor"/>
      </svg>
      <span>any<span className="brand-divider">/</span>convert</span>
    </a>
  );
}

export function NativeWorkspace() {
  const picker = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const activeJob = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragDepth = useRef(0);
  const retries = useRef(0);
  const [health, setHealth] = useState<NativeHealth | null>(null);
  const [state, setState] = useState<State>("loading");
  const [source, setSource] = useState<File | null>(null);
  const [format, setFormat] = useState<NativeFormat>("mp4");
  const [quality, setQuality] = useState<NativeQuality>("balanced");
  const [height, setHeight] = useState<NativeHeight>(null);
  const [job, setJob] = useState<NativeJob | null>(null);
  const [consent, setConsent] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function schedulePoll(id: string, sequence: number) {
    clearTimer();
    timer.current = setTimeout(() => { void pollJob(id, sequence); }, 900);
  }
  async function pollJob(id: string, sequence: number) {
    if (sequence !== generation.current) return;
    try {
      const next = await getNativeJob(id);
      if (sequence !== generation.current) return;
      retries.current = 0;
      setJob(next);
      if (next.state === "ready") {
        setState("ready");
        setError(null);
      } else if (next.state === "failed" || next.state === "cancelled") {
        setState("failed");
        setError(next.error || "The conversion did not finish.");
      } else {
        setState("running");
        schedulePoll(id, sequence);
      }
    } catch (reason) {
      if (sequence !== generation.current) return;
      retries.current += 1;
      if (retries.current <= 3) schedulePoll(id, sequence);
      else {
        setState("failed");
        setError(sanitizeError(reason));
      }
    }
  }

  useEffect(() => {
    let mounted = true;
    const sequence = generation.current;
    void getNativeHealth().then((details) => {
      if (!mounted) return;
      setHealth(details);
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved && /^[0-9a-f-]{36}$/.test(saved)) {
        activeJob.current = saved;
        void pollJob(saved, sequence);
      } else setState("idle");
    }).catch(() => {
      if (!mounted) return;
      setState("offline");
    });
    return () => {
      mounted = false;
      generation.current += 1;
      clearTimer();
      uploadController.current?.abort();
    };
  }, []);

  const working = state === "uploading" || state === "running";
  const finished = state === "ready" && job?.state === "ready";
  const displayedError = job?.state === "failed" ? job.error : error;
  const options = source?.type.startsWith("audio/")
    ? NATIVE_FORMATS.filter((item) => item.kind === "audio")
    : NATIVE_FORMATS;
  const formatLabel = NATIVE_FORMATS.find((item) => item.id === format)?.title ?? format.toUpperCase();
  const outputKind = NATIVE_FORMATS.find((item) => item.id === format)?.kind;
  const progress = state === "uploading" ? uploadProgress : job?.state === "processing" ? job.progress : null;
  const canStart = Boolean(source && health && consent && !working && !finished);
  const canDownload = finished && job;

  function choose() {
    if (working || !picker.current) return;
    picker.current.value = "";
    picker.current.click();
  }
  function importFile(file?: File) {
    if (!file || working) return;
    if (!health) return;
    if (file.size === 0 || file.size > health.maxUploadBytes) {
      setError("Choose a non-empty file under " + formatBytes(health.maxUploadBytes) + ".");
      return;
    }
    setSource(file);
    setFormat(file.type.startsWith("audio/") ? "mp3" : "mp4");
    setQuality("balanced");
    setHeight(null);
    setConsent(false);
    setUploadProgress(null);
    setError(null);
    // Previous server result is deliberately not automatically deleted on
    // replacement; users can explicitly delete it or let retention expire.
    setJob(null);
    setState("idle");
    sessionStorage.removeItem(STORE_KEY);
  }

  async function start() {
    if (!source || !health || !consent || working || finished) return;
    const sequence = ++generation.current;
    clearTimer();
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    setError(null);
    setJob(null);
    setUploadProgress(0);
    setState("uploading");
    let id: string | null = null;
    try {
      const created = await createNativeJob(source);
      if (sequence !== generation.current) return;
      id = created.id;
      activeJob.current = id;
      sessionStorage.setItem(STORE_KEY, id);
      setJob(created);
      await uploadNativeFile(id, source, (fraction) => {
        if (sequence === generation.current) setUploadProgress(fraction);
      }, controller.signal);
      if (sequence !== generation.current) return;
      const started = await startNativeJob(id, format, quality, height);
      if (sequence !== generation.current) return;
      setJob(started);
      setState("running");
      schedulePoll(id, sequence);
    } catch (reason) {
      if (sequence !== generation.current) return;
      setState("failed");
      setError(sanitizeError(reason));
      if (id) {
        void deleteNativeJob(id).catch(() => {});
        sessionStorage.removeItem(STORE_KEY);
      }
    }
  }

  async function cancel() {
    generation.current += 1;
    clearTimer();
    uploadController.current?.abort();
    const id = activeJob.current;
    activeJob.current = null;
    sessionStorage.removeItem(STORE_KEY);
    setState("idle");
    setJob(null);
    setError(null);
    setUploadProgress(null);
    if (id) {
      try { await deleteNativeJob(id); }
      catch { setError("The server could not confirm deletion; the retention limit still applies."); }
    }
  }

  async function discard() {
    await cancel();
    setSource(null);
    setConsent(false);
  }

  const instructions = !health
    ? "Native processing is disabled on this host. You can still use the on-device converter."
    : "The source file is uploaded only after explicit approval. Your own server runs FFmpeg; no proprietary conversion API is involved.";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#native-workspace">Skip to converter</a>
      <header className="app-header">
        <Wordmark />
        <nav className="top-nav" aria-label="Main navigation">
          <a href="/">On-device</a>
          <a className="nav-active" href="/native" aria-current="page">Native engine</a>
          <a href="https://github.com/dovvnloading/Any-Convert/blob/main/docs/SELF_HOST.md" target="_blank" rel="noopener noreferrer">Self-host ↗</a>
        </nav>
        <span className="header-status"><span className="status-dot" /> OPEN ENGINE</span>
      </header>
      <main id="native-workspace" className="main-content">
        <div className="section-kicker"><span>AN OPEN TOOLCHAIN</span><span className="section-kicker-line"/><span>LOCAL-FIRST / SELF-HOSTABLE</span></div>
        <section className="hero-section native-hero">
          <h1>Built to be <span>yours.</span></h1>
          <div className="hero-side">
            <div className="hero-rule"/>
            <p>When browser codecs reach their limit, use a native engine you can inspect, modify and run yourself.</p>
            <span>REAL FFMPEG. NO BLACK-BOX CONVERSION API.</span>
          </div>
        </section>
        <div className="native-headline">
          <span>01 — SOURCE & PROGRESS</span>
          <span>02 — PROCESSING OPTIONS</span>
        </div>
        <div className="native-grid">
          <section
            className={["native-source", dragging && "is-dragging"].filter(Boolean).join(" ")}
            aria-label="Self-hosted native upload"
            onDragEnter={(event) => {
              event.preventDefault();
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = working ? "none" : "copy"; }}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              if (!working) importFile(event.dataTransfer.files[0]);
            }}
          >
            <input ref={picker} type="file" className="sr-only" tabIndex={-1}
              accept="video/*,audio/*,.mkv,.avi,.mov,.webm,.flac,.ogg,.wmv,.m4v"
              onChange={(event) => importFile(event.target.files?.[0])}
              aria-label="Choose video or audio to process"/>
            {dragging && !working ? (
              <div className="native-drag" aria-hidden="true">Release to add this file</div>
            ) : state === "offline" || state === "loading" ? (
              <div className="native-empty">
                <span className="native-circle" aria-hidden="true">↗</span>
                <h2>{state === "loading" ? "Connecting to the engine…" : "Native engine not connected."}</h2>
                <p>{instructions}</p>
                <a className="light-button" href="/">Use on-device converter ↗</a>
              </div>
            ) : working || finished || job?.state === "failed" ? (
              <div className="native-job">
                <div className="native-job-heading">
                  <span className="native-eyebrow">PROCESSING SESSION</span>
                  <h2>{stageOf(job, state)}</h2>
                  <p title={job?.filename}>{job?.filename ?? source?.name}</p>
                </div>
                {finished && job ? (
                  <div className="native-complete">
                    <span className="native-complete-icon" aria-hidden="true">✓</span>
                    <strong>{formatBytes(job.outputBytes ?? 0)}</strong>
                    <small>Verified {job.format?.toUpperCase()} output · available until expiry</small>
                    <a className="light-button" href={getNativeDownload(job.id)}>
                      Download {job.format?.toUpperCase()} ↗
                    </a>
                  </div>
                ) : (
                  <div className="native-job-progress">
                    <span>{progress !== null ? String(progress).concat("%") : "Processing…"}</span>
                    <progress max={100} value={progress ?? undefined} aria-label={stageOf(job, state)} />
                    <small>{state === "uploading"
                      ? "Uploading to this self-hosted instance"
                      : job?.stage || "Your file is being prepared"}</small>
                  </div>
                )}
                {displayedError && <div className="native-error" role="alert">{displayedError}</div>}
                <div className="native-actions">
                  <button type="button" onClick={() => void cancel()}>
                    {finished ? "Delete file now" : "Cancel and delete"}
                  </button>
                  {!working && <button type="button" onClick={() => void discard()}>Start over</button>}
                </div>
              </div>
            ) : (
              <div className="native-empty">
                <span className="native-circle" aria-hidden="true">+</span>
                <span className="native-eyebrow">YOUR SOURCE · YOUR CONTROL</span>
                {source ? (
                  <>
                    <h2 title={source.name}>{source.name}</h2>
                    <p>{formatBytes(source.size)} · Ready for native processing</p>
                    <button type="button" className="light-button" onClick={choose}>Replace file ↗</button>
                  </>
                ) : (
                  <>
                    <h2>Drop a video to begin.</h2>
                    <p>MP4, MOV, MKV, AVI, audio, and other FFmpeg-supported formats.</p>
                    <button type="button" className="light-button" onClick={choose}>Choose media ↗</button>
                  </>
                )}
                <span className="native-footnote">MAX INPUT {formatBytes(health?.maxUploadBytes ?? 0).toUpperCase()} · NO ACCOUNT REQUIRED</span>
              </div>
            )}
          </section>
          <aside className="native-panel" aria-label="Native conversion configuration">
            <div className="config-header"><span>EXPORT WORKSPACE</span><span className="config-index">↗</span></div>
            <h2>Consider every output.</h2>
            <p className="native-panel-sub">Your files, processed using a real FFmpeg engine on this host.</p>
            <fieldset className="native-presets" disabled={working || finished || !source || !health}>
              <legend>OUTPUT FORMAT</legend>
              <div className="native-preset-grid">
                {options.map((option) => (
                  <label key={option.id} className={format === option.id ? "active" : ""}>
                    <input type="radio" name="native-format" value={option.id}
                      checked={format === option.id} onChange={() => setFormat(option.id)}/>
                    <strong>{option.title}</strong>
                    <span>{option.subtitle}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="native-controls">
              <label htmlFor="native-quality">QUALITY</label>
              <select id="native-quality" value={quality} disabled={working || finished || !source}
                onChange={(event) => setQuality(event.target.value as NativeQuality)}>
                <option value="high">Higher quality</option>
                <option value="balanced">Recommended</option>
                <option value="small">Smaller file</option>
              </select>
              {outputKind === "video" && (
                <>
                  <label htmlFor="native-height">MAXIMUM HEIGHT</label>
                  <select id="native-height" value={height ?? "source"} disabled={working || finished || !source}
                    onChange={(event) => setHeight(event.target.value === "source" ? null : Number(event.target.value) as NativeHeight)}>
                    <option value="source">Original dimensions</option>
                    <option value="1080">1080p</option>
                    <option value="720">720p</option>
                    <option value="480">480p</option>
                  </select>
                </>
              )}
            </div>
            <div className="native-consent">
              <label>
                <input type="checkbox" checked={consent} disabled={working || finished || !source || !health}
                  onChange={(event) => setConsent(event.target.checked)}/>
                <span>I approve uploading this file to this self-hosted server for conversion. Files are automatically deleted after the configured retention period.</span>
              </label>
              {health && <small>Retention: up to {Math.ceil(health.retentionSeconds / 60)} minutes · CPU workers: {health.maxActiveJobs} · Source limit: {Math.ceil(health.maxDurationSeconds / 60)} minutes</small>}
            </div>
            {displayedError && state !== "failed" && <div className="native-panel-error" role="alert">{displayedError}</div>}
            <div className="native-panel-bottom">
              <button type="button" className="primary-action" onClick={() => void start()} disabled={!canStart}>
                Convert to {formatLabel} <span aria-hidden="true">↗</span>
              </button>
              <div className="panel-foot"><span aria-hidden="true">◇</span><span>No proprietary processing API. Source code is public.</span></div>
            </div>
          </aside>
        </div>
        <div className="native-under">
          <span><span className="privacy-dot"/> {instructions}</span>
          <a href="/"><span aria-hidden="true">←</span> On-device converter</a>
        </div>
        <section className="native-principles" aria-label="How native processing works">
          <div><span>01 / OPEN</span><strong>Engine independence</strong><p>A containerized FFmpeg engine you can run, modify, and replace.</p></div>
          <div><span>02 / HONEST</span><strong>Real progress</strong><p>Upload bytes and FFmpeg timestamps—not fake countdowns.</p></div>
          <div><span>03 / PRIVATE</span><strong>Delete by default</strong><p>Server jobs expire. Delete your source and results when finished.</p></div>
        </section>
      </main>
      <footer className="app-footer">
        <span>ANY—CONVERT <span className="footer-muted">© 2026</span></span>
        <span className="footer-muted">OPEN BY DESIGN. PRECISE BY NATURE.</span>
        <a href="https://github.com/dovvnloading/Any-Convert" target="_blank" rel="noopener noreferrer">SOURCE CODE ↗</a>
      </footer>
    </div>
  );
}
