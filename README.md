# Any-Convert

**Video, handled beautifully.** A restrained video conversion and
transformation web application, under active development.

> **M0 foundation is underway.** This repository now includes a responsive
> browser-local file inspector and a native FFmpeg conversion **CLI proof**.
> Conversion is not yet connected to the browser, and AI background removal,
> cloud processing and job queues remain planned. This is **not yet a hosted,
> production video converter**.

## Run locally

Requires Node.js 22.12+, pnpm 10.34.9, Python 3.11+, FFmpeg and FFprobe.

    corepack enable
    pnpm install --no-frozen-lockfile
    pnpm dev

Visit http://localhost:3000 and import a local video for preview/inspection.
The file stays on your device during inspection; unsupported browser codecs
show an honest limitation message. GET /api/health checks the dynamic server.

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    pnpm test:media

See the [M0 runbook](docs/FOUNDATION_RUNBOOK.md) for native CLI usage, the
13-fixture test harness, CI and an important lockfile/build verification gap.

## Project navigation

1. [PROJECT_MAP.md](PROJECT_MAP.md) — milestones, scope and quality gates.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — local/native/GPU design, security and job API.
3. [docs/EXPERIENCE_SPEC.md](docs/EXPERIENCE_SPEC.md) — UI, interaction states and accessibility.
4. [docs/RESEARCH_DECISIONS.md](docs/RESEARCH_DECISIONS.md) — sources, alternatives and licensing.
5. [docs/FOUNDATION_RUNBOOK.md](docs/FOUNDATION_RUNBOOK.md) — commands and exact M0 status.

Planned capabilities include broadly validated conversion, audio extraction,
GIFs and frames, explicit cloud fallback, and AI subject/background removal
with supported alpha exports. “Any” is an aspiration, not a guarantee that
every codec or DRM-protected file works.

Project licensed [Apache 2.0](LICENSE). Dependencies, codec builds and ML
weights have their own terms that need review for production use.
