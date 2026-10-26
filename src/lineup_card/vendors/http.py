"""A tiny JSON client on urllib.

The transport is injectable so tests replay saved responses and never touch
the network. Retries a 429 (rate limit) a few times with a growing wait.
A 401 or 403 stops with a plain message about the credentials.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Response:
    status: int
    body: bytes = b""
    headers: dict = field(default_factory=dict)

    def json(self):
        return json.loads(self.body.decode("utf-8")) if self.body else None


# (method, url, headers, body) -> Response
Transport = Callable[[str, str, dict, bytes | None], Response]


class VendorError(RuntimeError):
    """A vendor call failed. `status` is the HTTP status (None if no reply)."""

    def __init__(self, message: str, status: int | None = None, call: str = ""):
        super().__init__(message)
        self.status, self.call = status, call


def urllib_transport(method: str, url: str, headers: dict, body: bytes | None,
                     timeout: float = 60) -> Response:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as reply:
            return Response(reply.status, reply.read(), dict(reply.headers))
    except urllib.error.HTTPError as err:
        return Response(err.code, err.read() or b"", dict(err.headers or {}))


def _short(text: str, limit: int = 200) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit] + "..."


class JsonClient:
    def __init__(self, vendor: str, transport: Transport | None = None,
                 sleep: Callable[[float], None] = time.sleep, tries: int = 3,
                 backoff: float = 2.0):
        self.vendor = vendor
        self.transport = transport or urllib_transport
        self.sleep, self.tries, self.backoff = sleep, tries, backoff

    def request(self, method: str, url: str, *, params: dict | None = None,
                bearer: str | None = None, json_body=None, form: dict | None = None,
                call: str = "") -> Response:
        """Send one request. Returns the Response for 2xx; raises VendorError otherwise."""
        if params:
            url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        headers = {"Accept": "application/json"}
        body = None
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(json_body).encode("utf-8")
        elif form is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            body = urllib.parse.urlencode(form).encode("utf-8")
        call = call or f"{method} {urllib.parse.urlsplit(url).path}"

        for attempt in range(1, self.tries + 1):
            try:
                reply = self.transport(method, url, headers, body)
            except (urllib.error.URLError, TimeoutError, OSError) as err:
                raise VendorError(f"{self.vendor}: no reply from {call} ({err})", None, call) from err
            if reply.status == 429 and attempt < self.tries:
                wait = self.backoff * attempt
                retry_after = str(reply.headers.get("Retry-After", "")).strip()
                if retry_after.isdigit():
                    wait = max(wait, float(retry_after))
                self.sleep(wait)
                continue
            break

        if 200 <= reply.status < 300:
            return reply
        detail = _short(reply.body.decode("utf-8", "replace"))
        if reply.status in (401, 403):
            raise VendorError(
                f"{self.vendor} refused the credentials (HTTP {reply.status}) on {call}. "
                "Check the keys in your environment and that API access is enabled "
                f"for this account. Reply: {detail}", reply.status, call)
        if reply.status == 429:
            raise VendorError(
                f"{self.vendor} rate limit (HTTP 429) on {call} after {self.tries} tries. "
                "Wait a few minutes and run again.", 429, call)
        raise VendorError(f"{self.vendor} error (HTTP {reply.status}) on {call}. Reply: {detail}",
                          reply.status, call)
