"""Validated configuration shared by OneLens CLI and Fabric Spark scripts."""

import json
import os
import sys
import uuid
from pathlib import Path


RUNTIME_CONFIG_FILE = "onelens_runtime_config.json"


def _candidate_paths() -> list[Path]:
    """Where onelens_runtime_config.json might live.

    Normally it sits right beside this file. But a Fabric Spark Job Definition
    can stage this module into a DIFFERENT directory than the main script (see
    deploy_sjd.py's additionalLibraryUris) — in that case __file__'s own
    directory is wrong, but the main script's directory (sys.argv[0]) still has
    it, since deploy_sjd.py always uploads the json beside the executableFile.
    Check both rather than assuming one deployment layout.
    """
    seen: list[Path] = []
    for base in (Path(__file__).parent, Path(sys.argv[0]).parent if sys.argv and sys.argv[0] else None):
        if base is not None and base not in seen:
            seen.append(base)
    return [base / RUNTIME_CONFIG_FILE for base in seen]


def _runtime_values() -> dict[str, str]:
    override = os.environ.get("ONELENS_RUNTIME_CONFIG_FILE", "").strip()
    candidates = [Path(override)] if override else _candidate_paths()
    path = next((p for p in candidates if p.is_file()), None)
    if path is None:
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"OneLens runtime config is invalid: {path}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"OneLens runtime config must be a JSON object: {path}")
    return {str(key): str(value).strip() for key, value in payload.items() if value is not None}


def configured(name: str, default: str | None = None) -> str | None:
    """Read a non-empty environment value, then the deployed runtime config."""
    environment_value = os.environ.get(name, "").strip()
    if environment_value:
        return environment_value
    file_value = _runtime_values().get(name, "").strip()
    return file_value or default


def required(name: str) -> str:
    value = configured(name)
    if not value:
        raise RuntimeError(f"Required OneLens configuration {name} is not set.")
    return value


def required_uuid(name: str) -> str:
    value = required(name)
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise RuntimeError(f"Environment variable {name} must be a UUID.") from exc
    return value


def positive_int(name: str, default: int) -> int:
    raw = configured(name, str(default)) or str(default)
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Environment variable {name} must be an integer.") from exc
    if value <= 0:
        raise RuntimeError(f"Environment variable {name} must be greater than zero.")
    return value