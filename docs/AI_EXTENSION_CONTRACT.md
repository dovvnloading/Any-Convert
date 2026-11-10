# Open model extension contract — research gate

AI background removal is a major planned feature, **not shipped**.
Open source is a property of each component's license, not of where it
runs. We will not imply that a hosted API gives us permission to change
a proprietary model.

## Intended adapter boundary

    MediaProbe → DecodeFrames → SelectSubject/TrackMasks
          → TemporalAlphaMatte → Composite/EncodeAlpha → Verify

Model adapter contracts should expose:
- canRun(device, format, duration, size): support, memory and license status
- load(): model weights from an approved, pinned and documented source
- track(frames, selection): time-aligned subject masks
- matte(frames, masks): temporally stable premultiplied alpha
- release(): tear down GPU resources
- manifest: model/weights version, rights, supported targets, benchmark data

The CPU/native worker must remain independent of ML. Browser WebGPU is a
feature-gated optional path. A GPU worker must be separately deployable
with the model and weights legitimately redistributable or self-hostable.

## Required before implementation goes live

1. Confirm the exact **code and weights** license, including commercial
   use and redistribution. Open repository visibility is insufficient.
2. Validate temporal stability, fine hair, fast action, occlusion, camera
   motion, multi-subject handling, HDR and long clips on licensed samples.
3. Establish an alpha-aware output path (verified WebM VP9 alpha, ProRes
   4444 MOV or PNG sequence). Ordinary H.264 MP4 does not carry alpha
   in our initial output profile.
4. Benchmark GPU minutes/cost, hardware fallback and output compatibility
   across editing tools.
5. Test user consent, privacy deletion, asset lifecycle, quotas and
   resource exhaustion.
6. Ensure every model can be replaced without changing the browser
   conversion API.

Promising candidates can include browser WebGPU matting, SAM-based
tracking plus dedicated alpha refinement, and human video matting.
No candidate is production-cleared by this document. See
[research decisions](RESEARCH_DECISIONS.md).
