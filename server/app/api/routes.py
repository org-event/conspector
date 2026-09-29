"""HTTP API routes."""

import threading
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from app.config import settings
from app.services.asr import is_model_loaded, segments_to_transcript_text, transcribe_file
from app.services.jobs import store
from app.services.summarize import summarize_transcript

router = APIRouter()

# One heavy ASR (+ sequential summarize) at a time on the prototype.
_pipeline_lock = threading.Lock()


@router.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "asrModel": settings.asr_model,
        "asrReady": is_model_loaded(),
        "llm": settings.ollama_model,
    }


def run_job_pipeline(job_id: str) -> None:
    """queued → transcribing (ASR) → summarizing → done|error."""
    with _pipeline_lock:
        try:
            job_dir = Path(settings.data_dir) / "jobs" / job_id
            audio_path = job_dir / "audio.webm"

            store.update(job_id, status="transcribing", progress=0.2)
            transcript = transcribe_file(audio_path)
            transcript_text = segments_to_transcript_text(transcript)

            store.update(job_id, status="summarizing", progress=0.7)
            summary = summarize_transcript(transcript_text)
            store.update(
                job_id,
                status="done",
                progress=1.0,
                error=None,
                result={
                    "transcript": transcript,
                    "transcriptText": transcript_text,
                    "summary": summary,
                },
            )
        except Exception as exc:  # noqa: BLE001 — surface error on the job
            store.update(job_id, status="error", error=str(exc), progress=1.0)


@router.post("/v1/jobs", status_code=202)
async def create_job(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    speakers: UploadFile = File(...),
    meta: str = Form(...),
) -> dict:
    job = store.create()
    job_dir = Path(settings.data_dir) / "jobs" / job.id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "audio.webm").write_bytes(await audio.read())
    (job_dir / "speakers.jsonl").write_bytes(await speakers.read())
    (job_dir / "meta.json").write_text(meta, encoding="utf-8")
    background_tasks.add_task(run_job_pipeline, job.id)
    return {"id": job.id, "status": job.status}


@router.get("/v1/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "id": job.id,
        "status": job.status,
        "error": job.error,
        "progress": job.progress,
        "result": job.result,
    }
