#!/usr/bin/env python3
"""Pure-python unit tests: no CUDA, no faster-whisper, no sidecar import."""
import asyncio
import json
import os
import tempfile
import unittest

import medlex
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


class RefineLexiconWiringTest(unittest.TestCase):
    """Exercises Refiner.refine()'s snapper wiring without CUDA/whisper/sidecar:
    transcribe/diarize are stubbed, only the lexicon-snap + corrections plumbing
    is under test."""

    def _snapper(self) -> medlex.Snapper:
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        lexicon = [{"name": "zyloric", "ntok": 1, "key": medlex.phonetic_key("zyloric")}]
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"lexicon": lexicon, "guard": sorted(medlex.FORM_WORDS)}, f)
        try:
            return medlex.Snapper(path)
        finally:
            os.unlink(path)

    def _bare_refiner(self, snapper) -> rs.Refiner:
        refiner = object.__new__(rs.Refiner)
        refiner.snapper = snapper
        return refiner

    def test_corrections_are_reported_and_words_carry_corrected_from(self):
        refiner = self._bare_refiner(self._snapper())
        refiner.transcribe = lambda audio, language: [
            {"text": "zylorique", "start": 0.0, "end": 0.5},
            {"text": "bonjour", "start": 0.6, "end": 1.0},
        ]
        refiner.diarize = lambda audio, max_speakers: asyncio.sleep(0, result=[])

        result = refiner.refine(audio=[], language="fr", max_speakers=3)

        self.assertEqual(result["words"][0]["text"], "Zyloric")
        self.assertEqual(result["words"][0]["corrected_from"], "zylorique")
        self.assertNotIn("corrected_from", result["words"][1])
        self.assertEqual(result["corrections"], [{"from": "zylorique", "to": "Zyloric", "startSeconds": 0.0}])

    def test_corrections_report_strips_edge_punctuation_but_words_keep_it(self):
        refiner = self._bare_refiner(self._snapper())
        refiner.transcribe = lambda audio, language: [
            {"text": "zylorique,", "start": 0.0, "end": 0.5},
        ]
        refiner.diarize = lambda audio, max_speakers: asyncio.sleep(0, result=[])

        result = refiner.refine(audio=[], language="fr", max_speakers=3)

        # the transcript word itself keeps whatever punctuation whisper produced
        self.assertEqual(result["words"][0]["text"], "Zyloric")
        self.assertEqual(result["words"][0]["corrected_from"], "zylorique,")
        # but the corrections report is cleaned up
        self.assertEqual(result["corrections"], [{"from": "zylorique", "to": "Zyloric", "startSeconds": 0.0}])

    def test_no_snapper_means_no_corrections(self):
        refiner = self._bare_refiner(None)
        refiner.transcribe = lambda audio, language: [{"text": "zylorique", "start": 0.0, "end": 0.5}]
        refiner.diarize = lambda audio, max_speakers: asyncio.sleep(0, result=[])

        result = refiner.refine(audio=[], language="fr", max_speakers=3)

        self.assertEqual(result["words"][0]["text"], "zylorique")
        self.assertNotIn("corrected_from", result["words"][0])
        self.assertEqual(result["corrections"], [])


class HotwordsFileTest(unittest.TestCase):
    def _write(self, content: str) -> str:
        fd, path = tempfile.mkstemp(suffix=".txt")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        self.addCleanup(os.unlink, path)
        return path

    def test_one_name_per_line(self):
        path = self._write("Doliprane\nAdvil\nZyloric\n")
        self.assertEqual(rs.parse_hotwords_file(path), ["Doliprane", "Advil", "Zyloric"])

    def test_full_line_comments_and_blank_lines_are_ignored(self):
        path = self._write("# drug hotwords\nDoliprane\n\n# another comment\nAdvil\n\n")
        self.assertEqual(rs.parse_hotwords_file(path), ["Doliprane", "Advil"])

    def test_trailing_comments_are_stripped(self):
        path = self._write("Doliprane  # brand name\nAdvil#no space\n")
        self.assertEqual(rs.parse_hotwords_file(path), ["Doliprane", "Advil"])

    def test_whitespace_only_lines_are_ignored(self):
        path = self._write("Doliprane\n   \n\t\nAdvil\n")
        self.assertEqual(rs.parse_hotwords_file(path), ["Doliprane", "Advil"])

    def test_empty_file(self):
        path = self._write("")
        self.assertEqual(rs.parse_hotwords_file(path), [])


class LimitsTest(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(rs.MAX_FILE_BYTES, 200 * 1024 * 1024)
        self.assertEqual(rs.MAX_AUDIO_SECONDS, 4 * 3600)
        self.assertEqual(rs.FRAME_SAMPLES, 1_600)
        self.assertAlmostEqual(rs.DIARIZATION_LAG_SECONDS, 0.2)
        self.assertEqual(rs.MODEL_NAME, "large-v3-turbo")


if __name__ == "__main__":
    unittest.main()
