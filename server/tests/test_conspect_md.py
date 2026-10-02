from app.services.conspect_md import (
    build_conspect_markdown,
    format_duration_hms,
    format_started_local,
)


def test_format_duration_hms():
    assert format_duration_hms(2719.725) == "0:45:20"
    assert format_duration_hms(65) == "0:01:05"
    assert format_duration_hms(3600) == "1:00:00"
    assert format_duration_hms("—") == "—"
    assert format_duration_hms(None) == "—"


def test_format_started_local_to_wall_clock(monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Moscow")
    import time

    time.tzset()

    assert format_started_local("2026-09-30T13:02:03.801Z") == "2026-09-30 16:02:03"
    assert format_started_local("") == "—"
    assert format_started_local(None) == "—"


def test_build_conspect_markdown_uses_friendly_meta(monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Moscow")
    import time

    time.tzset()

    md = build_conspect_markdown(
        job_id="job_x",
        meta={
            "title": "Тест",
            "pageUrl": "https://example.com",
            "durationSec": 2719.725,
            "startedAtIso": "2026-09-30T13:02:03.801Z",
            "language": "ru",
        },
        transcript_text="hi",
        summary="sum",
    )
    assert "- **Длительность:** 0:45:20\n" in md
    assert "- **Начало:** 2026-09-30 16:02:03\n" in md
    assert "2719.725" not in md
    assert "T13:02:03" not in md
