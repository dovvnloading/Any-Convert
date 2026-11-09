#!/usr/bin/env python3
"""End-to-end deterministic FFmpeg QA with optional TS-worker integration.

CI sets ANY_CONVERT_REQUIRE_WORKER=1 to make the native CLI smoke test mandatory.
Without installed JS tooling, standalone FFmpeg fixture and Python tests still run.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys

from generate_fixtures import OUT, ROOT, make
from validate import validate_manifest, validate_output


def run(command: list[str]) -> None:
    print("$", " ".join(command), flush=True)
    subprocess.run(command, check=True, cwd=ROOT, timeout=180)


def main() -> None:
    specs = make()
    print(f"Generated {len(specs)} synthetic fixtures", flush=True)
    validate_manifest(OUT / "manifest.json")
    run([sys.executable, "-m", "unittest", "discover", "-s", "tools/media/tests", "-v"])

    require_worker = os.environ.get("ANY_CONVERT_REQUIRE_WORKER") == "1"
    if not shutil.which("pnpm"):
        if require_worker:
            raise RuntimeError("pnpm is required for the worker smoke test in CI")
        print("SKIP TS worker integration: pnpm unavailable in local environment", flush=True)
        return

    outputs = ROOT / "tests" / "output"
    outputs.mkdir(parents=True, exist_ok=True)
    for filename in ["odd-ffv1.mkv", "webm-vp9-opus.webm", "multi-audio.mkv"]:
        output = outputs / (filename + ".mp4")
        output.unlink(missing_ok=True)
        run(["pnpm", "exec", "tsx", "apps/media-worker/src/cli.ts", "convert", str(OUT / filename), str(output)])
        validate_output(output)

    # Running the CLI again against an existing result must fail without
    # changing even one byte. This exercises atomic no-overwrite publication.
    existing = outputs / "odd-ffv1.mkv.mp4"
    original_hash = hashlib.sha256(existing.read_bytes()).hexdigest()
    again = subprocess.run(
        ["pnpm", "exec", "tsx", "apps/media-worker/src/cli.ts", "convert",
         str(OUT / "odd-ffv1.mkv"), str(existing)],
        text=True, capture_output=True, check=False, cwd=ROOT, timeout=180,
    )
    if again.returncode == 0 or "Output already exists" not in again.stderr:
        raise RuntimeError("Native worker failed to reject an existing output")
    if hashlib.sha256(existing.read_bytes()).hexdigest() != original_hash:
        raise RuntimeError("Native worker modified an existing output")
    print("PASS atomic no-overwrite behavior", flush=True)
    print("MEDIA QA PASSED: fixture matrix + native worker conversions", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"MEDIA QA FAILED: {error}", file=sys.stderr)
        sys.exit(1)
