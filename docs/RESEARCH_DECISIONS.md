# Any-Convert — Research, Decision Log & Validation Plan

> **Research snapshot:** 2026-11-09. This is an evidence-backed proposal, **not** evidence the product is already implemented or benchmarked. Product priorities live in [Project Map](../PROJECT_MAP.md).

## 0. Repository baseline

The repository started with only a 2-line README and an Apache-2.0 LICENSE, on `main`. There is no existing web framework, media engine, test suite, deployment or design system. This is therefore a greenfield architecture. Do not claim to preserve a nonexistent app.

## 1. Findings that materially determine architecture

| Research question | Verified finding | Decision |
| --- | --- | --- |
| Can WebCodecs handle every media file? | No. Browser/OS codecs vary, and the API does not perform mux/demux by itself. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), [W3C 2026 draft](https://www.w3.org/TR/webcodecs/) | Use explicit capability tests and a separate mux/demux library; do not claim universal local support |
| Does a web media library remove the need for FFmpeg? | Mediabunny handles multiple containers, streaming I/O and WebCodecs-based media conversion, but codec availability still depends on browser support. [Mediabunny](https://mediabunny.dev/guide/introduction), [matrix](https://mediabunny.dev/guide/supported-formats-and-codecs) | Browser fast path for verified combinations, not universal backend |
| Should ffmpeg.wasm be the primary engine? | Official performance comparisons show it can be dramatically slower than native FFmpeg, including multi-thread mode. [Benchmark](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/performance.md), [FAQ](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/faq.md) | Optional bounded fallback only; use native CPU worker for broad conversion |
| What should be used for complex video work? | FFmpeg supports a large library of formats/codecs but exact support varies by build. [FFmpeg general docs](https://ffmpeg.org/general.html) | Native FFmpeg + ffprobe in pinned, tested container images |
| Can video background removal run locally? | Remotion exposes WebGPU video matting with model feature detection; browser decode and VP9-alpha encoding are prerequisites. [Remotion video matting](https://www.remotion.dev/docs/video-matting) | Probe real browser/OS capability; make local AI opt-in, never universal |
| Which on-device model paths exist? | Remotion lists MODNet for people (~25.9 MB) and BEN2 Base for general subjects (~219.1 MB); model licenses separate from package. [Model list](https://www.remotion.dev/docs/video-matting/get-available-models) | Prototype people/general paths; do not auto-download weights on initial load |
| What's current in prompted video tracking? | Meta released SAM 3.1 in March 2026, supporting segmenting/tracking prompted objects in images and video. [Meta announcement](https://ai.meta.com/blog/segment-anything-model-3/), [model API](https://dev.meta.ai/docs/sam/overview) | Evaluate for **object masks/tracking**, not confuse binary masks with high-quality alpha mattes |
| What about high-quality video matting? | MatAnyone 2 (CVPR 2026) focuses on human matte details; VideoMaMa/VideoMaMa++ is mask-guided research for diverse objects. [MatAnyone 2](https://github.com/pq-yang/MatAnyone2), [VideoMaMa](https://github.com/cvlab-kaist/VideoMaMa) | Benchmark model adapters. Neither project is automatically cleared for commercial use |
| How should multi-GB video upload work? | R2 documents multipart uploads for large, parallel, resumable objects and signed URL access. [R2 upload guide](https://developers.cloudflare.com/r2/objects/upload-objects/), [presigned URL guide](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) | Direct R2 multipart from browser; backend controls permissions and completion |
| How to persist server jobs reliably? | BullMQ supports progress, retries, rate limits, worker crash recovery and at-least-once delivery. [Workers](https://docs.bullmq.io/guide/workers/), [overview](https://docs.bullmq.io/) | Queue + database, idempotent workers, durable result verification |
| Which web framework version is a safe 2026 baseline? | Next.js 16.x is Active LTS and the stable release channel; canaries are not recommended for production. [Support policy](https://nextjs.org/support-policy) | Next.js 16 stable, current patched release; pin/upgrade with security checks |
| What level of accessibility is expected? | WCAG 2.2 adds non-obscured focus, drag alternatives and target-size criteria. [W3C](https://www.w3.org/TR/WCAG22/) | Target WCAG 2.2 AA from first component, not after visual design |

Product and library docs evolve. Recheck installation APIs and **current licenses/terms** before dependency pinning or deploying.

## 2. Candidate evaluation — do not pick by novelty alone

### Media engine alternatives

**A. Browser-first with Mediabunny / WebCodecs — selected as fast path**

Pros: on-device privacy; hardware acceleration where available; no upload for eligible operations; streaming/modern container handling. Risks: Safari/iOS/Firefox codec gaps, encode support differences, memory pressure, alpha and feature detection complexity. Prototype both remux and transcode; test mobile and long video.

**B. Native FFmpeg worker — selected as compatibility/fidelity path**

Pros: extensive decoding/encoding/filter chains, stable probe, custom presets and better throughput under controlled compute. Risks: binary build choices affect codec and license support; CPU/GPU cost; remote upload/privacy; sandboxing. Build a reproducible capability manifest from the actual distributed image.

**C. ffmpeg.wasm — not default**

It can do self-contained browser conversions but incurs significant compute/memory costs. Consider only when WebCodecs is missing and the operation is very small and proven useful in benchmarks. No global COOP/COEP change without assessing third-party scripts and embed behavior.

### AI approach alternatives

| Candidate | Best role | Caveat |
| --- | --- | --- |
| Remotion WebGPU matting + MODNet | Local person background removal | Browser GPU, model load, codec and alpha support; validate quality on moving hair and real phones |
| Remotion WebGPU matting + BEN2 Base | Local general foreground experiments | Larger download; experimental, higher-resource; temporal quality must be independently tested |
| SAM 3.1 | Prompted object selection/tracking and coarse masks | Masks are not inherently fine alpha mattes; consider API cost, terms, latency and media disclosure |
| MatAnyone 2 | Research candidate for human temporal alpha | NTU S-Lab license requires specific review; no blanket commercial clearance |
| VideoMaMa++ / VideoMaMa | Research candidate for object-agnostic mask-guided matting | VideoMaMa repository references non-commercial code / separate weight licensing; **do not ship commercially without written clearance** |
| Robust Video Matting | Historical real-time human matting baseline | Research repo states GPL-3.0; not a default choice for Apache-2.0 product |

The model layer must remain behind an adapter interface (`segment(subject,frames)`, `matte(frames,masks)`), with preprocessing and encoding separated from inference. The production choice is gated on license review, objective benchmark, and a sustainable cost curve.

### Data flow and privacy alternatives

- **Do not** send full files through a generic Next.js API body: cost, timeout, and memory limits are inappropriate.
- **Do** generate short-lived scoped upload credentials and direct browser-to-object-store uploads.
- **Do not** upload while showing "local mode". A local failure prompts clear cloud consent.
- **Do not** persist video in GitHub, analytics, server logs, or publicly addressable buckets.
- **Do** implement automatic expiry and deletion of uploads, results, masks and temporary GPU intermediates.

## 3. Legal / IP checklist before production

The repository's Apache-2.0 license does **not** waive third-party obligations.

- **FFmpeg:** LGPL 2.1+ by default, but building with GPL components changes obligations; `libx264`, `libx265`, other linked libraries and codec patents need separate build/license analysis. See [FFmpeg legal](https://ffmpeg.org/legal.html). Keep a reproducible `ffmpeg -buildconf` log and verify notices/distribution.
- **Mediabunny:** MPL-2.0. Comply with notices and modification/source availability rules for covered files. [Project license](https://github.com/Vanilagy/mediabunny).
- **Remotion video-matting:** package reported as MIT but each model has its **own** license. [Docs](https://www.remotion.dev/docs/video-matting).
- **SAM 3.1:** verify model/code/API terms, access permissions, rate limits and whether media may be retained or used by third parties. A public GitHub project is not blanket permission.
- **MatAnyone 2:** project declares NTU S-Lab License 1.0. Get explicit interpretation of production and commercial rights. [Project](https://github.com/pq-yang/MatAnyone2).
- **VideoMaMa:** published research code under CC BY-NC 4.0 and model checkpoints with additional Stability AI terms; this is not a production-commercial default. [Project](https://github.com/cvlab-kaist/VideoMaMa), [earlier implementation](https://github.com/rxdha1/videomama).
- **RVM:** repository states GPL-3.0. [Project](https://github.com/PeterL1n/RobustVideoMatting).
- **Fonts/icons:** check licenses and attribution obligations; do not bundle commercial font files without rights.
- **Input ownership:** no DRM circumvention, unconsented remote scraping or illegal source acquisition.
- **User data:** document regional storage, automatic deletion, consent and the actual privacy disclosures.

A license pass/fail matrix and third-party notices are deliverables of M0, not optional cleanup.

## 4. P0 research spikes — reproducible hypotheses

### Spike S1: Browser capability and conversion quality

- Fixture inputs: MP4/H.264/AAC, MOV/HEVC, WebM/VP9/Opus, MKV mixed codecs, VFR phone clip, rotated portrait clip, alpha sample and damaged media.
- Test: metadata probe, file → file remux, transcode 1080p short clip, transcode 4K long clip, GIF, audio track extraction, supported alpha export, cancel.
- Devices: Chrome/Windows, Safari/macOS, Firefox, Chrome/Android, Safari/iOS.
- Record: `isConfigSupported`, memory high-water, startup weight, frames/s, elapsed time, export size, energy/thermal behavior where measurable, permission prompts, fail mode.
- Decision: define the exact local subset and max-size thresholds empirically; no hard-coded claims before data.

### Spike S2: FFmpeg build and worker viability

- Build pinned native container, run `ffprobe -v error -show_format -show_streams -of json input` against fixture corpus.
- Test stream copy, H.264/AAC baseline, VP9/Opus, lossless audio, GIF palette, scene extraction and alpha-bearing MOV/WebM.
- Record build flags/licenses, size, p50/p95 CPU time per video-minute, memory/disk, preview-first-byte, crash behavior, FFmpeg-progress fidelity and output integrity.
- Decision: exact supported worker manifest and resource classes.

### Spike S3: Large uploads and job durability

- Compare single PUT to multipart for 100MB/1GB/multi-GB representative files; test connections intentionally interrupted after several parts.
- Validate a 24-hour proposed TTL policy, manual deletion, short-lived signed links, private buckets and cost.
- Kill workers mid-job and re-deliver duplicate queue messages; verify one user-visible final result and no leaked scratch objects.
- Record queue latency, egress, retries, object lifecycle reliability, observed charges.

### Spike S4: AI quality and delivery

- Build a small, rights-cleared, **reproducible** benchmark corpus, not only flattering demos.
- Run local MODNet/BEN2 where device supports WebGPU; compare candidate server model adapters.
- Evaluate thin hair, quick hands, occlusions, glass/mesh, pets, products, multi-person, light/dark background, camera movement, long duration, 24/30/60fps.
- Report temporal edge flicker, matte quality against ground truth when available, identity drift, manual correction time, throughput, memory, per-minute GPU cost, alpha playback compatibility.
- Document subject classes where feature should be disabled or warned rather than marketed as perfect.

### Spike S5: UX prototype and user success

- Test five tasks with participants unfamiliar with the product: convert MOV→MP4, extract audio, GIF, remove a person background, recover failed upload.
- Measure task success, median clicks/interaction count, time to first actionable state, ambiguous-option rate, cancellation discovery, privacy understanding.
- Review 360px, 768px, 1440px and 1920px screenshots and keyboard/voice-over workflow.
- Reject patterns that score well visually but worsen task completion.

## 5. Architecture decisions (initial ADR-style records)

### ADR-001: Hybrid local + native + GPU processing — **accepted as proposal**

**Context:** broad media support and privacy goals conflict if only one engine is used.  
**Decision:** capability routed browser → CPU → GPU with one recipe/job interface.  
**Consequence:** more integration complexity; much better ability to meet real-world fidelity and compatibility without hiding cloud use.  
**Revisit:** after S1/S2/S4 results.

### ADR-002: Next.js 16 stable + TypeScript — **proposed**

**Context:** dynamic web app needs robust UI and API, but long jobs must be elsewhere.  
**Decision:** Next.js App Router for product UI + lightweight API, dedicated processing workers.  
**Alternative:** Vite/React SPA + separate API if the extra framework complexity proves unnecessary.  
**Revisit:** after shell/prototype and deployment cost testing.

### ADR-003: Cloudflare R2 + Postgres + BullMQ — **proposed**

**Context:** large files, resumability, durable queue, private delivery.  
**Decision:** direct signed multipart upload to object store, metadata in DB, idempotent workers via queue.  
**Alternative:** S3 and a managed workflow service.  
**Revisit:** after S3 uptime, throughput and cost tests.

### ADR-004: Browser matting spike, GPU fallback — **proposed**

**Context:** emerging WebGPU matting can preserve privacy but has GPU/codecs/model constraints.  
**Decision:** local when it actually passes tests, otherwise consented GPU cloud path.  
**Consequence:** additional model/codec tests, never automatic silent upload.  
**Revisit:** after S4 and production license validation.

### ADR-005: Minimal, media-first interface — **accepted as product direction**

**Context:** complex conversion workflows overwhelm non-experts.  
**Decision:** a single reactive workspace, one primary action, advanced options tucked away, cinematic preview, measurable state.  
**Consequence:** disciplined product scope and more engineering around defaults/failure UX.  
**Revisit:** task-study findings from S5.

## 6. Risks to track openly

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Unsupported codec or patent issue | High | Dynamic support list, licensing audit, tested fallback profiles |
| User believes content stayed local but bytes uploaded | Critical | Explicit local/cloud state + opt-in, tests of network behavior |
| Malicious video/format handling | Critical | Sandbox, patched bins, no FFmpeg network, quotas and fuzz tests |
| GPU model license not suitable for commercialization | High | Candidate isolation, written clearance, alternative models |
| AI edges flicker/multiple subjects fail | High | Temporal benchmark, UI correction, narrow eligibility and truthful messaging |
| Abusive large/free jobs or storage egress bills | High | Quotas, concurrency guards, per-job budget and stop switches |
| Local browser OOM/mobile crashes | High | Capability/memory thresholds and native fallback |
| Progress lies or stalls at 99% | Medium | Stage-specific measured progress and timeout watchdog |
| Binary alpha exported but unusable downstream | High | Downstream import matrix with Premiere/Resolve/browser targets |
| Accessibility added too late | High | Component contract, WCAG 2.2 AA as build gate |

## 7. Decision documentation and source hygiene

Cite sources for technical claims in PRs and note tested package/browser versions. Revalidate on each major upgrade. Never upgrade `canary`/experimental AI packages because they look newer. For every change to the supported-format or AI model list, include fixture output, license outcome, operational cost and fallback UX.

This document intentionally distinguishes **known public capabilities**, **recommended architecture**, and **unproven product performance**.
