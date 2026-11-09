#!/usr/bin/env python3
"""Fail-closed ffprobe assertions for generated fixtures and conversion outputs."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


class ValidationError(ValueError):
    pass


def probe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=format_name,duration:stream=codec_type,codec_name,width,height",
         "-of", "json", str(path)],
        text=True, capture_output=True, timeout=30, check=False,
    )
    if result.returncode:
        raise ValidationError(f"ffprobe rejected {path.name}: {result.stderr[-240:]}")
    try:
        data: dict[str, Any] = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValidationError(f"ffprobe did not return JSON for {path.name}") from error
    if not isinstance(data.get("streams"), list) or not isinstance(data.get("format"), dict):
        raise ValidationError(f"ffprobe returned incomplete metadata for {path.name}")
    return data


def validate_record(data: dict[str, Any], expectation: dict[str, Any]) -> None:
    fmt = data.get("format") or {}
    streams = data.get("streams") or []
    actual_containers = set(str(fmt.get("format_name", "")).split(","))
    if expectation["container"] not in actual_containers:
        raise ValidationError(f"Container mismatch: expected {expectation['container']}, got {actual_containers}")
    actual_codecs = [stream.get("codec_name") for stream in streams]
    if actual_codecs != expectation["codecs"]:
        raise ValidationError(f"Codec mismatch: expected {expectation['codecs']}, got {actual_codecs}")
    try:
        duration = float(fmt.get("duration", 0))
    except (TypeError, ValueError) as error:
        raise ValidationError("Missing or invalid duration") from error
    if not (0.8 <= duration <= 2.5):
        raise ValidationError(f"Unexpected media duration: {duration}")
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    if "width" in expectation and (video is None or video.get("width") != expectation["width"]):
        raise ValidationError("Video width mismatch")
    if "height" in expectation and (video is None or video.get("height") != expectation["height"]):
        raise ValidationError("Video height mismatch")


def validate_manifest(manifest: Path) -> int:
    expectations = json.loads(manifest.read_text(encoding="utf-8"))
    count = 0
    for name, expectation in sorted(expectations.items()):
        path = manifest.parent / name
        if not path.is_file():
            raise ValidationError(f"Missing expected fixture: {name}")
        if expectation.get("expect_error"):
            try:
                probe(path)
            except ValidationError:
                print(f"PASS negative: {name}")
                count += 1
                continue
            raise ValidationError(f"Expected invalid file to be rejected: {name}")
        validate_record(probe(path), expectation)
        print(f"PASS fixture: {name}")
        count += 1
    if count < 10:
        raise ValidationError("Expected at least ten fixtures for regression coverage")
    return count


def validate_output(path: Path) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise ValidationError(f"No conversion output: {path}")
    data = probe(path)
    streams = data["streams"]
    video = [stream for stream in streams if stream.get("codec_type") == "video"]
    audio = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if "mp4" not in data["format"]["format_name"].split(","):
        raise ValidationError("Expected MP4 output")
    if len(video) != 1 or video[0].get("codec_name") != "h264":
        raise ValidationError("Expected one H.264 stream")
    if any(stream.get("codec_name") != "aac" for stream in audio) or len(audio) > 1:
        raise ValidationError("Expected at most one AAC stream")
    width, height = video[0].get("width", 0), video[0].get("height", 0)
    if not width or not height or width % 2 or height % 2:
        raise ValidationError("Output dimensions must be positive and even")
    duration = float(data["format"].get("duration", 0))
    if not (0.8 <= duration <= 2.5):
        raise ValidationError("Output duration outside known fixture tolerance")
    print(f"PASS converted output: {path.name} ({width}x{height}, {duration:.2f}s)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify real media streams, not filename extensions")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--manifest", type=Path)
    group.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.manifest:
            count = validate_manifest(args.manifest)
            print(f"Validated {count} media fixtures")
        else:
            validate_output(args.output)
    except (ValidationError, OSError, json.JSONDecodeError) as error:
        parser.exit(status=1, message=f"MEDIA QA FAILED: {error}\n")


if __name__ == "__main__":
    main()
