"use client";

import { useEffect, useRef, useState } from "react";
import {
  FORMATS,
  MAX_LOCAL_BYTES,
  getFormat,
  isAudioFormat,
  safeOutputName,
  validFormats,
  validProgress,
} from "@/lib/converter-contract";
import type {
  FormatId, HeightLimit, MediaInfo, QualityId, WorkerResponse,
} from "@/lib/converter-contract";
import { formatBytes, formatDuration } from "@/lib/media";

type Stage = "idle" | "inspecting" | "ready" | "preparing" | "converting" | "verifying" | "done" | "error";
type Source = { file: File; url: string };
type Result = { url: string; name: string; bytes: number; mime: string; preset: FormatId };

function Icon({ name, size = 18 }: { name: "arrow" | "upload" | "check" | "close" | "shield" | "repeat" | "film" | "download" | "spark" | "pause"; size?: number }) {
  const common = { stroke: "currentColor", strokeWidth: 1.65, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths = {
    arrow: <path d="M4 10h12m-5-5 5 5-5 5" />,
    upload: <><path d="M10 13V3m-4 4 4-4 4 4" /><path d="M3 13v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></>,
    check: <path d="m4 10 4 4 8-8" />,
    close: <path d="M5 5 15 15M15 5 5 15" />,
    shield: <><path d="M10 2 17 5v5c0 4-3 6.7-7 8-4-1.3-7-4-7-8V5Z" /><path d="m7 10 2 2 4-4" /></>,
    repeat: <><path d="M3 8a7 7 0 0 1 13-3l1.5 2.5M17 12a7 7 0 0 1-13 3l-1.5-2.5" /><path d="M13 7.5h4.5V3M7 12.5H2.5V17" /></>,
    film: <><rect x="3" y="3" width="14" height="14" rx="3"/><path d="M7 3v14m6-14v14M3 7h14M3 13h14"/></>,
    download: <><path d="M10 3v11m-4-4 4 4 4-4"/><path d="M3 14v3h14v-3"/></>,
    spark: <><path d="m10 2 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/></>,
    pause: <><path d="M7 5v10m6-10v10"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" {...common}>{paths[name]}</svg>;
}

function BrandMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 38 38" fill="none">
      <rect x="1" y="1" width="36" height="36" rx="10" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M12 9v20m14-20v20M12 14h14m-14 11h14" stroke="currentColor" strokeWidth="1.4"/>
      <path d="m17 17 6 2-6 2v-4Z" fill="currentColor"/>
    </svg>
  );
}

function formatCodec(value: string | null): string {
  return value ? value.toUpperCase() : "—";
}

function prettyStage(stage: Stage): string {
  switch (stage) {
    case "inspecting": return "Inspecting your file";
    case "preparing": return "Preparing local engine";
    case "converting": return "Converting your media";
    case "verifying": return "Verifying the output";
    case "done": return "Ready to download";
    case "error": return "Something didn't work";
    default: return "Ready to convert";
  }
}

export function VideoWorkspace() {
  const pickerRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const activeIdRef = useRef(0);
  const dragDepthRef = useRef(0);

  const [source, setSource] = useState<Source | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [format, setFormat] = useState<FormatId>("mp4");
  const [quality, setQuality] = useState<QualityId>("source");
  const [height, setHeight] = useState<HeightLimit>("original");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [previewResult, setPreviewResult] = useState(true);
  const [previewError, setPreviewError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const busy = stage === "inspecting" || stage === "preparing" || stage === "converting" || stage === "verifying";
  const processing = stage === "preparing" || stage === "converting" || stage === "verifying";
  const supported = info ? validFormats(info) : [];
  const selection = getFormat(format);
  const isAudio = isAudioFormat(format);
  const showingResult = Boolean(stage === "done" && result && previewResult);
  const currentPreview = showingResult && result ? result.url : source?.url;
  const hasPreviewVideo = Boolean(showingResult ? result && !isAudioFormat(result.preset) : info?.hasVideo);
  const hasPreviewAudio = Boolean(showingResult ? result && isAudioFormat(result.preset) : info?.hasAudio && !info.hasVideo);

  function stopWorker(): void {
    activeIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
  }

  function clearResult(): void {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setResult(null);
    setPreviewResult(false);
    setPreviewError(false);
  }

  function resetOptions(): void {
    setQuality("source");
    setHeight("original");
    setProgress(null);
    clearResult();
  }

  function createWorker(id: number, onResponse: (message: WorkerResponse) => void): Worker | null {
    try {
      // The worker owns the potentially expensive media pipeline, never the UI.
      const worker = new Worker(new URL("../lib/media.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (activeIdRef.current !== id || event.data.id !== id) return;
        onResponse(event.data);
      };
      worker.onerror = () => {
        if (activeIdRef.current !== id) return;
        worker.terminate();
        workerRef.current = null;
        setStage("error");
        setError("The local media engine couldn't start. Try an up-to-date Chrome, Edge, or Safari browser.");
      };
      return worker;
    } catch {
      setStage("error");
      setError("This browser doesn't support the media worker needed for conversion.");
      return null;
    }
  }

  function importFile(file?: File): void {
    if (!file) return;
    if (file.size <= 0) {
      setError("That file is empty. Choose a video or audio file.");
      return;
    }
    if (file.size > MAX_LOCAL_BYTES) {
      setError("This browser-only release supports files up to 256 MB. Larger jobs will need the future cloud engine.");
      return;
    }
    stopWorker();
    clearResult();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    const inputUrl = URL.createObjectURL(file);
    sourceUrlRef.current = inputUrl;
    setSource({ file, url: inputUrl });
    setInfo(null);
    setStage("inspecting");
    setFormat("mp4");
    resetOptions();
    setError(null);
    const id = activeIdRef.current;
    const worker = createWorker(id, (message) => {
      if (message.type === "inspected") {
        workerRef.current?.terminate();
        workerRef.current = null;
        setInfo(message.info);
        setFormat(message.info.hasVideo ? "mp4" : "mp3");
        setStage("ready");
      } else if (message.type === "error") {
        workerRef.current?.terminate();
        workerRef.current = null;
        setError(message.message);
        setStage("error");
      }
    });
    worker?.postMessage({ type: "inspect", id, file });
  }

  function openPicker(): void {
    if (busy) return;
    if (!pickerRef.current) return;
    // Allow reselecting the same file; cancel doesn't discard the current one.
    pickerRef.current.value = "";
    pickerRef.current.click();
  }

  function changeFormat(id: FormatId): void {
    if (busy) return;
    setFormat(id);
    clearResult();
    setStage("ready");
    setError(null);
    setProgress(null);
  }

  function changeQuality(id: QualityId): void {
    if (busy) return;
    setQuality(id);
    clearResult();
    setStage("ready");
  }

  function changeHeight(id: HeightLimit): void {
    if (busy) return;
    setHeight(id);
    clearResult();
    setStage("ready");
  }

  function startConversion(): void {
    if (!source || !info || busy || !supported.includes(format)) return;
    stopWorker();
    clearResult();
    setError(null);
    setProgress(null);
    setStage("preparing");
    const id = activeIdRef.current;
    const worker = createWorker(id, (message) => {
      if (message.type === "stage") {
        setStage(message.stage);
      } else if (message.type === "progress") {
        setProgress(validProgress(message.progress));
      } else if (message.type === "complete") {
        // This message only occurs after the engine independently validates
        // the resulting container and streams.
        const output = new Blob([message.buffer], { type: message.mime });
        const nextUrl = URL.createObjectURL(output);
        resultUrlRef.current = nextUrl;
        setResult({
          url: nextUrl,
          name: safeOutputName(source.file.name, message.extension),
          bytes: message.bytes,
          mime: message.mime,
          preset: message.extension,
        });
        setStage("done");
        setProgress(100);
        setPreviewResult(true);
        setPreviewError(false);
        workerRef.current?.terminate();
        workerRef.current = null;
      } else if (message.type === "error") {
        workerRef.current?.terminate();
        workerRef.current = null;
        setStage("error");
        setError(message.message);
      }
    });
    worker?.postMessage({ type: "convert", id, file: source.file, preset: format, quality, height });
  }

  function cancelConversion(): void {
    stopWorker();
    setStage("ready");
    setProgress(null);
    setError(null);
  }

  function clearFile(): void {
    stopWorker();
    clearResult();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = null;
    setSource(null);
    setInfo(null);
    setStage("idle");
    setError(null);
    setProgress(null);
    setDragging(false);
    dragDepthRef.current = 0;
  }

  const progressLabel = progress !== null && stage === "converting"
    ? String(progress).concat("%")
    : null;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Any-Convert home"><BrandMark/><span>any<span className="brand-divider">/</span>convert</span></a>
        <nav className="top-nav" aria-label="Main navigation">
          <a className="nav-active" href="#workspace">Converter</a>
          <a href="#privacy">Privacy</a>
          <a href="https://github.com/dovvnloading/Any-Convert" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        </nav>
        <div className="header-status"><span className="status-dot"/><span>ON-DEVICE PROCESSING</span></div>
      </header>

      <main className="main-content" id="workspace">
        <div className="section-kicker"><span>THE MEDIA WORKSPACE</span><span className="section-kicker-line"/><span>V1 / LOCAL EDITION</span></div>
        <section className="hero-section">
          <div>
            <h1>Goodbye, format<br/><span>friction.</span></h1>
          </div>
          <div className="hero-side">
            <div className="hero-rule"/>
            <p>The little details, beautifully handled. Convert video and extract audio without uploads, signups, or guesswork.</p>
            <span>BUILT FOR THE FILE YOU HAVE. AND THE FORMAT YOU NEED.</span>
          </div>
        </section>

        <div className="workflow-topline">
          <span><span className="step-index">01</span> INPUT & PREVIEW</span>
          <span><span className="step-index">02</span> EXPORT SETTINGS</span>
        </div>

        <div className="workspace-grid">
          <section
            className={["media-stage", dragging && "is-dragging", Boolean(source) && "has-media"].filter(Boolean).join(" ")}
            aria-label="Media import and preview"
            onDragEnter={(event) => {
              event.preventDefault();
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              dragDepthRef.current += 1;
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = busy ? "none" : "copy";
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
              if (dragDepthRef.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepthRef.current = 0;
              setDragging(false);
              if (!busy) importFile(event.dataTransfer.files[0]);
            }}
          >
            <div className="stage-border stage-top-left"/><div className="stage-border stage-top-right"/>
            <div className="stage-border stage-bottom-left"/><div className="stage-border stage-bottom-right"/>
            <input
              ref={pickerRef} className="sr-only" tabIndex={-1}
              type="file" accept="video/*,audio/*,.mkv,.mov,.avi,.m4a,.flac,.webm,.mp3,.wav,.ogg,.m4v"
              aria-label="Choose an audio or video file"
              onChange={(event) => importFile(event.target.files?.[0])}
            />
            {dragging && !busy ? (
              <div className="drop-overlay" aria-hidden="true"><div className="drop-plus">+</div>Drop to inspect</div>
            ) : !source ? (
              <div className="empty-stage">
                <div className="import-orbit" aria-hidden="true"><span>+</span></div>
                <span className="stage-eyebrow">IT STARTS WITH ONE FILE</span>
                <h2>Drop something good.</h2>
                <p>Video, audio, and everything in between.</p>
                <button type="button" className="light-button" onClick={openPicker}>Choose a file <Icon name="arrow"/></button>
                <span className="stage-subline">UP TO 256 MB <span className="subline-divider"/> STAYS ON YOUR DEVICE</span>
                {error && !source && <div className="stage-error" role="alert">{error}</div>}
              </div>
            ) : (
              <div className="loaded-stage">
                <div className="stage-file-row">
                  <span className="stage-file-status"><span className="status-dot"/> {showingResult ? "OUTPUT PREVIEW" : "INPUT PREVIEW"}</span>
                  <div className="stage-file-actions">
                    <span className="stage-file-size">{formatBytes(showingResult && result ? result.bytes : source.file.size)}</span>
                    <button type="button" onClick={openPicker} disabled={busy}>Replace</button>
                    <button type="button" onClick={clearFile} disabled={processing} aria-label="Remove selected media">Remove</button>
                  </div>
                </div>
                <div className="preview-body">
                  {currentPreview && hasPreviewVideo && !previewError ? (
                    // User-supplied video may not include caption tracks. Do not invent them.
                    // biome-ignore lint/a11y/useMediaCaption: arbitrary user input has no guaranteed captions
                    <video
                      key={currentPreview} className="media-preview" src={currentPreview}
                      controls playsInline preload="metadata"
                      onError={() => setPreviewError(true)}
                      aria-label="Video file preview"
                    />
                  ) : currentPreview && hasPreviewAudio && !previewError ? (
                    <div className="audio-preview">
                      <div className="audio-art" aria-hidden="true"><span>♫</span></div>
                      <p>Listen to your {showingResult ? "converted" : "original"} audio</p>
                      <audio key={currentPreview} src={currentPreview} controls onError={() => setPreviewError(true)} aria-label="Audio file preview"/>
                    </div>
                  ) : (
                    <div className="no-preview">
                      <span className="no-preview-icon"><Icon name="film" size={34}/></span>
                      <h3>{stage === "inspecting" ? "Reading your file" : "Preview unavailable"}</h3>
                      <p>{stage === "inspecting"
                        ? "Checking the container and available tracks…"
                        : "This browser can't preview this codec. Local conversion may still be possible."}</p>
                    </div>
                  )}
                </div>
                {stage === "done" && result ? (
                  <div className="preview-switch" role="group" aria-label="Preview selection">
                    <button type="button" className={!previewResult ? "selected" : ""} onClick={() => { setPreviewResult(false); setPreviewError(false); }}>Original</button>
                    <button type="button" className={previewResult ? "selected" : ""} onClick={() => { setPreviewResult(true); setPreviewError(false); }}>Converted</button>
                  </div>
                ) : null}
                {processing && (
                  <div className="processing-scrim">
                    <div className="processing-box">
                      <div className="spinner" aria-hidden="true" />
                      <p>{prettyStage(stage)}</p>
                      <strong>{progressLabel ?? "Working…"}</strong>
                      <div className="progress-line" role={progressLabel ? "progressbar" : "status"}
                        aria-label={prettyStage(stage)}
                        aria-valuemin={progressLabel ? 0 : undefined}
                        aria-valuemax={progressLabel ? 100 : undefined}
                        aria-valuenow={progressLabel && progress !== null ? progress : undefined}>
                        <span style={{ width: progressLabel ? String(progress).concat("%") : "0%" }}/>
                      </div>
                      <button type="button" onClick={cancelConversion} className="cancel-processing">Cancel conversion</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="stage-caption"><span className="caption-indicator"/> {source ? prettyStage(stage).toUpperCase() : "YOUR FILES NEVER LEAVE THIS DEVICE"}</div>
          </section>

          <aside className="config-panel" aria-labelledby="config-heading">
            <div className="config-header"><span>EXPORT WORKSPACE</span><span className="config-index">↗</span></div>
            <div className="config-intro">
              <h2 id="config-heading">{source ? "Make it yours." : "Ready when you are."}</h2>
              <p>{source ? "Choose the result. We'll handle the rest." : "Your export options appear when you add a file."}</p>
            </div>
            {source && info && (
              <>
                <div className="source-summary">
                  <div className="source-heading"><strong title={source.file.name}>{source.file.name}</strong><button type="button" disabled={busy} onClick={openPicker} aria-label="Replace media file"><Icon name="repeat" size={15}/></button></div>
                  <div className="source-tags">
                    <span>{formatBytes(source.file.size)}</span>
                    <span>{info.width && info.height ? [info.width, info.height].join(" × ") : "Audio"}</span>
                    <span>{info.duration ? formatDuration(info.duration) : "Duration unknown"}</span>
                    {info.videoCodec && <span>{formatCodec(info.videoCodec)}</span>}
                  </div>
                </div>
                <fieldset className="format-fieldset" disabled={busy}>
                  <legend className="field-heading">OUTPUT FORMAT <span>{selection.group === "video" ? "VIDEO" : "AUDIO"}</span></legend>
                  <div className="format-options">
                    {FORMATS.filter((item) => supported.includes(item.id)).map((item) => (
                      <label key={item.id} className={["format-option", format === item.id && "is-selected"].filter(Boolean).join(" ")}>
                        <input type="radio" name="output-format" value={item.id} checked={format === item.id} onChange={() => changeFormat(item.id)} />
                        <span className="format-top"><strong>{item.label}</strong><span className="format-select-mark">{format === item.id && <Icon name="check" size={13}/>}</span></span>
                        <small>{item.detail}</small>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {!isAudio && (
                  <>
                    <fieldset className="quality-fieldset" disabled={busy}>
                      <legend className="field-heading">OUTPUT QUALITY</legend>
                      <div className="quality-control">
                        {([
                          ["source", "Original"],
                          ["balanced", "Balanced"],
                          ["compact", "Smaller"],
                        ] as const).map(([value, label]) => (
                          <label key={value} className={quality === value ? "is-selected" : ""}>
                            <input type="radio" name="quality" value={value} checked={quality === value} onChange={() => changeQuality(value)} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="setting-row">
                      <label htmlFor="resolution">RESOLUTION</label>
                      <select id="resolution" value={height} disabled={busy} onChange={(event) => changeHeight(event.target.value as HeightLimit)}>
                        <option value="original">Original size</option>
                        <option value="1080">Up to 1080p</option>
                        <option value="720">Up to 720p</option>
                        <option value="480">Up to 480p</option>
                      </select>
                    </div>
                    <p className="settings-note">{quality === "source" && height === "original"
                      ? "Compatible tracks are copied without re-encoding when possible."
                      : "Quality or resolution changes require re-encoding and may take longer."}</p>
                  </>
                )}
                {isAudio && <p className="audio-note">Audio is extracted from the primary audio track. Video is excluded from the output.</p>}
              </>
            )}
            {!info && (
              <div className="empty-settings">
                <div className="empty-line"/><div className="empty-line short"/><div className="empty-line"/>
                <span>{source ? "Inspecting the file…" : "Formats, quality, and export controls."}</span>
              </div>
            )}
            <div className="config-bottom">
              {stage === "done" && result ? (
                <>
                  <a href={result.url} download={result.name} className="primary-action" aria-label={["Download", result.name].join(" ")}>
                    Download {result.preset.toUpperCase()} <Icon name="download"/>
                  </a>
                  <div className="result-details" role="status"><Icon name="check" size={15}/><span>Verified output · {formatBytes(result.bytes)}</span></div>
                  <button type="button" className="text-action" onClick={() => changeFormat(format)}>Convert another format <Icon name="repeat" size={14}/></button>
                </>
              ) : (
                <button type="button" className="primary-action" onClick={startConversion} disabled={!info || busy}>
                  {processing ? prettyStage(stage) : "Convert ".concat(selection.label)} <Icon name={processing ? "pause" : "arrow"}/>
                </button>
              )}
              {error && (
                <div className="error-message" role="alert"><span>Couldn't complete</span><p>{error}</p></div>
              )}
              <div className="panel-foot"><Icon name="shield" size={17}/><span>Processed locally, stored nowhere.</span></div>
            </div>
          </aside>
        </div>

        <div className="workspace-foot">
          <div><span className="privacy-dot"/><strong>Private by design.</strong> No upload. No account. No watermark.</div>
          <div>{source ? "SOURCE: ".concat(source.file.name.slice(0, 55)) : "BUILT TO GET OUT OF YOUR WAY."}</div>
        </div>

        <section className="below-workspace" id="privacy" aria-labelledby="privacy-heading">
          <div className="below-heading"><span>GOOD TO KNOW</span><h2 id="privacy-heading">Nothing leaves your browser.</h2></div>
          <div className="below-grid">
            <div className="below-item"><span className="below-number">01</span><strong>Private by default</strong><p>Your selected media is read and converted locally. We don't upload it to our servers or save it to an account.</p></div>
            <div className="below-item"><span className="below-number">02</span><strong>Actual conversion</strong><p>Real encoding, progress and output verification. Download your result when it is ready; no fake completion screens.</p></div>
            <div className="below-item"><span className="below-number">03</span><strong>Honest compatibility</strong><p>Up to 256 MB for this local release. Available codecs depend on your browser. AI masking and larger cloud jobs are in development.</p></div>
          </div>
        </section>
      </main>
      <footer className="app-footer">
        <span>ANY—CONVERT <span className="footer-muted">© 2026</span></span>
        <span className="footer-muted">SIMPLE ON THE SURFACE. SERIOUS UNDERNEATH.</span>
        <a href="https://github.com/dovvnloading/Any-Convert" target="_blank" rel="noopener noreferrer">OPEN SOURCE ↗</a>
      </footer>
    </div>
  );
}
