from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate import ValidationError, validate_record  # noqa: E402


class TestMediaAssertions(unittest.TestCase):
    def setUp(self) -> None:
        self.data = {
            "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "1.2"},
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 160, "height": 90},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
        }
        self.expected = {"container": "mp4", "codecs": ["h264", "aac"], "width": 160, "height": 90}

    def test_accepts_real_compatible_metadata(self) -> None:
        validate_record(self.data, self.expected)

    def test_rejects_wrong_audio_codec(self) -> None:
        self.data["streams"][1]["codec_name"] = "mp3"
        with self.assertRaisesRegex(ValidationError, "Codec mismatch"):
            validate_record(self.data, self.expected)

    def test_rejects_wrong_dimensions(self) -> None:
        self.data["streams"][0]["width"] = 120
        with self.assertRaisesRegex(ValidationError, "width mismatch"):
            validate_record(self.data, self.expected)

    def test_rejects_invalid_duration(self) -> None:
        self.data["format"]["duration"] = "NaN"
        with self.assertRaisesRegex(ValidationError, "duration"):
            validate_record(self.data, self.expected)

    def test_rejects_fake_container(self) -> None:
        self.expected["container"] = "webm"
        with self.assertRaisesRegex(ValidationError, "Container mismatch"):
            validate_record(self.data, self.expected)


if __name__ == "__main__":
    unittest.main()
