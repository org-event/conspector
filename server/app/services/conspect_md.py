"""Write human-readable meeting notes as Markdown and HTML."""

from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def format_duration_hms(duration_sec: Any) -> str:
    """Format seconds as H:MM:SS (local-facing; no fractional seconds)."""
    try:
        total = int(round(float(duration_sec)))
    except (TypeError, ValueError):
        return "—"
    if total < 0:
        total = 0
    hours, rem = divmod(total, 3600)
    minutes, seconds = divmod(rem, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}"


def format_started_local(started_iso: Any) -> str:
    """ISO start → wall clock on this machine, without timezone suffix."""
    if started_iso is None or started_iso == "":
        return "—"
    raw = str(started_iso).strip()
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local = dt.astimezone()
        return local.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return str(started_iso)


def build_conspect_markdown(
    *,
    job_id: str,
    meta: dict[str, Any],
    transcript_text: str,
    summary: str,
) -> str:
    title = str(meta.get("title") or "Встреча")
    page_url = meta.get("pageUrl") or "—"
    duration = format_duration_hms(meta.get("durationSec", "—"))
    started = format_started_local(meta.get("startedAtIso") or "—")
    language = meta.get("language") or "ru"
    body_summary = (summary or "").strip() or "_нет_"
    body_transcript = (transcript_text or "").strip() or "_пусто_"
    # <details> is for GitHub / HTML views — not for raw .md in the IDE editor.
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
        f"- **Длительность:** {duration}\n"
        f"- **Начало:** {started}\n"
        f"- **Язык:** {language}\n\n"
        f"## Резюме (LLM)\n\n"
        f"{body_summary}\n\n"
        f"{transcript_block}"
    )


def _md_lite_to_html(text: str) -> str:
    """Escape + light **bold** / list / paragraph formatting for LLM summary."""
    escaped = html.escape((text or "").strip() or "—")
    lines = escaped.split("\n")
    out: list[str] = []
    in_list = False
    for line in lines:
        bolded = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
        bullet = re.match(r"^[\*\-]\s+(.+)$", bolded)
        if bullet:
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{bullet.group(1)}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        if not bolded.strip():
            continue
        out.append(f"<p>{bolded}</p>")
    if in_list:
        out.append("</ul>")
    return "\n".join(out) if out else "<p>—</p>"


def build_conspect_html(
    *,
    job_id: str,
    meta: dict[str, Any],
    transcript_text: str,
    summary: str,
) -> str:
    title = str(meta.get("title") or "Встреча")
    page_url = str(meta.get("pageUrl") or "—")
    duration = format_duration_hms(meta.get("durationSec", "—"))
    started = format_started_local(meta.get("startedAtIso") or "—")
    language = str(meta.get("language") or "ru")
    body_transcript = (transcript_text or "").strip() or "—"
    safe_title = html.escape(title)
    summary_html = _md_lite_to_html(summary)
    transcript_html = html.escape(body_transcript)
    page_url_html = html.escape(page_url)
    link = (
        f'<a href="{page_url_html}">{page_url_html}</a>'
        if page_url.startswith("http")
        else page_url_html
    )
    return f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="light dark" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Конспект: {safe_title}</title>
  <style>
    :root {{
      color-scheme: light dark;
      --bg: #f4f5f7;
      --card: #fff;
      --text: #1a1d23;
      --muted: #5c6570;
      --border: #d0d5dd;
      --accent: #2563eb;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #1e1f22;
        --card: #2b2d31;
        --text: #e8eaed;
        --muted: #9aa0a6;
        --border: #3f4147;
        --accent: #5b8def;
      }}
    }}
    body {{
      margin: 0;
      font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg);
    }}
    main {{
      max-width: 720px;
      margin: 24px auto;
      padding: 20px 22px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
    }}
    h1 {{ font-size: 1.35rem; margin: 0 0 12px; }}
    h2 {{ font-size: 1.1rem; margin: 24px 0 10px; }}
    ul.meta {{ padding-left: 1.2em; color: var(--muted); }}
    ul.meta a {{ color: var(--accent); }}
    details {{
      margin-top: 8px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      background: var(--bg);
    }}
    summary {{
      cursor: pointer;
      font-weight: 600;
      user-select: none;
    }}
    summary:hover {{ color: var(--accent); }}
    pre {{
      white-space: pre-wrap;
      word-break: break-word;
      margin: 12px 0 4px;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }}
    .raw {{ margin-top: 20px; font-size: 13px; color: var(--muted); }}
  </style>
</head>
<body>
  <main>
    <h1>Конспект: {safe_title}</h1>
    <ul class="meta">
      <li><strong>Job:</strong> <code>{html.escape(job_id)}</code></li>
      <li><strong>URL:</strong> {link}</li>
      <li><strong>Длительность:</strong> {html.escape(duration)}</li>
      <li><strong>Начало:</strong> {html.escape(started)}</li>
      <li><strong>Язык:</strong> {html.escape(language)}</li>
    </ul>
    <h2>Резюме (LLM)</h2>
    {summary_html}
    <h2>Транскрипт</h2>
    <details>
      <summary>Нажмите, чтобы развернуть транскрипт</summary>
      <pre>{transcript_html}</pre>
    </details>
    <p class="raw"><a href="./conspect.md">Скачать conspect.md</a></p>
  </main>
</body>
</html>
"""


def _load_meta(job_dir: Path) -> dict[str, Any]:
    meta_path = job_dir / "meta.json"
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_conspect_md(
    job_dir: Path,
    *,
    job_id: str,
    transcript_text: str,
    summary: str,
) -> Path:
    meta = _load_meta(job_dir)
    md = build_conspect_markdown(
        job_id=job_id,
        meta=meta,
        transcript_text=transcript_text,
        summary=summary,
    )
    html_doc = build_conspect_html(
        job_id=job_id,
        meta=meta,
        transcript_text=transcript_text,
        summary=summary,
    )
    out = job_dir / "conspect.md"
    out.write_text(md, encoding="utf-8")
    (job_dir / "conspect.html").write_text(html_doc, encoding="utf-8")
    return out


def ensure_conspect_html(job_dir: Path, job_id: str) -> Path | None:
    """Return path to conspect.html, rebuilding from .md for older jobs if needed."""
    html_path = job_dir / "conspect.html"
    if html_path.exists() and html_path.stat().st_size > 0:
        return html_path
    md_path = job_dir / "conspect.md"
    if not md_path.exists() or md_path.stat().st_size == 0:
        return None
    md_text = md_path.read_text(encoding="utf-8")
    summary = ""
    transcript = ""
    if "## Резюме (LLM)" in md_text:
        after = md_text.split("## Резюме (LLM)", 1)[-1]
        summary = after.split("<details>", 1)[0].strip() if "<details>" in after else after.strip()
    if "```" in md_text:
        parts = md_text.split("```")
        if len(parts) >= 2:
            transcript = parts[1].strip()
    html_path.write_text(
        build_conspect_html(
            job_id=job_id,
            meta=_load_meta(job_dir),
            transcript_text=transcript,
            summary=summary,
        ),
        encoding="utf-8",
    )
    return html_path
