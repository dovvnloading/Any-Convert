"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes, formatDuration, isPotentialVideo } from "@/lib/media";

type Inspection =
  | { status: "probing" }
  | { status: "ready"; duration: number; width: number; height: number }
  | { status: "unavailable" };

type Selected = {
  file: File;
  url: string;
  inspection: Inspection;
};

function ArrowIcon({ diagonal = false }: { diagonal?: boolean }) {
  return diagonal ? (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M4.5 15.5 15.5 4.5M6 4.5h9.5V14" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M3.5 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function FilmMark() {
  return (
    <svg className="film-mark" aria-hidden="true" viewBox="0 0 40 40" fill="none">
      <rect x="1" y="1" width="38" height="38" rx="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 10v20m16-20v20M12 14h16m-16 12h16M17 19l7 1-7 1v-2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="7" cy="12" r="1" fill="currentColor" />
      <circle cx="33" cy="28" r="1" fill="currentColor" />
    </svg>
  );
}

export function VideoWorkspace() {
  const picker = useRef<HTMLInputElement>(null);
  const currentUrl = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, []);

  const url = selected?.url;

  useEffect(() => {
    if (!url) return;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      const width = probe.videoWidth;
      const height = probe.videoHeight;
      if (!Number.isFinite(duration) || width <= 0 || height <= 0) {
        setSelected((previous) =>
          previous?.url === url ? { ...previous, inspection: { status: "unavailable" } } : previous,
        );
        return;
      }
      setSelected((previous) =>
        previous?.url === url
          ? { ...previous, inspection: { status: "ready", duration, width, height } }
          : previous,
      );
    };
    probe.onerror = () => {
      setSelected((previous) =>
        previous?.url === url ? { ...previous, inspection: { status: "unavailable" } } : previous,
      );
    };
    probe.src = url;
    return () => {
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [url]);

  function importFile(file?: File) {
    if (!file) return;
    if (!isPotentialVideo(file)) {
      setInputError("Choose a non-empty video file. This workspace doesn't accept other media yet.");
      return;
    }
    setInputError(null);
    const nextUrl = URL.createObjectURL(file);
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = nextUrl;
    setSelected({ file, url: nextUrl, inspection: { status: "probing" } });
  }

  function chooseFile() {
    const input = picker.current;
    if (!input) return;
    // A cancelled dialog must preserve the current file and playable preview.
    // Clearing the input value allows choosing the same file again.
    input.value = "";
    input.click();
  }

  return (
    <div className="site">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Any-Convert home">
          <FilmMark />
          <span>any<span className="brand-divider">/</span>convert</span>
        </a>
        <div className="topbar-right">
          <span className="topbar-note">A better way to work with video.</span>
          <span className="version-tag"><span className="online-dot" /> M0 preview</span>
        </div>
      </header>

      <main id="workspace" className="main">
        <div className="eyebrow">
          <span className="eyebrow-number">01 / 03</span>
          <span>THE VIDEO WORKSPACE</span>
          <span className="eyebrow-rule" />
          <span className="eyebrow-end">FOUNDATION BUILD</span>
        </div>

        <div className="intro">
          <div>
            <h1>Every frame,<br /><em>considered.</em></h1>
          </div>
          <div className="intro-aside">
            <span className="thin-rule" />
            <p>Video conversion should feel effortless. Start with a file; we’ll take care of the details.</p>
            <span className="intro-footnote">Local inspection available now. Conversion is in development.</span>
          </div>
        </div>

        <div className="workspace-grid">
          <section
            className={["preview-stage", dragging && "is-dragging", selected && "has-file"].filter(Boolean).join(" ")}
            aria-label="Video import and preview"
            onDragEnter={(event) => {
              event.preventDefault();
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              importFile(event.dataTransfer.files[0]);
            }}
          >
            <div className="stage-corner stage-corner-tl" />
            <div className="stage-corner stage-corner-tr" />
            <div className="stage-corner stage-corner-bl" />
            <div className="stage-corner stage-corner-br" />

            {dragging ? (
              <div className="drop-message" aria-hidden="true">
                <span className="drop-symbol">+</span>
                Release to inspect video
              </div>
            ) : selected ? (
              <div className="selected-preview">
                {selected.inspection.status === "ready" ? (
                  <>
                  {/* biome-ignore lint/a11y/useMediaCaption: User-provided videos may lack caption tracks; do not claim an empty track is a transcript. */}
                  <video
                    className="preview-video"
                    src={selected.url}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={["Preview of", selected.file.name].join(" ")}
                  />
                  </>
                ) : (
                  <div className="probe-state" role="status">
                    <span className="probe-spinner" aria-hidden="true" />
                    <span>
                      {selected.inspection.status === "probing"
                        ? "Reading video metadata…"
                        : "This browser cannot preview this codec."}
                    </span>
                    {selected.inspection.status === "unavailable" && (
                      <small>Native FFmpeg inspection is part of the next integration milestone.</small>
                    )}
                  </div>
                )}
                <div className="stage-bottom-tag">
                  <span className="tiny-indicator" />
                  {selected.inspection.status === "ready" ? "LOCAL PREVIEW" : "FILE SELECTED"}
                </div>
              </div>
            ) : (
              <div className="empty-preview">
                <div className="import-graphic" aria-hidden="true">
                  <div className="import-graphic-inner">
                    <span className="import-graphic-plus">+</span>
                  </div>
                </div>
                <span className="import-overline">YOUR NEXT PROJECT STARTS HERE</span>
                <h2>Drop your video here.</h2>
                <p>Or browse your files to get started.</p>
                <button className="light-button" type="button" onClick={chooseFile}>
                  Choose a video <ArrowIcon />
                </button>
                <span className="stage-bottom-tag"><span className="tiny-indicator" /> NO UPLOAD REQUIRED FOR INSPECTION</span>
              </div>
            )}
            <input
              ref={picker}
              className="sr-only"
              tabIndex={-1}
              type="file"
              accept="video/*,.mkv,.avi,.mov,.m4v,.wmv"
              aria-label="Choose video file"
              onChange={(event) => importFile(event.target.files?.[0])}
            />
          </section>

          <aside className="inspector" aria-labelledby="inspector-heading">
            <div className="panel-heading">
              <span>01 — FILE INSPECTOR</span>
              <span className="panel-mini-icon" aria-hidden="true">↗</span>
            </div>
            <div className="panel-intro">
              <h2 id="inspector-heading">{selected ? "Your footage." : "A clean start."}</h2>
              <p>{selected ? "A closer look at your original file." : "Your media details will appear here."}</p>
            </div>

            <div className="file-details" aria-live="polite" aria-atomic="true">
              {selected ? (
                <>
                  <div className="detail-row">
                    <span>Filename</span>
                    <strong className="file-name">{selected.file.name}</strong>
                  </div>
                  <div className="detail-row"><span>File size</span><strong>{formatBytes(selected.file.size)}</strong></div>
                  <div className="detail-row"><span>Format</span><strong>{selected.file.name.split(".").pop()?.toUpperCase() ?? "Unknown"}</strong></div>
                  <div className="detail-row">
                    <span>Dimensions</span>
                    <strong>{selected.inspection.status === "ready"
                      ? [selected.inspection.width, selected.inspection.height].join(" × ")
                      : "Not available"}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Duration</span>
                    <strong>{selected.inspection.status === "ready"
                      ? formatDuration(selected.inspection.duration)
                      : "Not available"}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Inspection</span>
                    <strong className="state-value">
                      <span className="state-circle" />
                      {selected.inspection.status === "ready" ? "Ready" : selected.inspection.status === "probing" ? "Reading…" : "Limited"}
                    </strong>
                  </div>
                </>
              ) : (
                <div className="waiting-state">
                  <span className="waiting-icon" aria-hidden="true">↳</span>
                  <span>Awaiting your first file.</span>
                  <small>Format, dimensions, duration and more.</small>
                </div>
              )}
            </div>

            {inputError && <p className="input-error" role="alert">{inputError}</p>}

            <div className="inspector-bottom">
              {selected ? (
                <button type="button" className="dark-button" onClick={chooseFile}>
                  Choose another video <ArrowIcon />
                </button>
              ) : (
                <button type="button" className="dark-button" onClick={chooseFile}>
                  Explore a file <ArrowIcon />
                </button>
              )}
              <div className="coming-next">
                <span className="coming-bar" />
                <span><strong>Coming next</strong><small>Conversion presets, background removal, and export.</small></span>
              </div>
            </div>
          </aside>
        </div>

        <div className="bottom-note">
          <div><span className="local-indicator" /> Your file stays on this device during inspection.</div>
          <a href="https://github.com/dovvnloading/Any-Convert" target="_blank" rel="noopener noreferrer">
            Follow development <ArrowIcon diagonal />
          </a>
        </div>
      </main>
      <footer className="site-footer">
        <span>ANY—CONVERT <span className="footer-muted">© 2026</span></span>
        <span className="footer-muted">TOOLS FOR THE DETAILS THAT MATTER.</span>
        <span>MADE WITH INTENTION.</span>
      </footer>
    </div>
  );
}
