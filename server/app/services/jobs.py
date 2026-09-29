"""In-memory job store (prototype: single process, jobs lost on restart)."""

import uuid
from dataclasses import dataclass
from typing import Any


@dataclass
class Job:
    id: str
    status: str = "queued"
    error: str | None = None
    progress: float = 0.0
    result: dict[str, Any] | None = None


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}

    def create(self) -> Job:
        job = Job(id=f"job_{uuid.uuid4().hex}")
        self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def update(self, job_id: str, **fields: Any) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        for name in ("status", "error", "progress", "result"):
            if name in fields:
                setattr(job, name, fields[name])
        return job


store = JobStore()
