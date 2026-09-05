#!/usr/bin/env python3
"""Pure-python unit tests: no CUDA, no faster-whisper, no sidecar import."""
import unittest

import refine_server as rs


class MergeTest(unittest.TestCase):
    def test_basic_overlap_and_lag_shift(self):
        words = [
            {"text": "bonjour", "start": 0.0, "end": 0.5},
            {"text": "docteur", "start": 0.6, "end": 1.0},
            {"text": "ca", "start": 1.3, "end": 1.5},
            {"text": "va", "start": 1.5, "end": 1.8},
        ]
        # Segment boundaries are shifted back by 0.2s before matching.
        segments = [
            {"speaker": 0, "startSeconds": 0.0, "endSeconds": 1.2},
            {"speaker": 1, "startSeconds": 1.2, "endSeconds": 2.0},
        ]
        labels = rs.merge(words, segments, rs.DIARIZATION_LAG_SECONDS)
        self.assertEqual(labels, [0, 0, 1, 1])

    def test_no_evidence_before_first_segment_is_minus_one(self):
        words = [{"text": "x", "start": 0.0, "end": 0.1}]
        segments = [{"speaker": 0, "startSeconds": 5.0, "endSeconds": 6.0}]
        self.assertEqual(rs.merge(words, segments, 0.2), [-1])

    def test_no_overlap_carries_previous_speaker(self):
        words = [
            {"text": "a", "start": 0.0, "end": 0.5},
            {"text": "b", "start": 0.6, "end": 0.7},  # falls in a silent gap
            {"text": "c", "start": 1.0, "end": 1.5},
        ]
        segments = [
            {"speaker": 0, "startSeconds": 0.0, "endSeconds": 0.55},
            {"speaker": 0, "startSeconds": 0.95, "endSeconds": 1.6},
        ]
        labels = rs.merge(words, segments, 0.2)
        self.assertEqual(labels, [0, 0, 0])

    def test_single_word_flip_is_smoothed(self):
        words = [
            {"text": "a", "start": 0.0, "end": 0.3},
            {"text": "b", "start": 0.35, "end": 0.4},
            {"text": "c", "start": 0.5, "end": 0.8},
        ]
        segments = [
            {"speaker": 0, "startSeconds": 0.0, "endSeconds": 0.32},
            {"speaker": 1, "startSeconds": 0.32, "endSeconds": 0.42},
            {"speaker": 0, "startSeconds": 0.42, "endSeconds": 1.0},
        ]
        labels = rs.merge(words, segments, 0.0)
        # The middle word disagrees with both neighbours that agree with each
        # other, so it is smoothed to their shared speaker.
        self.assertEqual(labels, [0, 0, 0])

    def test_tie_break_earlier_start_then_lower_speaker(self):
        words = [{"text": "x", "start": 1.0, "end": 2.0}]
        segments = [
            {"speaker": 1, "startSeconds": 1.0, "endSeconds": 1.5},
            {"speaker": 0, "startSeconds": 1.5, "endSeconds": 2.0},
        ]
        # Equal overlap (0.5s each); earlier start (speaker 1) wins.
        self.assertEqual(rs.merge(words, segments, 0.0), [1])

    def test_empty_inputs(self):
        self.assertEqual(rs.merge([], [], 0.2), [])
        self.assertEqual(rs.merge([{"text": "x", "start": 0.0, "end": 0.1}], [], 0.2), [-1])


class MultipartTest(unittest.TestCase):
    def test_parses_file_and_fields(self):
        boundary = b"BoUnDaRy123"
        body = (
            b"--" + boundary + b"\r\n"
            b'Content-Disposition: form-data; name="file"; filename="a.wav"\r\n'
            b"Content-Type: audio/wav\r\n\r\n"
            b"FAKEAUDIOBYTES\r\n"
            b"--" + boundary + b"\r\n"
            b'Content-Disposition: form-data; name="language"\r\n\r\n'
            b"fr\r\n"
            b"--" + boundary + b"\r\n"
            b'Content-Disposition: form-data; name="maxSpeakers"\r\n\r\n'
            b"2\r\n"
            b"--" + boundary + b"--\r\n"
        )
        form = rs.parse_multipart_body(body, boundary)
        self.assertEqual(form["file"][1], b"FAKEAUDIOBYTES")
        self.assertEqual(form["language"][1], b"fr")
        self.assertEqual(form["maxSpeakers"][1], b"2")

    def test_missing_file_field(self):
        boundary = b"B"
        body = (
            b"--" + boundary + b"\r\n"
            b'Content-Disposition: form-data; name="language"\r\n\r\n'
            b"fr\r\n"
            b"--" + boundary + b"--\r\n"
        )
        form = rs.parse_multipart_body(body, boundary)
        self.assertNotIn("file", form)


class LimitsTest(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(rs.MAX_FILE_BYTES, 200 * 1024 * 1024)
        self.assertEqual(rs.MAX_AUDIO_SECONDS, 4 * 3600)
        self.assertEqual(rs.FRAME_SAMPLES, 1_600)
        self.assertAlmostEqual(rs.DIARIZATION_LAG_SECONDS, 0.2)
        self.assertEqual(rs.MODEL_NAME, "large-v3-turbo")


if __name__ == "__main__":
    unittest.main()
