# Any-Convert — Project Map

> **Status:** product definition and engineering plan; implementation has **not** started.  
> **Last reviewed:** 2026-11-09.  
> **Start here:** this document is the source of truth for scope, priorities, release gates, and execution order.

## Read this first

- [Architecture and media pipeline](docs/ARCHITECTURE.md) — systems, codec strategy, API contracts, storage, security, and failure recovery.
- [Experience and visual design](docs/EXPERIENCE_SPEC.md) — flows, interface anatomy, design tokens, accessibility, and interaction quality.
- [Research and technology decisions](docs/RESEARCH_DECISIONS.md) — verified sources, alternatives, licensing caveats, spikes, and evaluation methodology.

**North star:** the most effortless, trustworthy place to convert and transform video, with professional-quality results and almost no interface complexity.

**Product promise:** `Open → inspect → choose → convert → preview → download`. No signup for the core task. Local when supported; secure cloud processing when necessary and only after clear notice. The complexity lives in the engine, not the UI.

**Crucial limitation:** "any format" is an aspiration for broad compatibility, **not** a literal guarantee. Support is determined by container, actual audio/video codecs, input health, available encoders, licensing, and deployment. Never claim DRM-protected or unsupported media can be converted. Expose capabilities truthfully.

## Product boundaries

| Priority | Feature | Acceptance rule |
| --- | --- | --- |
| P0 | Drag/drop, paste/file picker, inspect metadata | Error-free path to playable preview for supported input; unsupported preview has a clear proxy/fallback |
| P0 | MP4 H.264/AAC, WebM VP9/Opus and other validated export presets | Result passes ffprobe + playability, with correct duration, A/V sync, and expected dimensions |
| P0 | Audio extraction (MP3/WAV/FLAC), GIF, frame capture | Correct streams and output files; accurate naming |
| P0 | Local fast path + background server conversion | Tested capability routing; no silent server upload while labeled "on device" |
| P0 | Resumable uploads, persistent jobs, progress, cancel, download | Survives refresh and worker restart; clear retry and deletion behavior |
| P0 | No account required; privacy and resource limits | Transparent retention policy, ephemeral ownership tokens, rate limits |
| P1 | AI remove background / transparent subject export | Frame-stable alpha, quality preview, clear model limitations and GPU fallback |
| P1 | Subject selection, mask refinement and background replacement | Keyboard-accessible controls, scrubbable preview, before/after verification |
| P1 | Batch queue and ZIP/export-all | Independent file status, cancellation, retry |
| P2 | Advanced presets, captions/subtitle flows, codec matrix expansion | Validated individually with fixtures |
| Later | Automatic background inpainting / clean plate, collaborative workspaces, API | Separate R&D and explicit cost/license review |

### Explicitly not in v1

- No general document/3D/office conversion, full timeline editor, generative video editor, or account/paywall wall.
- No arbitrary URL ingest or remote-file fetching (security and abuse risk).
- No unsupported promise that all conversions happen locally, all formats are lossless, or any arbitrary background can be perfectly reconstructed.
- No GPU-heavy feature exposed as unlimited or permanently free without measured cost controls.

## Product principles (non-negotiable)

1. **One primary action per stage.** Upload, customize, convert, download; no competing marketing panels.
2. **Default is intelligent.** Recommend a valid preset from input metadata and target intent; make Advanced optional.
3. **Fast path first, honest fallback.** Capability-test WebCodecs/WebGPU; otherwise queue a native worker. Never bounce the user through cryptic errors.
4. **Never fake status.** Show explicit upload/inspect/queue/process/package/ready phases; percentages only when observable.
5. **Files are private by default.** Do not persist original content on cloud path longer than needed; allow manual deletion.
6. **Professional fidelity.** Preserve rotation, aspect, frame rate by default, color tags/HDR when the chosen path supports them, audio sync and metadata intentionally.
7. **Beautiful because it is disciplined.** Typography, rhythm, generous negative space, high-quality preview. No decorative dashboard filler, giant gradients, glassmorphism, or animation for its own sake.
8. **A feature is not finished until it has failure UX, accessibility, analytics, tests, and a documented supported range.**

## Intended users and primary jobs

- **Everyday:** "Make this video work everywhere." Default MP4 with source-aware quality controls; send users directly to download.
- **Creator:** "Extract just the audio, make a GIF, resize for social, or generate stills." Low-friction presets and live dimensions.
- **Editor:** "Isolate a moving subject with transparent edges." Scrubbable checkerboard, mask quality controls, alpha-aware outputs.
- **Professional:** "Convert a difficult MOV/MKV/HEVC file without destroying color or audio." Full probe details and fallback to native pipeline.

## Execution map

These are ordered work packages, not calendar promises. No phase is considered complete because a UI demo happens to look convincing.

### Phase 0 — Foundations and proof (M0)

- [ ] P0-01 Bootstrap pnpm + TypeScript monorepo (web, media-worker, optional ml-worker, shared types/UI).
- [ ] P0-02 CI: install, typecheck, lint, tests, build, dependency/license audits, PR previews.
- [ ] P0-03 Create deterministic media fixture suite and an automated ffprobe/ffmpeg result validator.
- [ ] P0-04 Spike WebCodecs + Mediabunny on Chrome, Safari, Firefox and representative mobile devices; record tested capabilities by browser.
- [ ] P0-05 Spike native FFmpeg container, codec builds, performance and license profile; establish supported input/output matrix.
- [ ] P0-06 Validate background-matting options, output alpha support and model licenses BEFORE choosing a production inference path.
- [ ] P0-07 Review privacy, abuse limits, per-minute costs, file lifetimes, and hosting assumptions.
- **Exit gate:** a runnable skeleton, 10+ representative conversion fixtures, reproducible backend FFmpeg pipeline, browser feature-matrix, and documented Go/No-Go for each risky dependency.

### Phase 1 — The product surface (M1)

- [ ] P1-01 Build tokens, typography, responsive app shell, command/keyboard patterns, and shared accessible primitives.
- [ ] P1-02 Implement zero-state upload, drag/drop, paste, browse and validation, with persistent upload state.
- [ ] P1-03 Build file probe/details, a truthful capabilities panel, browser-playable preview/proxy state, and a focused format picker.
- [ ] P1-04 Build state-based workspace, smart defaults, progress, result preview, and download states.
- [ ] P1-05 Test 360px to ultrawide layouts; keyboard navigation, screen reader, reduced motion and WCAG 2.2 AA.
- **Exit gate:** pixel-reviewed screens for empty, selected, processing, ready, error and unsupported states; usable end-to-end with a mock engine, no dead controls.

### Phase 2 — Real conversion, end to end (M2)

- [ ] P2-01 Capability-gated local transcode/remux path using Mediabunny + WebCodecs, in workers where feasible.
- [ ] P2-02 Implement API, upload session, R2 multipart direct upload, queue, durable job records and scoped result URLs.
- [ ] P2-03 Native FFmpeg worker container, presets, ffprobe, progress parsing, resource limits and cancellation.
- [ ] P2-04 Ensure retries/idempotency, resumable upload and refresh resilience; validate local→cloud opt-in.
- [ ] P2-05 Ship initial presets: universal MP4, WebM, retain-quality, audio extraction, GIF, thumbnails.
- **Exit gate:** no demo placeholders; every advertised format exercised in CI; cancellations work; large-file upload resumes; output is verified before marking ready.

### Phase 3 — AI subject isolation (M3)

- [ ] P3-01 Deliver browser capability/quality spike for WebGPU matting. Only offer it on genuinely supported devices.
- [ ] P3-02 Add server GPU segmentation/matting pipeline behind a replaceable model adapter.
- [ ] P3-03 Subject select, keep/remove correction, scrub/edge inspection, before/after, replacement color/image.
- [ ] P3-04 Produce verified transparent outputs (WebM with alpha, MOV ProRes 4444, PNG sequence where supported); never promise alpha in standard H.264 MP4.
- [ ] P3-05 Benchmark temporal stability, fine edges, motion blur, long clips and compute cost; exclude unlicensed models.
- **Exit gate:** benchmark report, clear quality/failure warnings, and export files validated in target applications; no use of models without production-rights approval.

### Phase 4 — AAA polish and hardening (M4)

- [ ] P4-01 Test complete journeys with real users and benchmark against leading converter/editing experiences.
- [ ] P4-02 Tune first interaction, inspect/preview speed, repeated jobs, upload throughput, memory and worker startup.
- [ ] P4-03 Audit accessibility, security, media fuzz cases, privacy deletion, cost controls, and rate limiting.
- [ ] P4-04 Add crash-safe recovery, observability, structured errors, trace IDs, and actionable support diagnostics.
- [ ] P4-05 Browser/device matrix, visual regressions, AV-sync/corruption tests, preview/download reliability.
- **Exit gate:** meet all release KPIs and no P0/P1 defects. Release behind an operationally controllable feature flag.

### Phase 5 — Scale and expand (M5+)

- [ ] Expand validated codec/container matrix by real user demand and legal review.
- [ ] Introduce batching, shareable recipes, local-only privacy mode, advanced HDR/alpha export profiles.
- [ ] Improve model quality with blinded evaluations; investigate clean-plate inpainting separately.
- [ ] Publish conversion-capability documentation and honest per-preset limitations.

## Quality bar / launch criteria

| Dimension | Pre-launch target |
| --- | --- |
| Conversion correctness | ≥99% passing rate on the fixed **supported** fixture matrix; ffprobe checks and real playback validation |
| Safety | Zero known critical/high vulnerabilities; untrusted media isolated; no cross-user asset access |
| Accessibility | WCAG 2.2 AA target; full keyboard workflow, visible focus, appropriate announcements, reduced-motion alternative |
| Performance | On representative mid-range hardware: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 on the main workspace; measure mobile separately |
| Responsiveness | Interaction feedback under 100ms on supported devices; no main-thread transcoding/matting |
| Reliability | No silent jobs; every job reaches a terminal state or a documented recoverable timeout; refresh/reconnect tested |
| Privacy | Clear local/cloud labeling; delete-now control; automatic expiration verified with tests |
| UX | Default single-file happy path: upload → format → convert → download with no account or unrelated interruption |
| Visual craft | Human-reviewed desktop + mobile screenshots for every workflow state; no placeholder copy, skeleton screens or disconnected controls |

Targets are **goals, not current measurements**. Establish benchmarks in Phase 0 and adjust with documented evidence.

## Suggested build organization (not created yet)

    apps/
      web/                  # Next.js App Router; UI + authenticated/scoped API endpoints
      media-worker/         # Long-lived isolated FFmpeg workers
      ml-worker/            # Optional separately deployable Python/GPU inference
    packages/
      contracts/            # Zod schemas, API/event contracts, types
      media-core/           # Codec registry, preset planner, capability routing
      ui/                   # Tokens and accessible components
      observability/        # Structured telemetry/events
    infra/                  # Docker, deployment, storage/queue provisioning
    tests/
      fixtures/             # Synthetic/generated small licensed samples
      integration/          # Encode/inspect result validation
      e2e/                  # Playwright app workflows
      visual/               # Baseline captures
    docs/
      ARCHITECTURE.md
      EXPERIENCE_SPEC.md
      RESEARCH_DECISIONS.md
    PROJECT_MAP.md

## Decision gates and owners

| Gate | Decision | Evidence needed |
| --- | --- | --- |
| G1 | Local converter is worth shipping? | Matrix of supported inputs/outputs, 1GB memory and performance tests, Safari + mobile results |
| G2 | Worker hosting and max job size | Real cost of CPU minutes, egress, storage and concurrency; crash simulation |
| G3 | AI model family | Commercial terms, hair/transparent-object benchmark, temporal jitter, GPU cost and latency |
| G4 | Alpha export list | Decoder/playback tests across editing tools; independent alpha validation |
| G5 | Open beta | KPI dashboard, accessible flows, operational runbook, security review, cost ceiling |

No assumptions about pricing, maximum upload size, output codec support or guaranteed conversion speed should become product copy until these gates are passed.

## How to use this map

- Start each PR with the relevant phase/task ID, objective, tests, screenshots (for UI), and expected output.
- Add decision records to [Research and technology decisions](docs/RESEARCH_DECISIONS.md) when evidence changes a default.
- Update checkboxes **only after** running tests and checking the exit gate.
- Keep a single roadmap; avoid multiple contradictory backlogs.
- Make small vertical-slice PRs. Do not build every UI screen before the media engine is exercised.
- Prefer measuring and shipping a narrow, exceptional experience over superficially supporting 300 formats.

**The next implementation PR should do P0-01 through P0-03, not jump straight to visual polish.**
