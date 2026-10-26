import json

import pytest
from fakes import FakeTransport, ok, status

from lineup_card.vendors.http import JsonClient, VendorError


def client(transport, waits=None):
    return JsonClient("VALD", transport, sleep=(waits.append if waits is not None else lambda s: None))


def test_bearer_header_and_query_params():
    t = FakeTransport().on("GET", "/things", ok({"a": 1}))
    reply = client(t).request("GET", "https://x.test/things", params={"q": "1 2"}, bearer="tok")
    assert reply.json() == {"a": 1}
    assert t.calls[0]["headers"]["Authorization"] == "Bearer tok"
    assert t.calls[0]["url"] == "https://x.test/things?q=1+2"


def test_json_body_is_sent_as_json():
    t = FakeTransport().on("POST", "/stats", ok([]))
    client(t).request("POST", "https://x.test/stats", json_body={"k": ["v"]})
    assert json.loads(t.calls[0]["body"]) == {"k": ["v"]}
    assert t.calls[0]["headers"]["Content-Type"] == "application/json"


def test_429_is_retried_then_succeeds():
    waits = []
    t = FakeTransport().on("GET", "/x", [status(429), status(429, headers={"Retry-After": "5"}),
                                          ok({"done": True})])
    reply = client(t, waits).request("GET", "https://x.test/x")
    assert reply.json() == {"done": True}
    assert len(t.calls) == 3
    assert waits == [2.0, 5.0]


def test_429_gives_up_after_three_tries():
    t = FakeTransport().on("GET", "/x", status(429))
    with pytest.raises(VendorError, match="rate limit") as err:
        client(t).request("GET", "https://x.test/x")
    assert err.value.status == 429 and len(t.calls) == 3


@pytest.mark.parametrize("code", [401, 403])
def test_auth_failure_is_clear(code):
    t = FakeTransport().on("GET", "/tests", status(code, "nope"))
    with pytest.raises(VendorError, match=f"refused the credentials \\(HTTP {code}\\) on GET /tests"):
        client(t).request("GET", "https://x.test/tests")


def test_other_error_names_status_and_call():
    t = FakeTransport().on("GET", "/tests", status(500, "boom"))
    with pytest.raises(VendorError, match="HTTP 500\\) on GET /tests") as err:
        client(t).request("GET", "https://x.test/tests")
    assert err.value.call == "GET /tests"


def test_204_returns_empty():
    t = FakeTransport().on("GET", "/tests", status(204))
    reply = client(t).request("GET", "https://x.test/tests")
    assert reply.status == 204 and reply.json() is None
