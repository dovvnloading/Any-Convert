#!/usr/bin/env python3
"""Generate tiny, deterministic, rights-free FFmpeg fixtures from signal sources.

Reproducibility is scoped to the *input recipe*. Encoded bytes can differ across
FFmpeg/encoder versions. Do not commit generated media or depend on byte hashes.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "generated"


def ffmpeg(*args: str) -> None:
    command = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y", *args]
    process = subprocess.run(command, text=True, capture_output=True, timeout=75, check=False)
    if process.returncode:
        raise RuntimeError(f"Fixture command failed: {' '.join(command)}\n{process.stderr[-2500:]}")


def video_source(size: str = "160x90", rate: int = 24) -> list[str]:
    return ["-f", "lavfi", "-i", f"testsrc2=size={size}:rate={rate}:duration=1.2"]


def audio_source(freq: int = 440) -> list[str]:
    return ["-f", "lavfi", "-i", f"sine=frequency={freq}:sample_rate=44100:duration=1.2"]


def make() -> dict[str, dict[str, object]]:
    OUT.mkdir(parents=True, exist_ok=True)
    spec: dict[str, dict[str, object]] = {}

    def add(filename: str, container: str, codecs: list[str], dims: tuple[int, int] | None = None) -> None:
        spec[filename] = {"container": container, "codecs": codecs}
        if dims is not None:
            spec[filename]["width"] = dims[0]
            spec[filename]["height"] = dims[1]

    standard = OUT / "baseline-h264-aac.mp4"
    ffmpeg(*video_source(), *audio_source(), "-map", "0:v:0", "-map", "1:a:0",
           "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", str(standard))
    add(standard.name, "mp4", ["h264", "aac"], (160, 90))

    portrait = OUT / "portrait-h264.mp4"
    ffmpeg(*video_source("90x160"), "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", str(portrait))
    add(portrait.name, "mp4", ["h264"], (90, 160))

    silent = OUT / "silent-h264.mp4"
    ffmpeg(*video_source(), "-an", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", str(silent))
    add(silent.name, "mp4", ["h264"], (160, 90))

    fast = OUT / "high-fps-h264.mp4"
    ffmpeg(*video_source(rate=60), "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", str(fast))
    add(fast.name, "mp4", ["h264"], (160, 90))

    webm = OUT / "webm-vp9-opus.webm"
    ffmpeg(*video_source(), *audio_source(), "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8",
           "-b:v", "400k", "-c:a", "libopus", str(webm))
    add(webm.name, "matroska", ["vp9", "opus"], (160, 90))

    mkv = OUT / "mkv-h264-aac.mkv"
    ffmpeg("-i", str(standard), "-map", "0", "-c", "copy", str(mkv))
    add(mkv.name, "matroska", ["h264", "aac"], (160, 90))

    # Realistic browser failure: H.264 video is usable but AC-3 audio is
    # commonly unavailable to WebCodecs. The video-only recovery must work.
    ac3 = OUT / "mkv-h264-ac3.mkv"
    ffmpeg("-i", str(standard), "-map", "0:v:0", "-map", "0:a:0",
           "-c:v", "copy", "-c:a", "ac3", "-b:a", "128k", str(ac3))
    add(ac3.name, "matroska", ["h264", "ac3"], (160, 90))

    mov = OUT / "mov-h264-aac.mov"
    ffmpeg("-i", str(standard), "-map", "0", "-c", "copy", str(mov))
    add(mov.name, "mov", ["h264", "aac"], (160, 90))

    avi = OUT / "avi-mpeg4-mp3.avi"
    ffmpeg(*video_source(), *audio_source(), "-c:v", "mpeg4", "-q:v", "5", "-c:a", "libmp3lame", str(avi))
    add(avi.name, "avi", ["mpeg4", "mp3"], (160, 90))

    odd = OUT / "odd-ffv1.mkv"
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=161x91:rate=24:duration=1.2",
           "-c:v", "ffv1", "-pix_fmt", "yuv444p", str(odd))
    add(odd.name, "matroska", ["ffv1"], (161, 91))

    wav = OUT / "pcm-audio.wav"
    ffmpeg(*audio_source(), "-c:a", "pcm_s16le", str(wav))
    add(wav.name, "wav", ["pcm_s16le"])

    flac = OUT / "flac-audio.flac"
    ffmpeg(*audio_source(), "-c:a", "flac", str(flac))
    add(flac.name, "flac", ["flac"])

    multi = OUT / "multi-audio.mkv"
    ffmpeg(*video_source(), *audio_source(440), *audio_source(660),
           "-map", "0:v", "-map", "1:a", "-map", "2:a",
           "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", str(multi))
    add(multi.name, "matroska", ["h264", "aac", "aac"], (160, 90))

    corrupt = OUT / "corrupt.mp4"
    corrupt.write_bytes(b"not a valid video container\x00\x01\x02")
    spec[corrupt.name] = {"expect_error": True}

    (OUT / "manifest.json").write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return spec


if __name__ == "__main__":
    specs = make()
    print(f"Generated {len(specs)} fixtures in {OUT}")
