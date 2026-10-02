"""Persist generated Home Assistant automation documents."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


class _NoAliasSafeDumper(yaml.SafeDumper):
    """Keep generated YAML explicit when mappings share nested values."""

    def ignore_aliases(self, data: object) -> bool:
        return True

    def increase_indent(self, flow: bool = False, indentless: bool = False) -> None:
        """Indent block sequences beneath their mapping keys."""
        super().increase_indent(flow, indentless=False)


def write_automation_files(
    path: Path,
    document: list[dict[str, Any]],
) -> None:
    """Replace the dedicated HA Notifications automation file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_text_atomically(path, automation_file_contents(document).decode("utf-8"))


def automation_file_contents(document: list[dict[str, Any]]) -> bytes:
    """Serialize the generated automation document for comparison or writing."""
    return _dump_yaml(document).encode("utf-8")


def _write_text_atomically(path: Path, content: str) -> None:
    """Replace a generated file only after its complete contents are written."""
    temporary_path = path.with_name(f".{path.name}.tmp")
    temporary_path.write_text(content)
    temporary_path.replace(path)


def _dump_yaml(value: object) -> str:
    """Serialize generated YAML without anchors or aliases."""
    return yaml.dump(value, Dumper=_NoAliasSafeDumper, sort_keys=False)


def read_file_bytes_if_exists(path: Path) -> bytes | None:
    """Read a file for rollback when it exists."""
    return path.read_bytes() if path.exists() else None


def restore_file(path: Path, original: bytes | None) -> None:
    """Restore a file from a rollback snapshot."""
    if original is None:
        path.unlink(missing_ok=True)
    else:
        path.write_bytes(original)