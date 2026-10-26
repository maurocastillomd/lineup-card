"""A fake HTTP transport for vendor tests. No network is ever used."""

from __future__ import annotations

import json
import urllib.parse
from pathlib import Path

from lineup_card.vendors.http import Response

FIXTURES = Path(__file__).parent / "fixtures" / "vendors"


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


class FakeTransport:
    """Answers requests from a list of (matcher, reply) routes, in order.

    A matcher is a function(method, url) -> bool. A reply is a Response, a
    list of Responses (served one per call, the last one repeating), or a
    function(body) -> Response.
    Every call is recorded in `calls` as dicts.
    """

    def __init__(self):
        self.routes: list = []
        self.calls: list[dict] = []

    def on(self, method: str, path: str, reply, **query):
        def match(m, url):
            parts = urllib.parse.urlsplit(url)
            if m != method or not parts.path.endswith(path):
                return False
            got = dict(urllib.parse.parse_qsl(parts.query))
            return all(got.get(k) == v for k, v in query.items())
        self.routes.append([match, reply if isinstance(reply, list) else [reply]])
        return self

    def __call__(self, method, url, headers, body):
        self.calls.append({"method": method, "url": url, "headers": dict(headers),
                           "body": body})
        for route in self.routes:
            if route[0](method, url):
                replies = route[1]
                if callable(replies[0]):
                    return replies[0](body)
                return replies.pop(0) if len(replies) > 1 else replies[0]
        raise AssertionError(f"unexpected request {method} {url}")

    def paths(self) -> list[str]:
        return [urllib.parse.urlsplit(c["url"]).path for c in self.calls]


def ok(data, status: int = 200) -> Response:
    return Response(status, json.dumps(data).encode())


def status(code: int, text: str = "", headers: dict | None = None) -> Response:
    return Response(code, text.encode(), headers or {})
