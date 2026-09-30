"""HTTP API routes."""

import threading
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse

from app.config import settings
from app.services.asr import is_model_loaded, segments_to_transcript_text, transcribe_file
from app.services.conspect_md import ensure_conspect_html, write_conspect_md
from app.services.jobs import store
from app.services.summarize import summarize_transcript

router = APIRouter()

# One heavy ASR (+ sequential summarize) at a time on the prototype.
_pipeline_lock = threading.Lock()


def _ensure_conspect_files(job_id: str) -> Path | None:
    """Return job_dir if conspect.md exists (writing from in-memory result if needed)."""
    job_dir = Path(settings.data_dir) / "jobs" / job_id
    path = job_dir / "conspect.md"
    if path.exists() and path.stat().st_size > 0:
        return job_dir

    job = store.get(job_id)
    if job is not None and job.status == "done" and job.result:
        result = job.result or {}
        write_conspect_md(
            job_dir,
            job_id=job_id,
            transcript_text=str(result.get("transcriptText") or ""),
            summary=str(result.get("summary") or ""),
        )
        if path.exists():
            return job_dir
    return None


def _conspect_unavailable(job_id: str) -> None:
    job_dir = Path(settings.data_dir) / "jobs" / job_id
    job = store.get(job_id)
    if not (job_dir / "audio.webm").exists() and job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    raise HTTPException(
        status_code=409,
        detail="Конспект ещё не готов (или сервер перезапускали до записи файла)",
    )


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
            write_conspect_md(
                job_dir,
                job_id=job_id,
                transcript_text=transcript_text,
                summary=summary,
            )
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


@router.get("/v1/jobs/{job_id}/conspect.md")
def get_conspect_markdown(job_id: str):
    """Download meeting notes as Markdown."""
    job_dir = _ensure_conspect_files(job_id)
    if job_dir is None:
        _conspect_unavailable(job_id)
    return FileResponse(
        job_dir / "conspect.md",
        media_type="text/markdown; charset=utf-8",
        filename=f"{job_id}-conspect.md",
    )


@router.get("/v1/jobs/{job_id}/conspect.html")
def get_conspect_html(job_id: str):
    """Browser view with working <details> transcript collapse."""
    job_dir = _ensure_conspect_files(job_id)
    if job_dir is None:
        _conspect_unavailable(job_id)
    html_path = ensure_conspect_html(job_dir, job_id)
    if html_path is None:
        raise HTTPException(status_code=409, detail="HTML-конспект ещё не готов")
    return HTMLResponse(html_path.read_text(encoding="utf-8"))
