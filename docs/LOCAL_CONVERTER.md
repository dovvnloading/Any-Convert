# Local converter — release guide

**Status:** shipped browser-local converter. An optional, separately deployable native engine now lives in [SELF_HOST.md](SELF_HOST.md); browser mode remains upload-free. Public release is
gated on successful browser E2E tests and deployment verification.

## Current user journey

1. Select, drag, or paste a copied audio/video file (Ctrl/⌘+V, when the browser supplies a File) up to 256 MB for the fallback or up to 1 GB
   experimentally when private browser storage and capacity are available.
2. A dedicated Web Worker probes the real container, primary audio/video
   tracks, display dimensions, duration, codecs, and decodability.
3. Pick MP4/WebM/MOV if video exists; MP3/WAV/FLAC if audio exists.
   Choose original-compatible quality, balanced, or smaller; optionally
   constrain the maximum video resolution.
4. Convert in a separate worker. Progress is based on processed media
   duration and never reaches 100% until the output is verified.
5. The engine reopens the result with a demuxer and verifies that
   required tracks and expected codecs are present.
6. Preview when the browser supports playback; download locally with
   the correct extension. Change options and convert again.

Clipboard import ignores non-media content and text-entry controls; it uses the same local inspection and size limits as browsing and drag/drop. Clipboard support varies by browser and operating system.

Cancellation terminates the worker. Original files and result bytes remain
on the device. Object URLs are revoked on replacement/unmount. Closing
the tab stops ongoing conversion.

## Supported output profiles

| Output | Codec | Limits |
| --- | --- | --- |
| MP4 | H.264 + AAC | Browser decoder/encoder required |
| MOV | H.264 + AAC | Browser decoder/encoder required |
| WebM | VP9 + Opus | Browser decoder/encoder required |
| MP3 | MP3 | Bundled browser WASM fallback encoder |
| WAV | 16-bit PCM | Uncompressed audio output |
| FLAC | FLAC | Bundled browser WASM fallback encoder |

- MP4/MOV stream-copy compatible input tracks where no transcoding is
  required, instead of silently reducing quality.
- Video exports only offer formats when a real video track exists.
- Audio exports only offer formats when an audio track exists.
- The in-memory fallback has a 256 MB input cap; disk-backed exports are
  experimental up to 1 GB, subject to storage quota and device codec support.
- Streaming exports use a position-aware Mediabunny StreamTarget and browser
  origin-private storage, not append-only concatenation. MP4/MOV use
  non-faststart output to avoid buffering the entire media payload.
- Private output is deleted when reset/replaced; a best-effort stale cleanup
  runs on the next visit after 24 hours. Crash or abrupt tab closure can leave
  temporary local output until cleanup or browser site data is cleared.
- Browser support and hardware acceleration vary. No DRM circumvention.
- No background removal, frame generation, batch, resumable upload,
  server conversion, transparent video, or persistent cloud jobs yet.

## Architecture and correctness

- Next.js 16 App Router handles UI and health. Actual media input does
  not leave the local browser; no media ingestion API exists.
- Mediabunny 1.65.2 uses lazy BlobSource reads and a dedicated module worker.
- On-demand encoder shims are provided for MP3, AAC and FLAC by
  @mediabunny/mp3-encoder, @mediabunny/aac-encoder and
  @mediabunny/flac-encoder. Encoders are bundled, not CDN-loaded.
- Each job has an operation sequence ID, with stale worker messages
  ignored and worker termination on cancellation or replacement.
- Conversion.init validates track capabilities and no source-audio loss
  before execution. When its track plan is invalid, the UI explains whether
  an input codec cannot be decoded, an output codec cannot be encoded, or a
  track cannot be copied, without leaking raw exception strings or filenames.
  Source video/audio codec labels are visible in the workspace for diagnosis.
  The downloaded output is probed again before the UI marks it ready.
- StreamTarget writes verified output to origin-private storage where supported.
  BufferTarget remains a bounded fallback for older browsers.
- The original native FFmpeg CLI is for trusted local files only.
  Never turn it into a public endpoint without sandboxing and quotas.

## Testing

GitHub CI checks TypeScript, lint, Vitest, Next production build, real
FFmpeg fixtures and native worker integration, plus Playwright on Chromium.
The browser E2E tests actually convert an MP4 input to MOV and WAV input
to MP3, download results, and verify output codecs using FFprobe. Negative
input validation and mobile layout are covered.

No claim of universal cross-browser support is made until Chrome, Safari,
Firefox, iOS and Android device testing has been completed and documented.

## Research references

- https://mediabunny.dev/guide/converting-media-files
- https://mediabunny.dev/guide/reading-media-files
- https://mediabunny.dev/guide/output-formats
- https://mediabunny.dev/guide/extensions/mp3-encoder
- https://mediabunny.dev/guide/extensions/aac-encoder
- https://mediabunny.dev/guide/extensions/flac-encoder
