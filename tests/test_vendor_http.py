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


# ---- redirects, error text, Retry-After cap, broken replies, 5xx retry, time budget ----

import http.client
import http.server
import threading

from lineup_card.vendors.http import Response, urllib_transport


class _Recorder(http.server.BaseHTTPRequestHandler):
    seen: list = []

    def do_GET(self):
        type(self).seen.append((self.path, self.headers.get("Authorization")))
        if self.path.startswith("/start"):
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/landing?sig=SECRETQ")
            self.end_headers()
        else:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"{}")

    def log_message(self, *args):
        pass


def test_redirect_is_refused_and_the_token_is_never_resent():
    _Recorder.seen = []
    server = http.server.HTTPServer(("127.0.0.1", 0), _Recorder)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        c = JsonClient("VALD", urllib_transport, sleep=lambda s: None)
        with pytest.raises(VendorError) as err:
            c.request("GET", f"http://127.0.0.1:{server.server_port}/start", bearer="tok-123",
                      call="GET /tests")
    finally:
        server.shutdown()
        server.server_close()
    assert [p for p, _ in _Recorder.seen] == ["/start"]          # never followed
    assert err.value.status == 302 and err.value.call == "GET /tests"
    text = str(err.value)
    assert "redirect" in text and "HTTP 302" in text and "GET /tests" in text
    assert "SECRETQ" not in text and "landing" not in text and "tok-123" not in text


def test_error_messages_never_carry_the_reply_body():
    t = FakeTransport().on("GET", "/x", status(500, "secret stuff from the server"))
    with pytest.raises(VendorError) as err:
        client(t).request("GET", "https://x.test/x")
    assert "secret stuff" not in str(err.value)


def test_error_message_keeps_only_a_short_vendor_error_code():
    body = '{"error": "invalid_client", "error_description": "client secret abc is wrong"}'
    t = FakeTransport().on("POST", "/oauth/token", status(401, body))
    with pytest.raises(VendorError) as err:
        client(t).request("POST", "https://x.test/oauth/token", call="POST oauth/token")
    text = str(err.value)
    assert "invalid_client" in text and "HTTP 401" in text and "POST oauth/token" in text
    assert "abc" not in text and "description" not in text


def test_retry_after_is_capped_at_60_seconds():
    waits = []
    t = FakeTransport().on("GET", "/x", [status(429, headers={"Retry-After": "3600"}), ok({})])
    client(t, waits).request("GET", "https://x.test/x")
    assert waits == [60.0]


def test_incomplete_read_becomes_a_vendor_error():
    def broken(method, url, headers, body):
        raise http.client.IncompleteRead(b"par", 10)
    with pytest.raises(VendorError, match="no reply from GET /x") as err:
        client(broken).request("GET", "https://x.test/x", call="GET /x")
    assert err.value.status is None


def test_5xx_is_retried_once():
    waits = []
    t = FakeTransport().on("GET", "/x", [status(503), ok({"fine": True})])
    assert client(t, waits).request("GET", "https://x.test/x").json() == {"fine": True}
    assert len(t.calls) == 2 and len(waits) == 1


def test_5xx_twice_stops():
    t = FakeTransport().on("GET", "/x", status(502))
    with pytest.raises(VendorError, match="HTTP 502"):
        client(t).request("GET", "https://x.test/x")
    assert len(t.calls) == 2


def test_time_budget_stops_before_the_next_call():
    now = [0.0]
    t = FakeTransport().on("GET", "/x", ok({}))
    c = JsonClient("Catapult", t, sleep=lambda s: None, clock=lambda: now[0], deadline=100.0)
    c.request("GET", "https://x.test/x")
    now[0] = 100.0
    with pytest.raises(VendorError, match="time budget") as err:
        c.request("GET", "https://x.test/x", call="GET /x")
    assert len(t.calls) == 1 and err.value.call == "GET /x"
