"""faster-whisper ASR: singleton model + file transcription."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from app.config import settings

_model: Any | None = None
_model_lock = threading.Lock()


def is_model_loaded() -> bool:
    return _model is not None


def reset_model_for_tests() -> None:
    """Drop in-memory model (tests only)."""
    global _model
    with _model_lock:
        _model = None


def load_model() -> Any:
    """Load WhisperModel once per process (lazy or warmup)."""
    global _model
    with _model_lock:
        if _model is not None:
            return _model
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            settings.asr_model,
            device=settings.asr_device,
            compute_type=settings.asr_compute_type,
        )
        return _model


def segments_to_transcript_text(segments: list[dict[str, Any]]) -> str:
    """Human-readable join of ASR segments with timestamps."""
    lines: list[str] = []
    for seg in segments:
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg.get("start", 0.0))
        mm = int(start // 60)
        ss = int(start % 60)
        lines.append(f"[{mm:02d}:{ss:02d}] {text}")
    return "\n".join(lines)


def transcribe_file(path: str | Path) -> list[dict[str, Any]]:
    """Transcribe an audio file into [{start, end, text}, ...].

    Empty file → empty list (no error). Missing file → FileNotFoundError.
    """
    audio_path = Path(path)
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio not found: {audio_path}")
    if audio_path.stat().st_size == 0:
        return []

    model = load_model()
    segments_iter, _info = model.transcribe(
        str(audio_path),
        language=settings.asr_language,
        vad_filter=settings.asr_vad_filter,
    )
    out: list[dict[str, Any]] = []
    for seg in segments_iter:
        text = (seg.text or "").strip()
        if not text:
            continue
        out.append(
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": text,
            }
        )
    return out
