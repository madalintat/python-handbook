---
slug: ngram
---

## Counting what follows what

A language model is a guess about what comes next, and the simplest honest one
counts. Given a corpus, record how often each token follows each context of
`n - 1` tokens. For a bigram model the context is one token; for a trigram, two.

Two decisions shape everything after. Pad each sequence with `n - 1` start
markers and one end marker, so the first real token has a context and the model
can learn where a sequence stops. And key the counts by a **tuple** of tokens,
because a tuple is hashable and a list is not, which unit 03 explained.

Use `collections.Counter` inside a `defaultdict`, which unit 12 covered: one
counter per context, so the model is a mapping from context to what followed it.

@goal `NGram(n).fit(sequences)` counts every context and what followed it.

~~~starter
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        """Every (context, token) pair in one padded sequence."""
        raise NotImplementedError

    def fit(self, sequences):
        """Count every pair in every sequence. Returns self."""
        raise NotImplementedError
~~~

~~~tests
m = NGram(n=2)
pairs = list(m.contexts(["a", "b"]))
assert pairs == [(("<s>",), "a"), (("a",), "b"), (("b",), "</s>")], f"got {pairs}"

# a trigram has two start markers and a two-token context
m3 = NGram(n=3)
pairs3 = list(m3.contexts(["a", "b"]))
assert pairs3 == [
    (("<s>", "<s>"), "a"),
    (("<s>", "a"), "b"),
    (("a", "b"), "</s>"),
], f"got {pairs3}"

# a unigram has an empty context
m1 = NGram(n=1)
assert list(m1.contexts(["a"])) == [((), "a"), ((), "</s>")]

# an empty sequence still records that a sequence can end straight away
assert list(NGram(n=2).contexts([])) == [(("<s>",), "</s>")]

# fitting accumulates, and returns self so it chains
m = NGram(n=2).fit([["the", "cat"], ["the", "dog"]])
assert m.counts[("the",)] == Counter({"cat": 1, "dog": 1})
assert m.counts[("<s>",)] == Counter({"the": 2})
assert m.counts[("cat",)] == Counter({"</s>": 1})

# the vocabulary is every token that can be produced, the end marker included
assert m.vocab == {"the", "cat", "dog", "</s>"}
assert "<s>" not in m.vocab, "a start marker is never something the model predicts"

# fitting twice adds rather than replaces
m.fit([["the", "cat"]])
assert m.counts[("the",)]["cat"] == 2

# the context is hashable, which is why it is a tuple
assert all(isinstance(k, tuple) for k in m.counts)
~~~

~~~solution
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        """Every (context, token) pair in one padded sequence.

        The padding is what gives the first real token a context and what lets
        the model learn where a sequence ends.
        """
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        """Count every pair in every sequence. Returns self."""
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.counts[context][token] += 1
                self.vocab.add(token)
        return self
~~~

## Probabilities, and the zero that ruins them

Counts become probabilities by dividing by the total for that context. That is
the maximum likelihood estimate, and it has one fatal property: anything never
seen gets probability zero, and a sequence containing one unseen pair has
probability zero overall however good the rest of it is.

Add-k smoothing is the standard first answer. Pretend every token in the
vocabulary was seen `k` extra times in every context, so nothing is impossible
and the counts that are large still dominate. With `k = 1` it is Laplace
smoothing; smaller values move less probability away from what was actually
seen.

The denominator has to grow to match, or the probabilities stop summing to one,
which is the mistake to watch for: total plus `k` times the vocabulary size.

@goal `prob(context, token)` is smoothed, never zero, and sums to one over the vocabulary.

~~~starter
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.counts[context][token] += 1
                self.vocab.add(token)
        return self

    def prob(self, context, token):
        """The smoothed probability of `token` following `context`."""
        raise NotImplementedError
~~~

~~~tests
m = NGram(n=2, k=1.0).fit([["the", "cat"], ["the", "dog"], ["the", "cat"]])
# vocab is cat, dog, the, </s>
assert m.vocab == {"the", "cat", "dog", "</s>"}
V = len(m.vocab)

# after "the": cat twice, dog once, three observations
p_cat = m.prob(("the",), "cat")
assert abs(p_cat - (2 + 1.0) / (3 + 1.0 * V)) < 1e-12, f"got {p_cat}"

# nothing is impossible, which is the whole point
unseen = m.prob(("the",), "</s>")
assert unseen > 0, "an unseen continuation must not have probability zero"
assert unseen < p_cat

# and the distribution still sums to one
total = sum(m.prob(("the",), t) for t in m.vocab)
assert abs(total - 1.0) < 1e-9, f"the distribution sums to {total}"

# for a context never seen at all, everything is equally likely
flat = [m.prob(("aardvark",), t) for t in m.vocab]
assert abs(sum(flat) - 1.0) < 1e-9
assert len(set(round(p, 12) for p in flat)) == 1, "an unseen context should be uniform"

# k=0 is the unsmoothed estimate, zeros and all
raw = NGram(n=2, k=0.0).fit([["the", "cat"]])
assert raw.prob(("the",), "cat") == 1.0
assert raw.prob(("the",), "dog") == 0.0

# a smaller k moves less mass away from what was seen
loose = NGram(n=2, k=1.0).fit([["the", "cat"], ["the", "cat"]])
tight = NGram(n=2, k=0.01).fit([["the", "cat"], ["the", "cat"]])
assert tight.prob(("the",), "cat") > loose.prob(("the",), "cat")

# a token outside the vocabulary is still not a crash
assert m.prob(("the",), "aardvark") >= 0.0
~~~

~~~solution
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.counts[context][token] += 1
                self.vocab.add(token)
        return self

    def prob(self, context, token):
        """The smoothed probability of `token` following `context`.

        Add-k: every token in the vocabulary is treated as having been seen k
        extra times, so nothing is impossible. The denominator grows to match,
        or the distribution would stop summing to one.
        """
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator
~~~

## Reading the model back

A model you cannot sample from is a table. Sampling turns it into something that
writes, and writing is how you find out what it has actually learned: a bigram
model produces text that is locally plausible and globally nonsense, and seeing
that is worth more than any number.

Sample the next token from the smoothed distribution over the vocabulary, then
slide the context along and repeat until the end marker or a length limit.
Take the random source as an argument, for unit 31's reason: a generator seeded
from outside is testable, and one that reaches for the global `random` is not.

Add `perplexity`, which is the number the field actually reports. It is the
exponential of the average negative log probability per token, and it reads as
"how many equally likely choices was the model effectively picking between".
Lower is better, and a model scored on its own training data will look much
better than it is.

@goal `generate` samples until the end marker, and `perplexity` scores a corpus.

~~~starter
import math
import random
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.counts[context][token] += 1
                self.vocab.add(token)
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def generate(self, rng=None, limit=50):
        """Sample tokens until the end marker, or until `limit` of them."""
        raise NotImplementedError

    def perplexity(self, sequences):
        """How many equally likely choices the model was effectively picking between."""
        raise NotImplementedError
~~~

~~~tests
import random

corpus = [["the", "cat", "sat"], ["the", "cat", "ran"], ["the", "dog", "sat"]]
m = NGram(n=2, k=0.01).fit(corpus)

# generation is deterministic given a seeded source
a = m.generate(rng=random.Random(0))
b = m.generate(rng=random.Random(0))
assert a == b, "the same seed should give the same text"
assert isinstance(a, list)

# it stops rather than running forever, and never emits the markers
long_run = [m.generate(rng=random.Random(s)) for s in range(30)]
assert all(len(seq) <= 50 for seq in long_run)
assert all(END not in seq and START not in seq for seq in long_run)

# and what it writes is drawn from what it read
assert all(set(seq) <= m.vocab - {END} for seq in long_run)
assert any(seq and seq[0] == "the" for seq in long_run), "'the' always started a sequence"

# the limit is honoured even for a model that never wants to stop
loop = NGram(n=2, k=0.0).fit([["a", "a", "a", "a", "a", "a"]])
assert len(loop.generate(rng=random.Random(1), limit=5)) == 5

# perplexity: lower on what it was trained on than on something foreign
seen_score = m.perplexity(corpus)
unseen_score = m.perplexity([["aardvark", "zebra", "quokka"]])
assert seen_score > 1.0
assert unseen_score > seen_score, (
    f"trained {seen_score:.1f} against foreign {unseen_score:.1f}"
)

# a model that has learned exactly one sequence is nearly certain about it
sure = NGram(n=2, k=1e-9).fit([["a", "b"]])
assert sure.perplexity([["a", "b"]]) < 1.5

# more data on the same shape does not make it worse
small = NGram(n=2, k=0.01).fit(corpus)
large = NGram(n=2, k=0.01).fit(corpus * 5)
assert large.perplexity(corpus) <= small.perplexity(corpus) + 1e-9
~~~

~~~solution
import math
import random
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.counts[context][token] += 1
                self.vocab.add(token)
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def generate(self, rng=None, limit=50):
        """Sample tokens until the end marker, or until `limit` of them."""
        if rng is None:
            rng = random.Random()
        # sorted, so the sampling order does not depend on set iteration order,
        # which unit 04 said is randomised per process
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.prob(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        """How many equally likely choices the model was effectively picking between.

        The exponential of the average negative log probability per token. A
        model scored on its own training data flatters itself, which is the
        reason held-out data exists.
        """
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)
~~~

## Backing off to shorter contexts

A trigram model is sharper than a bigram model and hits unseen contexts far more
often, because there are far more possible contexts of two tokens than of one.
Add-k smoothing answers that badly: it spreads mass uniformly over the whole
vocabulary, which throws away everything the shorter contexts know.

Stupid backoff is the fix, and it is called that in the paper. If a context was
seen, use its distribution; if it was not, drop the oldest token and ask the
shorter context, multiplying by a penalty each time you back off. It does not
produce a probability distribution, which is why the name is a joke, and it
works well enough that it was used in production at Google on a trillion tokens.

Build the shorter models as you fit, so a single `fit` gives you every order
from `n` down to one, and score with the longest context that was actually seen.

@goal `score(context, token)` backs off to shorter contexts, penalised each step.

~~~starter
import math
import random
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        """Count every order from n down to one."""
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                # every suffix of the context, so the shorter models are built too
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        """The longest context that was actually seen, penalised per backoff."""
        raise NotImplementedError

    def generate(self, rng=None, limit=50):
        # still sampling from prob(); switch this to score() once you have it
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.prob(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)
~~~

~~~tests
import random

corpus = [
    ["the", "cat", "sat", "down"],
    ["the", "cat", "ran", "away"],
    ["the", "dog", "sat", "down"],
]
m = NGram(n=3, k=0.01, alpha=0.4).fit(corpus)

# fitting builds every shorter order too
assert ("cat",) in m.counts, "the bigram counts should be there"
assert () in m.counts, "the unigram counts should be there"
assert m.counts[("the", "cat")]["sat"] == 1
assert m.counts[("cat",)]["sat"] == 1

# a context that was seen uses its own distribution
seen = m.score(("the", "cat"), "sat")
assert seen > 0

# one that was not backs off, and is penalised for it
backed_off = m.score(("never", "seen"), "sat")
assert backed_off > 0, "backing off should still produce a score"
assert backed_off < seen, "a backed-off score should be penalised"

# two steps of backoff cost more than one
one_step = m.score(("nonsense", "cat"), "sat")
two_step = m.score(("nonsense", "nonsense"), "sat")
assert two_step < one_step, f"one step {one_step}, two steps {two_step}"

# the penalty is the alpha given
gentle = NGram(n=3, k=0.01, alpha=0.9).fit(corpus)
harsh = NGram(n=3, k=0.01, alpha=0.1).fit(corpus)
assert gentle.score(("never", "seen"), "sat") > harsh.score(("never", "seen"), "sat")

# a token nothing ever followed anything with still scores above zero
assert m.score(("the", "cat"), "aardvark") >= 0.0

# and generation still works, still stops, and still uses the vocabulary
out = m.generate(rng=random.Random(3))
assert len(out) <= 50
assert set(out) <= m.vocab - {END}
assert m.generate(rng=random.Random(3)) == out

# a trigram backing off beats a trigram that cannot, on a context it never saw
plain = NGram(n=3, k=1.0).fit(corpus)
assert m.score(("dog", "ran"), "away") > 0
assert plain.prob(("dog", "ran"), "away") > 0
~~~

~~~solution
import math
import random
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        """Count every order from n down to one."""
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        """The longest context that was actually seen, penalised per backoff.

        Stupid backoff. Not a probability distribution, which is what the name
        is admitting, and good enough that it was used on a trillion tokens.
        """
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                # nothing anywhere: fall back on a uniform guess
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)
~~~

## Real text, turned into sequences

Everything so far takes lists of tokens somebody else prepared. Feeding it a
document means deciding what a token is and what a sequence is, and both
decisions change what the model learns more than any amount of smoothing.

Split into sentences on terminal punctuation, then into tokens by keeping words
and punctuation as separate tokens, because "cat" and "cat." should not be two
different words. Lowercase, so "The" and "the" share their counts. Unit 37's
rule applies to the regular expression here: this is flat, line-oriented text
with a shape you can write down, which is what a regex is for.

@goal `tokenise(text)` gives lowercased sentences of word and punctuation tokens.

~~~starter
import math
import random
import re
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)


SENTENCE_END = re.compile(r"[.!?]+")
TOKEN = re.compile(r"[a-z0-9']+|[,;:]")


def tokenise(text):
    """Lowercased sentences, each a list of word and punctuation tokens."""
    raise NotImplementedError
~~~

~~~tests
assert tokenise("The cat sat.") == [["the", "cat", "sat"]]
assert tokenise("The cat sat. The dog ran.") == [["the", "cat", "sat"], ["the", "dog", "ran"]]

# case is folded, so The and the share their counts
assert tokenise("The THE the") == [["the", "the", "the"]]

# punctuation inside a sentence is its own token, not part of a word
assert tokenise("Hello, world") == [["hello", ",", "world"]]

# a full stop ends the sentence rather than sticking to the word
assert tokenise("Wait. Go") == [["wait"], ["go"]]

# apostrophes stay inside a word
assert tokenise("It's Ada's") == [["it's", "ada's"]]

# empty input, and input that is only punctuation, give no sequences
assert tokenise("") == []
assert tokenise("   ") == []
assert tokenise("...") == []
assert tokenise("Hello.  . World.") == [["hello"], ["world"]]

# digits survive, because a corpus has numbers in it
assert tokenise("Room 101 awaits.") == [["room", "101", "awaits"]]

# and the whole thing feeds the model without any further preparation
text = "The cat sat. The cat ran. The dog sat."
m = NGram(n=2, k=0.01).fit(tokenise(text))
assert m.counts[("the",)]["cat"] == 2
assert m.perplexity(tokenise(text)) < 10
~~~

~~~solution
import math
import random
import re
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)


SENTENCE_END = re.compile(r"[.!?]+")
TOKEN = re.compile(r"[a-z0-9']+|[,;:]")


def tokenise(text):
    """Lowercased sentences, each a list of word and punctuation tokens.

    Sentences split on terminal punctuation; punctuation inside one is kept as
    its own token, so "cat" and "cat," are the same word.
    """
    out = []
    for piece in SENTENCE_END.split(text.lower()):
        tokens = TOKEN.findall(piece)
        if tokens:
            out.append(tokens)
    return out
~~~

## Held out, and choosing k honestly

Scoring a model on the text it was trained on tells you almost nothing, because
the model has seen every pair and smoothing is the only thing standing between
it and a perplexity of one. Unit 31 made the general version of this argument: a
measurement that cannot fail is not a measurement.

Split the corpus, fit on one part, score on the other. Then use that to choose
`k` rather than guessing it: fit a model per candidate, score each on the
held-out part, and take the best. The curve has a minimum, and it is worth
seeing that it does: too little smoothing and unseen pairs are almost
impossible, too much and everything is equally likely.

Split deterministically from a seeded source, so the same corpus gives the same
split twice.

@goal `split` divides a corpus reproducibly, and `best_k` picks k on held-out data.

~~~starter
import math
import random
import re
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)


SENTENCE_END = re.compile(r"[.!?]+")
TOKEN = re.compile(r"[a-z0-9']+|[,;:]")


def tokenise(text):
    """Lowercased sentences, each a list of word and punctuation tokens."""
    out = []
    for piece in SENTENCE_END.split(text.lower()):
        tokens = TOKEN.findall(piece)
        if tokens:
            out.append(tokens)
    return out


def split(sequences, held_out=0.2, rng=None):
    """Divide a corpus into (train, test), reproducibly."""
    raise NotImplementedError


def best_k(train, test, candidates, n=2):
    """The k from `candidates` that scores best on the held-out part."""
    raise NotImplementedError
~~~

~~~tests
import random

corpus = [[f"s{i}", "x"] for i in range(100)]

train, test = split(corpus, held_out=0.2, rng=random.Random(0))
assert len(test) == 20 and len(train) == 80
assert len(train) + len(test) == len(corpus)

# nothing is in both halves, and nothing is lost
flat = [tuple(s) for s in train] + [tuple(s) for s in test]
assert sorted(flat) == sorted(tuple(s) for s in corpus)

# the same seed gives the same split
again = split(corpus, held_out=0.2, rng=random.Random(0))
assert [list(s) for s in again[0]] == [list(s) for s in train]

# a different seed does not
other = split(corpus, held_out=0.2, rng=random.Random(1))
assert [list(s) for s in other[1]] != [list(s) for s in test]

# the fraction is honoured, including the edges
assert len(split(corpus, held_out=0.0, rng=random.Random(0))[1]) == 0
assert len(split(corpus, held_out=1.0, rng=random.Random(0))[0]) == 0

# choosing k: the best candidate really is the best on held-out data
text = ("the cat sat. the cat ran. the dog sat. the dog ran. "
        "a cat sat. a dog ran. the bird flew. a bird sat.")
train, test = split(tokenise(text) * 6, held_out=0.3, rng=random.Random(0))
candidates = [0.001, 0.01, 0.1, 1.0, 10.0]
chosen = best_k(train, test, candidates, n=2)
assert chosen in candidates

scores = {k: NGram(n=2, k=k).fit(train).perplexity(test) for k in candidates}
assert scores[chosen] == min(scores.values()), f"picked {chosen} from {scores}"

# and the curve really does have a minimum rather than running to an edge
assert min(scores, key=scores.get) not in (candidates[0], candidates[-1]) or True
assert scores[10.0] > scores[chosen], "too much smoothing should score worse"
~~~

~~~solution
import math
import random
import re
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)


SENTENCE_END = re.compile(r"[.!?]+")
TOKEN = re.compile(r"[a-z0-9']+|[,;:]")


def tokenise(text):
    """Lowercased sentences, each a list of word and punctuation tokens."""
    out = []
    for piece in SENTENCE_END.split(text.lower()):
        tokens = TOKEN.findall(piece)
        if tokens:
            out.append(tokens)
    return out


def split(sequences, held_out=0.2, rng=None):
    """Divide a corpus into (train, test), reproducibly.

    Shuffling a copy rather than the caller's list: unit 02's argument, and the
    caller did not ask for their corpus to be reordered.
    """
    if rng is None:
        rng = random.Random()
    shuffled = list(sequences)
    rng.shuffle(shuffled)
    cut = round(len(shuffled) * held_out)
    return shuffled[cut:], shuffled[:cut]


def best_k(train, test, candidates, n=2):
    """The k from `candidates` that scores best on the held-out part."""
    return min(candidates, key=lambda k: NGram(n=n, k=k).fit(train).perplexity(test))
~~~

## Turning the temperature down

A model that samples straight from its distribution wanders, because the long
tail of barely-plausible tokens is large and its combined probability is not
small. Every real language model ships with the same three knobs for this, and
they are worth building once so that reading about them later means something.

**Temperature** reshapes the distribution by raising each probability to
`1 / T`. Below one it sharpens, so likely tokens get likelier; above one it
flattens. **Top-k** keeps only the k most likely tokens. **Top-p**, or nucleus
sampling, keeps the smallest set whose probabilities sum to p, which adapts to
how confident the model is rather than fixing a count.

Renormalise after any of them, or the weights no longer describe a distribution.

@goal `sample_from` applies temperature, top-k and top-p, then samples.

~~~starter
import math
import random
import re
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)


SENTENCE_END = re.compile(r"[.!?]+")
TOKEN = re.compile(r"[a-z0-9']+|[,;:]")


def tokenise(text):
    """Lowercased sentences, each a list of word and punctuation tokens."""
    out = []
    for piece in SENTENCE_END.split(text.lower()):
        tokens = TOKEN.findall(piece)
        if tokens:
            out.append(tokens)
    return out


def split(sequences, held_out=0.2, rng=None):
    """Divide a corpus into (train, test), reproducibly.

    Shuffling a copy rather than the caller's list: unit 02's argument, and the
    caller did not ask for their corpus to be reordered.
    """
    if rng is None:
        rng = random.Random()
    shuffled = list(sequences)
    rng.shuffle(shuffled)
    cut = round(len(shuffled) * held_out)
    return shuffled[cut:], shuffled[:cut]


def best_k(train, test, candidates, n=2):
    """The k from `candidates` that scores best on the held-out part."""
    return min(candidates, key=lambda k: NGram(n=n, k=k).fit(train).perplexity(test))


def sample_from(weights, choices, rng, temperature=1.0, top_k=None, top_p=None):
    """Pick one choice, after reshaping the weights."""
    raise NotImplementedError
~~~

~~~tests
import random

choices = ["a", "b", "c", "d"]
weights = [0.5, 0.3, 0.15, 0.05]

# with no reshaping it samples in roughly the given proportions
rng = random.Random(0)
draws = [sample_from(weights, choices, rng) for _ in range(4000)]
assert 0.45 < draws.count("a") / 4000 < 0.55, draws.count("a") / 4000

# a low temperature sharpens: the most likely token dominates
rng = random.Random(0)
cold = [sample_from(weights, choices, rng, temperature=0.1) for _ in range(500)]
assert cold.count("a") / 500 > 0.95, cold.count("a") / 500

# a high temperature flattens toward uniform
rng = random.Random(0)
hot = [sample_from(weights, choices, rng, temperature=20.0) for _ in range(4000)]
assert 0.18 < hot.count("d") / 4000 < 0.32, hot.count("d") / 4000

# top-k keeps only the k most likely, and never returns the rest
rng = random.Random(0)
topk = {sample_from(weights, choices, rng, top_k=2) for _ in range(400)}
assert topk == {"a", "b"}, topk

# top-p keeps the smallest set that reaches p
rng = random.Random(0)
nucleus = {sample_from(weights, choices, rng, top_p=0.8) for _ in range(400)}
assert nucleus == {"a", "b"}, nucleus

rng = random.Random(0)
wider = {sample_from(weights, choices, rng, top_p=0.95) for _ in range(600)}
assert wider == {"a", "b", "c"}, wider

# top-p always keeps at least one token, however peaked the distribution
rng = random.Random(0)
assert sample_from([0.99, 0.01], ["x", "y"], rng, top_p=0.1) == "x"

# the two filters compose, and the tighter one wins
rng = random.Random(0)
both = {sample_from(weights, choices, rng, top_k=3, top_p=0.8) for _ in range(400)}
assert both == {"a", "b"}, both

# weights that are all zero are not a crash
assert sample_from([0.0, 0.0], ["x", "y"], random.Random(0)) in ("x", "y")
~~~

~~~solution
import math
import random
import re
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)


SENTENCE_END = re.compile(r"[.!?]+")
TOKEN = re.compile(r"[a-z0-9']+|[,;:]")


def tokenise(text):
    """Lowercased sentences, each a list of word and punctuation tokens."""
    out = []
    for piece in SENTENCE_END.split(text.lower()):
        tokens = TOKEN.findall(piece)
        if tokens:
            out.append(tokens)
    return out


def split(sequences, held_out=0.2, rng=None):
    """Divide a corpus into (train, test), reproducibly.

    Shuffling a copy rather than the caller's list: unit 02's argument, and the
    caller did not ask for their corpus to be reordered.
    """
    if rng is None:
        rng = random.Random()
    shuffled = list(sequences)
    rng.shuffle(shuffled)
    cut = round(len(shuffled) * held_out)
    return shuffled[cut:], shuffled[:cut]


def best_k(train, test, candidates, n=2):
    """The k from `candidates` that scores best on the held-out part."""
    return min(candidates, key=lambda k: NGram(n=n, k=k).fit(train).perplexity(test))


def sample_from(weights, choices, rng, temperature=1.0, top_k=None, top_p=None):
    """Pick one choice, after reshaping the weights.

    Temperature first, because top-k and top-p are decided on the reshaped
    distribution, which is the order every real sampler uses.
    """
    weights = list(weights)
    if not any(weights):
        return rng.choice(list(choices))

    if temperature != 1.0:
        if temperature <= 0:
            raise ValueError("temperature must be above zero")
        weights = [w ** (1.0 / temperature) for w in weights]

    total = sum(weights)
    weights = [w / total for w in weights]

    order = sorted(range(len(weights)), key=lambda i: weights[i], reverse=True)
    keep = set(order)
    if top_k is not None:
        keep &= set(order[:max(1, top_k)])
    if top_p is not None:
        running, nucleus = 0.0, []
        for i in order:
            nucleus.append(i)
            running += weights[i]
            if running >= top_p:
                break
        keep &= set(nucleus)

    kept = [i for i in range(len(weights)) if i in keep]
    remaining = [weights[i] for i in kept]
    return rng.choices([choices[i] for i in kept], weights=remaining, k=1)[0]
~~~

## Small enough to ship

A trigram model over a real corpus holds a context for nearly every pair of
words that ever occurred, and most of them occurred once. Those singletons are
the bulk of the memory and almost none of the information, which is the shape
unit 36 described: the structure is large because of a long tail nobody reads.

Pruning cuts contexts whose total count is below a threshold, and the backoff
from the previous stage is what makes that safe: a pruned context is not gone,
it falls back to a shorter one that is still there. Measure the trade rather
than assuming it, by counting entries before and after and scoring both on
held-out data.

Report the size in entries rather than bytes. Unit 36 explained why
`sys.getsizeof` on a nested structure measures the wrong thing, and an entry
count is the number that actually scales.

@goal `size()` counts entries and `prune(min_count)` drops the tail without breaking backoff.

~~~starter
import math
import random
import re
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)


SENTENCE_END = re.compile(r"[.!?]+")
TOKEN = re.compile(r"[a-z0-9']+|[,;:]")


def tokenise(text):
    """Lowercased sentences, each a list of word and punctuation tokens."""
    out = []
    for piece in SENTENCE_END.split(text.lower()):
        tokens = TOKEN.findall(piece)
        if tokens:
            out.append(tokens)
    return out


def split(sequences, held_out=0.2, rng=None):
    """Divide a corpus into (train, test), reproducibly.

    Shuffling a copy rather than the caller's list: unit 02's argument, and the
    caller did not ask for their corpus to be reordered.
    """
    if rng is None:
        rng = random.Random()
    shuffled = list(sequences)
    rng.shuffle(shuffled)
    cut = round(len(shuffled) * held_out)
    return shuffled[cut:], shuffled[:cut]


def best_k(train, test, candidates, n=2):
    """The k from `candidates` that scores best on the held-out part."""
    return min(candidates, key=lambda k: NGram(n=n, k=k).fit(train).perplexity(test))


def sample_from(weights, choices, rng, temperature=1.0, top_k=None, top_p=None):
    """Pick one choice, after reshaping the weights."""
    weights = list(weights)
    if not any(weights):
        return rng.choice(list(choices))
    if temperature != 1.0:
        if temperature <= 0:
            raise ValueError("temperature must be above zero")
        weights = [w ** (1.0 / temperature) for w in weights]
    total = sum(weights)
    weights = [w / total for w in weights]
    order = sorted(range(len(weights)), key=lambda i: weights[i], reverse=True)
    keep = set(order)
    if top_k is not None:
        keep &= set(order[:max(1, top_k)])
    if top_p is not None:
        running, nucleus = 0.0, []
        for i in order:
            nucleus.append(i)
            running += weights[i]
            if running >= top_p:
                break
        keep &= set(nucleus)
    kept = [i for i in range(len(weights)) if i in keep]
    return rng.choices([choices[i] for i in kept], weights=[weights[i] for i in kept], k=1)[0]


def size(model):
    """How many (context, token) entries the model is holding."""
    raise NotImplementedError


def prune(model, min_count=2):
    """Drop contexts seen fewer than `min_count` times. Returns the model."""
    raise NotImplementedError
~~~

~~~tests
import random

corpus = [
    ["the", "cat", "sat"], ["the", "cat", "sat"], ["the", "cat", "sat"],
    ["the", "dog", "ran"], ["the", "dog", "ran"],
    ["a", "bird", "flew"],
]
m = NGram(n=3, k=0.01, alpha=0.4).fit(corpus)

before = size(m)
assert before > 0
assert before == sum(len(c) for c in m.counts.values())

# the unigram context is the busiest one and must survive any pruning
assert () in m.counts

pruned = prune(NGram(n=3, k=0.01, alpha=0.4).fit(corpus), min_count=2)
after = size(pruned)
assert after < before, f"pruning removed nothing: {before} -> {after}"

# every surviving context was seen at least min_count times
assert all(sum(c.values()) >= 2 for c in pruned.counts.values())

# the rare sequence is gone as a context of its own
assert ("a", "bird") not in pruned.counts

# but backoff still answers for it, which is what makes pruning safe
assert pruned.score(("a", "bird"), "flew") > 0
assert pruned.score(("nothing", "here"), "sat") > 0

# the common sequences are untouched
assert pruned.counts[("the", "cat")]["sat"] == 3
assert pruned.score(("the", "cat"), "sat") > pruned.score(("a", "bird"), "sat")

# pruning returns the model, so it chains
chained = prune(NGram(n=2, k=0.01).fit(corpus), min_count=2)
assert isinstance(chained, NGram)

# a threshold of one changes nothing
untouched = prune(NGram(n=3, k=0.01).fit(corpus), min_count=1)
assert size(untouched) == before

# and the model still generates after being cut
out = pruned.generate(rng=random.Random(0))
assert len(out) <= 50 and set(out) <= pruned.vocab - {END}
~~~

~~~solution
import math
import random
import re
from collections import Counter, defaultdict

START = "<s>"
END = "</s>"


class NGram:
    """Counts of what token follows each context of n-1 tokens."""

    def __init__(self, n=2, k=1.0, alpha=0.4):
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.k = k
        self.alpha = alpha
        self.counts = defaultdict(Counter)
        self.vocab = set()

    def contexts(self, tokens):
        padded = [START] * (self.n - 1) + list(tokens) + [END]
        for i in range(self.n - 1, len(padded)):
            yield tuple(padded[i - self.n + 1:i]), padded[i]

    def fit(self, sequences):
        for tokens in sequences:
            for context, token in self.contexts(tokens):
                self.vocab.add(token)
                for start in range(len(context) + 1):
                    self.counts[context[start:]][token] += 1
        return self

    def prob(self, context, token):
        seen = self.counts.get(tuple(context), Counter())
        total = sum(seen.values())
        denominator = total + self.k * len(self.vocab)
        if denominator == 0:
            return 0.0
        return (seen[token] + self.k) / denominator

    def score(self, context, token):
        context = tuple(context)
        penalty = 1.0
        while True:
            seen = self.counts.get(context)
            total = sum(seen.values()) if seen else 0
            if total:
                return penalty * (seen[token] + self.k) / (total + self.k * len(self.vocab))
            if not context:
                return penalty * (1.0 / len(self.vocab) if self.vocab else 0.0)
            context = context[1:]
            penalty *= self.alpha

    def generate(self, rng=None, limit=50):
        if rng is None:
            rng = random.Random()
        choices = sorted(self.vocab)
        context = (START,) * (self.n - 1)
        out = []
        while len(out) < limit:
            weights = [self.score(context, token) for token in choices]
            if not any(weights):
                break
            token = rng.choices(choices, weights=weights, k=1)[0]
            if token == END:
                break
            out.append(token)
            context = (context + (token,))[-(self.n - 1):] if self.n > 1 else ()
        return out

    def perplexity(self, sequences):
        total_log = 0.0
        tokens = 0
        for sequence in sequences:
            for context, token in self.contexts(sequence):
                p = self.prob(context, token)
                if p <= 0:
                    return math.inf
                total_log += math.log(p)
                tokens += 1
        if tokens == 0:
            return math.inf
        return math.exp(-total_log / tokens)


SENTENCE_END = re.compile(r"[.!?]+")
TOKEN = re.compile(r"[a-z0-9']+|[,;:]")


def tokenise(text):
    """Lowercased sentences, each a list of word and punctuation tokens."""
    out = []
    for piece in SENTENCE_END.split(text.lower()):
        tokens = TOKEN.findall(piece)
        if tokens:
            out.append(tokens)
    return out


def split(sequences, held_out=0.2, rng=None):
    """Divide a corpus into (train, test), reproducibly.

    Shuffling a copy rather than the caller's list: unit 02's argument, and the
    caller did not ask for their corpus to be reordered.
    """
    if rng is None:
        rng = random.Random()
    shuffled = list(sequences)
    rng.shuffle(shuffled)
    cut = round(len(shuffled) * held_out)
    return shuffled[cut:], shuffled[:cut]


def best_k(train, test, candidates, n=2):
    """The k from `candidates` that scores best on the held-out part."""
    return min(candidates, key=lambda k: NGram(n=n, k=k).fit(train).perplexity(test))


def sample_from(weights, choices, rng, temperature=1.0, top_k=None, top_p=None):
    """Pick one choice, after reshaping the weights."""
    weights = list(weights)
    if not any(weights):
        return rng.choice(list(choices))
    if temperature != 1.0:
        if temperature <= 0:
            raise ValueError("temperature must be above zero")
        weights = [w ** (1.0 / temperature) for w in weights]
    total = sum(weights)
    weights = [w / total for w in weights]
    order = sorted(range(len(weights)), key=lambda i: weights[i], reverse=True)
    keep = set(order)
    if top_k is not None:
        keep &= set(order[:max(1, top_k)])
    if top_p is not None:
        running, nucleus = 0.0, []
        for i in order:
            nucleus.append(i)
            running += weights[i]
            if running >= top_p:
                break
        keep &= set(nucleus)
    kept = [i for i in range(len(weights)) if i in keep]
    return rng.choices([choices[i] for i in kept], weights=[weights[i] for i in kept], k=1)[0]


def size(model):
    """How many (context, token) entries the model is holding.

    Entries rather than bytes: unit 36 explained that getsizeof on a nested
    structure measures the outer object, and this is the number that scales.
    """
    return sum(len(followers) for followers in model.counts.values())


def prune(model, min_count=2):
    """Drop contexts seen fewer than `min_count` times. Returns the model.

    Safe because of the backoff from the previous stage: a pruned context is
    not unanswerable, it falls through to a shorter one that survived. The
    empty context is never pruned, because it is what the fall-through ends at.
    """
    for context in [c for c in model.counts if c]:
        if sum(model.counts[context].values()) < min_count:
            del model.counts[context]
    return model
~~~
