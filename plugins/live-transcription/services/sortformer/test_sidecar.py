import json
import unittest
from types import SimpleNamespace

import numpy as np

from sidecar import Segment, TwoSpeakerStabilizer, append_segments, delta_from_index, parse_start, parse_stop


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

    def test_delta_restarts_at_the_last_segment_the_client_holds(self):
        self.assertEqual(delta_from_index(0, 0), 0)
        self.assertEqual(delta_from_index(0, 3), 0)
        self.assertEqual(delta_from_index(3, 3), 2)  # last one may have been extended
        self.assertEqual(delta_from_index(3, 5), 2)

    def test_ignores_single_frame_speaker_spikes_but_switches_on_two(self):
        # SWITCH_CONFIRM_FRAMES = 2 (measured on SimSAMU): one 80 ms frame is a
        # flicker, two consecutive frames are a turn.
        stabilizer = TwoSpeakerStabilizer()
        spike = np.array([
            [0.90, 0.10, 0.05, 0.05],
            [0.82, 0.12, 0.05, 0.05],
            [0.30, 0.75, 0.05, 0.05],
            [0.88, 0.08, 0.05, 0.05],
        ])
        self.assertEqual(stabilizer.assign(spike), [0, 0, 0, 0])
        turn = np.array([
            [0.90, 0.10, 0.05, 0.05],
            [0.30, 0.75, 0.05, 0.05],
            [0.28, 0.78, 0.05, 0.05],
            [0.25, 0.80, 0.05, 0.05],
        ])
        self.assertEqual(TwoSpeakerStabilizer().assign(turn), [0, 0, 1, 1])

    def test_admits_only_one_sustained_second_speaker(self):
        stabilizer = TwoSpeakerStabilizer()
        first = np.tile([0.90, 0.10, 0.05, 0.05], (3, 1))
        second = np.tile([0.10, 0.90, 0.05, 0.05], (6, 1))
        third_channel = np.tile([0.05, 0.10, 0.92, 0.05], (6, 1))
        labels = stabilizer.assign(np.vstack([first, second, third_channel]))
        self.assertEqual(labels[:3], [0, 0, 0])
        self.assertEqual(labels[3], 0)          # first frame of the new voice is pending
        self.assertEqual(labels[4:9], [1] * 5)  # admitted after two frames
        self.assertEqual(set(labels), {0, 1})   # a third channel never gets a slot
        self.assertEqual(labels[-1], 1)

    def test_marks_low_confidence_frames_as_silence(self):
        stabilizer = TwoSpeakerStabilizer()
        labels = stabilizer.assign(np.array([
            [0.90, 0.10, 0.05, 0.05],
            [0.20, 0.20, 0.20, 0.20],
        ]))
        self.assertEqual(labels, [0, -1])


if __name__ == "__main__":
    unittest.main()
