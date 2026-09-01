---
slug: web-framework
---

## The three arguments everything else is built on

An ASGI application is a callable that takes three things and returns nothing:

```python
async def app(scope, receive, send):
    ...
```

`scope` is a dictionary describing the request. `receive` is an awaitable you
call to get the body, one message at a time. `send` is an awaitable you call
with the response, also as messages. That is the entire specification that
matters, and Starlette, FastAPI, Django and Quart all sit on top of exactly it.

A response is two messages. `http.response.start` carries the status and the
headers, and `http.response.body` carries the bytes. Everything a framework
calls a Response object is a way of building those two.

Because an app is a callable, anything that can call it with the right three
arguments is a server. So the first thing to build is a client, which is the
smallest possible one: it makes a scope, hands over a receive that yields the
body once, collects what comes back through send, and gives it to you as
something with a status and a body. Every stage after this is tested through
it.

@goal `Client` drives an app through the ASGI contract and reads the response.

~~~starter
import json
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them."""
    raise NotImplementedError


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        raise NotImplementedError

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)


class Client:
    """Drives an app the way a server would, without there being a server."""

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(), query=""):
        """Send one request through the app and return what came back."""
        raise NotImplementedError

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats."""
    raise NotImplementedError
~~~

~~~tests
import asyncio
import json


async def hello(scope, receive, send):
    """The smallest thing that is an ASGI app: a callable taking three."""
    await send_response(send, 200, [("content-type", "text/plain")], b"hello")


client = Client(hello)
response = asyncio.run(client.get("/"))
assert response.status == 200
assert response.text == "hello"
assert response.body == b"hello"
assert response.headers["content-type"] == "text/plain"

# the length is filled in, because a response without one is a response the
# server has to guess about
assert response.headers["content-length"] == "5"

# and it is exactly two messages, in the order the specification names
kinds = [m["type"] for m in response.messages]
assert kinds == ["http.response.start", "http.response.body"], kinds

# a header the app sets itself is left alone
async def fixed(scope, receive, send):
    await send_response(send, 200, [("content-length", "99")], b"short")


assert asyncio.run(Client(fixed).get("/")).headers["content-length"] == "99"

# header names arrive lowercased, because HTTP does not care and lookups do
async def shouty(scope, receive, send):
    await send_response(send, 201, [("X-Thing", "Value")], b"")


response = asyncio.run(Client(shouty).get("/"))
assert response.status == 201
assert response.headers["x-thing"] == "Value"
assert response.body == b""
assert response.headers["content-length"] == "0"

# the app sees the request the way a server would describe it
seen = {}


async def echo_scope(scope, receive, send):
    seen.update(scope)
    await send_response(send, 200, [], b"ok")


client = Client(echo_scope)
asyncio.run(client.request("post", "/things/7", query="a=1&a=2&b=", headers=[("Host", "x")]))
assert seen["type"] == "http"
assert seen["method"] == "POST", "the method is upper case in the scope"
assert seen["path"] == "/things/7"
assert seen["query_string"] == b"a=1&a=2&b="
assert seen["headers"] == [(b"host", b"x")], seen["headers"]
assert seen["asgi"]["version"] == "3.0"

# a query string keeps repeats, because ?tag=a&tag=b is two values
assert query_pairs(seen) == [("a", "1"), ("a", "2"), ("b", "")]
assert query_pairs({"query_string": b""}) == []
assert query_pairs({}) == []

# the body arrives through receive, one message at a time
async def read_body(scope, receive, send):
    message = await receive()
    await send_response(send, 200, [], message["body"])


assert asyncio.run(Client(read_body).post("/", body=b"raw bytes")).text == "raw bytes"
assert asyncio.run(Client(read_body).post("/", body="a string")).text == "a string"
assert asyncio.run(Client(read_body).get("/")).body == b""

# an app that keeps reading is told the client hung up rather than hanging
async def greedy(scope, receive, send):
    kinds = []
    for _ in range(3):
        kinds.append((await receive())["type"])
    await send_response(send, 200, [], json.dumps(kinds).encode())


assert asyncio.run(Client(greedy).post("/", body=b"x")).json() == [
    "http.request", "http.disconnect", "http.disconnect",
]

# json goes back out as easily as it came in
async def as_json(scope, receive, send):
    body = json.dumps({"ok": True, "count": 2}).encode()
    await send_response(send, 200, [("content-type", "application/json")], body)


response = asyncio.run(Client(as_json).get("/"))
assert response.json() == {"ok": True, "count": 2}
assert response.headers["content-type"] == "application/json"
assert repr(response) == "<200 24 bytes>", repr(response)

# an app is a callable, so a class with __call__ is one too
class Counting:
    def __init__(self):
        self.calls = 0

    async def __call__(self, scope, receive, send):
        self.calls += 1
        await send_response(send, 200, [], str(self.calls).encode())


counter = Counting()
client = Client(counter)
assert asyncio.run(client.get("/")).text == "1"
assert asyncio.run(client.get("/")).text == "2"
assert counter.calls == 2
~~~

~~~solution
import json
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(), query=""):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        pending = [{"type": "http.request", "body": body, "more_body": False}]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)
~~~

## Headers that behave, and a response that sends itself

Two things get built here, and the second one is the design decision.

Headers are not a dictionary. They are case-insensitive, so `Content-Type` and
`content-type` are one header, and some of them repeat, so `Set-Cookie` twice
is two cookies rather than one overwriting the other. A dict gets both wrong,
which is why every framework has a Headers class and why this one does too.

Then `Response`, and the part worth stealing from Starlette: a response is
itself an ASGI app. It has a `__call__` that sends the two messages, so
returning a response from a handler and being a response are the same thing,
and the layer of glue that would otherwise convert between them does not need
to exist. The subclasses then do almost nothing. `JSON` overrides `render` and
sets a media type. That is the whole of it.

The small rules are worth keeping too. A caller's own header wins over a
default, which is what `setdefault` is for. 204, 304 and anything below 200
carry no body, so they get no content-length either. And a HEAD gets the
headers a GET would have got, content-length included, and none of the body,
because HTTP says so and because a proxy handed a body on a HEAD can lose track
of where one response ends and the next begins.

@goal `Response` sends itself, and the subclasses only choose a type and a render.

~~~starter
import json
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(), query=""):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        pending = [{"type": "http.request", "body": body, "more_body": False}]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class Headers:
    """HTTP headers: case-insensitive, and a name may appear more than once."""

    def __init__(self, source=()):
        raise NotImplementedError

    def append(self, name, value):
        """Add a header without removing one that is already there."""
        raise NotImplementedError

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        raise NotImplementedError

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        raise NotImplementedError

    def __getitem__(self, name):
        raise NotImplementedError

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, which is what Set-Cookie needs."""
        raise NotImplementedError

    def __contains__(self, name):
        raise NotImplementedError

    def __iter__(self):
        raise NotImplementedError

    def __len__(self):
        raise NotImplementedError

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        raise NotImplementedError


class Response:
    """A status, headers and a body, which is also an ASGI app."""

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        raise NotImplementedError

    def content_type(self):
        """The media type, with the charset when the type is text."""
        raise NotImplementedError

    def render(self, content):
        """Whatever was handed in, as bytes."""
        raise NotImplementedError

    async def __call__(self, scope, receive, send):
        raise NotImplementedError

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        raise NotImplementedError


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        raise NotImplementedError
~~~

~~~tests
import asyncio
import json


# stage one still holds
async def hello(scope, receive, send):
    await send_response(send, 200, [("content-type", "text/plain")], b"hello")


assert asyncio.run(Client(hello).get("/")).text == "hello"
assert query_pairs({"query_string": b"a=1&a=2"}) == [("a", "1"), ("a", "2")]

# headers fold case and keep repeats
headers = Headers([("Content-Type", "text/plain"), ("Set-Cookie", "a=1")])
headers.append("set-cookie", "b=2")
assert headers["content-type"] == "text/plain"
assert headers["CONTENT-TYPE"] == "text/plain"
assert headers.get_all("Set-Cookie") == ["a=1", "b=2"]
assert headers.get("missing") is None
assert headers.get("missing", "fallback") == "fallback"
assert "Content-Type" in headers and "nope" not in headers
assert len(headers) == 3

# setting replaces every value, appending does not
headers["set-cookie"] = "only=this"
assert headers.get_all("set-cookie") == ["only=this"]
assert len(headers) == 2

# setdefault leaves what the caller chose alone
headers.setdefault("content-type", "text/html")
assert headers["content-type"] == "text/plain"
headers.setdefault("x-new", "yes")
assert headers["x-new"] == "yes"

# a missing header is a KeyError, because asking for one you did not send is
# a mistake and returning None hides it
try:
    headers["nope"]
except KeyError:
    pass
else:
    raise AssertionError("a missing header should raise")

# a dict is accepted, and bytes are decoded
assert Headers({"A": "1"})["a"] == "1"
assert Headers([(b"A", b"1")])["a"] == "1"
assert Headers().raw() == []
assert Headers([("A", "1")]).raw() == [(b"a", b"1")]
assert list(Headers([("A", "1")])) == [("a", "1")]

# a response is an ASGI app, so it can be run directly
response = asyncio.run(Client(Response(b"body")).get("/"))
assert response.status == 200
assert response.text == "body"
assert response.headers["content-length"] == "4"
assert "content-type" not in response.headers, "a bare Response claims no type"

# and it can be returned from one, which is the same thing
async def app(scope, receive, send):
    await PlainText("done")(scope, receive, send)


assert asyncio.run(Client(app).get("/")).headers["content-type"] == (
    "text/plain; charset=utf-8"
)

# each subclass sets its own type, and text types carry the charset
assert asyncio.run(Client(HTML("<p>hi</p>")).get("/")).headers["content-type"] == (
    "text/html; charset=utf-8"
)
sent = asyncio.run(Client(JSON({"a": 1})).get("/"))
assert sent.headers["content-type"] == "application/json"
assert sent.json() == {"a": 1}
assert sent.body == b'{"a":1}', "compact, because a wire is not a place for spaces"

# json falls back to str for what it cannot serialise, rather than raising
assert json.loads(JSON({"path": object}).body)["path"].startswith("<class")

# whatever you hand it becomes bytes
assert Response(b"raw").body == b"raw"
assert Response("text").body == b"text"
assert Response(42).body == b"42"
assert Response(None).body == b""
assert Response().body == b""

# a caller's own headers win over the defaults
custom = Response("x", headers={"content-type": "text/csv", "content-length": "99"})
assert custom.headers["content-type"] == "text/csv"
assert custom.headers["content-length"] == "99"

# the statuses that carry no body carry no body
for status in (204, 304, 100):
    empty = asyncio.run(Client(Response("ignored", status=status)).get("/"))
    assert empty.body == b"", status
    assert "content-length" not in empty.headers, status

# a HEAD gets the headers a GET would have got and none of the body. HTTP is
# explicit about it, and a proxy handed a body on a HEAD can lose track of
# where one response ends and the next begins.
answered = asyncio.run(Client(PlainText("hello world")).request("HEAD", "/"))
assert answered.status == 200
assert answered.body == b""
assert answered.headers["content-length"] == "11", "the length a GET would report"
assert answered.headers["content-type"] == "text/plain; charset=utf-8"
assert asyncio.run(Client(PlainText("hello world")).get("/")).body == b"hello world"

# a redirect is about its Location, not its body
moved = asyncio.run(Client(Redirect("/elsewhere")).get("/"))
assert moved.status == 307
assert moved.headers["location"] == "/elsewhere"
assert moved.body == b""
assert asyncio.run(Client(Redirect("/x", status=301)).get("/")).status == 301

# and the two messages are still exactly two messages
assert [m["type"] for m in sent.messages] == [
    "http.response.start", "http.response.body",
]
assert repr(PlainText("abc")) == "<PlainText 200 3 bytes>", repr(PlainText("abc"))
~~~

~~~solution
import json
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(), query=""):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        pending = [{"type": "http.request", "body": body, "more_body": False}]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class Headers:
    """HTTP headers: case-insensitive, and a name may appear more than once.

    A plain dict gets both of those wrong. `Set-Cookie` legitimately repeats,
    and `content-type` and `Content-Type` are one header, so the storage keeps
    pairs in order and the lookups fold the case.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    @staticmethod
    def _text(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a header without removing one that is already there."""
        self._pairs.append((self._text(name).lower(), self._text(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        name = self._text(name).lower()
        self._pairs = [pair for pair in self._pairs if pair[0] != name]
        self._pairs.append((name, self._text(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        for key, value in self._pairs:
            if key == self._text(name).lower():
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, which is what Set-Cookie needs."""
        wanted = self._text(name).lower()
        return [value for key, value in self._pairs if key == wanted]

    def __contains__(self, name):
        return any(key == self._text(name).lower() for key, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]

    def __repr__(self):
        return f"Headers({self._pairs!r})"


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url
~~~

## The request, and the part of it you can only read once

A request is a scope and a receive channel, and the two behave completely
differently. The scope is a dictionary that is already there, so reading the
method or the path costs nothing. The body is a stream of messages that are
consumed as you take them, so reading it twice gives you nothing the second
time.

That is why `body` caches. A middleware that looks at the body and then hands
the request to a handler would otherwise leave the handler with nothing, and
the bug is invisible until something in the middle starts reading.

It is also why the body arrives in a loop. A server delivers a large body in
pieces, with `more_body` true on all but the last, and an app that reads one
message keeps the first few kilobytes and silently drops the rest.

The other half of this stage is a refactor. Query strings need exactly what
headers needed, ordered pairs where a name can repeat, and they need it without
the case folding. So the shared part comes out into `MultiDict` and `Headers`
becomes four lines: the parent, plus where a name becomes a key.

@goal `Request` reads the scope lazily and the body once, however it arrives.

~~~starter
import json
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading."""

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        raise NotImplementedError

    @property
    def path(self):
        raise NotImplementedError

    @property
    def headers(self):
        raise NotImplementedError

    @property
    def query(self):
        raise NotImplementedError

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        raise NotImplementedError

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        raise NotImplementedError

    async def body(self):
        """The whole body, read once and then remembered."""
        raise NotImplementedError

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raise NotImplementedError

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"
~~~

~~~tests
import asyncio
import json


# stage two still holds, through the class that replaced its innards
headers = Headers([("Content-Type", "text/plain"), ("Set-Cookie", "a=1")])
headers.append("set-cookie", "b=2")
assert headers["CONTENT-TYPE"] == "text/plain"
assert headers.get_all("Set-Cookie") == ["a=1", "b=2"]
assert headers.raw() == [(b"content-type", b"text/plain"), (b"set-cookie", b"a=1"),
                         (b"set-cookie", b"b=2")]
assert isinstance(headers, MultiDict)
assert asyncio.run(Client(JSON({"a": 1})).get("/")).json() == {"a": 1}
assert asyncio.run(Client(Redirect("/x")).get("/")).headers["location"] == "/x"

# query params keep their case, which is the one difference from headers
params = QueryParams([("Tag", "a"), ("tag", "b")])
assert params.get_all("Tag") == ["a"]
assert params.get_all("tag") == ["b"]
assert Headers([("Tag", "a"), ("tag", "b")]).get_all("TAG") == ["a", "b"]

captured = {}


def build(handler):
    async def app(scope, receive, send):
        request = Request(scope, receive)
        captured["request"] = request
        await (await handler(request))(scope, receive, send)

    return app


async def show(request):
    return JSON({
        "method": request.method,
        "path": request.path,
        "type": request.content_type,
        "host": request.headers.get("host"),
        "tags": request.query.get_all("tag"),
        "page": request.query.get("page", "1"),
    })


client = Client(build(show))
response = asyncio.run(client.request(
    "post", "/things", query="tag=a&tag=b", headers=[("Host", "here"),
                                                     ("Content-Type", "text/plain; charset=utf-8")]
))
assert response.json() == {
    "method": "POST", "path": "/things", "type": "text/plain",
    "host": "here", "tags": ["a", "b"], "page": "1",
}
assert repr(captured["request"]) == "<Request POST /things>"
assert captured["request"].client == ("127.0.0.1", 50000)
assert Request({"method": "GET", "path": "/"}).client is None

# a request with no content type says so with an empty string, not a crash
assert Request({"method": "GET", "path": "/", "headers": []}).content_type == ""


# the body, read through the receive channel
async def echo(request):
    return PlainText(await request.text())


assert asyncio.run(Client(build(echo)).post("/", body=b"the body")).text == "the body"
assert asyncio.run(Client(build(echo)).get("/")).text == ""


# a body that arrives in pieces is all of it, not the first piece
async def measure(request):
    return JSON({"body": (await request.body()).decode(), "len": len(await request.body())})


response = asyncio.run(Client(build(measure)).post("/", chunks=[b"one ", b"two ", b"three"]))
assert response.json() == {"body": "one two three", "len": 13}

# reading twice gives the same answer, because the channel is consumed once
reads = []


async def twice(request):
    reads.append(await request.body())
    reads.append(await request.body())
    reads.append(await request.json())
    return PlainText("ok")


asyncio.run(Client(build(twice)).post("/", body=b'{"n": 1}'))
assert reads == [b'{"n": 1}', b'{"n": 1}', {"n": 1}], reads

# json, and an empty body that is not an error
async def as_json(request):
    return JSON({"got": await request.json()})


assert asyncio.run(Client(build(as_json)).post("/", body=b'[1, 2]')).json() == {
    "got": [1, 2]
}
assert asyncio.run(Client(build(as_json)).post("/", body=b"")).json() == {"got": None}
assert asyncio.run(Client(build(as_json)).post("/", body=b"   ")).json() == {"got": None}

# and a body that is not json at all is a JSON error, which a later stage catches
async def broken(request):
    try:
        await request.json()
    except json.JSONDecodeError:
        return PlainText("not json", status=400)
    return PlainText("fine")


response = asyncio.run(Client(build(broken)).post("/", body=b"{oh no"))
assert response.status == 400 and response.text == "not json"


# a client that hangs up before finishing is told apart from one that finished
async def catch_disconnect(scope, receive, send):
    request = Request(scope, receive)
    try:
        await request.body()
    except ClientDisconnect:
        await PlainText("gone", status=499)(scope, receive, send)
        return
    await PlainText("read it")(scope, receive, send)


async def cut_off():
    async def receive():
        return {"type": "http.request", "body": b"start", "more_body": True}

    sent = []

    async def send(message):
        sent.append(message)

    # a channel that promises more and is then asked again in a real server
    # eventually says disconnect, which the client below models
    async def receive_then_die(state=[0]):
        state[0] += 1
        if state[0] == 1:
            return {"type": "http.request", "body": b"start", "more_body": True}
        return {"type": "http.disconnect"}

    await catch_disconnect({"method": "GET", "path": "/", "headers": []},
                           receive_then_die, send)
    return ClientResponse(sent)


assert asyncio.run(cut_off()).status == 499

# nothing is parsed until it is asked for, so a scope alone is enough to make one
bare = Request({"method": "GET", "path": "/x", "query_string": b"a=1", "headers": []})
assert bare.query["a"] == "1"
assert bare.method == "GET"
~~~

~~~solution
import json
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"
~~~

## Deciding which function answers

Routing is two questions, and the second one is the one frameworks get wrong.
Does this path match, and if it does, does this route answer this method.
Keeping them apart is what makes the difference between 404 and 405: a path
nothing has is not found, and a path something has with a method it does not
take is method not allowed, and the response has to say which methods it does
take.

The patterns compile once, when the route is made rather than once per request.
A converter is a pair: the regex that matches the piece, and the function that
turns the matched text into a value. So `{id:int}` gives the handler a real
integer, and `/users/abc` does not match that route at all rather than matching
it and failing later.

`path` is the converter that matches slashes, which is how a file server takes
the whole tail of a URL.

Reverse routing is the same rules backwards, and it checks itself: what it
builds is run through the pattern before being returned, so an int parameter
given a word fails where the link is made rather than where it is clicked.

@goal Routes match with converted parameters, and miss with 404 or 405.

~~~starter
import json
import re
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter."""
    raise NotImplementedError


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        raise NotImplementedError

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        raise NotImplementedError

    def url(self, **params):
        """The path this route would match for these parameters."""
        raise NotImplementedError


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        raise NotImplementedError

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        raise NotImplementedError

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        raise NotImplementedError

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not."""
        raise NotImplementedError

    async def __call__(self, scope, receive, send):
        raise NotImplementedError
~~~

~~~tests
import asyncio


# stage three still holds
async def read(scope, receive, send):
    request = Request(scope, receive)
    await JSON({"body": await request.text(), "q": request.query.get("a")})(
        scope, receive, send
    )


assert asyncio.run(Client(read).post("/", body=b"x", query="a=1")).json() == {
    "body": "x", "q": "1",
}

# a pattern becomes a regex once, when the route is made
pattern, converters = compile_path("/users/{id:int}/posts/{slug}")
assert set(converters) == {"id", "slug"}
assert pattern.match("/users/12/posts/hello") is not None
assert pattern.match("/users/abc/posts/hello") is None
assert pattern.match("/users/12/posts/a/b") is None, "a str stops at a slash"

# the four converters
assert compile_path("/x/{n:int}")[0].match("/x/42") is not None
assert compile_path("/x/{n:float}")[0].match("/x/4.5") is not None
assert compile_path("/x/{n:path}")[0].match("/x/deep/and/deeper") is not None
assert compile_path("/x/{n}")[0].match("/x/word") is not None

# a pattern with no parameters is still a pattern, and dots are not wildcards
assert compile_path("/about.html")[0].match("/about.html") is not None
assert compile_path("/about.html")[0].match("/aboutXhtml") is None
assert compile_path("/")[0].match("/") is not None

for bad, phrase in (("/x/{n:number}", "not a converter"), ("/{a}/{a}", "twice")):
    try:
        compile_path(bad)
    except ValueError as exc:
        assert phrase in str(exc), str(exc)
    else:
        raise AssertionError(f"{bad} should not compile")


async def show_user(request):
    return JSON({"id": request.params["id"], "type": type(request.params["id"]).__name__})


route = Route("/users/{id:int}", show_user)
assert route.match("/users/7") == {"id": 7}, "the converter runs, so it is an int"
assert route.match("/users/seven") is None
assert route.methods == {"GET", "HEAD"}, "a HEAD is a GET with the body dropped"
assert route.name == "show_user"
assert Route("/x", show_user, ["post"]).methods == {"POST"}
assert Route("/x", show_user, name="other").name == "other"
assert repr(route) == "<Route GET/HEAD /users/{id:int}>", repr(route)

# building a url is matching backwards, and it checks itself
assert route.url(id=7) == "/users/7"
assert Route("/a/{b}/c/{d:int}", show_user).url(b="x", d=2) == "/a/x/c/2"
for params, phrase in (({}, "needs"), ({"id": "seven"}, "does not build")):
    try:
        route.url(**params)
    except ValueError as exc:
        assert phrase in str(exc), str(exc)
    else:
        raise AssertionError(f"{params} should not build a url")

# the router, as a decorator
router = Router()


@router.route("/")
async def index(request):
    return PlainText("index")


@router.route("/users/{id:int}")
async def user(request):
    return JSON({"id": request.params["id"]})


@router.route("/users", methods=["POST"])
async def create(request):
    return JSON(await request.json(), status=201)


@router.route("/files/{rest:path}", name="files")
async def files(request):
    return PlainText(request.params["rest"])


client = Client(router)
assert asyncio.run(client.get("/")).text == "index"
assert asyncio.run(client.get("/users/12")).json() == {"id": 12}
assert asyncio.run(client.get("/files/a/b/c.txt")).text == "a/b/c.txt"
assert asyncio.run(client.post("/users", body=b'{"name": "ada"}')).json() == {
    "name": "ada"
}
assert asyncio.run(client.post("/users", body=b'{"name": "ada"}')).status == 201

# a path nothing has is 404
missing = asyncio.run(client.get("/nothing"))
assert missing.status == 404
assert "Not Found" in missing.text

# a path something has, with a method it does not, is 405 and says what it takes
wrong = asyncio.run(client.post("/users/12", body=b"{}"))
assert wrong.status == 405, wrong.status
assert wrong.headers["allow"] == "GET, HEAD", wrong.headers.get("allow")

wrong = asyncio.run(client.request("DELETE", "/users"))
assert wrong.status == 405
assert wrong.headers["allow"] == "POST"

# the type conversion is real, so /users/abc is not this route at all
assert asyncio.run(client.get("/users/abc")).status == 404

# routes are tried in order, so the first one that matches wins
ordered = Router()


@ordered.route("/x/{anything}")
async def general(request):
    return PlainText("general")


@ordered.route("/x/special")
async def special(request):
    return PlainText("special")


assert asyncio.run(Client(ordered).get("/x/special")).text == "general"

# a route that answers GET answers HEAD, and answers it properly
assert asyncio.run(client.request("HEAD", "/")).status == 200
assert asyncio.run(client.request("HEAD", "/")).body == b""
assert asyncio.run(client.get("/")).body == b"index"
assert asyncio.run(client.request("HEAD", "/users/12")).status == 200
assert asyncio.run(client.request("HEAD", "/nothing")).status == 404

# and a route that only takes POST does not answer HEAD
assert asyncio.run(client.request("HEAD", "/users")).status == 405

# and links are built by name rather than written out
assert router.url_for("user", id=3) == "/users/3"
assert router.url_for("files", rest="a/b") == "/files/a/b"
assert router.url_for("index") == "/"
try:
    router.url_for("nope")
except ValueError as exc:
    assert "no route named" in str(exc)
else:
    raise AssertionError("an unknown name should not build a url")

# a router with no routes answers everything with 404 rather than failing
assert asyncio.run(Client(Router()).get("/")).status == 404

# resolve is the part worth testing on its own
found, params = router.resolve("GET", "/users/9")
assert found.name == "user" and params == {"id": 9}
found, allowed = router.resolve("PUT", "/users/9")
assert found is None and allowed == {"GET", "HEAD"}
found, allowed = router.resolve("GET", "/nowhere")
assert found is None and allowed == set()
~~~

~~~solution
import json
import re
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if method in route.methods:
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        scope["path_params"] = found
        response = await route.handler(Request(scope, receive))
        await response(scope, receive, send)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})
~~~

## Wrapping, which is all middleware is

An app is a callable that takes three arguments. A middleware is also a
callable that takes three arguments, and holds another one. That is the whole
mechanism: `A(B(app))` nests them, and there is no registry, no plugin
interface and no hook to register with.

Inside one there are only two moves.

To change the request, edit the scope before calling through. To change the
response, wrap `send`, because a response is not a value that comes back up the
stack: it goes out through `send` as the app below produces it, and the only
place to see it is between that call and the real one.

Everything anybody writes is one or both of those. Adding a header is wrapping
send. Attaching a request id is editing the scope and wrapping send. Timing is
noting the clock and wrapping send.

The one that repays reading twice is the error catcher, because of the part
people leave out. Once the start message has gone, the status is on the wire
and cannot be taken back, so an error after that point cannot become a 500. The
honest thing is to let it out and let the server drop the connection, which is
what a second start message would be pretending not to do.

Where it sits in the stack is a real decision rather than a detail. Outermost,
it catches everything including the other middleware, but its 500 goes out
through the real `send` and none of the inner wrappers ever touch it, so that
response has no request id and no timing on it. Innermost, the error response
is decorated like any other, and a middleware above it that goes wrong is not
caught. Real frameworks ship both for exactly this reason.

@goal Middleware nests, and each one edits the scope, the send, or both.

~~~starter
import json
import re
import time
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if method in route.methods:
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        scope["path_params"] = found
        response = await route.handler(Request(scope, receive))
        await response(scope, receive, send)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})


class Middleware:
    """An ASGI app that wraps another one, which is the whole of the pattern."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        await self.app(scope, receive, send)


def stack(app, *middlewares):
    """Wrap the app, outermost first, which is the order people read them in."""
    raise NotImplementedError


class AddHeaders(Middleware):
    """Adds headers to whatever the app below sends."""

    def __init__(self, app, **headers):
        raise NotImplementedError

    async def __call__(self, scope, receive, send):
        raise NotImplementedError


class RequestId(Middleware):
    """An id on the scope going down, and the same id in a header coming back."""

    def __init__(self, app, header="x-request-id"):
        super().__init__(app)
        self.header = header
        self.issued = 0

    def next_id(self):
        self.issued += 1
        return f"req-{self.issued}"

    async def __call__(self, scope, receive, send):
        raise NotImplementedError


class Timing(Middleware):
    """How long the app below took, in a header."""

    def __init__(self, app, header="x-elapsed-ms"):
        super().__init__(app)
        self.header = header

    async def __call__(self, scope, receive, send):
        raise NotImplementedError


class CatchErrors(Middleware):
    """An exception below becomes a 500 rather than a crashed connection."""

    def __init__(self, app, handler=None, keep=20):
        super().__init__(app)
        self.handler = handler
        self.keep = keep
        # The last few, not all of them. This layer is the outermost one and
        # lives as long as the app does, and every exception on it holds its
        # traceback, which holds every frame, which holds the request body and
        # the scope. An unbounded list here is a memory leak per error.
        self.errors = []

    async def __call__(self, scope, receive, send):
        raise NotImplementedError
~~~

~~~tests
import asyncio

router = Router()


@router.route("/")
async def index(request):
    return PlainText("index")


@router.route("/boom")
async def boom(request):
    raise RuntimeError("something went wrong in the handler")


@router.route("/late")
async def late(request):
    async def half(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise RuntimeError("failed after the status was already sent")

    return half


@router.route("/whoami")
async def whoami(request):
    return PlainText(request.scope.get("request_id", "none"))


# stage four still holds
assert asyncio.run(Client(router).get("/")).text == "index"
assert asyncio.run(Client(router).get("/nothing")).status == 404
assert router.url_for("index") == "/"

# a bare middleware changes nothing, which is what makes it a base class
assert asyncio.run(Client(Middleware(router)).get("/")).text == "index"

# headers go on the way out
app = AddHeaders(router, server="tiny", X_Powered_By="python")
response = asyncio.run(Client(app).get("/"))
assert response.text == "index"
assert response.headers["server"] == "tiny"
assert response.headers["x-powered-by"] == "python", "underscores become hyphens"
assert response.headers["content-length"] == "5", "and the app's own are untouched"

# nesting is the whole mechanism, and needs nothing to support it
nested = AddHeaders(AddHeaders(router, a="1"), b="2")
response = asyncio.run(Client(nested).get("/"))
assert response.headers["a"] == "1" and response.headers["b"] == "2"

# stack builds the same thing in the order people read
built = stack(router, lambda app: AddHeaders(app, outer="yes"),
              lambda app: AddHeaders(app, inner="yes"))
response = asyncio.run(Client(built).get("/"))
assert response.headers["outer"] == "yes" and response.headers["inner"] == "yes"
assert stack(router) is router, "no middleware is no wrapping"

# and the order is real: the outermost sees the response last
order = []


def recorder(label):
    class Recorder(Middleware):
        async def __call__(self, scope, receive, send):
            order.append(f"{label} in")
            await self.app(scope, receive, send)
            order.append(f"{label} out")

    return Recorder


asyncio.run(Client(stack(router, recorder("A"), recorder("B"))).get("/"))
assert order == ["A in", "B in", "B out", "A out"], order

# a middleware that changes the request edits the scope on the way down
tagged = RequestId(router)
response = asyncio.run(Client(tagged).get("/whoami"))
assert response.text == "req-1", "the handler saw the id"
assert response.headers["x-request-id"] == "req-1", "and so did the client"
assert asyncio.run(Client(tagged).get("/whoami")).text == "req-2"

# an id the caller already has is kept rather than replaced
response = asyncio.run(Client(tagged).get("/whoami", headers=[("x-request-id", "mine")]))
assert response.text == "mine"
assert response.headers["x-request-id"] == "mine"
assert tagged.issued == 2, "and no new one was minted"

# timing reports a number, and the test asserts it is a number rather than
# asserting a threshold, because a clock is not a thing to assert about
response = asyncio.run(Client(Timing(router)).get("/"))
assert float(response.headers["x-elapsed-ms"]) >= 0.0
assert asyncio.run(Client(Timing(router, "x-took")).get("/")).headers["x-took"]

# an exception becomes a 500 instead of coming out at the server
guard = CatchErrors(router)
response = asyncio.run(Client(guard).get("/boom"))
assert response.status == 500
assert response.text == "Internal Server Error"
assert len(guard.errors) == 1
assert isinstance(guard.errors[0], RuntimeError)
assert str(guard.errors[0]) == "something went wrong in the handler"

# and a handler can decide what a 500 looks like
custom = CatchErrors(router, lambda exc: JSON({"error": type(exc).__name__}, status=503))
response = asyncio.run(Client(custom).get("/boom"))
assert response.status == 503 and response.json() == {"error": "RuntimeError"}

# a request that works is untouched
assert asyncio.run(Client(guard).get("/")).text == "index"
assert asyncio.run(Client(guard).get("/nothing")).status == 404

# an error after the status was sent cannot become a 500, and says so by
# letting the exception out rather than sending a second start message
after = CatchErrors(router)
try:
    asyncio.run(Client(after).get("/late"))
except RuntimeError as exc:
    assert "already sent" in str(exc)
else:
    raise AssertionError("an error after the start cannot be turned into a 500")
assert len(after.errors) == 1

# the whole stack together, in the order an application would build it
application = stack(
    router,
    lambda app: CatchErrors(app),
    lambda app: RequestId(app),
    lambda app: Timing(app),
    lambda app: AddHeaders(app, server="tiny"),
)
response = asyncio.run(Client(application).get("/"))
assert response.status == 200 and response.text == "index"
for header in ("x-request-id", "x-elapsed-ms", "server", "content-length"):
    assert header in response.headers, header

# and here is the ordering trade-off, which is worth knowing before you need it.
# CatchErrors is outermost, so its 500 goes out through the real send and none
# of the inner wrappers ever see it: no request id, no timing, no server header.
failed = asyncio.run(Client(application).get("/boom"))
assert failed.status == 500
assert "x-request-id" not in failed.headers
assert "x-elapsed-ms" not in failed.headers
assert "server" not in failed.headers

# put it innermost and the error response is decorated like any other, at the
# cost of no longer catching anything the middleware above it raises
inside = stack(
    router,
    lambda app: RequestId(app),
    lambda app: Timing(app),
    lambda app: AddHeaders(app, server="tiny"),
    lambda app: CatchErrors(app),
)
failed = asyncio.run(Client(inside).get("/boom"))
assert failed.status == 500
for header in ("x-request-id", "x-elapsed-ms", "server"):
    assert header in failed.headers, header


# which is why real frameworks have both: one outside everything as a last
# resort, and one inside that turns a handler's mistake into a normal response
class Rude(Middleware):
    async def __call__(self, scope, receive, send):
        raise RuntimeError("a middleware itself went wrong")


outer = CatchErrors(stack(router, lambda app: Rude(app), lambda app: CatchErrors(app)))
assert asyncio.run(Client(outer).get("/")).status == 500
assert len(outer.errors) == 1
~~~

~~~solution
import json
import re
import time
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if method in route.methods:
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        scope["path_params"] = found
        response = await route.handler(Request(scope, receive))
        await response(scope, receive, send)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})


class Middleware:
    """An ASGI app that wraps another one, which is the whole of the pattern.

    An app is a callable taking three arguments. A middleware is also a
    callable taking three arguments. So the two are the same kind of thing and
    they nest without a registry, a plugin system or a hook. `A(B(app))` is the
    entire mechanism.

    There are only two moves inside one. To change the request, edit the scope
    before calling through. To change the response, wrap `send`, because the
    response does not come back up as a value: it goes out through send as the
    app below produces it.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        await self.app(scope, receive, send)


def stack(app, *middlewares):
    """Wrap the app, outermost first, which is the order people read them in.

    Applied in reverse so that `stack(app, A, B)` is `A(B(app))`: A sees the
    request first and the response last, which is what an onion means.
    """
    for factory in reversed(middlewares):
        app = factory(app)
    return app


class AddHeaders(Middleware):
    """Adds headers to whatever the app below sends."""

    def __init__(self, app, **headers):
        super().__init__(app)
        self.extra = [
            (name.replace("_", "-").lower().encode("latin-1"),
             str(value).encode("latin-1"))
            for name, value in headers.items()
        ]

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message["headers"], *self.extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestId(Middleware):
    """An id on the scope going down, and the same id in a header coming back.

    Both moves in one place, which is why it is the useful one to read.
    """

    def __init__(self, app, header="x-request-id"):
        super().__init__(app)
        self.header = header
        self.issued = 0

    def next_id(self):
        self.issued += 1
        return f"req-{self.issued}"

    async def __call__(self, scope, receive, send):
        identifier = scope.get("headers") and dict(scope["headers"]).get(
            self.header.encode("latin-1")
        )
        text = identifier.decode("latin-1") if identifier else self.next_id()
        scope = {**scope, "request_id": text}

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), text.encode("latin-1")),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_id)


class Timing(Middleware):
    """How long the app below took, in a header."""

    def __init__(self, app, header="x-elapsed-ms"):
        super().__init__(app)
        self.header = header

    async def __call__(self, scope, receive, send):
        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                elapsed = (time.perf_counter() - started) * 1000
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), f"{elapsed:.3f}".encode()),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_timing)


class CatchErrors(Middleware):
    """An exception below becomes a 500 rather than a crashed connection.

    It has to remember whether the response started, and this is the part
    people leave out. Once the start message has gone out, the status is on the
    wire and cannot be taken back, so an error after that point cannot become a
    500. There is nothing to do but let it out and let the server drop the
    connection, which is honest, where sending a second start message is not.
    """

    def __init__(self, app, handler=None, keep=20):
        super().__init__(app)
        self.handler = handler
        self.keep = keep
        # The last few, not all of them. This layer is the outermost one and
        # lives as long as the app does, and every exception on it holds its
        # traceback, which holds every frame, which holds the request body and
        # the scope. An unbounded list here is a memory leak per error.
        self.errors = []

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            self.errors.append(exc)
            del self.errors[:-self.keep]
            if started:
                raise
            response = (
                self.handler(exc) if self.handler
                else PlainText("Internal Server Error", status=500)
            )
            await response(scope, receive, send)
~~~

## Asking for what you need in the signature

A handler that takes `request` and digs through it works, and it also means
every handler starts with four lines of digging that a reader has to check.
The alternative is to say what you want in the signature and let the framework
work out where it comes from. FastAPI made this the reason people use FastAPI,
and the machinery under it is smaller than it looks.

`inspect.signature` gives the parameters, their annotations and their defaults.
Unit 26 built that; this is the thing it was for. Then one ordered list of
rules decides where each parameter comes from, and the order is the design, so
it is written out once rather than spread through the framework.

The annotation is doing two jobs. It says which parameter is the request, and
it converts a query string, which is always text, into the number or the
boolean the handler wanted. A path parameter needs no conversion, because the
route pattern already did it when it matched.

`Depends` is the piece that goes further than it first appears. A provider can
ask for its own dependencies, so resolution recurses, and the results are
cached for the length of one request. That cache is the whole reason the
feature exists: a database session that four dependencies all want should be
opened once.

@goal A handler declares what it wants, and `solve` finds all of it.

~~~starter
import inspect
import json
import re
import time
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if method in route.methods:
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        scope["path_params"] = found
        response = await route.handler(Request(scope, receive))
        await response(scope, receive, send)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})


class Middleware:
    """An ASGI app that wraps another one, which is the whole of the pattern.

    An app is a callable taking three arguments. A middleware is also a
    callable taking three arguments. So the two are the same kind of thing and
    they nest without a registry, a plugin system or a hook. `A(B(app))` is the
    entire mechanism.

    There are only two moves inside one. To change the request, edit the scope
    before calling through. To change the response, wrap `send`, because the
    response does not come back up as a value: it goes out through send as the
    app below produces it.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        await self.app(scope, receive, send)


def stack(app, *middlewares):
    """Wrap the app, outermost first, which is the order people read them in.

    Applied in reverse so that `stack(app, A, B)` is `A(B(app))`: A sees the
    request first and the response last, which is what an onion means.
    """
    for factory in reversed(middlewares):
        app = factory(app)
    return app


class AddHeaders(Middleware):
    """Adds headers to whatever the app below sends."""

    def __init__(self, app, **headers):
        super().__init__(app)
        self.extra = [
            (name.replace("_", "-").lower().encode("latin-1"),
             str(value).encode("latin-1"))
            for name, value in headers.items()
        ]

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message["headers"], *self.extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestId(Middleware):
    """An id on the scope going down, and the same id in a header coming back.

    Both moves in one place, which is why it is the useful one to read.
    """

    def __init__(self, app, header="x-request-id"):
        super().__init__(app)
        self.header = header
        self.issued = 0

    def next_id(self):
        self.issued += 1
        return f"req-{self.issued}"

    async def __call__(self, scope, receive, send):
        identifier = scope.get("headers") and dict(scope["headers"]).get(
            self.header.encode("latin-1")
        )
        text = identifier.decode("latin-1") if identifier else self.next_id()
        scope = {**scope, "request_id": text}

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), text.encode("latin-1")),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_id)


class Timing(Middleware):
    """How long the app below took, in a header."""

    def __init__(self, app, header="x-elapsed-ms"):
        super().__init__(app)
        self.header = header

    async def __call__(self, scope, receive, send):
        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                elapsed = (time.perf_counter() - started) * 1000
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), f"{elapsed:.3f}".encode()),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_timing)


class CatchErrors(Middleware):
    """An exception below becomes a 500 rather than a crashed connection.

    It has to remember whether the response started, and this is the part
    people leave out. Once the start message has gone out, the status is on the
    wire and cannot be taken back, so an error after that point cannot become a
    500. There is nothing to do but let it out and let the server drop the
    connection, which is honest, where sending a second start message is not.
    """

    def __init__(self, app, handler=None, keep=20):
        super().__init__(app)
        self.handler = handler
        self.keep = keep
        # The last few, not all of them. This layer is the outermost one and
        # lives as long as the app does, and every exception on it holds its
        # traceback, which holds every frame, which holds the request body and
        # the scope. An unbounded list here is a memory leak per error.
        self.errors = []

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            self.errors.append(exc)
            del self.errors[:-self.keep]
            if started:
                raise
            response = (
                self.handler(exc) if self.handler
                else PlainText("Internal Server Error", status=500)
            )
            await response(scope, receive, send)


class MissingParameter(Exception):
    """A handler asked for something the request does not have."""


class Depends:
    """A marker in a default: this parameter comes from calling that."""

    def __init__(self, provider, cache=True):
        self.provider = provider
        self.cache = cache


class Body:
    """A marker in a default: this parameter is the parsed JSON body."""

    def __init__(self, field=None):
        self.field = field


def to_bool(text):
    """A query string carries text, and "false" is text that means False."""
    raise NotImplementedError


SCALARS = {int: int, float: float, bool: to_bool, str: str}


def convert(value, annotation):
    """A string from the query, as whatever the signature said it should be."""
    raise NotImplementedError


async def solve(target, request, cache=None):
    """The keyword arguments `target` asked for, worked out from its signature."""
    raise NotImplementedError


async def solve_one(name, parameter, request, cache):
    """One parameter, by the first rule that applies to it."""
    raise NotImplementedError


async def from_body(marker, request):
    """The parsed body, or one field out of it."""
    raise NotImplementedError


async def provide(marker, request, cache):
    """Call a provider, having first solved what it asked for."""
    raise NotImplementedError
~~~

~~~tests
import asyncio

router = Router()
calls = []


def settings():
    """A plain provider, and one that would be expensive if it ran twice."""
    calls.append("settings")
    return {"name": "tiny", "debug": True}


async def session(config=Depends(settings)):
    """A provider that is async and asks for one of its own."""
    calls.append("session")
    return f"session for {config['name']}"


@router.route("/")
async def index(request):
    return PlainText(f"index {request.method}")


@router.route("/users/{id:int}")
async def show(id, verbose: bool = False):
    return JSON({"id": id, "type": type(id).__name__, "verbose": verbose})


@router.route("/search")
async def search(q="", page: int = 1, ratio: float = 0.5):
    return JSON({"q": q, "page": page, "ratio": ratio})


@router.route("/config")
async def config(config=Depends(settings), session=Depends(session)):
    return JSON({"config": config, "session": session})


@router.route("/things", methods=["POST"])
async def create(payload=Body(), name=Body("name")):
    return JSON({"payload": payload, "name": name}, status=201)


@router.route("/strict")
async def strict(required):
    return PlainText(required)


client = Client(router)

# stage five still holds, and a handler taking `request` still gets one
assert asyncio.run(client.get("/")).text == "index GET"
assert asyncio.run(Client(AddHeaders(router, a="1")).get("/")).headers["a"] == "1"
assert asyncio.run(Client(CatchErrors(router)).get("/nothing")).status == 404

# a path parameter arrives by name, already converted by the route
assert asyncio.run(client.get("/users/12")).json() == {
    "id": 12, "type": "int", "verbose": False,
}

# a query parameter is converted by the annotation instead
assert asyncio.run(client.get("/users/12", query="verbose=true")).json()["verbose"] is True
assert asyncio.run(client.get("/users/12", query="verbose=0")).json()["verbose"] is False
for text in ("1", "yes", "on", "TRUE"):
    assert asyncio.run(client.get("/users/1", query=f"verbose={text}")).json()["verbose"]

assert to_bool("no") is False
try:
    to_bool("maybe")
except ValueError as exc:
    assert "not a true or a false" in str(exc)
else:
    raise AssertionError("maybe is not a boolean")

# defaults are used when the request said nothing
assert asyncio.run(client.get("/search")).json() == {"q": "", "page": 1, "ratio": 0.5}
assert asyncio.run(client.get("/search", query="q=x&page=3&ratio=0.25")).json() == {
    "q": "x", "page": 3, "ratio": 0.25,
}

# and a value the annotation cannot convert is a clear error rather than a 500
async def bad_query():
    request = Request({"method": "GET", "path": "/search", "headers": [],
                       "query_string": b"page=many"})
    return await solve(search, request)


try:
    asyncio.run(bad_query())
except MissingParameter as exc:
    assert "page" in str(exc)
else:
    raise AssertionError("page=many is not an int")

# a provider runs, and runs once per request even when two things want it
calls.clear()
response = asyncio.run(client.get("/config"))
assert response.json() == {
    "config": {"name": "tiny", "debug": True},
    "session": "session for tiny",
}
assert calls == ["settings", "session"], calls

# a second request gets its own, because the cache is per request
asyncio.run(client.get("/config"))
assert calls == ["settings", "session", "settings", "session"], calls

# and caching can be turned off for a provider that should run every time
counter = []


def ticket():
    counter.append(1)
    return len(counter)


async def two_tickets(a=Depends(ticket, cache=False), b=Depends(ticket, cache=False)):
    return JSON({"a": a, "b": b})


async def solve_twice():
    request = Request({"method": "GET", "path": "/", "headers": [], "query_string": b""})
    return await solve(two_tickets, request)


assert asyncio.run(solve_twice()) == {"a": 1, "b": 2}

# the body, whole and by field
created = asyncio.run(client.post("/things", body=b'{"name": "ada", "n": 2}'))
assert created.status == 201
assert created.json() == {"payload": {"name": "ada", "n": 2}, "name": "ada"}

# a field the body does not have says so
async def missing_field():
    request = Request({"method": "POST", "path": "/things", "headers": [],
                       "query_string": b""}, None)
    request._body = b'{"other": 1}'
    return await solve(create, request)


try:
    asyncio.run(missing_field())
except MissingParameter as exc:
    assert "has no 'name'" in str(exc), str(exc)
else:
    raise AssertionError("a missing field should be reported")

# a parameter with no default and nowhere to come from is refused
async def nothing_for_it():
    request = Request({"method": "GET", "path": "/strict", "headers": [],
                       "query_string": b""})
    return await solve(strict, request)


try:
    asyncio.run(nothing_for_it())
except MissingParameter as exc:
    assert "'required'" in str(exc)
else:
    raise AssertionError("a required parameter should be required")

assert asyncio.run(client.get("/strict", query="required=here")).text == "here"


# a parameter annotated Request gets one whatever it is called
async def by_annotation(req: Request):
    return PlainText(req.path)


router.add("/annotated", by_annotation)
assert asyncio.run(client.get("/annotated")).text == "/annotated"


# a handler that takes nothing at all is fine
async def nothing():
    return PlainText("nothing needed")


router.add("/nothing-needed", nothing)
assert asyncio.run(client.get("/nothing-needed")).text == "nothing needed"


# star args are skipped rather than confusing the solver
async def flexible(request, *args, **kwargs):
    return PlainText(str(len(args) + len(kwargs)))


router.add("/flexible", flexible)
assert asyncio.run(client.get("/flexible")).text == "0"
~~~

~~~solution
import inspect
import json
import re
import time
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if method in route.methods:
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        scope["path_params"] = found
        request = Request(scope, receive)
        response = await route.handler(**await solve(route.handler, request))
        await response(scope, receive, send)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})


class Middleware:
    """An ASGI app that wraps another one, which is the whole of the pattern.

    An app is a callable taking three arguments. A middleware is also a
    callable taking three arguments. So the two are the same kind of thing and
    they nest without a registry, a plugin system or a hook. `A(B(app))` is the
    entire mechanism.

    There are only two moves inside one. To change the request, edit the scope
    before calling through. To change the response, wrap `send`, because the
    response does not come back up as a value: it goes out through send as the
    app below produces it.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        await self.app(scope, receive, send)


def stack(app, *middlewares):
    """Wrap the app, outermost first, which is the order people read them in.

    Applied in reverse so that `stack(app, A, B)` is `A(B(app))`: A sees the
    request first and the response last, which is what an onion means.
    """
    for factory in reversed(middlewares):
        app = factory(app)
    return app


class AddHeaders(Middleware):
    """Adds headers to whatever the app below sends."""

    def __init__(self, app, **headers):
        super().__init__(app)
        self.extra = [
            (name.replace("_", "-").lower().encode("latin-1"),
             str(value).encode("latin-1"))
            for name, value in headers.items()
        ]

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message["headers"], *self.extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestId(Middleware):
    """An id on the scope going down, and the same id in a header coming back.

    Both moves in one place, which is why it is the useful one to read.
    """

    def __init__(self, app, header="x-request-id"):
        super().__init__(app)
        self.header = header
        self.issued = 0

    def next_id(self):
        self.issued += 1
        return f"req-{self.issued}"

    async def __call__(self, scope, receive, send):
        identifier = scope.get("headers") and dict(scope["headers"]).get(
            self.header.encode("latin-1")
        )
        text = identifier.decode("latin-1") if identifier else self.next_id()
        scope = {**scope, "request_id": text}

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), text.encode("latin-1")),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_id)


class Timing(Middleware):
    """How long the app below took, in a header."""

    def __init__(self, app, header="x-elapsed-ms"):
        super().__init__(app)
        self.header = header

    async def __call__(self, scope, receive, send):
        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                elapsed = (time.perf_counter() - started) * 1000
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), f"{elapsed:.3f}".encode()),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_timing)


class CatchErrors(Middleware):
    """An exception below becomes a 500 rather than a crashed connection.

    It has to remember whether the response started, and this is the part
    people leave out. Once the start message has gone out, the status is on the
    wire and cannot be taken back, so an error after that point cannot become a
    500. There is nothing to do but let it out and let the server drop the
    connection, which is honest, where sending a second start message is not.
    """

    def __init__(self, app, handler=None, keep=20):
        super().__init__(app)
        self.handler = handler
        self.keep = keep
        # The last few, not all of them. This layer is the outermost one and
        # lives as long as the app does, and every exception on it holds its
        # traceback, which holds every frame, which holds the request body and
        # the scope. An unbounded list here is a memory leak per error.
        self.errors = []

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            self.errors.append(exc)
            del self.errors[:-self.keep]
            if started:
                raise
            response = (
                self.handler(exc) if self.handler
                else PlainText("Internal Server Error", status=500)
            )
            await response(scope, receive, send)


class MissingParameter(Exception):
    """A handler asked for something the request does not have."""


class Depends:
    """A marker in a default: this parameter comes from calling that.

    `async def show(user=Depends(current_user))` says where `user` comes from
    in the signature, which is the only place a reader is already looking.
    """

    def __init__(self, provider, cache=True):
        self.provider = provider
        self.cache = cache

    def __repr__(self):
        return f"Depends({getattr(self.provider, '__name__', self.provider)})"


class Body:
    """A marker in a default: this parameter is the parsed JSON body.

    `Body()` is the whole body and `Body("name")` is one key out of it.
    """

    def __init__(self, field=None):
        self.field = field


def to_bool(text):
    """A query string carries text, and "false" is text that means False."""
    lowered = str(text).lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"{text!r} is not a true or a false")


SCALARS = {int: int, float: float, bool: to_bool, str: str}


def convert(value, annotation):
    """A string from the query, as whatever the signature said it should be."""
    converter = SCALARS.get(annotation)
    return value if converter is None else converter(value)


async def solve(target, request, cache=None):
    """The keyword arguments `target` asked for, worked out from its signature.

    Reading a signature is unit 26's `inspect`, and this is the thing it is
    for. The order the rules are tried in is the whole design, so it is written
    out once, here, rather than being spread across the framework.
    """
    cache = {} if cache is None else cache
    values = {}
    for name, parameter in inspect.signature(target).parameters.items():
        if parameter.kind in (parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD):
            continue
        values[name] = await solve_one(name, parameter, request, cache)
    return values


async def solve_one(name, parameter, request, cache):
    """One parameter, by the first rule that applies to it."""
    default, annotation = parameter.default, parameter.annotation
    if annotation is Request or name == "request":
        return request
    if isinstance(default, Depends):
        return await provide(default, request, cache)
    if isinstance(default, Body):
        return await from_body(default, request)
    if name in request.params:
        # already converted, because the route pattern did it when it matched
        return request.params[name]
    if name in request.query:
        try:
            return convert(request.query[name], annotation)
        except ValueError as exc:
            raise MissingParameter(f"{name}: {exc}") from exc
    if default is not inspect.Parameter.empty:
        return default
    raise MissingParameter(f"the request has nothing for {name!r}")


async def from_body(marker, request):
    """The parsed body, or one field out of it."""
    body = await request.json()
    if marker.field is None:
        return body
    if not isinstance(body, dict) or marker.field not in body:
        raise MissingParameter(f"the body has no {marker.field!r}")
    return body[marker.field]


async def provide(marker, request, cache):
    """Call a provider, having first solved what it asked for.

    Providers take dependencies too, so this recurses, and the cache is what
    stops a provider two handlers both need from running twice in one request.
    A database session is the usual reason to want that.
    """
    if marker.cache and marker.provider in cache:
        return cache[marker.provider]
    value = marker.provider(**await solve(marker.provider, request, cache))
    if inspect.isawaitable(value):
        value = await value
    if marker.cache:
        cache[marker.provider] = value
    return value
~~~

## Raising a status, and choosing who answers for it

Three calls into a handler, returning a response is awkward. Every layer
between there and the top has to pass it back up and remember not to touch it,
and one that forgets turns a 404 into a 200. Raising skips all of that, which
is why `HTTPException` exists in every framework that has one.

Something then has to turn the exception back into a response, and the
interesting part is how it picks. The lookup walks the exception's MRO, so a
handler registered for a base class catches every subclass of it, and a handler
registered for the subclass wins over the base. Unit 21 built that ordering for
methods. This is the same rule doing a different job, and getting it for free
is the reason to use the MRO rather than a list of `isinstance` checks.

An exception nothing is registered for goes up untouched. That is deliberate:
it is what lets a catch-all sit above this one and turn anything unexpected
into a 500, while this layer only answers for what it was told about.

422 rather than 400 for a request that asked for a parameter it did not get.
400 says the request was malformed and 500 says it was our fault, and neither
of those is true of a missing field.

A body that is not JSON at all is the other side of that line, and it is 400,
because it did not parse. The difference matters to whoever is fixing it: a 400
sends them to look at how they serialised, a 422 sends them to look at what
they sent. It is registered as a handler rather than raised from the parsing
code, because `json.JSONDecodeError` comes out of the standard library and is
not ours to subclass, which is exactly the case a registry handles and an
inheritance hierarchy cannot.

@goal Raised exceptions become responses, and the MRO chooses which handler.

~~~starter
import inspect
import json
import re
import time
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if method in route.methods:
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        scope["path_params"] = found
        request = Request(scope, receive)
        response = await route.handler(**await solve(route.handler, request))
        await response(scope, receive, send)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})


class Middleware:
    """An ASGI app that wraps another one, which is the whole of the pattern.

    An app is a callable taking three arguments. A middleware is also a
    callable taking three arguments. So the two are the same kind of thing and
    they nest without a registry, a plugin system or a hook. `A(B(app))` is the
    entire mechanism.

    There are only two moves inside one. To change the request, edit the scope
    before calling through. To change the response, wrap `send`, because the
    response does not come back up as a value: it goes out through send as the
    app below produces it.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        await self.app(scope, receive, send)


def stack(app, *middlewares):
    """Wrap the app, outermost first, which is the order people read them in.

    Applied in reverse so that `stack(app, A, B)` is `A(B(app))`: A sees the
    request first and the response last, which is what an onion means.
    """
    for factory in reversed(middlewares):
        app = factory(app)
    return app


class AddHeaders(Middleware):
    """Adds headers to whatever the app below sends."""

    def __init__(self, app, **headers):
        super().__init__(app)
        self.extra = [
            (name.replace("_", "-").lower().encode("latin-1"),
             str(value).encode("latin-1"))
            for name, value in headers.items()
        ]

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message["headers"], *self.extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestId(Middleware):
    """An id on the scope going down, and the same id in a header coming back.

    Both moves in one place, which is why it is the useful one to read.
    """

    def __init__(self, app, header="x-request-id"):
        super().__init__(app)
        self.header = header
        self.issued = 0

    def next_id(self):
        self.issued += 1
        return f"req-{self.issued}"

    async def __call__(self, scope, receive, send):
        identifier = scope.get("headers") and dict(scope["headers"]).get(
            self.header.encode("latin-1")
        )
        text = identifier.decode("latin-1") if identifier else self.next_id()
        scope = {**scope, "request_id": text}

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), text.encode("latin-1")),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_id)


class Timing(Middleware):
    """How long the app below took, in a header."""

    def __init__(self, app, header="x-elapsed-ms"):
        super().__init__(app)
        self.header = header

    async def __call__(self, scope, receive, send):
        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                elapsed = (time.perf_counter() - started) * 1000
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), f"{elapsed:.3f}".encode()),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_timing)


class CatchErrors(Middleware):
    """An exception below becomes a 500 rather than a crashed connection.

    It has to remember whether the response started, and this is the part
    people leave out. Once the start message has gone out, the status is on the
    wire and cannot be taken back, so an error after that point cannot become a
    500. There is nothing to do but let it out and let the server drop the
    connection, which is honest, where sending a second start message is not.
    """

    def __init__(self, app, handler=None, keep=20):
        super().__init__(app)
        self.handler = handler
        self.keep = keep
        # The last few, not all of them. This layer is the outermost one and
        # lives as long as the app does, and every exception on it holds its
        # traceback, which holds every frame, which holds the request body and
        # the scope. An unbounded list here is a memory leak per error.
        self.errors = []

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            self.errors.append(exc)
            del self.errors[:-self.keep]
            if started:
                raise
            response = (
                self.handler(exc) if self.handler
                else PlainText("Internal Server Error", status=500)
            )
            await response(scope, receive, send)


class MissingParameter(Exception):
    """A handler asked for something the request does not have."""


class Depends:
    """A marker in a default: this parameter comes from calling that.

    `async def show(user=Depends(current_user))` says where `user` comes from
    in the signature, which is the only place a reader is already looking.
    """

    def __init__(self, provider, cache=True):
        self.provider = provider
        self.cache = cache

    def __repr__(self):
        return f"Depends({getattr(self.provider, '__name__', self.provider)})"


class Body:
    """A marker in a default: this parameter is the parsed JSON body.

    `Body()` is the whole body and `Body("name")` is one key out of it.
    """

    def __init__(self, field=None):
        self.field = field


def to_bool(text):
    """A query string carries text, and "false" is text that means False."""
    lowered = str(text).lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"{text!r} is not a true or a false")


SCALARS = {int: int, float: float, bool: to_bool, str: str}


def convert(value, annotation):
    """A string from the query, as whatever the signature said it should be."""
    converter = SCALARS.get(annotation)
    return value if converter is None else converter(value)


async def solve(target, request, cache=None):
    """The keyword arguments `target` asked for, worked out from its signature.

    Reading a signature is unit 26's `inspect`, and this is the thing it is
    for. The order the rules are tried in is the whole design, so it is written
    out once, here, rather than being spread across the framework.
    """
    cache = {} if cache is None else cache
    values = {}
    for name, parameter in inspect.signature(target).parameters.items():
        if parameter.kind in (parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD):
            continue
        values[name] = await solve_one(name, parameter, request, cache)
    return values


async def solve_one(name, parameter, request, cache):
    """One parameter, by the first rule that applies to it."""
    default, annotation = parameter.default, parameter.annotation
    if annotation is Request or name == "request":
        return request
    if isinstance(default, Depends):
        return await provide(default, request, cache)
    if isinstance(default, Body):
        return await from_body(default, request)
    if name in request.params:
        # already converted, because the route pattern did it when it matched
        return request.params[name]
    if name in request.query:
        try:
            return convert(request.query[name], annotation)
        except ValueError as exc:
            raise MissingParameter(f"{name}: {exc}") from exc
    if default is not inspect.Parameter.empty:
        return default
    raise MissingParameter(f"the request has nothing for {name!r}")


async def from_body(marker, request):
    """The parsed body, or one field out of it."""
    body = await request.json()
    if marker.field is None:
        return body
    if not isinstance(body, dict) or marker.field not in body:
        raise MissingParameter(f"the body has no {marker.field!r}")
    return body[marker.field]


async def provide(marker, request, cache):
    """Call a provider, having first solved what it asked for.

    Providers take dependencies too, so this recurses, and the cache is what
    stops a provider two handlers both need from running twice in one request.
    A database session is the usual reason to want that.
    """
    if marker.cache and marker.provider in cache:
        return cache[marker.provider]
    value = marker.provider(**await solve(marker.provider, request, cache))
    if inspect.isawaitable(value):
        value = await value
    if marker.cache:
        cache[marker.provider] = value
    return value


STATUS_TEXT = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable Content",
    429: "Too Many Requests", 500: "Internal Server Error",
}


class HTTPException(Exception):
    """A status a handler chose, by raising instead of returning."""

    def __init__(self, status, detail=None, headers=None):
        raise NotImplementedError


def http_exception_handler(request, exc):
    raise NotImplementedError


def malformed_body_handler(request, exc):
    """A body that is not JSON at all is 400, not 422.

    422 says the request parsed and was wrong about something. This one did not
    parse. The difference matters to whoever is fixing it: a 400 sends them to
    look at how they serialised, a 422 sends them to look at what they sent.

    It is registered rather than raised, because `json.JSONDecodeError` comes
    out of the standard library and is not ours to subclass.
    """
    return JSON({"detail": f"the body is not JSON: {exc}"}, status=400)


def validation_handler(request, exc):
    """A request that did not carry what the handler asked for is 422."""
    raise NotImplementedError


class ExceptionMiddleware(Middleware):
    """Turns raised exceptions into responses, chosen by type."""

    def __init__(self, app, handlers=None):
        super().__init__(app)
        self.handlers = {
            HTTPException: http_exception_handler,
            MissingParameter: validation_handler,
            json.JSONDecodeError: malformed_body_handler,
        }
        self.handlers.update(handlers or {})

    def add(self, exception, handler):
        """Register a handler, and return self so calls can be chained."""
        raise NotImplementedError

    def lookup(self, exc):
        """The most specific handler registered for this exception, or None."""
        raise NotImplementedError

    async def __call__(self, scope, receive, send):
        raise NotImplementedError
~~~

~~~tests
import asyncio


class NotInStock(Exception):
    """Something the shop knows about."""


class SoldOutForever(NotInStock):
    """A more specific version of it."""


router = Router()


@router.route("/")
async def index(request):
    return PlainText("index")


@router.route("/items/{id:int}")
async def item(id):
    if id > 100:
        raise HTTPException(404, f"no item {id}")
    return JSON({"id": id})


@router.route("/locked")
async def locked(request):
    raise HTTPException(429, headers={"retry-after": "30"})


@router.route("/needs")
async def needs(required):
    return PlainText(required)


@router.route("/gone")
async def gone(request):
    raise NotInStock("we ran out")


@router.route("/never")
async def never(request):
    raise SoldOutForever("and we are not getting more")


@router.route("/unknown")
async def unknown(request):
    raise ZeroDivisionError("nothing knows about this one")


app = ExceptionMiddleware(router)
client = Client(app)

# stage six still holds
assert asyncio.run(client.get("/")).text == "index"
assert asyncio.run(client.get("/items/3")).json() == {"id": 3}

# raising a status produces it
response = asyncio.run(client.get("/items/500"))
assert response.status == 404
assert response.json() == {"detail": "no item 500"}
assert response.headers["content-type"] == "application/json"

# a status with no detail uses the standard wording
assert HTTPException(403).detail == "Forbidden"
assert HTTPException(499).detail == "Error"
assert str(HTTPException(404)) == "404 Not Found"

# and headers on the exception reach the response
locked_out = asyncio.run(client.get("/locked"))
assert locked_out.status == 429
assert locked_out.headers["retry-after"] == "30"
assert locked_out.json() == {"detail": "Too Many Requests"}

# the router still answers for itself, so a bare one works with no middleware
assert asyncio.run(Client(router).get("/nothing")).status == 404
assert asyncio.run(client.get("/nothing")).status == 404

# a request missing what the handler asked for is 422, not 400 and not 500
missing = asyncio.run(client.get("/needs"))
assert missing.status == 422, missing.status
assert "'required'" in missing.json()["detail"]
assert asyncio.run(client.get("/needs", query="required=here")).text == "here"

# an exception with nothing registered goes up rather than being swallowed
try:
    asyncio.run(client.get("/unknown"))
except ZeroDivisionError:
    pass
else:
    raise AssertionError("an unregistered exception should not be handled")

# which is exactly what lets a catch-all sit above it
guarded = CatchErrors(ExceptionMiddleware(router))
assert asyncio.run(Client(guarded).get("/unknown")).status == 500
assert asyncio.run(Client(guarded).get("/items/500")).status == 404

# registering one for your own exception
app.add(NotInStock, lambda request, exc: JSON({"sorry": str(exc)}, status=409))
response = asyncio.run(client.get("/gone"))
assert response.status == 409 and response.json() == {"sorry": "we ran out"}

# and the MRO decides: a subclass with no handler of its own uses the base one
response = asyncio.run(client.get("/never"))
assert response.status == 409
assert response.json() == {"sorry": "and we are not getting more"}

# until it has one, and then the more specific wins
app.add(SoldOutForever, lambda request, exc: JSON({"forever": True}, status=410))
assert asyncio.run(client.get("/never")).json() == {"forever": True}
assert asyncio.run(client.get("/never")).status == 410
assert asyncio.run(client.get("/gone")).status == 409, "the base one is untouched"

# lookup is the part worth checking directly
assert app.lookup(SoldOutForever()) is not app.lookup(NotInStock())
assert app.lookup(HTTPException(404)) is http_exception_handler
assert app.lookup(ZeroDivisionError()) is None
assert app.add(KeyError, lambda r, e: PlainText("k")) is app, "add chains"

# a handler may be async, because sometimes reporting an error needs to await
async def slow_handler(request, exc):
    return JSON({"async": True}, status=418)


assert asyncio.run(
    Client(ExceptionMiddleware(router, {NotInStock: slow_handler})).get("/gone")
).status == 418

# the handler is given the request, so it can say what was being asked for
def with_path(request, exc):
    return JSON({"path": request.path, "detail": exc.detail}, status=exc.status)


checking = Client(ExceptionMiddleware(router, {HTTPException: with_path}))
assert asyncio.run(checking.get("/items/999")).json() == {
    "path": "/items/999", "detail": "no item 999",
}


# a body that is not JSON at all is a malformed request, which is 400. not
# 422, which says it parsed and was wrong, and not 500, which says it was ours.
@router.route("/take", methods=["POST"])
async def take(payload=Body()):
    return JSON({"got": payload})


broken = asyncio.run(client.post("/take", body=b"{not json"))
assert broken.status == 400, broken.status
assert "not JSON" in broken.json()["detail"]
assert asyncio.run(client.post("/take", body=b'{"a": 1}')).json() == {"got": {"a": 1}}

# a body that parses and is missing a field is still 422
@router.route("/named", methods=["POST"])
async def named(name=Body("name")):
    return PlainText(name)


assert asyncio.run(client.post("/named", body=b'{"other": 1}')).status == 422
assert asyncio.run(client.post("/named", body=b'{"name": "ada"}')).text == "ada"

# the caught errors are kept for looking at, and there is a limit on how many.
# this layer lives as long as the app, and an exception holds its traceback,
# which holds every frame, which holds the request body.
capped = CatchErrors(router, keep=3)
for _ in range(10):
    asyncio.run(Client(capped).get("/unknown"))
assert len(capped.errors) == 3, len(capped.errors)
assert all(isinstance(e, ZeroDivisionError) for e in capped.errors)
assert len(CatchErrors(router).errors) == 0

# an error after the status went out cannot be turned into anything
@router.route("/late")
async def late(request):
    async def half(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise HTTPException(500, "too late")

    return half


try:
    asyncio.run(client.get("/late"))
except HTTPException:
    pass
else:
    raise AssertionError("a status already sent cannot be replaced")
~~~

~~~solution
import inspect
import json
import re
import time
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if method in route.methods:
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        scope["path_params"] = found
        request = Request(scope, receive)
        response = await route.handler(**await solve(route.handler, request))
        await response(scope, receive, send)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})


class Middleware:
    """An ASGI app that wraps another one, which is the whole of the pattern.

    An app is a callable taking three arguments. A middleware is also a
    callable taking three arguments. So the two are the same kind of thing and
    they nest without a registry, a plugin system or a hook. `A(B(app))` is the
    entire mechanism.

    There are only two moves inside one. To change the request, edit the scope
    before calling through. To change the response, wrap `send`, because the
    response does not come back up as a value: it goes out through send as the
    app below produces it.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        await self.app(scope, receive, send)


def stack(app, *middlewares):
    """Wrap the app, outermost first, which is the order people read them in.

    Applied in reverse so that `stack(app, A, B)` is `A(B(app))`: A sees the
    request first and the response last, which is what an onion means.
    """
    for factory in reversed(middlewares):
        app = factory(app)
    return app


class AddHeaders(Middleware):
    """Adds headers to whatever the app below sends."""

    def __init__(self, app, **headers):
        super().__init__(app)
        self.extra = [
            (name.replace("_", "-").lower().encode("latin-1"),
             str(value).encode("latin-1"))
            for name, value in headers.items()
        ]

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message["headers"], *self.extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestId(Middleware):
    """An id on the scope going down, and the same id in a header coming back.

    Both moves in one place, which is why it is the useful one to read.
    """

    def __init__(self, app, header="x-request-id"):
        super().__init__(app)
        self.header = header
        self.issued = 0

    def next_id(self):
        self.issued += 1
        return f"req-{self.issued}"

    async def __call__(self, scope, receive, send):
        identifier = scope.get("headers") and dict(scope["headers"]).get(
            self.header.encode("latin-1")
        )
        text = identifier.decode("latin-1") if identifier else self.next_id()
        scope = {**scope, "request_id": text}

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), text.encode("latin-1")),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_id)


class Timing(Middleware):
    """How long the app below took, in a header."""

    def __init__(self, app, header="x-elapsed-ms"):
        super().__init__(app)
        self.header = header

    async def __call__(self, scope, receive, send):
        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                elapsed = (time.perf_counter() - started) * 1000
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), f"{elapsed:.3f}".encode()),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_timing)


class CatchErrors(Middleware):
    """An exception below becomes a 500 rather than a crashed connection.

    It has to remember whether the response started, and this is the part
    people leave out. Once the start message has gone out, the status is on the
    wire and cannot be taken back, so an error after that point cannot become a
    500. There is nothing to do but let it out and let the server drop the
    connection, which is honest, where sending a second start message is not.
    """

    def __init__(self, app, handler=None, keep=20):
        super().__init__(app)
        self.handler = handler
        self.keep = keep
        # The last few, not all of them. This layer is the outermost one and
        # lives as long as the app does, and every exception on it holds its
        # traceback, which holds every frame, which holds the request body and
        # the scope. An unbounded list here is a memory leak per error.
        self.errors = []

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            self.errors.append(exc)
            del self.errors[:-self.keep]
            if started:
                raise
            response = (
                self.handler(exc) if self.handler
                else PlainText("Internal Server Error", status=500)
            )
            await response(scope, receive, send)


class MissingParameter(Exception):
    """A handler asked for something the request does not have."""


class Depends:
    """A marker in a default: this parameter comes from calling that.

    `async def show(user=Depends(current_user))` says where `user` comes from
    in the signature, which is the only place a reader is already looking.
    """

    def __init__(self, provider, cache=True):
        self.provider = provider
        self.cache = cache

    def __repr__(self):
        return f"Depends({getattr(self.provider, '__name__', self.provider)})"


class Body:
    """A marker in a default: this parameter is the parsed JSON body.

    `Body()` is the whole body and `Body("name")` is one key out of it.
    """

    def __init__(self, field=None):
        self.field = field


def to_bool(text):
    """A query string carries text, and "false" is text that means False."""
    lowered = str(text).lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"{text!r} is not a true or a false")


SCALARS = {int: int, float: float, bool: to_bool, str: str}


def convert(value, annotation):
    """A string from the query, as whatever the signature said it should be."""
    converter = SCALARS.get(annotation)
    return value if converter is None else converter(value)


async def solve(target, request, cache=None):
    """The keyword arguments `target` asked for, worked out from its signature.

    Reading a signature is unit 26's `inspect`, and this is the thing it is
    for. The order the rules are tried in is the whole design, so it is written
    out once, here, rather than being spread across the framework.
    """
    cache = {} if cache is None else cache
    values = {}
    for name, parameter in inspect.signature(target).parameters.items():
        if parameter.kind in (parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD):
            continue
        values[name] = await solve_one(name, parameter, request, cache)
    return values


async def solve_one(name, parameter, request, cache):
    """One parameter, by the first rule that applies to it."""
    default, annotation = parameter.default, parameter.annotation
    if annotation is Request or name == "request":
        return request
    if isinstance(default, Depends):
        return await provide(default, request, cache)
    if isinstance(default, Body):
        return await from_body(default, request)
    if name in request.params:
        # already converted, because the route pattern did it when it matched
        return request.params[name]
    if name in request.query:
        try:
            return convert(request.query[name], annotation)
        except ValueError as exc:
            raise MissingParameter(f"{name}: {exc}") from exc
    if default is not inspect.Parameter.empty:
        return default
    raise MissingParameter(f"the request has nothing for {name!r}")


async def from_body(marker, request):
    """The parsed body, or one field out of it."""
    body = await request.json()
    if marker.field is None:
        return body
    if not isinstance(body, dict) or marker.field not in body:
        raise MissingParameter(f"the body has no {marker.field!r}")
    return body[marker.field]


async def provide(marker, request, cache):
    """Call a provider, having first solved what it asked for.

    Providers take dependencies too, so this recurses, and the cache is what
    stops a provider two handlers both need from running twice in one request.
    A database session is the usual reason to want that.
    """
    if marker.cache and marker.provider in cache:
        return cache[marker.provider]
    value = marker.provider(**await solve(marker.provider, request, cache))
    if inspect.isawaitable(value):
        value = await value
    if marker.cache:
        cache[marker.provider] = value
    return value


STATUS_TEXT = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable Content",
    429: "Too Many Requests", 500: "Internal Server Error",
}


class HTTPException(Exception):
    """A status a handler chose, by raising instead of returning.

    Raising is what you want three calls down, where returning a response would
    mean every layer between here and the handler has to pass it back up and
    remember not to touch it.
    """

    def __init__(self, status, detail=None, headers=None):
        self.status = status
        self.detail = detail or STATUS_TEXT.get(status, "Error")
        self.headers = headers or {}
        super().__init__(f"{status} {self.detail}")


def http_exception_handler(request, exc):
    return JSON({"detail": exc.detail}, status=exc.status, headers=exc.headers)


def malformed_body_handler(request, exc):
    """A body that is not JSON at all is 400, not 422.

    422 says the request parsed and was wrong about something. This one did not
    parse. The difference matters to whoever is fixing it: a 400 sends them to
    look at how they serialised, a 422 sends them to look at what they sent.

    It is registered rather than raised, because `json.JSONDecodeError` comes
    out of the standard library and is not ours to subclass.
    """
    return JSON({"detail": f"the body is not JSON: {exc}"}, status=400)


def validation_handler(request, exc):
    """A request that did not carry what the handler asked for is 422.

    Not 400, which says the request was malformed, and not 500, which says this
    was our fault. 422 says it parsed and it was wrong, which is what a missing
    field is.
    """
    return JSON({"detail": str(exc)}, status=422)


class ExceptionMiddleware(Middleware):
    """Turns raised exceptions into responses, chosen by type.

    Lookup walks the exception's MRO, so a handler registered for a base class
    catches every subclass, and a handler registered for the subclass wins over
    it. Unit 21 built that ordering, and this is a place it does real work:
    the rule for which handler runs is the same rule Python already uses for
    which method runs.
    """

    def __init__(self, app, handlers=None):
        super().__init__(app)
        self.handlers = {
            HTTPException: http_exception_handler,
            MissingParameter: validation_handler,
            json.JSONDecodeError: malformed_body_handler,
        }
        self.handlers.update(handlers or {})

    def add(self, exception, handler):
        """Register a handler, and return self so calls can be chained."""
        self.handlers[exception] = handler
        return self

    def lookup(self, exc):
        """The most specific handler registered for this exception, or None."""
        for cls in type(exc).__mro__:
            if cls in self.handlers:
                return self.handlers[cls]
        return None

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            handler = self.lookup(exc)
            if handler is None or started:
                # Nothing registered, or too late to change the status. Either
                # way this is not ours, so it goes up to whatever is above.
                raise
            # The body may already have been read by the handler that failed,
            # so this request is for the scope rather than for reading again.
            response = handler(Request(scope, receive), exc)
            if inspect.isawaitable(response):
                response = await response
            await response(scope, receive, send)
~~~

## The object that holds the other seven

Nothing new is invented here. Every piece exists, and what is missing is the
object that holds them in the right order so that somebody using the framework
does not have to remember what that order was.

Two things are genuinely new, though, and both are in the specification rather
than in the convenience.

Mounting is how two apps become one. The prefix comes off the path and goes
onto `root_path` before the inner app is called, so the inner app is written as
if it were at the top of a site and still knows where it really is. That one
rewrite is the whole feature, and it is what lets an admin interface be a
separate app rather than a folder of routes with a naming convention.

Lifespan is the other half of ASGI, and the half people skip. A server sends
one startup message before the first request and one shutdown message after the
last, and the app answers each. That is where a connection pool is opened, not
in a global at import time where it runs during a test collection and outlives
the process that made it. A startup that fails says so, and the server does not
start, which is better than a first request that fails mysteriously.

The order the stack is built in is the decision stage five ended on. Exceptions
are handled inside the middleware somebody added, so an error response is
decorated like any other, and a catch-all sits outside everything for whatever
the middleware itself gets wrong.

@goal `App` ties the eight stages together, with mounting and lifespan.

~~~starter
import asyncio
import contextlib
import inspect
import json
import re
import time
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    @contextlib.asynccontextmanager
    async def lifespan(self):
        """Run the app's startup, hand back the client, then run its shutdown.

        The app awaits `receive` twice and does other work in between, so it
        runs as a task and the two ends talk through queues. That is what a
        real server does too.
        """
        incoming, outgoing = asyncio.Queue(), asyncio.Queue()

        async def receive():
            return await incoming.get()

        async def send(message):
            await outgoing.put(message)

        scope = {"type": "lifespan", "asgi": {"version": "3.0"}}
        task = asyncio.create_task(self.app(scope, receive, send))
        await incoming.put({"type": "lifespan.startup"})
        started = await outgoing.get()
        if started["type"] != "lifespan.startup.complete":
            await task
            raise RuntimeError(started.get("message", "startup failed"))
        try:
            yield self
        finally:
            await incoming.put({"type": "lifespan.shutdown"})
            await outgoing.get()
            await task

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def app(self):
        """The App handling this request, or None when there is not one."""
        return self.scope.get("app")

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def accepts(self, method):
        return method in self.methods

    async def handle(self, scope, receive, send, params):
        """Run the handler and send what it gives back."""
        scope["path_params"] = params
        response = await self.handler(**await solve(self.handler, Request(scope, receive)))
        await response(scope, receive, send)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def mount(self, prefix, app, name=None):
        """Put another app under a prefix. It answers every method below it."""
        raise NotImplementedError

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if route.accepts(method):
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        await route.handle(scope, receive, send, found)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})


class Middleware:
    """An ASGI app that wraps another one, which is the whole of the pattern.

    An app is a callable taking three arguments. A middleware is also a
    callable taking three arguments. So the two are the same kind of thing and
    they nest without a registry, a plugin system or a hook. `A(B(app))` is the
    entire mechanism.

    There are only two moves inside one. To change the request, edit the scope
    before calling through. To change the response, wrap `send`, because the
    response does not come back up as a value: it goes out through send as the
    app below produces it.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        await self.app(scope, receive, send)


def stack(app, *middlewares):
    """Wrap the app, outermost first, which is the order people read them in.

    Applied in reverse so that `stack(app, A, B)` is `A(B(app))`: A sees the
    request first and the response last, which is what an onion means.
    """
    for factory in reversed(middlewares):
        app = factory(app)
    return app


class AddHeaders(Middleware):
    """Adds headers to whatever the app below sends."""

    def __init__(self, app, **headers):
        super().__init__(app)
        self.extra = [
            (name.replace("_", "-").lower().encode("latin-1"),
             str(value).encode("latin-1"))
            for name, value in headers.items()
        ]

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message["headers"], *self.extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestId(Middleware):
    """An id on the scope going down, and the same id in a header coming back.

    Both moves in one place, which is why it is the useful one to read.
    """

    def __init__(self, app, header="x-request-id"):
        super().__init__(app)
        self.header = header
        self.issued = 0

    def next_id(self):
        self.issued += 1
        return f"req-{self.issued}"

    async def __call__(self, scope, receive, send):
        identifier = scope.get("headers") and dict(scope["headers"]).get(
            self.header.encode("latin-1")
        )
        text = identifier.decode("latin-1") if identifier else self.next_id()
        scope = {**scope, "request_id": text}

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), text.encode("latin-1")),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_id)


class Timing(Middleware):
    """How long the app below took, in a header."""

    def __init__(self, app, header="x-elapsed-ms"):
        super().__init__(app)
        self.header = header

    async def __call__(self, scope, receive, send):
        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                elapsed = (time.perf_counter() - started) * 1000
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), f"{elapsed:.3f}".encode()),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_timing)


class CatchErrors(Middleware):
    """An exception below becomes a 500 rather than a crashed connection.

    It has to remember whether the response started, and this is the part
    people leave out. Once the start message has gone out, the status is on the
    wire and cannot be taken back, so an error after that point cannot become a
    500. There is nothing to do but let it out and let the server drop the
    connection, which is honest, where sending a second start message is not.
    """

    def __init__(self, app, handler=None, keep=20):
        super().__init__(app)
        self.handler = handler
        self.keep = keep
        # The last few, not all of them. This layer is the outermost one and
        # lives as long as the app does, and every exception on it holds its
        # traceback, which holds every frame, which holds the request body and
        # the scope. An unbounded list here is a memory leak per error.
        self.errors = []

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            self.errors.append(exc)
            del self.errors[:-self.keep]
            if started:
                raise
            response = (
                self.handler(exc) if self.handler
                else PlainText("Internal Server Error", status=500)
            )
            await response(scope, receive, send)


class MissingParameter(Exception):
    """A handler asked for something the request does not have."""


class Depends:
    """A marker in a default: this parameter comes from calling that.

    `async def show(user=Depends(current_user))` says where `user` comes from
    in the signature, which is the only place a reader is already looking.
    """

    def __init__(self, provider, cache=True):
        self.provider = provider
        self.cache = cache

    def __repr__(self):
        return f"Depends({getattr(self.provider, '__name__', self.provider)})"


class Body:
    """A marker in a default: this parameter is the parsed JSON body.

    `Body()` is the whole body and `Body("name")` is one key out of it.
    """

    def __init__(self, field=None):
        self.field = field


def to_bool(text):
    """A query string carries text, and "false" is text that means False."""
    lowered = str(text).lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"{text!r} is not a true or a false")


SCALARS = {int: int, float: float, bool: to_bool, str: str}


def convert(value, annotation):
    """A string from the query, as whatever the signature said it should be."""
    converter = SCALARS.get(annotation)
    return value if converter is None else converter(value)


async def solve(target, request, cache=None):
    """The keyword arguments `target` asked for, worked out from its signature.

    Reading a signature is unit 26's `inspect`, and this is the thing it is
    for. The order the rules are tried in is the whole design, so it is written
    out once, here, rather than being spread across the framework.
    """
    cache = {} if cache is None else cache
    values = {}
    for name, parameter in inspect.signature(target).parameters.items():
        if parameter.kind in (parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD):
            continue
        values[name] = await solve_one(name, parameter, request, cache)
    return values


async def solve_one(name, parameter, request, cache):
    """One parameter, by the first rule that applies to it."""
    default, annotation = parameter.default, parameter.annotation
    if annotation is Request or name == "request":
        return request
    if isinstance(default, Depends):
        return await provide(default, request, cache)
    if isinstance(default, Body):
        return await from_body(default, request)
    if name in request.params:
        # already converted, because the route pattern did it when it matched
        return request.params[name]
    if name in request.query:
        try:
            return convert(request.query[name], annotation)
        except ValueError as exc:
            raise MissingParameter(f"{name}: {exc}") from exc
    if default is not inspect.Parameter.empty:
        return default
    raise MissingParameter(f"the request has nothing for {name!r}")


async def from_body(marker, request):
    """The parsed body, or one field out of it."""
    body = await request.json()
    if marker.field is None:
        return body
    if not isinstance(body, dict) or marker.field not in body:
        raise MissingParameter(f"the body has no {marker.field!r}")
    return body[marker.field]


async def provide(marker, request, cache):
    """Call a provider, having first solved what it asked for.

    Providers take dependencies too, so this recurses, and the cache is what
    stops a provider two handlers both need from running twice in one request.
    A database session is the usual reason to want that.
    """
    if marker.cache and marker.provider in cache:
        return cache[marker.provider]
    value = marker.provider(**await solve(marker.provider, request, cache))
    if inspect.isawaitable(value):
        value = await value
    if marker.cache:
        cache[marker.provider] = value
    return value


STATUS_TEXT = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable Content",
    429: "Too Many Requests", 500: "Internal Server Error",
}


class HTTPException(Exception):
    """A status a handler chose, by raising instead of returning.

    Raising is what you want three calls down, where returning a response would
    mean every layer between here and the handler has to pass it back up and
    remember not to touch it.
    """

    def __init__(self, status, detail=None, headers=None):
        self.status = status
        self.detail = detail or STATUS_TEXT.get(status, "Error")
        self.headers = headers or {}
        super().__init__(f"{status} {self.detail}")


def http_exception_handler(request, exc):
    return JSON({"detail": exc.detail}, status=exc.status, headers=exc.headers)


def malformed_body_handler(request, exc):
    """A body that is not JSON at all is 400, not 422.

    422 says the request parsed and was wrong about something. This one did not
    parse. The difference matters to whoever is fixing it: a 400 sends them to
    look at how they serialised, a 422 sends them to look at what they sent.

    It is registered rather than raised, because `json.JSONDecodeError` comes
    out of the standard library and is not ours to subclass.
    """
    return JSON({"detail": f"the body is not JSON: {exc}"}, status=400)


def validation_handler(request, exc):
    """A request that did not carry what the handler asked for is 422.

    Not 400, which says the request was malformed, and not 500, which says this
    was our fault. 422 says it parsed and it was wrong, which is what a missing
    field is.
    """
    return JSON({"detail": str(exc)}, status=422)


class ExceptionMiddleware(Middleware):
    """Turns raised exceptions into responses, chosen by type.

    Lookup walks the exception's MRO, so a handler registered for a base class
    catches every subclass, and a handler registered for the subclass wins over
    it. Unit 21 built that ordering, and this is a place it does real work:
    the rule for which handler runs is the same rule Python already uses for
    which method runs.
    """

    def __init__(self, app, handlers=None):
        super().__init__(app)
        self.handlers = {
            HTTPException: http_exception_handler,
            MissingParameter: validation_handler,
            json.JSONDecodeError: malformed_body_handler,
        }
        self.handlers.update(handlers or {})

    def add(self, exception, handler):
        """Register a handler, and return self so calls can be chained."""
        self.handlers[exception] = handler
        return self

    def lookup(self, exc):
        """The most specific handler registered for this exception, or None."""
        for cls in type(exc).__mro__:
            if cls in self.handlers:
                return self.handlers[cls]
        return None

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            handler = self.lookup(exc)
            if handler is None or started:
                # Nothing registered, or too late to change the status. Either
                # way this is not ours, so it goes up to whatever is above.
                raise
            # The body may already have been read by the handler that failed,
            # so this request is for the scope rather than for reading again.
            response = handler(Request(scope, receive), exc)
            if inspect.isawaitable(response):
                response = await response
            await response(scope, receive, send)


class Mount:
    """Another app under a prefix, which is how two apps become one."""

    def __init__(self, prefix, app, name=None):
        raise NotImplementedError

    def match(self, path):
        raise NotImplementedError

    def accepts(self, method):
        """A mount takes every method, because the app inside decides."""
        return True

    def url(self, path="/"):
        raise NotImplementedError

    async def handle(self, scope, receive, send, params):
        raise NotImplementedError


class App:
    """A router, a middleware stack and the lifespan hooks, as one object."""

    def __init__(self, middleware=(), exception_handlers=None):
        self.router = Router()
        self.middleware = list(middleware)
        self.exception_handlers = dict(exception_handlers or {})
        self.startup = []
        self.shutdown = []
        self.state = {}
        self._stack = None

    def route(self, path, methods=("GET",), name=None):
        return self.router.route(path, methods, name)

    def add_route(self, path, handler, methods=("GET",), name=None):
        return self.router.add(path, handler, methods, name)

    def mount(self, prefix, app, name=None):
        return self.router.mount(prefix, app, name)

    def url_for(self, name, **params):
        return self.router.url_for(name, **params)

    def add_middleware(self, factory):
        """Outermost first. Adding one throws away the stack that was built."""
        raise NotImplementedError

    def exception_handler(self, exception):
        raise NotImplementedError

    def on_startup(self, hook):
        self.startup.append(hook)
        return hook

    def on_shutdown(self, hook):
        self.shutdown.append(hook)
        return hook

    def build(self):
        """The stack, built once and kept until something invalidates it."""
        raise NotImplementedError

    async def __call__(self, scope, receive, send):
        raise NotImplementedError

    async def run_hooks(self, hooks):
        """Each hook, given the app if it asked for anything, awaited if needed."""
        raise NotImplementedError

    async def run_lifespan(self, receive, send):
        """Startup and shutdown, which is the other half of the specification."""
        raise NotImplementedError
~~~

~~~tests
import asyncio

app = App()
events = []


@app.on_startup
def connect(application):
    events.append("connect")
    application.state["db"] = ["ada", "grace", "katherine"]


@app.on_startup
async def warm():
    events.append("warm")


@app.on_shutdown
async def disconnect(application):
    events.append("disconnect")
    application.state.clear()


@app.route("/")
async def index(request):
    return PlainText("index")


@app.route("/people")
async def people(request):
    return JSON(request.app.state["db"])


@app.route("/people/{n:int}")
async def person(n, request: Request):
    people = request.app.state["db"]
    if n >= len(people):
        raise HTTPException(404, f"no person {n}")
    return JSON({"name": people[n]})


@app.route("/boom")
async def boom(request):
    raise RuntimeError("handler trouble")


admin = App()


@admin.route("/")
async def admin_index(request):
    return JSON({"where": "admin", "root": admin_root["value"]})


@admin.route("/users")
async def admin_users(request):
    return PlainText("admin users")


admin_root = {"value": None}


@admin.route("/whereami")
async def whereami(request):
    admin_root["value"] = request.scope["root_path"]
    return PlainText(request.scope["root_path"] + request.path)


app.mount("/admin", admin, name="admin")
app.add_middleware(lambda inner: AddHeaders(inner, server="tiny"))
app.add_middleware(lambda inner: RequestId(inner))

client = Client(app)

# every stage before this one still holds, through the object that holds them
assert asyncio.run(client.get("/")).text == "index"
assert asyncio.run(client.get("/nothing")).status == 404
response = asyncio.run(client.get("/"))
assert response.headers["server"] == "tiny"
assert "x-request-id" in response.headers

# nothing has started yet, so state is empty
assert app.state == {}
assert events == []


async def whole_life():
    async with client.lifespan():
        assert events == ["connect", "warm"], events
        assert app.state["db"] == ["ada", "grace", "katherine"]

        # a handler reaches the app through the scope
        assert (await client.get("/people")).json() == ["ada", "grace", "katherine"]
        assert (await client.get("/people/1")).json() == {"name": "grace"}

        # and the exception layer is inside the middleware, so the error
        # response is decorated like any other
        missing = await client.get("/people/9")
        assert missing.status == 404
        assert missing.json() == {"detail": "no person 9"}
        assert missing.headers["server"] == "tiny"
        assert "x-request-id" in missing.headers

        # while the catch-all outside everything picks up what nothing expected
        failed = await client.get("/boom")
        assert failed.status == 500

        # a mounted app is asked with the prefix taken off
        assert (await client.get("/admin/users")).text == "admin users"
        assert (await client.get("/admin/whereami")).text == "/admin/whereami"
        assert (await client.get("/admin/")).json()["where"] == "admin"
        assert (await client.get("/admin")).json()["where"] == "admin"

        # and something the mounted app does not have is its 404, not ours
        assert (await client.get("/admin/nope")).status == 404
    assert events == ["connect", "warm", "disconnect"], events
    assert app.state == {}


asyncio.run(whole_life())

# a mount answers every method, because the app inside decides
mount = Mount("/admin", admin)
assert mount.accepts("DELETE") and mount.accepts("GET")
assert mount.match("/admin") == {} and mount.match("/admin/x") == {}
assert mount.match("/administrator") is None, "a prefix is not a substring"
assert mount.match("/other") is None
assert mount.url() == "/admin" and mount.url("/users") == "/admin/users"
for bad in ("admin", "/admin/", ""):
    try:
        Mount(bad, admin)
    except ValueError as exc:
        assert "looks like /admin" in str(exc)
    else:
        raise AssertionError(f"{bad!r} is not a prefix")

# links are built by name across the whole app
assert app.url_for("person", n=2) == "/people/2"
assert app.url_for("admin", path="/users") == "/admin/users"

# a startup that fails stops the app coming up, and says why
broken = App()


@broken.on_startup
def cannot(application):
    raise RuntimeError("the database is not there")


async def failing_startup():
    async with Client(broken).lifespan():
        raise AssertionError("this should not have been reached")


try:
    asyncio.run(failing_startup())
except RuntimeError as exc:
    assert "database is not there" in str(exc), str(exc)
else:
    raise AssertionError("a failed startup should not start")

# an app with no hooks starts and stops without anything to do
quiet = App()
quiet.add_route("/", index)


async def quietly():
    async with Client(quiet).lifespan():
        return (await Client(quiet).get("/")).text


assert asyncio.run(quietly()) == "index"

# middleware added later is picked up, because the stack is rebuilt
late = App()
late.add_route("/", index)
assert asyncio.run(Client(late).get("/")).headers.get("late") is None
late.add_middleware(lambda inner: AddHeaders(inner, late="yes"))
assert asyncio.run(Client(late).get("/")).headers["late"] == "yes"

# and so is an exception handler
class Custom(Exception):
    pass


@late.route("/custom")
async def raises(request):
    raise Custom("mine")


assert asyncio.run(Client(late).get("/custom")).status == 500


@late.exception_handler(Custom)
def handle_custom(request, exc):
    return JSON({"mine": str(exc)}, status=418)


response = asyncio.run(Client(late).get("/custom"))
assert response.status == 418 and response.json() == {"mine": "mine"}
assert response.headers["late"] == "yes", "and the middleware still wraps it"

# the stack is built once and kept, rather than per request
built = late.build()
assert late.build() is built
late.add_middleware(lambda inner: inner)
assert late.build() is not built
~~~

~~~solution
import asyncio
import contextlib
import inspect
import json
import re
import time
from urllib.parse import parse_qsl


async def send_response(send, status=200, headers=(), body=b""):
    """The two messages every HTTP response is, in the order ASGI wants them.

    A response is not an object the server takes from you. It is a start
    message carrying the status and the headers, then one or more body
    messages. Everything a framework calls a Response is a way of building
    these two.
    """
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    if not any(name == b"content-length" for name, _ in raw):
        raw.append((b"content-length", str(len(body)).encode()))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class ClientResponse:
    """What the client collected, in a shape a test can read."""

    def __init__(self, messages):
        start = next(m for m in messages if m["type"] == "http.response.start")
        self.status = start["status"]
        self.headers = {
            name.decode().lower(): value.decode() for name, value in start["headers"]
        }
        self.body = b"".join(
            m.get("body", b"") for m in messages if m["type"] == "http.response.body"
        )
        self.messages = messages

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)

    def __repr__(self):
        return f"<{self.status} {len(self.body)} bytes>"


class Client:
    """Drives an app the way a server would, without there being a server.

    Every framework ships one of these, and it is not a testing convenience
    bolted on afterwards. An ASGI app is a callable taking three arguments, so
    anything that can call it with the right three is a server, and a test
    client is the smallest possible one.
    """

    def __init__(self, app):
        self.app = app

    async def request(self, method="GET", path="/", body=b"", headers=(),
                      query="", chunks=None):
        """Send one request through the app and return what came back."""
        if isinstance(body, str):
            body = body.encode("utf-8")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        if chunks is None:
            pending = [{"type": "http.request", "body": body, "more_body": False}]
        else:
            # A real server delivers a large body in pieces, and an app that
            # reads only the first one is an app that loses most of it.
            pending = [
                {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
                for n, chunk in enumerate(chunks)
            ]

        async def receive():
            # A server that has nothing left to give says the client hung up,
            # which is what an app that keeps reading has to cope with.
            return pending.pop(0) if pending else {"type": "http.disconnect"}

        sent = []

        async def send(message):
            sent.append(message)

        await self.app(scope, receive, send)
        return ClientResponse(sent)

    @contextlib.asynccontextmanager
    async def lifespan(self):
        """Run the app's startup, hand back the client, then run its shutdown.

        The app awaits `receive` twice and does other work in between, so it
        runs as a task and the two ends talk through queues. That is what a
        real server does too.
        """
        incoming, outgoing = asyncio.Queue(), asyncio.Queue()

        async def receive():
            return await incoming.get()

        async def send(message):
            await outgoing.put(message)

        scope = {"type": "lifespan", "asgi": {"version": "3.0"}}
        task = asyncio.create_task(self.app(scope, receive, send))
        await incoming.put({"type": "lifespan.startup"})
        started = await outgoing.get()
        if started["type"] != "lifespan.startup.complete":
            await task
            raise RuntimeError(started.get("message", "startup failed"))
        try:
            yield self
        finally:
            await incoming.put({"type": "lifespan.shutdown"})
            await outgoing.get()
            await task

    def get(self, path="/", **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path="/", **kwargs):
        return self.request("POST", path, **kwargs)


def query_pairs(scope):
    """The query string as a list of pairs, keeping repeats.

    `?tag=a&tag=b` is two values for one name, and a dict would lose one of
    them, so the pairs come first and any flattening happens later.
    """
    return parse_qsl(scope.get("query_string", b"").decode("latin-1"),
                     keep_blank_values=True)


class MultiDict:
    """An ordered mapping where one name may hold more than one value.

    Query strings and headers both need this and a dict does neither: `?tag=a
    &tag=b` is two values, and so is `Set-Cookie` twice. Pairs in order, with
    lookups that pick the first, which is what callers almost always mean.
    """

    def __init__(self, source=()):
        self._pairs = []
        items = source.items() if isinstance(source, dict) else source
        for name, value in items:
            self.append(name, value)

    def _key(self, name):
        """How a name is stored and compared. Subclasses fold case here."""
        return name.decode("latin-1") if isinstance(name, bytes) else str(name)

    @staticmethod
    def _value(value):
        return value.decode("latin-1") if isinstance(value, bytes) else str(value)

    def append(self, name, value):
        """Add a value without removing one that is already there."""
        self._pairs.append((self._key(name), self._value(value)))

    def __setitem__(self, name, value):
        """Replace every value for this name with one."""
        key = self._key(name)
        self._pairs = [pair for pair in self._pairs if pair[0] != key]
        self._pairs.append((key, self._value(value)))

    def setdefault(self, name, value):
        """Set it only if the caller did not, which is how defaults stay defaults."""
        if name not in self:
            self[name] = value

    def __getitem__(self, name):
        key = self._key(name)
        for stored, value in self._pairs:
            if stored == key:
                return value
        raise KeyError(name)

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def get_all(self, name):
        """Every value for this name, in the order they arrived."""
        key = self._key(name)
        return [value for stored, value in self._pairs if stored == key]

    def __contains__(self, name):
        key = self._key(name)
        return any(stored == key for stored, _ in self._pairs)

    def __iter__(self):
        return iter(self._pairs)

    def __len__(self):
        return len(self._pairs)

    def __repr__(self):
        return f"{type(self).__name__}({self._pairs!r})"


class Headers(MultiDict):
    """HTTP headers, which are the same thing with the case folded.

    `Content-Type` and `content-type` are one header, so the only difference
    from the parent is where a name is turned into a key.
    """

    def _key(self, name):
        return super()._key(name).lower()

    def raw(self):
        """The list of byte pairs ASGI wants on the wire."""
        return [(k.encode("latin-1"), v.encode("latin-1")) for k, v in self._pairs]


class Response:
    """A status, headers and a body, which is also an ASGI app.

    That last part is the design worth stealing. A response knows how to put
    itself on the wire, so returning one from a handler and being one are the
    same thing, and a whole layer of glue does not need to exist.
    """

    # Annotated because inference only sees the right hand side: a bare
    # `media_type = None` is typed None, and every subclass setting a string
    # would be an error. Unit 24, in the one place it always bites.
    media_type: str | None = None
    charset = "utf-8"

    def __init__(self, content=b"", status=200, headers=None, media_type=None):
        self.status = status
        if media_type is not None:
            self.media_type = media_type
        self.body = self.render(content)
        self.headers = Headers(headers or ())
        if self.status in (204, 304) or self.status < 200:
            # HTTP says these carry no body, and a length header on one is a
            # message a proxy is entitled to be confused by.
            self.body = b""
        else:
            self.headers.setdefault("content-length", str(len(self.body)))
        if self.media_type is not None:
            self.headers.setdefault("content-type", self.content_type())

    def content_type(self):
        """The media type, with the charset when the type is text."""
        if self.media_type.startswith("text/") or self.media_type.endswith("+json"):
            return f"{self.media_type}; charset={self.charset}"
        return self.media_type

    def render(self, content):
        """Whatever was handed in, as bytes."""
        if content is None:
            return b""
        if isinstance(content, bytes):
            return content
        return str(content).encode(self.charset)

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status,
                    "headers": self.headers.raw()})
        # A HEAD gets the headers a GET would have got, including the
        # content-length, and none of the body. HTTP is explicit about it, and
        # a proxy handed a body on a HEAD is entitled to lose track of where
        # one response ends and the next begins.
        head = scope.get("method") == "HEAD"
        await send({"type": "http.response.body",
                    "body": b"" if head else self.body})

    def __repr__(self):
        return f"<{type(self).__name__} {self.status} {len(self.body)} bytes>"


class PlainText(Response):
    media_type = "text/plain"


class HTML(Response):
    media_type = "text/html"


class JSON(Response):
    media_type = "application/json"

    def render(self, content):
        """Compact separators, because a wire is not a place for spaces."""
        return json.dumps(content, separators=(",", ":"), default=str).encode(
            self.charset
        )


class Redirect(Response):
    """A response whose point is the Location header rather than the body."""

    def __init__(self, url, status=307, headers=None):
        super().__init__(b"", status=status, headers=headers)
        self.headers["location"] = url


class ClientDisconnect(Exception):
    """The client hung up before the body arrived."""


class QueryParams(MultiDict):
    """The query string. Case matters here, unlike in headers."""


class Request:
    """The scope and the receive channel, as something worth reading.

    Nothing is parsed until it is asked for. A handler that never looks at the
    query string should not pay for parsing it, and most handlers look at two
    of these and ignore the rest.
    """

    def __init__(self, scope, receive=None):
        self.scope = scope
        self._receive = receive
        self._body = None

    @property
    def method(self):
        return self.scope["method"]

    @property
    def path(self):
        return self.scope["path"]

    @property
    def headers(self):
        return Headers(self.scope.get("headers", ()))

    @property
    def query(self):
        return QueryParams(query_pairs(self.scope))

    @property
    def app(self):
        """The App handling this request, or None when there is not one."""
        return self.scope.get("app")

    @property
    def params(self):
        """The path parameters the router matched, already converted."""
        return self.scope.get("path_params", {})

    @property
    def content_type(self):
        """The media type without the parameters after it."""
        return self.headers.get("content-type", "").split(";")[0].strip()

    @property
    def client(self):
        """(host, port), or None when the server did not say."""
        client = self.scope.get("client")
        return tuple(client) if client else None

    async def body(self):
        """The whole body, read once and then remembered.

        Reading the receive channel a second time gives nothing, because the
        messages were consumed the first time. Caching here is what lets a
        middleware and a handler both look at the body without the second one
        finding it empty.
        """
        if self._body is None:
            chunks = []
            while True:
                message = await self._receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect("the client hung up before the body ended")
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            self._body = b"".join(chunks)
        return self._body

    async def text(self, encoding="utf-8"):
        return (await self.body()).decode(encoding)

    async def json(self):
        """The body as JSON. An empty body is None rather than an error."""
        raw = await self.body()
        return json.loads(raw) if raw.strip() else None

    def __repr__(self):
        return f"<Request {self.method} {self.path}>"


CONVERTERS = {
    "str": (r"[^/]+", str),
    "int": (r"[0-9]+", int),
    "float": (r"[0-9]+(?:\.[0-9]+)?", float),
    "path": (r".*", str),
}

PARAM = re.compile(r"{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_]+))?}")


def compile_path(path):
    """A path pattern as a compiled regex and a map of name to converter.

    Done once when the route is made rather than once per request, which is the
    difference between routing that costs nothing and routing that shows up in
    a profile.
    """
    pattern, converters, last = "", {}, 0
    for match in PARAM.finditer(path):
        name, kind = match.group(1), match.group(2) or "str"
        if kind not in CONVERTERS:
            raise ValueError(
                f"{path!r}: {kind!r} is not a converter, only {sorted(CONVERTERS)}"
            )
        if name in converters:
            raise ValueError(f"{path!r}: {name!r} appears twice")
        regex, convert = CONVERTERS[kind]
        pattern += re.escape(path[last:match.start()]) + f"(?P<{name}>{regex})"
        converters[name] = convert
        last = match.end()
    return re.compile(f"^{pattern + re.escape(path[last:])}$"), converters


class Route:
    """One path pattern, the methods it answers, and what handles it."""

    def __init__(self, path, handler, methods=("GET",), name=None):
        self.path = path
        self.handler = handler
        self.methods = {method.upper() for method in methods}
        if "GET" in self.methods:
            # A HEAD is a GET whose body is thrown away, so a route that
            # answers one answers the other. Servers rely on this.
            self.methods.add("HEAD")
        self.name = name or getattr(handler, "__name__", None) or path
        self.pattern, self.converters = compile_path(path)

    def accepts(self, method):
        return method in self.methods

    async def handle(self, scope, receive, send, params):
        """Run the handler and send what it gives back."""
        scope["path_params"] = params
        response = await self.handler(**await solve(self.handler, Request(scope, receive)))
        await response(scope, receive, send)

    def match(self, path):
        """The converted path parameters, or None when this route does not match."""
        found = self.pattern.match(path)
        if found is None:
            return None
        return {
            name: self.converters[name](value)
            for name, value in found.groupdict().items()
        }

    def url(self, **params):
        """The path this route would match for these parameters.

        The inverse of matching, and it checks itself: what it builds is run
        back through the pattern, so an int parameter given a word fails here
        rather than producing a link that goes nowhere.
        """
        missing = set(self.converters) - set(params)
        if missing:
            raise ValueError(f"{self.path!r} needs {sorted(missing)}")
        built = PARAM.sub(lambda m: str(params[m.group(1)]), self.path)
        if self.match(built) is None:
            raise ValueError(f"{params} does not build a path {self.path!r} matches")
        return built

    def __repr__(self):
        return f"<Route {'/'.join(sorted(self.methods))} {self.path}>"


class Router:
    """Routes tried in order, and an ASGI app like everything else here."""

    def __init__(self, routes=()):
        self.routes = list(routes)

    def add(self, path, handler, methods=("GET",), name=None):
        route = Route(path, handler, methods, name)
        self.routes.append(route)
        return route

    def route(self, path, methods=("GET",), name=None):
        """The decorator, which is `add` with the arguments the other way up."""
        def register(handler):
            self.add(path, handler, methods, name)
            return handler
        return register

    def mount(self, prefix, app, name=None):
        """Put another app under a prefix. It answers every method below it."""
        mounted = Mount(prefix, app, name)
        self.routes.append(mounted)
        return mounted

    def url_for(self, name, **params):
        """The path for a named route, so links are not written out by hand."""
        for route in self.routes:
            if route.name == name:
                return route.url(**params)
        raise ValueError(f"no route named {name!r}")

    def resolve(self, method, path):
        """(route, params) when something matched, (None, allowed methods) when not.

        The second half is what makes 405 possible. A path that matched a route
        whose methods did not is a different answer from a path that matched
        nothing, and telling them apart is the whole of it.
        """
        allowed = set()
        for route in self.routes:
            params = route.match(path)
            if params is None:
                continue
            if route.accepts(method):
                return route, params
            allowed |= route.methods
        return None, allowed

    async def __call__(self, scope, receive, send):
        route, found = self.resolve(scope["method"], scope["path"])
        if route is None:
            await self.not_matched(found)(scope, receive, send)
            return
        await route.handle(scope, receive, send, found)

    @staticmethod
    def not_matched(allowed):
        """404 when nothing had that path, 405 when nothing had that method."""
        if not allowed:
            return PlainText("Not Found", status=404)
        return PlainText("Method Not Allowed", status=405,
                         headers={"allow": ", ".join(sorted(allowed))})


class Middleware:
    """An ASGI app that wraps another one, which is the whole of the pattern.

    An app is a callable taking three arguments. A middleware is also a
    callable taking three arguments. So the two are the same kind of thing and
    they nest without a registry, a plugin system or a hook. `A(B(app))` is the
    entire mechanism.

    There are only two moves inside one. To change the request, edit the scope
    before calling through. To change the response, wrap `send`, because the
    response does not come back up as a value: it goes out through send as the
    app below produces it.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        await self.app(scope, receive, send)


def stack(app, *middlewares):
    """Wrap the app, outermost first, which is the order people read them in.

    Applied in reverse so that `stack(app, A, B)` is `A(B(app))`: A sees the
    request first and the response last, which is what an onion means.
    """
    for factory in reversed(middlewares):
        app = factory(app)
    return app


class AddHeaders(Middleware):
    """Adds headers to whatever the app below sends."""

    def __init__(self, app, **headers):
        super().__init__(app)
        self.extra = [
            (name.replace("_", "-").lower().encode("latin-1"),
             str(value).encode("latin-1"))
            for name, value in headers.items()
        ]

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message["headers"], *self.extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestId(Middleware):
    """An id on the scope going down, and the same id in a header coming back.

    Both moves in one place, which is why it is the useful one to read.
    """

    def __init__(self, app, header="x-request-id"):
        super().__init__(app)
        self.header = header
        self.issued = 0

    def next_id(self):
        self.issued += 1
        return f"req-{self.issued}"

    async def __call__(self, scope, receive, send):
        identifier = scope.get("headers") and dict(scope["headers"]).get(
            self.header.encode("latin-1")
        )
        text = identifier.decode("latin-1") if identifier else self.next_id()
        scope = {**scope, "request_id": text}

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), text.encode("latin-1")),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_id)


class Timing(Middleware):
    """How long the app below took, in a header."""

    def __init__(self, app, header="x-elapsed-ms"):
        super().__init__(app)
        self.header = header

    async def __call__(self, scope, receive, send):
        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                elapsed = (time.perf_counter() - started) * 1000
                message = {
                    **message,
                    "headers": [
                        *message["headers"],
                        (self.header.encode("latin-1"), f"{elapsed:.3f}".encode()),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_timing)


class CatchErrors(Middleware):
    """An exception below becomes a 500 rather than a crashed connection.

    It has to remember whether the response started, and this is the part
    people leave out. Once the start message has gone out, the status is on the
    wire and cannot be taken back, so an error after that point cannot become a
    500. There is nothing to do but let it out and let the server drop the
    connection, which is honest, where sending a second start message is not.
    """

    def __init__(self, app, handler=None, keep=20):
        super().__init__(app)
        self.handler = handler
        self.keep = keep
        # The last few, not all of them. This layer is the outermost one and
        # lives as long as the app does, and every exception on it holds its
        # traceback, which holds every frame, which holds the request body and
        # the scope. An unbounded list here is a memory leak per error.
        self.errors = []

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            self.errors.append(exc)
            del self.errors[:-self.keep]
            if started:
                raise
            response = (
                self.handler(exc) if self.handler
                else PlainText("Internal Server Error", status=500)
            )
            await response(scope, receive, send)


class MissingParameter(Exception):
    """A handler asked for something the request does not have."""


class Depends:
    """A marker in a default: this parameter comes from calling that.

    `async def show(user=Depends(current_user))` says where `user` comes from
    in the signature, which is the only place a reader is already looking.
    """

    def __init__(self, provider, cache=True):
        self.provider = provider
        self.cache = cache

    def __repr__(self):
        return f"Depends({getattr(self.provider, '__name__', self.provider)})"


class Body:
    """A marker in a default: this parameter is the parsed JSON body.

    `Body()` is the whole body and `Body("name")` is one key out of it.
    """

    def __init__(self, field=None):
        self.field = field


def to_bool(text):
    """A query string carries text, and "false" is text that means False."""
    lowered = str(text).lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"{text!r} is not a true or a false")


SCALARS = {int: int, float: float, bool: to_bool, str: str}


def convert(value, annotation):
    """A string from the query, as whatever the signature said it should be."""
    converter = SCALARS.get(annotation)
    return value if converter is None else converter(value)


async def solve(target, request, cache=None):
    """The keyword arguments `target` asked for, worked out from its signature.

    Reading a signature is unit 26's `inspect`, and this is the thing it is
    for. The order the rules are tried in is the whole design, so it is written
    out once, here, rather than being spread across the framework.
    """
    cache = {} if cache is None else cache
    values = {}
    for name, parameter in inspect.signature(target).parameters.items():
        if parameter.kind in (parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD):
            continue
        values[name] = await solve_one(name, parameter, request, cache)
    return values


async def solve_one(name, parameter, request, cache):
    """One parameter, by the first rule that applies to it."""
    default, annotation = parameter.default, parameter.annotation
    if annotation is Request or name == "request":
        return request
    if isinstance(default, Depends):
        return await provide(default, request, cache)
    if isinstance(default, Body):
        return await from_body(default, request)
    if name in request.params:
        # already converted, because the route pattern did it when it matched
        return request.params[name]
    if name in request.query:
        try:
            return convert(request.query[name], annotation)
        except ValueError as exc:
            raise MissingParameter(f"{name}: {exc}") from exc
    if default is not inspect.Parameter.empty:
        return default
    raise MissingParameter(f"the request has nothing for {name!r}")


async def from_body(marker, request):
    """The parsed body, or one field out of it."""
    body = await request.json()
    if marker.field is None:
        return body
    if not isinstance(body, dict) or marker.field not in body:
        raise MissingParameter(f"the body has no {marker.field!r}")
    return body[marker.field]


async def provide(marker, request, cache):
    """Call a provider, having first solved what it asked for.

    Providers take dependencies too, so this recurses, and the cache is what
    stops a provider two handlers both need from running twice in one request.
    A database session is the usual reason to want that.
    """
    if marker.cache and marker.provider in cache:
        return cache[marker.provider]
    value = marker.provider(**await solve(marker.provider, request, cache))
    if inspect.isawaitable(value):
        value = await value
    if marker.cache:
        cache[marker.provider] = value
    return value


STATUS_TEXT = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable Content",
    429: "Too Many Requests", 500: "Internal Server Error",
}


class HTTPException(Exception):
    """A status a handler chose, by raising instead of returning.

    Raising is what you want three calls down, where returning a response would
    mean every layer between here and the handler has to pass it back up and
    remember not to touch it.
    """

    def __init__(self, status, detail=None, headers=None):
        self.status = status
        self.detail = detail or STATUS_TEXT.get(status, "Error")
        self.headers = headers or {}
        super().__init__(f"{status} {self.detail}")


def http_exception_handler(request, exc):
    return JSON({"detail": exc.detail}, status=exc.status, headers=exc.headers)


def malformed_body_handler(request, exc):
    """A body that is not JSON at all is 400, not 422.

    422 says the request parsed and was wrong about something. This one did not
    parse. The difference matters to whoever is fixing it: a 400 sends them to
    look at how they serialised, a 422 sends them to look at what they sent.

    It is registered rather than raised, because `json.JSONDecodeError` comes
    out of the standard library and is not ours to subclass.
    """
    return JSON({"detail": f"the body is not JSON: {exc}"}, status=400)


def validation_handler(request, exc):
    """A request that did not carry what the handler asked for is 422.

    Not 400, which says the request was malformed, and not 500, which says this
    was our fault. 422 says it parsed and it was wrong, which is what a missing
    field is.
    """
    return JSON({"detail": str(exc)}, status=422)


class ExceptionMiddleware(Middleware):
    """Turns raised exceptions into responses, chosen by type.

    Lookup walks the exception's MRO, so a handler registered for a base class
    catches every subclass, and a handler registered for the subclass wins over
    it. Unit 21 built that ordering, and this is a place it does real work:
    the rule for which handler runs is the same rule Python already uses for
    which method runs.
    """

    def __init__(self, app, handlers=None):
        super().__init__(app)
        self.handlers = {
            HTTPException: http_exception_handler,
            MissingParameter: validation_handler,
            json.JSONDecodeError: malformed_body_handler,
        }
        self.handlers.update(handlers or {})

    def add(self, exception, handler):
        """Register a handler, and return self so calls can be chained."""
        self.handlers[exception] = handler
        return self

    def lookup(self, exc):
        """The most specific handler registered for this exception, or None."""
        for cls in type(exc).__mro__:
            if cls in self.handlers:
                return self.handlers[cls]
        return None

    async def __call__(self, scope, receive, send):
        started = False

        async def watch(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception as exc:
            handler = self.lookup(exc)
            if handler is None or started:
                # Nothing registered, or too late to change the status. Either
                # way this is not ours, so it goes up to whatever is above.
                raise
            # The body may already have been read by the handler that failed,
            # so this request is for the scope rather than for reading again.
            response = handler(Request(scope, receive), exc)
            if inspect.isawaitable(response):
                response = await response
            await response(scope, receive, send)


class Mount:
    """Another app under a prefix, which is how two apps become one.

    The prefix comes off the path and goes onto `root_path` before the inner
    app sees it, so the inner app is written as though it were at the top and
    still knows where it really is.
    """

    def __init__(self, prefix, app, name=None):
        if not prefix.startswith("/") or prefix.endswith("/"):
            raise ValueError(f"a mount prefix looks like /admin, not {prefix!r}")
        self.prefix = prefix
        self.app = app
        self.name = name or prefix.strip("/")

    def match(self, path):
        if path == self.prefix or path.startswith(self.prefix + "/"):
            return {}
        return None

    def accepts(self, method):
        """A mount takes every method, because the app inside decides."""
        return True

    def url(self, path="/"):
        return self.prefix + ("" if path == "/" else path)

    async def handle(self, scope, receive, send, params):
        inner = {
            **scope,
            "path": scope["path"][len(self.prefix):] or "/",
            "root_path": scope.get("root_path", "") + self.prefix,
        }
        await self.app(inner, receive, send)

    def __repr__(self):
        return f"<Mount {self.prefix} -> {self.app!r}>"


class App:
    """A router, a middleware stack and the lifespan hooks, as one object.

    Nothing new happens here. Every part was built in an earlier stage, and
    this is the object that holds them in the right order so that somebody
    using the framework does not have to.
    """

    def __init__(self, middleware=(), exception_handlers=None):
        self.router = Router()
        self.middleware = list(middleware)
        self.exception_handlers = dict(exception_handlers or {})
        self.startup = []
        self.shutdown = []
        self.state = {}
        self._stack = None

    def route(self, path, methods=("GET",), name=None):
        return self.router.route(path, methods, name)

    def add_route(self, path, handler, methods=("GET",), name=None):
        return self.router.add(path, handler, methods, name)

    def mount(self, prefix, app, name=None):
        return self.router.mount(prefix, app, name)

    def url_for(self, name, **params):
        return self.router.url_for(name, **params)

    def add_middleware(self, factory):
        """Outermost first. Adding one throws away the stack that was built."""
        self.middleware.append(factory)
        self._stack = None
        return factory

    def exception_handler(self, exception):
        def register(handler):
            self.exception_handlers[exception] = handler
            self._stack = None
            return handler
        return register

    def on_startup(self, hook):
        self.startup.append(hook)
        return hook

    def on_shutdown(self, hook):
        self.shutdown.append(hook)
        return hook

    def build(self):
        """The stack, built once and kept until something invalidates it.

        The order is the decision stage five ended on. Exceptions are handled
        inside the middleware somebody added, so their wrappers decorate the
        error response, and a catch-all sits outside everything as the last
        resort for whatever the middleware itself gets wrong.
        """
        if self._stack is None:
            inner = ExceptionMiddleware(self.router, self.exception_handlers)
            self._stack = CatchErrors(stack(inner, *self.middleware))
        return self._stack

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            await self.run_lifespan(receive, send)
            return
        scope["app"] = self
        await self.build()(scope, receive, send)

    async def run_hooks(self, hooks):
        """Each hook, given the app if it asked for anything, awaited if needed."""
        for hook in hooks:
            result = hook(self) if inspect.signature(hook).parameters else hook()
            if inspect.isawaitable(result):
                await result

    async def run_lifespan(self, receive, send):
        """Startup and shutdown, which is the other half of the specification.

        A server sends startup once before the first request and shutdown once
        after the last, so this is where a connection pool is opened and closed
        rather than in a global that runs at import.
        """
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                try:
                    await self.run_hooks(self.startup)
                except Exception as exc:
                    await send({"type": "lifespan.startup.failed",
                                "message": f"{type(exc).__name__}: {exc}"})
                    return
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                try:
                    await self.run_hooks(self.shutdown)
                except Exception as exc:
                    await send({"type": "lifespan.shutdown.failed",
                                "message": f"{type(exc).__name__}: {exc}"})
                    return
                await send({"type": "lifespan.shutdown.complete"})
                return
~~~
