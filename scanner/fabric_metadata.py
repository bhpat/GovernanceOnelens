"""Pure normalization helpers for Fabric and Power BI scanner payloads."""

import hashlib
import math

_BYTE_FIELDS = ("sizeBytes", "sizeInBytes", "storageSizeInBytes")
_MEGABYTE_FIELDS = ("sizeInMB", "sizeMb")
_ROLE_FIELDS = (
    "workspaceUserAccessRight",
    "groupUserAccessRight",
    "datasetUserAccessRight",
    "reportUserAccessRight",
    "dataflowUserAccessRight",
    "dashboardUserAccessRight",
    "datamartUserAccessRight",
)


def _non_negative_number(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def extract_size_bytes(payload: dict) -> int | None:
    """Return a non-negative byte count from known Fabric/PBI size fields."""
    for field in _BYTE_FIELDS:
        number = _non_negative_number(payload.get(field))
        if number is not None:
            return int(number)
    for field in _MEGABYTE_FIELDS:
        number = _non_negative_number(payload.get(field))
        if number is not None:
            return int(number * 1024 * 1024)
    return None


def normalize_role_assignments(scope_type: str, native_scope_id: object, users: object) -> list[dict]:
    """Convert scanner `users` payloads into stable RoleAssignment rows."""
    if not native_scope_id or not isinstance(users, list):
        return []

    scope_id = str(native_scope_id)
    scope_kind = scope_type.lower()
    rows: dict[str, dict] = {}
    for user in users:
        if not isinstance(user, dict):
            continue
        principal_id = user.get("graphId") or user.get("identifier") or user.get("emailAddress")
        role = next((user.get(field) for field in _ROLE_FIELDS if user.get(field)), None)
        if not principal_id or not role or role == "None":
            continue

        principal_id = str(principal_id)
        role = str(role)
        source_key = f"{scope_type}:{scope_id}:{principal_id.lower()}:{role.lower()}"
        digest = hashlib.sha256(source_key.encode("utf-8")).hexdigest()
        canonical_id = f"fabric:roleassignment:{digest}"
        principal_type = str(user.get("principalType") or "Unknown")
        if principal_type.lower() in ("app", "serviceprincipal"):
            principal_type = "ServicePrincipal"
        display_name = user.get("displayName") or user.get("emailAddress") or user.get("identifier")
        rows[canonical_id] = {
            "canonicalId": canonical_id,
            "sourceId": source_key[:400],
            "principalId": principal_id[:400],
            "principalType": principal_type[:64],
            "principalDisplayName": str(display_name)[:400] if display_name else None,
            "role": role[:128],
            "scopeType": scope_type,
            "scopeCanonicalId": f"fabric:{scope_kind}:{scope_id}"[:400],
        }
    return list(rows.values())