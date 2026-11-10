# Third-party notices for the browser media engine

Any-Convert is licensed under Apache-2.0. The following dependencies
retain their own upstream licenses and obligations.

- Mediabunny (MPL-2.0): https://github.com/Vanilagy/mediabunny
- Mediabunny MP3 encoder (MPL-2.0): https://mediabunny.dev/guide/extensions/mp3-encoder
- Mediabunny AAC encoder (MPL-2.0): https://mediabunny.dev/guide/extensions/aac-encoder
- Mediabunny FLAC encoder (MPL-2.0): https://mediabunny.dev/guide/extensions/flac-encoder
- LAME MP3 3.100 (LGPL): https://lame.sourceforge.io/ (embedded
  by the Mediabunny MP3 encoder extension)
- libFLAC codec (its own open-source license): https://xiph.org/flac/
- React (MIT): https://github.com/facebook/react
- Next.js (MIT): https://github.com/vercel/next.js

Keep all upstream package notices, copyright notices, and full license texts.
Check the exact binary and transitive dependency license manifests before
a commercial distribution. This file is not a patent clearance opinion.

The native FFmpeg test CLI is not deployed as a public media-processing
service; a future server worker requires separate FFmpeg build licensing,
codec-patent analysis, and sandbox review.


## Self-hosted native service

- Node.js runtime: MIT license, https://github.com/nodejs/node
- Caddy reverse proxy: Apache-2.0 license, https://github.com/caddyserver/caddy
- FFmpeg and FFprobe: LGPL 2.1+ or GPL depending on build configuration,
  https://ffmpeg.org/legal.html . Native FFmpeg is installed from Debian
  packages in the user-buildable Dockerfile; actual libraries, patents,
  binary redistribution and source obligations require review.
- libx264: GPL; libvpx/libopus and others have their own upstream terms.
  These are codec dependencies of particular FFmpeg builds, not a
  relicensing of the Any-Convert application.
- No proprietary video-processing API or model-weight bundle is required
  by the Native Engine. GPU video matting remains a separate, unshipped
  and license-gated research milestone.

Do not claim GPL/LGPL compliance for a redistributed container merely
because the application source is Apache-2.0. Review notices, sources,
exact linked libraries and applicable jurisdictions before commercial
binary distribution.
