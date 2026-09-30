"""Write human-readable meeting notes as Markdown."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def build_conspect_markdown(
    *,
    job_id: str,
    meta: dict[str, Any],
    transcript_text: str,
    summary: str,
) -> str:
    title = str(meta.get("title") or "Встреча")
    page_url = meta.get("pageUrl") or "—"
    duration = meta.get("durationSec", "—")
    started = meta.get("startedAtIso") or "—"
    language = meta.get("language") or "ru"
    body_summary = (summary or "").strip() or "_нет_"
    body_transcript = (transcript_text or "").strip() or "_пусто_"
    # <details> works in GitHub, many MD previews, and browser tabs serving this file.
    if body_transcript == "_пусто_":
        transcript_inner = "_пусто_\n"
    else:
        transcript_inner = f"```\n{body_transcript}\n```\n"
    transcript_block = (
        "<details>\n"
        "<summary><strong>Транскрипт</strong> (нажмите, чтобы развернуть)</summary>\n\n"
        f"{transcript_inner}"
        "</details>\n"
    )
    return (
        f"# Конспект: {title}\n\n"
        f"- **Job:** `{job_id}`\n"
        f"- **URL:** {page_url}\n"
        f"- **Длительность:** {duration} с\n"
        f"- **Начало:** {started}\n"
        f"- **Язык:** {language}\n\n"
        f"## Резюме (LLM)\n\n"
        f"{body_summary}\n\n"
        f"{transcript_block}"
    )


def write_conspect_md(
    job_dir: Path,
    *,
    job_id: str,
    transcript_text: str,
    summary: str,
) -> Path:
    meta: dict[str, Any] = {}
    meta_path = job_dir / "meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            meta = {}
    text = build_conspect_markdown(
        job_id=job_id,
        meta=meta,
        transcript_text=transcript_text,
        summary=summary,
    )
    out = job_dir / "conspect.md"
    out.write_text(text, encoding="utf-8")
    return out
