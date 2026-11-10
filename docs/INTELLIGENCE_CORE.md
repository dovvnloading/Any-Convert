# Intelligence Core v1

This PR introduces a **single versioned output catalog**, checked in as
`packages/media-core/format-registry.json`. Browser TypeScript imports it via
`@any-convert/media-core`; the self-hosted Node native service imports the
same JSON with native ESM JSON import attributes. Format/profile changes must
update this file rather than separate UI and worker lists.

## Scope

- A deterministic, testable planner returns per-format **browser** and
  **native** decisions: `ready`, `needs-check`, or `blocked`, each with
  structured reasons. "Needs-check" is intentional: input decodability,
  bundled encoder loading, remux viability and FFmpeg success cannot be
  guaranteed from static metadata.
- The browser checks actual video encoder support for AVC and VP9, and the
  Opus audio encoder; source stream decodability is checked independently.
  Bundled MP3/AAC/FLAC encoder availability is rechecked on conversion.
  Positive eligibility is *not* a promise of successful encoding.
- A version-1 intent-level recipe maps to each engine's existing **fixed**
  format/quality/height settings. No user-supplied FFmpeg switches.
- The native runtime derives its fixed output codec registry from the same
  JSON file, while preserving the existing allowlisted FFmpeg argument builder.
- The shipped site remains **browser-only by default**. A native recommendation
  is only possible when a real native service capability document is supplied,
  and that recommendation never starts an upload: the native consent gate
  remains mandatory.

## Not yet implemented

Automatic switching, server-to-client capability negotiation, durable jobs,
resumable uploads, AI operations, larger file streaming, full codec/profile
selection, and multi-asset export packs remain subsequent PRs. This package
only plans; it never reads, moves, uploads, or executes media.

## Extending

For a new format, add its **actual codec/container profile** to the manifest,
update the TypeScript format ID union, implement and verify the encoder on
each declared engine, then add synthetic conversion fixtures, native tests,
browser tests and licensing checks. Never equate a file extension with
guaranteed codec compatibility or claim local privacy for a remote route.
