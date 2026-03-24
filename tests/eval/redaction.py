"""Pre-write secret fingerprint scanner and redaction pipeline.

Runs BEFORE any artifact is written to disk. Security-critical module.

Detection methods (in priority order):
    1. Exact match against registered secret values
    2. Common encodings (base64, URL-encoded) of registered values
    3. Provider-specific token patterns (sk-ant-*, hvs.*, neon-*, ghp_*, etc.)
    4. High-entropy heuristic (Shannon entropy > threshold for 20+ char strings)
"""

from __future__ import annotations

import base64
import math
import re
import subprocess
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote as url_quote


# ---------------------------------------------------------------------------
# Detection result
# ---------------------------------------------------------------------------

@dataclass
class SecretMatch:
    """A detected secret occurrence in text."""

    name: str                     # registered name or pattern name
    start: int                    # char offset in original text
    end: int                      # char offset end
    method: str                   # exact | encoding | pattern | entropy
    confidence: str = "high"      # high | medium | low

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "start": self.start,
            "end": self.end,
            "method": self.method,
            "confidence": self.confidence,
        }


# ---------------------------------------------------------------------------
# Provider-specific token patterns
# ---------------------------------------------------------------------------

_TOKEN_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("anthropic_api_key", re.compile(r"sk-ant-[a-zA-Z0-9_-]{20,}")),
    ("openai_api_key", re.compile(r"sk-[a-zA-Z0-9]{20,}")),
    ("vault_token", re.compile(r"hvs\.[a-zA-Z0-9_-]{20,}")),
    ("github_pat", re.compile(r"ghp_[a-zA-Z0-9]{36,}")),
    ("github_fine_grained", re.compile(r"github_pat_[a-zA-Z0-9_]{20,}")),
    ("neon_api_key", re.compile(r"neon-[a-zA-Z0-9_-]{20,}")),
    ("fly_api_token", re.compile(r"fo1_[a-zA-Z0-9_-]{20,}")),
    ("generic_bearer", re.compile(r"Bearer\s+[a-zA-Z0-9._-]{20,}")),
    ("postgres_url", re.compile(r"postgres(?:ql)?://[^@\s]+:[^@\s]+@[^\s]+")),
]


# ---------------------------------------------------------------------------
# HTTP header safety
# ---------------------------------------------------------------------------

#: Headers safe to persist in HTTP captures.
SAFE_HEADERS: frozenset[str] = frozenset({
    "content-type",
    "content-length",
    "accept",
    "user-agent",
    "host",
    "x-request-id",
    "x-trace-id",
    "server",
    "date",
    "cache-control",
    "vary",
    "access-control-allow-origin",
    "access-control-allow-methods",
})

#: Headers that must NEVER be persisted.
FORBIDDEN_HEADERS: frozenset[str] = frozenset({
    "authorization",
    "cookie",
    "set-cookie",
    "x-csrf-token",
    "x-xsrf-token",
    "proxy-authorization",
})


# ---------------------------------------------------------------------------
# Entropy calculation
# ---------------------------------------------------------------------------

_ENTROPY_THRESHOLD = 4.0
_ENTROPY_MIN_LENGTH = 20


def _shannon_entropy(s: str) -> float:
    """Calculate Shannon entropy of a string."""
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    length = len(s)
    return -sum(
        (count / length) * math.log2(count / length)
        for count in freq.values()
    )


def _looks_like_secret(s: str) -> bool:
    """Heuristic: high-entropy string that looks credential-like."""
    if len(s) < _ENTROPY_MIN_LENGTH:
        return False
    entropy = _shannon_entropy(s)
    if entropy < _ENTROPY_THRESHOLD:
        return False
    # Additional heuristic: contains mix of upper, lower, digits
    has_upper = any(c.isupper() for c in s)
    has_lower = any(c.islower() for c in s)
    has_digit = any(c.isdigit() for c in s)
    return sum([has_upper, has_lower, has_digit]) >= 2


# ---------------------------------------------------------------------------
# SecretRegistry
# ---------------------------------------------------------------------------

class SecretRegistry:
    """Registry of known secret values with scanning and redaction.

    Register secrets before scanning. The registry builds lookup
    structures for exact match, encoding variants, and patterns.
    Raw secret values are kept in memory only and never persisted.
    """

    def __init__(self) -> None:
        self._secrets: dict[str, str] = {}       # name -> raw value
        self._encodings: dict[str, str] = {}     # encoded_form -> name

    def register(self, name: str, value: str) -> None:
        """Register a known secret value."""
        if not value or len(value) < 4:
            return  # too short to be meaningful
        self._secrets[name] = value
        # Pre-compute common encodings
        try:
            b64 = base64.b64encode(value.encode()).decode()
            self._encodings[b64] = name
        except Exception:
            pass
        url_enc = url_quote(value, safe="")
        if url_enc != value:
            self._encodings[url_enc] = name

    def register_from_vault(self, path: str, field_name: str) -> bool:
        """Fetch a secret from Vault and register it.

        Returns True if successful.
        """
        try:
            result = subprocess.run(
                ["vault", "kv", "get", f"-field={field_name}", path],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0 and result.stdout.strip():
                name = f"{path}:{field_name}"
                self.register(name, result.stdout.strip())
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        return False

    def register_session_token(self, token: str) -> None:
        """Register an observed authentication token."""
        self.register("session_token", token)

    @property
    def count(self) -> int:
        """Number of registered secrets."""
        return len(self._secrets)

    # -- Scanning ---------------------------------------------------------

    def scan(self, text: str) -> list[SecretMatch]:
        """Scan text for all secret occurrences.

        Returns matches sorted by position.
        """
        matches: list[SecretMatch] = []

        # 1. Exact match against registered values
        for name, value in self._secrets.items():
            start = 0
            while True:
                idx = text.find(value, start)
                if idx == -1:
                    break
                matches.append(SecretMatch(
                    name=name,
                    start=idx,
                    end=idx + len(value),
                    method="exact",
                    confidence="high",
                ))
                start = idx + 1

        # 2. Encoding variants
        for encoded, name in self._encodings.items():
            start = 0
            while True:
                idx = text.find(encoded, start)
                if idx == -1:
                    break
                matches.append(SecretMatch(
                    name=name,
                    start=idx,
                    end=idx + len(encoded),
                    method="encoding",
                    confidence="high",
                ))
                start = idx + 1

        # 3. Provider-specific token patterns
        for pattern_name, pattern in _TOKEN_PATTERNS:
            for m in pattern.finditer(text):
                # Skip if already covered by exact match
                if any(
                    em.start <= m.start() and em.end >= m.end()
                    for em in matches
                ):
                    continue
                matches.append(SecretMatch(
                    name=pattern_name,
                    start=m.start(),
                    end=m.end(),
                    method="pattern",
                    confidence="medium",
                ))

        # Sort by position
        matches.sort(key=lambda m: (m.start, -m.end))
        return matches

    def scan_high_entropy(self, text: str) -> list[SecretMatch]:
        """Scan for high-entropy strings that might be secrets.

        This is a separate method because it has higher false-positive
        rates. Use for the sec.high_entropy_scan_clean check.
        """
        matches: list[SecretMatch] = []
        # Split on whitespace and common delimiters
        tokens = re.split(r'[\s"\'`=:,{}\[\]()]+', text)
        offset = 0
        for token in tokens:
            if _looks_like_secret(token):
                idx = text.find(token, offset)
                if idx >= 0:
                    matches.append(SecretMatch(
                        name="high_entropy",
                        start=idx,
                        end=idx + len(token),
                        method="entropy",
                        confidence="low",
                    ))
                    offset = idx + 1
        return matches

    # -- Redaction ---------------------------------------------------------

    def redact(self, text: str) -> str:
        """Replace all detected secrets with [REDACTED:<name>].

        Processes matches from right to left to preserve positions.
        """
        matches = self.scan(text)
        if not matches:
            return text

        # Deduplicate overlapping ranges (prefer longer/earlier)
        deduped = _deduplicate_matches(matches)

        # Replace from right to left
        result = text
        for m in reversed(deduped):
            placeholder = f"[REDACTED:{m.name}]"
            result = result[:m.start] + placeholder + result[m.end:]

        return result

    def has_secrets(self, text: str) -> bool:
        """Quick check: does text contain any registered secrets?"""
        return len(self.scan(text)) > 0


# ---------------------------------------------------------------------------
# Header redaction
# ---------------------------------------------------------------------------

def redact_headers(
    headers: dict[str, str],
) -> dict[str, str]:
    """Redact HTTP headers, keeping only safe ones.

    Forbidden headers are replaced with ``[REDACTED]``.
    Unknown headers are omitted entirely.
    """
    result: dict[str, str] = {}
    for key, value in headers.items():
        lower = key.lower()
        if lower in FORBIDDEN_HEADERS:
            result[key] = "[REDACTED]"
        elif lower in SAFE_HEADERS:
            result[key] = value
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _deduplicate_matches(matches: list[SecretMatch]) -> list[SecretMatch]:
    """Remove overlapping matches, preferring longer/higher-confidence."""
    if not matches:
        return []

    # Sort by start, then by length descending
    sorted_matches = sorted(matches, key=lambda m: (m.start, -(m.end - m.start)))
    result: list[SecretMatch] = [sorted_matches[0]]

    for m in sorted_matches[1:]:
        last = result[-1]
        if m.start >= last.end:
            result.append(m)
        # Skip overlapping (already covered by a longer match)

    return result
