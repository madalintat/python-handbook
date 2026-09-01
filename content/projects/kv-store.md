---
slug: kv-store
---

## A record you can trust

Before there is a store there has to be a record, and a record has to survive
being read back by a program that did not write it. That means it has to say
how long it is, and it has to carry enough information to tell a reader that
something went wrong.

Length prefixes rather than delimiters, because a value is arbitrary bytes and
there is no byte that cannot appear inside one. A newline-delimited format
needs escaping, and once every value is escaped, the length you wrote in the
header is no longer the length on disk.

The checksum goes over the body rather than the whole record, and `zlib.crc32`
is what the standard library already gives you. It does not have to resist an
attacker, it has to notice a disk that returned the wrong sector or a write
that stopped halfway.

@goal `encode` and `decode` round trip any bytes, and refuse anything damaged.

~~~starter
import struct
import zlib

HEADER = struct.Struct("<III")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


def encode(key, value):
    """One key and value as a self-describing run of bytes."""
    raise NotImplementedError


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next."""
    raise NotImplementedError
~~~

~~~tests
import zlib

# a value comes back exactly as it went in
assert decode(encode(b"a", b"one"))[:2] == (b"a", b"one")

# including the bytes a line-based format would choke on
awkward = b"line\nbreak\x00null\r\nand \xff\xfe high bytes"
assert decode(encode(b"k", awkward))[:2] == (b"k", awkward)

# empty is a value like any other
assert decode(encode(b"", b""))[:2] == (b"", b"")
assert decode(encode(b"k", b""))[:2] == (b"k", b"")

# a long one, because the header has to carry a real length
big = b"x" * 100_000
assert decode(encode(b"k", big))[1] == big

# records sit back to back, and end says where the next one starts
buf = encode(b"a", b"1") + encode(b"b", b"22") + encode(b"c", b"333")
found = []
offset = 0
while offset < len(buf):
    key, value, offset = decode(buf, offset)
    found.append((key, value))
assert found == [(b"a", b"1"), (b"b", b"22"), (b"c", b"333")], found

# the header is fixed width, so one more byte of value is one more byte of record
assert len(encode(b"k", b"vv")) - len(encode(b"k", b"v")) == 1
assert len(encode(b"kk", b"v")) - len(encode(b"k", b"v")) == 1

# a record cut short is caught rather than read past
whole = encode(b"key", b"value")
for cut in range(1, len(whole)):
    try:
        decode(whole[:cut])
    except CorruptRecord:
        pass
    else:
        raise AssertionError(f"reading {cut} of {len(whole)} bytes should not work")

# and so is a byte that changed underneath us
flipped = bytearray(whole)
flipped[-1] ^= 0xFF
try:
    decode(bytes(flipped))
except CorruptRecord:
    pass
else:
    raise AssertionError("a flipped byte should not decode")

# the checksum covers the body, so a corrupt body is caught even at full length
assert zlib.crc32(b"key" + b"value") != zlib.crc32(b"key" + b"valuf")

# decoding at an offset does not need the bytes before it to be a whole record
buf = b"junk" + encode(b"a", b"1")
assert decode(buf, 4)[:2] == (b"a", b"1")
~~~

~~~solution
import struct
import zlib

HEADER = struct.Struct("<III")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.
    """
    body = key + value
    return HEADER.pack(zlib.crc32(body), len(key), len(value)) + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise CorruptRecord(f"header cut short at offset {offset}")
    crc, klen, vlen = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise CorruptRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], body[klen:], end
~~~

## The log, and the index that points into it

Now the store. Writing is appending, which is the fastest thing a disk does and
the only thing that cannot damage what is already there. Reading is a seek to
an offset that memory remembers.

That split is the design. The index is a dictionary from key to offset, and it
holds a number rather than a value, so a store can index far more data than
fits in memory. Bitcask, which is Riak's storage engine, is exactly this and
little more.

Updating a key appends a new record and moves the index. The old bytes stay
where they are, dead but harmless, which is why the file only ever grows and
why a later stage has to deal with that.

Nothing is written down about the index, so opening a store means reading the
log from the start and letting later records win. One pass, and then the store
is ready.

@goal `Store` sets, gets, and rebuilds its index from the log when reopened.

~~~starter
import os
import struct
import zlib

HEADER = struct.Struct("<III")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.
    """
    body = key + value
    return HEADER.pack(zlib.crc32(body), len(key), len(value)) + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise CorruptRecord(f"header cut short at offset {offset}")
    crc, klen, vlen = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise CorruptRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], body[klen:], end


class Store:
    """An append-only log on disk, and an index in memory that points into it."""

    def __init__(self, path):
        self.path = path
        self.index = {}
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start."""
        raise NotImplementedError

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        raise NotImplementedError

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        raise NotImplementedError

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        raise NotImplementedError

    def close(self):
        self._file.close()
~~~

~~~tests
import os

# stage one still holds
assert decode(encode(b"a", b"one"))[:2] == (b"a", b"one")
buf = encode(b"a", b"1") + encode(b"b", b"22")
assert decode(buf, decode(buf)[2])[:2] == (b"b", b"22")

store = Store("one.db")
assert store.get(b"missing") is None
assert store.get(b"missing", b"fallback") == b"fallback"

store.set(b"name", b"ada")
store.set(b"lang", b"python")
assert store.get(b"name") == b"ada"
assert store.get(b"lang") == b"python"

# an overwrite appends rather than editing, so the file only grows
before = os.path.getsize("one.db")
store.set(b"name", b"grace")
assert store.get(b"name") == b"grace"
assert os.path.getsize("one.db") > before, "an update should append, not overwrite"

# what the index holds is an offset, not the value
assert isinstance(store.index[b"name"], int)
assert store.index[b"name"] >= before

# arbitrary bytes survive the trip through a file
awkward = b"\n\x00\r\n\xff\xfe"
store.set(awkward, awkward)
assert store.get(awkward) == awkward
store.close()

# and a fresh Store over the same file sees all of it
again = Store("one.db")
assert again.get(b"name") == b"grace", "the newest value should win the replay"
assert again.get(b"lang") == b"python"
assert again.get(awkward) == awkward
assert set(again.index) == {b"name", b"lang", awkward}
again.close()

# a store that has never been written to is empty rather than an error
empty = Store("empty.db")
assert empty.index == {}
assert empty.get(b"anything") is None
empty.set(b"k", b"v")
empty.close()
assert Store("empty.db").get(b"k") == b"v"

# the file is exactly the records, back to back
counted = Store("count.db")
pairs = [(f"key{i}".encode(), f"value {i}".encode()) for i in range(200)]
for key, value in pairs:
    counted.set(key, value)
assert os.path.getsize("count.db") == sum(len(encode(k, v)) for k, v in pairs)
for key, value in pairs:
    assert counted.get(key) == value
counted.close()

# reopening two hundred keys costs one pass and gets them all
assert len(Store("count.db").index) == 200
~~~

~~~solution
import os
import struct
import zlib

HEADER = struct.Struct("<III")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.
    """
    body = key + value
    return HEADER.pack(zlib.crc32(body), len(key), len(value)) + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise CorruptRecord(f"header cut short at offset {offset}")
    crc, klen, vlen = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise CorruptRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], body[klen:], end


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path):
        self.path = path
        self.index = {}
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            key, _, end = decode(buf, offset)
            self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        self._end += len(record)
        self._remember(key, offset, len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def close(self):
        self._file.close()
~~~

## Saying that something is gone

You cannot erase from an append-only file. The bytes for a key are already
written, and the only thing a store can do is write more bytes that say the
earlier ones no longer count. That record is called a tombstone, and every log
structured store has one.

It has to be a flag in the header rather than an empty value, because an empty
value is a value somebody may have meant to store. `store.get(key)` returning
`b""` and returning `None` have to be different answers, and a format that
cannot tell them apart has lost information the caller gave it.

Replay then honours order. A tombstone read after a value removes the key from
the index, and a value written after a tombstone puts it back, which is what
lets a deleted key be set again.

@goal `delete` writes a tombstone, and a reopened store still knows about it.

~~~starter
import os
import struct
import zlib

HEADER = struct.Struct("<III")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.
    """
    body = key + value
    return HEADER.pack(zlib.crc32(body), len(key), len(value)) + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise CorruptRecord(f"header cut short at offset {offset}")
    crc, klen, vlen = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise CorruptRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], body[klen:], end


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path):
        self.path = path
        self.index = {}
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            key, _, end = decode(buf, offset)
            self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        self._end += len(record)
        self._remember(key, offset, len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        raise NotImplementedError

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        raise NotImplementedError

    def __contains__(self, key):
        raise NotImplementedError

    def close(self):
        self._file.close()
~~~

~~~tests
# stage two still holds
store = Store("t.db")
store.set(b"name", b"ada")
store.set(b"lang", b"python")
assert store.get(b"name") == b"ada"
store.set(b"name", b"grace")
store.close()
assert Store("t.db").get(b"name") == b"grace"

store = Store("t.db")
assert b"name" in store and b"gone" not in store
assert sorted(store.keys()) == [b"lang", b"name"]

# deleting says whether there was anything to delete
assert store.delete(b"name") is True
assert store.delete(b"name") is False
assert store.get(b"name") is None
assert b"name" not in store
assert store.keys() == [b"lang"]

# a delete is a write, so the file grew rather than shrank
import os
assert os.path.getsize("t.db") > 0
store.close()

# and the tombstone survives a reopen, which is the whole point of writing it
again = Store("t.db")
assert again.get(b"name") is None, "the delete did not survive the replay"
assert again.keys() == [b"lang"]

# a key can come back after being deleted
again.set(b"name", b"katherine")
assert again.get(b"name") == b"katherine"
again.close()
assert Store("t.db").get(b"name") == b"katherine"

# an empty value is a value, and is not the same as a missing one
store = Store("empty.db")
store.set(b"k", b"")
assert store.get(b"k") == b""
assert b"k" in store
store.delete(b"k")
assert store.get(b"k") is None
assert b"k" not in store
store.close()
assert Store("empty.db").get(b"k") is None
assert b"k" not in Store("empty.db")

# a tombstone decodes as a value of None rather than as empty bytes
key, value, _ = decode(encode(b"k", None))
assert key == b"k" and value is None
key, value, _ = decode(encode(b"k", b""))
assert key == b"k" and value == b""

# deleting something that was never there writes nothing
fresh = Store("fresh.db")
assert fresh.delete(b"never") is False
assert os.path.getsize("fresh.db") == 0, "a delete of nothing should write nothing"
fresh.close()

# a hundred keys, half of them deleted
many = Store("many.db")
for i in range(100):
    many.set(f"k{i}".encode(), f"v{i}".encode())
for i in range(0, 100, 2):
    many.delete(f"k{i}".encode())
many.close()
reopened = Store("many.db")
assert len(reopened.keys()) == 50
assert reopened.get(b"k0") is None and reopened.get(b"k1") == b"v1"
~~~

~~~solution
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.
    """
    deleted = value is None
    body = key if deleted else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), deleted)
    return header + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise CorruptRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, deleted = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise CorruptRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if deleted else body[klen:], end


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path):
        self.path = path
        self.index = {}
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            key, value, end = decode(buf, offset)
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def close(self):
        self._file.close()
~~~

## When a write is actually written

`file.write` does not put anything on a disk. It copies bytes into a buffer
that Python owns. `flush` hands them to the kernel, which is enough to survive
the process being killed. `os.fsync` asks the kernel to put them on the device,
which is what it takes to survive the machine losing power. Each step costs
more than the one before it, and a store that does not let you choose has
decided for you.

Then the other half, which is what happens when the power goes anyway. A crash
between writing a header and finishing its body leaves a file that ends in the
middle of a record. Everything before that point is whole and should be kept,
and the tail should be dropped. Refusing to open the file at all would turn one
lost write into a lost database.

That is different from a checksum that does not match. A record that is cut
short was being written. A record that is the right length and the wrong
contents changed after it was written, which no amount of replaying can fix,
and the store should say so rather than guess.

@goal `sync` controls durability, and a torn tail is recovered rather than fatal.

~~~starter
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind."""


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.
    """
    deleted = value is None
    body = key if deleted else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), deleted)
    return header + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise CorruptRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, deleted = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise CorruptRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if deleted else body[klen:], end


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False):
        self.path = path
        self.sync = sync
        self.index = {}
        self.recovered = 0
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            key, value, end = decode(buf, offset)
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def close(self):
        self._file.close()
~~~

~~~tests
import os

# stage three still holds
store = Store("t.db")
store.set(b"a", b"1")
store.set(b"b", b"2")
assert store.delete(b"a") is True
store.close()
assert Store("t.db").keys() == [b"b"]

# a synchronous store behaves the same, and costs more
store = Store("sync.db", sync=True)
store.set(b"k", b"v")
store.set(b"k2", b"v2")
store.delete(b"k2")
store.close()
reopened = Store("sync.db", sync=True)
assert reopened.get(b"k") == b"v"
assert reopened.get(b"k2") is None
assert reopened.recovered == 0
reopened.close()

# a truncated record is a different thing from a corrupt one
assert issubclass(TruncatedRecord, CorruptRecord)
try:
    decode(encode(b"k", b"v")[:-1])
except TruncatedRecord:
    pass
else:
    raise AssertionError("a cut record should raise TruncatedRecord")

flipped = bytearray(encode(b"k", b"v"))
flipped[-1] ^= 0xFF
try:
    decode(bytes(flipped))
except TruncatedRecord:
    raise AssertionError("a changed byte is corruption, not truncation")
except CorruptRecord:
    pass

# now the crash: a good log with half a record stuck on the end
store = Store("crash.db")
store.set(b"one", b"first")
store.set(b"two", b"second")
store.close()
good = os.path.getsize("crash.db")
with open("crash.db", "ab") as f:
    f.write(encode(b"three", b"third")[:9])

after = Store("crash.db")
assert after.get(b"one") == b"first", "a torn tail should not lose whole records"
assert after.get(b"two") == b"second"
assert after.get(b"three") is None
assert after.recovered == 9, after.recovered
assert os.path.getsize("crash.db") == good, "the torn tail should be truncated away"

# and the store is usable straight afterwards, writing where the tail was
after.set(b"three", b"third")
assert after.get(b"three") == b"third"
after.close()
assert Store("crash.db").get(b"three") == b"third"

# a crash inside the header itself recovers the same way
store = Store("head.db")
store.set(b"one", b"first")
store.close()
with open("head.db", "ab") as f:
    f.write(b"\x01\x02\x03")
after = Store("head.db")
assert after.get(b"one") == b"first"
assert after.recovered == 3

# corruption in the middle is not a torn tail, and is not quietly swallowed
store = Store("bad.db")
store.set(b"one", b"first")
store.set(b"two", b"second")
store.close()
with open("bad.db", "r+b") as f:
    f.seek(os.path.getsize("bad.db") - len(encode(b"two", b"second")) + HEADER.size)
    f.write(b"X")
try:
    Store("bad.db")
except CorruptRecord:
    pass
else:
    raise AssertionError("a changed byte in the middle should not open quietly")

# an untouched store reports nothing recovered
clean = Store("clean.db")
clean.set(b"k", b"v")
clean.close()
assert Store("clean.db").recovered == 0
~~~

~~~solution
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.
    """
    deleted = value is None
    body = key if deleted else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), deleted)
    return header + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, deleted = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if deleted else body[klen:], end


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False):
        self.path = path
        self.sync = sync
        self.index = {}
        self.recovered = 0
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, end = decode(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def close(self):
        self._file.close()
~~~

## Reclaiming what the log no longer needs

An append-only file only grows. Ten writes to one key leave ten records and
nine of them are dead: the index points at the last one and nothing will ever
read the others. A store that runs for a year is mostly dead bytes.

Compaction is the answer, and it is simpler than it sounds. Walk the index,
which already names every live record, copy each one to a new file, and move
the new file into place. What comes out is one record per live key and no
tombstones at all, because a tombstone exists to cancel an earlier record and
after the rewrite there is no earlier record left to cancel.

The new log is built beside the old one rather than written over it. A rewrite
in place would have a window where the file is neither the old log nor the new
one, and a crash inside that window loses everything rather than one write.

@goal `compact` rewrites the log with only live records, and reports the saving.

~~~starter
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.
    """
    deleted = value is None
    body = key if deleted else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), deleted)
    return header + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, deleted = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if deleted else body[klen:], end


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False):
        self.path = path
        self.sync = sync
        self.index = {}
        self.recovered = 0
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, end = decode(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def dead_bytes(self):
        """Bytes in the log that no read can reach any more."""
        raise NotImplementedError

    def compact(self):
        """Rewrite the log with only what a read can still reach."""
        raise NotImplementedError

    def close(self):
        self._file.close()
~~~

~~~tests
import os

# stage four still holds
store = Store("t.db")
store.set(b"a", b"1")
store.close()
with open("t.db", "ab") as f:
    f.write(encode(b"b", b"2")[:6])
after = Store("t.db")
assert after.get(b"a") == b"1" and after.recovered == 6
after.close()

# a fresh store wastes nothing
store = Store("c.db")
store.set(b"one", b"first")
store.set(b"two", b"second")
assert store.dead_bytes() == 0

# every overwrite leaves the old record behind
first_size = os.path.getsize("c.db")
for i in range(10):
    store.set(b"one", f"v{i}".encode())
assert store.dead_bytes() > 0
assert os.path.getsize("c.db") > first_size

# compaction reclaims exactly what was dead
dead = store.dead_bytes()
reclaimed = store.compact()
assert reclaimed == dead, f"reclaimed {reclaimed}, {dead} was dead"
assert store.dead_bytes() == 0
assert os.path.getsize("c.db") == store._end

# and the store still answers the same questions
assert store.get(b"one") == b"v9"
assert store.get(b"two") == b"second"
assert sorted(store.keys()) == [b"one", b"two"]

# and so does a fresh one over the compacted file
store.close()
reopened = Store("c.db")
assert reopened.get(b"one") == b"v9"
assert reopened.get(b"two") == b"second"
assert reopened.recovered == 0

# writing after a compaction lands in the new file
reopened.set(b"three", b"third")
assert reopened.get(b"three") == b"third"
reopened.close()
assert Store("c.db").get(b"three") == b"third"

# tombstones do not survive a compaction, because there is nothing left to cancel
store = Store("d.db")
for i in range(20):
    store.set(f"k{i}".encode(), b"value")
for i in range(20):
    store.delete(f"k{i}".encode())
assert store.keys() == []
store.compact()
assert os.path.getsize("d.db") == 0, "an empty store should compact to nothing"
assert store.keys() == []
store.close()
assert Store("d.db").keys() == []

# the temporary file does not outlive the compaction
assert not os.path.exists("d.db.compact")
assert not os.path.exists("c.db.compact")

# the count is kept as the store is written, and it has to agree with what a
# walk over the index would have said
mixed = Store("mixed.db")
for i in range(40):
    mixed.set(f"k{i % 10}".encode(), f"v{i}".encode())
for i in range(0, 10, 3):
    mixed.delete(f"k{i}".encode())
mixed.set(b"late", b"value")
walked = mixed._end - sum(mixed._record_size(o) for o in mixed.index.values())
assert mixed.dead_bytes() == walked, (mixed.dead_bytes(), walked)
assert mixed.compact() == walked
assert mixed.dead_bytes() == 0
mixed.close()

# and it is a count rather than a walk, which matters because a threshold asks
# after every single write. counted in seeks rather than seconds, because a
# clock measures the machine and this measures the code.
seeks = []


class Counting(Store):
    def _record_size(self, offset):
        seeks.append(offset)
        return super()._record_size(offset)


counting = Counting("cost.db")
for i in range(200):
    counting.set(f"k{i}".encode(), b"v")
assert len(seeks) == 0, (
    f"writing 200 keys that were not there read {len(seeks)} old records; "
    f"asking dead_bytes on every write would be about 20000"
)

# overwriting one key reads exactly the one record it replaces
seeks.clear()
for i in range(50):
    counting.set(b"k0", f"v{i}".encode())
assert len(seeks) == 50, len(seeks)
assert counting.get(b"k0") == b"v49"
counting.close()

# compacting twice in a row is not an error and reclaims nothing the second time
store = Store("e.db")
store.set(b"k", b"v")
store.set(b"k", b"w")
assert store.compact() > 0
assert store.compact() == 0
assert store.get(b"k") == b"w"
store.close()

# a large store keeps every value across the rewrite
big = Store("big.db")
expected = {}
for i in range(300):
    key, value = f"k{i % 100}".encode(), f"value {i}".encode()
    big.set(key, value)
    expected[key] = value
big.compact()
assert len(big.keys()) == 100
for key, value in expected.items():
    assert big.get(key) == value, key
~~~

~~~solution
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.
    """
    deleted = value is None
    body = key if deleted else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), deleted)
    return header + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, deleted = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if deleted else body[klen:], end


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False):
        self.path = path
        self.sync = sync
        self.index = {}
        self.recovered = 0
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, end = decode(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def dead_bytes(self):
        """Bytes in the log that no read can reach any more.

        A running count rather than a walk over the index. Walking it means one
        seek per live key, and `_maybe_compact` asks after every write, which
        makes writing quadratic in the number of keys the store holds: three
        thousand sets measured nine milliseconds one way and seven hundred and
        forty the other.
        """
        return self._end - self._live

    def compact(self):
        """Rewrite the log with only what a read can still reach.

        Returns the bytes reclaimed. What comes out is one record per live key
        and no tombstones at all, because a tombstone exists to cancel an
        earlier record and after the rewrite there is no earlier record left to
        cancel.

        The new log is built beside the old one and moved into place, rather
        than written over it. A rewrite in place would have a window where the
        file is neither the old log nor the new one, and a crash inside that
        window loses everything.
        """
        before = self._end
        temp = self.path + ".compact"
        index = {}
        with open(temp, "wb") as out:
            for key, offset in self.index.items():
                index[key] = out.tell()
                out.write(encode(key, self._read_at(offset)[1]))
            out.flush()
            os.fsync(out.fileno())
        self._file.close()
        os.replace(temp, self.path)
        self._file = open(self.path, "r+b")  # noqa: SIM115
        self.index = index
        self._end = os.path.getsize(self.path)
        self._live = self._end
        return before - self._end

    def close(self):
        self._file.close()
~~~

## The crash in the middle of the rewrite

Compaction writes a new file and then moves it into place. A crash can land
anywhere in that, and the store has to come back from each of them.

`os.replace` is what makes it survivable. A rename within one filesystem is
atomic: after it, the path names the new file, and before it, the path names
the old one. There is no moment where it names half of either. So a crash
before the rename leaves the old log, which is complete and slightly wasteful,
and a crash after it leaves the new log, which is complete and smaller.

What a crash does leave is the half-built file the compaction was writing. It
was never the log and nothing in it needs recovering, so opening a store should
notice it and clear it away rather than reading it.

One thing further down. A rename is a change to the directory, and syncing the
file does not sync the directory that names it, so a power cut can leave a disk
where the new file exists and the rename does not. Databases fsync the
directory too. Not every filesystem allows it, which is why the answer here is
reported rather than raised.

@goal A crash anywhere in a compaction leaves a store that opens with its data.

~~~starter
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.
    """
    deleted = value is None
    body = key if deleted else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), deleted)
    return header + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, deleted = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if deleted else body[klen:], end


def sync_directory(path):
    """Ask for a rename beside `path` to be on the disk, not only its contents."""
    raise NotImplementedError


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False):
        self.path = path
        self.sync = sync
        self.index = {}
        self.recovered = 0
        self.abandoned = False
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, end = decode(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def dead_bytes(self):
        """Bytes in the log that no read can reach any more.

        A running count rather than a walk over the index. Walking it means one
        seek per live key, and `_maybe_compact` asks after every write, which
        makes writing quadratic in the number of keys the store holds: three
        thousand sets measured nine milliseconds one way and seven hundred and
        forty the other.
        """
        return self._end - self._live

    def compact(self):
        """Rewrite the log with only what a read can still reach.

        Returns the bytes reclaimed. What comes out is one record per live key
        and no tombstones at all, because a tombstone exists to cancel an
        earlier record and after the rewrite there is no earlier record left to
        cancel.

        The new log is built beside the old one and moved into place, rather
        than written over it. A rewrite in place would have a window where the
        file is neither the old log nor the new one, and a crash inside that
        window loses everything.
        """
        before = self._end
        temp = self.path + ".compact"
        index = {}
        with open(temp, "wb") as out:
            for key, offset in self.index.items():
                index[key] = out.tell()
                out.write(encode(key, self._read_at(offset)[1]))
            out.flush()
            os.fsync(out.fileno())
        self._file.close()
        os.replace(temp, self.path)
        self._file = open(self.path, "r+b")  # noqa: SIM115
        self.index = index
        self._end = os.path.getsize(self.path)
        self._live = self._end
        return before - self._end

    def close(self):
        self._file.close()
~~~

~~~tests
import os

# stage five still holds
store = Store("t.db")
store.set(b"k", b"v")
store.set(b"k", b"w")
assert store.compact() > 0
assert store.get(b"k") == b"w"
store.close()

# a store that has never compacted says so, rather than failing to answer
fresh = Store("fresh.db")
assert fresh.synced is None, "None is 'no compaction yet', not 'the sync failed'"
fresh.set(b"k", b"v")
fresh.set(b"k", b"w")
assert fresh.synced is None
fresh.compact()
assert fresh.synced in (True, False), "and now it is whatever the filesystem said"
fresh.close()

# syncing a directory answers rather than raising, wherever it runs
assert sync_directory("t.db") in (True, False)
assert sync_directory(os.path.join("t.db")) in (True, False)

# a compaction that crashed before the rename left its workings behind
store = Store("crash.db")
store.set(b"one", b"first")
store.set(b"two", b"second")
store.close()
with open("crash.db.compact", "wb") as f:
    f.write(encode(b"one", b"first")[:5])

after = Store("crash.db")
assert after.abandoned is True, "the leftover file should have been noticed"
assert not os.path.exists("crash.db.compact"), "and cleared away"
assert after.get(b"one") == b"first", "the old log is still the log"
assert after.get(b"two") == b"second"
assert after.recovered == 0, "the leftover file is not part of the log"
after.close()

# opening again is quiet, because there is nothing left over now
assert Store("crash.db").abandoned is False

# a rename that never happens leaves the old log whole and readable
real_replace = os.replace


def refuse(source, target):
    raise OSError("the power went out here")


store = Store("power.db")
for i in range(10):
    store.set(b"k", f"v{i}".encode())
store.set(b"other", b"kept")
os.replace = refuse
try:
    store.compact()
except OSError:
    pass
else:
    raise AssertionError("the compaction should have failed with the rename")
finally:
    os.replace = real_replace

recovered = Store("power.db")
assert recovered.get(b"k") == b"v9", "a failed compaction must not lose the log"
assert recovered.get(b"other") == b"kept"
assert recovered.abandoned is True
assert not os.path.exists("power.db.compact")
recovered.close()

# and compacting afterwards works, so the failure left nothing broken behind
store = Store("power.db")
assert store.compact() > 0
assert store.get(b"k") == b"v9"
assert store.dead_bytes() == 0
store.close()
assert Store("power.db").get(b"k") == b"v9"

# a successful compaction reports whether the rename itself was made durable
store = Store("ok.db")
store.set(b"k", b"v")
store.set(b"k", b"w")
store.compact()
assert store.synced in (True, False)
assert store.get(b"k") == b"w"
store.close()
~~~

~~~solution
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.
    """
    deleted = value is None
    body = key if deleted else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), deleted)
    return header + body


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, deleted = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if deleted else body[klen:], end


def sync_directory(path):
    """Ask for a rename beside `path` to be on the disk, not only its contents.

    A rename changes the directory, and fsync on a file does not cover the
    directory that names it. Without this a power cut can leave a disk where
    the new log exists and the rename that pointed at it does not.

    Not every filesystem lets a directory be opened this way, so a failure here
    reports False rather than raising. The data is already safe at that point,
    what is missing is the ordering guarantee.
    """
    try:
        fd = os.open(os.path.dirname(path) or ".", os.O_RDONLY)
    except OSError:
        return False
    try:
        os.fsync(fd)
    except OSError:
        return False
    finally:
        os.close(fd)
    return True


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False):
        self.path = path
        self.sync = sync
        self.index = {}
        self.recovered = 0
        # A crashed compaction leaves its half-built file behind. It was never
        # the log, so there is nothing in it to recover: the rename either
        # happened or it did not, and the log is whatever the path names.
        self.synced = None
        self.abandoned = os.path.exists(path + ".compact")
        if self.abandoned:
            os.unlink(path + ".compact")
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, end = decode(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def dead_bytes(self):
        """Bytes in the log that no read can reach any more.

        A running count rather than a walk over the index. Walking it means one
        seek per live key, and `_maybe_compact` asks after every write, which
        makes writing quadratic in the number of keys the store holds: three
        thousand sets measured nine milliseconds one way and seven hundred and
        forty the other.
        """
        return self._end - self._live

    def compact(self):
        """Rewrite the log with only what a read can still reach.

        Returns the bytes reclaimed. What comes out is one record per live key
        and no tombstones at all, because a tombstone exists to cancel an
        earlier record and after the rewrite there is no earlier record left to
        cancel.

        The new log is built beside the old one and moved into place, rather
        than written over it. A rewrite in place would have a window where the
        file is neither the old log nor the new one, and a crash inside that
        window loses everything.
        """
        before = self._end
        temp = self.path + ".compact"
        index = {}
        with open(temp, "wb") as out:
            for key, offset in self.index.items():
                index[key] = out.tell()
                out.write(encode(key, self._read_at(offset)[1]))
            out.flush()
            os.fsync(out.fileno())
        # Closed first because Windows will not rename over an open file.
        # POSIX would allow it, and code that only runs on POSIX is code that
        # only runs where it was written.
        self._file.close()
        os.replace(temp, self.path)
        self.synced = sync_directory(self.path)
        self._file = open(self.path, "r+b")  # noqa: SIM115
        self.index = index
        self._end = os.path.getsize(self.path)
        self._live = self._end
        return before - self._end

    def close(self):
        self._file.close()
~~~

## All of it, or none of it

Two writes that have to happen together cannot be two records. A crash between
them leaves the first applied and the second missing, and the store has no way
to know that was wrong.

The fix needs nothing new on disk. Put the whole batch inside one record, as a
payload made of ordinary encoded records. One record means one length and one
checksum, so a crash partway through writing it leaves a record that is cut
short, and stage four already throws those away. There is no state in which
half a batch survived, which is the whole of what atomic means here.

It costs one header more than writing the records separately, not less. What
the header buys is that guarantee, and one trip to the disk instead of one per
key, which on a synchronous store is the difference that shows up in a
benchmark.

Replay then has to look inside. The offsets it hands the index are real offsets
into the log, because a batch record is a header followed by whole records, so
reading one back does not need to know it was written alongside others.

This is where the flags byte earns being a byte. It has carried one bit since
stage three, and now it carries two.

@goal `write_batch` applies every change or, after a crash, none of them.

~~~starter
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")

FLAG_DELETED = 1
FLAG_BATCH = 2


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.
    """
    deleted = value is None
    body = key if deleted else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), deleted)
    return header + body


def decode_record(buf, offset=0):
    """The record at `offset` as (key, value, flags, end)."""
    raise NotImplementedError


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next.

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, deleted = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if deleted else body[klen:], end


def sync_directory(path):
    """Ask for a rename beside `path` to be on the disk, not only its contents.

    A rename changes the directory, and fsync on a file does not cover the
    directory that names it. Without this a power cut can leave a disk where
    the new log exists and the rename that pointed at it does not.

    Not every filesystem lets a directory be opened this way, so a failure here
    reports False rather than raising. The data is already safe at that point,
    what is missing is the ordering guarantee.
    """
    try:
        fd = os.open(os.path.dirname(path) or ".", os.O_RDONLY)
    except OSError:
        return False
    try:
        os.fsync(fd)
    except OSError:
        return False
    finally:
        os.close(fd)
    return True


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False):
        self.path = path
        self.sync = sync
        self.index = {}
        self.recovered = 0
        # A crashed compaction leaves its half-built file behind. It was never
        # the log, so there is nothing in it to recover: the rename either
        # happened or it did not, and the log is whatever the path names.
        self.synced = None
        self.abandoned = os.path.exists(path + ".compact")
        if self.abandoned:
            os.unlink(path + ".compact")
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, end = decode(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def _index_batch(self, offset, payload):
        """Index the records packed inside one batch record."""
        raise NotImplementedError

    def write_batch(self, changes):
        """Apply every change or none of them. Returns how many there were."""
        raise NotImplementedError

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def dead_bytes(self):
        """Bytes in the log that no read can reach any more.

        A running count rather than a walk over the index. Walking it means one
        seek per live key, and `_maybe_compact` asks after every write, which
        makes writing quadratic in the number of keys the store holds: three
        thousand sets measured nine milliseconds one way and seven hundred and
        forty the other.
        """
        return self._end - self._live

    def compact(self):
        """Rewrite the log with only what a read can still reach.

        Returns the bytes reclaimed. What comes out is one record per live key
        and no tombstones at all, because a tombstone exists to cancel an
        earlier record and after the rewrite there is no earlier record left to
        cancel.

        The new log is built beside the old one and moved into place, rather
        than written over it. A rewrite in place would have a window where the
        file is neither the old log nor the new one, and a crash inside that
        window loses everything.
        """
        before = self._end
        temp = self.path + ".compact"
        index = {}
        with open(temp, "wb") as out:
            for key, offset in self.index.items():
                index[key] = out.tell()
                out.write(encode(key, self._read_at(offset)[1]))
            out.flush()
            os.fsync(out.fileno())
        # Closed first because Windows will not rename over an open file.
        # POSIX would allow it, and code that only runs on POSIX is code that
        # only runs where it was written.
        self._file.close()
        os.replace(temp, self.path)
        self.synced = sync_directory(self.path)
        self._file = open(self.path, "r+b")  # noqa: SIM115
        self.index = index
        self._end = os.path.getsize(self.path)
        self._live = self._end
        return before - self._end

    def close(self):
        self._file.close()
~~~

~~~tests
import os

# stage six still holds
store = Store("t.db")
store.set(b"k", b"v")
store.set(b"k", b"w")
assert store.compact() > 0
assert store.get(b"k") == b"w"
store.close()
assert sync_directory("t.db") in (True, False)

# the flags byte carries both bits, and a plain record has neither
assert FLAG_DELETED != FLAG_BATCH
assert decode_record(encode(b"k", b"v"))[2] == 0
assert decode_record(encode(b"k", None))[2] & FLAG_DELETED
assert decode_record(encode(b"k", b"v", FLAG_BATCH))[2] & FLAG_BATCH
assert decode_record(encode(b"k", b"v"))[:2] == (b"k", b"v")

# a batch applies as a unit
store = Store("b.db")
store.set(b"kept", b"before")
assert store.write_batch({b"a": b"1", b"b": b"2", b"c": b"3"}) == 3
assert store.get(b"a") == b"1" and store.get(b"c") == b"3"
assert store.get(b"kept") == b"before"
assert sorted(store.keys()) == [b"a", b"b", b"c", b"kept"]

# a list of pairs works as well as a mapping, and None deletes
assert store.write_batch([(b"a", b"changed"), (b"b", None)]) == 2
assert store.get(b"a") == b"changed"
assert store.get(b"b") is None
assert b"b" not in store

# an empty batch writes nothing
size = os.path.getsize("b.db")
assert store.write_batch({}) == 0
assert store.write_batch([]) == 0
assert os.path.getsize("b.db") == size
store.close()

# and all of it survives a reopen, which means replay unpacked the batch
again = Store("b.db")
assert again.get(b"a") == b"changed"
assert again.get(b"c") == b"3"
assert again.get(b"b") is None
assert again.get(b"kept") == b"before"
assert sorted(again.keys()) == [b"a", b"c", b"kept"]
again.close()

# a batch is one record wrapping the others, so it costs one header more,
# and that header is what buys the atomicity
pairs = ((b"x", b"1"), (b"y", b"2"), (b"z", b"3"))
store = Store("size.db")
store.write_batch(dict(pairs))
batched = os.path.getsize("size.db")
store.close()
store = Store("apart.db")
for key, value in pairs:
    store.set(key, value)
apart = os.path.getsize("apart.db")
store.close()
assert batched == apart + HEADER.size, (batched, apart)

# and it reaches the disk once rather than once per key
appends = []


class Counting(Store):
    def _append(self, record):
        appends.append(len(record))
        return super()._append(record)


store = Counting("count.db")
store.write_batch(dict(pairs))
assert len(appends) == 1, f"a batch should be one write, not {len(appends)}"
appends.clear()
for key, value in pairs:
    store.set(key, value)
assert len(appends) == 3, "three separate sets are three writes"
store.close()

# now the point of it: a batch cut in half applies none of itself
store = Store("torn.db")
store.set(b"before", b"safe")
batch_at = os.path.getsize("torn.db")
store.write_batch({b"p": b"1", b"q": b"2", b"r": b"3"})
whole = os.path.getsize("torn.db")
store.close()
with open("torn.db", "r+b") as f:
    f.truncate(whole - 4)

after = Store("torn.db")
assert after.get(b"before") == b"safe", "the writes before the batch are whole"
assert after.get(b"p") is None, "a torn batch must not apply in part"
assert after.get(b"q") is None
assert after.get(b"r") is None
assert after.keys() == [b"before"]
assert after.recovered == whole - 4 - batch_at, after.recovered
assert after._end == batch_at, "the log should end where the batch began"
after.close()

# a batch survives a compaction, which unpacks it into ordinary records
store = Store("c.db")
store.write_batch({b"a": b"1", b"b": b"2"})
store.set(b"a", b"1 again")
assert store.compact() > 0
assert store.get(b"a") == b"1 again"
assert store.get(b"b") == b"2"
assert store.dead_bytes() == 0
store.close()
assert Store("c.db").get(b"b") == b"2"

# a batch big enough to matter
store = Store("many.db")
assert store.write_batch({f"k{i}".encode(): f"v{i}".encode() for i in range(500)}) == 500
store.close()
reopened = Store("many.db")
assert len(reopened.keys()) == 500
assert reopened.get(b"k0") == b"v0" and reopened.get(b"k499") == b"v499"
~~~

~~~solution
import os
import struct
import zlib

HEADER = struct.Struct("<IIIB")

FLAG_DELETED = 1
FLAG_BATCH = 2


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value, flags=0):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.

    The flags byte holds the tombstone bit and the batch bit, which is why it
    was a byte from the start rather than a boolean.
    """
    if value is None:
        flags |= FLAG_DELETED
    body = key if value is None else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), flags)
    return header + body


def decode_record(buf, offset=0):
    """The record at `offset` as (key, value, flags, end).

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, flags = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if flags & FLAG_DELETED else body[klen:], flags, end


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next."""
    key, value, _, end = decode_record(buf, offset)
    return key, value, end


def sync_directory(path):
    """Ask for a rename beside `path` to be on the disk, not only its contents.

    A rename changes the directory, and fsync on a file does not cover the
    directory that names it. Without this a power cut can leave a disk where
    the new log exists and the rename that pointed at it does not.

    Not every filesystem lets a directory be opened this way, so a failure here
    reports False rather than raising. The data is already safe at that point,
    what is missing is the ordering guarantee.
    """
    try:
        fd = os.open(os.path.dirname(path) or ".", os.O_RDONLY)
    except OSError:
        return False
    try:
        os.fsync(fd)
    except OSError:
        return False
    finally:
        os.close(fd)
    return True


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False):
        self.path = path
        self.sync = sync
        self.index = {}
        self.recovered = 0
        # A crashed compaction leaves its half-built file behind. It was never
        # the log, so there is nothing in it to recover: the rename either
        # happened or it did not, and the log is whatever the path names.
        self.synced = None
        self.abandoned = os.path.exists(path + ".compact")
        if self.abandoned:
            os.unlink(path + ".compact")
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, flags, end = decode_record(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if flags & FLAG_BATCH:
                self._index_batch(offset, value)
            elif value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _index_batch(self, offset, payload):
        """Index the records packed inside one batch record.

        Their offsets are real offsets into the log, because a batch record is
        a header followed by whole records, so `_read_at` reaches them without
        knowing they were written together.
        """
        base = offset + HEADER.size
        inner = 0
        while inner < len(payload):
            key, value, end = decode(payload, inner)
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = base + inner
            inner = end

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def write_batch(self, changes):
        """Apply every change or none of them. Returns how many there were.

        The whole batch goes into one record, so it has one length and one
        checksum. A crash while writing it leaves a record that is cut short,
        and a record that is cut short is dropped on the next open. There is no
        state in which half a batch survived, which is what atomic means here.

        A value of None deletes, the same as it does everywhere else.
        """
        items = changes.items() if isinstance(changes, dict) else changes
        payload, placements = b"", []
        for key, value in items:
            record = encode(key, value)
            placements.append((key, value, len(payload), len(record)))
            payload += record
        if not placements:
            return 0
        base = self._append(encode(b"", payload, FLAG_BATCH)) + HEADER.size
        for key, value, at, size in placements:
            if value is None:
                self._forget(key)
            else:
                self._remember(key, base + at, size)
        return len(placements)

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def dead_bytes(self):
        """Bytes in the log that no read can reach any more.

        A running count rather than a walk over the index. Walking it means one
        seek per live key, and `_maybe_compact` asks after every write, which
        makes writing quadratic in the number of keys the store holds: three
        thousand sets measured nine milliseconds one way and seven hundred and
        forty the other.
        """
        return self._end - self._live

    def compact(self):
        """Rewrite the log with only what a read can still reach.

        Returns the bytes reclaimed. What comes out is one record per live key
        and no tombstones at all, because a tombstone exists to cancel an
        earlier record and after the rewrite there is no earlier record left to
        cancel.

        The new log is built beside the old one and moved into place, rather
        than written over it. A rewrite in place would have a window where the
        file is neither the old log nor the new one, and a crash inside that
        window loses everything.
        """
        before = self._end
        temp = self.path + ".compact"
        index = {}
        with open(temp, "wb") as out:
            for key, offset in self.index.items():
                index[key] = out.tell()
                out.write(encode(key, self._read_at(offset)[1]))
            out.flush()
            os.fsync(out.fileno())
        # Closed first because Windows will not rename over an open file.
        # POSIX would allow it, and code that only runs on POSIX is code that
        # only runs where it was written.
        self._file.close()
        os.replace(temp, self.path)
        self.synced = sync_directory(self.path)
        self._file = open(self.path, "r+b")  # noqa: SIM115
        self.index = index
        self._end = os.path.getsize(self.path)
        self._live = self._end
        return before - self._end

    def close(self):
        self._file.close()
~~~

## The thing you would actually hand somebody

Everything works. What is missing is the part that makes it feel like Python
rather than like a file with functions near it.

`len` and iteration and `items` cost almost nothing here, because the index is
already a dictionary and that is exactly what a dictionary does. `items` yields
rather than returning a list, because the values are on disk and building all
of them in memory would undo the reason the index holds offsets.

`with` matters more than it looks. A store owns an open file, and an open file
that nobody closes is a resource leak that only shows up under load. Unit 22
built `__enter__` and `__exit__` for exactly this shape of object.

Then the number that decides when to compact. A store that never compacts fills
the disk and a store that always compacts does nothing else, so the useful
answer is a threshold on the fraction of the log that is dead. That fraction is
what `stats` exists to report, and once it is a number, the policy is one
comparison.

@goal A store you can use with `with`, iterate, measure, and leave to compact itself.

~~~starter
import os
import struct
import zlib
from dataclasses import dataclass

HEADER = struct.Struct("<IIIB")

FLAG_DELETED = 1
FLAG_BATCH = 2


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value, flags=0):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.

    The flags byte holds the tombstone bit and the batch bit, which is why it
    was a byte from the start rather than a boolean.
    """
    if value is None:
        flags |= FLAG_DELETED
    body = key if value is None else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), flags)
    return header + body


def decode_record(buf, offset=0):
    """The record at `offset` as (key, value, flags, end).

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, flags = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if flags & FLAG_DELETED else body[klen:], flags, end


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next."""
    key, value, _, end = decode_record(buf, offset)
    return key, value, end


@dataclass
class Stats:
    """What a store is holding, and how much of its file is worth keeping."""

    keys: int
    live_bytes: int
    dead_bytes: int
    total_bytes: int
    recovered: int
    compactions: int

    @property
    def waste(self):
        """The fraction of the log no read will reach. Zero when it is empty."""
        raise NotImplementedError


def sync_directory(path):
    """Ask for a rename beside `path` to be on the disk, not only its contents.

    A rename changes the directory, and fsync on a file does not cover the
    directory that names it. Without this a power cut can leave a disk where
    the new log exists and the rename that pointed at it does not.

    Not every filesystem lets a directory be opened this way, so a failure here
    reports False rather than raising. The data is already safe at that point,
    what is missing is the ordering guarantee.
    """
    try:
        fd = os.open(os.path.dirname(path) or ".", os.O_RDONLY)
    except OSError:
        return False
    try:
        os.fsync(fd)
    except OSError:
        return False
    finally:
        os.close(fd)
    return True


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False, compact_when=None):
        self.path = path
        self.sync = sync
        self.compact_when = compact_when
        self.compactions = 0
        self.index = {}
        self.recovered = 0
        # A crashed compaction leaves its half-built file behind. It was never
        # the log, so there is nothing in it to recover: the rename either
        # happened or it did not, and the log is whatever the path names.
        self.synced = None
        self.abandoned = os.path.exists(path + ".compact")
        if self.abandoned:
            os.unlink(path + ".compact")
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, flags, end = decode_record(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if flags & FLAG_BATCH:
                self._index_batch(offset, value)
            elif value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _index_batch(self, offset, payload):
        """Index the records packed inside one batch record.

        Their offsets are real offsets into the log, because a batch record is
        a header followed by whole records, so `_read_at` reaches them without
        knowing they were written together.
        """
        base = offset + HEADER.size
        inner = 0
        while inner < len(payload):
            key, value, end = decode(payload, inner)
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = base + inner
            inner = end

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
        return had

    def write_batch(self, changes):
        """Apply every change or none of them. Returns how many there were.

        The whole batch goes into one record, so it has one length and one
        checksum. A crash while writing it leaves a record that is cut short,
        and a record that is cut short is dropped on the next open. There is no
        state in which half a batch survived, which is what atomic means here.

        A value of None deletes, the same as it does everywhere else.
        """
        items = changes.items() if isinstance(changes, dict) else changes
        payload, placements = b"", []
        for key, value in items:
            record = encode(key, value)
            placements.append((key, value, len(payload), len(record)))
            payload += record
        if not placements:
            return 0
        base = self._append(encode(b"", payload, FLAG_BATCH)) + HEADER.size
        for key, value, at, size in placements:
            if value is None:
                self._forget(key)
            else:
                self._remember(key, base + at, size)
        return len(placements)

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def dead_bytes(self):
        """Bytes in the log that no read can reach any more.

        A running count rather than a walk over the index. Walking it means one
        seek per live key, and `_maybe_compact` asks after every write, which
        makes writing quadratic in the number of keys the store holds: three
        thousand sets measured nine milliseconds one way and seven hundred and
        forty the other.
        """
        return self._end - self._live

    def compact(self):
        """Rewrite the log with only what a read can still reach.

        Returns the bytes reclaimed. What comes out is one record per live key
        and no tombstones at all, because a tombstone exists to cancel an
        earlier record and after the rewrite there is no earlier record left to
        cancel.

        The new log is built beside the old one and moved into place, rather
        than written over it. A rewrite in place would have a window where the
        file is neither the old log nor the new one, and a crash inside that
        window loses everything.
        """
        before = self._end
        temp = self.path + ".compact"
        index = {}
        with open(temp, "wb") as out:
            for key, offset in self.index.items():
                index[key] = out.tell()
                out.write(encode(key, self._read_at(offset)[1]))
            out.flush()
            os.fsync(out.fileno())
        # Closed first because Windows will not rename over an open file.
        # POSIX would allow it, and code that only runs on POSIX is code that
        # only runs where it was written.
        self._file.close()
        os.replace(temp, self.path)
        self.synced = sync_directory(self.path)
        self._file = open(self.path, "r+b")  # noqa: SIM115
        self.index = index
        self._end = os.path.getsize(self.path)
        self._live = self._end
        return before - self._end


    def __enter__(self):
        raise NotImplementedError

    def __exit__(self, exc_type, exc, tb):
        raise NotImplementedError

    def __len__(self):
        raise NotImplementedError

    def __iter__(self):
        """Iterating a store gives its keys, the way iterating a dict does."""
        raise NotImplementedError

    def items(self):
        """Every live key and value, read one at a time rather than all at once."""
        raise NotImplementedError

    def stats(self):
        """Counts worth looking at before deciding to compact."""
        raise NotImplementedError

    def _maybe_compact(self):
        """Compact once dead bytes pass the threshold, if one was asked for."""
        raise NotImplementedError

    def close(self):
        self._file.close()
~~~

~~~tests
import os

# stage seven still holds
store = Store("t.db")
store.set(b"kept", b"before")
assert store.write_batch({b"a": b"1", b"b": b"2"}) == 2
assert store.get(b"a") == b"1"
store.close()
assert sorted(Store("t.db").keys()) == [b"a", b"b", b"kept"]

# a store closes itself
with Store("w.db") as store:
    store.set(b"k", b"v")
    assert store.get(b"k") == b"v"
assert store._file.closed, "leaving the block should have closed the file"
with Store("w.db") as store:
    assert store.get(b"k") == b"v"

# and does not swallow what went wrong inside the block
try:
    with Store("w.db") as store:
        store.set(b"k2", b"v2")
        raise ValueError("something went wrong in here")
except ValueError:
    pass
else:
    raise AssertionError("the exception should have come out of the block")
assert Store("w.db").get(b"k2") == b"v2", "the write before it still landed"

# it counts and iterates like the mapping it is
with Store("m.db") as store:
    assert len(store) == 0
    store.set(b"a", b"1")
    store.set(b"b", b"2")
    store.set(b"a", b"1 again")
    assert len(store) == 2
    assert sorted(store) == [b"a", b"b"]
    assert dict(store.items()) == {b"a": b"1 again", b"b": b"2"}
    store.delete(b"a")
    assert len(store) == 1
    assert dict(store.items()) == {b"b": b"2"}

# items reads one value at a time rather than building a list of them
with Store("m.db") as store:
    pairs = store.items()
    assert next(iter(pairs)) is not None

# the numbers say what the file is doing
with Store("s.db") as store:
    assert store.stats().keys == 0
    assert store.stats().waste == 0.0
    store.set(b"k", b"first")
    clean = store.stats()
    assert clean.keys == 1
    assert clean.dead_bytes == 0
    assert clean.live_bytes == clean.total_bytes == os.path.getsize("s.db")
    assert clean.waste == 0.0
    assert clean.compactions == 0

    for i in range(9):
        store.set(b"k", f"v{i}".encode())
    dirty = store.stats()
    assert dirty.keys == 1
    assert dirty.dead_bytes > 0
    assert dirty.live_bytes + dirty.dead_bytes == dirty.total_bytes
    assert 0.8 < dirty.waste < 1.0, dirty.waste

    assert store.compact() == dirty.dead_bytes
    after = store.stats()
    assert after.waste == 0.0 and after.compactions == 1
    assert store.get(b"k") == b"v8"

# a threshold compacts on its own, so the file stops growing
with Store("auto.db", compact_when=0.5) as store:
    for i in range(200):
        store.set(b"hot", f"v{i}".encode())
    assert store.get(b"hot") == b"v199"
    assert store.compactions > 0, "it should have compacted itself"
    assert store.stats().waste <= 0.5
    assert os.path.getsize("auto.db") < 200 * len(encode(b"hot", b"v199"))
assert Store("auto.db").get(b"hot") == b"v199"

# without a threshold nothing happens on its own
with Store("manual.db") as store:
    for i in range(50):
        store.set(b"hot", f"v{i}".encode())
    assert store.compactions == 0
    assert store.stats().waste > 0.9

# deletes and batches count towards it too
with Store("mixed.db", compact_when=0.5) as store:
    store.write_batch({f"k{i}".encode(): b"value" for i in range(50)})
    for i in range(50):
        store.delete(f"k{i}".encode())
    assert store.compactions > 0
    assert len(store) == 0
    assert os.path.getsize("mixed.db") == 0

# and everything above survives the whole trip through a file
with Store("final.db", sync=True, compact_when=0.6) as store:
    store.write_batch({b"a": b"1", b"b": b"2", b"c": b"3"})
    store.delete(b"b")
    store.set(b"c", b"3 again")
    expected = {b"a": b"1", b"c": b"3 again"}
    assert dict(store.items()) == expected
with Store("final.db") as store:
    assert dict(store.items()) == expected
    assert len(store) == 2
    assert store.recovered == 0
~~~

~~~solution
import os
import struct
import zlib
from dataclasses import dataclass

HEADER = struct.Struct("<IIIB")

FLAG_DELETED = 1
FLAG_BATCH = 2


class CorruptRecord(Exception):
    """Bytes that do not match the checksum written beside them."""


class TruncatedRecord(CorruptRecord):
    """A record the file ends in the middle of. What a crash leaves behind.

    Separate from its parent because the two mean different things. A file that
    stops mid-record was being written when the power went, and everything
    before that point is whole. A checksum that does not match means bytes
    changed after they were written, and nothing can be assumed about them.
    """


def encode(key, value, flags=0):
    """One key and value as a self-describing run of bytes.

    Length-prefixed rather than delimited, because a value is arbitrary bytes
    and there is no byte that cannot appear inside one. A delimiter would mean
    escaping every occurrence of it, and once you escape, the length written in
    the header is no longer the length on disk.

    A value of None is a tombstone: the record that says this key is gone. It
    has to be a flag rather than an empty value, because an empty value is a
    value somebody may have meant to store.

    The flags byte holds the tombstone bit and the batch bit, which is why it
    was a byte from the start rather than a boolean.
    """
    if value is None:
        flags |= FLAG_DELETED
    body = key if value is None else key + value
    header = HEADER.pack(zlib.crc32(body), len(key), len(body) - len(key), flags)
    return header + body


def decode_record(buf, offset=0):
    """The record at `offset` as (key, value, flags, end).

    The checksum is over the body rather than the header, so a header that
    survived and a body that did not is caught rather than trusted.
    """
    body_at = offset + HEADER.size
    if body_at > len(buf):
        raise TruncatedRecord(f"header cut short at offset {offset}")
    crc, klen, vlen, flags = HEADER.unpack(buf[offset:body_at])
    end = body_at + klen + vlen
    if end > len(buf):
        raise TruncatedRecord(f"record at offset {offset} is cut short")
    body = buf[body_at:end]
    if zlib.crc32(body) != crc:
        raise CorruptRecord(f"checksum mismatch at offset {offset}")
    return body[:klen], None if flags & FLAG_DELETED else body[klen:], flags, end


def decode(buf, offset=0):
    """The record at `offset` as (key, value, end), where end starts the next."""
    key, value, _, end = decode_record(buf, offset)
    return key, value, end


@dataclass
class Stats:
    """What a store is holding, and how much of its file is worth keeping."""

    keys: int
    live_bytes: int
    dead_bytes: int
    total_bytes: int
    recovered: int
    compactions: int

    @property
    def waste(self):
        """The fraction of the log no read will reach. Zero when it is empty."""
        return self.dead_bytes / self.total_bytes if self.total_bytes else 0.0


def sync_directory(path):
    """Ask for a rename beside `path` to be on the disk, not only its contents.

    A rename changes the directory, and fsync on a file does not cover the
    directory that names it. Without this a power cut can leave a disk where
    the new log exists and the rename that pointed at it does not.

    Not every filesystem lets a directory be opened this way, so a failure here
    reports False rather than raising. The data is already safe at that point,
    what is missing is the ordering guarantee.
    """
    try:
        fd = os.open(os.path.dirname(path) or ".", os.O_RDONLY)
    except OSError:
        return False
    try:
        os.fsync(fd)
    except OSError:
        return False
    finally:
        os.close(fd)
    return True


class Store:
    """An append-only log on disk, and an index in memory that points into it.

    The index holds an offset rather than a value, which is the whole trick: a
    store can index far more data than fits in memory, because what is in
    memory is one small number per key.
    """

    def __init__(self, path, sync=False, compact_when=None):
        self.path = path
        self.sync = sync
        self.compact_when = compact_when
        self.compactions = 0
        self.index = {}
        self.recovered = 0
        # A crashed compaction leaves its half-built file behind. It was never
        # the log, so there is nothing in it to recover: the rename either
        # happened or it did not, and the log is whatever the path names.
        self.synced = None
        self.abandoned = os.path.exists(path + ".compact")
        if self.abandoned:
            os.unlink(path + ".compact")
        mode = "r+b" if os.path.exists(path) else "w+b"
        # A with-block is the right shape for a file opened, read and closed
        # inside one function. This handle has to outlive the call that opens
        # it, which is what a storage engine is, so SIM115 does not apply.
        self._file = open(path, mode)  # noqa: SIM115
        self._replay()

    def _replay(self):
        """Rebuild the index by reading the log from the start.

        The index is never written down, so opening a store costs one pass over
        the log. A later record for a key overwrites the earlier offset, which
        is how an append-only file expresses an update.
        """
        self._file.seek(0)
        buf = self._file.read()
        offset = 0
        while offset < len(buf):
            try:
                key, value, flags, end = decode_record(buf, offset)
            except TruncatedRecord:
                # A crash between writing a header and finishing its body
                # leaves exactly this. Everything before it is whole, so keep
                # that and drop the tail rather than refusing to open at all.
                self.recovered = len(buf) - offset
                self._file.truncate(offset)
                break
            if flags & FLAG_BATCH:
                self._index_batch(offset, value)
            elif value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = offset
            offset = end
        self._end = offset
        # Once, here, where the file has just been read anyway. From now on it
        # is kept up to date by hand, because the alternative is a walk over
        # every key on every write.
        self._live = sum(self._record_size(o) for o in self.index.values())

    def _index_batch(self, offset, payload):
        """Index the records packed inside one batch record.

        Their offsets are real offsets into the log, because a batch record is
        a header followed by whole records, so `_read_at` reaches them without
        knowing they were written together.
        """
        base = offset + HEADER.size
        inner = 0
        while inner < len(payload):
            key, value, end = decode(payload, inner)
            if value is None:
                self.index.pop(key, None)
            else:
                self.index[key] = base + inner
            inner = end

    def _read_at(self, offset):
        """The record stored at `offset`, read without loading the rest."""
        self._file.seek(offset)
        header = self._file.read(HEADER.size)
        if len(header) < HEADER.size:
            raise CorruptRecord(f"no record at offset {offset}")
        _, klen, vlen, _ = HEADER.unpack(header)
        key, value, _ = decode(header + self._file.read(klen + vlen))
        return key, value

    def _append(self, record):
        """Write one encoded record at the end, and return where it landed."""
        offset = self._end
        self._file.seek(offset)
        self._file.write(record)
        self._file.flush()
        if self.sync:
            os.fsync(self._file.fileno())
        self._end += len(record)
        return offset

    def _record_size(self, offset):
        """How many bytes the record at `offset` takes, without reading it."""
        self._file.seek(offset)
        return HEADER.size + sum(HEADER.unpack(self._file.read(HEADER.size))[1:3])

    def _remember(self, key, offset, size):
        """Point the index at a new record, keeping the live byte count right."""
        previous = self.index.get(key)
        if previous is not None:
            self._live -= self._record_size(previous)
        self.index[key] = offset
        self._live += size

    def _forget(self, key):
        """Drop a key from the index, keeping the live byte count right."""
        previous = self.index.pop(key, None)
        if previous is not None:
            self._live -= self._record_size(previous)

    def set(self, key, value):
        """Append the new value, then point the index at where it landed."""
        record = encode(key, value)
        self._remember(key, self._append(record), len(record))
        self._maybe_compact()

    def get(self, key, default=None):
        """The current value for `key`, or `default` if there is not one."""
        offset = self.index.get(key)
        if offset is None:
            return default
        return self._read_at(offset)[1]

    def delete(self, key):
        """Write the record that says this key is gone. True if it was there."""
        had = key in self.index
        if had:
            self._append(encode(key, None))
            self._forget(key)
            self._maybe_compact()
        return had

    def write_batch(self, changes):
        """Apply every change or none of them. Returns how many there were.

        The whole batch goes into one record, so it has one length and one
        checksum. A crash while writing it leaves a record that is cut short,
        and a record that is cut short is dropped on the next open. There is no
        state in which half a batch survived, which is what atomic means here.

        A value of None deletes, the same as it does everywhere else.
        """
        items = changes.items() if isinstance(changes, dict) else changes
        payload, placements = b"", []
        for key, value in items:
            record = encode(key, value)
            placements.append((key, value, len(payload), len(record)))
            payload += record
        if not placements:
            return 0
        base = self._append(encode(b"", payload, FLAG_BATCH)) + HEADER.size
        for key, value, at, size in placements:
            if value is None:
                self._forget(key)
            else:
                self._remember(key, base + at, size)
        self._maybe_compact()
        return len(placements)

    def keys(self):
        """Every live key. Order is insertion order, which is the dict's."""
        return list(self.index)

    def __contains__(self, key):
        return key in self.index

    def dead_bytes(self):
        """Bytes in the log that no read can reach any more.

        A running count rather than a walk over the index. Walking it means one
        seek per live key, and `_maybe_compact` asks after every write, which
        makes writing quadratic in the number of keys the store holds: three
        thousand sets measured nine milliseconds one way and seven hundred and
        forty the other.
        """
        return self._end - self._live

    def compact(self):
        """Rewrite the log with only what a read can still reach.

        Returns the bytes reclaimed. What comes out is one record per live key
        and no tombstones at all, because a tombstone exists to cancel an
        earlier record and after the rewrite there is no earlier record left to
        cancel.

        The new log is built beside the old one and moved into place, rather
        than written over it. A rewrite in place would have a window where the
        file is neither the old log nor the new one, and a crash inside that
        window loses everything.
        """
        before = self._end
        temp = self.path + ".compact"
        index = {}
        with open(temp, "wb") as out:
            for key, offset in self.index.items():
                index[key] = out.tell()
                out.write(encode(key, self._read_at(offset)[1]))
            out.flush()
            os.fsync(out.fileno())
        # Closed first because Windows will not rename over an open file.
        # POSIX would allow it, and code that only runs on POSIX is code that
        # only runs where it was written.
        self._file.close()
        os.replace(temp, self.path)
        self.synced = sync_directory(self.path)
        self._file = open(self.path, "r+b")  # noqa: SIM115
        self.index = index
        self._end = os.path.getsize(self.path)
        self.compactions += 1
        return before - self._end


    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

    def __len__(self):
        return len(self.index)

    def __iter__(self):
        """Iterating a store gives its keys, the way iterating a dict does."""
        return iter(self.index)

    def items(self):
        """Every live key and value, read one at a time rather than all at once."""
        for key, offset in list(self.index.items()):
            yield key, self._read_at(offset)[1]

    def stats(self):
        """Counts worth looking at before deciding to compact."""
        dead = self.dead_bytes()
        return Stats(keys=len(self.index), live_bytes=self._end - dead,
                     dead_bytes=dead, total_bytes=self._end,
                     recovered=self.recovered, compactions=self.compactions)

    def _maybe_compact(self):
        """Compact once dead bytes pass the threshold, if one was asked for."""
        if self.compact_when is None or not self._end:
            return False
        if self.dead_bytes() / self._end < self.compact_when:
            return False
        self.compact()
        return True

    def close(self):
        self._file.close()
~~~
