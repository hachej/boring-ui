#!/usr/bin/env python3
"""Loopback-only batch "refine" transcription service.

Decodes an uploaded audio file, transcribes it with faster-whisper, diarizes
it by replaying the audio through the Streaming Sortformer sidecar's own
online-inference class (imported from --sidecar-path, never copied), and
merges per-word speakers with the same rule used by the live pipeline
(kyutaiDiarized.ts DIARIZATION_LAG_SECONDS = 0.2).
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

DIARIZATION_LAG_SECONDS = 0.2
FRAME_SAMPLES = 1_600  # 100 ms @ 16 kHz, matches the sidecar's network frame
MAX_FILE_BYTES = 200 * 1024 * 1024
MAX_AUDIO_SECONDS = 4 * 3600
MODEL_NAME = "large-v3-turbo"


def decode_to_pcm16k(raw: bytes) -> np.ndarray:
    """ffmpeg decode to 16 kHz mono float32, piped like replay_score.py's decode()."""
    process = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
         "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"],
        input=raw, capture_output=True, timeout=600,
    )
    if process.returncode != 0 or not process.stdout:
        raise ValueError("ffmpeg could not decode this file")
    return np.frombuffer(process.stdout, dtype=np.float32)


def merge(words: list[dict], segments: list[dict], lag: float) -> list[int]:
    """Port of kyutaiDiarized.ts' merge rule (see replay_score.py's merge())."""
    intervals = sorted(
        ((max(0.0, s["startSeconds"] - lag), max(0.0, s["endSeconds"] - lag), s["speaker"]) for s in segments),
        key=lambda item: (item[0], item[2]),
    )
    raw: list[int | None] = []
    for index, word in enumerate(words):
        end = word.get("end") or (words[index + 1]["start"] if index + 1 < len(words) else None)
        best = None
        for start, stop, speaker in intervals:
            if end is None or end <= word["start"]:
                if start <= word["start"] < stop:
                    best = (speaker, 1, start)
                    break
                continue
            overlap = min(end, stop) - max(word["start"], start)
            if overlap <= 0:
                continue
            if best is None or overlap > best[1] or (overlap == best[1] and (start < best[2] or (start == best[2] and speaker < best[0]))):
                best = (speaker, overlap, start)
        raw.append(None if best is None else best[0])
    carried, last = [], -1
    for value in raw:
        if value is not None:
            last = value
        carried.append(last)
    out = carried[:]
    for i in range(1, len(out) - 1):
        if carried[i - 1] == carried[i + 1] and carried[i] != carried[i - 1]:
            out[i] = carried[i - 1]
    return out


class Refiner:
    def __init__(self, sidecar_path: str, model_path: str | None, token: str):
        sys.path.insert(0, sidecar_path)
        import sidecar as sidecar_module
        self.sidecar_module = sidecar_module
        self.sidecar = sidecar_module.Sidecar(model_path, token)
        self.token = token
        self.busy = threading.Semaphore(1)

        from faster_whisper import WhisperModel
        self.whisper = WhisperModel(MODEL_NAME, device="cuda", compute_type="int8_float16")

    def warm_up(self) -> None:
        asyncio.run(self.sidecar.warm_up())

    async def diarize(self, audio: np.ndarray, max_speakers: int) -> list[dict]:
        module = self.sidecar_module
        module.MAX_SPEAKERS = max_speakers
        online = self.sidecar.online_type(shared_model=self.sidecar.shared_model)
        segments: list = []
        total_samples = len(audio)
        fed = 0
        try:
            for offset in range(0, total_samples, FRAME_SAMPLES):
                chunk = audio[offset:offset + FRAME_SAMPLES]
                if len(chunk) < FRAME_SAMPLES:
                    chunk = np.concatenate([chunk, np.zeros(FRAME_SAMPLES - len(chunk), dtype=np.float32)])
                online.insert_audio_chunk(chunk)
                fed += FRAME_SAMPLES
                new_segments = await online.diarize()
                if new_segments:
                    module.append_segments(segments, new_segments, min(fed, total_samples) / 16_000)
            threshold = int(online.chunk_duration_seconds * 16_000)
            if 0 < len(online.buffer_audio) < threshold:
                online.insert_audio_chunk(np.zeros(threshold - len(online.buffer_audio), dtype=np.float32))
                final_segments = await online.diarize()
                if final_segments:
                    module.append_segments(segments, final_segments, total_samples / 16_000)
        finally:
            online.close()
        from dataclasses import asdict
        return [asdict(segment) for segment in segments]

    def transcribe(self, audio: np.ndarray, language: str) -> list[dict]:
        segments, _info = self.whisper.transcribe(
            audio, language=language, beam_size=5, vad_filter=True,
            condition_on_previous_text=False, word_timestamps=True,
        )
        # faster-whisper times French elisions (e.g. "n'" + "accompagnait") as two
        # separate word tokens with no leading space before the second one; a
        # token with no leading space is a continuation of the previous word,
        # not a new one, so glue it back on rather than emitting a false split.
        words: list[dict] = []
        for segment in segments:
            for word in segment.words or []:
                if words and not word.word.startswith(" "):
                    words[-1]["text"] += word.word
                    words[-1]["end"] = word.end
                else:
                    words.append({"text": word.word.strip(), "start": word.start, "end": word.end})
        return words

    def refine(self, audio: np.ndarray, language: str, max_speakers: int) -> dict:
        started = time.monotonic()
        words = self.transcribe(audio, language)
        segments = asyncio.run(self.diarize(audio, max_speakers))
        labels = merge(words, segments, DIARIZATION_LAG_SECONDS)
        out_words = [
            {"text": w["text"], "startSeconds": w["start"], "endSeconds": w["end"], "speaker": label}
            for w, label in zip(words, labels)
        ]
        return {
            "durationSeconds": len(audio) / 16_000,
            "language": language,
            "model": MODEL_NAME,
            "wallSeconds": time.monotonic() - started,
            "words": out_words,
            "segments": segments,
        }


def parse_multipart_body(body: bytes, boundary: bytes) -> dict[str, tuple[dict[str, str], bytes]]:
    """Minimal multipart/form-data parser: name -> (headers, value bytes)."""
    delimiter = b"--" + boundary
    parts = body.split(delimiter)
    fields: dict[str, tuple[dict[str, str], bytes]] = {}
    for part in parts:
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        header_blob, _, value = part.partition(b"\r\n\r\n")
        if not _:
            continue
        headers: dict[str, str] = {}
        disposition = ""
        for line in header_blob.split(b"\r\n"):
            name, _, raw_value = line.partition(b":")
            headers[name.strip().decode("latin1").lower()] = raw_value.strip().decode("latin1")
            if name.strip().lower() == b"content-disposition":
                disposition = raw_value.strip().decode("latin1")
        field_name = None
        for piece in disposition.split(";"):
            piece = piece.strip()
            if piece.startswith("name="):
                field_name = piece[len("name="):].strip('"')
        if field_name:
            fields[field_name] = (headers, value.rstrip(b"\r\n"))
    return fields


def parse_multipart(handler: "RefineHandler") -> tuple[bytes, dict[str, str]]:
    content_type = handler.headers.get("Content-Type", "")
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0 or length > MAX_FILE_BYTES:
        raise OverflowError("request too large")
    if "multipart/form-data" not in content_type or "boundary=" not in content_type:
        raise ValueError("expected multipart/form-data")
    boundary = content_type.split("boundary=", 1)[-1].strip('"').encode()
    body = handler.rfile.read(length)
    form = parse_multipart_body(body, boundary)
    if "file" not in form:
        raise ValueError("missing file field")
    file_bytes = form["file"][1]
    if len(file_bytes) > MAX_FILE_BYTES:
        raise OverflowError("request too large")
    fields = {
        "language": form["language"][1].decode("utf-8", "replace") if "language" in form else "fr",
        "maxSpeakers": form["maxSpeakers"][1].decode("utf-8", "replace") if "maxSpeakers" in form else "3",
    }
    return file_bytes, fields


class RefineHandler(BaseHTTPRequestHandler):
    refiner: Refiner
    token: str

    def _send(self, status: int, payload: dict) -> None:
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "").encode("utf-8", errors="replace")
        return hmac.compare_digest(supplied, f"Bearer {self.token}".encode())

    def _rejected(self) -> bool:
        if self.headers.get("Origin"):
            self._send(403, {"error": "browser origins are forbidden"})
            return True
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return True
        return False

    def do_GET(self) -> None:
        if self._rejected():
            return
        if self.path == "/v1/health":
            busy = not self.refiner.busy.acquire(blocking=False)
            if not busy:
                self.refiner.busy.release()
            return self._send(200, {"ok": True, "busy": busy})
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self._rejected():
            return
        if self.path != "/v1/refine":
            return self._send(404, {"error": "not found"})
        try:
            file_bytes, fields = parse_multipart(self)
        except OverflowError as error:
            return self._send(413, {"error": str(error)})
        except ValueError as error:
            return self._send(400, {"error": str(error)})

        if not self.refiner.busy.acquire(blocking=False):
            return self._send(429, {"error": "busy"})
        try:
            language = (fields.get("language") or "fr").strip() or "fr"
            try:
                max_speakers = int(fields.get("maxSpeakers") or 3)
            except ValueError:
                max_speakers = 3
            max_speakers = min(4, max(2, max_speakers))
            try:
                audio = decode_to_pcm16k(file_bytes)
            except ValueError as error:
                return self._send(415, {"error": str(error)})
            if len(audio) / 16_000 > MAX_AUDIO_SECONDS:
                return self._send(413, {"error": "audio too long"})
            try:
                result = self.refiner.refine(audio, language, max_speakers)
            except Exception as error:  # noqa: BLE001 - reported to caller
                print(f"refine failed: {error}", flush=True)
                return self._send(500, {"error": str(error)})
            self._send(200, result)
        finally:
            self.refiner.busy.release()

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"refine api: {fmt % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18884)
    parser.add_argument("--sidecar-path", default="/opt/boring-sortformer-poc")
    parser.add_argument("--model-path")
    parser.add_argument("--token", default=os.environ.get("BORING_REFINE_TOKEN"))
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("refine server must bind to loopback")
    if not args.token:
        raise SystemExit("BORING_REFINE_TOKEN or --token is required")

    refiner = Refiner(args.sidecar_path, args.model_path, args.token)
    refiner.warm_up()
    RefineHandler.refiner = refiner
    RefineHandler.token = args.token
    server = ThreadingHTTPServer((args.host, args.port), RefineHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
