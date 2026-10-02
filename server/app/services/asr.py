"""GigaAM (onnx-asr) ASR: singleton model + file transcription."""

from __future__ import annotations

import subprocess
import tempfile
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


def _onnx_providers() -> list[str] | None:
    """Force CPU on macOS-friendly setups; CoreML breaks GigaAM inference."""
    if settings.asr_device.lower() == "cpu":
        return ["CPUExecutionProvider"]
    return None


def _quantization() -> str | None:
    q = (settings.asr_compute_type or "").strip().lower()
    if q in ("int8", "fp16"):
        return q
    return None


def load_model() -> Any:
    """Load GigaAM via onnx-asr once per process (lazy or warmup)."""
    global _model
    with _model_lock:
        if _model is not None:
            return _model
        import onnx_asr

        providers = _onnx_providers()
        kwargs: dict[str, Any] = {}
        if providers is not None:
            kwargs["providers"] = providers
        quant = _quantization()
        if quant is not None:
            kwargs["quantization"] = quant

        model = onnx_asr.load_model(settings.asr_model, **kwargs)
        if settings.asr_vad_filter:
            vad_kwargs: dict[str, Any] = {}
            if providers is not None:
                vad_kwargs["providers"] = providers
            vad = onnx_asr.load_vad("silero", **vad_kwargs)
            model = model.with_vad(vad)
        _model = model
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


def _ffmpeg_to_wav(src: Path, dst: Path) -> None:
    """Decode any ffmpeg-readable audio to 16 kHz mono PCM WAV."""
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(dst),
    ]
    try:
        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffmpeg not found on PATH; install ffmpeg to decode meeting audio for ASR"
        ) from exc
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(f"ffmpeg failed converting {src.name}: {err[:500]}") from exc


def ensure_wav_16k_mono(path: Path) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    """Return a 16 kHz mono WAV path; may create a temp dir that caller must keep alive."""
    if path.suffix.lower() == ".wav":
        return path, None
    tmp = tempfile.TemporaryDirectory(prefix="conspector-asr-")
    wav = Path(tmp.name) / "audio.wav"
    _ffmpeg_to_wav(path, wav)
    return wav, tmp


def transcribe_file(path: str | Path) -> list[dict[str, Any]]:
    """Transcribe an audio file into [{start, end, text}, ...].

    Empty file → empty list (no error). Missing file → FileNotFoundError.
    Non-WAV inputs are converted via ffmpeg to 16 kHz mono WAV.
    """
    audio_path = Path(path)
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio not found: {audio_path}")
    if audio_path.stat().st_size == 0:
        return []

    wav_path, tmp = ensure_wav_16k_mono(audio_path)
    try:
        model = load_model()
        results = model.recognize(str(wav_path))
        # with_vad → iterable of SegmentResult; without → plain str
        if isinstance(results, str):
            text = results.strip()
            return [{"start": 0.0, "end": 0.0, "text": text}] if text else []

        out: list[dict[str, Any]] = []
        for seg in results:
            text = (getattr(seg, "text", None) or "").strip()
            if not text:
                continue
            out.append(
                {
                    "start": float(getattr(seg, "start", 0.0)),
                    "end": float(getattr(seg, "end", 0.0)),
                    "text": text,
                }
            )
        return out
    finally:
        if tmp is not None:
            tmp.cleanup()
