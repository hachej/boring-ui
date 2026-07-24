#!/usr/bin/env python3
"""Stream a local audio fixture to WhisperLiveKit at real-time cadence.

Requires `ffmpeg` and the Python `websockets` package. The fixture is read in
place and is never copied by this probe.
"""

import argparse
import asyncio
import json
import subprocess
import time
from pathlib import Path

import websockets


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--url", default="ws://127.0.0.1:8000/asr?language=fr&mode=full")
    parser.add_argument("--drain-seconds", type=float, default=15.0)
    parser.add_argument("--frame-ms", type=int, default=100)
    return parser.parse_args()


async def run(args: argparse.Namespace) -> dict:
    if not args.audio.is_file():
        raise FileNotFoundError(args.audio)
    if args.frame_ms <= 0:
        raise ValueError("--frame-ms must be positive")

    started = time.monotonic()
    audio_started = None
    first_text = None
    first_speaker = None
    last_message = None
    message_count = 0
    speakers: set[int] = set()
    maximum_diarization_backlog = 0.0
    receiving = True

    async with websockets.connect(args.url, max_size=8_000_000) as websocket:
        config = json.loads(await websocket.recv())
        if config.get("type") != "config":
            raise RuntimeError(f"unexpected first event: {config}")

        async def receive_results() -> None:
            nonlocal first_text, first_speaker, last_message, message_count
            nonlocal maximum_diarization_backlog, receiving
            while receiving:
                try:
                    raw = await asyncio.wait_for(websocket.recv(), timeout=0.5)
                except TimeoutError:
                    continue
                except websockets.ConnectionClosed:
                    return
                message = json.loads(raw)
                message_count += 1
                last_message = message
                maximum_diarization_backlog = max(
                    maximum_diarization_backlog,
                    float(message.get("remaining_time_diarization") or 0),
                )
                lines = message.get("lines", [])
                has_text = any(line.get("text") for line in lines)
                for line in lines:
                    speaker = line.get("speaker")
                    if isinstance(speaker, int) and speaker >= 0:
                        speakers.add(speaker)
                now = time.monotonic()
                if has_text and first_text is None:
                    first_text = now - audio_started
                if speakers and first_speaker is None:
                    first_speaker = now - audio_started

        receiver = asyncio.create_task(receive_results())
        frame_bytes = 16_000 * 2 * args.frame_ms // 1_000
        process = subprocess.Popen(
            [
                "ffmpeg", "-loglevel", "error", "-i", str(args.audio),
                "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1",
                "-ar", "16000", "pipe:1",
            ],
            stdout=subprocess.PIPE,
        )
        assert process.stdout is not None
        audio_started = time.monotonic()
        bytes_sent = 0
        while chunk := process.stdout.read(frame_bytes):
            await websocket.send(chunk)
            bytes_sent += len(chunk)
            await asyncio.sleep(len(chunk) / 2 / 16_000)
        if process.wait() != 0:
            raise RuntimeError("ffmpeg failed")

        await asyncio.sleep(args.drain_seconds)
        receiving = False
        await receiver

    return {
        "audio": str(args.audio),
        "bytesSent": bytes_sent,
        "audioSeconds": bytes_sent / 2 / 16_000,
        "wallSeconds": round(time.monotonic() - started, 3),
        "firstTextSeconds": None if first_text is None else round(first_text, 3),
        "firstSpeakerSeconds": None if first_speaker is None else round(first_speaker, 3),
        "messageCount": message_count,
        "speakers": sorted(speakers),
        "maximumDiarizationBacklogSeconds": round(maximum_diarization_backlog, 3),
        "lines": (last_message or {}).get("lines", []),
    }


def main() -> None:
    args = parse_args()
    print(json.dumps(asyncio.run(run(args)), ensure_ascii=False))


if __name__ == "__main__":
    main()
