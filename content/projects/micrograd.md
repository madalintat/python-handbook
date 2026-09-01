---
slug: micrograd
---

## A number that remembers

Automatic differentiation is not calculus done by a computer algebra system. It
is bookkeeping: every time you combine two numbers, record what you did and what
you did it to, and the record is enough to run the chain rule backwards
afterwards.

So the object is a number with three extra fields: the value, a gradient that
starts at zero, and the operands it came from. Overloading `__add__` and
`__mul__` is what makes the recording invisible, which is unit 22's argument
exactly: a reader who has never seen this class will predict what `a + b` means
and will be right, and the graph gets built without anybody writing graph code.

Handle the reflected forms too, so `2 * x` works when the left operand is a
plain number and knows nothing about your class.

@goal `Value` supports `+`, `*` and `-`, with numbers on either side, and records its parents.

~~~starter
class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def __add__(self, other):
        raise NotImplementedError

    def __mul__(self, other):
        raise NotImplementedError

    def __neg__(self):
        raise NotImplementedError

    def __sub__(self, other):
        raise NotImplementedError

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other
~~~

~~~tests
a = Value(2.0)
b = Value(3.0)

c = a + b
assert c.data == 5.0
assert c.parents == (a, b), "the sum should remember what it was made from"
assert c.op == "+"

d = a * b
assert d.data == 6.0
assert d.parents == (a, b)
assert d.op == "*"

# a plain number on either side becomes a Value
assert (a + 1).data == 3.0
assert (1 + a).data == 3.0
assert (a * 2).data == 4.0
assert (2 * a).data == 4.0
assert isinstance((a + 1).parents[1], Value)

# subtraction and negation
assert (a - b).data == -1.0
assert (b - a).data == 1.0
assert (-a).data == -2.0
assert (5 - a).data == 3.0

# gradients start at zero and the leaves have no parents
assert a.grad == 0.0
assert a.parents == ()
assert a.op == ""

# the graph nests, and every node keeps its own record
e = (a + b) * a
assert e.data == 10.0
assert e.op == "*"
assert e.parents[0].op == "+"
assert e.parents[1] is a

# repr says what it is without pretending to be a number
assert "Value(" in repr(a) and "grad" in repr(a)
~~~

~~~solution
class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        return Value(self.data + other.data, (self, other), "+")

    def __mul__(self, other):
        other = self._wrap(other)
        return Value(self.data * other.data, (self, other), "*")

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other
~~~

## The chain rule, run backwards

Each operation knows its own local derivative: addition passes a gradient
through unchanged, and multiplication scales each side by the other's value.
The chain rule says a node's gradient is its own local derivative times the
gradient flowing into it from above, and every node has to be visited **after**
everything that depends on it.

That ordering is a topological sort of the graph. Do it iteratively rather than
recursively, because a loss summed over a hundred samples is a chain a hundred
deep and a recursive walk of it is a stack overflow waiting for a bigger batch.

Accumulate with `+=` rather than assigning. A value used twice receives gradient
from both paths, and the whole reason `a * a` differentiates correctly is that
the two contributions add.

@goal `backward()` fills in every `grad`, correctly for values used more than once.

~~~starter
class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            raise NotImplementedError

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            raise NotImplementedError

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def order(self):
        """Every node this one depends on, parents before children."""
        raise NotImplementedError

    def backward(self):
        """Run the chain rule from this node back to every leaf."""
        raise NotImplementedError
~~~

~~~tests
# stage one still holds
a, b = Value(2.0), Value(3.0)
assert (a + b).data == 5.0 and (a * b).data == 6.0
assert (2 * a).data == 4.0 and (a - b).data == -1.0
assert (a + b).parents == (a, b)

# d = a * b, so dd/da is b and dd/db is a
a, b = Value(2.0), Value(3.0)
d = a * b
d.backward()
assert d.grad == 1.0
assert a.grad == 3.0, f"da is {a.grad}, expected b"
assert b.grad == 2.0

# a sum passes the gradient straight through
a, b = Value(2.0), Value(3.0)
s = a + b
s.backward()
assert a.grad == 1.0 and b.grad == 1.0

# the case that needs accumulation: a used twice
a = Value(3.0)
y = a * a
y.backward()
assert a.grad == 6.0, f"d(a*a)/da at 3 is 6, got {a.grad}"

# and again through a longer path
a = Value(2.0)
b = Value(4.0)
y = a * b + a
y.backward()
assert y.data == 10.0
assert a.grad == 5.0, f"b + 1 = 5, got {a.grad}"
assert b.grad == 2.0

# ordering: every parent comes before the node that uses it
a, b = Value(1.0), Value(2.0)
c = a + b
e = c * b
seq = e.order()
assert seq.index(a) < seq.index(c) < seq.index(e)
assert seq.index(b) < seq.index(c)
assert len(seq) == len(set(id(n) for n in seq)), "a node should appear once"

# gradients accumulate across passes rather than being reset, which is why
# anything that trains has to clear them between steps
a = Value(3.0)
y = a * a
y.backward()
first = a.grad
y.backward()
assert a.grad == 2 * first, (
    f"a second backward should add to the first: {first} then {a.grad}"
)

# a deep chain does not overflow the stack
x = Value(1.0)
acc = x
for _ in range(150):
    acc = acc + x
acc.backward()
assert x.grad == 151.0, f"got {x.grad}"
~~~

~~~solution
class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()
~~~

## The functions that make it a network

A network of additions and multiplications is a linear function however many
layers it has, because composing linear functions gives a linear function. The
non-linearity is what lets it represent anything else, and each one needs its
local derivative written down beside it.

`tanh` squashes to the range minus one to one, and its derivative is
`1 - tanh(x)**2`, which is worth noticing: the derivative is computed from the
output, not the input, so it costs nothing extra. `relu` is zero below zero and
the identity above, with a derivative that is zero or one and is the reason it
trains faster than `tanh` in deep networks.

Add `**` for a constant power and `/` built from it, so a loss can be written the
way it reads on paper.

@goal `tanh`, `relu`, `exp`, `**` and `/` each carry their own derivative.

~~~starter
import math


class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        raise NotImplementedError

    def __truediv__(self, other):
        raise NotImplementedError

    def __rtruediv__(self, other):
        raise NotImplementedError

    def exp(self):
        raise NotImplementedError

    def tanh(self):
        raise NotImplementedError

    def relu(self):
        raise NotImplementedError

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()
~~~

~~~tests
# stage two still holds
a = Value(3.0)
y = a * a
y.backward()
assert a.grad == 6.0

# powers
x = Value(3.0)
y = x ** 2
y.backward()
assert y.data == 9.0
assert x.grad == 6.0, f"d(x^2)/dx at 3 is 6, got {x.grad}"

x = Value(2.0)
y = x ** 3
y.backward()
assert y.data == 8.0 and x.grad == 12.0

# division, both ways round
x = Value(4.0)
y = x / 2
y.backward()
assert y.data == 2.0 and x.grad == 0.5

x = Value(4.0)
y = 8 / x
y.backward()
assert y.data == 2.0
assert abs(x.grad - (-0.5)) < 1e-9, f"d(8/x)/dx at 4 is -0.5, got {x.grad}"

# exp
x = Value(0.0)
y = x.exp()
y.backward()
assert abs(y.data - 1.0) < 1e-12
assert abs(x.grad - 1.0) < 1e-12

# tanh, and its derivative computed from its own output
x = Value(0.0)
y = x.tanh()
y.backward()
assert abs(y.data) < 1e-12
assert abs(x.grad - 1.0) < 1e-9, f"tanh'(0) is 1, got {x.grad}"

x = Value(1.0)
y = x.tanh()
y.backward()
assert abs(y.data - math.tanh(1.0)) < 1e-12
assert abs(x.grad - (1 - math.tanh(1.0) ** 2)) < 1e-9

# relu is zero below and the identity above
neg, pos = Value(-2.0), Value(2.0)
(neg.relu()).backward()
(pos.relu()).backward()
assert neg.relu().data == 0.0 and pos.relu().data == 2.0
assert neg.grad == 0.0, "relu passes no gradient below zero"
assert pos.grad == 1.0

# and the ops compose, with gradients threading all the way back
x = Value(0.5)
y = (x * 2 + 1).tanh() ** 2
y.backward()
assert x.grad != 0.0
step = 1e-6
def f(v):
    import math as _m
    return _m.tanh(v * 2 + 1) ** 2
numeric = (f(0.5 + step) - f(0.5 - step)) / (2 * step)
assert abs(x.grad - numeric) < 1e-4, f"analytic {x.grad}, numeric {numeric}"
~~~

~~~solution
import math


class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()
~~~

## Neurons, layers, a network

The pieces are in place, so the network is almost nothing: a neuron is a weighted
sum plus a bias put through a non-linearity, a layer is a row of neurons over the
same inputs, and an MLP is layers end to end.

Two details are worth being deliberate about. The last layer is **linear**, with
no `tanh` on it, because an output squashed to minus one to one cannot represent
a target outside that range and cannot be confident inside it. And every part
exposes `parameters()`, so training does not need to know the shape of the
network to find the numbers it may change.

Take the random source as an argument for unit 31's reason: a network built from
a seeded source is a network you can write a test about.

@goal `MLP(inputs, sizes, rng)` is callable, and `parameters()` reaches every weight.

~~~starter
import math

class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        raise NotImplementedError

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        raise NotImplementedError

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        raise NotImplementedError

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0
~~~

~~~tests
import random

# stage three still holds
x = Value(1.0)
y = x.tanh()
y.backward()
assert abs(x.grad - (1 - math.tanh(1.0) ** 2)) < 1e-9
x = Value(3.0)
(x ** 2).backward()
assert x.grad == 6.0

rng = random.Random(0)

# a neuron takes as many inputs as it has weights, and returns one Value
n = Neuron(3, rng)
out = n([1.0, 2.0, 3.0])
assert isinstance(out, Value)
assert -1.0 <= out.data <= 1.0, "a tanh neuron cannot leave that range"
assert len(n.parameters()) == 4, "three weights and a bias"

# a mismatched input is an error rather than a silent truncation
try:
    n([1.0, 2.0])
except ValueError:
    pass
else:
    raise AssertionError("a neuron given the wrong number of inputs should raise")

# a linear neuron is not squashed
big = Neuron(1, rng, nonlinear=False)
big.w[0].data = 100.0
big.b.data = 0.0
assert big([1.0]).data == 100.0

# a layer of one returns a Value, a layer of many returns a list
assert isinstance(Layer(2, 1, rng)([1.0, 2.0]), Value)
assert len(Layer(2, 3, rng)([1.0, 2.0])) == 3

# an MLP is callable and its last layer is linear
net = MLP(3, [4, 4, 1], rng)
y = net([1.0, 2.0, 3.0])
assert isinstance(y, Value)
assert net.layers[-1].neurons[0].nonlinear is False, "the output layer should be linear"
assert net.layers[0].neurons[0].nonlinear is True

# every parameter is reachable, and counted correctly
expected = (3 * 4 + 4) + (4 * 4 + 4) + (4 * 1 + 1)
assert len(net.parameters()) == expected, f"got {len(net.parameters())}"
assert all(isinstance(p, Value) for p in net.parameters())

# and a gradient reaches all of them
y.backward()
assert any(p.grad != 0.0 for p in net.parameters())

# the same seed builds the same network
a = MLP(2, [3, 1], random.Random(7))
b = MLP(2, [3, 1], random.Random(7))
assert [p.data for p in a.parameters()] == [p.data for p in b.parameters()]

# zero_grad clears every one
y = net([1.0, 2.0, 3.0])
y.backward()
net.zero_grad()
assert all(p.grad == 0.0 for p in net.parameters())
~~~

~~~solution
import math

class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0
~~~

## A loss that falls

Training is four lines in a loop, and the order of them is the whole thing.
Predict, measure, work out which way each parameter should move, move it.

The measurement is mean squared error: the average of the squared differences.
Squared, because a miss in either direction is a miss, and because the square is
differentiable everywhere where the absolute value is not.

Then the step. Each parameter's gradient says which way the loss increases, so
moving **against** it decreases the loss, which is the minus sign in the update
and the reason it is called gradient descent. The learning rate is how far.

Zero the gradients before every backward pass. They accumulate, deliberately,
because a value used twice needs both contributions, and the same mechanism will
happily add this step's gradients to the last one's.

@goal `train` returns a loss history that falls, and the network fits XOR.

~~~starter
import math
import random

class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0

def mse(predictions, targets):
    """Mean squared error, as a Value."""
    raise NotImplementedError


def train(net, xs, ys, steps=100, lr=0.05, loss_fn=mse):
    """Fit the network, returning the loss after each step."""
    raise NotImplementedError
~~~

~~~tests
import random

# stage four still holds
rng = random.Random(0)
net = MLP(3, [4, 1], rng)
assert isinstance(net([1.0, 2.0, 3.0]), Value)
assert len(net.parameters()) == (3 * 4 + 4) + (4 * 1 + 1)

# the loss is a Value, so it can be differentiated
loss = mse([Value(1.0), Value(3.0)], [0.0, 0.0])
assert isinstance(loss, Value)
assert abs(loss.data - 5.0) < 1e-12, f"(1 + 9) / 2 is 5, got {loss.data}"

# a perfect prediction has zero loss and a zero gradient
p = Value(2.0)
zero = mse([p], [2.0])
zero.backward()
assert zero.data == 0.0 and p.grad == 0.0

# and the gradient points away from the target
p = Value(3.0)
away = mse([p], [1.0])
away.backward()
assert p.grad > 0, "predicting too high should push the prediction down"

# XOR, which a linear model cannot do and this one can
xs = [[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]]
ys = [-1.0, 1.0, 1.0, -1.0]
net = MLP(2, [8, 8, 1], random.Random(1))
history = train(net, xs, ys, steps=300, lr=0.1)

assert len(history) == 300
assert history[-1] < history[0], f"the loss went from {history[0]} to {history[-1]}"
assert history[-1] < 0.02, f"final loss {history[-1]}, expected it to fit XOR"

# and the predictions have the right signs
predictions = [net(x).data for x in xs]
assert all((p > 0) == (y > 0) for p, y in zip(predictions, ys, strict=True)), predictions

# gradients are cleared between steps, so a second run of train still works
more = train(net, xs, ys, steps=50, lr=0.1)
assert more[-1] <= history[-1] + 1e-6

# the loss function is an argument, so another one can be used
def mae(predictions, targets):
    total = Value(0.0)
    for p, y in zip(predictions, targets, strict=True):
        diff = p - y
        total = total + (diff ** 2) ** 0.5
    return total / len(targets)


other = train(MLP(2, [8, 1], random.Random(2)), xs, ys, steps=60, lr=0.1, loss_fn=mae)
assert other[-1] < other[0]
~~~

~~~solution
import math

class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0

def mse(predictions, targets):
    """Mean squared error, as a Value."""
    total = Value(0.0)
    for p, y in zip(predictions, targets, strict=True):
        total = total + (p - y) ** 2
    return total / len(targets)


def train(net, xs, ys, steps=100, lr=0.05, loss_fn=mse):
    """Fit the network, returning the loss after each step."""
    history = []
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = loss_fn(predictions, ys)
        net.zero_grad()
        loss.backward()
        for p in net.parameters():
            p.data -= lr * p.grad
        history.append(loss.data)
    return history
~~~

## Seeing the graph

Everything so far is correct and invisible. A network that trains and a network
that trains for the wrong reason look identical from the loss curve, and the
usual way people find out which they have is to lose an afternoon.

Print the graph. Walk the nodes in topological order and render each one as its
operation, its value and its gradient, indented by depth. On a small expression
that is a picture of the chain rule: you can follow a gradient from the output
back to a leaf and check by hand that each step is the local derivative times
what came from above.

This is the tool you reach for when a gradient is zero and should not be, or is
enormous, and it costs twenty lines. Keep it to a depth limit, because the graph
for a trained network has thousands of nodes and printing all of them helps
nobody.

@goal `draw(node)` renders the graph with each node's op, value and gradient.

~~~starter
import math
import random

class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0

def mse(predictions, targets):
    """Mean squared error, as a Value."""
    total = Value(0.0)
    for p, y in zip(predictions, targets, strict=True):
        total = total + (p - y) ** 2
    return total / len(targets)


def train(net, xs, ys, steps=100, lr=0.05, loss_fn=mse):
    """Fit the network, returning the loss after each step."""
    history = []
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = loss_fn(predictions, ys)
        net.zero_grad()
        loss.backward()
        for p in net.parameters():
            p.data -= lr * p.grad
        history.append(loss.data)
    return history


def draw(node, max_depth=3):
    """The computation graph as indented text, deepest gradients last."""
    raise NotImplementedError
~~~

~~~tests
import random

# stage five still holds
xs = [[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]]
ys = [-1.0, 1.0, 1.0, -1.0]
net = MLP(2, [8, 8, 1], random.Random(1))
history = train(net, xs, ys, steps=300, lr=0.1)
assert history[-1] < 0.02

# a leaf on its own
leaf = Value(2.0)
text = draw(leaf)
assert "data=2" in text
assert text.count("\n") <= 1, "one node should be one line"

# an expression shows the operation, the value and the gradient of each node
a, b = Value(2.0), Value(3.0)
y = a * b
y.backward()
out = draw(y)
assert "*" in out
assert "data=6" in out, "the result's value should be shown"
assert "3" in out and "2" in out, "the operands' values should be shown"
assert "grad" in out.lower()

# children are indented under the node that used them
lines = [ln for ln in draw(y).split("\n") if ln.strip()]
assert len(lines) == 3, f"a*b is three nodes, got {len(lines)}"
indent = [len(ln) - len(ln.lstrip()) for ln in lines]
assert indent[0] < indent[1], "operands should be indented under the result"
assert indent[1] == indent[2], "the two operands sit at the same depth"

# the depth limit holds, and says it is holding
deep = Value(1.0)
for _ in range(10):
    deep = deep + 1
short = draw(deep, max_depth=2)
assert len(short.split("\n")) < 10, "the depth limit should cut the output"
assert "..." in short, "a cut graph should say it was cut"

# and it works on a real network without producing a wall of text
y = net([1.0, 0.0])
y.backward()
picture = draw(y, max_depth=3)
assert picture.count("\n") < 200
assert "tanh" in picture or "+" in picture or "*" in picture
~~~

~~~solution
import math

class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0

def mse(predictions, targets):
    """Mean squared error, as a Value."""
    total = Value(0.0)
    for p, y in zip(predictions, targets, strict=True):
        total = total + (p - y) ** 2
    return total / len(targets)


def train(net, xs, ys, steps=100, lr=0.05, loss_fn=mse):
    """Fit the network, returning the loss after each step."""
    history = []
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = loss_fn(predictions, ys)
        net.zero_grad()
        loss.backward()
        for p in net.parameters():
            p.data -= lr * p.grad
        history.append(loss.data)
    return history


def draw(node, max_depth=3):
    """The computation graph as indented text, deepest gradients last.

    A picture of the chain rule on a small expression: follow a gradient from
    the output back to a leaf and each step is the local derivative times what
    came from above. On a trained network, use it to find the gradient that is
    zero and should not be.
    """
    lines = []

    def render(current, depth):
        pad = "  " * depth
        label = current.op or "leaf"
        lines.append(f"{pad}{label} data={current.data:.4g} grad={current.grad:.4g}")
        if not current.parents:
            return
        if depth >= max_depth:
            lines.append(f"{pad}  ... {len(current.parents)} more")
            return
        for parent in current.parents:
            render(parent, depth + 1)

    render(node, 0)
    return "\n".join(lines)
~~~

## The failures a falling loss hides

Three bugs account for most of the time lost to training that does not work, and
none of them raises anything. A loss that will not move, a loss that goes to
infinity, and a network whose gradients are almost all zero look, from the
outside, like a model that needs more epochs.

**Forgetting to zero the gradients** makes each step move by the sum of every
gradient so far, which looks like a very large learning rate that gets larger.
**A learning rate too high** makes the loss oscillate and then overflow to `nan`,
and `nan` is contagious: one appears and everything downstream is `nan` forever.
**Saturation** is a `tanh` pushed so far from zero that its derivative rounds to
nothing, so those weights stop learning and never restart.

Build the diagnostic that names which one you have, because unit 32's argument
applies: a check that runs beats a rule you remember.

@goal `diagnose` reports divergence, whether gradients were cleared, and how many are dead.

~~~starter
import math
import random


class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0

def mse(predictions, targets):
    """Mean squared error, as a Value."""
    total = Value(0.0)
    for p, y in zip(predictions, targets, strict=True):
        total = total + (p - y) ** 2
    return total / len(targets)


def train(net, xs, ys, steps=100, lr=0.05, loss_fn=mse):
    """Fit the network, returning the loss after each step."""
    history = []
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = loss_fn(predictions, ys)
        net.zero_grad()
        loss.backward()
        for p in net.parameters():
            p.data -= lr * p.grad
        history.append(loss.data)
    return history


def draw(node, max_depth=3):
    """The computation graph as indented text, deepest gradients last.

    A picture of the chain rule on a small expression: follow a gradient from
    the output back to a leaf and each step is the local derivative times what
    came from above. On a trained network, use it to find the gradient that is
    zero and should not be.
    """
    lines = []

    def render(current, depth):
        pad = "  " * depth
        label = current.op or "leaf"
        lines.append(f"{pad}{label} data={current.data:.4g} grad={current.grad:.4g}")
        if not current.parents:
            return
        if depth >= max_depth:
            lines.append(f"{pad}  ... {len(current.parents)} more")
            return
        for parent in current.parents:
            render(parent, depth + 1)

    render(node, 0)
    return "\n".join(lines)

def diagnose(net, xs, ys, steps=30, lr=0.05, zero_grads=True):
    """Train, and report the failures a falling loss would hide.

    `zero_grads=False` reproduces the commonest of them, so the report can be
    compared against a healthy run rather than described.
    """
    raise NotImplementedError
~~~

~~~tests
import random

# stage six still holds
a, b = Value(2.0), Value(3.0)
y = a * b
y.backward()
assert "grad" in draw(y).lower()

xs = [[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]]
ys = [-1.0, 1.0, 1.0, -1.0]

# a sane run: the loss falls, nothing diverges, most gradients are alive
good = diagnose(MLP(2, [8, 1], random.Random(1)), xs, ys, steps=40, lr=0.1)
assert good["history"][-1] < good["history"][0]
assert good["diverged"] is False
assert good["dead_fraction"] < 0.5, good["dead_fraction"]
assert good["gradient_growth"] < 10, good["gradient_growth"]

# forgetting to zero them: each step moves by the sum of every gradient so far,
# which looks like a learning rate that keeps growing
forgot = diagnose(MLP(2, [8, 1], random.Random(1)), xs, ys, steps=40, lr=0.1,
                  zero_grads=False)
assert forgot["gradient_growth"] > good["gradient_growth"] * 5, (
    f"healthy {good['gradient_growth']:.2f} against unzeroed {forgot['gradient_growth']:.2f}"
)

# a learning rate far too high diverges, and says so rather than reporting a number
wild = diagnose(MLP(2, [8, 1], random.Random(1)), xs, ys, steps=40, lr=500.0)
assert wild["diverged"] is True, f"final loss {wild['final']}"

# saturation: weights pushed far from zero leave tanh with no gradient
dead_net = MLP(2, [8, 1], random.Random(1))
for p in dead_net.parameters():
    p.data = 60.0
dead = diagnose(dead_net, xs, ys, steps=5, lr=0.0)
assert dead["dead_fraction"] > 0.5, (
    f"only {dead['dead_fraction']:.0%} of gradients were dead in a saturated network"
)

# and a healthy network is not reported as saturated
assert good["dead_fraction"] < dead["dead_fraction"]

# the report carries the history, so a caller can plot or assert on it
assert len(good["history"]) == 40
assert all(isinstance(h, float) for h in good["history"])

# nan is caught rather than compared into silence
assert diagnose(MLP(2, [4, 1], random.Random(3)), xs, ys, steps=20, lr=1e6)["diverged"]
~~~

~~~solution
import math


class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0

def mse(predictions, targets):
    """Mean squared error, as a Value."""
    total = Value(0.0)
    for p, y in zip(predictions, targets, strict=True):
        total = total + (p - y) ** 2
    return total / len(targets)


def train(net, xs, ys, steps=100, lr=0.05, loss_fn=mse):
    """Fit the network, returning the loss after each step."""
    history = []
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = loss_fn(predictions, ys)
        net.zero_grad()
        loss.backward()
        for p in net.parameters():
            p.data -= lr * p.grad
        history.append(loss.data)
    return history


def draw(node, max_depth=3):
    """The computation graph as indented text, deepest gradients last.

    A picture of the chain rule on a small expression: follow a gradient from
    the output back to a leaf and each step is the local derivative times what
    came from above. On a trained network, use it to find the gradient that is
    zero and should not be.
    """
    lines = []

    def render(current, depth):
        pad = "  " * depth
        label = current.op or "leaf"
        lines.append(f"{pad}{label} data={current.data:.4g} grad={current.grad:.4g}")
        if not current.parents:
            return
        if depth >= max_depth:
            lines.append(f"{pad}  ... {len(current.parents)} more")
            return
        for parent in current.parents:
            render(parent, depth + 1)

    render(node, 0)
    return "\n".join(lines)

def diagnose(net, xs, ys, steps=30, lr=0.05, zero_grads=True):
    """Train, and report the failures a falling loss would hide.

    `zero_grads=False` reproduces the commonest of them, so the report can be
    compared against a healthy run rather than described.
    """
    history = []
    biggest = []
    dead = 0
    checked = 0
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = mse(predictions, ys)
        if zero_grads:
            net.zero_grad()
        loss.backward()
        step_max = 0.0
        for p in net.parameters():
            checked += 1
            if abs(p.grad) < 1e-9:
                dead += 1
            step_max = max(step_max, abs(p.grad))
            p.data -= lr * p.grad
        history.append(loss.data)
        biggest.append(step_max)

    diverged = any(h != h or h in (float("inf"), float("-inf")) for h in history) or (
        len(history) > 1 and history[-1] > history[0] * 10
    )
    growth = biggest[-1] / biggest[0] if biggest and biggest[0] > 0 else float("inf")
    return {
        "history": history,
        "final": history[-1],
        "diverged": diverged,
        "gradient_growth": growth,
        "dead_fraction": dead / checked if checked else 0.0,
    }
~~~

## A dataset that is not four points

XOR fits in four rows and proves the network can represent something a line
cannot. It proves nothing about training, because a model with sixty parameters
and four examples can memorise them.

Generate two interleaving half-circles, the moons dataset every library ships as
a first non-linear problem, and hold some of it back. Then measure accuracy
rather than loss, because loss is what the optimiser minimises and accuracy is
what somebody actually asked for, and the two come apart: a model can lower its
loss by becoming more confident about examples it already gets right.

Train in **batches** rather than on everything at once. The graph for one batch
is small enough to hold, the gradient is a usable estimate of the whole
gradient, and the noise in that estimate is part of why it works.

@goal `moons` makes a dataset, and training reaches high held-out accuracy.

~~~starter
import math


class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0

def mse(predictions, targets):
    """Mean squared error, as a Value."""
    total = Value(0.0)
    for p, y in zip(predictions, targets, strict=True):
        total = total + (p - y) ** 2
    return total / len(targets)


def train(net, xs, ys, steps=100, lr=0.05, loss_fn=mse):
    """Fit the network, returning the loss after each step."""
    history = []
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = loss_fn(predictions, ys)
        net.zero_grad()
        loss.backward()
        for p in net.parameters():
            p.data -= lr * p.grad
        history.append(loss.data)
    return history


def draw(node, max_depth=3):
    """The computation graph as indented text, deepest gradients last.

    A picture of the chain rule on a small expression: follow a gradient from
    the output back to a leaf and each step is the local derivative times what
    came from above. On a trained network, use it to find the gradient that is
    zero and should not be.
    """
    lines = []

    def render(current, depth):
        pad = "  " * depth
        label = current.op or "leaf"
        lines.append(f"{pad}{label} data={current.data:.4g} grad={current.grad:.4g}")
        if not current.parents:
            return
        if depth >= max_depth:
            lines.append(f"{pad}  ... {len(current.parents)} more")
            return
        for parent in current.parents:
            render(parent, depth + 1)

    render(node, 0)
    return "\n".join(lines)

def diagnose(net, xs, ys, steps=30, lr=0.05, zero_grads=True):
    """Train, and report the failures a falling loss would hide.

    `zero_grads=False` reproduces the commonest of them, so the report can be
    compared against a healthy run rather than described.
    """
    history = []
    biggest = []
    dead = 0
    checked = 0
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = mse(predictions, ys)
        if zero_grads:
            net.zero_grad()
        loss.backward()
        step_max = 0.0
        for p in net.parameters():
            checked += 1
            if abs(p.grad) < 1e-9:
                dead += 1
            step_max = max(step_max, abs(p.grad))
            p.data -= lr * p.grad
        history.append(loss.data)
        biggest.append(step_max)

    diverged = any(h != h or h in (float("inf"), float("-inf")) for h in history) or (
        len(history) > 1 and history[-1] > history[0] * 10
    )
    growth = biggest[-1] / biggest[0] if biggest and biggest[0] > 0 else float("inf")
    return {
        "history": history,
        "final": history[-1],
        "diverged": diverged,
        "gradient_growth": growth,
        "dead_fraction": dead / checked if checked else 0.0,
    }


def moons(n, noise=0.1, rng=None):
    """Two interleaving half-circles, as (xs, ys) with ys of -1 and 1."""
    raise NotImplementedError


def accuracy(net, xs, ys):
    """The fraction predicted with the right sign."""
    raise NotImplementedError


def train_batches(net, xs, ys, steps=100, lr=0.05, batch=16, rng=None):
    """Fit on a random batch each step. Returns the loss history."""
    raise NotImplementedError
~~~

~~~tests
import random

# stage seven still holds
xs4 = [[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]]
ys4 = [-1.0, 1.0, 1.0, -1.0]
good = diagnose(MLP(2, [8, 1], random.Random(1)), xs4, ys4, steps=40, lr=0.1)
assert good["diverged"] is False and good["gradient_growth"] < 10

# the dataset: two classes, two features, in balance
xs, ys = moons(200, noise=0.1, rng=random.Random(0))
assert len(xs) == len(ys) == 200
assert all(len(x) == 2 for x in xs)
assert set(ys) == {-1.0, 1.0}
assert 80 <= sum(1 for y in ys if y > 0) <= 120, "the classes should be roughly balanced"

# the same seed gives the same data
again = moons(200, noise=0.1, rng=random.Random(0))
assert again[0][:3] == xs[:3]

# noise widens the clouds
tight = moons(200, noise=0.0, rng=random.Random(0))[0]
loose = moons(200, noise=0.5, rng=random.Random(0))[0]
spread = lambda pts: max(p[1] for p in pts) - min(p[1] for p in pts)
assert spread(loose) > spread(tight)

# accuracy is a fraction, and a perfect model scores one
net = MLP(2, [16, 16, 1], random.Random(2))
assert 0.0 <= accuracy(net, xs, ys) <= 1.0

# training on batches lowers the loss and learns the shape
train_xs, train_ys = xs[:150], ys[:150]
test_xs, test_ys = xs[150:], ys[150:]
before = accuracy(net, test_xs, test_ys)
history = train_batches(net, train_xs, train_ys, steps=250, lr=0.1, batch=16,
                        rng=random.Random(3))
after = accuracy(net, test_xs, test_ys)

assert len(history) == 250
assert after > before, f"held-out accuracy went from {before:.2f} to {after:.2f}"
assert after > 0.85, f"held-out accuracy only reached {after:.2f}"

# the same seed trains identically
repeat = MLP(2, [16, 16, 1], random.Random(2))
again_hist = train_batches(repeat, train_xs, train_ys, steps=250, lr=0.1, batch=16,
                           rng=random.Random(3))
assert abs(again_hist[-1] - history[-1]) < 1e-12

# a batch larger than the data is not an error
small = MLP(2, [8, 1], random.Random(4))
assert len(train_batches(small, train_xs[:5], train_ys[:5], steps=5, batch=100,
                         rng=random.Random(0))) == 5
~~~

~~~solution
import math
import random


class Value:
    """A number that remembers how it was computed."""

    def __init__(self, data, parents=(), op=""):
        self.data = float(data)
        self.grad = 0.0
        self.parents = tuple(parents)
        self.op = op
        self._backward = lambda: None

    def __repr__(self):
        return f"Value({self.data!r}, grad={self.grad!r})"

    def _wrap(self, other):
        return other if isinstance(other, Value) else Value(other)

    def __add__(self, other):
        other = self._wrap(other)
        out = Value(self.data + other.data, (self, other), "+")

        def backward():
            # addition passes the gradient through unchanged to both sides
            self.grad += out.grad
            other.grad += out.grad

        out._backward = backward
        return out

    def __mul__(self, other):
        other = self._wrap(other)
        out = Value(self.data * other.data, (self, other), "*")

        def backward():
            # each side is scaled by the other's value
            self.grad += other.data * out.grad
            other.grad += self.data * out.grad

        out._backward = backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-self._wrap(other))

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return -self + other

    def __pow__(self, power):
        """Raise to a constant power."""
        if not isinstance(power, (int, float)):
            raise TypeError("only a constant power is supported")
        out = Value(self.data ** power, (self,), f"**{power}")

        def backward():
            self.grad += power * self.data ** (power - 1) * out.grad

        out._backward = backward
        return out

    def __truediv__(self, other):
        return self * self._wrap(other) ** -1

    def __rtruediv__(self, other):
        return self ** -1 * other

    def exp(self):
        out = Value(math.exp(self.data), (self,), "exp")

        def backward():
            # the derivative of exp is exp, which is the output already computed
            self.grad += out.data * out.grad

        out._backward = backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")

        def backward():
            # 1 - tanh(x)^2, computed from the output rather than the input
            self.grad += (1 - t * t) * out.grad

        out._backward = backward
        return out

    def relu(self):
        out = Value(self.data if self.data > 0 else 0.0, (self,), "relu")

        def backward():
            self.grad += (out.data > 0) * out.grad

        out._backward = backward
        return out

    def order(self):
        """Every node this one depends on, parents before children."""
        seen, out, stack = set(), [], [(self, False)]
        while stack:
            node, expanded = stack.pop()
            if expanded:
                out.append(node)
                continue
            if node in seen:
                continue
            seen.add(node)
            stack.append((node, True))
            for parent in node.parents:
                stack.append((parent, False))
        return out

    def backward(self):
        """Run the chain rule from this node back to every leaf.

        Gradients accumulate rather than being reset, which is what every real
        autograd does and is the whole reason zero_grad has to exist.
        """
        self.grad = 1.0
        for node in reversed(self.order()):
            node._backward()

class Neuron:
    """One unit: a weight per input, a bias, and a non-linearity."""

    def __init__(self, inputs, rng, nonlinear=True):
        self.w = [Value(rng.uniform(-1, 1)) for _ in range(inputs)]
        self.b = Value(0.0)
        self.nonlinear = nonlinear

    def __call__(self, x):
        total = self.b
        for wi, xi in zip(self.w, x, strict=True):
            total = total + wi * xi
        return total.tanh() if self.nonlinear else total

    def parameters(self):
        return [*self.w, self.b]


class Layer:
    """A row of neurons, all seeing the same inputs."""

    def __init__(self, inputs, outputs, rng, nonlinear=True):
        self.neurons = [Neuron(inputs, rng, nonlinear) for _ in range(outputs)]

    def __call__(self, x):
        out = [n(x) for n in self.neurons]
        return out[0] if len(out) == 1 else out

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    """Layers end to end. The last one is linear, so the output is unbounded."""

    def __init__(self, inputs, sizes, rng):
        widths = [inputs, *sizes]
        self.layers = [
            Layer(widths[i], widths[i + 1], rng, nonlinear=i < len(sizes) - 1)
            for i in range(len(sizes))
        ]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]

    def zero_grad(self):
        for p in self.parameters():
            p.grad = 0.0

def mse(predictions, targets):
    """Mean squared error, as a Value."""
    total = Value(0.0)
    for p, y in zip(predictions, targets, strict=True):
        total = total + (p - y) ** 2
    return total / len(targets)


def train(net, xs, ys, steps=100, lr=0.05, loss_fn=mse):
    """Fit the network, returning the loss after each step."""
    history = []
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = loss_fn(predictions, ys)
        net.zero_grad()
        loss.backward()
        for p in net.parameters():
            p.data -= lr * p.grad
        history.append(loss.data)
    return history


def draw(node, max_depth=3):
    """The computation graph as indented text, deepest gradients last.

    A picture of the chain rule on a small expression: follow a gradient from
    the output back to a leaf and each step is the local derivative times what
    came from above. On a trained network, use it to find the gradient that is
    zero and should not be.
    """
    lines = []

    def render(current, depth):
        pad = "  " * depth
        label = current.op or "leaf"
        lines.append(f"{pad}{label} data={current.data:.4g} grad={current.grad:.4g}")
        if not current.parents:
            return
        if depth >= max_depth:
            lines.append(f"{pad}  ... {len(current.parents)} more")
            return
        for parent in current.parents:
            render(parent, depth + 1)

    render(node, 0)
    return "\n".join(lines)

def diagnose(net, xs, ys, steps=30, lr=0.05, zero_grads=True):
    """Train, and report the failures a falling loss would hide.

    `zero_grads=False` reproduces the commonest of them, so the report can be
    compared against a healthy run rather than described.
    """
    history = []
    biggest = []
    dead = 0
    checked = 0
    for _ in range(steps):
        predictions = [net(x) for x in xs]
        loss = mse(predictions, ys)
        if zero_grads:
            net.zero_grad()
        loss.backward()
        step_max = 0.0
        for p in net.parameters():
            checked += 1
            if abs(p.grad) < 1e-9:
                dead += 1
            step_max = max(step_max, abs(p.grad))
            p.data -= lr * p.grad
        history.append(loss.data)
        biggest.append(step_max)

    diverged = any(h != h or h in (float("inf"), float("-inf")) for h in history) or (
        len(history) > 1 and history[-1] > history[0] * 10
    )
    growth = biggest[-1] / biggest[0] if biggest and biggest[0] > 0 else float("inf")
    return {
        "history": history,
        "final": history[-1],
        "diverged": diverged,
        "gradient_growth": growth,
        "dead_fraction": dead / checked if checked else 0.0,
    }


def moons(n, noise=0.1, rng=None):
    """Two interleaving half-circles, as (xs, ys) with ys of -1 and 1."""
    if rng is None:
        rng = random.Random()
    xs, ys = [], []
    for i in range(n):
        upper = i % 2 == 0
        angle = math.pi * rng.random()
        if upper:
            point = [math.cos(angle), math.sin(angle)]
            label = 1.0
        else:
            point = [1 - math.cos(angle), 0.5 - math.sin(angle)]
            label = -1.0
        xs.append([c + rng.gauss(0, noise) for c in point])
        ys.append(label)
    return xs, ys


def accuracy(net, xs, ys):
    """The fraction predicted with the right sign."""
    if not xs:
        return 0.0
    right = sum(1 for x, y in zip(xs, ys, strict=True) if (net(x).data > 0) == (y > 0))
    return right / len(xs)


def train_batches(net, xs, ys, steps=100, lr=0.05, batch=16, rng=None):
    """Fit on a random batch each step. Returns the loss history.

    A batch keeps the graph small enough to hold and gives a usable estimate of
    the full gradient. The noise in that estimate is part of why it works.
    """
    if rng is None:
        rng = random.Random()
    indices = list(range(len(xs)))
    history = []
    for _ in range(steps):
        chosen = rng.sample(indices, min(batch, len(indices)))
        predictions = [net(xs[i]) for i in chosen]
        loss = mse(predictions, [ys[i] for i in chosen])
        net.zero_grad()
        loss.backward()
        for p in net.parameters():
            p.data -= lr * p.grad
        history.append(loss.data)
    return history
~~~
