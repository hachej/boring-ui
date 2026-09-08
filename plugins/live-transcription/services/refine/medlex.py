#!/usr/bin/env python3
"""French drug-name phonetic "lexicon snap" for the offline refine service.

Ports the validated logic from the bench scripts (`snap_eval.py`'s
`snap()`/`eligible()`, `medlex.py`'s `phonetic_key()`) that raised drug-name
recall from 54% to 66% on a French prescription bench, 1 harmful change out
of 66.

Two entry points:

- `build_lexicon(bdpm_dir, freq_path, out_json)`: builds the BDPM brand/
  molecule lexicon plus a French-word guard list and writes both to a single
  JSON file. Run once, offline (`python3 medlex.py build ...`).
- `Snapper(lexicon_path)`: loads that JSON once and exposes `snap_words()`,
  which corrects an already-transcribed word list in place (preserving
  timestamps, only ever touching `text`).

Guard: eligibility for a phonetic snap requires the token be at least 4
characters, not purely numeric, contain no apostrophe, not already be a
lexicon name itself, and not appear in a combined guard set consisting of
the most frequent French words (from `freq_path`, which already subsumes
the "5,000 most frequent words" cutoff used on the bench since that is a
prefix of the same list) plus a fixed list of pharmaceutical form/unit
words (gélule, flacon, comprimé, ...). Lexicon entries that are themselves
ordinary French words (e.g. "cellules", "fer", "gel") are dropped at build
time so they can never be a snap target.

Matching: exact phonetic-key equality is tried first, on single tokens and
on two-token windows (which merge into one word). Levenshtein-distance-1 on
the phonetic *key* (not the raw token) is tried only for single tokens of
length >= 7, to keep short-token false positives down.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import unicodedata

# ---------- pharmaceutical form/unit words (guard) ----------
FORM_WORDS = (
    "gelule gelules flacon flacons collyre collyres suppositoire suppositoires "
    "comprime comprimes dragee dragees sachet sachets ampoule ampoules sirop "
    "pommade creme gouttes goutte gramme grammes milligramme milligrammes "
    "microgramme microgrammes millilitre millilitres unite unites cuillere "
    "cuilleres patch patchs spray injection injections capsule capsules boite "
    "boites tube tubes dose doses prise prises matin midi soir jour jours "
    "semaine semaines mois heure heures fois demi quart poudre solution "
    "suspension buvable orale orales gel gels ovule ovules"
).split()


# ---------- normalization ----------
def strip_edge_punct(s: str) -> str:
    """Strip leading/trailing punctuation (quotes, commas, etc.) from a string,
    leaving interior characters (accents, apostrophes, hyphens) untouched.

    Used to clean up the `from`/`to` values reported in the refine service's
    `corrections` list (e.g. "Antacapone," -> "Antacapone"); the corrected
    word's actual `text` in the transcript keeps its surrounding punctuation.
    """
    return re.sub(r"^[^\w]+|[^\w]+$", "", s, flags=re.UNICODE)


def strip_accents(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def norm(t: str) -> str:
    """Same tokenizer used to build the bench: lowercase, strip accents,
    drop filler interjections, keep only [a-z0-9' ]."""
    t = unicodedata.normalize("NFKD", t.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"\b(heu|euh|hum|hein|bah|ben)\b", " ", t)
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    t = re.sub(r"\b\w-\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def lev(a: str, b: str) -> int:
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * lb
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[lb]


# ---------- phonetic_key (exact port) ----------
def phonetic_key(word: str) -> str:
    w = strip_accents(word.lower())
    w = re.sub(r"[^a-z]", "", w)
    if not w:
        return w

    # multi-letter vowel/diphthong groups first (order matters)
    w = w.replace("eau", "o")
    w = w.replace("au", "o")
    w = w.replace("ai", "e")
    w = w.replace("ei", "e")
    w = w.replace("ou", "u")
    w = w.replace("oi", "oa")
    w = w.replace("eu", "e")
    w = w.replace("oe", "e")

    # nasal groups: an/en/am/em -> "an" ; in/ain/ein/im -> "in" ; on/om kept as "on"
    w = w.replace("ain", "in").replace("ein", "in")
    w = w.replace("am", "an").replace("em", "an")
    w = w.replace("im", "in")
    # (an, en, on stay literal already matching target)
    w = w.replace("en", "an")

    # consonant digraphs / rules, left to right via regex substitution passes
    w = w.replace("ph", "f")
    w = w.replace("th", "t")
    # ch kept as ch
    w = w.replace("qu", "k")

    # c before e/i/y -> s ; other c -> k ; ck -> k
    w = w.replace("ck", "k")
    w = re.sub(r"c(?=[eiy])", "s", w)
    w = re.sub(r"c", "k", w)

    # g before e/i/y -> j
    w = re.sub(r"g(?=[eiy])", "j", w)

    w = w.replace("y", "i")
    w = w.replace("w", "v")
    # word-initial x is often pronounced like z in French (xylophone, Xanax);
    # treat leading x the same as z, other x -> "ks"
    w = re.sub(r"^x", "s", w)
    w = w.replace("x", "ks")
    w = w.replace("z", "s")
    w = w.replace("h", "")

    # collapse doubled letters
    w = re.sub(r"(.)\1+", r"\1", w)

    # drop trailing e/es
    w = re.sub(r"es$", "", w)
    w = re.sub(r"e$", "", w)

    return w


# ---------- lexicon build ----------
def _load_bdpm_names(bdpm_dir: str) -> set[str]:
    names: set[str] = set()
    path = os.path.join(bdpm_dir, "CIS_bdpm.txt")
    with open(path, encoding="iso-8859-1") as f:
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 2:
                continue
            spec = cols[1].strip()
            if not spec:
                continue
            # brand name: leading words before first digit or comma
            m = re.match(r"^([A-Za-zÀ-ÿ' .-]+?)(?=[0-9,]|$)", spec)
            head = m.group(1).strip() if m else spec
            tokens = [t for t in head.split() if t]
            if not tokens:
                continue
            first = re.sub(r"[^a-z]", "", strip_accents(tokens[0]).lower())
            if first and len(first) >= 3:
                names.add(first)
            if len(tokens) >= 2 and tokens[1].isalpha():
                second = re.sub(r"[^a-z]", "", strip_accents(tokens[1]).lower())
                if second and len(second) >= 2:
                    names.add(f"{first} {second}")
    return names


def _load_compo_names(bdpm_dir: str) -> set[str]:
    names: set[str] = set()
    path = os.path.join(bdpm_dir, "CIS_COMPO_bdpm.txt")
    with open(path, encoding="iso-8859-1") as f:
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 4:
                continue
            subst = cols[3].strip()
            if not subst:
                continue
            subst = subst.split("(")[0].strip()  # keep first word(s) before parentheses
            tokens = subst.split()
            if not tokens:
                continue
            first = re.sub(r"[^a-z]", "", strip_accents(tokens[0]).lower())
            if first and len(first) >= 3:
                names.add(first)
            if len(tokens) >= 2 and tokens[1].isalpha():
                second = re.sub(r"[^a-z]", "", strip_accents(tokens[1]).lower())
                if second and len(second) >= 2:
                    names.add(f"{first} {second}")
    return names


def _load_freq_words(freq_path: str, limit: int | None = None) -> list[str]:
    words: list[str] = []
    with open(freq_path, encoding="utf-8") as f:
        for line in f:
            if limit is not None and len(words) >= limit:
                break
            parts = line.strip().split()
            if not parts:
                continue
            words.append(parts[0])
    return words


def build_lexicon(bdpm_dir: str, freq_path: str, out_json: str) -> dict:
    """Build the BDPM lexicon and the guard set, and write both to `out_json`.

    Returns the dict that was written, mainly for tests/inspection.
    """
    names = _load_bdpm_names(bdpm_dir) | _load_compo_names(bdpm_dir)
    lexicon = []
    for n in names:
        parts = n.split()
        key = "".join(phonetic_key(p) for p in parts)
        lexicon.append({"name": n, "ntok": len(parts), "key": key})

    # Guard = most frequent French words (the bench's "5,000 most frequent"
    # cutoff is a prefix of this same frequency-ordered list, so taking the
    # whole list also satisfies the separate "not in the 50k frequency list"
    # eligibility check) plus pharmaceutical form/unit words.
    freq_words = _load_freq_words(freq_path)
    common = {norm(w) for w in freq_words}
    guard = set(common) | set(FORM_WORDS)

    # Drop lexicon entries that are themselves ordinary French words (e.g.
    # "cellules", "fer", "gel", "reine") so they can never be a snap target.
    lexicon = [e for e in lexicon if not (e["ntok"] == 1 and norm(e["name"]) in common)]

    data = {"lexicon": lexicon, "guard": sorted(guard)}
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


# ---------- snapping ----------
def _display(name: str) -> str:
    """Canonical spelling in lower-case except the first letter capitalised."""
    if not name:
        return name
    return name[0].upper() + name[1:].lower()


class Snapper:
    """Loads a lexicon JSON once and snaps unknown tokens to it."""

    def __init__(self, lexicon_path: str):
        with open(lexicon_path, encoding="utf-8") as f:
            data = json.load(f)
        self.guard: set[str] = set(data.get("guard", ()))
        lexicon = data.get("lexicon", ())
        self.key1: dict[str, set[str]] = collections.defaultdict(set)
        self.key2: dict[str, set[str]] = collections.defaultdict(set)
        self.bylen: dict[int, list[tuple[str, str]]] = collections.defaultdict(list)
        for e in lexicon:
            if e["ntok"] == 1:
                self.key1[e["key"]].add(e["name"])
                self.bylen[len(e["key"])].append((e["key"], e["name"]))
            elif e["ntok"] == 2:
                self.key2[e["key"]].add(e["name"])
        self.lexnames: set[str] = {e["name"] for e in lexicon if e["ntok"] == 1}

    def eligible(self, tok: str) -> bool:
        if not tok:
            return False
        if " " in tok:
            return False
        if tok in self.lexnames:
            return False
        if tok in self.guard:
            return False
        if len(tok) < 4:
            return False
        if tok.isdigit():
            return False
        if "'" in tok:
            return False
        return True

    def snap_words(self, words: list[dict]) -> list[dict]:
        """Correct a refine response's word list.

        `words` items must have at least `text`; other fields (timestamps,
        speaker, ...) are preserved untouched. Returns a new list: changed
        words get `text` replaced with the lexicon's canonical spelling and
        gain `corrected_from` (the original text); a two-token merge puts
        the merged name (and the summed span) on the first word and drops
        the second.
        """
        n = len(words)
        used = [False] * n
        drop = [False] * n
        result = [dict(w) for w in words]

        # two-token pass (exact key match only)
        i = 0
        while i < n - 1:
            if used[i] or used[i + 1]:
                i += 1
                continue
            raw1, raw2 = words[i]["text"], words[i + 1]["text"]
            t1, t2 = norm(raw1), norm(raw2)
            if self.eligible(t1) and self.eligible(t2):
                key = phonetic_key(t1) + phonetic_key(t2)
                names = self.key2.get(key)
                if names:
                    cand = sorted(names)[0]
                    if cand != f"{t1} {t2}":
                        result[i]["text"] = _display(cand)
                        result[i]["corrected_from"] = f"{raw1} {raw2}"
                        result[i]["endSeconds"] = words[i + 1].get("endSeconds", words[i].get("endSeconds"))
                        used[i] = used[i + 1] = True
                        drop[i + 1] = True
                        i += 2
                        continue
            i += 1

        # single-token pass (exact key match, then Levenshtein-1 on the key for len >= 7)
        for idx in range(n):
            if used[idx]:
                continue
            raw = words[idx]["text"]
            t = norm(raw)
            if not self.eligible(t):
                continue
            key = phonetic_key(t)
            if not key:
                continue
            cands = sorted(name for name in self.key1.get(key, ()) if name != t)
            if cands:
                result[idx]["text"] = _display(cands[0])
                result[idx]["corrected_from"] = raw
                continue
            if len(t) >= 7:
                klen = len(key)
                near: list[tuple[str, str]] = []
                for length in (klen - 1, klen, klen + 1):
                    near.extend(self.bylen.get(length, ()))
                hit = None
                for kk, name in sorted(near, key=lambda p: p[1]):
                    if name == t:
                        continue
                    if lev(key, kk) == 1:
                        hit = name
                        break
                if hit:
                    result[idx]["text"] = _display(hit)
                    result[idx]["corrected_from"] = raw

        return [w for w, d in zip(result, drop) if not d]


def _cli() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="build lexicon.json from BDPM + a frequency list")
    build.add_argument("--bdpm-dir", required=True, help="directory with CIS_bdpm.txt and CIS_COMPO_bdpm.txt")
    build.add_argument("--freq", required=True, help="frequency-ordered word list (one word per line)")
    build.add_argument("--out", required=True, help="output lexicon.json path")
    args = parser.parse_args()
    if args.command == "build":
        data = build_lexicon(args.bdpm_dir, args.freq, args.out)
        print(f"wrote {args.out}: {len(data['lexicon'])} lexicon entries, {len(data['guard'])} guard words")


if __name__ == "__main__":
    _cli()
