# Any-Convert

**Video, handled beautifully.** A browser-based video and audio converter.

## What works

Drop a supported media file, inspect its streams, choose an output format,
convert inside a dedicated browser worker, preview, and download a verified
result. No account or file upload is required.

| Output | Codec profile |
| --- | --- |
| MP4 | H.264 / AAC |
| WebM | VP9 / Opus |
| MOV | H.264 / AAC |
| MP3 | MP3 audio |
| WAV | PCM 16-bit audio |
| FLAC | Lossless FLAC audio |

The local converter is limited to **256 MB input files** to constrain
browser memory usage. Codec support varies across browsers and devices.
Unsupported or damaged files fail with a clear explanation. The app does
not claim literally every codec or DRM media works.

AI background removal and cloud FFmpeg processing are separate, future
milestones. They are not available in this release.

## Run locally

Requires Node.js 22.12+, pnpm 10.34.9, Python 3.11+, FFmpeg and FFprobe.

    corepack enable
    pnpm install --frozen-lockfile
    pnpm dev

Open http://localhost:3000.

## Verify

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    python3 tools/media/generate_fixtures.py
    pnpm exec playwright install chromium
    pnpm test:browser
    pnpm test:media

Playwright opens the production build, converts actual media, downloads the
result, and checks codec data with FFprobe. See
[docs/LOCAL_CONVERTER.md](docs/LOCAL_CONVERTER.md) for supported workflows.

## Project and licensing

- [PROJECT_MAP.md](PROJECT_MAP.md) — master roadmap and quality gates.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — planned hybrid architecture.
- [docs/EXPERIENCE_SPEC.md](docs/EXPERIENCE_SPEC.md) — UX standards.
- [docs/RESEARCH_DECISIONS.md](docs/RESEARCH_DECISIONS.md) — technical findings.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — codec and library notices.

The repository is [Apache-2.0](LICENSE); MediaBunny and its encoder extensions
carry additional license terms. The native FFmpeg CLI is a development proof,
not an HTTP-accessible service.
