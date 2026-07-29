"""Bounded polling for Microsoft Fabric long-running operations."""

import time

import requests

from onelens_config import positive_int

SUCCESS_STATUS = "Succeeded"
FAILURE_STATUSES = {"Failed", "Cancelled", "Canceled"}


def _retry_after(headers: requests.structures.CaseInsensitiveDict, default: float = 5.0) -> float:
    try:
        return max(0.1, min(float(headers.get("Retry-After", default)), 60.0))
    except (TypeError, ValueError):
        return default


def poll_lro(
    session: requests.Session,
    response: requests.Response,
    *,
    fetch_result: bool = False,
    timeout_seconds: int | None = None,
) -> dict:
    """Wait for a Fabric LRO and raise on rejection, failure, or timeout."""
    if response.status_code not in (200, 201, 202):
        raise RuntimeError(f"Fabric request failed {response.status_code}: {response.text[:800]}")
    if response.status_code != 202:
        return response.json() if response.text else {}

    operation_url = response.headers.get("Location")
    if not operation_url:
        raise RuntimeError("Fabric accepted the request without a Location header.")

    timeout = timeout_seconds or positive_int("ONELENS_LRO_TIMEOUT_SECONDS", 900)
    deadline = time.monotonic() + timeout
    retry = _retry_after(response.headers)
    print(f"  LRO started, polling every {retry:g}s (timeout {timeout}s) …")

    while time.monotonic() < deadline:
        time.sleep(min(retry, max(0.1, deadline - time.monotonic())))
        poll = session.get(operation_url, timeout=60)
        if poll.status_code >= 400:
            raise RuntimeError(f"LRO status request failed {poll.status_code}: {poll.text[:800]}")
        payload = poll.json() if poll.text else {}
        status = payload.get("status")
        print(f"    status: {status or 'unknown'}")
        if status == SUCCESS_STATUS:
            if not fetch_result:
                return {}
            result = session.get(f"{operation_url}/result", timeout=60)
            if result.status_code >= 400:
                raise RuntimeError(f"LRO result request failed {result.status_code}: {result.text[:800]}")
            return result.json() if result.text else {}
        if status in FAILURE_STATUSES:
            raise RuntimeError(f"Fabric LRO ended with status {status}: {poll.text[:800]}")
        retry = _retry_after(poll.headers, retry)

    raise TimeoutError(f"Fabric LRO did not complete within {timeout} seconds: {operation_url}")