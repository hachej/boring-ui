import json
import unittest
from types import SimpleNamespace

from sidecar import Segment, append_segments, parse_start, parse_stop


class ProtocolTests(unittest.TestCase):
    def test_accepts_exact_start_and_stop(self):
        parse_start(json.dumps({
            "type": "start",
            "protocol": "boring.sortformer.v1",
            "encoding": "pcm_s16le",
            "sampleRateHz": 16000,
            "channels": 1,
            "frameDurationMs": 100,
        }))
        self.assertEqual(parse_stop('{"type":"stop","id":7}'), 7)

    def test_rejects_protocol_drift(self):
        with self.assertRaises(ValueError):
            parse_start('{"type":"start","protocol":"other"}')
        with self.assertRaises(ValueError):
            parse_stop('{"type":"stop","id":"7"}')

    def test_coalesces_and_clamps_segments_to_real_audio(self):
        segments = []
        append_segments(segments, [
            SimpleNamespace(speaker=0, start=0.0, end=0.5),
            SimpleNamespace(speaker=0, start=0.5, end=1.2),
            SimpleNamespace(speaker=1, start=1.2, end=2.5),
        ], 2.0)
        self.assertEqual(segments, [Segment(0, 0.0, 1.2), Segment(1, 1.2, 2.0)])


if __name__ == "__main__":
    unittest.main()
