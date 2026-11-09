# Foundation runbook — M0

**Status:** code delivered on build/m0-foundation. This is a dynamic Next.js app with a local browser file inspector and native FFmpeg CLI proof, **not yet a hosted converter**. See [PROJECT_MAP.md](../PROJECT_MAP.md).

## Requirements

Node.js 22.12+, pnpm 10.34.9, Python 3.11+, FFmpeg and FFprobe on PATH.
To run all media fixtures the installed FFmpeg must support libx264,
libvpx-vp9, libopus, libmp3lame, FFV1 and AAC.

## Quickstart

    corepack enable
    pnpm install --no-frozen-lockfile
    pnpm dev

Open http://localhost:3000. Drag a video into the workspace or choose it with
the file picker. Video preview and metadata are read **on-device**: selecting a
file does not upload it. A browser that cannot decode the codec shows an honest
limited-inspection state. GET /api/health verifies the dynamic server and
indicates that the conversion engine is not yet connected.

## Tests

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    pnpm test:media

The media suite synthesizes 13 small rights-free samples from FFmpeg test
signals (12 valid plus one corrupted). Actual ffprobe metadata is checked for
container aliases, codec order, dimensions and duration; five Python tests
exercise fail-closed assertions. With pnpm installed, the native worker also
converts odd-dimension FFV1, VP9/Opus WebM and multi-audio MKV, independently
probes output MP4 streams, and refuses to count unverified output as success.
Generated fixtures/output are ignored by Git.

## Native worker CLI (trusted local input only)

    pnpm exec tsx apps/media-worker/src/cli.ts probe tests/fixtures/generated/baseline-h264-aac.mp4
    pnpm exec tsx apps/media-worker/src/cli.ts convert tests/fixtures/generated/odd-ffv1.mkv tests/output/manual.mp4

The CLI refuses existing output files and uses a random temporary destination
that is verified before rename. It is **not safe to expose as a public API**:
server-side tenancy, resource isolation, upload ownership, network protocol
restrictions, quotas, cancellation and long-running job persistence belong
to M2. Do not accept arbitrary network URLs as input.

## Known installation/reproducibility gap

The implementation sandbox could run Python and FFmpeg but could **not reach
the public npm registry**. Pinned top-level dependency versions are committed,
but the complete dependency tree is not installed or verified locally, and a
pnpm-lock.yaml has **not** been created yet. CI temporarily installs with
--no-frozen-lockfile. This is not a production reproducibility standard.

**Acceptance work still required before declaring M0 finished:**

1. Run pnpm install on a connected machine and commit pnpm-lock.yaml.
2. Switch CI to pnpm install --frozen-lockfile.
3. Confirm passing typecheck, lint, unit tests, Next.js build, and full
   required worker media QA in GitHub Actions.
4. Review installed binary/container versions and transitive dependency
   vulnerabilities before any deployment.
5. Perform S1/S2 browser/codec capability and licensing evaluation.

An output directory used by the CLI must exist. A CI failure is a gate, not
permission to mark milestones complete.

## Legal and security note

The repo is Apache-2.0. Some system FFmpeg builds enable GPL libraries such
as libx264; codecs can have additional patent and distribution requirements.
CI uses the host's FFmpeg solely for development tests, not as a production
distribution or commercial codec rights clearance.

- apps/web — Next.js 16 dynamic app, responsive local inspector, /api/health.
- apps/media-worker — native local CLI, bounded subprocesses and verification.
- packages/contracts — shared typed job/media contracts and transition tests.
- tools/media — generation, validation and real integration checks.
