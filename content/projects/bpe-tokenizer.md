---
slug: bpe-tokenizer
---

## Bytes, not characters

Every tokeniser has to decide what its smallest unit is, and the answer that
survives contact with real text is the byte. Characters look tempting until the
input contains an emoji, a Chinese character or a stray byte that is not valid
UTF-8 at all, and then a character-level vocabulary is either enormous or
incomplete.

Bytes are 256 symbols, they cover every possible input by construction, and the
round trip is exact. That last property is the one to hold on to: `encode` then
`decode` must return the original text, whatever it contained, and it is the
first thing to test because every later stage can break it.

Start with the identity tokeniser: text to a list of byte values and back.

@goal `encode` and `decode` round-trip any text exactly, through byte values.

~~~starter
class Tokenizer:
    """Text to integers and back."""

    def __init__(self):
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def encode(self, text):
        """The token ids for this text."""
        raise NotImplementedError

    def decode(self, ids):
        """The text these ids stand for."""
        raise NotImplementedError
~~~

~~~tests
t = Tokenizer()

assert t.encode("abc") == [97, 98, 99]
assert t.decode([97, 98, 99]) == "abc"
assert t.encode("") == []
assert t.decode([]) == ""

# every id is a byte value
ids = t.encode("hello world")
assert all(0 <= i < 256 for i in ids)
assert len(ids) == 11

# the round trip is exact, which is the property everything else rests on
for text in ["hello", "", "a b\tc\n", "!@#$%^&*()", "0123456789"]:
    assert t.decode(t.encode(text)) == text, f"round trip failed for {text!r}"

# including everything a character-level vocabulary would struggle with
for text in ["naïve café", "日本語のテキスト", "🐍 python 🐍", "Ω≈ç√∫", "e\u0301"]:
    assert t.decode(t.encode(text)) == text, f"round trip failed for {text!r}"

# a multi-byte character really does become several tokens at this stage
assert len(t.encode("é")) == 2, "é is two bytes in UTF-8"
assert len(t.encode("🐍")) == 4

# the starting vocabulary is the 256 bytes, and nothing else yet
assert len(t.vocab) == 256
assert t.vocab[97] == b"a"
assert t.merges == {}

# a long text with everything in it
mixed = "The naïve 🐍 said: 日本語!\n\tTab\r\n"
assert t.decode(t.encode(mixed)) == mixed
~~~

~~~solution
class Tokenizer:
    """Text to integers and back."""

    def __init__(self):
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def encode(self, text):
        """The token ids for this text."""
        return list(text.encode("utf-8"))

    def decode(self, ids):
        """The text these ids stand for.

        errors="replace" rather than a crash: a model can emit any id sequence,
        including one that cuts a multi-byte character in half, and a tokeniser
        that raises on its own model's output is not usable.
        """
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~

## The commonest pair

Byte pair encoding is one idea applied over and over: find the pair of adjacent
tokens that occurs most often, invent a new token for it, and replace every
occurrence. Repeat until the vocabulary is the size you asked for.

Two helpers do all of the work, and both are worth writing separately because
both are easy to get subtly wrong. `pair_counts` counts adjacent pairs, which is
a walk over `zip(ids, ids[1:])`. `merge` replaces every occurrence of one pair
with a new id, and the trap there is overlapping matches: merging `aa` in
`aaa` must produce two tokens, not leave a dangling one or consume three.

Count deterministically. Unit 04 explained that a `Counter` tie is broken by
insertion order, so with two pairs equally common the result depends on the
order you walked the text, which is fine, and on nothing else, which matters.

@goal `pair_counts` and `merge` are exact, including on overlapping pairs.

~~~starter
from collections import Counter


class Tokenizer:
    """Text to integers and back."""

    def __init__(self):
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def encode(self, text):
        return list(text.encode("utf-8"))

    def decode(self, ids):
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    raise NotImplementedError


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    raise NotImplementedError
~~~

~~~tests
t = Tokenizer()
assert t.decode(t.encode("naïve 🐍")) == "naïve 🐍"

# counting
assert pair_counts([1, 2, 3]) == Counter({(1, 2): 1, (2, 3): 1})
assert pair_counts([1, 2, 1, 2]) == Counter({(1, 2): 2, (2, 1): 1})
assert pair_counts([]) == Counter()
assert pair_counts([1]) == Counter(), "one token has no pairs"

# overlapping pairs are counted as they occur
assert pair_counts([1, 1, 1]) == Counter({(1, 1): 2})

# merging
assert merge([1, 2, 3], (1, 2), 99) == [99, 3]
assert merge([1, 2, 3, 1, 2], (1, 2), 99) == [99, 3, 99]
assert merge([1, 2, 3], (9, 9), 99) == [1, 2, 3], "a pair that is absent changes nothing"
assert merge([], (1, 2), 99) == []
assert merge([1], (1, 2), 99) == [1]

# the overlap trap: aaa contains aa twice, and merging must not eat three
assert merge([1, 1, 1], (1, 1), 99) == [99, 1], f"got {merge([1, 1, 1], (1, 1), 99)}"
assert merge([1, 1, 1, 1], (1, 1), 99) == [99, 99]
assert merge([1, 1, 1, 1, 1], (1, 1), 99) == [99, 99, 1]

# a pair at either end
assert merge([1, 2, 5, 5], (1, 2), 99) == [99, 5, 5]
assert merge([5, 5, 1, 2], (1, 2), 99) == [5, 5, 99]

# and the two compose the way the algorithm needs
ids = t.encode("abababab")
best = pair_counts(ids).most_common(1)[0][0]
assert best == (97, 98)
merged = merge(ids, best, 256)
assert merged == [256, 256, 256, 256]
assert pair_counts(merged) == Counter({(256, 256): 3})
~~~

~~~solution
from collections import Counter


class Tokenizer:
    """Text to integers and back."""

    def __init__(self):
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def encode(self, text):
        return list(text.encode("utf-8"))

    def decode(self, ids):
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`.

    The index advances by two on a match, which is what stops `aaa` being read
    as two overlapping merges of the same middle token.
    """
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out
~~~

## Learning the merges

Now the loop. Count the pairs, take the commonest, mint a new id for it, record
the merge, and apply it. The vocabulary grows by one each time, and the sequence
gets shorter, which is the compression.

Two records have to be kept, and the difference between them is the thing to be
clear about. `merges` maps a pair to the id that replaced it, in the order they
were learned, and encoding needs that order. `vocab` maps an id to the bytes it
stands for, built by concatenating the two halves, and decoding needs that.

Stop early when the commonest pair occurs once, because merging something seen
once adds a vocabulary entry that will never be used again.

@goal `train(text, vocab_size)` learns merges in order and grows the vocabulary.

~~~starter
from collections import Counter


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self):
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def train(self, text, vocab_size, verbose=False):
        """Learn merges until the vocabulary reaches `vocab_size`."""
        raise NotImplementedError

    def encode(self, text):
        """The token ids for this text. Still one per byte, for now."""
        return list(text.encode("utf-8"))

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~

~~~tests
from collections import Counter

# stage two still holds
assert pair_counts([1, 1, 1]) == Counter({(1, 1): 2})
assert merge([1, 1, 1], (1, 1), 99) == [99, 1]

t = Tokenizer().train("abababab", vocab_size=258)
assert len(t.merges) == 2, f"asked for two merges, learned {len(t.merges)}"
assert len(t.vocab) == 258

# the first merge is the commonest pair, ab
assert (97, 98) in t.merges
assert t.merges[(97, 98)] == 256
assert t.vocab[256] == b"ab"

# the second builds on the first
assert t.merges[(256, 256)] == 257
assert t.vocab[257] == b"abab"

# train returns self, so it chains
assert isinstance(Tokenizer().train("aaaa", 257), Tokenizer)

# a vocabulary below 256 is not a vocabulary
try:
    Tokenizer().train("abc", vocab_size=100)
except ValueError:
    pass
else:
    raise AssertionError("a vocabulary smaller than the byte set should be refused")

# asking for no merges is fine and learns none
plain = Tokenizer().train("hello", vocab_size=256)
assert plain.merges == {} and len(plain.vocab) == 256

# it stops early rather than merging something seen once
short = Tokenizer().train("abcdef", vocab_size=300)
assert len(short.merges) == 0, "no pair occurs twice, so nothing is worth merging"

sparse = Tokenizer().train("aabaabcdef", vocab_size=300)
assert len(sparse.merges) >= 1, f"aa occurs twice, got {len(sparse.merges)} merges"
assert sparse.vocab[256] == b"aa", sparse.vocab[256]

# the vocabulary entries really are the concatenated bytes
t = Tokenizer().train("the theme there", vocab_size=262)
for pair, new_id in t.merges.items():
    assert t.vocab[new_id] == t.vocab[pair[0]] + t.vocab[pair[1]]

# merges are numbered in the order they were learned, with no gaps
assert sorted(t.merges.values()) == list(range(256, 256 + len(t.merges)))

# decoding still works through the new vocabulary
assert t.decode([256]) == t.vocab[256].decode("utf-8", errors="replace")
~~~

~~~solution
from collections import Counter


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self):
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def train(self, text, vocab_size, verbose=False):
        """Learn merges until the vocabulary reaches `vocab_size`."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        ids = list(text.encode("utf-8"))
        for i in range(vocab_size - 256):
            counts = pair_counts(ids)
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            ids = merge(ids, pair, new_id)
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} -> {new_id} ({self.vocab[new_id]!r})")
        return self

    def encode(self, text):
        """The token ids for this text. Still one per byte, for now."""
        return list(text.encode("utf-8"))

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~

## Encoding with what it learned

Training produced an ordered list of merges. Encoding has to apply them, and the
order is not optional: merge 257 may be built from merge 256, so applying 257
first would look for a pair that does not exist yet.

So the loop is: of the pairs currently present, find the one learned **earliest**
and apply it; repeat until no present pair was ever learned. That is a different
rule from "apply the merges in order", and it matters, because a merge learned
early can become applicable again after a later one runs.

The round trip has to survive all of it. `decode(encode(text))` must still be
exactly `text`, for text the tokeniser was trained on and text it has never seen,
which is the test that catches every off-by-one in this stage.

@goal `encode` applies merges in learned order, and the round trip stays exact.

~~~starter
from collections import Counter


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self):
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def train(self, text, vocab_size, verbose=False):
        """Learn merges until the vocabulary reaches `vocab_size`."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        ids = list(text.encode("utf-8"))
        for i in range(vocab_size - 256):
            counts = pair_counts(ids)
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            ids = merge(ids, pair, new_id)
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} -> {new_id} ({self.vocab[new_id]!r})")
        return self

    def encode(self, text):
        """The token ids for this text, merging in the order they were learned."""
        raise NotImplementedError

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~

~~~tests
# stage three still holds
t = Tokenizer().train("abababab", vocab_size=258)
assert t.merges[(97, 98)] == 256 and t.vocab[257] == b"abab"
assert len(Tokenizer().train("abcdef", vocab_size=300).merges) == 0

# encoding uses the merges, so the text is shorter than its bytes
ids = t.encode("abababab")
assert len(ids) < 8, f"eight bytes became {len(ids)} tokens"
assert ids == [257, 257], f"got {ids}"

# and the round trip is exact
assert t.decode(t.encode("abababab")) == "abababab"

# text it has never seen still round-trips
for text in ["zzz", "", "a", "ab", "🐍 naïve", "日本語", "abXab"]:
    assert t.decode(t.encode(text)) == text, f"round trip failed for {text!r}"

# order matters: the earliest applicable merge goes first
ordered = Tokenizer().train("aaaa aaaa", vocab_size=260)
assert ordered.decode(ordered.encode("aaaa aaaa")) == "aaaa aaaa"

# a longer, realistic case
corpus = ("the cat sat on the mat. the cat ate the rat. "
          "the mat was flat and the rat was fat.")
big = Tokenizer().train(corpus, vocab_size=320)
assert big.decode(big.encode(corpus)) == corpus

# it compresses what it was trained on
raw = len(corpus.encode("utf-8"))
tokens = len(big.encode(corpus))
assert tokens < raw * 0.7, f"{raw} bytes became {tokens} tokens"

# common words become single tokens
assert len(big.encode("the ")) < 4

# and every id it emits is one it knows
assert all(i in big.vocab for i in big.encode(corpus))

# encoding is deterministic
assert big.encode(corpus) == big.encode(corpus)

# a single character is not broken by an empty merge list
untrained = Tokenizer()
assert untrained.encode("hi") == [104, 105]
assert untrained.decode(untrained.encode("hi")) == "hi"
~~~

~~~solution
from collections import Counter


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self):
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def train(self, text, vocab_size, verbose=False):
        """Learn merges until the vocabulary reaches `vocab_size`."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        ids = list(text.encode("utf-8"))
        for i in range(vocab_size - 256):
            counts = pair_counts(ids)
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            ids = merge(ids, pair, new_id)
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} -> {new_id} ({self.vocab[new_id]!r})")
        return self

    def encode(self, text):
        """The token ids for this text, merging in the order they were learned."""
        ids = list(text.encode("utf-8"))
        while len(ids) >= 2:
            counts = pair_counts(ids)
            # the pair learned earliest, because a later merge may depend on it
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~


## Not letting merges cross words

Trained on plain text, byte pair encoding will happily learn `e t` as a token,
because "the the" contains it twice. That is a merge spanning a word boundary,
and it spends vocabulary on something that only helps when those two words
happen to be adjacent.

GPT-2 solved this by splitting the text with a regular expression first and
running the algorithm inside each piece, so no merge can ever cross a boundary.
The pattern keeps the leading space with the word, which is why " the" and "the"
are different tokens in every model you have used, and why a prompt ending in a
space tokenises differently from one that does not.

Unit 37's rule holds: this is flat text with a shape you can write down.

@goal Merges never cross a chunk boundary, and a leading space stays with its word.

~~~starter
import re
from collections import Counter

# GPT-2's pattern, near enough: contractions, then letters, then digits, then
# punctuation, each keeping the space in front of it. That space matters: "cat"
# at the start of a line and " cat" mid-sentence become different tokens, and
# every model you have used behaves that way for this reason.
SPLIT_PATTERN = re.compile(
    r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?[^\s\w]+|\s+(?!\S)|\s+""",
)


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self, pattern=None):
        self.pattern = pattern or SPLIT_PATTERN
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def chunks(self, text):
        """The text, split into pieces no merge may cross."""
        raise NotImplementedError

    def train(self, text, vocab_size, verbose=False):
        """Learn merges. Still over the whole text; make it use chunks()."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        ids = list(text.encode("utf-8"))
        for i in range(vocab_size - 256):
            counts = pair_counts(ids)
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            ids = merge(ids, pair, new_id)
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} to {new_id}: {self.vocab[new_id]!r}")
        return self

    def _encode_chunk(self, raw):
        ids = list(raw)
        while len(ids) >= 2:
            counts = pair_counts(ids)
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def encode(self, text):
        """The token ids for this text. Still whole-text; make it use chunks()."""
        return self._encode_chunk(text.encode("utf-8"))

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~

~~~tests
# splitting loses nothing, whatever the input
t = Tokenizer()
for text in ["", "  ", "a", "hello, world! 123", "naïve 🐍", "line\nbreak"]:
    assert "".join(t.chunks(text)) == text, f"the split lost something in {text!r}"

assert t.chunks("hello world") == ["hello", " world"], t.chunks("hello world")

# the space goes with the word that follows it
assert t.chunks("a b c") == ["a", " b", " c"]
assert t.chunks("the cat") == ["the", " cat"]

# punctuation and digits are their own chunks
assert t.chunks("cat, 42!") == ["cat", ",", " 42", "!"]

# training inside chunks: no merged token has a space in the middle of it
corpus = "the cat sat. the cat ate. the mat sat. the rat ate."
tok = Tokenizer().train(corpus, vocab_size=300)
for new_id in tok.merges.values():
    piece = tok.vocab[new_id]
    assert b" " not in piece[1:], f"token {piece!r} crosses a word boundary"

# the round trip survives, trained or not
assert tok.decode(tok.encode(corpus)) == corpus
for text in ["unseen text", "", "🐍", "the", " the"]:
    assert tok.decode(tok.encode(text)) == text, f"round trip failed for {text!r}"

# "the" at the start of a line is not " the" in the middle
assert tok.encode("the") != tok.encode(" the")

# and it still compresses what it read
assert len(tok.encode(corpus)) < len(corpus.encode("utf-8")) * 0.8
~~~

~~~solution
import re
from collections import Counter

# GPT-2's pattern, near enough: contractions, then letters, then digits, then
# punctuation, each keeping the space in front of it. That space matters: "cat"
# at the start of a line and " cat" mid-sentence become different tokens, and
# every model you have used behaves that way for this reason.
SPLIT_PATTERN = re.compile(
    r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?[^\s\w]+|\s+(?!\S)|\s+""",
)


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self, pattern=None):
        self.pattern = pattern or SPLIT_PATTERN
        self.merges = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def chunks(self, text):
        """The text, split into pieces no merge may cross."""
        return self.pattern.findall(text)

    def train(self, text, vocab_size, verbose=False):
        """Learn merges within chunks, so no token spans a word boundary."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        pieces = [list(chunk.encode("utf-8")) for chunk in self.chunks(text)]
        for i in range(vocab_size - 256):
            counts = Counter()
            for piece in pieces:
                counts.update(pair_counts(piece))
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            pieces = [merge(piece, pair, new_id) for piece in pieces]
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} to {new_id}: {self.vocab[new_id]!r}")
        return self

    def _encode_chunk(self, raw):
        ids = list(raw)
        while len(ids) >= 2:
            counts = pair_counts(ids)
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def encode(self, text):
        """The token ids for this text, one chunk at a time."""
        out = []
        for chunk in self.chunks(text):
            out.extend(self._encode_chunk(chunk.encode("utf-8")))
        return out

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~

## Tokens the text can never contain

A model needs tokens that mark structure rather than content: where a document
ends, where a conversation turn begins, where a tool call opens. They cannot be
learned from text, because they are not in the text, so they go into the
vocabulary by hand.

The interesting part is when to recognise them. If `encode` always turns the
literal string `<|endoftext|>` into the end-of-text token, then anybody who can
put text into your prompt can end the document, start a new turn, or impersonate
a system message. Every serious tokeniser therefore refuses to recognise special
tokens by default and makes the caller ask for them.

Give them ids above the learned merges, so adding one never renumbers anything
the model was trained on.

@goal Special tokens round-trip when allowed and stay literal text when not.

~~~starter
import re
from collections import Counter

# GPT-2's pattern, near enough: contractions, then letters, then digits, then
# punctuation, each keeping the space in front of it. That space matters: "cat"
# at the start of a line and " cat" mid-sentence become different tokens, and
# every model you have used behaves that way for this reason.
SPLIT_PATTERN = re.compile(
    r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?[^\s\w]+|\s+(?!\S)|\s+""",
)


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self, pattern=None):
        self.pattern = pattern or SPLIT_PATTERN
        self.merges = {}
        self.special = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def chunks(self, text):
        """The text, split into pieces no merge may cross."""
        return self.pattern.findall(text)

    def train(self, text, vocab_size, verbose=False):
        """Learn merges within chunks, so no token spans a word boundary."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        pieces = [list(chunk.encode("utf-8")) for chunk in self.chunks(text)]
        for i in range(vocab_size - 256):
            counts = Counter()
            for piece in pieces:
                counts.update(pair_counts(piece))
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            pieces = [merge(piece, pair, new_id) for piece in pieces]
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} to {new_id}: {self.vocab[new_id]!r}")
        return self

    def _encode_chunk(self, raw):
        ids = list(raw)
        while len(ids) >= 2:
            counts = pair_counts(ids)
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def register_special(self, token, token_id=None):
        """Add a token the pattern will never produce, such as <|endoftext|>."""
        raise NotImplementedError

    def encode(self, text, allow_special=False):
        """The token ids for this text. Ignores special tokens, for now."""
        return self._encode_ordinary(text)

    def _encode_ordinary(self, text):
        out = []
        for chunk in self.chunks(text):
            out.extend(self._encode_chunk(chunk.encode("utf-8")))
        return out

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~

~~~tests
# stage five still holds
t = Tokenizer()
assert t.chunks("hello world") == ["hello", " world"]
corpus = "the cat sat. the cat ate. the mat sat. the rat ate."
tok = Tokenizer().train(corpus, vocab_size=300)
assert tok.decode(tok.encode(corpus)) == corpus
for new_id in tok.merges.values():
    assert b" " not in tok.vocab[new_id][1:]

# a special token gets an id above everything learned
end = tok.register_special("<|endoftext|>")
assert end > max(tok.merges.values(), default=255)
assert tok.vocab[end] == b"<|endoftext|>"

# it is not recognised unless asked for
plain = tok.encode("hello <|endoftext|> world")
assert end not in plain, "a special token must not be recognised by default"
assert tok.decode(plain) == "hello <|endoftext|> world"

# and it is when asked for
allowed = tok.encode("hello <|endoftext|> world", allow_special=True)
assert end in allowed
assert tok.decode(allowed) == "hello <|endoftext|> world"
assert len(allowed) < len(plain), "the special token should be one id, not thirteen"

# several, including adjacent ones
turn = tok.register_special("<|turn|>")
ids = tok.encode("<|turn|><|endoftext|>", allow_special=True)
assert ids == [turn, end], ids
assert tok.decode(ids) == "<|turn|><|endoftext|>"

# a text that is only a special token, and one with none
assert tok.encode("<|turn|>", allow_special=True) == [turn]
assert tok.decode(tok.encode("nothing special", allow_special=True)) == "nothing special"

# an explicit id is honoured, and a clash is refused
chosen = tok.register_special("<|pad|>", token_id=9999)
assert chosen == 9999 and tok.vocab[9999] == b"<|pad|>"
try:
    tok.register_special("<|other|>", token_id=9999)
except ValueError:
    pass
else:
    raise AssertionError("reusing an id should be refused")

# registering does not disturb the learned merges
assert tok.decode(tok.encode(corpus)) == corpus
~~~

~~~solution
import re
from collections import Counter

# GPT-2's pattern, near enough: contractions, then letters, then digits, then
# punctuation, each keeping the space in front of it. That space matters: "cat"
# at the start of a line and " cat" mid-sentence become different tokens, and
# every model you have used behaves that way for this reason.
SPLIT_PATTERN = re.compile(
    r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?[^\s\w]+|\s+(?!\S)|\s+""",
)


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self, pattern=None):
        self.pattern = pattern or SPLIT_PATTERN
        self.merges = {}
        self.special = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def chunks(self, text):
        """The text, split into pieces no merge may cross."""
        return self.pattern.findall(text)

    def train(self, text, vocab_size, verbose=False):
        """Learn merges within chunks, so no token spans a word boundary."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        pieces = [list(chunk.encode("utf-8")) for chunk in self.chunks(text)]
        for i in range(vocab_size - 256):
            counts = Counter()
            for piece in pieces:
                counts.update(pair_counts(piece))
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            pieces = [merge(piece, pair, new_id) for piece in pieces]
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} to {new_id}: {self.vocab[new_id]!r}")
        return self

    def _encode_chunk(self, raw):
        ids = list(raw)
        while len(ids) >= 2:
            counts = pair_counts(ids)
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def register_special(self, token, token_id=None):
        """Add a token the pattern will never produce, such as <|endoftext|>."""
        if token_id is None:
            token_id = max(self.vocab) + 1
        if token_id in self.vocab:
            raise ValueError(f"id {token_id} is already {self.vocab[token_id]!r}")
        self.special[token] = token_id
        self.vocab[token_id] = token.encode("utf-8")
        return token_id

    def encode(self, text, allow_special=False):
        """The token ids for this text.

        Special tokens are not recognised unless asked for. Text from a user is
        text, and a tokeniser that turns "<|endoftext|>" typed by a stranger
        into the real end-of-text token has handed them the controls.
        """
        if not self.special or not allow_special:
            return self._encode_ordinary(text)
        pattern = "(" + "|".join(re.escape(s) for s in self.special) + ")"
        out = []
        for piece in re.split(pattern, text):
            if piece in self.special:
                out.append(self.special[piece])
            elif piece:
                out.extend(self._encode_ordinary(piece))
        return out

    def _encode_ordinary(self, text):
        out = []
        for chunk in self.chunks(text):
            out.extend(self._encode_chunk(chunk.encode("utf-8")))
        return out

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")
~~~

## Saving it where a model can find it

A tokeniser is useless if it lives only in the process that trained it. The
model was trained against one specific set of merges, and a model loaded with a
different tokeniser produces confident nonsense, so the two have to travel
together.

What has to be saved is the ordered merges and the special tokens. The
vocabulary does not, because it is derivable: every entry above 255 is the
concatenation of the two ids that made it, so rebuilding it while reading the
merges is exact and halves the file.

Write the merges in the order they were learned, because that order is the
algorithm. Put a version marker on the first line, so a file written by a later
version is refused with a message rather than misread.

@goal `save` and `load` round-trip a tokeniser exactly, vocabulary included.

~~~starter
import re
from collections import Counter

# GPT-2's pattern, near enough: contractions, then letters, then digits, then
# punctuation, each keeping the space in front of it. That space matters: "cat"
# at the start of a line and " cat" mid-sentence become different tokens, and
# every model you have used behaves that way for this reason.
SPLIT_PATTERN = re.compile(
    r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?[^\s\w]+|\s+(?!\S)|\s+""",
)


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self, pattern=None):
        self.pattern = pattern or SPLIT_PATTERN
        self.merges = {}
        self.special = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def chunks(self, text):
        """The text, split into pieces no merge may cross."""
        return self.pattern.findall(text)

    def train(self, text, vocab_size, verbose=False):
        """Learn merges within chunks, so no token spans a word boundary."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        pieces = [list(chunk.encode("utf-8")) for chunk in self.chunks(text)]
        for i in range(vocab_size - 256):
            counts = Counter()
            for piece in pieces:
                counts.update(pair_counts(piece))
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            pieces = [merge(piece, pair, new_id) for piece in pieces]
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} to {new_id}: {self.vocab[new_id]!r}")
        return self

    def _encode_chunk(self, raw):
        ids = list(raw)
        while len(ids) >= 2:
            counts = pair_counts(ids)
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def register_special(self, token, token_id=None):
        """Add a token the pattern will never produce, such as <|endoftext|>."""
        if token_id is None:
            token_id = max(self.vocab) + 1
        if token_id in self.vocab:
            raise ValueError(f"id {token_id} is already {self.vocab[token_id]!r}")
        self.special[token] = token_id
        self.vocab[token_id] = token.encode("utf-8")
        return token_id

    def encode(self, text, allow_special=False):
        """The token ids for this text.

        Special tokens are not recognised unless asked for. Text from a user is
        text, and a tokeniser that turns "<|endoftext|>" typed by a stranger
        into the real end-of-text token has handed them the controls.
        """
        if not self.special or not allow_special:
            return self._encode_ordinary(text)
        pattern = "(" + "|".join(re.escape(s) for s in self.special) + ")"
        out = []
        for piece in re.split(pattern, text):
            if piece in self.special:
                out.append(self.special[piece])
            elif piece:
                out.extend(self._encode_ordinary(piece))
        return out

    def _encode_ordinary(self, text):
        out = []
        for chunk in self.chunks(text):
            out.extend(self._encode_chunk(chunk.encode("utf-8")))
        return out

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")

    def save(self, path):
        """Write the merges and special tokens where another process can read them."""
        raise NotImplementedError

    @classmethod
    def load(cls, path):
        """Rebuild a tokeniser from a file written by save()."""
        raise NotImplementedError
~~~

~~~tests
# stage six still holds
corpus = "the cat sat. the cat ate. the mat sat. the rat ate."
tok = Tokenizer().train(corpus, vocab_size=300)
end = tok.register_special("<|endoftext|>")
assert end not in tok.encode("hello <|endoftext|>")
assert end in tok.encode("hello <|endoftext|>", allow_special=True)

tok.save("tok.txt")
loaded = Tokenizer.load("tok.txt")

# the merges survive, in order
assert loaded.merges == tok.merges
assert list(loaded.merges.values()) == list(tok.merges.values())

# the vocabulary is rebuilt rather than stored, and comes out identical
assert loaded.vocab == tok.vocab, "the rebuilt vocabulary differs"

# the special tokens survive with their ids
assert loaded.special == tok.special
assert loaded.vocab[end] == b"<|endoftext|>"

# and it encodes identically, which is the only thing that actually matters
for text in [corpus, "unseen", "", "🐍 naïve", " the", "the"]:
    assert loaded.encode(text) == tok.encode(text), f"differs on {text!r}"
    assert loaded.decode(loaded.encode(text)) == text

assert loaded.encode("a <|endoftext|> b", allow_special=True) == \
       tok.encode("a <|endoftext|> b", allow_special=True)

# an untrained tokeniser round-trips through a file too
Tokenizer().save("empty.txt")
empty = Tokenizer.load("empty.txt")
assert empty.merges == {}
assert empty.decode(empty.encode("hi")) == "hi"

# a file from something else is refused rather than misread
with open("junk.txt", "w", encoding="utf-8") as f:
    f.write("bpe v9\nnonsense\n")
try:
    Tokenizer.load("junk.txt")
except ValueError:
    pass
else:
    raise AssertionError("a file with an unknown version should be refused")

# the file is text a person can read
with open("tok.txt", encoding="utf-8") as f:
    assert f.readline().strip() == "bpe v1"
~~~

~~~solution
import re
from collections import Counter

# GPT-2's pattern, near enough: contractions, then letters, then digits, then
# punctuation, each keeping the space in front of it. That space matters: "cat"
# at the start of a line and " cat" mid-sentence become different tokens, and
# every model you have used behaves that way for this reason.
SPLIT_PATTERN = re.compile(
    r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?[^\s\w]+|\s+(?!\S)|\s+""",
)


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self, pattern=None):
        self.pattern = pattern or SPLIT_PATTERN
        self.merges = {}
        self.special = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def chunks(self, text):
        """The text, split into pieces no merge may cross."""
        return self.pattern.findall(text)

    def train(self, text, vocab_size, verbose=False):
        """Learn merges within chunks, so no token spans a word boundary."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        pieces = [list(chunk.encode("utf-8")) for chunk in self.chunks(text)]
        for i in range(vocab_size - 256):
            counts = Counter()
            for piece in pieces:
                counts.update(pair_counts(piece))
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            pieces = [merge(piece, pair, new_id) for piece in pieces]
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} to {new_id}: {self.vocab[new_id]!r}")
        return self

    def _encode_chunk(self, raw):
        ids = list(raw)
        while len(ids) >= 2:
            counts = pair_counts(ids)
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def register_special(self, token, token_id=None):
        """Add a token the pattern will never produce, such as <|endoftext|>."""
        if token_id is None:
            token_id = max(self.vocab) + 1
        if token_id in self.vocab:
            raise ValueError(f"id {token_id} is already {self.vocab[token_id]!r}")
        self.special[token] = token_id
        self.vocab[token_id] = token.encode("utf-8")
        return token_id

    def encode(self, text, allow_special=False):
        """The token ids for this text.

        Special tokens are not recognised unless asked for. Text from a user is
        text, and a tokeniser that turns "<|endoftext|>" typed by a stranger
        into the real end-of-text token has handed them the controls.
        """
        if not self.special or not allow_special:
            return self._encode_ordinary(text)
        pattern = "(" + "|".join(re.escape(s) for s in self.special) + ")"
        out = []
        for piece in re.split(pattern, text):
            if piece in self.special:
                out.append(self.special[piece])
            elif piece:
                out.extend(self._encode_ordinary(piece))
        return out

    def _encode_ordinary(self, text):
        out = []
        for chunk in self.chunks(text):
            out.extend(self._encode_chunk(chunk.encode("utf-8")))
        return out

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")

    def save(self, path):
        """Write the merges and special tokens where another process can read them."""
        with open(path, "w", encoding="utf-8") as f:
            f.write("bpe v1\n")
            f.write(f"{self.pattern.pattern}\n")
            f.write(f"{len(self.special)}\n")
            for token, token_id in self.special.items():
                f.write(f"{token} {token_id}\n")
            for (a, b), new_id in sorted(self.merges.items(), key=lambda kv: kv[1]):
                f.write(f"{a} {b} {new_id}\n")

    @classmethod
    def load(cls, path):
        """Rebuild a tokeniser from a file written by save()."""
        with open(path, encoding="utf-8") as f:
            if f.readline().strip() != "bpe v1":
                raise ValueError("not a bpe v1 file")
            tok = cls(pattern=re.compile(f.readline().rstrip("\n")))
            for _ in range(int(f.readline())):
                token, token_id = f.readline().rstrip("\n").rsplit(" ", 1)
                tok.special[token] = int(token_id)
                tok.vocab[int(token_id)] = token.encode("utf-8")
            for line in f:
                if not line.strip():
                    continue
                a, b, new_id = (int(x) for x in line.split())
                tok.merges[(a, b)] = new_id
                tok.vocab[new_id] = tok.vocab[a] + tok.vocab[b]
        return tok
~~~

## How big should the vocabulary be

The last decision is the one every real tokeniser has to make and nobody can
make from first principles: how many merges. More vocabulary means fewer tokens
per document, so more text fits in a context window and each step of the model
covers more ground. It also means a larger embedding table and more tokens the
model sees too rarely to learn well.

Measure it. **Compression** is bytes per token, which says how much the
tokeniser is buying you. **Coverage** is the fraction of emitted tokens that are
learned merges rather than raw bytes, which says whether the vocabulary matches
the text it is being used on.

Then choose: score several sizes on held-out text and take the smallest within a
percent of the best. That is why production vocabularies cluster between 32,000
and 128,000 rather than being as large as anybody can afford.

@goal `compression`, `coverage`, and a vocabulary size chosen on held-out text.

~~~starter
import re
from collections import Counter

# GPT-2's pattern, near enough: contractions, then letters, then digits, then
# punctuation, each keeping the space in front of it. That space matters: "cat"
# at the start of a line and " cat" mid-sentence become different tokens, and
# every model you have used behaves that way for this reason.
SPLIT_PATTERN = re.compile(
    r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?[^\s\w]+|\s+(?!\S)|\s+""",
)


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self, pattern=None):
        self.pattern = pattern or SPLIT_PATTERN
        self.merges = {}
        self.special = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def chunks(self, text):
        """The text, split into pieces no merge may cross."""
        return self.pattern.findall(text)

    def train(self, text, vocab_size, verbose=False):
        """Learn merges within chunks, so no token spans a word boundary."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        pieces = [list(chunk.encode("utf-8")) for chunk in self.chunks(text)]
        for i in range(vocab_size - 256):
            counts = Counter()
            for piece in pieces:
                counts.update(pair_counts(piece))
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            pieces = [merge(piece, pair, new_id) for piece in pieces]
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} to {new_id}: {self.vocab[new_id]!r}")
        return self

    def _encode_chunk(self, raw):
        ids = list(raw)
        while len(ids) >= 2:
            counts = pair_counts(ids)
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def register_special(self, token, token_id=None):
        """Add a token the pattern will never produce, such as <|endoftext|>."""
        if token_id is None:
            token_id = max(self.vocab) + 1
        if token_id in self.vocab:
            raise ValueError(f"id {token_id} is already {self.vocab[token_id]!r}")
        self.special[token] = token_id
        self.vocab[token_id] = token.encode("utf-8")
        return token_id

    def encode(self, text, allow_special=False):
        """The token ids for this text.

        Special tokens are not recognised unless asked for. Text from a user is
        text, and a tokeniser that turns "<|endoftext|>" typed by a stranger
        into the real end-of-text token has handed them the controls.
        """
        if not self.special or not allow_special:
            return self._encode_ordinary(text)
        pattern = "(" + "|".join(re.escape(s) for s in self.special) + ")"
        out = []
        for piece in re.split(pattern, text):
            if piece in self.special:
                out.append(self.special[piece])
            elif piece:
                out.extend(self._encode_ordinary(piece))
        return out

    def _encode_ordinary(self, text):
        out = []
        for chunk in self.chunks(text):
            out.extend(self._encode_chunk(chunk.encode("utf-8")))
        return out

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")

    def save(self, path):
        """Write the merges and special tokens where another process can read them."""
        with open(path, "w", encoding="utf-8") as f:
            f.write("bpe v1\n")
            f.write(f"{self.pattern.pattern}\n")
            f.write(f"{len(self.special)}\n")
            for token, token_id in self.special.items():
                f.write(f"{token} {token_id}\n")
            for (a, b), new_id in sorted(self.merges.items(), key=lambda kv: kv[1]):
                f.write(f"{a} {b} {new_id}\n")

    @classmethod
    def load(cls, path):
        """Rebuild a tokeniser from a file written by save()."""
        with open(path, encoding="utf-8") as f:
            if f.readline().strip() != "bpe v1":
                raise ValueError("not a bpe v1 file")
            tok = cls(pattern=re.compile(f.readline().rstrip("\n")))
            for _ in range(int(f.readline())):
                token, token_id = f.readline().rstrip("\n").rsplit(" ", 1)
                tok.special[token] = int(token_id)
                tok.vocab[int(token_id)] = token.encode("utf-8")
            for line in f:
                if not line.strip():
                    continue
                a, b, new_id = (int(x) for x in line.split())
                tok.merges[(a, b)] = new_id
                tok.vocab[new_id] = tok.vocab[a] + tok.vocab[b]
        return tok


def compression(tok, text):
    """Bytes per token: how much shorter the text got."""
    raise NotImplementedError


def coverage(tok, text):
    """The fraction of tokens that are learned merges rather than raw bytes."""
    raise NotImplementedError


def choose_vocab_size(text, candidates, held_out):
    """The smallest vocabulary within one percent of the best compression."""
    raise NotImplementedError
~~~

~~~tests
# stage seven still holds
corpus = "the cat sat. the cat ate. the mat sat. the rat ate."
tok = Tokenizer().train(corpus, vocab_size=300)
tok.register_special("<|endoftext|>")
tok.save("tok.txt")
assert Tokenizer.load("tok.txt").encode(corpus) == tok.encode(corpus)

# compression: one byte per token before any merges, more after
plain = Tokenizer()
assert abs(compression(plain, "abcdef") - 1.0) < 1e-9
assert compression(tok, corpus) > 1.5, compression(tok, corpus)

# an empty text is not a division by zero
assert compression(tok, "") == 0.0
assert coverage(tok, "") == 0.0

# coverage: nothing learned means nothing above 255
assert coverage(plain, "abcdef") == 0.0
assert coverage(tok, corpus) > 0.5, coverage(tok, corpus)

# and it drops on text the tokeniser was not trained for
assert coverage(tok, "zzz qqq xxx") < coverage(tok, corpus)

# more vocabulary compresses better, up to a point
train_text = (
    "the quick brown fox jumps over the lazy dog. " * 20
    + "the cat sat on the mat and the mat was flat. " * 20
)
held = "the quick cat sat over the lazy mat. " * 5

sizes = [256, 280, 320, 400]
scores = [compression(Tokenizer().train(train_text, vocab_size=s), held) for s in sizes]
assert scores[0] < scores[1] < scores[2], scores
assert scores[-1] >= scores[-2] * 0.98, "compression should not fall off a cliff"

# choosing picks a size from the candidates, and reports what it saw
chosen, scored = choose_vocab_size(train_text, sizes, held)
assert chosen in sizes
assert set(scored) == set(sizes)
assert all(v > 0 for v in scored.values())

# it prefers the smaller of two near-equal options
best = max(scored.values())
assert scored[chosen] >= best * 0.99
assert all(s >= chosen for s in sizes if scored[s] >= best * 0.99), (
    f"picked {chosen} from {scored}"
)

# and the whole thing still round-trips at the chosen size
final = Tokenizer().train(train_text, vocab_size=chosen)
assert final.decode(final.encode(held)) == held
assert final.decode(final.encode("🐍 unseen naïve text")) == "🐍 unseen naïve text"
~~~

~~~solution
import re
from collections import Counter

# GPT-2's pattern, near enough: contractions, then letters, then digits, then
# punctuation, each keeping the space in front of it. That space matters: "cat"
# at the start of a line and " cat" mid-sentence become different tokens, and
# every model you have used behaves that way for this reason.
SPLIT_PATTERN = re.compile(
    r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?[^\s\w]+|\s+(?!\S)|\s+""",
)


def pair_counts(ids):
    """How often each adjacent pair occurs."""
    return Counter(zip(ids, ids[1:], strict=False))


def merge(ids, pair, new_id):
    """Every occurrence of `pair`, replaced by `new_id`."""
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """Byte pair encoding: text to integers and back, exactly."""

    def __init__(self, pattern=None):
        self.pattern = pattern or SPLIT_PATTERN
        self.merges = {}
        self.special = {}
        self.vocab = {i: bytes([i]) for i in range(256)}

    def chunks(self, text):
        """The text, split into pieces no merge may cross."""
        return self.pattern.findall(text)

    def train(self, text, vocab_size, verbose=False):
        """Learn merges within chunks, so no token spans a word boundary."""
        if vocab_size < 256:
            raise ValueError("a vocabulary cannot be smaller than the 256 bytes")
        pieces = [list(chunk.encode("utf-8")) for chunk in self.chunks(text)]
        for i in range(vocab_size - 256):
            counts = Counter()
            for piece in pieces:
                counts.update(pair_counts(piece))
            if not counts:
                break
            pair = counts.most_common(1)[0][0]
            if counts[pair] < 2:
                break
            new_id = 256 + i
            pieces = [merge(piece, pair, new_id) for piece in pieces]
            self.merges[pair] = new_id
            self.vocab[new_id] = self.vocab[pair[0]] + self.vocab[pair[1]]
            if verbose:
                print(f"{pair} to {new_id}: {self.vocab[new_id]!r}")
        return self

    def _encode_chunk(self, raw):
        ids = list(raw)
        while len(ids) >= 2:
            counts = pair_counts(ids)
            pair = min(counts, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def register_special(self, token, token_id=None):
        """Add a token the pattern will never produce, such as <|endoftext|>."""
        if token_id is None:
            token_id = max(self.vocab) + 1
        if token_id in self.vocab:
            raise ValueError(f"id {token_id} is already {self.vocab[token_id]!r}")
        self.special[token] = token_id
        self.vocab[token_id] = token.encode("utf-8")
        return token_id

    def encode(self, text, allow_special=False):
        """The token ids for this text.

        Special tokens are not recognised unless asked for. Text from a user is
        text, and a tokeniser that turns "<|endoftext|>" typed by a stranger
        into the real end-of-text token has handed them the controls.
        """
        if not self.special or not allow_special:
            return self._encode_ordinary(text)
        pattern = "(" + "|".join(re.escape(s) for s in self.special) + ")"
        out = []
        for piece in re.split(pattern, text):
            if piece in self.special:
                out.append(self.special[piece])
            elif piece:
                out.extend(self._encode_ordinary(piece))
        return out

    def _encode_ordinary(self, text):
        out = []
        for chunk in self.chunks(text):
            out.extend(self._encode_chunk(chunk.encode("utf-8")))
        return out

    def decode(self, ids):
        """The text these ids stand for."""
        return b"".join(self.vocab[i] for i in ids).decode("utf-8", errors="replace")

    def save(self, path):
        """Write the merges and special tokens where another process can read them."""
        with open(path, "w", encoding="utf-8") as f:
            f.write("bpe v1\n")
            f.write(f"{self.pattern.pattern}\n")
            f.write(f"{len(self.special)}\n")
            for token, token_id in self.special.items():
                f.write(f"{token} {token_id}\n")
            for (a, b), new_id in sorted(self.merges.items(), key=lambda kv: kv[1]):
                f.write(f"{a} {b} {new_id}\n")

    @classmethod
    def load(cls, path):
        """Rebuild a tokeniser from a file written by save()."""
        with open(path, encoding="utf-8") as f:
            if f.readline().strip() != "bpe v1":
                raise ValueError("not a bpe v1 file")
            tok = cls(pattern=re.compile(f.readline().rstrip("\n")))
            for _ in range(int(f.readline())):
                token, token_id = f.readline().rstrip("\n").rsplit(" ", 1)
                tok.special[token] = int(token_id)
                tok.vocab[int(token_id)] = token.encode("utf-8")
            for line in f:
                if not line.strip():
                    continue
                a, b, new_id = (int(x) for x in line.split())
                tok.merges[(a, b)] = new_id
                tok.vocab[new_id] = tok.vocab[a] + tok.vocab[b]
        return tok


def compression(tok, text):
    """Bytes per token: how much shorter the text got."""
    tokens = len(tok.encode(text))
    return len(text.encode("utf-8")) / tokens if tokens else 0.0


def coverage(tok, text):
    """The fraction of tokens that are learned merges rather than raw bytes."""
    ids = tok.encode(text)
    if not ids:
        return 0.0
    return sum(1 for i in ids if i >= 256) / len(ids)


def choose_vocab_size(text, candidates, held_out):
    """The smallest vocabulary within one percent of the best compression."""
    scored = {size: compression(Tokenizer().train(text, vocab_size=size), held_out)
              for size in candidates}
    best = max(scored.values())
    for size in sorted(scored):
        if scored[size] >= best * 0.99:
            return size, scored
    return max(candidates), scored
~~~
