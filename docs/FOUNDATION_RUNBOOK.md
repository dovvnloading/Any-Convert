# Foundation runbook — M0

**Status:** code delivered on build/m0-foundation. This is a dynamic Next.js app with a local browser file inspector and native FFmpeg CLI proof, **not yet a hosted converter**. See [PROJECT_MAP.md](../PROJECT_MAP.md).

## Requirements

Node.js 22.12+, pnpm 10.34.9, Python 3.11+, FFmpeg and FFprobe on PATH.
To run all media fixtures the installed FFmpeg must support libx264,
libvpx-vp9, libopus, libmp3lame, FFV1 and AAC.

## Quickstart

    corepack enable
    pnpm install --frozen-lockfile
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

## Dependency reproducibility and release gates

The complete pnpm-lock.yaml was resolved by a passing GitHub Actions job,
fetched from the job output, verified by blob SHA, and committed to this branch.
CI now installs with --frozen-lockfile and fails if the dependency graph and
manifest disagree. Do not edit the lockfile by hand; use pnpm install on a
connected development machine and commit the resulting changes.

GitHub Actions has already passed TypeScript, Biome, Vitest, Next.js build,
full media fixtures, real native FFmpeg worker conversions and dependency
audit using the same declared package versions. Frozen lockfile installation is now verified. The **frozen** install workflow passed on 2026-11-09 ([GitHub Actions run](https://github.com/dovvnloading/Any-Convert/actions/runs/42719759388)). P0-01 and P0-03 are complete. P0-02 remains open for formal third-party license auditing and hosted pull-request previews.

M0 still has separate research gates: browser/codec compatibility S1, worker
cost and legal/build S2, and AI model quality/licensing S4. Those are not
claimed complete by the existence of this proof-of-concept CLI.

## Legal and security note

The repo is Apache-2.0. Some system FFmpeg builds enable GPL libraries such
as libx264; codecs can have additional patent and distribution requirements.
CI uses the host's FFmpeg solely for development tests, not as a production
distribution or commercial codec rights clearance.

- apps/web — Next.js 16 dynamic app, responsive local inspector, /api/health.
- apps/media-worker — native local CLI, bounded subprocesses and verification.
- packages/contracts — shared typed job/media contracts and transition tests.
- tools/media — generation, validation and real integration checks.
