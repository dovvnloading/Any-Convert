# Any-Convert

**Video, handled beautifully.** An open-source, local-first video and audio
conversion application. There are no mandatory accounts or proprietary
conversion endpoints.

## Run it

| Mode | Where media is processed | How to use |
| --- | --- | --- |
| **On-device** | Entirely in your browser | [Live web app](https://any-convert-eight.vercel.app/) |
| **Native (opt-in)** | Your own containerized FFmpeg server | [Self-host instructions](docs/SELF_HOST.md) |

The browser edition is deployed to Vercel. Its code remains open source, and
users' selected media are not sent to that platform for conversion. The
optional Native Engine is a separate **self-hosted server** with code in this
repository, rather than a proprietary API. Vercel production does not
enable or operate the Native Engine.

### Browser conversions

MP4 (H.264/AAC), MOV (H.264/AAC), WebM (VP9/Opus), MP3, WAV and FLAC are
supported when the browser can decode and encode the media. A conservative 256 MB memory fallback remains when private browser storage
is unavailable. Disk-backed exports up to 1 GB are experimental, conditional
on device storage quota and codec support; they are not guaranteed on every
browser. Temporary output files stay on the device and are cleaned on reset
or a later visit. Exact browser/codec support varies.
Actual conversion, preview, progress, cancellation and download work
in a dedicated browser media worker. See [local guide](docs/LOCAL_CONVERTER.md).

### Optional native conversions

Native FFmpeg supports validated MP4, MOV, WebM, MP3, WAV, FLAC and GIF
presets and can decode many additional inputs supported by the *installed
FFmpeg build*. Uploaded media requires explicit consent, stays on the
host you operate, and expires automatically. The initial service is
**single-node and ephemeral**: defaults are 512 MB per file, 10 minutes
source duration and one active CPU job.

    git clone https://github.com/dovvnloading/Any-Convert.git
    cd Any-Convert
    cp .env.example .env
    docker compose up --build -d

Visit http://localhost:8080 and select **Native engine**. For internet
exposure, read the [security/HTTPS limitations](docs/SELF_HOST.md) first.
The backend must not be published directly; only Caddy should be public.

## Batch studio

The [Batch studio](/batch) on the hosted site exports multiple local files and
formats through a serialized browser conversion queue, then bundles verified
outputs into a streaming ZIP (up to 2 GB). Each output can also be downloaded
individually. No files are sent to the server. See [docs/BATCH_STUDIO.md](docs/BATCH_STUDIO.md).

## Build and test

Requires Node.js 22.12+, pnpm 10.34.9, Python 3.11+, FFmpeg and FFprobe.

    corepack enable
    pnpm install --frozen-lockfile
    pnpm dev

    pnpm typecheck
    pnpm lint
    pnpm test
    python3 tools/media/generate_fixtures.py
    pnpm test:native
    pnpm test:media
    pnpm build
    pnpm test:browser

CI tests both real Chromium browser conversion and isolated native-service
HTTP + FFmpeg processing, privacy access control, malformed media, output
verification and Docker Compose configuration.

## Architecture and roadmap

- [PROJECT_MAP.md](PROJECT_MAP.md) — scope, milestones and quality gates.
- [docs/SELF_HOST.md](docs/SELF_HOST.md) — deploy your own native converter.
- [docs/NATIVE_API.md](docs/NATIVE_API.md) — documented local processing API.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — media engine design.
- [docs/INTELLIGENCE_CORE.md](docs/INTELLIGENCE_CORE.md) — versioned format catalog, capability planner and tested recipes.
- [docs/EXPERIENCE_SPEC.md](docs/EXPERIENCE_SPEC.md) — interaction and visual standards.
- [docs/AI_EXTENSION_CONTRACT.md](docs/AI_EXTENSION_CONTRACT.md) — open-model architecture.
- [docs/RESEARCH_DECISIONS.md](docs/RESEARCH_DECISIONS.md) — implementation research.

## License and real limitations

Our source is [Apache-2.0](LICENSE). FFmpeg, native codec libraries,
Mediabunny, encoder extensions and model weights have independent
licenses and potentially codec-patent requirements. Read
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

"Any" represents broad ambition, not literal support for every file,
DRM source or arbitrary codec. High-quality AI background removal is
**still research**, not a shipped feature. An open GitHub repository
does not automatically grant commercial use of ML model weights.

The Native Engine is appropriate for self-hosted and private deployments.
It is not yet hardened as an anonymous, internet-scale multi-tenant SaaS:
there is no distributed durable queue, resumable upload, GPU inference,
or external abuse/billing layer.
