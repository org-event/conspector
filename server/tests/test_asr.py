"""Unit tests for ASR helpers (mocked WhisperModel)."""

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
    audio = tmp_path / "speech.webm"
    audio.write_bytes(b"not-empty")

    class FakeModel:
        def transcribe(self, path, language=None, vad_filter=None):
            assert path == str(audio)
            segs = [
                SimpleNamespace(start=0.0, end=1.0, text=" раз "),
                SimpleNamespace(start=1.0, end=2.0, text="два"),
            ]
            return segs, SimpleNamespace(language="ru")

    monkeypatch.setattr(asr, "load_model", lambda: FakeModel())
    out = asr.transcribe_file(audio)
    assert out == [
        {"start": 0.0, "end": 1.0, "text": "раз"},
        {"start": 1.0, "end": 2.0, "text": "два"},
    ]
    assert asr.segments_to_transcript_text(out) == "[00:00] раз\n[00:01] два"


def test_is_model_loaded_false_until_load(monkeypatch):
    assert asr.is_model_loaded() is False

    class StubWhisper:
        def __init__(self, *args, **kwargs):
            pass

    monkeypatch.setattr("faster_whisper.WhisperModel", StubWhisper)
    asr.load_model()
    assert asr.is_model_loaded() is True
    # second call reuses
    asr.load_model()
    assert asr.is_model_loaded() is True
