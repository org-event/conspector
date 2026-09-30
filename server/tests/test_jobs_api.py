import json
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import asr
from app.services.jobs import store


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "data"))


@pytest.fixture(autouse=True)
def reset_store():
    store._jobs.clear()
    yield
    store._jobs.clear()


@pytest.fixture(autouse=True)
def mock_summarize(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.summarize_transcript",
        lambda text, **_: f"MOCK_SUMMARY:{text[:40]}",
    )


@pytest.fixture(autouse=True)
def mock_asr(monkeypatch):
    asr.reset_model_for_tests()

    def fake_transcribe(path):
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(str(p))
        if p.stat().st_size == 0:
            return []
        return [{"start": 0.0, "end": 1.2, "text": "Привет команда"}]

    monkeypatch.setattr("app.api.routes.transcribe_file", fake_transcribe)
    monkeypatch.setattr(
        "app.api.routes.segments_to_transcript_text",
        asr.segments_to_transcript_text,
    )
    yield
    asr.reset_model_for_tests()


def make_upload(*, audio_bytes: bytes = b"fake-audio-bytes"):
    audio = ("meeting.webm", audio_bytes, "audio/webm")
    speakers = (
        "speakers.jsonl",
        '{"t": 1.0, "activeIds": ["u-1"], "names": ["Морозов"]}\n'.encode("utf-8"),
        "application/jsonl",
    )
    meta = json.dumps({"sessionId": "s1", "durationSec": 60, "language": "ru"})
    return audio, speakers, meta


def wait_for_status(client: TestClient, job_id: str, expected: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/v1/jobs/{job_id}").json()
        if body["status"] == expected:
            return body
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not reach status {expected!r}; last={body!r}")


def test_create_job_returns_202_and_saves_files():
    client = TestClient(app)
    audio, speakers, meta = make_upload()
    r = client.post("/v1/jobs", files={"audio": audio, "speakers": speakers}, data={"meta": meta})
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "queued"
    job_id = body["id"]
    assert job_id.startswith("job_")

    job_dir = Path(settings.data_dir) / "jobs" / job_id
    assert (job_dir / "audio.webm").read_bytes() == b"fake-audio-bytes"
    assert (job_dir / "speakers.jsonl").read_bytes().startswith(b'{"t": 1.0')
    assert json.loads((job_dir / "meta.json").read_text())["sessionId"] == "s1"


def test_job_reaches_done_with_asr_transcript():
    client = TestClient(app)
    audio, speakers, meta = make_upload()
    job_id = client.post(
        "/v1/jobs", files={"audio": audio, "speakers": speakers}, data={"meta": meta}
    ).json()["id"]

    body = wait_for_status(client, job_id, "done")
    assert body["error"] is None
    assert body["progress"] == 1.0
    assert body["result"]["transcript"] == [
        {"start": 0.0, "end": 1.2, "text": "Привет команда"}
    ]
    assert "Привет команда" in body["result"]["transcriptText"]
    assert body["result"]["summary"].startswith("MOCK_SUMMARY:")

    md_path = Path(settings.data_dir) / "jobs" / job_id / "conspect.md"
    assert md_path.exists()
    md = client.get(f"/v1/jobs/{job_id}/conspect.md")
    assert md.status_code == 200
    assert "Привет команда" in md.text
    assert "MOCK_SUMMARY" in md.text

    html_path = Path(settings.data_dir) / "jobs" / job_id / "conspect.html"
    assert html_path.exists()
    page = client.get(f"/v1/jobs/{job_id}/conspect.html")
    assert page.status_code == 200
    assert "text/html" in page.headers["content-type"]
    assert "<details>" in page.text
    assert "Привет команда" in page.text
    assert "MOCK_SUMMARY" in page.text


def test_conspect_md_before_done_returns_409():
    client = TestClient(app)
    job = store.create()
    r = client.get(f"/v1/jobs/{job.id}/conspect.md")
    assert r.status_code == 409


def test_job_asr_error_becomes_error_status(monkeypatch):
    def boom(_path):
        raise RuntimeError("модель не загрузилась")

    monkeypatch.setattr("app.api.routes.transcribe_file", boom)
    client = TestClient(app)
    audio, speakers, meta = make_upload()
    job_id = client.post(
        "/v1/jobs", files={"audio": audio, "speakers": speakers}, data={"meta": meta}
    ).json()["id"]

    body = wait_for_status(client, job_id, "error")
    assert "модель не загрузилась" in (body["error"] or "")


def test_second_job_waits_on_pipeline_lock(monkeypatch):
    from app.api.routes import run_job_pipeline

    release = threading.Event()
    entered = threading.Event()

    def slow_transcribe(path):
        entered.set()
        assert release.wait(timeout=5.0)
        return [{"start": 0.0, "end": 0.5, "text": "ок"}]

    monkeypatch.setattr("app.api.routes.transcribe_file", slow_transcribe)

    j1 = store.create()
    j2 = store.create()
    for job, payload in ((j1, b"one"), (j2, b"two")):
        job_dir = Path(settings.data_dir) / "jobs" / job.id
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "audio.webm").write_bytes(payload)
        (job_dir / "speakers.jsonl").write_text("", encoding="utf-8")
        (job_dir / "meta.json").write_text("{}", encoding="utf-8")

    t1 = threading.Thread(target=run_job_pipeline, args=(j1.id,))
    t2 = threading.Thread(target=run_job_pipeline, args=(j2.id,))
    t1.start()
    assert entered.wait(timeout=2.0)

    t2.start()
    time.sleep(0.15)
    assert store.get(j2.id).status == "queued"
    assert store.get(j1.id).status == "transcribing"

    release.set()
    t1.join(timeout=5.0)
    t2.join(timeout=5.0)
    assert store.get(j1.id).status == "done"
    assert store.get(j2.id).status == "done"


def test_get_existing_job_returns_full_shape():
    client = TestClient(app)
    audio, speakers, meta = make_upload()
    job_id = client.post(
        "/v1/jobs", files={"audio": audio, "speakers": speakers}, data={"meta": meta}
    ).json()["id"]
    r = client.get(f"/v1/jobs/{job_id}")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"id", "status", "error", "progress", "result"}
    assert body["id"] == job_id


def test_get_unknown_job_returns_404():
    client = TestClient(app)
    assert client.get("/v1/jobs/job_nonexistent").status_code == 404
