# Any-Convert

A premium, privacy-aware video conversion and transformation web app — **planned, not yet implemented**.

Any-Convert is being designed as a genuine dynamic web application: a restrained, media-first interface backed by a hybrid conversion engine. Supported tasks will run on your device when browser capabilities permit; difficult codecs and advanced AI video work can use consented, isolated server workers.

**Vision:** drop a video, understand it instantly, choose the result, preview and download — without unnecessary accounts or clutter.

## Start here

1. **[PROJECT_MAP.md](PROJECT_MAP.md)** — north star, scope, ordered milestones, acceptance gates, and implementation tasks.
2. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — browser/FFmpeg/GPU execution paths, API, uploads, jobs, security and verification.
3. **[docs/EXPERIENCE_SPEC.md](docs/EXPERIENCE_SPEC.md)** — polished UI direction, state-by-state UX, tokens, responsive/accessibility specifications.
4. **[docs/RESEARCH_DECISIONS.md](docs/RESEARCH_DECISIONS.md)** — research sources, 2026 technology evaluation, licenses, spikes and ADRs.

## Planned capabilities

- Broad **validated** video-container and codec conversion, plus audio extraction, GIF and still frames.
- Local, hardware-assisted conversion where compatible, with explicit cloud consent for unsupported paths.
- Native FFmpeg conversion workers for fidelity, stability and difficult media.
- AI subject isolation and background removal, with a transparent export path where the codec supports alpha.
- Resumable upload, observable progress, cancellation, recovery and ephemeral private downloads.
- A minimal workspace that makes complex settings available without imposing them.

"Any" describes the ambition for broad coverage, **not** support for literally every file, proprietary codec or DRM format.

## State of the project

The initial repository contains documentation and its Apache 2.0 license. No working converter, hosted deployment, or completed implementation is being claimed. Follow the [Project Map](PROJECT_MAP.md) to build and verify it in vertical slices.

## License

Project: [Apache License 2.0](LICENSE). Dependencies, FFmpeg build configurations and ML model checkpoints have independent terms; see [research and licensing gates](docs/RESEARCH_DECISIONS.md).
