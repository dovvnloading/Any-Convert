# Any-Convert — Technical Architecture

> **Status:** proposed, not implemented. Reviewed 2026-11-09. See [Project Map](../PROJECT_MAP.md) for phases and gates and [Research](RESEARCH_DECISIONS.md) for evidence.

## 1. One product, three execution engines

Build a real, deployed web application, **not GitHub Pages or a static-only site**. GitHub stores code, reviews, CI and releases; the app runs on dynamic hosting with independent compute.

A single typed job/recipe abstraction routes work to:

1. **Browser engine (preferred):** Mediabunny for container parsing/muxing, WebCodecs hardware-assisted encode/decode when the browser/OS actually supports the requested codec pair. Runs in dedicated workers where possible. Never assume a codec is supported just because the extension is familiar.
2. **Native media engine (coverage):** containerized FFmpeg/ffprobe workers for validated source codecs, muxing, audio extraction, GIFs, complex filters, difficult formats and long clips. Workers are separate from request-serving instances.
3. **AI/video-matting engine (advanced):** optional browser WebGPU matting for capable devices; GPU-backed server segmentation + matting for higher quality or unsupported devices. Compositing and alpha encoding are explicit stages.

**Rationale:** WebCodecs supports only codecs supplied by an individual browser/OS and does not itself demux/mux; ffmpeg.wasm is significantly slower than native FFmpeg in its documented benchmarks. The browser should win on privacy and speed when it can, but never at the expense of functionality. Sources: [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), [Mediabunny](https://mediabunny.dev/guide/supported-formats-and-codecs), [ffmpeg.wasm benchmark](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/performance.md).

## 2. Reference architecture

    Browser / Next.js app
      ├── Drop / picker / local metadata probe
      ├── Recipe builder + feature detection
      ├── Preview / progress / diagnostics / results
      ├── Local engine (Mediabunny + WebCodecs; dedicated worker)
      └── Cloud path ONLY after a clear local/cloud decision
              │
              ▼
        Next.js API / session boundary
          ├── Capability registry + validation
          ├── Short-lived, scoped upload/download credentials
          ├── Postgres: uploads, assets, jobs, events, usage
          ├── R2: ephemeral input/output/preview objects
          ├── BullMQ: durable queued jobs via managed Redis/Valkey
          └── SSE progress / polling fallback
                 │
                 ├── Isolated native FFmpeg worker pool (CPU)
                 │     └── ffprobe → filter/transcode/remux → verify
                 └── GPU inference worker (optional)
                       └── decode → object masks → matte → composite
                            → alpha/color encode → verify
              │
              ▼
        Private downloadable output + expiry/deletion

Avoid running long conversions inside serverless route handlers. The public web/API tier is stateless; workers have controlled temporary scratch space, can be scaled separately, and are restartable.

## 3. Concrete, conservative stack choices

| Layer | Recommended baseline | Why / constraint |
| --- | --- | --- |
| UI | Next.js 16.x stable, React 19, TypeScript strict, Tailwind CSS 4, Radix primitives, small Motion usage | Dynamic App Router + first-class TS; pin patch releases after security review. No canary in production |
| UI state | React state for short-lived controls; TanStack Query for server state; a typed finite state machine for media jobs | Prevent impossible visual states; recover across route changes |
| Validation | Zod contracts shared across browser/API/worker | Strict input validation and consistent error codes |
| Browser media | Mediabunny + WebCodecs + Web Workers | Broad container support with browser-dependent hardware codec capability; MPL-2.0 notices required |
| Browser AI spike | @remotion/video-matting + WebGPU (optional, feature-gated) | Models are separate licensed artifacts; VP9-alpha encode support required |
| Native media | FFmpeg + ffprobe installed in pinned container images | Real format coverage, reliable inspection, tested presets; verify build/license profile |
| API persistence | PostgreSQL + migration tool | Durable jobs, upload ownership, audit events |
| Queue | BullMQ + managed Redis/Valkey | Retry, progress and cancellation; at-least-once semantics require idempotency |
| Blob storage | Cloudflare R2 via S3-compatible API | Private objects; signed direct multipart upload for large video |
| CPU compute | Dedicated long-running containers, e.g. Fly/Render/Railway or Kubernetes | ffmpeg subprocess control and per-job isolation |
| GPU compute | Separate on-demand GPU workers/provider, selected only after benchmark | AI cost scaling independent from normal conversions |
| Hosting | Vercel or a Node-compatible host for web/API; independent worker infrastructure | GitHub Actions-based CI/CD; never store media in Git |
| Test/observability | Vitest, Playwright, ffprobe, image/audio comparisons, OpenTelemetry and error tracking | Verify output, not merely HTTP response success |

**Hosting providers are deployment candidates, not signed-off choices.** Choose by reliability, actual CPU/GPU minute cost, egress, file sizes and security posture at Gate G2.

## 4. Media domain and conversion planner

Do not treat file extension as a codec. Probe actual container/streams, codec profiles, time base, pixel format, alpha capability, rotation, variable frame rate, color primaries/transfer, HDR, channel layout, language tracks, duration and bitrates.

Suggested shared contracts:

    Asset: {
      id, inputFilename, bytes, checksum?, mimeClaim,
      probe: {
        container, durationMs, streams[], rotation,
        width?, height?, frameRate?, color?, hdr?, hasAlpha?
      },
      storage: 'browser' | 'private-r2',
      createdAt, expiresAt?
    }

    Recipe: {
      operation: 'convert' | 'audio' | 'gif' | 'frames' | 'matte',
      container, videoCodec?, audioCodec?, audioTrackIds?,
      presetId?, qualityMode: 'recommended'|'smaller'|'higher'|'custom',
      resolution?, fps?, trim?, preserveMetadata?,
      alphaMode?: 'none'|'foreground'|'replace-background',
      background?: {kind:'color'|'image', value:string},
      advanced?: {crf?, bitrate?, profile?, pixelFormat?}
    }

    Capability: {
      supported: boolean, engine: 'local'|'native'|'gpu',
      reasons[], canPreview, canExportAlpha, limits, warnings[]
    }

    Job: {
      id, ownerScopeId, recipe, assetIds[], engine,
      state, stage, progress?: number, attempts, errorCode?,
      outputAssetIds[], createdAt, updatedAt, expiresAt
    }

All contracts should become versioned Zod schemas rather than copy-pasted TypeScript shapes. Presets are **tested codec/container combinations**, not a list of file suffixes. Build a capabilities registry from pinned worker images, verified browser probes and QA results.

### Initial export profiles (pending tests)

| User label | Container / strategy | Notes |
| --- | --- | --- |
| Works everywhere | MP4 + H.264 + AAC | Broad baseline; respect source dimensions and sensible quality; no alpha |
| Modern web | WebM + VP9 + Opus | Fallback to cloud if any component unsupported |
| Smaller file | AV1/HEVC only when verified | Device/encoder dependent; user-facing compatibility warning |
| Keep the original quality | Stream copy/remux when compatible, else high-quality encode | Never call lossy transcode "lossless" |
| Audio only | WAV/FLAC or MP3/AAC | Stream selection and channel conversion tested |
| GIF / frames | GIF palette generation, PNG/JPEG sequence | Explicit fps, size, trim, color limitations |
| Transparent foreground | WebM VP9 alpha, MOV ProRes 4444, or PNG sequence | Container and downstream app alpha compatibility tested individually |
| Custom | Validated advanced settings | Expose only legal, available encoder profiles |

**Input support first:** MP4/MOV/WebM/MKV/AVI plus video + audio variants genuinely handled by the chosen build. Expand only with evidence. Unsupported/proprietary/DRM-damaged content surfaces a meaningful error.

### Conversion-route policy

1. Probe on the client when possible. Ask the server to probe only after consent if remote inspection is needed.
2. Match the requested recipe to a supported local codec/container graph; use `isConfigSupported()` or equivalent browser capability checks, not hardcoded browser sniffing.
3. Estimate resource needs from decoded frame size, duration and browser constraints; local mode is not a promise for large/HEVC/unusual files.
4. If local is viable: show **On your device** and keep bytes local. Download output with a streaming writer/File System Access API when supported, with a Blob fallback for bounded files.
5. Otherwise show **Secure cloud processing** with file size, retention, privacy and any limits before upload. Allow explicit opt-in; offer alternatives if cloud is declined.
6. For AI: test browser GPU/model/codec requirements; if unavailable or quality demands more, explain the cloud GPU option.

A feature-gated ffmpeg.wasm fallback may be useful for tiny isolated operations but is **not the default universal video engine**. Its multithread mode can require cross-origin isolation and significant RAM.

## 5. Job state machine and truthfulness

    idle → selected → probing → readyToConfigure
        → (localProcessing → validating → ready)
        → (awaitingCloudConsent → uploading → uploaded → queued
            → processing → packaging → validating → ready)

Any nonterminal state may transition to `failed` or `cancelled`; ready may become `expired`. Never let the UI show ready until the output object is finalized and verified.

Stages for the cloud path: `upload`, `probe`, `queue`, `decode`, `encode`, `matte`, `package`, `verify`, `ready`. Store sequence-numbered events. SSE subscribes to events and resumes from cursor; long-poll fallback. Provide a separate upload progress meter. Only display a percentage for instrumented work (e.g. FFmpeg `-progress` time vs known duration, transferred bytes, processed frames), avoiding fake countdowns. Indeterminate queue stages can say "Waiting for a worker" with no invented ETA.

Jobs must tolerate page refresh, SSE disconnect, browser close, worker restart, duplicate queue delivery, cancellation races, and retry. Use idempotency keys per job creation and a unique output object namespace. A stale worker must not overwrite a newer attempt's output. Cleanup must be safe under retries.

## 6. API surface (draft)

- `GET /api/capabilities` → versioned tested support matrix, worker build and max limits.
- `POST /api/upload-sessions` → validate declared size/mime, return scoped multipart upload ID.
- `POST /api/upload-sessions/:id/parts` → sign a set of numbered multipart parts; short-lived URLs.
- `POST /api/upload-sessions/:id/complete` → server verifies part list, object size, actual media signatures and ownership.
- `DELETE /api/upload-sessions/:id` → abort multipart upload and garbage collect.
- `POST /api/jobs` → schema-validated recipe and uploaded asset, idempotency key, scoped job ID.
- `GET /api/jobs/:id` → status, stage, progress, error, validated output descriptors.
- `GET /api/jobs/:id/events` → authenticated/scoped SSE stream; resume by last event ID.
- `POST /api/jobs/:id/cancel` → authorization + cooperative cancellation request.
- `POST /api/jobs/:id/retry` → bounded retry of retryable failures.
- `GET /api/jobs/:id/download/:outputId` → authorize and return short-lived private download URL/redirect.
- `DELETE /api/jobs/:id` → cancel if necessary and schedule deletion of associated objects.

Use anonymous, signed, **HttpOnly** scoped session cookies with rotation; no public-guessable job access, and no sensitive information embedded in a URL. Login is optional later and should not be required for basic processing.

## 7. Storage, compute and data protection

- Browser → R2 signed **multipart** (prefer on video-sized files) without proxying large bytes through API. Upload parts can retry/resume. The backend controls part signing, finalization and ownership.
- Use separate private input, preview, intermediate and output namespaces; random object keys, no original filename in keys.
- Default retention proposal: inputs and intermediates expire within 24 hours; completed outputs within 24 hours; actual retention is a launch decision and must be enforced by both lifecycle policy and app deletion workflow.
- Delete-now is user accessible; delete includes partial uploads, generated previews, intermediate alpha/masks, and eventual provider copies if external ML APIs are used.
- Minimize logs: no media contents, signed URLs, raw personal filenames or full prompts. Collect event timings and failure codes with redaction.
- Server-side limits: upload bytes, duration, resolution, tracks, frame count, process wall time, memory/CPU/GPU, per-session concurrent jobs, queue quota and download bandwidth.
- Treat media as hostile input. Use patched pinned binaries, network-disabled sandboxes, nonroot containers, ephemeral scratch directories, no raw shell command concatenation, validated flags/filenames, container CPU/memory/time limits, and restrictive object ACLs.
- Disallow network-capable FFmpeg protocols and external URLs; defend against decompression bombs, malformed probes, subtitle/filter injection, SSRF, CORS/CSRF and resource exhaustion.
- Protect secrets on server only; use private R2 buckets and short-lived bearer URLs. Review model/data policies before sending media to third parties.
- File deletion is asynchronous but provable via audit and cleanup metrics.

## 8. AI background extraction (separate from conversion)

Three distinct features should not be conflated:

- **Remove background:** retain a selected subject and make the rest transparent (requires an *alpha matte*, not just a binary segmentation mask).
- **Replace background:** composite the retained subject over a new solid color/image/video; final MP4 can then be opaque.
- **Extract/clean the background:** reconstruct imagery occluded by a subject via temporal inpainting. This is a **later R&D feature**, never implied by simple matting.

### Model/engine strategy

**Local experiment:** `@remotion/video-matting` exposes WebGPU on-device layer separation. Its current model choices include MODNet (people) and BEN2 Base (general foreground). It requires a usable GPU, browser decode and VP9-alpha encode capability; feature-test all of them. See [Remotion docs](https://www.remotion.dev/docs/video-matting) and [available models](https://www.remotion.dev/docs/video-matting/get-available-models).

**Cloud research:** SAM 3.1 can segment prompted/tracked objects in video, producing masks; it is **not itself a complete fine-hair alpha-matting/export system**. Pair mask selection/tracking with a video-matting/refinement model and test frame coherence. MatAnyone 2 targets high-quality **human** video matting; VideoMaMa++ explores general mask-guided matting. These have **separate, potentially restrictive research/model licenses**; neither is approved for commercial production in this plan. See [SAM 3.1](https://ai.meta.com/blog/segment-anything-model-3/), [MatAnyone 2](https://github.com/pq-yang/MatAnyone2), [VideoMaMa](https://github.com/cvlab-kaist/VideoMaMa).

Suggested pipeline:

    input → normalize frame/timebase/color → subject selection/track
          → coarse per-frame masks → temporal alpha refinement
          → edge/defringe/color cleanup → alpha-aware composite
          → output encoding → full-clip QC → download

Retain original frame timing/audio; decode and process frames with bounded windows, checkpoint if jobs are long, and prevent large unbounded GPU tensors. Provide mask-aware UI controls (subject select, threshold, feather, refine, invert) but avoid pretending every slider can repair failed tracking.

### AI acceptance and benchmark

Create a licensed evaluation set: people/hair, clothing/fine mesh, moving cameras, fast motion, occlusion, multiple subjects, pets/product objects, dark backgrounds and long duration. Compare baseline vs candidates blind for edge detail, temporal flicker, halos, identity persistence, texture, cost per processed minute, speed at 720p/1080p and failure rates. Do not select a model based solely on a marketing demo.

## 9. End-to-end testing

- **Unit:** preset planner, capability negotiation, recipe validation, status transitions, retry and cost/limit logic.
- **Integration:** synthetic fixtures that generate known colors/audio tones/timecodes, convert in real FFmpeg container, then ffprobe and inspect outputs. Include VFR, rotated video, multiple audio tracks, silent video, odd dimensions, corrupted/truncated media, subtitles and alpha sources.
- **A/V correctness:** duration tolerance, dimensions, video frames/PTS monotonicity, audio stream presence/channel count, lip-sync/offset tolerance, rotation, color handling, playable seek and nonzero output.
- **Cross-browser:** desktop Chrome, Safari, Firefox; iOS Safari, Android Chrome; WebCodecs/WebGPU matrix with negative-path tests.
- **E2E:** drop → inspect → preset → local or consented cloud → progress → download; cancel/refresh/retry/delete and expired links.
- **Visual/a11y:** screenshot states at 360/768/1440/1920 widths; keyboard-only, screen reader semantics, axe audits, contrast and reduced motion.
- **Security/operations:** fuzzed media, malicious filename, oversized uploads, stale signed links, duplicate workers, process kill, multipart abort, denial-of-service budgets, unknown error handling.
- **Release validation:** verify output bytes/metadata before ready, not just a process exit status.

## 10. Operational release checklist

- Pinned container images and dependency lockfile; SBOM/license notices, FFmpeg configuration/linked libraries audited.
- Structured traces: `job_id`, stage, worker, elapsed, codec/preset, bytes, ffmpeg exit code (with redacted logs); no raw media data.
- Dashboards: completion rate, job queue age, p50/p95 per-minute transcode speed, cost/processed-minute, local-versus-cloud routing, upload abandonment, GPU error rate, cleanup lag.
- Alerts and kill switches: worker failure rate, queue stall, storage failure, unusual costs, third-party model outage.
- Per-feature flags and rollout; graceful degradation to native conversion when AI is down.
- Runbooks for worker failures, storage incidents, expired multipart uploads, cancellation, refunds/billing if ever introduced.

## Sources and follow-up

Do not assume libraries are production-cleared solely because they are on GitHub. Specific sources, licenses, alternatives and pending validations are indexed in [Research and technology decisions](RESEARCH_DECISIONS.md). Any modification to an approved codec path or model requires passing its corresponding fixture suite and updating the capabilities registry.
