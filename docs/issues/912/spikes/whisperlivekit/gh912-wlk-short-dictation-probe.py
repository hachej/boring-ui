#!/usr/bin/env python3
"""Probe WhisperLiveKit's short-dictation REST path with synthetic WebM/Opus.

The probe requires ffmpeg, creates the tone/container in memory, writes no audio
files, and accepts an empty transcript because a pure tone contains no speech.
"""

import argparse
import json
import subprocess
import urllib.error
import urllib.request
import uuid


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:18772/v1/audio/transcriptions",
    )
    parser.add_argument("--timeout", type=float, default=60.0)
    return parser.parse_args()


def synthetic_webm() -> tuple[bytes, str]:
    version = subprocess.run(
        ["ffmpeg", "-version"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()[0]
    encoded = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "libopus",
            "-f",
            "webm",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    ).stdout
    if not encoded.startswith(b"\x1aE\xdf\xa3"):
        raise RuntimeError("ffmpeg did not produce a WebM container")
    return encoded, version


def multipart(webm: bytes) -> tuple[bytes, str]:
    boundary = f"boring-gh912-{uuid.uuid4().hex}"
    chunks = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ntiny\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nfr\r\n".encode(),
        (
            f"--{boundary}\r\n"
            "Content-Disposition: form-data; name=\"file\"; filename=\"synthetic.webm\"\r\n"
            "Content-Type: audio/webm;codecs=opus\r\n\r\n"
        ).encode(),
        webm,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    return b"".join(chunks), boundary


def main() -> None:
    args = parse_args()
    webm, ffmpeg_version = synthetic_webm()
    body, boundary = multipart(webm)
    request = urllib.request.Request(
        args.url,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            status = response.status
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"WhisperLiveKit rejected synthetic WebM ({error.code}): {detail}") from error
    if status != 200 or not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
        raise RuntimeError(f"invalid WhisperLiveKit response: status={status} payload={payload!r}")
    print(json.dumps({
        "ok": True,
        "url": args.url,
        "webmBytes": len(webm),
        "text": payload["text"],
        "ffmpeg": ffmpeg_version,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
