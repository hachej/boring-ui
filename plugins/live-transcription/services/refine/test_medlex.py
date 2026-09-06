#!/usr/bin/env python3
"""Unit tests for medlex.py. No network, no BDPM/freqlist files: builds a
tiny lexicon inline."""
import json
import os
import tempfile
import unittest

import medlex as M


def _entry(name: str, ntok: int | None = None) -> dict:
    parts = name.split()
    return {"name": name, "ntok": ntok if ntok is not None else len(parts), "key": "".join(M.phonetic_key(p) for p in parts)}


LEXICON = [
    _entry("zyloric"),
    _entry("mucomyst"),
    _entry("josamycine"),
    _entry("havrix"),
    _entry("duphaston"),
    _entry("xanax"),
    _entry("kardegic"),
    _entry("lopressor"),
    _entry("advil"),
    _entry("doliprane codeine"),
]

GUARD = set(M.FORM_WORDS) | {"bonjour", "avec", "pour", "dans", "docteur", "matin"}


def make_snapper() -> M.Snapper:
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"lexicon": LEXICON, "guard": sorted(GUARD)}, f)
    try:
        return M.Snapper(path)
    finally:
        os.unlink(path)


def words(*texts: str) -> list[dict]:
    out = []
    t = 0.0
    for text in texts:
        out.append({"text": text, "startSeconds": t, "endSeconds": t + 0.3, "speaker": 0})
        t += 0.4
    return out


class PhoneticKeyTest(unittest.TestCase):
    """The exact phonetic pairs validated on the bench."""

    def test_known_pairs_share_a_key(self):
        pairs = [
            ("zylorique", "zyloric"),
            ("mucomiste", "mucomyst"),
            ("josamicine", "josamycine"),
            ("avrix", "havrix"),
            ("dufaston", "duphaston"),
            ("zanax", "xanax"),
            ("cardejic", "kardegic"),
        ]
        for a, b in pairs:
            with self.subTest(a=a, b=b):
                self.assertEqual(M.phonetic_key(a), M.phonetic_key(b))

    def test_itacan_hytacand_within_levenshtein_1(self):
        ka, kb = M.phonetic_key("itacan"), M.phonetic_key("hytacand")
        self.assertLessEqual(M.lev(ka, kb), 1)


class SnapWordsTest(unittest.TestCase):
    def setUp(self):
        self.snapper = make_snapper()

    def test_exact_single_token_snap_preserves_timestamps(self):
        w = words("bonjour", "zylorique", "docteur")
        out = self.snapper.snap_words(w)
        self.assertEqual([x["text"] for x in out], ["bonjour", "Zyloric", "docteur"])
        self.assertEqual(out[1]["corrected_from"], "zylorique")
        self.assertEqual(out[1]["startSeconds"], w[1]["startSeconds"])
        self.assertEqual(out[1]["endSeconds"], w[1]["endSeconds"])
        self.assertNotIn("corrected_from", out[0])
        self.assertNotIn("corrected_from", out[2])

    def test_guard_form_word_gelule_is_never_snapped(self):
        w = words("gelule")
        out = self.snapper.snap_words(w)
        self.assertEqual(out[0]["text"], "gelule")
        self.assertNotIn("corrected_from", out[0])

    def test_guard_form_word_flacon_is_never_snapped(self):
        w = words("flacon")
        out = self.snapper.snap_words(w)
        self.assertEqual(out[0]["text"], "flacon")
        self.assertNotIn("corrected_from", out[0])

    def test_guard_apostrophe_token_quelle_is_never_snapped(self):
        w = words("qu'elle")
        out = self.snapper.snap_words(w)
        self.assertEqual(out[0]["text"], "qu'elle")
        self.assertNotIn("corrected_from", out[0])

    def test_guard_token_that_is_already_a_lexicon_name_is_left_alone(self):
        w = words("xanax")
        out = self.snapper.snap_words(w)
        self.assertEqual(out[0]["text"], "xanax")
        self.assertNotIn("corrected_from", out[0])

    def test_guard_numeric_token_is_never_snapped(self):
        w = words("1234")
        out = self.snapper.snap_words(w)
        self.assertEqual(out[0]["text"], "1234")
        self.assertNotIn("corrected_from", out[0])

    def test_two_token_merge_sums_span_and_drops_second_word(self):
        w = words("prenez", "doliprane", "kodeine", "matin")
        out = self.snapper.snap_words(w)
        self.assertEqual([x["text"] for x in out], ["prenez", "Doliprane codeine", "matin"])
        self.assertEqual(out[1]["corrected_from"], "doliprane kodeine")
        self.assertEqual(out[1]["startSeconds"], w[1]["startSeconds"])
        self.assertEqual(out[1]["endSeconds"], w[2]["endSeconds"])

    def test_levenshtein_1_snap_applies_only_to_tokens_of_length_7_or_more(self):
        # "loprassor" (len 9) is one key-edit away from lexicon "lopressor"
        # and long enough to use the Levenshtein-1 fallback.
        long_out = self.snapper.snap_words(words("loprassor"))
        self.assertEqual(long_out[0]["text"], "Lopressor")
        self.assertEqual(long_out[0]["corrected_from"], "loprassor")

        # "advol" (len 5) is one key-edit away from lexicon "advil" but is
        # too short for the Levenshtein-1 fallback, so it must be left alone.
        short_out = self.snapper.snap_words(words("advol"))
        self.assertEqual(short_out[0]["text"], "advol")
        self.assertNotIn("corrected_from", short_out[0])

    def test_other_fields_are_preserved(self):
        w = words("zylorique")
        w[0]["speaker"] = 2
        out = self.snapper.snap_words(w)
        self.assertEqual(out[0]["speaker"], 2)


class BuildLexiconGuardTest(unittest.TestCase):
    def test_guard_merges_frequency_list_and_form_words(self):
        with tempfile.TemporaryDirectory() as tmp:
            bdpm_dir = os.path.join(tmp, "bdpm")
            os.makedirs(bdpm_dir)
            with open(os.path.join(bdpm_dir, "CIS_bdpm.txt"), "w", encoding="iso-8859-1") as f:
                f.write("60000000\tZYLORIC 100 mg, comprime\tcomprime\n")
            with open(os.path.join(bdpm_dir, "CIS_COMPO_bdpm.txt"), "w", encoding="iso-8859-1") as f:
                f.write("60000000\tcomprime\t1\tALLOPURINOL (DCI)\t500 mg\n")
            freq_path = os.path.join(tmp, "freq.txt")
            with open(freq_path, "w", encoding="utf-8") as f:
                f.write("le\nde\nun\nbonjour\n")
            out_json = os.path.join(tmp, "lexicon.json")

            data = M.build_lexicon(bdpm_dir, freq_path, out_json)

            self.assertIn("gelule", data["guard"])
            self.assertIn("bonjour", data["guard"])
            names = {e["name"] for e in data["lexicon"]}
            self.assertIn("zyloric", names)
            self.assertIn("allopurinol", names)
            self.assertTrue(os.path.exists(out_json))


if __name__ == "__main__":
    unittest.main()
