---
slug: async-crawler
---

## One name per page

A crawler that has not decided what counts as the same page will fetch the same
one many times and never finish. So the first thing to build is the function
that answers it, before any fetching at all.

Four rules cover most of it. A fragment is a position within a page, not a
different page, so `#section` goes. A trailing slash on a path is the same
place, so it goes too, except on the root. A default port is not part of the
identity. And a relative link is resolved against the page it was found on,
which is what makes `href="../about"` usable.

Anything that is not `http` or `https` is not a page to crawl. `mailto:` and
`javascript:` will appear in real markup, and a crawler that tries to fetch them
is a crawler with a confusing error log.

@goal `normalise` gives one canonical form per page and refuses what is not one.

~~~starter
from dataclasses import dataclass, field


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    raise NotImplementedError


def same_host(url, other):
    """Whether two urls are on the same host."""
    raise NotImplementedError
~~~

~~~tests
# the plain case
assert normalise("http://example.com/a") == "http://example.com/a"
assert normalise("http://example.com") == "http://example.com/"
assert normalise("http://example.com/") == "http://example.com/"

# a fragment is a position in a page, not a page
assert normalise("http://example.com/a#top") == "http://example.com/a"
assert normalise("http://example.com/a#") == "http://example.com/a"

# a trailing slash is the same place, except at the root
assert normalise("http://example.com/a/") == "http://example.com/a"
assert normalise("http://example.com/a/b/") == "http://example.com/a/b"

# the host is case-insensitive and the default port is not part of it
assert normalise("http://EXAMPLE.com/a") == "http://example.com/a"
assert normalise("http://example.com:80/a") == "http://example.com/a"
assert normalise("https://example.com:443/a") == "https://example.com/a"
assert normalise("http://example.com:8080/a") == "http://example.com:8080/a"

# a query is part of the identity, because it usually changes the page
assert normalise("http://example.com/a?x=1") == "http://example.com/a?x=1"
assert normalise("http://example.com/a?x=1#top") == "http://example.com/a?x=1"

# relative links resolve against the page they were found on
base = "http://example.com/docs/guide"
assert normalise("intro", base) == "http://example.com/docs/intro"
assert normalise("/intro", base) == "http://example.com/intro"
assert normalise("../about", base) == "http://example.com/about"
assert normalise("http://other.com/x", base) == "http://other.com/x"
assert normalise("#section", base) == "http://example.com/docs/guide"

# and what is not a page comes back as None rather than being fetched
for bad in ["mailto:ada@example.com", "javascript:void(0)", "ftp://example.com/f",
            "tel:+123", "data:text/plain,hi"]:
    assert normalise(bad) is None, f"{bad} should not be crawlable"

# the same page written several ways gets one name
forms = ["http://example.com/a/", "http://EXAMPLE.com/a", "http://example.com:80/a#x"]
assert len({normalise(f) for f in forms}) == 1, {normalise(f) for f in forms}

# same_host
assert same_host("http://example.com/a", "http://example.com/b")
assert same_host("http://example.com/a", "https://EXAMPLE.com/b")
assert not same_host("http://example.com/a", "http://other.com/b")

# and a Page knows whether it worked
assert Page("u", 200).ok
assert not Page("u", 404).ok
assert not Page("u", 200, error="timed out").ok
assert Page("u", 200).links == [] and Page("u", 200).body == ""
~~~

~~~solution
from dataclasses import dataclass, field
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()
~~~

## Fetching one, and reading what it points at

Before any concurrency, one page. Fetch it, and pull the links out of what came
back.

Parse the markup rather than matching it. Unit 37 spent an exercise on why a
regular expression cannot do this: an `href` inside another attribute's value
will match, and a pattern that handles that case handles the next one worse.
`html.parser` is in the standard library and takes twelve lines to use.

Take the fetcher as an object rather than calling a library directly. Unit 31
gave the reason: a crawler with a real HTTP client inside it cannot be tested,
and one that is handed something with a `fetch` method can be tested against a
dictionary of pages that behaves exactly as the real one does.

@goal `find_links` parses a page's links, and a fetcher returns a `Page`.

~~~starter
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        raise NotImplementedError


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    raise NotImplementedError


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        raise NotImplementedError
~~~

~~~tests
import asyncio

# stage one still holds
assert normalise("http://example.com/a/#top") == "http://example.com/a"
assert normalise("mailto:x@y.com") is None

base = "http://example.com/index"

# links come out normalised and absolute
html = '<a href="/one">1</a> <a href="two">2</a> <a href="http://other.com/x">3</a>'
assert find_links(html, base) == [
    "http://example.com/one",
    "http://example.com/two",
    "http://other.com/x",
]

# duplicates collapse, and order is kept
html = '<a href="/a">1</a><a href="/a/">2</a><a href="/b">3</a><a href="/a#top">4</a>'
assert find_links(html, base) == ["http://example.com/a", "http://example.com/b"]

# what is not crawlable is dropped rather than fetched
html = '<a href="mailto:x@y.com">mail</a><a href="/real">real</a><a href="javascript:x">js</a>'
assert find_links(html, base) == ["http://example.com/real"]

# an href inside another attribute is not a link, which a regex would take
tricky = """<a title='href="/fake"' href="/real">link</a>"""
assert find_links(tricky, base) == ["http://example.com/real"]

# markup with no links, and markup that is not really markup
assert find_links("", base) == []
assert find_links("<p>no links here</p>", base) == []
assert find_links("<a>no href</a><a href=''>empty</a>", base) == []

# a response cut off mid-tag keeps every link that arrived whole. HTMLParser
# holds an unfinished tag in its buffer until close(), so without that call the
# last complete link before the cut is lost too, and a truncated response is an
# ordinary thing for a crawler to be handed.
assert find_links('<a href="/a">x</a>\n<a href="/b">y</a>', base) == [
    "http://example.com/a", "http://example.com/b"
]
assert find_links('<a href="/a">x</a><a href="/b"', base) == [
    "http://example.com/a"
], "the unfinished tag has no href yet, and must not take the finished one down"

# fetching
pages = {
    "http://example.com/": '<a href="/a">a</a><a href="/b">b</a>',
    "http://example.com/a": '<a href="/">home</a>',
}
fetcher = DictFetcher(pages)

page = asyncio.run(fetcher.fetch("http://example.com/"))
assert page.ok and page.status == 200
assert page.links == ["http://example.com/a", "http://example.com/b"]
assert "href" in page.body

# a page that is not there
missing = asyncio.run(fetcher.fetch("http://example.com/nope"))
assert missing.status == 404 and not missing.ok and missing.links == []

# and one that fails to connect
broken = DictFetcher(pages, fail=["http://example.com/a"])
failed = asyncio.run(broken.fetch("http://example.com/a"))
assert not failed.ok and failed.error == "connection refused"

# the fetcher records what was asked for, which is how the later stages measure
assert fetcher.requested == ["http://example.com/", "http://example.com/nope"]
~~~

~~~solution
import asyncio
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))
~~~

## A pool of workers, and knowing when to stop

Now the concurrency. A queue of urls, a fixed number of workers taking from it,
and each worker putting back whatever links it found. That shape is why a
crawler is the canonical async example: the work discovers more work, so the
number of tasks is not known when the run starts.

The hard part is stopping. A worker pool with no end marker waits forever on an
empty queue, and the crawl is finished when the queue is empty **and** nothing
is still being processed, which is exactly what `queue.join()` answers. So:
start the workers, wait for the join, then cancel them.

Use a `TaskGroup` rather than loose tasks. Unit 34 gave the reason: a task
nobody holds can be collected mid-flight and its exception reported late or
never, and structured concurrency means the workers cannot outlive the block
that made them.

@goal `crawl` visits every reachable page once, with at most `workers` in flight.

~~~starter
import asyncio
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        raise NotImplementedError

    async def _worker(self, queue, root):
        raise NotImplementedError

    async def _visit(self, url, queue, root):
        raise NotImplementedError
~~~

~~~tests
import asyncio

# stage two still holds
assert find_links('<a href="/a">a</a>', "http://example.com/") == ["http://example.com/a"]

site = {
    "http://example.com/": '<a href="/a">a</a><a href="/b">b</a>',
    "http://example.com/a": '<a href="/c">c</a><a href="/">home</a>',
    "http://example.com/b": '<a href="/c">c</a>',
    "http://example.com/c": "<p>the end</p>",
}

# it finishes, rather than waiting forever on an empty queue
crawler = Crawler(DictFetcher(site), workers=3)
pages = asyncio.run(crawler.crawl("http://example.com/"))

assert set(pages) == set(site), set(pages)
assert all(p.ok for p in pages.values())

# every page is fetched exactly once, however many pages link to it
assert len(crawler.fetcher.requested) == 4, crawler.fetcher.requested
assert len(set(crawler.fetcher.requested)) == 4

# a cycle does not loop: / links to a, a links back to /
assert crawler.fetcher.requested.count("http://example.com/") == 1

# the start url is normalised before anything else happens
same = asyncio.run(Crawler(DictFetcher(site)).crawl("http://EXAMPLE.com:80/#top"))
assert set(same) == set(site)

# a start that is not crawlable is refused rather than fetched
try:
    asyncio.run(Crawler(DictFetcher(site)).crawl("mailto:x@y.com"))
except ValueError:
    pass
else:
    raise AssertionError("a non-crawlable start should be refused")

# the work really is concurrent: more than one fetch is in flight at once
slow = Crawler(DictFetcher(site, delay=0.01), workers=3)
asyncio.run(slow.crawl("http://example.com/"))
assert slow.peak_in_flight > 1, "the workers did not overlap"

# and never more than the pool allows
assert slow.peak_in_flight <= 3, slow.peak_in_flight

one = Crawler(DictFetcher(site, delay=0.01), workers=1)
asyncio.run(one.crawl("http://example.com/"))
assert one.peak_in_flight == 1

# a page that fails is recorded and its links are not followed
broken = Crawler(DictFetcher(site, fail=["http://example.com/a"]))
pages = asyncio.run(broken.crawl("http://example.com/"))
assert not pages["http://example.com/a"].ok
assert "http://example.com/c" in pages, "c is still reachable through b"

# a 404 is recorded too
missing = {"http://example.com/": '<a href="/gone">gone</a>'}
pages = asyncio.run(Crawler(DictFetcher(missing)).crawl("http://example.com/"))
assert pages["http://example.com/gone"].status == 404

# other hosts are not followed by default
outward = {
    "http://example.com/": '<a href="http://other.com/x">away</a><a href="/a">a</a>',
    "http://example.com/a": "",
    "http://other.com/x": "",
}
pages = asyncio.run(Crawler(DictFetcher(outward)).crawl("http://example.com/"))
assert "http://other.com/x" not in pages
assert set(pages) == {"http://example.com/", "http://example.com/a"}

# unless asked
pages = asyncio.run(
    Crawler(DictFetcher(outward), same_host_only=False).crawl("http://example.com/")
)
assert "http://other.com/x" in pages

# and a page budget stops it early
limited = asyncio.run(Crawler(DictFetcher(site), max_pages=2).crawl("http://example.com/"))
assert len(limited) <= 3, len(limited)
~~~

~~~solution
import asyncio
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        queue = asyncio.Queue()
        self.seen = {root}
        self.pages = {}
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            finally:
                queue.task_done()

    async def _visit(self, url, queue, root):
        self.in_flight += 1
        self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
        try:
            page = await self.fetcher.fetch(url)
        finally:
            self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            self.seen.add(link)
            await queue.put(link)
~~~

## Being a guest rather than a problem

A crawler that opens as many connections as it can and asks as fast as it can is
indistinguishable from an attack, and will be treated as one. Two limits make it
a guest.

**Concurrency**, which is how many requests are open at once, and is an
`asyncio.Semaphore`: unit 34 covered it, and it is the difference between
politely parallel and a connection flood.

**Rate**, which is how many requests per second, and is a different question.
The standard answer is a token bucket: tokens accumulate at a fixed rate up to a
burst, and a request waits for one. The lock around it is what makes the limit
shared between workers rather than one limit each.

Then retries, because a network fails transiently and giving up on the first
timeout loses pages that were there. Not on a 404, which will be a 404 again.

@goal A semaphore caps concurrency, a token bucket caps the rate, and failures retry.

~~~starter
import asyncio
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        queue = asyncio.Queue()
        self.seen = {root}
        self.pages = {}
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            finally:
                queue.task_done()

    async def _visit(self, url, queue, root):
        # the semaphore, the rate limiter and the retries all belong here
        self.in_flight += 1
        self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
        try:
            page = await self.fetcher.fetch(url)
        finally:
            self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            self.seen.add(link)
            await queue.put(link)


    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits."""
        raise NotImplementedError


class RateLimiter:
    """At most `rate` starts per second, shared by every worker."""

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        raise NotImplementedError
~~~

~~~tests
import asyncio

site = {f"http://example.com/{i}": "".join(
    f'<a href="/{j}">{j}</a>' for j in range(8)) for i in range(8)}
site["http://example.com/"] = "".join(f'<a href="/{j}">{j}</a>' for j in range(8))

# stage three still holds
crawler = Crawler(DictFetcher(site), workers=3)
pages = asyncio.run(crawler.crawl("http://example.com/"))
assert len(pages) == 9 and all(p.ok for p in pages.values())

# the semaphore caps how many are open at once, independently of the worker count
capped = Crawler(DictFetcher(site, delay=0.01), workers=8, concurrency=2)
asyncio.run(capped.crawl("http://example.com/"))
assert capped.peak_in_flight <= 2, capped.peak_in_flight
assert capped.peak_in_flight > 1, "two should still overlap"

# with no cap it is the worker count
uncapped = Crawler(DictFetcher(site, delay=0.01), workers=4)
asyncio.run(uncapped.crawl("http://example.com/"))
assert uncapped.peak_in_flight <= 4

# the token bucket: a burst goes straight through, then the rest wait
async def bucket_test():
    now = [0.0]
    limiter = RateLimiter(rate=10, burst=3, clock=lambda: now[0])
    for _ in range(3):
        await limiter.acquire()
    assert limiter.waits == 0, "a burst should not wait"
    await limiter.acquire()
    assert limiter.waits == 1, "the fourth should have waited"
    return True


assert asyncio.run(bucket_test())

# tokens come back as time passes
async def refill_test():
    now = [0.0]
    limiter = RateLimiter(rate=10, burst=1, clock=lambda: now[0])
    await limiter.acquire()
    now[0] = 1.0                       # a second later, ten tokens are owed
    before = limiter.waits
    await limiter.acquire()
    assert limiter.waits == before, "a refilled bucket should not wait"
    return True


assert asyncio.run(refill_test())

# a rate of zero or less is not a rate
try:
    RateLimiter(rate=0)
except ValueError:
    pass
else:
    raise AssertionError("a rate of zero should be refused")

# the limiter is shared, so the whole crawl is limited rather than each worker
async def limited_crawl():
    limiter = RateLimiter(rate=1000, burst=1)
    crawler = Crawler(DictFetcher(site), workers=4, limiter=limiter)
    await crawler.crawl("http://example.com/")
    return limiter.waits, len(crawler.pages)


waits, count = asyncio.run(limited_crawl())
assert count == 9
assert waits >= 5, f"nine pages at burst one should have waited, got {waits}"

# retries: a failure is tried again
flaky = DictFetcher(site, fail=["http://example.com/3"])
crawler = Crawler(flaky, workers=2, retries=3, backoff=0.0)
asyncio.run(crawler.crawl("http://example.com/"))
assert flaky.requested.count("http://example.com/3") == 3, flaky.requested.count("http://example.com/3")
assert crawler.retried == 2

# a crawler that would never attempt anything is refused where it is built,
# rather than failing on the first page with a name that was never bound
for bad in (0, -1):
    try:
        Crawler(flaky, retries=bad)
    except ValueError as exc:
        assert "never fetch anything" in str(exc)
    else:
        raise AssertionError(f"retries={bad} attempts nothing")

# but a 404 is not, because it will be a 404 again
missing = DictFetcher({"http://example.com/": '<a href="/gone">g</a>'})
crawler = Crawler(missing, retries=3, backoff=0.0)
asyncio.run(crawler.crawl("http://example.com/"))
assert missing.requested.count("http://example.com/gone") == 1

# and a page that recovers is kept
class Flaky(DictFetcher):
    async def fetch(self, url):
        page = await super().fetch(url)
        if url == "http://example.com/2" and self.requested.count(url) < 2:
            return Page(url, 0, error="transient")
        return page


recovering = Flaky(site)
crawler = Crawler(recovering, retries=3, backoff=0.0)
pages = asyncio.run(crawler.crawl("http://example.com/"))
assert pages["http://example.com/2"].ok, "a page that recovers should be kept"
~~~

~~~solution
import asyncio
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        queue = asyncio.Queue()
        self.seen = {root}
        self.pages = {}
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            finally:
                queue.task_done()

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            self.seen.add(link)
            await queue.put(link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits."""
        for attempt in range(1, self.retries + 1):
            page = await self.fetcher.fetch(url)
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1
~~~

## How deep, and how much held at once

Two limits that are about the shape of the crawl rather than about politeness.

**Depth.** A site with a calendar has infinitely many pages, all reachable, none
worth having. Recording how far each page is from the start and refusing to go
past a limit is what stops that, and the depth of a page is one more than the
depth of the page that linked to it.

**The frontier.** Every discovered url is held in memory until it is visited, and
on a large site that is the largest thing the crawler holds. A bounded queue is
the fix and it brings a trap with it: awaiting `put` on a full queue from inside
a worker is a deadlock, because every worker is blocked adding work and none is
left to take any. Defer instead, and drain when there is room.

That deadlock is the reason to build this rather than read about it. It is
invisible on a small site and total on a big one.

@goal Depth is limited, the frontier is bounded, and a full queue never deadlocks.

~~~starter
import asyncio
import collections
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01,
                 max_depth=None, max_frontier=None):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.max_depth = max_depth
        self.max_frontier = max_frontier
        self.depth = {}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        queue = asyncio.Queue()
        self.seen = {root}
        self.pages = {}
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            finally:
                queue.task_done()

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            self.seen.add(link)
            await queue.put(link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits."""
        for attempt in range(1, self.retries + 1):
            page = await self.fetcher.fetch(url)
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1


    def _drain(self, queue):
        """Move deferred urls into the queue while there is room for them."""
        raise NotImplementedError

    def _enqueue(self, queue, url):
        """Queue a url, or hold it aside rather than blocking a worker."""
        raise NotImplementedError
~~~

~~~tests
import asyncio

# a chain: / to a to b to c to d
chain = {"http://example.com/": '<a href="/a">a</a>'}
for here, nxt in [("a", "b"), ("b", "c"), ("c", "d")]:
    chain[f"http://example.com/{here}"] = f'<a href="/{nxt}">{nxt}</a>'
chain["http://example.com/d"] = ""

# stage four still holds
crawler = Crawler(DictFetcher(chain), workers=2, retries=2, backoff=0.0)
assert len(asyncio.run(crawler.crawl("http://example.com/"))) == 5

# depth is recorded from the start
crawler = Crawler(DictFetcher(chain))
asyncio.run(crawler.crawl("http://example.com/"))
assert crawler.depth["http://example.com/"] == 0
assert crawler.depth["http://example.com/a"] == 1
assert crawler.depth["http://example.com/d"] == 4

# and limited
shallow = Crawler(DictFetcher(chain), max_depth=2)
pages = asyncio.run(shallow.crawl("http://example.com/"))
assert set(pages) == {
    "http://example.com/", "http://example.com/a", "http://example.com/b",
}, set(pages)

assert len(asyncio.run(Crawler(DictFetcher(chain), max_depth=0).crawl("http://example.com/"))) == 1

# a page reachable by two paths gets the depth of the path that found it first
diamond = {
    "http://example.com/": '<a href="/a">a</a><a href="/b">b</a>',
    "http://example.com/a": '<a href="/deep">d</a>',
    "http://example.com/b": '<a href="/deep">d</a>',
    "http://example.com/deep": "",
}
crawler = Crawler(DictFetcher(diamond), workers=1)
asyncio.run(crawler.crawl("http://example.com/"))
assert crawler.depth["http://example.com/deep"] == 2

# the frontier: a wide site with a small queue must not deadlock
wide = {"http://example.com/": "".join(f'<a href="/{i}">{i}</a>' for i in range(40))}
for i in range(40):
    wide[f"http://example.com/{i}"] = ""

crawler = Crawler(DictFetcher(wide), workers=3, max_frontier=4)
pages = asyncio.run(asyncio.wait_for(crawler.crawl("http://example.com/"), timeout=10))
assert len(pages) == 41, f"the bounded crawl finished with {len(pages)} pages"
assert all(p.ok for p in pages.values())

# and the queue really was bounded
crawler = Crawler(DictFetcher(wide), workers=3, max_frontier=4)
asyncio.run(crawler.crawl("http://example.com/"))
assert crawler.peak_frontier >= 4, crawler.peak_frontier

# unbounded still works, and holds more at once
loose = Crawler(DictFetcher(wide), workers=3)
asyncio.run(loose.crawl("http://example.com/"))
assert len(loose.pages) == 41

# depth and the frontier bound compose
both = Crawler(DictFetcher(wide), workers=2, max_frontier=3, max_depth=1)
pages = asyncio.run(asyncio.wait_for(both.crawl("http://example.com/"), timeout=10))
assert len(pages) == 41

deeper = Crawler(DictFetcher(chain), workers=2, max_frontier=1, max_depth=2)
assert len(asyncio.run(asyncio.wait_for(deeper.crawl("http://example.com/"), timeout=10))) == 3

# nothing is lost: everything deferred is eventually visited
assert both.deferred == collections.deque() or len(both.deferred) == 0
~~~

~~~solution
import asyncio
import collections
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01,
                 max_depth=None, max_frontier=None):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.max_depth = max_depth
        self.max_frontier = max_frontier
        self.depth = {}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        queue = asyncio.Queue(maxsize=self.max_frontier or 0)
        self.seen = {root}
        self.pages = {}
        self.depth = {root: 0}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        # All of them, not the ones that came to mind. A crawler used twice
        # reported the first run's retries added to the second run's.
        self.retried = 0
        self.timed_out = 0
        self.blocked = []
        self.in_flight = 0
        self.peak_in_flight = 0
        self.cancelled = False
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            finally:
                self._drain(queue)
                queue.task_done()

    def _drain(self, queue):
        """Move deferred urls into the queue while there is room for them."""
        while self.deferred and not queue.full():
            queue.put_nowait(self.deferred.popleft())
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    def _enqueue(self, queue, url):
        """Queue a url, or hold it aside rather than blocking a worker.

        A bounded queue is what stops the frontier eating memory, and awaiting
        put() on a full one from inside a worker is a deadlock: every worker is
        blocked adding work and none is left to take any. Defer instead, and
        drain when there is room.
        """
        if queue.full():
            self.deferred.append(url)
        else:
            queue.put_nowait(url)
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        here = self.depth.get(url, 0)
        if self.max_depth is not None and here >= self.max_depth:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            self.seen.add(link)
            self.depth[link] = here + 1
            self._enqueue(queue, link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits."""
        for attempt in range(1, self.retries + 1):
            page = await self.fetcher.fetch(url)
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1
~~~

## Giving up in time, and stopping when asked

A crawl talks to machines that may never answer, and a request with no timeout
is a worker lost for the rest of the run. `asyncio.timeout` is the readable way
to bound one: a context manager that cancels what is inside it when the clock
runs out.

A timeout is a failure like any other and should retry like one, because a
request that took too long once may not the next time.

Then cancellation, which is the half people get wrong. Unit 34 gave the rules:
`CancelledError` inherits from `BaseException` so `except Exception` does not
catch it, cleanup goes in `finally`, and a worker that catches it must re-raise,
because one that swallows cancellation and returns normally lies to whoever
cancelled it. A crawler that cannot be stopped is worse than one that is slow.

@goal A slow fetch times out and retries, and a cancelled crawl stops and says so.

~~~starter
import asyncio
import collections
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01,
                 max_depth=None, max_frontier=None, timeout=None):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.max_depth = max_depth
        self.max_frontier = max_frontier
        self.depth = {}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.timeout = timeout
        self.timed_out = 0
        self.cancelled = False
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        queue = asyncio.Queue(maxsize=self.max_frontier or 0)
        self.seen = {root}
        self.pages = {}
        self.depth = {root: 0}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        # All of them, not the ones that came to mind. A crawler used twice
        # reported the first run's retries added to the second run's.
        self.retried = 0
        self.timed_out = 0
        self.blocked = []
        self.in_flight = 0
        self.peak_in_flight = 0
        self.cancelled = False
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            finally:
                self._drain(queue)
                queue.task_done()

    def _drain(self, queue):
        """Move deferred urls into the queue while there is room for them."""
        while self.deferred and not queue.full():
            queue.put_nowait(self.deferred.popleft())
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    def _enqueue(self, queue, url):
        """Queue a url, or hold it aside rather than blocking a worker.

        A bounded queue is what stops the frontier eating memory, and awaiting
        put() on a full one from inside a worker is a deadlock: every worker is
        blocked adding work and none is left to take any. Defer instead, and
        drain when there is room.
        """
        if queue.full():
            self.deferred.append(url)
        else:
            queue.put_nowait(url)
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        here = self.depth.get(url, 0)
        if self.max_depth is not None and here >= self.max_depth:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            self.seen.add(link)
            self.depth[link] = here + 1
            self._enqueue(queue, link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits."""
        for attempt in range(1, self.retries + 1):
            page = await self.fetcher.fetch(url)
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1
~~~

~~~tests
import asyncio

site = {
    "http://example.com/": '<a href="/slow">s</a><a href="/fast">f</a>',
    "http://example.com/slow": "",
    "http://example.com/fast": "",
}

# stage five still holds
crawler = Crawler(DictFetcher(site), max_depth=1)
assert len(asyncio.run(crawler.crawl("http://example.com/"))) == 3


class SlowOne(DictFetcher):
    """One page that never answers in time."""

    async def fetch(self, url):
        if url.endswith("/slow"):
            self.requested.append(url)
            await asyncio.sleep(10)
        return await super().fetch(url)


# without a timeout it would hang, so the test bounds the whole thing
crawler = Crawler(SlowOne(site), workers=2, timeout=0.05, retries=1)
pages = asyncio.run(asyncio.wait_for(crawler.crawl("http://example.com/"), timeout=5))

assert len(pages) == 3
assert crawler.timed_out >= 1
slow = pages["http://example.com/slow"]
assert not slow.ok and "timed out" in slow.error

# the fast page is unaffected
assert pages["http://example.com/fast"].ok

# a timeout retries, because it may not happen again
crawler = Crawler(SlowOne(site), workers=2, timeout=0.02, retries=3, backoff=0.0)
asyncio.run(asyncio.wait_for(crawler.crawl("http://example.com/"), timeout=5))
assert crawler.timed_out == 3, f"a timeout should retry: {crawler.timed_out}"

# with no timeout set, nothing is bounded and a quick site is unaffected
plain = Crawler(DictFetcher(site), workers=2)
assert len(asyncio.run(plain.crawl("http://example.com/"))) == 3
assert plain.timed_out == 0

# cancelling a crawl stops it, and it says so rather than pretending
async def cancel_test():
    crawler = Crawler(DictFetcher(site, delay=0.05), workers=2)
    task = asyncio.create_task(crawler.crawl("http://example.com/"))
    await asyncio.sleep(0.01)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        return crawler
    raise AssertionError("a cancelled crawl must not return normally")


crawler = asyncio.run(cancel_test())
assert crawler.cancelled, "the workers should have noticed the cancellation"

# and it stopped early rather than quietly running to the end
assert len(crawler.pages) < len(site), "a cancelled crawl should not finish"

# a timeout around the whole crawl works too, which is the outer bound
async def outer_timeout():
    crawler = Crawler(DictFetcher(site, delay=0.05), workers=1)
    try:
        async with asyncio.timeout(0.02):
            await crawler.crawl("http://example.com/")
    except TimeoutError:
        return True
    return False


assert asyncio.run(outer_timeout()), "an outer timeout should stop the crawl"
~~~

~~~solution
import asyncio
import collections
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01,
                 max_depth=None, max_frontier=None, timeout=None):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.max_depth = max_depth
        self.max_frontier = max_frontier
        self.depth = {}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.timeout = timeout
        self.timed_out = 0
        self.cancelled = False
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        queue = asyncio.Queue(maxsize=self.max_frontier or 0)
        self.seen = {root}
        self.pages = {}
        self.depth = {root: 0}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        # All of them, not the ones that came to mind. A crawler used twice
        # reported the first run's retries added to the second run's.
        self.retried = 0
        self.timed_out = 0
        self.blocked = []
        self.in_flight = 0
        self.peak_in_flight = 0
        self.cancelled = False
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            except asyncio.CancelledError:
                # Unit 34: note it and re-raise. A worker that swallows
                # cancellation lies to whoever cancelled it.
                self.cancelled = True
                queue.task_done()
                raise
            finally:
                self._drain(queue)
            queue.task_done()

    def _drain(self, queue):
        """Move deferred urls into the queue while there is room for them."""
        while self.deferred and not queue.full():
            queue.put_nowait(self.deferred.popleft())
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    def _enqueue(self, queue, url):
        """Queue a url, or hold it aside rather than blocking a worker.

        A bounded queue is what stops the frontier eating memory, and awaiting
        put() on a full one from inside a worker is a deadlock: every worker is
        blocked adding work and none is left to take any. Defer instead, and
        drain when there is room.
        """
        if queue.full():
            self.deferred.append(url)
        else:
            queue.put_nowait(url)
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        here = self.depth.get(url, 0)
        if self.max_depth is not None and here >= self.max_depth:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            self.seen.add(link)
            self.depth[link] = here + 1
            self._enqueue(queue, link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits.

        A timeout is a failure like any other and retries like one, because a
        request that took too long once may not the next time.
        """
        for attempt in range(1, self.retries + 1):
            try:
                if self.timeout is None:
                    page = await self.fetcher.fetch(url)
                else:
                    async with asyncio.timeout(self.timeout):
                        page = await self.fetcher.fetch(url)
            except TimeoutError:
                self.timed_out += 1
                page = Page(url, 0, error=f"timed out after {self.timeout}s")
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1
~~~

## Asking whether you are welcome

`robots.txt` is a convention, not an enforcement, and honouring it is what makes
a crawler something people tolerate. It is a small format: `User-agent` blocks,
`Allow` and `Disallow` paths, and optionally a `Crawl-delay`.

Two rules people get wrong. **Longest match wins**, so a specific `Allow` beats a
general `Disallow` and the order of the lines does not matter. And a site with no
`robots.txt`, or one that cannot be fetched, is **permission**: the absence of a
rule is not a rule, and a crawler that treats a 404 as a prohibition will refuse
to crawl most of the internet.

Fetch it once per host, before anything else, and let a declared `Crawl-delay`
become the rate limit from the previous stage. That is the whole point of having
built the limiter as a separate object.

The start url needs checking too, and it is the one that gets missed. Every
other url arrives as a link on a page, so a check inside the loop over links
covers all of them and none of the first. A site whose `robots.txt` says
`Disallow: /` would then have exactly one page fetched: the one it named.

@goal `robots.txt` is honoured, longest match wins, and a crawl delay sets the rate.

~~~starter
import asyncio
import collections
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01,
                 max_depth=None, max_frontier=None, timeout=None,
                 obey_robots=False, agent="*"):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.max_depth = max_depth
        self.max_frontier = max_frontier
        self.depth = {}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.timeout = timeout
        self.timed_out = 0
        self.cancelled = False
        self.obey_robots = obey_robots
        self.agent = agent
        self.robots = None
        self.blocked = []
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def _load_robots(self, root):
        """Fetch robots.txt once, and treat anything unreadable as permission."""
        raise NotImplementedError

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        queue = asyncio.Queue(maxsize=self.max_frontier or 0)
        self.seen = {root}
        self.pages = {}
        self.depth = {root: 0}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        # All of them, not the ones that came to mind. A crawler used twice
        # reported the first run's retries added to the second run's.
        self.retried = 0
        self.timed_out = 0
        self.blocked = []
        self.in_flight = 0
        self.peak_in_flight = 0
        self.cancelled = False
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            except asyncio.CancelledError:
                # Unit 34: note it and re-raise. A worker that swallows
                # cancellation lies to whoever cancelled it.
                self.cancelled = True
                queue.task_done()
                raise
            finally:
                self._drain(queue)
            queue.task_done()

    def _drain(self, queue):
        """Move deferred urls into the queue while there is room for them."""
        while self.deferred and not queue.full():
            queue.put_nowait(self.deferred.popleft())
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    def _enqueue(self, queue, url):
        """Queue a url, or hold it aside rather than blocking a worker.

        A bounded queue is what stops the frontier eating memory, and awaiting
        put() on a full one from inside a worker is a deadlock: every worker is
        blocked adding work and none is left to take any. Defer instead, and
        drain when there is room.
        """
        if queue.full():
            self.deferred.append(url)
        else:
            queue.put_nowait(url)
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        here = self.depth.get(url, 0)
        if self.max_depth is not None and here >= self.max_depth:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            self.seen.add(link)
            self.depth[link] = here + 1
            self._enqueue(queue, link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits.

        A timeout is a failure like any other and retries like one, because a
        request that took too long once may not the next time.
        """
        for attempt in range(1, self.retries + 1):
            try:
                if self.timeout is None:
                    page = await self.fetcher.fetch(url)
                else:
                    async with asyncio.timeout(self.timeout):
                        page = await self.fetcher.fetch(url)
            except TimeoutError:
                self.timed_out += 1
                page = Page(url, 0, error=f"timed out after {self.timeout}s")
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1


class Robots:
    """What a site's robots.txt allows, for one user agent."""

    def __init__(self, text="", agent="*"):
        self.rules = []
        self.crawl_delay = None
        self.parse(text, agent)

    def parse(self, text, agent="*"):
        """Read the rules that apply to this agent."""
        raise NotImplementedError

    def allows(self, url):
        """Whether this url may be fetched."""
        raise NotImplementedError
~~~

~~~tests
import asyncio

# a plain file
robots = Robots("User-agent: *\nDisallow: /private\n")
assert robots.allows("http://example.com/")
assert robots.allows("http://example.com/public")
assert not robots.allows("http://example.com/private")
assert not robots.allows("http://example.com/private/deep")

# no file at all is permission, not prohibition
assert Robots("").allows("http://example.com/anything")
assert Robots("").allows("http://example.com/private")

# longest match wins, whatever order the lines are in
rules = "User-agent: *\nDisallow: /docs\nAllow: /docs/public\n"
robots = Robots(rules)
assert not robots.allows("http://example.com/docs/secret")
assert robots.allows("http://example.com/docs/public/one")

reversed_rules = "User-agent: *\nAllow: /docs/public\nDisallow: /docs\n"
assert Robots(reversed_rules).allows("http://example.com/docs/public/one")

# blank lines and comments are ignored
assert not Robots("# a comment\n\nUser-agent: *\nDisallow: /x  # trailing\n").allows(
    "http://example.com/x"
)

# a block for a named agent wins over the wildcard
text = ("User-agent: *\nDisallow: /\n\n"
        "User-agent: friendly\nDisallow: /admin\n")
assert Robots(text, agent="friendly").allows("http://example.com/anything")
assert not Robots(text, agent="friendly").allows("http://example.com/admin")
assert not Robots(text, agent="other").allows("http://example.com/anything")

# a crawl delay is read
assert Robots("User-agent: *\nCrawl-delay: 0.5\n").crawl_delay == 0.5
assert Robots("User-agent: *\n").crawl_delay is None
assert Robots("User-agent: *\nCrawl-delay: soon\n").crawl_delay is None

# and the crawler honours it
site = {
    "http://example.com/robots.txt": "User-agent: *\nDisallow: /private\n",
    "http://example.com/": '<a href="/public">p</a><a href="/private">x</a>',
    "http://example.com/public": "",
    "http://example.com/private": "",
}

crawler = Crawler(DictFetcher(site), obey_robots=True)
pages = asyncio.run(crawler.crawl("http://example.com/"))
assert "http://example.com/private" not in pages, sorted(pages)
assert "http://example.com/public" in pages
assert "http://example.com/private" in crawler.blocked

# and the disallowed page is never even requested
assert "http://example.com/private" not in crawler.fetcher.requested

# with robots off, everything is fetched
loose = Crawler(DictFetcher(site))
pages = asyncio.run(loose.crawl("http://example.com/"))
assert "http://example.com/private" in pages

# the start url is checked too. it was never found on a page, so the check on
# discovered links never sees it, and a site that forbids everything would
# otherwise have the one page it named fetched anyway
forbidding = {
    "http://example.com/robots.txt": "User-agent: *\nDisallow: /\n",
    "http://example.com/": '<a href="/public">p</a>',
    "http://example.com/public": "",
}
crawler = Crawler(DictFetcher(forbidding), obey_robots=True)
assert asyncio.run(crawler.crawl("http://example.com/")) == {}
assert crawler.blocked == ["http://example.com/"]
assert "http://example.com/" not in crawler.fetcher.requested

# and with robots off the same site is crawled
loose = Crawler(DictFetcher(forbidding))
assert len(asyncio.run(loose.crawl("http://example.com/"))) == 2

# a site with no robots.txt is crawled in full
bare = {k: v for k, v in site.items() if not k.endswith("robots.txt")}
crawler = Crawler(DictFetcher(bare), obey_robots=True)
pages = asyncio.run(crawler.crawl("http://example.com/"))
assert len(pages) == 3, sorted(pages)

# robots.txt is fetched once, not once per page
crawler = Crawler(DictFetcher(site), obey_robots=True, workers=3)
asyncio.run(crawler.crawl("http://example.com/"))
assert crawler.fetcher.requested.count("http://example.com/robots.txt") == 1

# a declared crawl delay becomes the rate limit
delayed = dict(site)
delayed["http://example.com/robots.txt"] = "User-agent: *\nCrawl-delay: 0.001\n"
crawler = Crawler(DictFetcher(delayed), obey_robots=True)
asyncio.run(crawler.crawl("http://example.com/"))
assert crawler.limiter is not None, "a crawl delay should have set a rate limit"
~~~

~~~solution
import asyncio
import collections
import contextlib
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01,
                 max_depth=None, max_frontier=None, timeout=None,
                 obey_robots=False, agent="*"):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.max_depth = max_depth
        self.max_frontier = max_frontier
        self.depth = {}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.timeout = timeout
        self.timed_out = 0
        self.cancelled = False
        self.obey_robots = obey_robots
        self.agent = agent
        self.robots = None
        self.blocked = []
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    async def _load_robots(self, root):
        """Fetch robots.txt once, and treat anything unreadable as permission."""
        page = await self.fetcher.fetch(urljoin(root, "/robots.txt"))
        self.robots = Robots(page.body if page.ok else "", self.agent)
        if self.robots.crawl_delay and self.limiter is None:
            self.limiter = RateLimiter(rate=1 / self.robots.crawl_delay, burst=1)

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        # Everything a crawl accumulates, cleared before anything can add to
        # it. All of it, rather than the parts that came to mind: half of these
        # used to carry over, so a crawler used twice reported the first run's
        # retries added to the second run's and called it one number.
        self.seen = {root}
        self.pages = {}
        self.depth = {root: 0}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.retried = 0
        self.timed_out = 0
        self.blocked = []
        self.in_flight = 0
        self.peak_in_flight = 0
        self.cancelled = False

        if self.obey_robots:
            await self._load_robots(root)
            if not self.robots.allows(root):
                # The check further down runs on links found on a page. The
                # start url was never found on a page, so without this the one
                # url a site explicitly forbade is the one always fetched.
                self.blocked.append(root)
                return self.pages

        queue = asyncio.Queue(maxsize=self.max_frontier or 0)
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            except asyncio.CancelledError:
                # Unit 34: note it and re-raise. A worker that swallows
                # cancellation lies to whoever cancelled it.
                self.cancelled = True
                queue.task_done()
                raise
            finally:
                self._drain(queue)
            queue.task_done()

    def _drain(self, queue):
        """Move deferred urls into the queue while there is room for them."""
        while self.deferred and not queue.full():
            queue.put_nowait(self.deferred.popleft())
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    def _enqueue(self, queue, url):
        """Queue a url, or hold it aside rather than blocking a worker.

        A bounded queue is what stops the frontier eating memory, and awaiting
        put() on a full one from inside a worker is a deadlock: every worker is
        blocked adding work and none is left to take any. Defer instead, and
        drain when there is room.
        """
        if queue.full():
            self.deferred.append(url)
        else:
            queue.put_nowait(url)
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        here = self.depth.get(url, 0)
        if self.max_depth is not None and here >= self.max_depth:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            if self.robots is not None and not self.robots.allows(link):
                self.seen.add(link)
                self.blocked.append(link)
                continue
            self.seen.add(link)
            self.depth[link] = here + 1
            self._enqueue(queue, link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits.

        A timeout is a failure like any other and retries like one, because a
        request that took too long once may not the next time.
        """
        for attempt in range(1, self.retries + 1):
            try:
                if self.timeout is None:
                    page = await self.fetcher.fetch(url)
                else:
                    async with asyncio.timeout(self.timeout):
                        page = await self.fetcher.fetch(url)
            except TimeoutError:
                self.timed_out += 1
                page = Page(url, 0, error=f"timed out after {self.timeout}s")
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1


class Robots:
    """What a site's robots.txt allows, for one user agent.

    Longest-match wins, which is what the standard says and what every crawler
    implements: a specific Allow beats a general Disallow.
    """

    def __init__(self, text="", agent="*"):
        self.rules = []
        self.crawl_delay = None
        self.parse(text, agent)

    def parse(self, text, agent="*"):
        applies = False
        matched_specific = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            key, _, value = line.partition(":")
            key, value = key.strip().lower(), value.strip()
            if key == "user-agent":
                if value.lower() == agent.lower():
                    applies, matched_specific = True, True
                    self.rules.clear()
                elif value == "*" and not matched_specific:
                    applies = True
                else:
                    applies = False
            elif applies and key in ("allow", "disallow") and value:
                self.rules.append((value, key == "allow"))
            elif applies and key == "crawl-delay":
                with contextlib.suppress(ValueError):
                    self.crawl_delay = float(value)

    def allows(self, url):
        """Whether this url may be fetched."""
        path = urlparse(url).path or "/"
        best, allowed = -1, True
        for pattern, is_allow in self.rules:
            if path.startswith(pattern) and len(pattern) > best:
                best, allowed = len(pattern), is_allow
        return allowed
~~~

## Handing results back before the end

Everything so far returns one dictionary when the crawl is over. For a site of
ten pages that is fine. For ten thousand it means holding every page in memory
and showing the caller nothing until the last one lands.

An async generator fixes both. Unit 34 covered the shape: an `async def` with a
`yield` in it, consumed with `async for`. The trick is that the crawl and the
yielding have to happen at once, so the crawl runs as a task while the generator
waits on a queue of finished pages and hands each one out as it arrives.

`asyncio.wait` with `FIRST_COMPLETED` is how you wait for either the next page or
the end of the crawl, whichever comes first. Without it the generator would block
on a queue that no one is going to fill.

Then a report, because a crawler that cannot tell you what it did is a crawler
you cannot trust. Every counter the earlier stages added is already there.

@goal Pages stream out as they land, and the crawl can say what it did.

~~~starter
import asyncio
import collections
import contextlib
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


@dataclass
class Report:
    """What one crawl did, in numbers."""

    pages: int = 0
    ok: int = 0
    failed: int = 0
    blocked: int = 0
    retried: int = 0
    timed_out: int = 0
    peak_in_flight: int = 0
    peak_frontier: int = 0
    hosts: dict = field(default_factory=dict)


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01,
                 max_depth=None, max_frontier=None, timeout=None,
                 obey_robots=False, agent="*"):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.max_depth = max_depth
        self.max_frontier = max_frontier
        self.depth = {}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.timeout = timeout
        self.timed_out = 0
        self.cancelled = False
        self.obey_robots = obey_robots
        self.agent = agent
        self.robots = None
        self.blocked = []
        self._out = None
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    def report(self):
        """What this crawl did, in numbers."""
        raise NotImplementedError

    async def crawl_stream(self, start):
        """Yield each page as it lands, instead of waiting for the whole crawl."""
        raise NotImplementedError
        yield  # this is what makes it a generator rather than a coroutine

    async def _load_robots(self, root):
        """Fetch robots.txt once, and treat anything unreadable as permission."""
        page = await self.fetcher.fetch(urljoin(root, "/robots.txt"))
        self.robots = Robots(page.body if page.ok else "", self.agent)
        if self.robots.crawl_delay and self.limiter is None:
            self.limiter = RateLimiter(rate=1 / self.robots.crawl_delay, burst=1)

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        # Everything a crawl accumulates, cleared before anything can add to
        # it. All of it, rather than the parts that came to mind: half of these
        # used to carry over, so a crawler used twice reported the first run's
        # retries added to the second run's and called it one number.
        self.seen = {root}
        self.pages = {}
        self.depth = {root: 0}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.retried = 0
        self.timed_out = 0
        self.blocked = []
        self.in_flight = 0
        self.peak_in_flight = 0
        self.cancelled = False

        if self.obey_robots:
            await self._load_robots(root)
            if not self.robots.allows(root):
                # The check further down runs on links found on a page. The
                # start url was never found on a page, so without this the one
                # url a site explicitly forbade is the one always fetched.
                self.blocked.append(root)
                return self.pages

        queue = asyncio.Queue(maxsize=self.max_frontier or 0)
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            except asyncio.CancelledError:
                # Unit 34: note it and re-raise. A worker that swallows
                # cancellation lies to whoever cancelled it.
                self.cancelled = True
                queue.task_done()
                raise
            finally:
                self._drain(queue)
            queue.task_done()

    def _drain(self, queue):
        """Move deferred urls into the queue while there is room for them."""
        while self.deferred and not queue.full():
            queue.put_nowait(self.deferred.popleft())
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    def _enqueue(self, queue, url):
        """Queue a url, or hold it aside rather than blocking a worker.

        A bounded queue is what stops the frontier eating memory, and awaiting
        put() on a full one from inside a worker is a deadlock: every worker is
        blocked adding work and none is left to take any. Defer instead, and
        drain when there is room.
        """
        if queue.full():
            self.deferred.append(url)
        else:
            queue.put_nowait(url)
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if not page.ok:
            return
        here = self.depth.get(url, 0)
        if self.max_depth is not None and here >= self.max_depth:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            if self.robots is not None and not self.robots.allows(link):
                self.seen.add(link)
                self.blocked.append(link)
                continue
            self.seen.add(link)
            self.depth[link] = here + 1
            self._enqueue(queue, link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits.

        A timeout is a failure like any other and retries like one, because a
        request that took too long once may not the next time.
        """
        for attempt in range(1, self.retries + 1):
            try:
                if self.timeout is None:
                    page = await self.fetcher.fetch(url)
                else:
                    async with asyncio.timeout(self.timeout):
                        page = await self.fetcher.fetch(url)
            except TimeoutError:
                self.timed_out += 1
                page = Page(url, 0, error=f"timed out after {self.timeout}s")
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1


class Robots:
    """What a site's robots.txt allows, for one user agent.

    Longest-match wins, which is what the standard says and what every crawler
    implements: a specific Allow beats a general Disallow.
    """

    def __init__(self, text="", agent="*"):
        self.rules = []
        self.crawl_delay = None
        self.parse(text, agent)

    def parse(self, text, agent="*"):
        applies = False
        matched_specific = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            key, _, value = line.partition(":")
            key, value = key.strip().lower(), value.strip()
            if key == "user-agent":
                if value.lower() == agent.lower():
                    applies, matched_specific = True, True
                    self.rules.clear()
                elif value == "*" and not matched_specific:
                    applies = True
                else:
                    applies = False
            elif applies and key in ("allow", "disallow") and value:
                self.rules.append((value, key == "allow"))
            elif applies and key == "crawl-delay":
                with contextlib.suppress(ValueError):
                    self.crawl_delay = float(value)

    def allows(self, url):
        """Whether this url may be fetched."""
        path = urlparse(url).path or "/"
        best, allowed = -1, True
        for pattern, is_allow in self.rules:
            if path.startswith(pattern) and len(pattern) > best:
                best, allowed = len(pattern), is_allow
        return allowed
~~~

~~~tests
import asyncio

site = {
    "http://example.com/robots.txt": "User-agent: *\nDisallow: /private\n",
    "http://example.com/": (
        '<a href="/a">a</a><a href="/b">b</a>'
        '<a href="/private">x</a><a href="http://other.com/z">z</a>'
    ),
    "http://example.com/a": '<a href="/c">c</a>',
    "http://example.com/b": "",
    "http://example.com/c": "",
    "http://example.com/private": "",
}

# every earlier stage still holds
crawler = Crawler(DictFetcher(site), obey_robots=True)
pages = asyncio.run(crawler.crawl("http://example.com/"))
assert len(pages) == 4, sorted(pages)


async def collect(crawler, url):
    seen = []
    async for page in crawler.crawl_stream(url):
        seen.append(page)
    return seen


# the stream yields the same pages the batch crawl found
crawler = Crawler(DictFetcher(site), obey_robots=True)
streamed = asyncio.run(collect(crawler, "http://example.com/"))
assert len(streamed) == 4, [p.url for p in streamed]
assert {p.url for p in streamed} == set(pages)
assert streamed[0].url == "http://example.com/"

# and they arrive early, not all at the end
async def first_arrival():
    crawler = Crawler(DictFetcher(site, delay=0.02), workers=1, obey_robots=True)
    stream = crawler.crawl_stream("http://example.com/")
    first = await anext(stream)
    remaining = len(crawler.pages)
    await stream.aclose()
    return first, remaining


first, remaining = asyncio.run(first_arrival())
assert first.url == "http://example.com/"
assert remaining < 4, f"the first page arrived only after {remaining} were done"

# closing the stream early stops the crawl rather than leaking a task
async def leak_check():
    crawler = Crawler(DictFetcher(site, delay=0.02), obey_robots=True)
    stream = crawler.crawl_stream("http://example.com/")
    await anext(stream)
    await stream.aclose()
    await asyncio.sleep(0.05)
    return [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]


assert asyncio.run(leak_check()) == [], "closing the stream should stop the crawl"

# a bad start url still fails the caller, through the stream too
async def bad_start():
    crawler = Crawler(DictFetcher(site))
    async for _ in crawler.crawl_stream("mailto:nobody@example.com"):
        pass


try:
    asyncio.run(bad_start())
except ValueError:
    pass
else:
    raise AssertionError("a bad start url should raise through the stream")

# the report counts what happened
crawler = Crawler(DictFetcher(site), obey_robots=True)
asyncio.run(crawler.crawl("http://example.com/"))
report = crawler.report()
assert report.pages == 4
assert report.ok == 4
assert report.failed == 0
assert report.blocked == 1
assert report.hosts == {"example.com": 4}, report.hosts
assert report.peak_in_flight >= 1

# failures are counted as failures
fetcher = DictFetcher(site, fail=["http://example.com/b"])
crawler = Crawler(fetcher, obey_robots=True, retries=1)
asyncio.run(crawler.crawl("http://example.com/"))
report = crawler.report()
assert report.pages == 4 and report.ok == 3 and report.failed == 1

# a crawler used twice reports the second run, not the two added together
reused = Crawler(DictFetcher(site, fail=["http://example.com/b"]),
                 obey_robots=True, retries=2, backoff=0.0)
asyncio.run(reused.crawl("http://example.com/"))
first = (reused.retried, reused.report().blocked, reused.peak_in_flight)
asyncio.run(reused.crawl("http://example.com/"))
assert (reused.retried, reused.report().blocked, reused.peak_in_flight) == first, (
    f"the counters carried over: {first} then "
    f"{(reused.retried, reused.report().blocked, reused.peak_in_flight)}"
)
assert reused.retried > 0, "and the run being compared actually did something"

# and it reads as something a person would want to look at
text = str(report)
assert "4 pages" in text and "1 blocked" in text, text
assert "example.com 4" in text, text
~~~

~~~solution
import asyncio
import collections
import contextlib
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


@dataclass
class Page:
    """One fetched page."""

    url: str
    status: int
    body: str = ""
    links: list = field(default_factory=list)
    error: str = ""

    @property
    def ok(self):
        return self.error == "" and 200 <= self.status < 300


@dataclass
class Report:
    """What one crawl did, in numbers."""

    pages: int = 0
    ok: int = 0
    failed: int = 0
    blocked: int = 0
    retried: int = 0
    timed_out: int = 0
    peak_in_flight: int = 0
    peak_frontier: int = 0
    hosts: dict = field(default_factory=dict)

    def __str__(self):
        hosts = ", ".join(f"{h} {n}" for h, n in sorted(self.hosts.items()))
        return (
            f"{self.pages} pages, {self.ok} ok, {self.failed} failed\n"
            f"{self.blocked} blocked by robots, {self.retried} retries, "
            f"{self.timed_out} timeouts\n"
            f"peak {self.peak_in_flight} in flight, {self.peak_frontier} queued\n"
            f"hosts: {hosts}"
        )


def normalise(url, base=None):
    """One canonical form per page, so the same page is not fetched twice."""
    if base is not None:
        url = urljoin(base, url)
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    host = parts.netloc.lower()
    if host.endswith(":80") and parts.scheme == "http":
        host = host[:-3]
    if host.endswith(":443") and parts.scheme == "https":
        host = host[:-4]
    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme}://{host}{path}{query}"


def same_host(url, other):
    """Whether two urls are on the same host."""
    return urlparse(url).netloc.lower() == urlparse(other).netloc.lower()


class LinkFinder(HTMLParser):
    """Every href on a page. A parser, because unit 37 said why not a regex."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                self.links.append(value)


def find_links(html, base):
    """Every crawlable link on a page, normalised, with duplicates removed."""
    finder = LinkFinder()
    finder.feed(html)
    # HTMLParser holds a trailing incomplete tag in its buffer until close(),
    # so without this a response cut off mid-tag quietly loses its last link,
    # which is an ordinary thing for a crawler to be handed.
    finder.close()
    seen = {}
    for href in finder.links:
        url = normalise(href, base)
        if url is not None:
            seen[url] = None          # a dict keeps insertion order, a set does not
    return list(seen)


class Fetcher:
    """Something that can fetch a url. The test double and the real one agree."""

    async def fetch(self, url):
        raise NotImplementedError


class DictFetcher(Fetcher):
    """Pages from a mapping, with an optional delay, for tests."""

    def __init__(self, pages, delay=0.0, fail=()):
        self.pages = pages
        self.delay = delay
        self.fail = set(fail)
        self.requested = []

    async def fetch(self, url):
        self.requested.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if url in self.fail:
            return Page(url, 0, error="connection refused")
        if url not in self.pages:
            return Page(url, 404)
        html = self.pages[url]
        return Page(url, 200, html, find_links(html, url))


class Crawler:
    """Fetches a site with a fixed number of workers."""

    def __init__(self, fetcher, workers=4, max_pages=None, same_host_only=True,
                 concurrency=None, limiter=None, retries=1, backoff=0.01,
                 max_depth=None, max_frontier=None, timeout=None,
                 obey_robots=False, agent="*"):
        self.fetcher = fetcher
        self.workers = workers
        self.max_pages = max_pages
        self.same_host_only = same_host_only
        self.gate = asyncio.Semaphore(concurrency or workers)
        self.limiter = limiter
        if retries < 1:
            raise ValueError(f"retries={retries} would never fetch anything")
        self.retries = retries
        self.backoff = backoff
        self.retried = 0
        self.max_depth = max_depth
        self.max_frontier = max_frontier
        self.depth = {}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.timeout = timeout
        self.timed_out = 0
        self.cancelled = False
        self.obey_robots = obey_robots
        self.agent = agent
        self.robots = None
        self.blocked = []
        self._out = None
        self.seen = set()
        self.pages = {}
        self.in_flight = 0
        self.peak_in_flight = 0

    def report(self):
        """What this crawl did, in numbers."""
        hosts = collections.Counter(urlparse(u).netloc for u in self.pages)
        return Report(
            pages=len(self.pages),
            ok=sum(1 for p in self.pages.values() if p.ok),
            failed=sum(1 for p in self.pages.values() if not p.ok),
            blocked=len(self.blocked),
            retried=self.retried,
            timed_out=self.timed_out,
            peak_in_flight=self.peak_in_flight,
            peak_frontier=self.peak_frontier,
            hosts=dict(hosts),
        )

    async def crawl_stream(self, start):
        """Yield each page as it lands, instead of waiting for the whole crawl."""
        self._out = asyncio.Queue()
        crawl = asyncio.create_task(self.crawl(start))
        try:
            while True:
                getter = asyncio.create_task(self._out.get())
                done, _ = await asyncio.wait(
                    {getter, crawl}, return_when=asyncio.FIRST_COMPLETED
                )
                if getter in done:
                    yield getter.result()
                    continue
                getter.cancel()
                while not self._out.empty():
                    yield self._out.get_nowait()
                await crawl  # so a failed crawl fails the caller too
                return
        finally:
            self._out = None
            if not crawl.done():
                crawl.cancel()

    async def _load_robots(self, root):
        """Fetch robots.txt once, and treat anything unreadable as permission."""
        page = await self.fetcher.fetch(urljoin(root, "/robots.txt"))
        self.robots = Robots(page.body if page.ok else "", self.agent)
        if self.robots.crawl_delay and self.limiter is None:
            self.limiter = RateLimiter(rate=1 / self.robots.crawl_delay, burst=1)

    async def crawl(self, start):
        """Every page reachable from `start`, as a mapping of url to Page."""
        root = normalise(start)
        if root is None:
            raise ValueError(f"{start!r} is not a crawlable url")
        # Everything a crawl accumulates, cleared before anything can add to
        # it. All of it, rather than the parts that came to mind: half of these
        # used to carry over, so a crawler used twice reported the first run's
        # retries added to the second run's and called it one number.
        self.seen = {root}
        self.pages = {}
        self.depth = {root: 0}
        self.deferred = collections.deque()
        self.peak_frontier = 0
        self.retried = 0
        self.timed_out = 0
        self.blocked = []
        self.in_flight = 0
        self.peak_in_flight = 0
        self.cancelled = False

        if self.obey_robots:
            await self._load_robots(root)
            if not self.robots.allows(root):
                # The check further down runs on links found on a page. The
                # start url was never found on a page, so without this the one
                # url a site explicitly forbade is the one always fetched.
                self.blocked.append(root)
                return self.pages

        queue = asyncio.Queue(maxsize=self.max_frontier or 0)
        await queue.put(root)

        async with asyncio.TaskGroup() as group:
            for _ in range(self.workers):
                group.create_task(self._worker(queue, root))
            await queue.join()
            # Every worker is now idle on queue.get(). Cancelling them is how a
            # worker pool with no sentinel ends, and the TaskGroup would
            # otherwise wait for tasks that will never finish.
            for task in group._tasks:
                task.cancel()
        return self.pages

    async def _worker(self, queue, root):
        while True:
            url = await queue.get()
            try:
                await self._visit(url, queue, root)
            except asyncio.CancelledError:
                # Unit 34: note it and re-raise. A worker that swallows
                # cancellation lies to whoever cancelled it.
                self.cancelled = True
                queue.task_done()
                raise
            finally:
                self._drain(queue)
            queue.task_done()

    def _drain(self, queue):
        """Move deferred urls into the queue while there is room for them."""
        while self.deferred and not queue.full():
            queue.put_nowait(self.deferred.popleft())
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    def _enqueue(self, queue, url):
        """Queue a url, or hold it aside rather than blocking a worker.

        A bounded queue is what stops the frontier eating memory, and awaiting
        put() on a full one from inside a worker is a deadlock: every worker is
        blocked adding work and none is left to take any. Defer instead, and
        drain when there is room.
        """
        if queue.full():
            self.deferred.append(url)
        else:
            queue.put_nowait(url)
        self.peak_frontier = max(self.peak_frontier, queue.qsize() + len(self.deferred))

    async def _visit(self, url, queue, root):
        if self.limiter is not None:
            await self.limiter.acquire()
        async with self.gate:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            try:
                page = await self._fetch_with_retries(url)
            finally:
                self.in_flight -= 1
        self.pages[url] = page
        if self._out is not None:
            self._out.put_nowait(page)
        if not page.ok:
            return
        here = self.depth.get(url, 0)
        if self.max_depth is not None and here >= self.max_depth:
            return
        for link in page.links:
            if self.max_pages is not None and len(self.seen) >= self.max_pages:
                return
            if link in self.seen:
                continue
            if self.same_host_only and not same_host(link, root):
                continue
            if self.robots is not None and not self.robots.allows(link):
                self.seen.add(link)
                self.blocked.append(link)
                continue
            self.seen.add(link)
            self.depth[link] = here + 1
            self._enqueue(queue, link)

    async def _fetch_with_retries(self, url):
        """Fetch, retrying a failure a few times with growing waits.

        A timeout is a failure like any other and retries like one, because a
        request that took too long once may not the next time.
        """
        for attempt in range(1, self.retries + 1):
            try:
                if self.timeout is None:
                    page = await self.fetcher.fetch(url)
                else:
                    async with asyncio.timeout(self.timeout):
                        page = await self.fetcher.fetch(url)
            except TimeoutError:
                self.timed_out += 1
                page = Page(url, 0, error=f"timed out after {self.timeout}s")
            if page.ok or page.status == 404 or attempt == self.retries:
                return page
            self.retried += 1
            await asyncio.sleep(self.backoff * 2 ** (attempt - 1))
        return page


class RateLimiter:
    """At most `rate` starts per second, shared by every worker.

    A token bucket: tokens accumulate at a fixed rate up to a burst, and a
    request waits until one is available. The lock is what makes it a shared
    limit rather than one per worker, which is the whole point.
    """

    def __init__(self, rate, burst=1, clock=None):
        if rate <= 0:
            raise ValueError("rate must be above zero")
        self.rate = rate
        self.burst = max(1, burst)
        self.tokens = float(self.burst)
        self.clock = clock or (lambda: asyncio.get_running_loop().time())
        self.updated = None
        self.lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self):
        async with self.lock:
            now = self.clock()
            if self.updated is None:
                self.updated = now
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens < 1:
                delay = (1 - self.tokens) / self.rate
                self.waits += 1
                await asyncio.sleep(delay)
                self.tokens = 0.0
                self.updated = self.clock()
            else:
                self.tokens -= 1


class Robots:
    """What a site's robots.txt allows, for one user agent.

    Longest-match wins, which is what the standard says and what every crawler
    implements: a specific Allow beats a general Disallow.
    """

    def __init__(self, text="", agent="*"):
        self.rules = []
        self.crawl_delay = None
        self.parse(text, agent)

    def parse(self, text, agent="*"):
        applies = False
        matched_specific = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            key, _, value = line.partition(":")
            key, value = key.strip().lower(), value.strip()
            if key == "user-agent":
                if value.lower() == agent.lower():
                    applies, matched_specific = True, True
                    self.rules.clear()
                elif value == "*" and not matched_specific:
                    applies = True
                else:
                    applies = False
            elif applies and key in ("allow", "disallow") and value:
                self.rules.append((value, key == "allow"))
            elif applies and key == "crawl-delay":
                with contextlib.suppress(ValueError):
                    self.crawl_delay = float(value)

    def allows(self, url):
        """Whether this url may be fetched."""
        path = urlparse(url).path or "/"
        best, allowed = -1, True
        for pattern, is_allow in self.rules:
            if path.startswith(pattern) and len(pattern) > best:
                best, allowed = len(pattern), is_allow
        return allowed
~~~
