"""Unit tests for ASR helpers (mocked onnx-asr)."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import asr


@pytest.fixture(autouse=True)
def reset_asr():
    asr.reset_model_for_tests()
    yield
    asr.reset_model_for_tests()


def test_segments_to_transcript_text():
    text = asr.segments_to_transcript_text(
        [
            {"start": 0.0, "end": 1.5, "text": "Привет"},
            {"start": 65.2, "end": 70.0, "text": "  мир  "},
            {"start": 70.0, "end": 71.0, "text": "   "},
        ]
    )
    assert text == "[00:00] Привет\n[01:05] мир"


def test_transcribe_empty_file_returns_empty(tmp_path):
    empty = tmp_path / "empty.webm"
    empty.write_bytes(b"")
    assert asr.transcribe_file(empty) == []


def test_transcribe_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        asr.transcribe_file(tmp_path / "missing.webm")


def test_transcribe_file_uses_model(tmp_path, monkeypatch):
    audio = tmp_path / "speech.wav"
    audio.write_bytes(b"not-empty")

    class FakeModel:
        def recognize(self, path):
            assert path == str(audio)
            return [
                SimpleNamespace(start=0.0, end=1.0, text=" раз "),
                SimpleNamespace(start=1.0, end=2.0, text="два"),
            ]

    monkeypatch.setattr(asr, "load_model", lambda: FakeModel())
    out = asr.transcribe_file(audio)
    assert out == [
        {"start": 0.0, "end": 1.0, "text": "раз"},
        {"start": 1.0, "end": 2.0, "text": "два"},
    ]
    assert asr.segments_to_transcript_text(out) == "[00:00] раз\n[00:01] два"


def test_transcribe_webm_converts_via_ffmpeg(tmp_path, monkeypatch):
    audio = tmp_path / "speech.webm"
    audio.write_bytes(b"fake-webm")
    converted = tmp_path / "converted.wav"
    converted.write_bytes(b"wav-bytes")

    calls: list[tuple[Path, Path]] = []

    def fake_ffmpeg(src: Path, dst: Path) -> None:
        calls.append((src, dst))
        dst.write_bytes(b"wav")

    class FakeModel:
        def recognize(self, path):
            assert Path(path).suffix == ".wav"
            return [SimpleNamespace(start=0.5, end=1.5, text="Ок.")]

    monkeypatch.setattr(asr, "_ffmpeg_to_wav", fake_ffmpeg)
    monkeypatch.setattr(asr, "load_model", lambda: FakeModel())
    out = asr.transcribe_file(audio)
    assert len(calls) == 1
    assert calls[0][0] == audio
    assert out == [{"start": 0.5, "end": 1.5, "text": "Ок."}]


def test_is_model_loaded_false_until_load(monkeypatch):
    assert asr.is_model_loaded() is False

    import sys
    from types import ModuleType

    mod = ModuleType("onnx_asr")

    def load_model(name, **kwargs):
        m = SimpleNamespace()
        m.with_vad = lambda vad: m
        return m

    mod.load_model = load_model
    mod.load_vad = lambda name, **kwargs: object()
    monkeypatch.setitem(sys.modules, "onnx_asr", mod)

    asr.load_model()
    assert asr.is_model_loaded() is True
    asr.load_model()
    assert asr.is_model_loaded() is True
