"""A tiny JSON client on urllib.

The transport is injectable so tests replay saved responses and never touch
the network. Retries a 429 (rate limit) a few times with a growing wait,
and a 5xx (server error) once. A 401 or 403 stops with a plain message about
the credentials. Redirects are never followed, so a key is only ever sent to
the address the code names.

Error messages carry the call name, the HTTP status and, at most, a short
error code from the vendor. Never the reply body, never a key or token.
"""

from __future__ import annotations

import http.client
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

MAX_RETRY_AFTER = 60.0


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


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    """urllib's default handler follows 3xx and re-sends the Authorization header
    to the new address. Returning None makes urllib raise the 3xx as an HTTPError,
    which the transport turns into a plain Response the client refuses."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_RefuseRedirects)


def urllib_transport(method: str, url: str, headers: dict, body: bytes | None,
                     timeout: float = 60) -> Response:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with _OPENER.open(request, timeout=timeout) as reply:
            return Response(reply.status, reply.read(), dict(reply.headers))
    except urllib.error.HTTPError as err:
        return Response(err.code, err.read() or b"", dict(err.headers or {}))


_CODE = re.compile(r"^[A-Za-z0-9_.\-]{1,40}$")


def _error_code(body: bytes) -> str:
    """A short machine error code from a JSON reply (for example invalid_client), or ''."""
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return ""
    if not isinstance(data, dict):
        return ""
    for key in ("error", "errorCode", "error_code", "code"):
        value = data.get(key)
        if isinstance(value, (str, int)) and _CODE.match(str(value)):
            return str(value)
    return ""


class JsonClient:
    def __init__(self, vendor: str, transport: Transport | None = None,
                 sleep: Callable[[float], None] = time.sleep, tries: int = 3,
                 backoff: float = 2.0, clock: Callable[[], float] = time.monotonic,
                 deadline: float | None = None):
        self.vendor = vendor
        self.transport = transport or urllib_transport
        self.sleep, self.tries, self.backoff = sleep, tries, backoff
        self.clock, self.deadline = clock, deadline

    def _check_budget(self, call: str) -> None:
        if self.deadline is not None and self.clock() >= self.deadline:
            raise VendorError(f"{self.vendor}: stopped before {call} because the pull ran past "
                              "its time budget", None, call)

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

        rate_tries, retried_5xx = 0, False
        while True:
            self._check_budget(call)
            try:
                reply = self.transport(method, url, headers, body)
            except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as err:
                raise VendorError(f"{self.vendor}: no reply from {call} ({type(err).__name__})",
                                  None, call) from err
            if reply.status == 429:
                rate_tries += 1
                if rate_tries < self.tries:
                    wait = self.backoff * rate_tries
                    retry_after = str(reply.headers.get("Retry-After", "")).strip()
                    if retry_after.isdigit():
                        wait = max(wait, float(retry_after))
                    self.sleep(min(wait, MAX_RETRY_AFTER))
                    continue
            elif 500 <= reply.status < 600 and not retried_5xx:
                retried_5xx = True
                self.sleep(self.backoff)
                continue
            break

        if 200 <= reply.status < 300:
            return reply
        code = _error_code(reply.body)
        code = f" Vendor code: {code}." if code else ""
        if 300 <= reply.status < 400:
            raise VendorError(
                f"{self.vendor} answered {call} with a redirect (HTTP {reply.status}). Redirects are "
                f"refused so a key is never sent to another address.{code}", reply.status, call)
        if reply.status in (401, 403):
            raise VendorError(
                f"{self.vendor} refused the credentials (HTTP {reply.status}) on {call}. "
                "Check the keys in your environment and that API access is enabled "
                f"for this account.{code}", reply.status, call)
        if reply.status == 429:
            raise VendorError(
                f"{self.vendor} rate limit (HTTP 429) on {call} after {self.tries} tries. "
                "Wait a few minutes and run again.", 429, call)
        raise VendorError(f"{self.vendor} error (HTTP {reply.status}) on {call}.{code}",
                          reply.status, call)
