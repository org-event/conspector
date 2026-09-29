from app.services.jobs import JobStore


def test_create_returns_queued_job_with_id_format():
    store = JobStore()
    job = store.create()
    assert job.id.startswith("job_")
    assert len(job.id) == len("job_") + 32
    assert job.status == "queued"
    assert job.error is None
    assert job.progress == 0.0
    assert job.result is None


def test_get_returns_created_job():
    store = JobStore()
    job = store.create()
    assert store.get(job.id) is job


def test_get_unknown_returns_none():
    store = JobStore()
    assert store.get("job_nonexistent") is None


def test_update_changes_fields():
    store = JobStore()
    job = store.create()
    updated = store.update(job.id, status="done", progress=1.0, result={"summary": "x"})
    assert updated is not None
    assert updated.status == "done"
    assert updated.progress == 1.0
    assert updated.result == {"summary": "x"}
    assert store.get(job.id).status == "done"


def test_update_unknown_returns_none():
    store = JobStore()
    assert store.update("job_nonexistent", status="done") is None
