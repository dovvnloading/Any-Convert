# Self-host Any-Convert

Any-Convert is an open-source, local-first media application. The live
Vercel edition uses browser processing. This optional Docker deployment
adds a **real, self-hosted FFmpeg service** without depending on any
proprietary conversion API.

## Local installation

Requirements: Linux/macOS/Windows with Docker Engine and Compose v2,
at least 4 GB available memory, and enough free disk to build images.

    git clone https://github.com/dovvnloading/Any-Convert.git
    cd Any-Convert
    cp .env.example .env
    docker compose up --build -d

Open **http://localhost:8080**. In the top navigation, choose **Native
engine**. The browser converter remains available under **On-device**.
Select a media file, choose the output, explicitly consent to upload,
then convert. Download the result and use **Delete file now** afterward.

The native engine listens on port 4300 **inside Docker only** and MUST
NOT be independently published to the internet.

### Local configuration

Default values from compose.yaml:

| Variable | Default | Description |
| --- | --- | --- |
| SITE_ADDRESS | :8080 | Local HTTP listener for Caddy |
| PUBLIC_ORIGIN | http://localhost:8080 | Exact expected browser Origin; also decides Secure cookies |
| MAX_UPLOAD_MB | 512 | Size limit for any single source file |
| MAX_OUTPUT_MB | 1024 | Maximum downloadable output file size |
| MAX_DURATION_SECONDS | 600 | Input media duration limit (10 minutes) |
| MAX_ACTIVE_JOBS | 1 | Maximum concurrent native FFmpeg conversions |
| JOB_TTL_MS | 3600000 | Delete unclaimed jobs/outputs after about one hour |
| ENCODE_TIMEOUT_MS | 900000 | Per-job maximum encoding time |

Native uploads are streamed to ephemeral temp storage, not buffered
fully in the Node.js process. The browser downloads via a scoped cookie,
not by putting an access token in the URL.

**Important:** The worker uses an in-memory queue and temporary filesystem.
An engine restart intentionally destroys every unfinished/ready job.
This release does NOT offer persistent distributed queues or durable
uploads. Users can still continue ordinary browser conversion.

### HTTPS / public domain

This Compose configuration defaults to **loopback-only** networking and
HTTP for local development. Do not expose the HTTP instance on public
interfaces: cookies should be Secure on the public internet.

Set the following in .env *only after* you have configured DNS and a
properly secured public host:

    SITE_ADDRESS=convert.example.com
    PUBLIC_ORIGIN=https://convert.example.com
    HTTP_BIND=0.0.0.0
    HTTP_PORT=80
    CONTAINER_HTTP_PORT=80
    HTTPS_BIND=0.0.0.0
    HTTPS_PORT=443

Caddy obtains and renews TLS certificates for eligible public
domains. Ports 80 and 443 and DNS must be configured correctly.

**Do not treat this as a public multi-tenant SaaS out of the box.**
This single-node service has ephemeral anonymous jobs, process-global
quotas, and per-session rate limiting, but no account-level billing,
durable storage, distributed scheduling, externally enforced abuse
detection, intrusion monitoring, or third-party security assessment.
For public internet use, place it behind an additional access control
and rate-limiting layer until those safeguards are implemented.

### Engine isolation

- Node.js HTTP service uses only built-in modules; no SaaS or GPU model
  vendor is required.
- FFmpeg commands are assembled from a fixed allowlist, never from a
  user shell string. Files receive server-generated paths.
- Input protocols are restricted to local files and pipes.
- Docker native container runs nonroot, with read-only root filesystem,
  no added Linux capabilities, no privilege escalation, limited PIDs,
  CPU and RAM budgets, and ephemeral scratch mount.
- Caddy proxies /api/native paths to the internal-only worker. User
  uploads only occur following explicit browser consent.
- Ownership is an opaque HttpOnly SameSite=Strict cookie, tied to job
  records; other sessions receive 404 for job access. A page refresh
  can restore the job from sessionStorage while the server is alive.
- Outputs are probed and checked before marked ready.
- Source media is deleted as soon as a verified result is available.
  The remaining result can be deleted immediately or expires.
- No background inpainting, GPU inference, persistent cloud object
  store or model-weight download is included in this release.

### Updating and troubleshooting

    docker compose logs -f native
    docker compose logs -f web
    docker compose ps
    docker compose down

Status endpoint: GET /api/native/health.

If your file is rejected, check the maximum size, duration, media
format and actual encoder availability in the FFmpeg build. Do not
introduce arbitrary user filter strings to "fix" a conversion. Update
the fixed format registry and add synthetic fixtures/real integration tests.

**Licensing:** The application is Apache-2.0. The FFmpeg binary and
its linked codecs (e.g. libx264) can impose LGPL/GPL and additional
codec-patent obligations. Docker builds FFmpeg from Debian packages;
redistribution and commercial use must be reviewed separately. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Open-source extensibility

The native pipeline is deliberately modular:

- apps/native-service/src/media.mjs: validated recipes, FFmpeg execution,
  codec verification and progress parsing.
- apps/native-service/src/server.mjs: private job API, admission control,
  streamed upload, cancellation, downloads and retention.
- apps/web/src/lib/native-client.ts: typed API client.
- apps/web/src/components/native-workspace.tsx: conversion and consent UX.
- infra: Compose, Caddy and Docker images.

To add a new codec or operation, add it to the supported format registry,
write an FFmpeg integration test and browser E2E test, and document how
the output is validated. The future GPU inference adapter will use the
same independent service boundary with models only after licenses and
reproducible quality tests are verified.
