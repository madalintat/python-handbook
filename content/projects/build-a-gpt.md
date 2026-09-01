---
slug: build-a-gpt
---

## The number that remembers where it came from

Everything here rests on one class, and you have written it before. This is
micrograd, condensed, with the operations a transformer needs that the original
did not have: `exp` and `log` for softmax and the loss, and a power for the
scaling inside attention.

The idea is unchanged. Every operation makes a new value and records how to
push a gradient back to the values it came from. `backward` walks that record
once, in reverse, and each node adds its contribution to what came before it.
The adding matters: a value used twice is on two paths and both of them count,
which is why gradients accumulate and why zeroing them is a separate step you
have to remember.

Two things are different, and neither is tidiness.

The topological sort is a loop with an explicit stack rather than a recursive
function. A graph running through a few transformer layers is thousands of
nodes deep, and a recursive walk of it runs out of stack long before it runs
out of graph. The test builds a chain of two thousand and checks the gradient
arrives at the far end.

And each backward closure takes the gradient as an argument rather than reading
it off the value it belongs to. Reading it would mean the closure holds that
value and the value holds the closure, which is a cycle, and a cycle is the one
thing reference counting cannot free. Every node in the graph would be one.
This way the graph only ever points downward, at the values an operation came
from, and it is freed as soon as the last name for it goes away. It costs one
parameter, and stage ten is where the bill for the other choice would land.

The way to test an autograd engine is not to check the numbers you derived by
hand. It is finite differences: nudge an input, see how much the output moved,
divide. That needs no autograd at all, which is exactly what makes it a test of
one.

@goal `Value` differentiates anything built from it, and agrees with the nudge.

~~~starter
import math


class Value:
    """One number, and the derivative of the loss with respect to it."""

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        raise NotImplementedError

    def __mul__(self, other):
        raise NotImplementedError

    def __pow__(self, power):
        raise NotImplementedError

    def exp(self):
        raise NotImplementedError

    def log(self):
        raise NotImplementedError

    def tanh(self):
        raise NotImplementedError

    def relu(self):
        raise NotImplementedError

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards."""
        raise NotImplementedError

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""
~~~

~~~tests
import math


def numeric_grad(f, *args, h=1e-6):
    """The gradient by finite differences, which is the honest way to check one.

    Nudge each input up and down, see how much the output moved, divide. It is
    slow and slightly wrong and it needs no autograd at all, which is exactly
    what makes it a test of one.
    """
    grads = []
    for i in range(len(args)):
        up = list(args)
        down = list(args)
        up[i] += h
        down[i] -= h
        grads.append((f(*up) - f(*down)) / (2 * h))
    return grads


def check(build, plain, *args):
    """Build the same expression twice and compare the gradients."""
    values = [Value(a) for a in args]
    out = build(*values)
    out.backward()
    assert abs(out.data - plain(*args)) < 1e-9, (out.data, plain(*args))
    for value, expected in zip(values, numeric_grad(plain, *args)):
        assert abs(value.grad - expected) < 1e-5, (value.grad, expected)


# the forward pass is arithmetic
assert (Value(2) + Value(3)).data == 5.0
assert (Value(2) * Value(3)).data == 6.0
assert (Value(2) ** 3).data == 8.0
assert (Value(6) / Value(2)).data == 3.0
assert (Value(2) - Value(5)).data == -3.0
assert (-Value(2)).data == -2.0

# numbers on either side, so an expression reads the way it is written
assert (2 + Value(3)).data == 5.0
assert (2 * Value(3)).data == 6.0
assert (10 - Value(3)).data == 7.0
assert (12 / Value(3)).data == 4.0
assert (Value(3) + 2).data == 5.0

# and the backward pass agrees with a numerical derivative
check(lambda a, b: a * b, lambda a, b: a * b, 2.0, -3.0)
check(lambda a, b: a * b + a, lambda a, b: a * b + a, 2.0, -3.0)
check(lambda a: a ** 3, lambda a: a ** 3, 1.5)
check(lambda a: a ** -1, lambda a: a ** -1, 2.5)
check(lambda a, b: a / b, lambda a, b: a / b, 3.0, 4.0)
check(lambda a: a.exp(), math.exp, 0.7)
check(lambda a: a.log(), math.log, 2.3)
check(lambda a: a.tanh(), math.tanh, 0.4)
check(lambda a, b: (a * b + a.exp()).tanh(),
      lambda a, b: math.tanh(a * b + math.exp(a)), 2.0, -3.0)
check(lambda a, b: (a - b) ** 2, lambda a, b: (a - b) ** 2, 1.0, 4.0)
check(lambda a, b, c: (a * b).tanh() / c.exp(),
      lambda a, b, c: math.tanh(a * b) / math.exp(c), 0.5, 1.5, 0.3)

# relu has a corner rather than a curve, so it is checked by hand
positive = Value(2.0)
positive.relu().backward()
assert positive.relu().data == 2.0 and positive.grad == 1.0
negative = Value(-2.0)
negative.relu().backward()
assert negative.relu().data == 0.0 and negative.grad == 0.0

# a value used twice accumulates both contributions rather than keeping one
x = Value(3.0)
(x * x).backward()
assert x.grad == 6.0, "d(x*x)/dx is 2x, which needs both edges to add up"

x = Value(2.0)
y = x + x + x
y.backward()
assert x.grad == 3.0

# and a value reached by two different paths gets both
a = Value(2.0)
b = a * 3
c = a * 5
(b + c).backward()
assert a.grad == 8.0

# gradients start at zero and add up, which is what makes zeroing necessary
w = Value(1.0)
(w * 2).backward()
assert w.grad == 2.0
(w * 2).backward()
assert w.grad == 4.0, "a second backward adds to the first, it does not replace it"
w.grad = 0.0
(w * 2).backward()
assert w.grad == 2.0

# a graph deeper than the interpreter's stack, which is why the walk is a loop
deep = Value(1.0)
node = deep
for _ in range(2000):
    node = node * 1.0 + 0.0
node.backward()
assert abs(deep.grad - 1.0) < 1e-9, deep.grad

# the errors that mean something has gone wrong upstream
try:
    Value(-1.0).log()
except ValueError as exc:
    assert "no gradient" in str(exc)
else:
    raise AssertionError("log of a negative number is not a number")

try:
    Value(2.0) ** Value(3.0)
except TypeError:
    pass
else:
    raise AssertionError("only a plain number power")

assert repr(Value(1.5)) == "Value(1.5000, grad=0.0000)"

# and the shape of a training step, in miniature: one parameter, one target
weight = Value(0.0)
for _ in range(200):
    loss = (weight * 2 - 6) ** 2
    weight.grad = 0.0
    loss.backward()
    weight.data -= 0.01 * weight.grad
assert abs(weight.data - 3.0) < 1e-6, weight.data
~~~

~~~solution
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""
~~~

## A grid of them, and the four operations that matter

numpy is not here, and that is the point rather than a limitation. Every
operation below is the definition rather than a call into somebody else's C, so
when attention multiplies two matrices later, you will have written the
multiply.

Two dimensions and no more. A batch is a loop over sequences rather than a
third axis, which keeps every shape check to one comparison and every operation
to something readable in one sitting. Real implementations carry the batch as
an axis because a GPU wants it that way, and nothing about the mathematics
changes.

Two decisions in here are about the size of the graph rather than the answer.
A dot product starts from the first product instead of from zero, because
starting at zero builds one extra node per element and there are a lot of
elements. And the matrix multiply transposes the right operand once, so its
inner loop walks a list rather than striding across rows, which in pure Python
is most of the cost.

The only broadcast is one row added to every row, because that is what a bias
is and nothing else here needs one.

Every `zip` here is `strict=True`. Left alone, `zip` stops at the shorter
argument and says nothing, so a shape bug becomes a quietly smaller answer
instead of an error. Here the lengths are equal by construction, which means
the check can never fire, and a check that can never fire is the cheapest way
to say so out loud.

@goal `Tensor` multiplies, adds and broadcasts, and gradients flow through it.

~~~starter
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def dot(row, column):
    """The sum of the products, started from the first one."""
    raise NotImplementedError


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs."""

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        raise NotImplementedError

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        raise NotImplementedError

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        raise NotImplementedError

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        raise NotImplementedError

    def __matmul__(self, other):
        raise NotImplementedError

    def __add__(self, other):
        raise NotImplementedError

    def __mul__(self, other):
        raise NotImplementedError

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        raise NotImplementedError

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        raise NotImplementedError

    def total(self):
        raise NotImplementedError

    def mean(self):
        raise NotImplementedError

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        raise NotImplementedError

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"
~~~

~~~tests
import math
import random

# stage one still holds
x = Value(3.0)
(x * x).backward()
assert x.grad == 6.0

# a tensor is a rectangle, and says so when it is not
grid = Tensor([[1, 2, 3], [4, 5, 6]])
assert grid.shape == (2, 3)
assert grid.tolist() == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
assert all(isinstance(v, Value) for v in grid.values())
assert repr(grid) == "Tensor(2x3)"

try:
    Tensor([[1, 2], [3]])
except ValueError as exc:
    assert "rectangular" in str(exc)
else:
    raise AssertionError("a ragged grid is not a tensor")

assert Tensor.zeros(2, 3).tolist() == [[0.0] * 3] * 2
assert Tensor.zeros(2, 3).shape == (2, 3)

# a seeded generator makes a run repeatable, which matters more than it sounds
first = Tensor.randn(3, 4, random.Random(7)).tolist()
again = Tensor.randn(3, 4, random.Random(7)).tolist()
assert first == again, "the same seed has to give the same numbers"
assert first != Tensor.randn(3, 4, random.Random(8)).tolist()
assert Tensor.randn(3, 4, random.Random(7)).shape == (3, 4)

wide = Tensor.randn(200, 2, random.Random(1), std=0.02).tolist()
flat = [v for row in wide for v in row]
assert abs(sum(flat) / len(flat)) < 0.01, "centred on zero"
assert max(abs(v) for v in flat) < 0.2, "and small, which std=0.02 means"

# transpose
assert Tensor([[1, 2, 3], [4, 5, 6]]).transpose().tolist() == [
    [1.0, 4.0], [2.0, 5.0], [3.0, 6.0]
]
assert grid.transpose().transpose().tolist() == grid.tolist()

# matrix multiplication, done by hand and checked by hand
a = Tensor([[1, 2], [3, 4]])
b = Tensor([[5, 6], [7, 8]])
assert (a @ b).tolist() == [[19.0, 22.0], [43.0, 50.0]]
assert (Tensor([[1, 2, 3]]) @ Tensor([[1], [1], [1]])).tolist() == [[6.0]]
assert (Tensor([[1, 2, 3], [4, 5, 6]]) @ Tensor.zeros(3, 4)).shape == (2, 4)

try:
    Tensor.zeros(2, 3) @ Tensor.zeros(4, 5)
except ValueError as exc:
    assert "cannot multiply" in str(exc)
else:
    raise AssertionError("the inner dimensions have to agree")

# addition, elementwise
assert (Tensor([[1, 2]]) + Tensor([[10, 20]])).tolist() == [[11.0, 22.0]]
assert (Tensor([[1, 2]]) + 5).tolist() == [[6.0, 7.0]]
assert (5 + Tensor([[1, 2]])).tolist() == [[6.0, 7.0]]

# and one row added to every row, which is the only broadcast needed
biased = Tensor([[1, 2, 3], [4, 5, 6]]) + Tensor([[10, 20, 30]])
assert biased.tolist() == [[11.0, 22.0, 33.0], [14.0, 25.0, 36.0]]

try:
    Tensor.zeros(2, 3) + Tensor.zeros(3, 3)
except ValueError as exc:
    assert "cannot add" in str(exc)
else:
    raise AssertionError("those shapes do not add")

# multiplication elementwise and by a number
assert (Tensor([[2, 3]]) * Tensor([[4, 5]])).tolist() == [[8.0, 15.0]]
assert (Tensor([[2, 3]]) * 10).tolist() == [[20.0, 30.0]]
assert (10 * Tensor([[2, 3]])).tolist() == [[20.0, 30.0]]

# anything elementwise
assert Tensor([[0, 1]]).apply(lambda v: v.exp()).tolist() == [[1.0, math.e]]
assert Tensor([[-1, 2]]).apply(lambda v: v.relu()).tolist() == [[0.0, 2.0]]

# reductions
assert Tensor([[1, 2], [3, 4]]).total().data == 10.0
assert Tensor([[1, 2], [3, 4]]).mean().data == 2.5
assert len(Tensor.zeros(3, 4).values()) == 12

# the point of all of it: the gradients still flow through
weights = Tensor([[1.0, 2.0], [3.0, 4.0]])
inputs = Tensor([[5.0, 6.0]])
(inputs @ weights).total().backward()

# d(sum of x @ W)/dW[i][j] is x[i], summed over the one row here
assert weights[0][0].grad == 5.0
assert weights[0][1].grad == 5.0
assert weights[1][0].grad == 6.0
assert inputs[0][0].grad == 3.0, "row 0 of W sums to 1 + 2"
assert inputs[0][1].grad == 7.0, "row 1 of W sums to 3 + 4"

# and through a chain of them, which is what a layer is
rng = random.Random(0)
w1, w2 = Tensor.randn(4, 6, rng, 0.5), Tensor.randn(6, 3, rng, 0.5)
out = ((Tensor.randn(2, 4, rng) @ w1).apply(lambda v: v.tanh()) @ w2)
assert out.shape == (2, 3)
out.total().backward()
assert any(v.grad != 0.0 for v in w1.values()), "the far end got a gradient"
assert any(v.grad != 0.0 for v in w2.values())

# a dot product starts from the first product rather than from zero, so a
# row of n makes n-1 additions rather than n
assert dot([Value(2), Value(3)], [Value(4), Value(5)]).data == 23.0
assert len(dot([Value(1)], [Value(2)])._prev) == 2
~~~

~~~solution
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"
~~~

## Text in, and the question the model is asked

The tokenizer you built started from bytes, so that nothing could ever be out
of vocabulary. Here the corpus is the entire world this model will see, so the
alphabet is whatever is in it, and then byte pair merges go on top exactly
as before.

That change is not tidiness. The output layer of the model is one column per
token, so the vocabulary size multiplies the arithmetic in the last matrix
multiply of every forward pass. A vocabulary of 256 would be most of the work
in this project, and a vocabulary of forty is not.

One detail from that project is worth repeating because it is the one people
leave out. Training stops when no pair repeats. Merging something that happens
once makes the vocabulary bigger and the encoding no shorter.

Then the data, and the sentence that explains all of language modelling. The
target for position t is the token at position t plus one. That is it. It is
why a window of eight tokens teaches eight predictions rather than one, and why
the whole thing needs no labels: the text is its own answer key.

@goal The tokenizer round trips, and `batch` gives windows and their shifts.

~~~starter
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    raise NotImplementedError


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them."""

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full."""
        raise NotImplementedError

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        raise NotImplementedError

    def decode(self, ids):
        raise NotImplementedError

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one."""
    raise NotImplementedError
~~~

~~~tests
import random

# stage two still holds
assert (Tensor([[1, 2], [3, 4]]) @ Tensor([[5, 6], [7, 8]])).tolist() == [
    [19.0, 22.0], [43.0, 50.0]
]

# merging a pair
assert merge([1, 2, 3, 1, 2], (1, 2), 9) == [9, 3, 9]
assert merge([1, 1, 1], (1, 1), 9) == [9, 1], "left to right, without overlapping"
assert merge([1, 2, 3], (4, 5), 9) == [1, 2, 3]
assert merge([], (1, 2), 9) == []
assert merge([1], (1, 2), 9) == [1]

# an alphabet with no merges is character level
plain = Tokenizer(sorted(set("hello world")))
assert plain.vocab_size == len(set("hello world"))
assert plain.decode(plain.encode("hello world")) == "hello world"
assert len(plain.encode("hello")) == 5

text = CORPUS
tokenizer = Tokenizer.train(text, vocab_size=40)

# the round trip, which is the only thing a tokenizer absolutely has to do
assert tokenizer.decode(tokenizer.encode(text)) == text
for piece in ("the cat", "a", "", "hat. the", "on on on"):
    assert tokenizer.decode(tokenizer.encode(piece)) == piece, repr(piece)

# and it got shorter, which is the only reason to bother
assert tokenizer.vocab_size == 40
assert len(tokenizer.merges) == 40 - len(tokenizer.alphabet)
assert len(tokenizer.encode(text)) < len(text) / 2, len(tokenizer.encode(text))

# the merges are learned from what actually repeats
merged_text = [tokenizer.tokens[i] for _, i in tokenizer.merges]
assert any("the" in piece for piece in merged_text), merged_text
assert all(len(piece) >= 2 for piece in merged_text)

# training stops early rather than inventing merges nothing needs
short = Tokenizer.train("abcdef", vocab_size=100)
assert short.vocab_size < 100, "no pair repeats, so there is nothing to merge"
assert short.merges == []
assert short.decode(short.encode("abcdef")) == "abcdef"

# an alphabet that does not fit is refused rather than silently truncated
try:
    Tokenizer.train("abcdef", vocab_size=3)
except ValueError as exc:
    assert "every character needs an id" in str(exc)
else:
    raise AssertionError("six characters do not fit in three ids")

# a character the tokenizer never saw says so rather than guessing
try:
    tokenizer.encode("the cat sat on the ZEBRA")
except ValueError as exc:
    assert "not in the alphabet" in str(exc)
    assert "Z" in str(exc)
else:
    raise AssertionError("an unseen character should be reported")

# a tokenizer rebuilt from its own pieces is the same tokenizer
rebuilt = Tokenizer(tokenizer.alphabet, tokenizer.merges)
assert rebuilt.encode(text) == tokenizer.encode(text)
assert rebuilt.vocab_size == tokenizer.vocab_size
assert repr(rebuilt).startswith("Tokenizer(")

# now the training pairs: a window, and the same window one step later
ids = tokenizer.encode(text)
inputs, targets = batch(ids, block_size=8, batch_size=4, rng=random.Random(0))
assert len(inputs) == 4 and len(targets) == 4
assert all(len(row) == 8 for row in inputs + targets)

for x, y in zip(inputs, targets):
    assert x[1:] == y[:-1], "the target is the input shifted by one"

# every window is real text from the corpus
for x in inputs:
    assert "".join(tokenizer.tokens[i] for i in x) in text

# the same seed gives the same batch, which is what makes a run repeatable
again, _ = batch(ids, 8, 4, random.Random(0))
assert again == inputs
assert batch(ids, 8, 4, random.Random(1))[0] != inputs

# a corpus with nothing after the window is an error rather than an index crash
try:
    batch([1, 2, 3], block_size=8, batch_size=1, rng=random.Random(0))
except ValueError as exc:
    assert "no window" in str(exc)
else:
    raise AssertionError("that corpus is too short")

# the smallest corpus that does work
tiny_inputs, tiny_targets = batch([1, 2, 3], 2, 1, random.Random(0))
assert len(tiny_inputs[0]) == 2 and len(tiny_targets[0]) == 2
assert tiny_inputs[0][1] == tiny_targets[0][0]
~~~

~~~solution
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets
~~~

## Turning an id into a direction, and saying where it is

A token id is a number with no meaning. Token 7 is not seven of anything, and
it is not closer to token 8 than to token 30. What the model needs is a vector
per token that it can move around during training until similar tokens end up
pointing in similar directions.

That is a lookup table, and the honest description of a lookup is a matrix
multiply. A one-hot row, zeros everywhere but a single one at position i, times
the table, is row i, because every other term is multiplied by zero. So the
lookup is that multiply with the arithmetic that was always going to vanish
skipped, and the gradient goes back to exactly the row that was used. The test
checks both halves of that claim.

The second table is the one people forget to explain. Attention, when it
arrives, has no idea what order anything came in. It sees a set. Every position
looks the same to it, so "cat sat" and "sat cat" would be identical inputs. The
position embedding breaks that tie, and it is added rather than joined on the
side because adding costs no extra width and lets the model use different
directions of the same space for the two jobs.

`Module` is two methods. PyTorch's version finds sub-modules by scanning
attributes; this one asks each class to say what it holds, which is three lines
per class and no rule to remember.

@goal `Embeddings` gives a vector per token that knows which token and where.

~~~starter
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol."""

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        raise NotImplementedError

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped."""

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        raise NotImplementedError

    def parameters(self):
        raise NotImplementedError

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together."""

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        raise NotImplementedError

    def parameters(self):
        raise NotImplementedError
~~~

~~~tests
import random

# stage three still holds
tokenizer = Tokenizer.train(CORPUS, vocab_size=40)
assert tokenizer.decode(tokenizer.encode(CORPUS)) == CORPUS

rng = random.Random(0)

# a module with nothing in it has no parameters and nothing to zero
empty = Module()
assert empty.parameters() == []
empty.zero_grad()

table = Embedding(10, 4, rng, std=0.5)
assert repr(table) == "Embedding(10, 4)"
assert len(table.parameters()) == 40
assert table.weight.shape == (10, 4)

# a lookup is the rows, in the order asked for
out = table([3, 1, 3])
assert out.shape == (3, 4)
assert out.tolist()[0] == table.weight.tolist()[3]
assert out.tolist()[1] == table.weight.tolist()[1]
assert out.tolist()[0] == out.tolist()[2]

# calling the module is calling forward, which is the whole of __call__
assert table([3]).tolist() == table.forward([3]).tolist()

# the rows are the same objects, so a gradient reaches the table
out.total().backward()
assert table.weight[3][0].grad == 2.0, "row 3 was used twice"
assert table.weight[1][0].grad == 1.0
assert table.weight[0][0].grad == 0.0, "and row 0 was not used at all"

# which is the point: an embedding is a matmul whose zeros were skipped
one_hot = Tensor([[1.0 if i == 3 else 0.0 for i in range(10)]])
assert (one_hot @ table.weight).tolist() == [table.weight.tolist()[3]]

# zeroing clears everything, because gradients add up between steps
table.zero_grad()
assert all(p.grad == 0.0 for p in table.parameters())

# a token the table has no row for is an error rather than a wrap around
for bad in (10, -1, 99):
    try:
        table([bad])
    except IndexError as exc:
        assert "not in a table" in str(exc)
    else:
        raise AssertionError(f"token {bad} should not be found")

# identity plus position
model = Embeddings(vocab_size=40, block_size=8, dim=6, rng=random.Random(1))
assert model([1, 2, 3]).shape == (3, 6)
assert len(model.parameters()) == 40 * 6 + 8 * 6

# the same token in two places is two different vectors, which is the point
same_twice = model([5, 5]).tolist()
assert same_twice[0] != same_twice[1]

# and the difference is exactly the difference between the two positions
positions = model.positions.weight.tolist()
for a, b, p0, p1 in zip(same_twice[0], same_twice[1], positions[0], positions[1]):
    assert abs((b - a) - (p1 - p0)) < 1e-12

# so order matters, which it would not without the position table
assert model([1, 2]).tolist() != model([2, 1]).tolist()

# a token vector on its own does not depend on where it is
tokens_only = model.tokens
assert tokens_only([5]).tolist() == tokens_only([5]).tolist()

# more tokens than there are positions is refused, because there is no row
try:
    model(list(range(9)))
except ValueError as exc:
    assert "positions for" in str(exc)
else:
    raise AssertionError("nine tokens do not fit in eight positions")

assert model(list(range(8))).shape == (8, 6)

# gradients reach both tables
model.zero_grad()
model([2, 3]).total().backward()
assert model.tokens.weight[2][0].grad != 0.0
assert model.positions.weight[0][0].grad != 0.0
assert model.tokens.weight[9][0].grad == 0.0
assert model.positions.weight[7][0].grad == 0.0

# and a real sentence goes through
ids = tokenizer.encode("the cat sat")[:8]
embedded = Embeddings(tokenizer.vocab_size, 8, 6, random.Random(2))(ids)
assert embedded.shape == (len(ids), 6)
~~~

~~~solution
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()
~~~

## The learned transform, and the part that thinks

Two pieces, and in both of them the interesting decision is a number rather
than a line of code.

`Linear` is `x @ W + b`. The initialisation is what matters: weights scaled by
one over the square root of the fan in keep activations about the same size
going in as coming out, so a stack of these neither explodes nor fades to
nothing. Get it wrong and the model does not learn slowly, it does not learn.
Biases start at zero, because the only reason weights are random is to break
symmetry between units, and a bias has nothing to break symmetry with.

`gelu` is a relu that bends instead of breaking. relu has a corner at zero and
no gradient at all below it, so a unit that wanders negative stops learning and
never comes back. The test checks exactly that: the gradient below zero is not
zero. Every transformer since 2018 uses gelu for this reason.

The feed forward is two of those with the nonlinearity between them, four times
wider in the middle. That number is what the papers settled on: enough room to
compute something the narrow dimension could not hold, and not so much that it
takes over the parameter count. It is also where a transformer spends most of
its parameters, which surprises people who assume attention is the expensive
part.

Every row goes through on its own here. Attention is what moves information
between positions, and this is where each position thinks about what it now
holds.

@goal `Linear` and `MLP` transform, scale sensibly, and pass gradients back.

~~~starter
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model."""

    def __init__(self, fan_in, fan_out, rng, bias=True):
        raise NotImplementedError

    def forward(self, x):
        raise NotImplementedError

    def parameters(self):
        raise NotImplementedError

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used."""
    raise NotImplementedError


class MLP(Module):
    """Wide in the middle, and back out again."""

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        raise NotImplementedError

    def parameters(self):
        raise NotImplementedError
~~~

~~~tests
import math
import random

# stage four still holds
rng = random.Random(0)
embeddings = Embeddings(vocab_size=40, block_size=8, dim=6, rng=rng)
assert embeddings([1, 2, 3]).shape == (3, 6)

layer = Linear(6, 4, random.Random(1))
assert repr(layer) == "Linear(6, 4)"
assert layer.weight.shape == (6, 4)
assert layer.bias.shape == (1, 4)
assert len(layer.parameters()) == 6 * 4 + 4

# a bias starts at zero, because there is nothing for noise to break here
assert layer.bias.tolist() == [[0.0, 0.0, 0.0, 0.0]]

# and the weights are scaled to the fan in, which is what keeps a stack stable
wide = Linear(400, 4, random.Random(2))
spread = [v.data for v in wide.weight.values()]
measured = math.sqrt(sum(v * v for v in spread) / len(spread))
assert abs(measured - 400 ** -0.5) < 0.01, measured

narrow = Linear(4, 4, random.Random(2))
narrow_spread = [abs(v.data) for v in narrow.weight.values()]
assert sum(narrow_spread) / len(narrow_spread) > sum(
    abs(v) for v in spread
) / len(spread), "a narrower input means bigger weights"

# the shape it promises
assert layer(Tensor.zeros(3, 6)).shape == (3, 4)
assert Linear(6, 4, rng, bias=False)(Tensor.zeros(2, 6)).shape == (2, 4)
assert len(Linear(6, 4, rng, bias=False).parameters()) == 24

try:
    layer(Tensor.zeros(3, 5))
except ValueError as exc:
    assert "was given 5" in str(exc)
else:
    raise AssertionError("the widths have to agree")

# with a zero input the answer is the bias, which is a way of seeing it is added
biased = Linear(3, 2, random.Random(3))
biased.bias.data[0][0].data = 7.0
assert biased(Tensor.zeros(1, 3)).tolist() == [[7.0, 0.0]]

# the arithmetic, worked out by hand
by_hand = Linear(2, 2, random.Random(0), bias=False)
by_hand.weight = Tensor([[1.0, 2.0], [3.0, 4.0]])
assert by_hand(Tensor([[1.0, 1.0]])).tolist() == [[4.0, 6.0]]

# gradients reach the weights and the bias
layer.zero_grad()
layer(Tensor([[1.0] * 6])).total().backward()
assert all(p.grad != 0.0 for p in layer.bias.values())
assert layer.weight[0][0].grad == 1.0

# gelu: zero at zero, almost itself when large, almost nothing when very negative
assert abs(gelu(Value(0.0)).data) < 1e-12
assert abs(gelu(Value(4.0)).data - 4.0) < 0.001
assert abs(gelu(Value(-4.0)).data) < 0.001
assert -0.2 < gelu(Value(-1.0)).data < 0.0, "a little negative gets through"
assert gelu(Value(1.0)).data < 1.0, "and a little positive is held back"

# it is smooth everywhere, which relu is not, so it has a gradient below zero
below = Value(-0.5)
gelu(below).backward()
assert below.grad != 0.0, "relu would give zero here, and the unit would be stuck"

corner = Value(0.0)
gelu(corner).backward()
assert abs(corner.grad - 0.5) < 0.01, corner.grad

# and it is close to relu where relu is right
for x in (-3.0, 3.0, 5.0):
    assert abs(gelu(Value(x)).data - max(0.0, x)) < 0.01

# the feed forward keeps the width it was given
mlp = MLP(dim=6, rng=random.Random(4))
assert mlp(Tensor.zeros(3, 6)).shape == (3, 6)
assert mlp.up.fan_out == 24, "four times wider in the middle"
assert mlp.down.fan_in == 24
assert len(mlp.parameters()) == (6 * 24 + 24) + (24 * 6 + 6)
assert MLP(dim=6, rng=rng, expansion=2).up.fan_out == 12

# each row goes through on its own, with no reference to any other
one = mlp(Tensor([[1.0, 0.0, 0.0, 0.0, 0.0, 0.0]])).tolist()[0]
both = mlp(Tensor([[1.0, 0.0, 0.0, 0.0, 0.0, 0.0], [9.0] * 6])).tolist()[0]
for a, b in zip(one, both):
    assert abs(a - b) < 1e-12, "the second row must not change the first"

# and gradients reach both halves of it
mlp.zero_grad()
mlp(Tensor([[0.5] * 6])).total().backward()
assert any(p.grad != 0.0 for p in mlp.up.parameters())
assert any(p.grad != 0.0 for p in mlp.down.parameters())
~~~

~~~solution
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()
~~~

## Scores into probabilities, and how wrong that was

The model produces a score per token. Turning those into probabilities is
softmax, and the whole of it is one line with one subtraction that is not
optional.

`exp(1000)` is infinity, and once one entry of a row is infinity the row is
nan and so is everything downstream of it. Subtracting the largest entry first
leaves the biggest exponent at `exp(0)`, which is one. It costs nothing to be
right about, because every term is divided by the total: subtracting the same
constant from all of them multiplies the top and the bottom by the same number.

Cross-entropy is the negative log of the probability given to the correct
token. Certain and right scores zero. Certain and wrong scores an enormous
number, which is the whole reason for this loss rather than counting mistakes:
being confidently wrong has to hurt more than being unsure.

It goes through `log_softmax` rather than the log of `softmax`, and the reason
is the same shape as before. The division in softmax underflows to zero for a
token the model thinks impossible, and the log of zero has no answer, so the
loss becomes nan exactly when the model is most wrong.

The gradient is worth knowing by heart. For each row it is the predicted
distribution minus a one at the correct answer, divided by the number of rows.
Every framework's fused softmax-and-loss kernel is that line, and the tests
check it against both the formula and a nudge.

One consequence to keep: an untrained model's loss should be the log of the
vocabulary size, because it has no opinion. A first loss that is not is a bug,
and it is the cheapest bug check in machine learning.

@goal `cross_entropy` is stable, and its gradient is the distribution minus one.

~~~starter
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions."""
    raise NotImplementedError


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    raise NotImplementedError


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token."""
    raise NotImplementedError
~~~

~~~tests
import math
import random

# stage five still holds
mlp = MLP(dim=6, rng=random.Random(4))
assert mlp(Tensor.zeros(3, 6)).shape == (3, 6)

# a distribution: everything positive, adding to one
probabilities = [v.data for v in softmax([Value(1.0), Value(2.0), Value(3.0)])]
assert abs(sum(probabilities) - 1.0) < 1e-12
assert all(p > 0 for p in probabilities)
assert probabilities[2] > probabilities[1] > probabilities[0], "order is kept"

# equal scores mean no opinion
even = [v.data for v in softmax([Value(0.0)] * 4)]
assert all(abs(p - 0.25) < 1e-12 for p in even)
assert [v.data for v in softmax([Value(5.0)] * 4)] == even, "and the level does not matter"

# adding a constant to everything changes nothing, which is why the shift is free
shifted = [v.data for v in softmax([Value(1001.0), Value(1002.0), Value(1003.0)])]
for a, b in zip(probabilities, shifted):
    assert abs(a - b) < 1e-12

# and it is why numbers this size do not become nan
huge = [v.data for v in softmax([Value(1000.0), Value(999.0)])]
assert abs(sum(huge) - 1.0) < 1e-12
assert huge[0] > huge[1]
assert not any(math.isnan(p) for p in huge)

tiny = [v.data for v in softmax([Value(-1000.0), Value(-1001.0)])]
assert abs(sum(tiny) - 1.0) < 1e-12

# a single score is a certainty, because there is nothing else it could be
assert softmax([Value(7.0)])[0].data == 1.0

# log softmax is the log of it, computed a safer way
row = [Value(2.0), Value(-1.0), Value(0.5)]
for logged, plain in zip(log_softmax(row), softmax(row)):
    assert abs(logged.data - math.log(plain.data)) < 1e-9

# including where the plain way would have taken the log of zero
brutal = log_softmax([Value(0.0), Value(-900.0)])
assert softmax([Value(0.0), Value(-900.0)])[1].data == 0.0, "underflowed to nothing"
assert not math.isinf(brutal[1].data), "and this one did not"
assert brutal[1].data < -800

# the loss. no opinion at all costs the log of the vocabulary size
for size in (2, 10, 40):
    flat = Tensor.zeros(3, size)
    assert abs(cross_entropy(flat, [0, 1, size - 1]).data - math.log(size)) < 1e-9

# being right and sure costs almost nothing
confident = Tensor([[10.0, 0.0, 0.0]])
assert cross_entropy(confident, [0]).data < 0.001

# being wrong and sure costs a great deal, which is the point of this loss
assert cross_entropy(confident, [1]).data > 9.0

# and it is the average over the positions, not the total
pair = Tensor([[10.0, 0.0], [10.0, 0.0]])
assert abs(cross_entropy(pair, [0, 0]).data - cross_entropy(Tensor([[10.0, 0.0]]), [0]).data) < 1e-12
assert cross_entropy(pair, [0, 1]).data > cross_entropy(pair, [0, 0]).data

# the shapes have to line up, and a target has to be a token
try:
    cross_entropy(Tensor.zeros(2, 5), [0])
except ValueError as exc:
    assert "2 rows of scores and 1 targets" in str(exc)
else:
    raise AssertionError("that many targets is wrong")

for bad in (5, -1):
    try:
        cross_entropy(Tensor.zeros(1, 5), [bad])
    except IndexError as exc:
        assert "not one of 5 tokens" in str(exc)
    else:
        raise AssertionError(f"target {bad} does not exist")

# now the gradient, which has a shape worth knowing by heart: for each row it
# is the predicted distribution minus a one at the right answer, over the
# number of rows. Every framework's fused softmax-cross-entropy is this line.
logits = Tensor([[1.0, 2.0, 0.5], [0.0, 0.0, 3.0]])
targets = [2, 0]
cross_entropy(logits, targets).backward()

for i, (row, target) in enumerate(zip(logits, targets)):
    predicted = [v.data for v in softmax([Value(v.data) for v in row])]
    for j, value in enumerate(row):
        expected = (predicted[j] - (1.0 if j == target else 0.0)) / len(targets)
        assert abs(value.grad - expected) < 1e-9, (i, j, value.grad, expected)

# which means the gradient on a row adds up to zero: softmax cannot make
# everything more likely at once
for row in logits:
    assert abs(sum(v.grad for v in row)) < 1e-9

# and the same answer by nudging, which needs no derivation at all
def loss_at(a, b, c):
    return cross_entropy(Tensor([[a, b, c]]), [1]).data


h = 1e-6
numeric = [(loss_at(1.0 + h, 2.0, 0.5) - loss_at(1.0 - h, 2.0, 0.5)) / (2 * h),
           (loss_at(1.0, 2.0 + h, 0.5) - loss_at(1.0, 2.0 - h, 0.5)) / (2 * h),
           (loss_at(1.0, 2.0, 0.5 + h) - loss_at(1.0, 2.0, 0.5 - h)) / (2 * h)]
checked = Tensor([[1.0, 2.0, 0.5]])
cross_entropy(checked, [1]).backward()
for value, expected in zip(checked[0], numeric):
    assert abs(value.grad - expected) < 1e-5, (value.grad, expected)

# and the sanity check every training run starts with: an untrained model
# should be exactly this lost, and a first loss that is not is a bug
rng = random.Random(0)
vocab = 40
model = Linear(6, vocab, rng)
scores = model(Embeddings(vocab, 8, 6, rng)([1, 2, 3]))
starting = cross_entropy(scores, [4, 5, 6]).data
assert abs(starting - math.log(vocab)) < 0.5, (starting, math.log(vocab))
~~~

~~~solution
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))
~~~

## Attention, which is a weighted average with learned weights

Here is the whole of it. Three linear maps of the same input, and the names are
the explanation. The query is what this position is looking for. The key is
what each position advertises about itself. The value is what a position hands
over when it is chosen. The score between two positions is the dot product of
one query with one key, large when they point the same way. Softmax turns a row
of scores into weights, and the output is that weighted average of the values.

Nothing else happens. Every position ends up holding a mixture of the positions
it decided were relevant, and which those are is learned rather than fixed.
That is the entire mechanism the last decade of this field is built on.

Two details are not decoration.

The division by the square root of the head size. A dot product of vectors of
length d has a spread of about the square root of d, so a wide head produces
large scores, softmax saturates into a hard choice, and the gradient through it
is nothing before training has begun. The test builds a head of 64 and checks
it has not already made up its mind.

The mask. A position may only attend to itself and what came before it. A model
allowed to see position i plus one while predicting it scores perfectly and
learns nothing, and this is the most common way to get a language model wrong
and the hardest to notice, because the loss looks wonderful. The test changes
the last token and checks that no earlier output moved, then turns the mask off
and checks that they do.

@goal One head attends, cannot see forward, and scales its scores.

~~~starter
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    raise NotImplementedError


class Head(Module):
    """One attention head: ask, offer, and take a weighted average."""

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        raise NotImplementedError

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        raise NotImplementedError

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"
~~~

~~~tests
import random

# stage six still holds
assert abs(cross_entropy(Tensor.zeros(2, 10), [0, 1]).data - 2.302585) < 1e-5

rng = random.Random(0)
head = Head(dim=6, head_size=4, rng=rng)
assert repr(head) == "Head(6 -> 4, causal)"
assert head.scale == 0.5, "one over the square root of four"
assert Head(6, 16, rng).scale == 0.25

# no biases, because softmax ignores a constant added to a whole row
assert head.query.bias is None and head.key.bias is None
assert len(head.parameters()) == 3 * 6 * 4

x = Tensor.randn(5, 6, random.Random(1))
out, pattern = head.attend(x)
assert out.shape == (5, 4), "the head size, not the model width"
assert head(x).tolist() == out.tolist()

# every row of the pattern is a distribution over what it was allowed to see
for i, weights in enumerate(pattern):
    assert len(weights) == i + 1, "position i sees i + 1 positions"
    assert abs(sum(w.data for w in weights) - 1.0) < 1e-9
    assert all(w.data > 0 for w in weights)

# the first position has only itself, so its output is its own value vector
assert len(pattern[0]) == 1
assert abs(pattern[0][0].data - 1.0) < 1e-12
assert out.tolist()[0] == head.value(x).tolist()[0]

# and this is the property the whole thing rests on: changing a later token
# cannot change an earlier output
changed = Tensor([list(row) for row in x.rows_as_lists()])
changed.data[4] = [Value(9.0)] * 6
after = head(changed).tolist()
before = out.tolist()
for i in range(4):
    for a, b in zip(before[i], after[i]):
        assert abs(a - b) < 1e-12, f"row {i} moved when row 4 changed"
assert after[4] != before[4], "and the changed row itself did move"

# without the mask it does not hold, which is what the mask is for
leaky = Head(dim=6, head_size=4, rng=random.Random(0), causal=False)
assert repr(leaky).endswith("full)")
leaked_before = leaky(x).tolist()
leaked_after = leaky(changed).tolist()
assert leaked_before[0] != leaked_after[0], "a full head sees the future"
assert all(len(w) == 5 for w in leaky.attend(x)[1])

# attention is a weighted average, so an output cannot leave the range of the
# values it averaged
values = head.value(x).tolist()
for row in out.tolist():
    for j, entry in enumerate(row):
        column = [v[j] for v in values]
        assert min(column) - 1e-9 <= entry <= max(column) + 1e-9

# a query that matches one key strongly picks it out
sharp = Head(dim=2, head_size=2, rng=random.Random(2))
sharp.query.weight = Tensor([[10.0, 0.0], [0.0, 10.0]])
sharp.key.weight = Tensor([[1.0, 0.0], [0.0, 1.0]])
sharp.value.weight = Tensor([[1.0, 0.0], [0.0, 1.0]])
_, picked = sharp.attend(Tensor([[1.0, 0.0], [0.0, 1.0], [1.0, 0.0]]))

# the third position is identical to the first, so it splits its attention
# evenly between the two of them and ignores the one in between
assert picked[2][1].data < 0.01, "the middle position offers nothing it wants"
assert picked[2][0].data + picked[2][2].data > 0.99
assert abs(picked[2][0].data - picked[2][2].data) < 1e-9, "equally relevant"

# and the second position, which matches neither, mostly looks at itself
assert picked[1][1].data > 0.99

# the scale is what stops a wide head saturating before training starts
wide = Head(dim=8, head_size=64, rng=random.Random(3))
narrow = Head(dim=8, head_size=4, rng=random.Random(3))
assert wide.scale < narrow.scale

sequence = Tensor.randn(6, 8, random.Random(4))

# row zero is always a certainty, because it has one position to choose from,
# so the interesting rows are the ones that had a choice
def sharpest(head):
    return max(max(w.data for w in row) for row in head.attend(sequence)[1][1:])


assert sharpest(wide) < 0.95, f"a wide head has already decided: {sharpest(wide)}"
assert sharpest(narrow) < 0.95

# and without the scaling it would have: the same head with the divisor
# removed makes up its mind before a single gradient has been taken
unscaled = Head(dim=8, head_size=64, rng=random.Random(3))
unscaled.scale = 1.0
assert sharpest(unscaled) > sharpest(wide), (sharpest(unscaled), sharpest(wide))

# widths that do not line up
try:
    head(Tensor.zeros(3, 5))
except ValueError as exc:
    assert "was given 5" in str(exc)
else:
    raise AssertionError("the model width has to match")

# gradients reach all three maps
head.zero_grad()
head(x).total().backward()
for name in ("query", "key", "value"):
    assert any(p.grad != 0.0 for p in getattr(head, name).parameters()), name

# and a weighted sum is what it says
assert [v.data for v in weighted_sum(
    [Value(0.25), Value(0.75)], [[Value(4.0), Value(0.0)], [Value(0.0), Value(4.0)]]
)] == [1.0, 3.0]
~~~

~~~solution
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"
~~~

## Four opinions instead of one

A head produces one set of weights per position, so it can express one kind of
relationship at a time. Splitting the width into four narrower heads lets the
model attend to four different things at once, for the same total width and
very nearly the same arithmetic. In a trained model one head often ends up
tracking the previous token, another the matching bracket, another the subject
of the sentence.

The width is split rather than multiplied. Eight dimensions across four heads
is four heads of two, which is why the number of heads has to divide the model
width exactly, and why the output comes back out at the width it went in. That
last part is what lets these stack.

The projection at the end is not a formality. Without it, each slice of the
output could only ever be written by one head, and nothing would ever combine
what two heads separately found.

The test worth reading is the one that changes the last token and checks no
earlier output moved. Splitting attention into heads is exactly the kind of
change that quietly breaks a mask, and the loss curve will not tell you.

@goal Heads split the width, run independently, and the mask still holds.

~~~starter
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back."""

    def __init__(self, dim, heads, rng, causal=True):
        raise NotImplementedError

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        raise NotImplementedError

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        raise NotImplementedError

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"
~~~

~~~tests
import random

# stage seven still holds
one = Head(dim=6, head_size=4, rng=random.Random(0))
assert one(Tensor.randn(3, 6, random.Random(1))).shape == (3, 4)

attention = MultiHeadAttention(dim=8, heads=4, rng=random.Random(0))
assert repr(attention) == "MultiHeadAttention(8, 4 heads)"
assert attention.head_size == 2, "the width is split, not multiplied"
assert len(attention.heads) == 4
assert all(head.head_size == 2 for head in attention.heads)

# in and out at the model width, which is what lets these stack
x = Tensor.randn(5, 8, random.Random(1))
assert attention(x).shape == (5, 8)
assert attention.concat(x).shape == (5, 8), "the slices fill the width exactly"

# the parameters: three maps per head, plus the projection
per_head = 3 * 8 * 2
assert len(attention.parameters()) == 4 * per_head + (8 * 8 + 8)

# a width that does not divide is refused rather than silently rounded
try:
    MultiHeadAttention(dim=10, heads=4, rng=random.Random(0))
except ValueError as exc:
    assert "does not divide" in str(exc)
else:
    raise AssertionError("ten does not split into four")

assert MultiHeadAttention(dim=8, heads=1, rng=random.Random(0)).head_size == 8
assert MultiHeadAttention(dim=8, heads=8, rng=random.Random(0)).head_size == 1

# each slice of the concatenation is one head, in order
joined = attention.concat(x).tolist()
for index, head in enumerate(attention.heads):
    alone = head(x).tolist()
    for row, whole in zip(alone, joined):
        assert row == whole[index * 2:(index + 1) * 2]

# with one head it is that head, projected, and nothing more
single = MultiHeadAttention(dim=8, heads=1, rng=random.Random(2))
assert single.concat(x).tolist() == single.heads[0](x).tolist()
assert single(x).tolist() == single.project(single.heads[0](x)).tolist()

# the mask survives being split up, which is the property that matters most
changed = Tensor([list(row) for row in x.rows_as_lists()])
changed.data[4] = [Value(9.0)] * 8
before, after = attention(x).tolist(), attention(changed).tolist()
for i in range(4):
    for a, b in zip(before[i], after[i]):
        assert abs(a - b) < 1e-12, f"row {i} moved when row 4 changed"
assert before[4] != after[4]

# and it does not survive turning the mask off, as before
leaky = MultiHeadAttention(dim=8, heads=4, rng=random.Random(0), causal=False)
assert leaky(x).tolist()[0] != leaky(changed).tolist()[0]

# heads are independent: they start from different random numbers and so they
# see different things
patterns = [head.attend(x)[1][4] for head in attention.heads]
as_lists = [[round(w.data, 6) for w in pattern] for pattern in patterns]
assert len({tuple(row) for row in as_lists}) == 4, "four heads, four opinions"

# the projection is what mixes them, so removing it leaves each slice alone
assert attention.project.fan_in == 8 and attention.project.fan_out == 8

# gradients reach every head and the projection
attention.zero_grad()
attention(x).total().backward()
for index, head in enumerate(attention.heads):
    assert any(p.grad != 0.0 for p in head.parameters()), index
assert any(p.grad != 0.0 for p in attention.project.parameters())

# and every parameter is reachable exactly once, so an optimiser does not
# update anything twice
found = attention.parameters()
assert len({id(p) for p in found}) == len(found)
~~~

~~~solution
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"
~~~

## The layer that repeats, and the two lines that make it deep

A block is attention and a feed forward, and everything interesting about it is
where those two sit rather than what they are.

The residual is `x + f(x)` rather than `f(x)`. The gradient reaches the bottom
of a deep stack through the addition, which passes it along untouched, as well
as through f, which multiplies it by something at every layer. Without that
path a stack of more than a few layers does not train, and this one line is
most of the reason deep networks became possible at all. The test makes it
visible: silence both sublayers, and the block is the identity function.

The normalisation goes before each sublayer rather than after. The original
paper put it after; everyone moved it, because with it before, the path from
the top of the stack to the bottom is nothing but additions, with no
normalisation in the middle rescaling the gradient on its way past.

Layer norm itself normalises across the features of one position, not across
the batch. Batch norm normalises across whatever examples happened to be
together, which makes a model's answer depend on what else was in the batch and
behave differently once training stops. This depends on nothing outside the
row.

Its `eps` is not cosmetic safety. A row that is already constant has zero
variance, and one over the square root of zero is not a number, so without it a
single dead row turns the whole model to nan.

@goal `Block` keeps its width, keeps the mask, and is the identity when silent.

~~~starter
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"


class LayerNorm(Module):
    """Each row rescaled to mean zero and variance one, then scaled again."""

    def __init__(self, dim, eps=1e-5):
        self.dim = dim
        self.eps = eps
        self.gain = Tensor([[1.0] * dim])
        self.bias = Tensor.zeros(1, dim)

    def forward(self, x):
        raise NotImplementedError

    def parameters(self):
        raise NotImplementedError

    def __repr__(self):
        return f"LayerNorm({self.dim})"


class Block(Module):
    """Attention, then a feed forward, each wrapped in a residual."""

    def __init__(self, dim, heads, rng, expansion=4):
        self.dim = dim
        self.norm1 = LayerNorm(dim)
        self.attention = MultiHeadAttention(dim, heads, rng)
        self.norm2 = LayerNorm(dim)
        self.mlp = MLP(dim, rng, expansion)

    def forward(self, x):
        raise NotImplementedError

    def parameters(self):
        raise NotImplementedError

    def __repr__(self):
        return f"Block({self.dim}, {self.attention.head_count} heads)"
~~~

~~~tests
import random

# stage eight still holds
attention = MultiHeadAttention(dim=8, heads=4, rng=random.Random(0))
assert attention(Tensor.randn(5, 8, random.Random(1))).shape == (5, 8)

norm = LayerNorm(4)
assert repr(norm) == "LayerNorm(4)"
assert norm.gain.tolist() == [[1.0, 1.0, 1.0, 1.0]], "starts as no change at all"
assert norm.bias.tolist() == [[0.0, 0.0, 0.0, 0.0]]
assert len(norm.parameters()) == 8

# every row comes out centred, with a spread of one
out = norm(Tensor([[1.0, 2.0, 3.0, 4.0], [10.0, -10.0, 0.0, 0.0]]))
assert out.shape == (2, 4)
for row in out.tolist():
    mean = sum(row) / len(row)
    variance = sum((v - mean) ** 2 for v in row) / len(row)
    assert abs(mean) < 1e-9, mean
    assert abs(variance - 1.0) < 1e-4, variance

# so the level and the scale of the input stop mattering
first = norm(Tensor([[1.0, 2.0, 3.0, 4.0]])).tolist()[0]
for other in ([101.0, 102.0, 103.0, 104.0], [10.0, 20.0, 30.0, 40.0]):
    for a, b in zip(first, norm(Tensor([other])).tolist()[0]):
        assert abs(a - b) < 1e-4, (a, b)

# each row on its own, which is the difference from normalising over a batch
alone = norm(Tensor([[1.0, 2.0, 3.0, 4.0]])).tolist()[0]
together = norm(Tensor([[1.0, 2.0, 3.0, 4.0], [900.0, 0.0, 0.0, 0.0]])).tolist()[0]
for a, b in zip(alone, together):
    assert abs(a - b) < 1e-12, "another row must not change this one"

# a row with nothing in it has no variance, and eps is why that is survivable
flat = norm(Tensor([[5.0, 5.0, 5.0, 5.0]])).tolist()[0]
assert all(abs(v) < 1e-3 for v in flat), flat
assert not any(v != v for v in flat), "and not a single nan"

# the gain and the bias put a scale back afterwards
scaled = LayerNorm(4)
scaled.gain = Tensor([[2.0, 2.0, 2.0, 2.0]])
scaled.bias = Tensor([[1.0, 1.0, 1.0, 1.0]])
for plain, adjusted in zip(first, scaled(Tensor([[1.0, 2.0, 3.0, 4.0]])).tolist()[0]):
    assert abs(adjusted - (plain * 2.0 + 1.0)) < 1e-9

try:
    norm(Tensor.zeros(2, 5))
except ValueError as exc:
    assert "was given 5" in str(exc)
else:
    raise AssertionError("the widths have to agree")

# gradients reach the gain and the bias
norm.zero_grad()
norm(Tensor([[1.0, 2.0, 3.0, 4.0]])).total().backward()
assert any(p.grad != 0.0 for p in norm.gain.values())
assert all(abs(p.grad - 1.0) < 1e-12 for p in norm.bias.values())

# the block: same width in, same width out, which is what lets it stack
block = Block(dim=8, heads=2, rng=random.Random(3))
assert repr(block) == "Block(8, 2 heads)"
x = Tensor.randn(5, 8, random.Random(4))
assert block(x).shape == (5, 8)
assert block(block(x)).shape == (5, 8), "and again"

# and it holds every part
expected = (len(block.norm1.parameters()) + len(block.attention.parameters())
            + len(block.norm2.parameters()) + len(block.mlp.parameters()))
assert len(block.parameters()) == expected
assert len({id(p) for p in block.parameters()}) == expected

# the residual, made visible: silence both sublayers and the block is identity
for value in block.attention.project.weight.values() + block.attention.project.bias.values():
    value.data = 0.0
for value in block.mlp.down.weight.values() + block.mlp.down.bias.values():
    value.data = 0.0
for row_in, row_out in zip(x.tolist(), block(x).tolist()):
    for a, b in zip(row_in, row_out):
        assert abs(a - b) < 1e-12, "x + 0 + 0 should be x"

# which is the path a gradient takes to the bottom of a deep stack
deep = Tensor.randn(3, 8, random.Random(5))
stack_out = deep
for _ in range(4):
    stack_out = block(stack_out)
stack_out.total().backward()
assert all(v.grad != 0.0 for v in deep.values()), "the gradient reached the input"

# the mask survives the block, as it has to survive everything
fresh = Block(dim=8, heads=2, rng=random.Random(6))
changed = Tensor([list(row) for row in x.rows_as_lists()])
changed.data[4] = [Value(9.0)] * 8
before, after = fresh(x).tolist(), fresh(changed).tolist()
for i in range(4):
    for a, b in zip(before[i], after[i]):
        assert abs(a - b) < 1e-12, f"row {i} moved when row 4 changed"

# and gradients reach all four pieces
fresh.zero_grad()
fresh(x).total().backward()
for part in ("norm1", "attention", "norm2", "mlp"):
    assert any(p.grad != 0.0 for p in getattr(fresh, part).parameters()), part
~~~

~~~solution
import collections
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"


class LayerNorm(Module):
    """Each row rescaled to mean zero and variance one, then scaled again.

    Across the features of one position, not across the batch. Batch norm
    normalises across the examples that happened to be together, which makes a
    model's answer depend on what else was in the batch with it and behave
    differently once training stops. This depends on nothing outside the row,
    so it is the same during training and afterwards, and it is why every
    transformer uses it.

    The learned gain and bias are what stop it being a straitjacket: having
    forced every row to the same scale, the model can put back whatever scale
    it actually wanted.
    """

    def __init__(self, dim, eps=1e-5):
        self.dim = dim
        # Not for cosmetic safety. A row that is already constant has zero
        # variance, and the inverse square root of zero is not a number, so
        # without this a single dead row makes the entire model nan.
        self.eps = eps
        self.gain = Tensor([[1.0] * dim])
        self.bias = Tensor.zeros(1, dim)

    def forward(self, x):
        if x.cols != self.dim:
            raise ValueError(f"a norm over {self.dim} was given {x.cols}")
        scale = 1.0 / self.dim
        rows = []
        for row in x:
            mean = vsum(row) * scale
            centred = [value - mean for value in row]
            variance = vsum([value * value for value in centred]) * scale
            inverse = (variance + self.eps) ** -0.5
            rows.append([
                value * inverse * gain + bias
                for value, gain, bias in zip(centred, self.gain[0], self.bias[0],
                                             strict=True)
            ])
        return Tensor(rows)

    def parameters(self):
        return self.gain.values() + self.bias.values()

    def __repr__(self):
        return f"LayerNorm({self.dim})"


class Block(Module):
    """Attention, then a feed forward, each wrapped in a residual.

    Two decisions, and both are about where things go rather than what they
    are.

    The residual is `x + f(x)` rather than `f(x)`. The gradient reaches the
    bottom of a deep stack through the addition, which passes it along
    untouched, as well as through f, which multiplies it by something at every
    layer. Without that path a stack of more than a few layers does not train
    at all, and this one line is most of why deep networks became possible.

    The normalisation goes before the sublayer rather than after it. The
    original paper put it after; everybody moved it, because with it before,
    the path from the top of the stack to the bottom is nothing but additions,
    with no normalisation sitting in the middle of it rescaling the gradient.
    """

    def __init__(self, dim, heads, rng, expansion=4):
        self.dim = dim
        self.norm1 = LayerNorm(dim)
        self.attention = MultiHeadAttention(dim, heads, rng)
        self.norm2 = LayerNorm(dim)
        self.mlp = MLP(dim, rng, expansion)

    def forward(self, x):
        x = x + self.attention(self.norm1(x))
        return x + self.mlp(self.norm2(x))

    def parameters(self):
        return (self.norm1.parameters() + self.attention.parameters()
                + self.norm2.parameters() + self.mlp.parameters())

    def __repr__(self):
        return f"Block({self.dim}, {self.attention.head_count} heads)"
~~~

## The whole model, and the line that makes it usable

Embeddings, a stack of blocks, one last normalisation, and a matrix back out to
one score per token. Every part exists. What is left is the order and one
decision about that last matrix.

The embedding maps a token to a direction. The unembedding maps a direction
back to a score for each token. Those are two views of the same relationship,
so GPT-2 and most things since use one matrix for both, with the second use
being the transpose of the first. It saves vocabulary times width parameters,
which in a real model is a large fraction of the total, and it says something
true: a token's input vector and its output vector ought to agree.

Tying makes one matrix reachable by two routes, so `parameters` has to return
each one once. An optimiser handed the same value twice applies its update
twice, and that is a bug that looks exactly like a badly chosen learning rate.

Then the line that makes the rest of this project possible in the time you
have. One forward pass builds about a quarter of a million small objects, and
Python's generational collector walks every tracked object looking for cycles,
over and over while the graph is still being built, finding none each time.
Measured here, 80 milliseconds a step with it on and 31 with it off.

Nothing leaks while it is off, and that is stage one's doing rather than luck.
A backward closure that captured the value it belongs to would make every node
part of a cycle, and a cycle is the one thing reference counting cannot free,
so the graph would pile up for as long as the collector stayed off. Passing the
gradient in as an argument instead leaves a graph that only ever points
downward, which reference counting clears the moment the last name for it goes
away. Unit 36 explained the difference; this is where it pays.

@goal `GPT` predicts, ties its weights, counts them once, and runs at speed.

~~~starter
import collections
import contextlib
import gc
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"


class LayerNorm(Module):
    """Each row rescaled to mean zero and variance one, then scaled again.

    Across the features of one position, not across the batch. Batch norm
    normalises across the examples that happened to be together, which makes a
    model's answer depend on what else was in the batch with it and behave
    differently once training stops. This depends on nothing outside the row,
    so it is the same during training and afterwards, and it is why every
    transformer uses it.

    The learned gain and bias are what stop it being a straitjacket: having
    forced every row to the same scale, the model can put back whatever scale
    it actually wanted.
    """

    def __init__(self, dim, eps=1e-5):
        self.dim = dim
        # Not for cosmetic safety. A row that is already constant has zero
        # variance, and the inverse square root of zero is not a number, so
        # without this a single dead row makes the entire model nan.
        self.eps = eps
        self.gain = Tensor([[1.0] * dim])
        self.bias = Tensor.zeros(1, dim)

    def forward(self, x):
        if x.cols != self.dim:
            raise ValueError(f"a norm over {self.dim} was given {x.cols}")
        scale = 1.0 / self.dim
        rows = []
        for row in x:
            mean = vsum(row) * scale
            centred = [value - mean for value in row]
            variance = vsum([value * value for value in centred]) * scale
            inverse = (variance + self.eps) ** -0.5
            rows.append([
                value * inverse * gain + bias
                for value, gain, bias in zip(centred, self.gain[0], self.bias[0],
                                             strict=True)
            ])
        return Tensor(rows)

    def parameters(self):
        return self.gain.values() + self.bias.values()

    def __repr__(self):
        return f"LayerNorm({self.dim})"


class Block(Module):
    """Attention, then a feed forward, each wrapped in a residual.

    Two decisions, and both are about where things go rather than what they
    are.

    The residual is `x + f(x)` rather than `f(x)`. The gradient reaches the
    bottom of a deep stack through the addition, which passes it along
    untouched, as well as through f, which multiplies it by something at every
    layer. Without that path a stack of more than a few layers does not train
    at all, and this one line is most of why deep networks became possible.

    The normalisation goes before the sublayer rather than after it. The
    original paper put it after; everybody moved it, because with it before,
    the path from the top of the stack to the bottom is nothing but additions,
    with no normalisation sitting in the middle of it rescaling the gradient.
    """

    def __init__(self, dim, heads, rng, expansion=4):
        self.dim = dim
        self.norm1 = LayerNorm(dim)
        self.attention = MultiHeadAttention(dim, heads, rng)
        self.norm2 = LayerNorm(dim)
        self.mlp = MLP(dim, rng, expansion)

    def forward(self, x):
        x = x + self.attention(self.norm1(x))
        return x + self.mlp(self.norm2(x))

    def parameters(self):
        return (self.norm1.parameters() + self.attention.parameters()
                + self.norm2.parameters() + self.mlp.parameters())

    def __repr__(self):
        return f"Block({self.dim}, {self.attention.head_count} heads)"


class GPT(Module):
    """Embeddings, a stack of blocks, a last normalisation, and back to tokens."""

    def __init__(self, vocab_size, block_size, dim, heads, layers, rng,
                 expansion=4, tie=True):
        self.vocab_size = vocab_size
        self.block_size = block_size
        self.dim = dim
        self.embeddings = Embeddings(vocab_size, block_size, dim, rng)
        self.blocks = [Block(dim, heads, rng, expansion) for _ in range(layers)]
        self.norm = LayerNorm(dim)
        self.head = Linear(dim, vocab_size, rng, bias=False)
        self.tie = tie
        if tie:
            raise NotImplementedError

    def forward(self, ids):
        raise NotImplementedError

    def loss(self, ids, targets):
        """The cross-entropy of predicting each next token."""
        return cross_entropy(self(ids), targets)

    def parameters(self):
        """Every parameter once."""
        raise NotImplementedError

    def __repr__(self):
        return (f"GPT({self.vocab_size} tokens, {self.dim} wide, "
                f"{len(self.blocks)} layers, {len(self.parameters())} parameters)")


@contextlib.contextmanager
def no_gc():
    """Turn the collector off for a stretch of work that makes a lot of graph."""
    raise NotImplementedError
    yield
~~~

~~~tests
import math
import random

# stage nine still holds
block = Block(dim=8, heads=2, rng=random.Random(3))
assert block(Tensor.randn(5, 8, random.Random(4))).shape == (5, 8)

with no_gc():
    model = GPT(vocab_size=24, block_size=8, dim=16, heads=2, layers=2,
                rng=random.Random(0))

    assert model.vocab_size == 24 and model.dim == 16
    assert len(model.blocks) == 2
    assert repr(model).startswith("GPT(24 tokens, 16 wide, 2 layers,")

    # a score per token, per position
    ids = [1, 2, 3, 4]
    logits = model(ids)
    assert logits.shape == (4, 24)

    # an untrained model has no opinion, so its loss is the log of the
    # vocabulary size. this is the first thing to check on any training run
    # and the cheapest bug that machine learning has.
    starting = model.loss(ids, [2, 3, 4, 5]).data
    assert abs(starting - math.log(24)) < 0.4, (starting, math.log(24))

    # weight tying: the unembedding is the embedding, turned on its side
    assert model.tie is True
    table = model.embeddings.tokens.weight
    assert model.head.weight.shape == (16, 24)
    assert table.shape == (24, 16)
    for i in range(24):
        for j in range(16):
            assert model.head.weight[j][i] is table[i][j], "the same objects"

    # so it is counted once, and an optimiser cannot update it twice
    found = model.parameters()
    assert len({id(p) for p in found}) == len(found)

    untied = GPT(24, 8, 16, 2, 2, random.Random(0), tie=False)
    assert len(untied.parameters()) - len(model.parameters()) == 24 * 16
    assert untied.head.weight[0][0] is not untied.embeddings.tokens.weight[0][0]

    # the arithmetic of the count, so a change to the model shows up here
    per_block = len(block.parameters())
    expected = (24 * 16 + 8 * 16) + 2 * len(model.blocks[0].parameters()) + 2 * 16
    assert len(model.parameters()) == expected, (len(model.parameters()), expected)

    # more tokens than positions is refused, because there is no row for them
    try:
        model(list(range(9)))
    except ValueError as exc:
        assert "positions to put them in" in str(exc)
    else:
        raise AssertionError("nine tokens do not fit in eight positions")

    assert model(list(range(8))).shape == (8, 24)
    assert model([0]).shape == (1, 24)

    # the mask survives the whole model, which is the last chance to catch it
    long_ids = [1, 2, 3, 4, 5]
    before = model(long_ids).tolist()
    after = model([1, 2, 3, 4, 9]).tolist()
    for i in range(4):
        for a, b in zip(before[i], after[i]):
            assert abs(a - b) < 1e-12, f"position {i} saw the change at position 4"
    assert before[4] != after[4]

    # and a gradient reaches every parameter in it, which is what training needs
    model.zero_grad()
    model.loss(ids, [2, 3, 4, 5]).backward()
    untouched = [p for p in model.parameters() if p.grad == 0.0]
    assert len(untouched) < len(model.parameters()) * 0.2, len(untouched)
    for part in (model.embeddings, model.norm, *model.blocks):
        assert any(p.grad != 0.0 for p in part.parameters())

    # the embedding gets a gradient from both ends when the weights are tied
    assert any(v.grad != 0.0 for v in model.embeddings.tokens.weight[1])

    # a real sentence, end to end
    tokenizer = Tokenizer.train(CORPUS, vocab_size=24)
    small = GPT(tokenizer.vocab_size, 8, 12, 2, 1, random.Random(1))
    text_ids = tokenizer.encode("the cat sat")[:8]
    assert small(text_ids).shape == (len(text_ids), tokenizer.vocab_size)
    assert small.loss(text_ids[:-1], text_ids[1:]).data > 0

# the collector is on again afterwards, whatever happened inside
import gc as gc_module
assert gc_module.isenabled()


def failing():
    with no_gc():
        raise ValueError("something went wrong mid step")


try:
    failing()
except ValueError:
    pass
assert gc_module.isenabled(), "an exception must not leave the collector off"
~~~

~~~solution
import collections
import contextlib
import gc
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"


class LayerNorm(Module):
    """Each row rescaled to mean zero and variance one, then scaled again.

    Across the features of one position, not across the batch. Batch norm
    normalises across the examples that happened to be together, which makes a
    model's answer depend on what else was in the batch with it and behave
    differently once training stops. This depends on nothing outside the row,
    so it is the same during training and afterwards, and it is why every
    transformer uses it.

    The learned gain and bias are what stop it being a straitjacket: having
    forced every row to the same scale, the model can put back whatever scale
    it actually wanted.
    """

    def __init__(self, dim, eps=1e-5):
        self.dim = dim
        # Not for cosmetic safety. A row that is already constant has zero
        # variance, and the inverse square root of zero is not a number, so
        # without this a single dead row makes the entire model nan.
        self.eps = eps
        self.gain = Tensor([[1.0] * dim])
        self.bias = Tensor.zeros(1, dim)

    def forward(self, x):
        if x.cols != self.dim:
            raise ValueError(f"a norm over {self.dim} was given {x.cols}")
        scale = 1.0 / self.dim
        rows = []
        for row in x:
            mean = vsum(row) * scale
            centred = [value - mean for value in row]
            variance = vsum([value * value for value in centred]) * scale
            inverse = (variance + self.eps) ** -0.5
            rows.append([
                value * inverse * gain + bias
                for value, gain, bias in zip(centred, self.gain[0], self.bias[0],
                                             strict=True)
            ])
        return Tensor(rows)

    def parameters(self):
        return self.gain.values() + self.bias.values()

    def __repr__(self):
        return f"LayerNorm({self.dim})"


class Block(Module):
    """Attention, then a feed forward, each wrapped in a residual.

    Two decisions, and both are about where things go rather than what they
    are.

    The residual is `x + f(x)` rather than `f(x)`. The gradient reaches the
    bottom of a deep stack through the addition, which passes it along
    untouched, as well as through f, which multiplies it by something at every
    layer. Without that path a stack of more than a few layers does not train
    at all, and this one line is most of why deep networks became possible.

    The normalisation goes before the sublayer rather than after it. The
    original paper put it after; everybody moved it, because with it before,
    the path from the top of the stack to the bottom is nothing but additions,
    with no normalisation sitting in the middle of it rescaling the gradient.
    """

    def __init__(self, dim, heads, rng, expansion=4):
        self.dim = dim
        self.norm1 = LayerNorm(dim)
        self.attention = MultiHeadAttention(dim, heads, rng)
        self.norm2 = LayerNorm(dim)
        self.mlp = MLP(dim, rng, expansion)

    def forward(self, x):
        x = x + self.attention(self.norm1(x))
        return x + self.mlp(self.norm2(x))

    def parameters(self):
        return (self.norm1.parameters() + self.attention.parameters()
                + self.norm2.parameters() + self.mlp.parameters())

    def __repr__(self):
        return f"Block({self.dim}, {self.attention.head_count} heads)"


class GPT(Module):
    """Embeddings, a stack of blocks, a last normalisation, and back to tokens.

    Every part of this was built already. What is left is the order, the shape
    at each step, and one decision about the last matrix.
    """

    def __init__(self, vocab_size, block_size, dim, heads, layers, rng,
                 expansion=4, tie=True):
        self.vocab_size = vocab_size
        self.block_size = block_size
        self.dim = dim
        self.embeddings = Embeddings(vocab_size, block_size, dim, rng)
        self.blocks = [Block(dim, heads, rng, expansion) for _ in range(layers)]
        self.norm = LayerNorm(dim)
        self.head = Linear(dim, vocab_size, rng, bias=False)
        self.tie = tie
        if tie:
            # The embedding maps a token to a direction. The unembedding maps a
            # direction back to a score per token. They are two views of the
            # same relationship, so GPT-2 and most things since use one matrix
            # for both. It saves vocab times dim parameters, which in a real
            # model is a large fraction of the total, and it says something
            # true: a token's input vector and its output vector should agree.
            self.head.weight = self.embeddings.tokens.weight.transpose()

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens, and this model has {self.block_size} "
                f"positions to put them in"
            )
        x = self.embeddings(ids)
        for block in self.blocks:
            x = block(x)
        return self.head(self.norm(x))

    def loss(self, ids, targets):
        """The cross-entropy of predicting each next token."""
        return cross_entropy(self(ids), targets)

    def parameters(self):
        """Every parameter once.

        Once matters. Tying makes one matrix reachable by two routes, and an
        optimiser handed it twice would apply its update twice, which is a bug
        that looks like a badly chosen learning rate.
        """
        found, seen = [], set()
        for part in [self.embeddings, *self.blocks, self.norm, self.head]:
            for parameter in part.parameters():
                if id(parameter) not in seen:
                    seen.add(id(parameter))
                    found.append(parameter)
        return found

    def __repr__(self):
        return (f"GPT({self.vocab_size} tokens, {self.dim} wide, "
                f"{len(self.blocks)} layers, {len(self.parameters())} parameters)")


@contextlib.contextmanager
def no_gc():
    """Turn the collector off for a stretch of work that makes a lot of graph.

    One forward pass of this model builds about a quarter of a million small
    objects. Python's generational collector walks every tracked object looking
    for cycles, over and over while the graph is still being built, and finds
    none, because stage one made sure there are none to find. Measured here:
    80 ms a step with it on, 31 ms with it off.

    Nothing leaks while it is off, because a graph with no cycles in it is
    freed by reference counting as soon as the last name for it goes away. The
    collect on the way out is for whatever else the caller did, not for the
    graph, which is why this can wrap a whole training run rather than having
    to sit inside the loop.
    """
    gc.disable()
    try:
        yield
    finally:
        gc.enable()
        gc.collect()
~~~

## Making it better, one step at a time

Plain gradient descent takes a step of the same size for every parameter,
whatever that parameter's gradient has been doing lately. Adam keeps two
running averages per parameter, one of the gradient and one of its square, and
divides the first by the root of the second. A parameter with a small but
consistent gradient then moves about as far as one with a large and erratic
one, which is why Adam trains things plain descent cannot. The test puts a
gradient of 0.0001 next to one of 100 and checks they end up having moved
about the same distance.

The bias correction is the part that is easy to leave out and hard to notice.
Both averages start at zero, so for the first few steps they are dragged
towards zero and the updates come out far too small. Dividing by one minus beta
to the power of the step number undoes exactly that. The test checks the first
step is about one learning rate whatever the gradient was, which is only true
if the correction is there.

The W has a paper of its own. Weight decay written as an L2 term added to the
loss goes into those same running averages and gets rescaled along with
everything else, which is not what anybody meant by it. Decoupling it, so the
weight is shrunk directly, is one line, and it is what every transformer is
trained with.

The loop returns its losses instead of printing them. A loop that only prints
can only be watched, and the test here has to be able to say the loss went
down. The fastest proof that all eleven stages work is memorising a single
window of eight tokens: the loss starts at the log of the vocabulary size and
ends near zero, and the model then predicts those eight tokens exactly.

One habit from that test is worth taking with you. It measures the loss again
after the last update rather than trusting the last value the loop reported,
because those are different numbers: the reported one was computed before the
step that followed it. A learning rate slightly too high makes a run that looks
converged on the value it prints while bouncing on the weights it actually
kept, and only the second measurement notices.

@goal `AdamW` corrects its bias and decays properly, and the model learns.

~~~starter
import collections
import contextlib
import gc
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"


class LayerNorm(Module):
    """Each row rescaled to mean zero and variance one, then scaled again.

    Across the features of one position, not across the batch. Batch norm
    normalises across the examples that happened to be together, which makes a
    model's answer depend on what else was in the batch with it and behave
    differently once training stops. This depends on nothing outside the row,
    so it is the same during training and afterwards, and it is why every
    transformer uses it.

    The learned gain and bias are what stop it being a straitjacket: having
    forced every row to the same scale, the model can put back whatever scale
    it actually wanted.
    """

    def __init__(self, dim, eps=1e-5):
        self.dim = dim
        # Not for cosmetic safety. A row that is already constant has zero
        # variance, and the inverse square root of zero is not a number, so
        # without this a single dead row makes the entire model nan.
        self.eps = eps
        self.gain = Tensor([[1.0] * dim])
        self.bias = Tensor.zeros(1, dim)

    def forward(self, x):
        if x.cols != self.dim:
            raise ValueError(f"a norm over {self.dim} was given {x.cols}")
        scale = 1.0 / self.dim
        rows = []
        for row in x:
            mean = vsum(row) * scale
            centred = [value - mean for value in row]
            variance = vsum([value * value for value in centred]) * scale
            inverse = (variance + self.eps) ** -0.5
            rows.append([
                value * inverse * gain + bias
                for value, gain, bias in zip(centred, self.gain[0], self.bias[0],
                                             strict=True)
            ])
        return Tensor(rows)

    def parameters(self):
        return self.gain.values() + self.bias.values()

    def __repr__(self):
        return f"LayerNorm({self.dim})"


class Block(Module):
    """Attention, then a feed forward, each wrapped in a residual.

    Two decisions, and both are about where things go rather than what they
    are.

    The residual is `x + f(x)` rather than `f(x)`. The gradient reaches the
    bottom of a deep stack through the addition, which passes it along
    untouched, as well as through f, which multiplies it by something at every
    layer. Without that path a stack of more than a few layers does not train
    at all, and this one line is most of why deep networks became possible.

    The normalisation goes before the sublayer rather than after it. The
    original paper put it after; everybody moved it, because with it before,
    the path from the top of the stack to the bottom is nothing but additions,
    with no normalisation sitting in the middle of it rescaling the gradient.
    """

    def __init__(self, dim, heads, rng, expansion=4):
        self.dim = dim
        self.norm1 = LayerNorm(dim)
        self.attention = MultiHeadAttention(dim, heads, rng)
        self.norm2 = LayerNorm(dim)
        self.mlp = MLP(dim, rng, expansion)

    def forward(self, x):
        x = x + self.attention(self.norm1(x))
        return x + self.mlp(self.norm2(x))

    def parameters(self):
        return (self.norm1.parameters() + self.attention.parameters()
                + self.norm2.parameters() + self.mlp.parameters())

    def __repr__(self):
        return f"Block({self.dim}, {self.attention.head_count} heads)"


class GPT(Module):
    """Embeddings, a stack of blocks, a last normalisation, and back to tokens.

    Every part of this was built already. What is left is the order, the shape
    at each step, and one decision about the last matrix.
    """

    def __init__(self, vocab_size, block_size, dim, heads, layers, rng,
                 expansion=4, tie=True):
        self.vocab_size = vocab_size
        self.block_size = block_size
        self.dim = dim
        self.embeddings = Embeddings(vocab_size, block_size, dim, rng)
        self.blocks = [Block(dim, heads, rng, expansion) for _ in range(layers)]
        self.norm = LayerNorm(dim)
        self.head = Linear(dim, vocab_size, rng, bias=False)
        self.tie = tie
        if tie:
            # The embedding maps a token to a direction. The unembedding maps a
            # direction back to a score per token. They are two views of the
            # same relationship, so GPT-2 and most things since use one matrix
            # for both. It saves vocab times dim parameters, which in a real
            # model is a large fraction of the total, and it says something
            # true: a token's input vector and its output vector should agree.
            self.head.weight = self.embeddings.tokens.weight.transpose()

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens, and this model has {self.block_size} "
                f"positions to put them in"
            )
        x = self.embeddings(ids)
        for block in self.blocks:
            x = block(x)
        return self.head(self.norm(x))

    def loss(self, ids, targets):
        """The cross-entropy of predicting each next token."""
        return cross_entropy(self(ids), targets)

    def parameters(self):
        """Every parameter once.

        Once matters. Tying makes one matrix reachable by two routes, and an
        optimiser handed it twice would apply its update twice, which is a bug
        that looks like a badly chosen learning rate.
        """
        found, seen = [], set()
        for part in [self.embeddings, *self.blocks, self.norm, self.head]:
            for parameter in part.parameters():
                if id(parameter) not in seen:
                    seen.add(id(parameter))
                    found.append(parameter)
        return found

    def __repr__(self):
        return (f"GPT({self.vocab_size} tokens, {self.dim} wide, "
                f"{len(self.blocks)} layers, {len(self.parameters())} parameters)")


@contextlib.contextmanager
def no_gc():
    """Turn the collector off for a stretch of work that makes a lot of graph.

    One forward pass of this model builds about a quarter of a million small
    objects. Python's generational collector walks every tracked object looking
    for cycles, over and over while the graph is still being built, and finds
    none, because stage one made sure there are none to find. Measured here:
    80 ms a step with it on, 31 ms with it off.

    Nothing leaks while it is off, because a graph with no cycles in it is
    freed by reference counting as soon as the last name for it goes away. The
    collect on the way out is for whatever else the caller did, not for the
    graph, which is why this can wrap a whole training run rather than having
    to sit inside the loop.
    """
    gc.disable()
    try:
        yield
    finally:
        gc.enable()
        gc.collect()


class AdamW:
    """Adam, with the weight decay done the way the second paper says."""

    def __init__(self, parameters, lr=0.01, betas=(0.9, 0.999), eps=1e-8,
                 weight_decay=0.01):
        self.parameters = list(parameters)
        self.lr = lr
        self.beta1, self.beta2 = betas
        self.eps = eps
        self.weight_decay = weight_decay
        self.steps = 0
        self.average = [0.0] * len(self.parameters)
        self.square = [0.0] * len(self.parameters)

    def zero_grad(self):
        raise NotImplementedError

    def step(self):
        """One update for every parameter, from the gradients on them now."""
        raise NotImplementedError

    def __repr__(self):
        return (f"AdamW({len(self.parameters)} parameters, lr={self.lr}, "
                f"decay={self.weight_decay})")


def train(model, ids, steps, rng, lr=0.05, batch_size=1, weight_decay=0.01,
          report=None):
    """Train, and return the loss at every step."""
    raise NotImplementedError
~~~

~~~tests
import math
import random

# stage ten still holds
tokenizer = Tokenizer.train(CORPUS, vocab_size=24)
ids = tokenizer.encode(CORPUS)
assert tokenizer.decode(ids) == CORPUS

# the optimiser, on a problem with a known answer
target = Value(0.0)
optimiser = AdamW([target], lr=0.1, weight_decay=0.0)
assert repr(optimiser) == "AdamW(1 parameters, lr=0.1, decay=0.0)"
for _ in range(200):
    loss = (target - 3.0) ** 2
    optimiser.zero_grad()
    loss.backward()
    optimiser.step()
assert abs(target.data - 3.0) < 0.01, target.data

# the first step is about one learning rate, whatever the gradient was, which
# is what the bias correction is for
for gradient in (0.001, 1.0, 1000.0):
    parameter = Value(0.0)
    single = AdamW([parameter], lr=0.1, weight_decay=0.0)
    parameter.grad = gradient
    single.step()
    assert abs(abs(parameter.data) - 0.1) < 1e-6, (gradient, parameter.data)

# without the correction the first steps would be tiny. this checks the
# correction is actually applied rather than assumed
uncorrected = 0.1 * ((1 - 0.9) * 1.0) / (((1 - 0.999) * 1.0) ** 0.5 + 1e-8)
assert abs(uncorrected - 0.1) > 0.2, "the uncorrected first step is nothing like lr"

# a parameter with no gradient at all still shrinks, which is what decay is
decaying = Value(10.0)
decay_only = AdamW([decaying], lr=0.1, weight_decay=0.5)
for _ in range(5):
    decaying.grad = 0.0
    decay_only.step()
assert decaying.data < 10.0
assert abs(decaying.data - 10.0 * 0.95 ** 5) < 1e-9, decaying.data

# and with no decay it does not
still = Value(10.0)
no_decay = AdamW([still], lr=0.1, weight_decay=0.0)
still.grad = 0.0
no_decay.step()
assert still.data == 10.0

# zeroing is the optimiser's job too, because it holds the list
a, b = Value(1.0), Value(2.0)
a.grad, b.grad = 5.0, 5.0
AdamW([a, b]).zero_grad()
assert a.grad == 0.0 and b.grad == 0.0

# two parameters with very different gradients move by similar amounts, which
# is the whole reason for Adam rather than plain descent
small, large = Value(0.0), Value(0.0)
pair = AdamW([small, large], lr=0.1, weight_decay=0.0)
for _ in range(20):
    small.grad, large.grad = 0.0001, 100.0
    pair.step()
assert abs(abs(small.data) - abs(large.data)) < 0.01, (small.data, large.data)

# now the model. memorising one window is the fastest proof the whole pipeline
# works: forward, loss, backward, update, all of it
model = GPT(tokenizer.vocab_size, block_size=8, dim=12, heads=2, layers=1,
            rng=random.Random(1))
window, shifted = ids[:8], ids[1:9]
losses = []
with no_gc():
    fitting = AdamW(model.parameters(), lr=0.05, weight_decay=0.0)
    for _ in range(60):
        loss = model.loss(window, shifted)
        fitting.zero_grad()
        loss.backward()
        fitting.step()
        losses.append(loss.data)

    # measured after the last update rather than before it, which is the state
    # the model is actually left in. the two differ, and a run that looks
    # converged on the value it reports can be mid-bounce on the value it kept
    final = model.loss(window, shifted).data
    predictions = [max(range(tokenizer.vocab_size), key=lambda t: row[t].data)
                   for row in model(window)]

assert abs(losses[0] - math.log(tokenizer.vocab_size)) < 0.5, losses[0]
assert final < 0.05, f"it should have memorised eight tokens: {final}"
assert final < losses[0] / 50

# and having memorised them, it predicts them
assert predictions == shifted, (predictions, shifted)

# the loss went down steadily rather than by luck
assert sum(losses[:10]) / 10 > sum(losses[-10:]) / 10
assert sum(losses[-10:]) / 10 < 0.05

# the training loop on the real corpus, and the loss going the right way
learner = GPT(tokenizer.vocab_size, 8, 12, 2, 1, random.Random(0))
history = train(learner, ids, steps=30, rng=random.Random(0), lr=0.1)
assert len(history) == 30
assert sum(history[-5:]) / 5 < sum(history[:5]) / 5, history[:5] + history[-5:]
assert all(value > 0 for value in history)

# the history is returned rather than printed, which is what lets this be a test
seen = []
train(learner, ids, steps=3, rng=random.Random(1), lr=0.1,
      report=lambda step, value: seen.append((step, value)))
assert [step for step, _ in seen] == [0, 1, 2]

# a batch of more than one averages the losses over it
batched = GPT(tokenizer.vocab_size, 8, 12, 2, 1, random.Random(2))
assert len(train(batched, ids, steps=3, rng=random.Random(0), lr=0.1,
                 batch_size=2)) == 3

# the same seed gives the same run, which is the only way to compare two of them
first = train(GPT(tokenizer.vocab_size, 8, 12, 2, 1, random.Random(3)), ids,
              steps=5, rng=random.Random(9), lr=0.1)
again = train(GPT(tokenizer.vocab_size, 8, 12, 2, 1, random.Random(3)), ids,
              steps=5, rng=random.Random(9), lr=0.1)
assert first == again

# each step's graph is gone before the next one is built, with the collector
# off for the whole run. that only holds because the graph has no cycles in it,
# and if it had any this number would climb by a quarter of a million a step
# until the run ended or the memory did.
import gc as gc_module

live = []
train(GPT(tokenizer.vocab_size, 8, 8, 2, 1, random.Random(5)), ids, steps=6,
      rng=random.Random(0), lr=0.05,
      report=lambda step, value: live.append(len(gc_module.get_objects())))
assert max(live) - min(live) < 5000, f"the graphs are piling up: {live}"

# and the same thing said directly: a graph dropped with the collector off
# leaves nothing behind for it to find
gc_module.collect()
with no_gc():
    scratch = Value(1.0)
    for _ in range(500):
        scratch = scratch * 1.0 + 0.5
    scratch.backward()
    del scratch
assert gc_module.collect() == 0, "a cycle-free graph needs no collector"

# and the collector is back on when it is over
assert gc_module.isenabled()
~~~

~~~solution
import collections
import contextlib
import gc
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"


class LayerNorm(Module):
    """Each row rescaled to mean zero and variance one, then scaled again.

    Across the features of one position, not across the batch. Batch norm
    normalises across the examples that happened to be together, which makes a
    model's answer depend on what else was in the batch with it and behave
    differently once training stops. This depends on nothing outside the row,
    so it is the same during training and afterwards, and it is why every
    transformer uses it.

    The learned gain and bias are what stop it being a straitjacket: having
    forced every row to the same scale, the model can put back whatever scale
    it actually wanted.
    """

    def __init__(self, dim, eps=1e-5):
        self.dim = dim
        # Not for cosmetic safety. A row that is already constant has zero
        # variance, and the inverse square root of zero is not a number, so
        # without this a single dead row makes the entire model nan.
        self.eps = eps
        self.gain = Tensor([[1.0] * dim])
        self.bias = Tensor.zeros(1, dim)

    def forward(self, x):
        if x.cols != self.dim:
            raise ValueError(f"a norm over {self.dim} was given {x.cols}")
        scale = 1.0 / self.dim
        rows = []
        for row in x:
            mean = vsum(row) * scale
            centred = [value - mean for value in row]
            variance = vsum([value * value for value in centred]) * scale
            inverse = (variance + self.eps) ** -0.5
            rows.append([
                value * inverse * gain + bias
                for value, gain, bias in zip(centred, self.gain[0], self.bias[0],
                                             strict=True)
            ])
        return Tensor(rows)

    def parameters(self):
        return self.gain.values() + self.bias.values()

    def __repr__(self):
        return f"LayerNorm({self.dim})"


class Block(Module):
    """Attention, then a feed forward, each wrapped in a residual.

    Two decisions, and both are about where things go rather than what they
    are.

    The residual is `x + f(x)` rather than `f(x)`. The gradient reaches the
    bottom of a deep stack through the addition, which passes it along
    untouched, as well as through f, which multiplies it by something at every
    layer. Without that path a stack of more than a few layers does not train
    at all, and this one line is most of why deep networks became possible.

    The normalisation goes before the sublayer rather than after it. The
    original paper put it after; everybody moved it, because with it before,
    the path from the top of the stack to the bottom is nothing but additions,
    with no normalisation sitting in the middle of it rescaling the gradient.
    """

    def __init__(self, dim, heads, rng, expansion=4):
        self.dim = dim
        self.norm1 = LayerNorm(dim)
        self.attention = MultiHeadAttention(dim, heads, rng)
        self.norm2 = LayerNorm(dim)
        self.mlp = MLP(dim, rng, expansion)

    def forward(self, x):
        x = x + self.attention(self.norm1(x))
        return x + self.mlp(self.norm2(x))

    def parameters(self):
        return (self.norm1.parameters() + self.attention.parameters()
                + self.norm2.parameters() + self.mlp.parameters())

    def __repr__(self):
        return f"Block({self.dim}, {self.attention.head_count} heads)"


class GPT(Module):
    """Embeddings, a stack of blocks, a last normalisation, and back to tokens.

    Every part of this was built already. What is left is the order, the shape
    at each step, and one decision about the last matrix.
    """

    def __init__(self, vocab_size, block_size, dim, heads, layers, rng,
                 expansion=4, tie=True):
        self.vocab_size = vocab_size
        self.block_size = block_size
        self.dim = dim
        self.embeddings = Embeddings(vocab_size, block_size, dim, rng)
        self.blocks = [Block(dim, heads, rng, expansion) for _ in range(layers)]
        self.norm = LayerNorm(dim)
        self.head = Linear(dim, vocab_size, rng, bias=False)
        self.tie = tie
        if tie:
            # The embedding maps a token to a direction. The unembedding maps a
            # direction back to a score per token. They are two views of the
            # same relationship, so GPT-2 and most things since use one matrix
            # for both. It saves vocab times dim parameters, which in a real
            # model is a large fraction of the total, and it says something
            # true: a token's input vector and its output vector should agree.
            self.head.weight = self.embeddings.tokens.weight.transpose()

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens, and this model has {self.block_size} "
                f"positions to put them in"
            )
        x = self.embeddings(ids)
        for block in self.blocks:
            x = block(x)
        return self.head(self.norm(x))

    def loss(self, ids, targets):
        """The cross-entropy of predicting each next token."""
        return cross_entropy(self(ids), targets)

    def parameters(self):
        """Every parameter once.

        Once matters. Tying makes one matrix reachable by two routes, and an
        optimiser handed it twice would apply its update twice, which is a bug
        that looks like a badly chosen learning rate.
        """
        found, seen = [], set()
        for part in [self.embeddings, *self.blocks, self.norm, self.head]:
            for parameter in part.parameters():
                if id(parameter) not in seen:
                    seen.add(id(parameter))
                    found.append(parameter)
        return found

    def __repr__(self):
        return (f"GPT({self.vocab_size} tokens, {self.dim} wide, "
                f"{len(self.blocks)} layers, {len(self.parameters())} parameters)")


@contextlib.contextmanager
def no_gc():
    """Turn the collector off for a stretch of work that makes a lot of graph.

    One forward pass of this model builds about a quarter of a million small
    objects. Python's generational collector walks every tracked object looking
    for cycles, over and over while the graph is still being built, and finds
    none, because stage one made sure there are none to find. Measured here:
    80 ms a step with it on, 31 ms with it off.

    Nothing leaks while it is off, because a graph with no cycles in it is
    freed by reference counting as soon as the last name for it goes away. The
    collect on the way out is for whatever else the caller did, not for the
    graph, which is why this can wrap a whole training run rather than having
    to sit inside the loop.
    """
    gc.disable()
    try:
        yield
    finally:
        gc.enable()
        gc.collect()


class AdamW:
    """Adam, with the weight decay done the way the second paper says.

    Plain gradient descent takes a step of the same size for every parameter,
    whatever that parameter's gradient has been doing. Adam keeps two running
    averages per parameter, one of the gradient and one of its square, and
    divides the first by the root of the second. A parameter with a small but
    consistent gradient then moves about as far as one with a large and erratic
    one, which is why Adam trains things that plain descent cannot.

    The W has a paper of its own. Weight decay written as an L2 term added to
    the loss goes into those same running averages and gets rescaled along with
    everything else, which is not what anybody meant by it. Decoupling it, so
    the weight is shrunk directly, is one line, and it is what every
    transformer is trained with.
    """

    def __init__(self, parameters, lr=0.01, betas=(0.9, 0.999), eps=1e-8,
                 weight_decay=0.01):
        self.parameters = list(parameters)
        self.lr = lr
        self.beta1, self.beta2 = betas
        self.eps = eps
        self.weight_decay = weight_decay
        self.steps = 0
        self.average = [0.0] * len(self.parameters)
        self.square = [0.0] * len(self.parameters)

    def zero_grad(self):
        for parameter in self.parameters:
            parameter.grad = 0.0

    def step(self):
        """One update for every parameter, from the gradients on them now."""
        self.steps += 1
        # Both averages start at zero, so for the first few steps they are
        # pulled towards zero and the updates come out far too small. Dividing
        # by one minus beta to the power of the step number undoes exactly
        # that, and it matters most at the start, which is where a training run
        # is most fragile.
        correct1 = 1 - self.beta1 ** self.steps
        correct2 = 1 - self.beta2 ** self.steps
        for i, parameter in enumerate(self.parameters):
            gradient = parameter.grad
            self.average[i] = (self.beta1 * self.average[i]
                               + (1 - self.beta1) * gradient)
            self.square[i] = (self.beta2 * self.square[i]
                              + (1 - self.beta2) * gradient * gradient)
            mean = self.average[i] / correct1
            spread = (self.square[i] / correct2) ** 0.5
            if self.weight_decay:
                parameter.data -= self.lr * self.weight_decay * parameter.data
            parameter.data -= self.lr * mean / (spread + self.eps)

    def __repr__(self):
        return (f"AdamW({len(self.parameters)} parameters, lr={self.lr}, "
                f"decay={self.weight_decay})")


def train(model, ids, steps, rng, lr=0.05, batch_size=1, weight_decay=0.01,
          report=None):
    """Train, and return the loss at every step.

    Returning the history rather than printing it is what lets a test assert
    that learning happened. A loop that only prints can only be watched.
    """
    optimiser = AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    history = []
    # Around the whole run, not around each step. Each step's graph is freed by
    # reference counting the moment the next step rebinds `total`, because the
    # graph has no cycles in it, so there is nothing here for a per-step
    # collect to do. The test measures that the live count stays flat.
    with no_gc():
        for step in range(steps):
            inputs, targets = batch(ids, model.block_size, batch_size, rng)
            total = None
            for window, shifted in zip(inputs, targets, strict=True):
                loss = model.loss(window, shifted)
                total = loss if total is None else total + loss
            total = total * (1.0 / len(inputs))
            optimiser.zero_grad()
            total.backward()
            optimiser.step()
            history.append(total.data)
            if report is not None:
                report(step, total.data)
    return history
~~~

## Writing something

A trained model gives a score per token. Turning that into text is the last
stage, and every choice in it is about how much risk to take.

Greedy decoding takes the highest score every time. It is repeatable, and it
gets stuck: a model that has said "the cat sat on the" will say it again, and
then again, because the most likely continuation of a loop is more loop.

Sampling walks the distribution until a running total passes a random
threshold. Temperature divides the scores before the softmax, and it is the
dial between those two behaviours: below one it sharpens towards the
favourite, above one it flattens towards a coin toss, at zero there is nothing
left to sample and it is greedy again.

`top_k` is the one people underestimate. The tail of a vocabulary is thousands
of tokens each with a tiny probability, and together they are not tiny at all,
so a long enough sample eventually reaches into it and the text falls apart.
Keeping the best few and renormalising is a two-line fix for that, and the test
shows the difference directly: with a high temperature and no `top_k`, every
token in the vocabulary comes up, and with `top_k=2` only two ever do.

Two things about the loop itself. The context is cropped to the last
`block_size` tokens, because that is how many positions the model has and
everything before them is gone. That crop is exactly what a context window is.
And every token costs a whole forward pass over everything written so far,
because nothing is remembered between steps, which is why real implementations
cache the keys and values of positions they have already seen.

Then the last test, which is the whole project in one line. The model learns
the opening of the corpus, and is then asked to write it back from its first
token alone. It does.

@goal `generate` continues a prompt, and a trained model writes back what it learned.

~~~starter
import collections
import contextlib
import gc
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"


class LayerNorm(Module):
    """Each row rescaled to mean zero and variance one, then scaled again.

    Across the features of one position, not across the batch. Batch norm
    normalises across the examples that happened to be together, which makes a
    model's answer depend on what else was in the batch with it and behave
    differently once training stops. This depends on nothing outside the row,
    so it is the same during training and afterwards, and it is why every
    transformer uses it.

    The learned gain and bias are what stop it being a straitjacket: having
    forced every row to the same scale, the model can put back whatever scale
    it actually wanted.
    """

    def __init__(self, dim, eps=1e-5):
        self.dim = dim
        # Not for cosmetic safety. A row that is already constant has zero
        # variance, and the inverse square root of zero is not a number, so
        # without this a single dead row makes the entire model nan.
        self.eps = eps
        self.gain = Tensor([[1.0] * dim])
        self.bias = Tensor.zeros(1, dim)

    def forward(self, x):
        if x.cols != self.dim:
            raise ValueError(f"a norm over {self.dim} was given {x.cols}")
        scale = 1.0 / self.dim
        rows = []
        for row in x:
            mean = vsum(row) * scale
            centred = [value - mean for value in row]
            variance = vsum([value * value for value in centred]) * scale
            inverse = (variance + self.eps) ** -0.5
            rows.append([
                value * inverse * gain + bias
                for value, gain, bias in zip(centred, self.gain[0], self.bias[0],
                                             strict=True)
            ])
        return Tensor(rows)

    def parameters(self):
        return self.gain.values() + self.bias.values()

    def __repr__(self):
        return f"LayerNorm({self.dim})"


class Block(Module):
    """Attention, then a feed forward, each wrapped in a residual.

    Two decisions, and both are about where things go rather than what they
    are.

    The residual is `x + f(x)` rather than `f(x)`. The gradient reaches the
    bottom of a deep stack through the addition, which passes it along
    untouched, as well as through f, which multiplies it by something at every
    layer. Without that path a stack of more than a few layers does not train
    at all, and this one line is most of why deep networks became possible.

    The normalisation goes before the sublayer rather than after it. The
    original paper put it after; everybody moved it, because with it before,
    the path from the top of the stack to the bottom is nothing but additions,
    with no normalisation sitting in the middle of it rescaling the gradient.
    """

    def __init__(self, dim, heads, rng, expansion=4):
        self.dim = dim
        self.norm1 = LayerNorm(dim)
        self.attention = MultiHeadAttention(dim, heads, rng)
        self.norm2 = LayerNorm(dim)
        self.mlp = MLP(dim, rng, expansion)

    def forward(self, x):
        x = x + self.attention(self.norm1(x))
        return x + self.mlp(self.norm2(x))

    def parameters(self):
        return (self.norm1.parameters() + self.attention.parameters()
                + self.norm2.parameters() + self.mlp.parameters())

    def __repr__(self):
        return f"Block({self.dim}, {self.attention.head_count} heads)"


class GPT(Module):
    """Embeddings, a stack of blocks, a last normalisation, and back to tokens.

    Every part of this was built already. What is left is the order, the shape
    at each step, and one decision about the last matrix.
    """

    def __init__(self, vocab_size, block_size, dim, heads, layers, rng,
                 expansion=4, tie=True):
        self.vocab_size = vocab_size
        self.block_size = block_size
        self.dim = dim
        self.embeddings = Embeddings(vocab_size, block_size, dim, rng)
        self.blocks = [Block(dim, heads, rng, expansion) for _ in range(layers)]
        self.norm = LayerNorm(dim)
        self.head = Linear(dim, vocab_size, rng, bias=False)
        self.tie = tie
        if tie:
            # The embedding maps a token to a direction. The unembedding maps a
            # direction back to a score per token. They are two views of the
            # same relationship, so GPT-2 and most things since use one matrix
            # for both. It saves vocab times dim parameters, which in a real
            # model is a large fraction of the total, and it says something
            # true: a token's input vector and its output vector should agree.
            self.head.weight = self.embeddings.tokens.weight.transpose()

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens, and this model has {self.block_size} "
                f"positions to put them in"
            )
        x = self.embeddings(ids)
        for block in self.blocks:
            x = block(x)
        return self.head(self.norm(x))

    def loss(self, ids, targets):
        """The cross-entropy of predicting each next token."""
        return cross_entropy(self(ids), targets)

    def parameters(self):
        """Every parameter once.

        Once matters. Tying makes one matrix reachable by two routes, and an
        optimiser handed it twice would apply its update twice, which is a bug
        that looks like a badly chosen learning rate.
        """
        found, seen = [], set()
        for part in [self.embeddings, *self.blocks, self.norm, self.head]:
            for parameter in part.parameters():
                if id(parameter) not in seen:
                    seen.add(id(parameter))
                    found.append(parameter)
        return found

    def __repr__(self):
        return (f"GPT({self.vocab_size} tokens, {self.dim} wide, "
                f"{len(self.blocks)} layers, {len(self.parameters())} parameters)")


@contextlib.contextmanager
def no_gc():
    """Turn the collector off for a stretch of work that makes a lot of graph.

    One forward pass of this model builds about a quarter of a million small
    objects. Python's generational collector walks every tracked object looking
    for cycles, over and over while the graph is still being built, and finds
    none, because stage one made sure there are none to find. Measured here:
    80 ms a step with it on, 31 ms with it off.

    Nothing leaks while it is off, because a graph with no cycles in it is
    freed by reference counting as soon as the last name for it goes away. The
    collect on the way out is for whatever else the caller did, not for the
    graph, which is why this can wrap a whole training run rather than having
    to sit inside the loop.
    """
    gc.disable()
    try:
        yield
    finally:
        gc.enable()
        gc.collect()


class AdamW:
    """Adam, with the weight decay done the way the second paper says.

    Plain gradient descent takes a step of the same size for every parameter,
    whatever that parameter's gradient has been doing. Adam keeps two running
    averages per parameter, one of the gradient and one of its square, and
    divides the first by the root of the second. A parameter with a small but
    consistent gradient then moves about as far as one with a large and erratic
    one, which is why Adam trains things that plain descent cannot.

    The W has a paper of its own. Weight decay written as an L2 term added to
    the loss goes into those same running averages and gets rescaled along with
    everything else, which is not what anybody meant by it. Decoupling it, so
    the weight is shrunk directly, is one line, and it is what every
    transformer is trained with.
    """

    def __init__(self, parameters, lr=0.01, betas=(0.9, 0.999), eps=1e-8,
                 weight_decay=0.01):
        self.parameters = list(parameters)
        self.lr = lr
        self.beta1, self.beta2 = betas
        self.eps = eps
        self.weight_decay = weight_decay
        self.steps = 0
        self.average = [0.0] * len(self.parameters)
        self.square = [0.0] * len(self.parameters)

    def zero_grad(self):
        for parameter in self.parameters:
            parameter.grad = 0.0

    def step(self):
        """One update for every parameter, from the gradients on them now."""
        self.steps += 1
        # Both averages start at zero, so for the first few steps they are
        # pulled towards zero and the updates come out far too small. Dividing
        # by one minus beta to the power of the step number undoes exactly
        # that, and it matters most at the start, which is where a training run
        # is most fragile.
        correct1 = 1 - self.beta1 ** self.steps
        correct2 = 1 - self.beta2 ** self.steps
        for i, parameter in enumerate(self.parameters):
            gradient = parameter.grad
            self.average[i] = (self.beta1 * self.average[i]
                               + (1 - self.beta1) * gradient)
            self.square[i] = (self.beta2 * self.square[i]
                              + (1 - self.beta2) * gradient * gradient)
            mean = self.average[i] / correct1
            spread = (self.square[i] / correct2) ** 0.5
            if self.weight_decay:
                parameter.data -= self.lr * self.weight_decay * parameter.data
            parameter.data -= self.lr * mean / (spread + self.eps)

    def __repr__(self):
        return (f"AdamW({len(self.parameters)} parameters, lr={self.lr}, "
                f"decay={self.weight_decay})")


def train(model, ids, steps, rng, lr=0.05, batch_size=1, weight_decay=0.01,
          report=None):
    """Train, and return the loss at every step.

    Returning the history rather than printing it is what lets a test assert
    that learning happened. A loop that only prints can only be watched.
    """
    optimiser = AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    history = []
    # Around the whole run, not around each step. Each step's graph is freed by
    # reference counting the moment the next step rebinds `total`, because the
    # graph has no cycles in it, so there is nothing here for a per-step
    # collect to do. The test measures that the live count stays flat.
    with no_gc():
        for step in range(steps):
            inputs, targets = batch(ids, model.block_size, batch_size, rng)
            total = None
            for window, shifted in zip(inputs, targets, strict=True):
                loss = model.loss(window, shifted)
                total = loss if total is None else total + loss
            total = total * (1.0 / len(inputs))
            optimiser.zero_grad()
            total.backward()
            optimiser.step()
            history.append(total.data)
            if report is not None:
                report(step, total.data)
    return history


def softmax_floats(scores):
    """The same thing as `softmax`, on plain numbers."""
    raise NotImplementedError


def pick(probabilities, rng=None):
    """One index, chosen with the probability given to it."""
    raise NotImplementedError


def choose(scores, rng=None, temperature=1.0, top_k=None):
    """One token id from a row of scores."""
    raise NotImplementedError


def generate(model, tokenizer, prompt, length, rng=None, temperature=1.0,
             top_k=None):
    """Continue the prompt, one token at a time."""
    raise NotImplementedError
~~~

~~~tests
import math
import random

# stage eleven still holds
target = Value(0.0)
optimiser = AdamW([target], lr=0.1, weight_decay=0.0)
for _ in range(200):
    loss = (target - 3.0) ** 2
    optimiser.zero_grad()
    loss.backward()
    optimiser.step()
assert abs(target.data - 3.0) < 0.01

# the plain softmax is the same answer without the graph
scores = [1.0, 2.0, 0.5]
for plain, built in zip(softmax_floats(scores), softmax([Value(s) for s in scores])):
    assert abs(plain - built.data) < 1e-12
assert abs(sum(softmax_floats([900.0, 901.0])) - 1.0) < 1e-12, "the shift is here too"

# picking with no generator is taking the best
assert pick([0.1, 0.7, 0.2]) == 1
assert pick([1.0]) == 0


class Fixed:
    """A generator that returns exactly what a test wants to try."""

    def __init__(self, value):
        self.value = value

    def random(self):
        return self.value


# the walk through the cumulative total, at both ends and in the middle
distribution = [0.2, 0.5, 0.3]
assert pick(distribution, Fixed(0.0)) == 0
assert pick(distribution, Fixed(0.1)) == 0
assert pick(distribution, Fixed(0.3)) == 1
assert pick(distribution, Fixed(0.7)) == 1
assert pick(distribution, Fixed(0.8)) == 2
assert pick(distribution, Fixed(1.0)) == 2

# and over many draws it lands where the probabilities said it would
rng = random.Random(0)
counts = [0, 0, 0]
for _ in range(2000):
    counts[pick(distribution, rng)] += 1
for count, expected in zip(counts, distribution):
    assert abs(count / 2000 - expected) < 0.05, (counts, distribution)

# temperature. zero is greedy, because there is nothing left to sample from
row = [1.0, 3.0, 2.0]
assert choose(row, temperature=0) == 1
assert choose(row) == 1, "no generator is greedy too"
assert choose([Value(v) for v in row], temperature=0) == 1, "Values work as well"

# cold is nearly greedy, hot is nearly a coin toss
cold = [choose(row, random.Random(i), temperature=0.1) for i in range(50)]
assert set(cold) == {1}, set(cold)
hot = [choose(row, random.Random(i), temperature=50.0) for i in range(200)]
assert len(set(hot)) == 3, "at a high enough temperature everything is possible"
assert 40 < hot.count(0) < 100, hot.count(0)

# top k keeps that many and drops the rest, whatever the temperature
wide = [5.0, 4.0, 3.0, 2.0, 1.0]
kept = [choose(wide, random.Random(i), temperature=10.0, top_k=2) for i in range(200)]
assert set(kept) == {0, 1}, set(kept)
assert set(choose(wide, random.Random(i), temperature=10.0) for i in range(200)) == {
    0, 1, 2, 3, 4
}, "without it the tail is reachable, which is the whole reason for it"

assert choose(wide, random.Random(0), top_k=1) == 0, "top k of one is greedy"
assert choose(wide, random.Random(0), temperature=99.0, top_k=1) == 0

for bad in (0, -1):
    try:
        choose(wide, rng, top_k=bad)
    except ValueError as exc:
        assert "at least one token" in str(exc)
    else:
        raise AssertionError(f"top_k={bad} keeps nothing")

try:
    choose(wide, rng, temperature=-1.0)
except ValueError as exc:
    assert "prefer the worst" in str(exc)
else:
    raise AssertionError("a negative temperature is not a temperature")

# now generation. the model has to learn something first, so it memorises the
# opening of the corpus, and then it is asked to write it back out
tokenizer = Tokenizer.train(CORPUS, vocab_size=24)
ids = tokenizer.encode(CORPUS)
model = GPT(tokenizer.vocab_size, block_size=8, dim=12, heads=2, layers=1,
            rng=random.Random(1))

with no_gc():
    fitting = AdamW(model.parameters(), lr=0.05, weight_decay=0.0)
    for _ in range(60):
        loss = model.loss(ids[:8], ids[1:9])
        fitting.zero_grad()
        loss.backward()
        fitting.step()
    assert model.loss(ids[:8], ids[1:9]).data < 0.05

    opening = tokenizer.decode(ids[:8])
    first_token = tokenizer.decode(ids[:1])
    written = generate(model, tokenizer, first_token, 7)

    # the whole project, in one line: it wrote back what it was taught
    assert written == opening, (written, opening)
    assert written.startswith(first_token)

    # greedy and top k of one are the same thing
    assert generate(model, tokenizer, first_token, 7, random.Random(0), top_k=1) == written

    # and with no generator it is repeatable, because nothing is random
    assert generate(model, tokenizer, first_token, 7) == written

    # the prompt always survives, and the length is what was asked for
    for length in (0, 1, 5):
        out = generate(model, tokenizer, "the ", length)
        assert out.startswith("the ")
        assert len(tokenizer.encode(out)) == len(tokenizer.encode("the ")) + length

    # a prompt longer than the model's context is cropped rather than refused,
    # because that is what a context window means
    long_prompt = CORPUS[:200]
    assert len(tokenizer.encode(long_prompt)) > model.block_size
    continued = generate(model, tokenizer, long_prompt, 3)
    assert continued.startswith(long_prompt)
    assert len(tokenizer.encode(continued)) == len(tokenizer.encode(long_prompt)) + 3

    # sampling with a generator can differ from greedy, and is repeatable per seed
    sampled = generate(model, tokenizer, first_token, 7, random.Random(4),
                       temperature=5.0)
    assert generate(model, tokenizer, first_token, 7, random.Random(4),
                    temperature=5.0) == sampled
    assert len(tokenizer.encode(sampled)) == 8

    # nothing to continue is an error rather than an empty string
    try:
        generate(model, tokenizer, "", 5)
    except ValueError as exc:
        assert "nothing here to continue" in str(exc)
    else:
        raise AssertionError("there was no prompt")

assert math.isfinite(model.loss(ids[:8], ids[1:9]).data)
~~~

~~~solution
import collections
import contextlib
import gc
import math


class Value:
    """One number, and the derivative of the loss with respect to it.

    This is micrograd, condensed, with the handful of operations a transformer
    needs that the original did not have. The idea has not changed: every
    operation records how to push a gradient back to the values it came from,
    and `backward` walks that record once, in reverse.
    """

    __slots__ = ("data", "grad", "_back", "_prev")

    def __init__(self, data, children=()):
        self.data = float(data)
        self.grad = 0.0
        self._back = _nothing
        self._prev = children

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other))

        def back(grad):
            self.grad += grad
            other.grad += grad

        out._back = back
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other))

        def back(grad):
            self.grad += other.data * grad
            other.grad += self.data * grad

        out._back = back
        return out

    def __pow__(self, power):
        if not isinstance(power, (int, float)):
            raise TypeError("only a number power, so the rule stays one line")
        out = Value(self.data ** power, (self,))

        def back(grad):
            self.grad += power * self.data ** (power - 1) * grad

        out._back = back
        return out

    def exp(self):
        value = math.exp(self.data)
        out = Value(value, (self,))

        def back(grad):
            # the derivative of exp is exp, which is the value already computed
            self.grad += value * grad

        out._back = back
        return out

    def log(self):
        if self.data <= 0:
            raise ValueError(f"log of {self.data}, which has no gradient to give")
        out = Value(math.log(self.data), (self,))

        def back(grad):
            self.grad += grad / self.data

        out._back = back
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,))

        def back(grad):
            self.grad += (1 - t * t) * grad

        out._back = back
        return out

    def relu(self):
        positive = self.data > 0
        out = Value(self.data if positive else 0.0, (self,))

        def back(grad):
            self.grad += positive * grad

        out._back = back
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -Value(other))

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other ** -1

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __rsub__(self, other):
        return Value(other) - self

    def __rtruediv__(self, other):
        return Value(other) / self

    def backward(self):
        """Every gradient in the graph, from this value backwards.

        The topological sort is iterative rather than recursive, and that is
        not tidiness. A graph running through a few transformer layers is
        thousands of nodes deep, and a recursive walk of it hits Python's
        stack limit long before it finishes. The explicit stack does not care.
        """
        order, seen = [], set()
        pending = [(self, False)]
        while pending:
            node, expanded = pending.pop()
            if expanded:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            pending.append((node, True))
            for child in node._prev:
                if id(child) not in seen:
                    pending.append((child, False))
        self.grad = 1.0
        for node in reversed(order):
            node._back(node.grad)

    def __repr__(self):
        return f"Value({self.data:.4f}, grad={self.grad:.4f})"


def _nothing(grad):
    """What a leaf does on the way back, which is nothing."""


def vsum(values):
    """Values added left to right, starting from the first rather than zero.

    `sum` would begin at the integer zero and build one extra node per call,
    and in a graph this size that is thousands of nodes doing nothing. Starting
    from the first value costs the same arithmetic and half the graph.
    """
    total = values[0]
    for value in values[1:]:
        total = total + value
    return total


def dot(row, column):
    """The sum of the products of two rows."""
    return vsum([a * b for a, b in zip(row, column, strict=True)])


class Tensor:
    """A rectangular grid of Values, and the operations a transformer needs.

    Two dimensions and no more. A batch is a loop over sequences rather than
    another axis, which keeps every shape check to one comparison and every
    operation to something you can read in one sitting.
    """

    __slots__ = ("data", "rows", "cols")

    def __init__(self, data):
        rows = [list(row) for row in data]
        self.cols = len(rows[0]) if rows else 0
        for row in rows:
            if len(row) != self.cols:
                raise ValueError(
                    f"a tensor is rectangular, and this one has rows of "
                    f"{sorted({len(r) for r in rows})}"
                )
        self.data = [[v if isinstance(v, Value) else Value(v) for v in row]
                     for row in rows]
        self.rows = len(self.data)

    @property
    def shape(self):
        return (self.rows, self.cols)

    @classmethod
    def zeros(cls, rows, cols):
        return cls([[0.0] * cols for _ in range(rows)])

    @classmethod
    def randn(cls, rows, cols, rng, std=1.0):
        """Normal noise from a seeded generator, so a run repeats exactly."""
        return cls([[rng.gauss(0.0, std) for _ in range(cols)] for _ in range(rows)])

    def __getitem__(self, index):
        return self.data[index]

    def __iter__(self):
        return iter(self.data)

    def transpose(self):
        # strict, because a ragged tensor cannot exist and a check that can
        # never fire is a check that says so
        return Tensor([list(column) for column in zip(*self.data, strict=True)])

    def __matmul__(self, other):
        if self.cols != other.rows:
            raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
        # Transposed once, so the inner loop walks a list instead of striding
        # across rows. In pure Python that is most of the cost of a matmul.
        columns = other.transpose().data
        return Tensor([[dot(row, column) for column in columns]
                       for row in self.data])

    def __add__(self, other):
        if not isinstance(other, Tensor):
            return self.apply(lambda v: v + other)
        if other.shape == self.shape:
            return Tensor([[a + b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        if other.rows == 1 and other.cols == self.cols:
            # One row added to every row, which is what a bias is and the only
            # broadcast this needs.
            bias = other.data[0]
            return Tensor([[a + b for a, b in zip(row, bias, strict=True)]
                           for row in self.data])
        raise ValueError(f"cannot add {other.shape} to {self.shape}")

    def __mul__(self, other):
        if isinstance(other, Tensor):
            if other.shape != self.shape:
                raise ValueError(f"cannot multiply {self.shape} by {other.shape}")
            return Tensor([[a * b for a, b in zip(x, y, strict=True)]
                           for x, y in zip(self.data, other.data, strict=True)])
        return self.apply(lambda v: v * other)

    __rmul__ = __mul__
    __radd__ = __add__

    def apply(self, fn):
        """The same function on every element, which is most of what is left."""
        return Tensor([[fn(v) for v in row] for row in self.data])

    def rows_as_lists(self):
        return [list(row) for row in self.data]

    def values(self):
        """Every Value in the grid, flat, in reading order."""
        return [v for row in self.data for v in row]

    def total(self):
        return vsum(self.values())

    def mean(self):
        return self.total() * (1.0 / (self.rows * self.cols))

    def tolist(self):
        """Plain floats, for looking at and for comparing in a test."""
        return [[v.data for v in row] for row in self.data]

    def __repr__(self):
        return f"Tensor({self.rows}x{self.cols})"


# Small, but not a single sentence repeated: byte pair encoding on one repeated
# string collapses the whole thing into a handful of tokens and teaches nothing
# about what it does on text. This has words that recur in different company,
# which is what both the tokenizer and the model need in order to have anything
# to learn.
CORPUS = (
    "the cat sat on the mat. the dog sat on the log. "
    "a cat and a dog met on the road. the cat ran and the dog sat. "
    "no dog can catch a cat that sat on a hot tin roof. "
    "the mat and the log and the road are all that a cat needs. "
) * 3


def merge(ids, pair, new):
    """Every occurrence of the adjacent pair, replaced by one id."""
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(new)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class Tokenizer:
    """The characters in the corpus, then byte pair merges on top of them.

    The tokenizer project started from bytes, so that nothing could ever be out
    of vocabulary. Here the corpus is the whole world the model will see, so
    the alphabet is what is in it, and that matters for a reason that is not
    tidiness: the output layer of the model is one column per token, and a
    vocabulary of 256 would be most of the arithmetic in this project.
    """

    def __init__(self, alphabet, merges=()):
        self.alphabet = list(alphabet)
        self.merges = [(tuple(pair), new) for pair, new in merges]
        self.ids = {ch: i for i, ch in enumerate(self.alphabet)}
        self.tokens = dict(enumerate(self.alphabet))
        for (a, b), new in self.merges:
            self.tokens[new] = self.tokens[a] + self.tokens[b]

    @property
    def vocab_size(self):
        return len(self.tokens)

    @classmethod
    def train(cls, text, vocab_size):
        """Merge the commonest adjacent pair, over and over, until full.

        Stopping early when no pair repeats is the part people leave out. A
        merge of something that happens once makes the vocabulary bigger and
        the encoding no shorter.
        """
        alphabet = sorted(set(text))
        if vocab_size < len(alphabet):
            raise ValueError(
                f"{vocab_size} is smaller than the {len(alphabet)} characters "
                f"in the text, and every character needs an id"
            )
        base = cls(alphabet)
        ids = [base.ids[ch] for ch in text]
        merges, next_id = [], len(alphabet)
        while next_id < vocab_size:
            pairs = collections.Counter(zip(ids, ids[1:], strict=False))
            if not pairs:
                break
            pair, count = pairs.most_common(1)[0]
            if count < 2:
                break
            ids = merge(ids, pair, next_id)
            merges.append((pair, next_id))
            next_id += 1
        return cls(alphabet, merges)

    def encode(self, text):
        """Text as ids, applying the merges in the order they were learned."""
        unknown = sorted({ch for ch in text if ch not in self.ids})
        if unknown:
            raise ValueError(f"not in the alphabet: {unknown}")
        ids = [self.ids[ch] for ch in text]
        for pair, new in self.merges:
            ids = merge(ids, pair, new)
        return ids

    def decode(self, ids):
        return "".join(self.tokens[i] for i in ids)

    def __repr__(self):
        return (f"Tokenizer({len(self.alphabet)} characters, "
                f"{len(self.merges)} merges, {self.vocab_size} tokens)")


def batch(ids, block_size, batch_size, rng):
    """Windows of `block_size` ids, and the same windows shifted along by one.

    The target for position t is the token at t + 1. That shift is the whole of
    what a language model is trained on, and it is why one window teaches
    `block_size` predictions rather than one: every position in it is a
    question whose answer is the next position.
    """
    if len(ids) <= block_size:
        raise ValueError(
            f"a corpus of {len(ids)} tokens has no window of {block_size} "
            f"with something after it"
        )
    inputs, targets = [], []
    for _ in range(batch_size):
        start = rng.randrange(len(ids) - block_size)
        inputs.append(ids[start:start + block_size])
        targets.append(ids[start + 1:start + 1 + block_size])
    return inputs, targets


class Module:
    """Anything with parameters. Two methods, and that is the whole protocol.

    PyTorch's version scans attributes for other modules and collects their
    parameters by magic. This one asks each class to say what it holds, which
    is three more lines per class and no rule to remember.
    """

    def parameters(self):
        return []

    def zero_grad(self):
        """Gradients accumulate, so they have to be cleared between steps."""
        for parameter in self.parameters():
            parameter.grad = 0.0

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)


class Embedding(Module):
    """A lookup table, which is a matrix multiply with the zeros skipped.

    The honest description of an embedding is a one-hot vector times a matrix:
    a row of zeros with a single one at position i, multiplied by the table,
    gives row i, because every other term is multiplied by zero. So the lookup
    is that multiply without the arithmetic that was always going to vanish,
    and the gradient goes back to exactly the row that was used.
    """

    def __init__(self, count, dim, rng, std=0.1):
        self.count = count
        self.dim = dim
        self.weight = Tensor.randn(count, dim, rng, std)

    def forward(self, ids):
        for i in ids:
            if not 0 <= i < self.count:
                raise IndexError(f"token {i} is not in a table of {self.count}")
        return Tensor([self.weight[i] for i in ids])

    def parameters(self):
        return self.weight.values()

    def __repr__(self):
        return f"Embedding({self.count}, {self.dim})"


class Embeddings(Module):
    """What a token is, plus where it is, added together.

    Attention has no idea what order anything came in. It sees a set, and every
    position looks the same to it, so "cat sat" and "sat cat" would be
    identical without this. The position embedding is what breaks that tie.

    Adding rather than joining side by side is the choice the original paper
    made and everyone kept: it costs no extra width, and the model is free to
    use different directions of the same space for the two jobs.
    """

    def __init__(self, vocab_size, block_size, dim, rng, std=0.1):
        self.block_size = block_size
        self.dim = dim
        self.tokens = Embedding(vocab_size, dim, rng, std)
        self.positions = Embedding(block_size, dim, rng, std)

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens is longer than the {self.block_size} this "
                f"model has positions for"
            )
        return self.tokens(ids) + self.positions(range(len(ids)))

    def parameters(self):
        return self.tokens.parameters() + self.positions.parameters()


class Linear(Module):
    """x @ W + b, which is every learned transform in the model.

    The initialisation matters more than the code does. Weights scaled by one
    over the square root of the fan in keep activations about the same size
    going in and coming out, so a stack of these neither explodes nor fades to
    nothing before training has had a chance to start. Get that wrong and the
    model does not learn slowly, it does not learn.
    """

    def __init__(self, fan_in, fan_out, rng, bias=True):
        self.fan_in = fan_in
        self.fan_out = fan_out
        self.weight = Tensor.randn(fan_in, fan_out, rng, std=fan_in ** -0.5)
        # Biases start at zero rather than at noise. There is nothing for a
        # random offset to break symmetry between, which is the only reason the
        # weights are random at all.
        self.bias = Tensor.zeros(1, fan_out) if bias else None

    def forward(self, x):
        if x.cols != self.fan_in:
            raise ValueError(
                f"a linear taking {self.fan_in} was given {x.cols}"
            )
        out = x @ self.weight
        return out if self.bias is None else out + self.bias

    def parameters(self):
        values = self.weight.values()
        return values if self.bias is None else values + self.bias.values()

    def __repr__(self):
        return f"Linear({self.fan_in}, {self.fan_out})"


SQRT_2_OVER_PI = 0.7978845608028654


def gelu(v):
    """A relu that bends instead of breaking, in the form the GPT papers used.

    relu has a corner at zero and no gradient at all below it, so a unit that
    wanders negative stops learning and never comes back. gelu is smooth
    everywhere and lets a small negative value through slightly reduced, which
    is why every transformer since 2018 uses it.
    """
    inner = SQRT_2_OVER_PI * (v + 0.044715 * v ** 3)
    return 0.5 * v * (1 + inner.tanh())


class MLP(Module):
    """Wide in the middle, and back out again.

    Attention moves information between positions. This is where each position
    thinks about what it now holds, on its own, with no reference to any other.
    Four times wider in the middle is the number the papers settled on: enough
    room to compute something the narrow dimension could not hold, and not so
    much that it takes over the parameter count.
    """

    def __init__(self, dim, rng, expansion=4):
        self.dim = dim
        self.up = Linear(dim, dim * expansion, rng)
        self.down = Linear(dim * expansion, dim, rng)

    def forward(self, x):
        return self.down(self.up(x).apply(gelu))

    def parameters(self):
        return self.up.parameters() + self.down.parameters()


def softmax(row):
    """A row of scores as a distribution over the same positions.

    Subtracting the largest entry first is not an optimisation, it is what
    makes this work at all. `exp(1000)` is infinity, and once one entry is
    infinity the whole row is nan. After the subtraction the biggest exponent
    is `exp(0)`, which is 1.

    It costs nothing to be right about, because every term is divided by the
    total: subtracting the same constant from all of them multiplies the top
    and the bottom by the same number, and the answer does not move.
    """
    biggest = max(v.data for v in row)
    exps = [(v - biggest).exp() for v in row]
    total = vsum(exps)
    return [value / total for value in exps]


def log_softmax(row):
    """The log of the same thing, without ever taking a log of a small number."""
    biggest = max(v.data for v in row)
    shifted = [v - biggest for v in row]
    log_total = vsum([value.exp() for value in shifted]).log()
    return [value - log_total for value in shifted]


def cross_entropy(logits, targets):
    """The average negative log probability the model gave to the right token.

    One row of scores per position, one correct id per position. A model that
    is certain and right scores zero. A model that is certain and wrong scores
    an enormous number, which is the whole reason this loss is used: being
    confidently wrong has to hurt more than being unsure.

    Through `log_softmax` rather than `log(softmax(...))`. The division inside
    softmax underflows to zero for a token the model thinks is impossible, and
    the log of zero has no answer, so the loss becomes nan exactly when the
    model is most wrong. Subtracting a log total never does that.
    """
    if logits.rows != len(targets):
        raise ValueError(
            f"{logits.rows} rows of scores and {len(targets)} targets"
        )
    total = None
    for row, target in zip(logits, targets, strict=True):
        if not 0 <= target < logits.cols:
            raise IndexError(f"target {target} is not one of {logits.cols} tokens")
        picked = -log_softmax(row)[target]
        total = picked if total is None else total + picked
    return total * (1.0 / len(targets))


def weighted_sum(weights, rows):
    """Each row scaled by its weight, added up into one vector."""
    out = [weights[0] * value for value in rows[0]]
    for weight, row in zip(weights[1:], rows[1:], strict=True):
        out = [total + weight * value
               for total, value in zip(out, row, strict=True)]
    return out


class Head(Module):
    """One attention head: ask, offer, and take a weighted average.

    Three linear maps of the same input, and the names are the explanation. The
    query is what this position is looking for. The key is what each position
    advertises. The value is what a position hands over when it is chosen. The
    score between two positions is the dot product of one query with one key,
    which is large when they point the same way.

    Then softmax over the scores, and the output is that weighted average of
    the values. Nothing else happens. Every position ends up holding a mixture
    of the positions it decided were relevant, and which those are is learned
    rather than fixed.
    """

    def __init__(self, dim, head_size, rng, causal=True):
        self.dim = dim
        self.head_size = head_size
        self.causal = causal
        # No biases. A bias on a query or a key adds a constant to every score
        # in a row, and softmax already ignores a constant added to every entry
        # of a row, so it would be parameters that cannot change the answer.
        self.query = Linear(dim, head_size, rng, bias=False)
        self.key = Linear(dim, head_size, rng, bias=False)
        self.value = Linear(dim, head_size, rng, bias=False)
        # Without this, scores grow with head size: a dot product of vectors of
        # length d has a spread of about sqrt(d), so a wide head produces large
        # scores, softmax saturates into a hard choice, and the gradient
        # through it goes to nothing before training starts.
        self.scale = head_size ** -0.5

    def attend(self, x):
        """The output and the attention pattern that produced it."""
        if x.cols != self.dim:
            raise ValueError(f"a head over {self.dim} was given {x.cols}")
        queries = self.query(x).rows_as_lists()
        keys = self.key(x).rows_as_lists()
        values = self.value(x).rows_as_lists()

        out, patterns = [], []
        for i, query in enumerate(queries):
            # Up to and including this position when causal. A model allowed to
            # see position i + 1 while predicting it scores perfectly and
            # learns nothing, which is the most common way to get a language
            # model wrong and the hardest to notice, because the loss looks
            # wonderful.
            last = i + 1 if self.causal else len(keys)
            scores = [dot(query, keys[j]) * self.scale for j in range(last)]
            weights = softmax(scores)
            patterns.append(weights)
            out.append(weighted_sum(weights, values[:last]))
        return Tensor(out), patterns

    def forward(self, x):
        return self.attend(x)[0]

    def parameters(self):
        return (self.query.parameters() + self.key.parameters()
                + self.value.parameters())

    def __repr__(self):
        kind = "causal" if self.causal else "full"
        return f"Head({self.dim} -> {self.head_size}, {kind})"


class MultiHeadAttention(Module):
    """Several heads at once, joined side by side and projected back.

    One head produces one set of weights per position, so it can express one
    kind of relationship at a time. Four narrower heads can attend to four
    different things at once, for the same total width and very nearly the same
    arithmetic, which is the whole argument for doing it. In a trained model
    one head often tracks the previous token, another the matching bracket,
    another the subject of the sentence.

    The projection at the end is not a formality. Without it, each slice of the
    output could only ever be written by one head, and nothing would combine
    what they found.
    """

    def __init__(self, dim, heads, rng, causal=True):
        if dim % heads:
            raise ValueError(
                f"{dim} does not divide into {heads} heads: the heads are "
                f"slices of the width, so they have to fit exactly"
            )
        self.dim = dim
        self.head_count = heads
        self.head_size = dim // heads
        self.heads = [Head(dim, self.head_size, rng, causal) for _ in range(heads)]
        self.project = Linear(dim, dim, rng)

    def concat(self, x):
        """Every head's output, side by side, before the projection."""
        outputs = [head(x) for head in self.heads]
        return Tensor([[value for out in outputs for value in out[i]]
                       for i in range(x.rows)])

    def forward(self, x):
        return self.project(self.concat(x))

    def parameters(self):
        found = list(self.project.parameters())
        for head in self.heads:
            found.extend(head.parameters())
        return found

    def __repr__(self):
        return f"MultiHeadAttention({self.dim}, {self.head_count} heads)"


class LayerNorm(Module):
    """Each row rescaled to mean zero and variance one, then scaled again.

    Across the features of one position, not across the batch. Batch norm
    normalises across the examples that happened to be together, which makes a
    model's answer depend on what else was in the batch with it and behave
    differently once training stops. This depends on nothing outside the row,
    so it is the same during training and afterwards, and it is why every
    transformer uses it.

    The learned gain and bias are what stop it being a straitjacket: having
    forced every row to the same scale, the model can put back whatever scale
    it actually wanted.
    """

    def __init__(self, dim, eps=1e-5):
        self.dim = dim
        # Not for cosmetic safety. A row that is already constant has zero
        # variance, and the inverse square root of zero is not a number, so
        # without this a single dead row makes the entire model nan.
        self.eps = eps
        self.gain = Tensor([[1.0] * dim])
        self.bias = Tensor.zeros(1, dim)

    def forward(self, x):
        if x.cols != self.dim:
            raise ValueError(f"a norm over {self.dim} was given {x.cols}")
        scale = 1.0 / self.dim
        rows = []
        for row in x:
            mean = vsum(row) * scale
            centred = [value - mean for value in row]
            variance = vsum([value * value for value in centred]) * scale
            inverse = (variance + self.eps) ** -0.5
            rows.append([
                value * inverse * gain + bias
                for value, gain, bias in zip(centred, self.gain[0], self.bias[0],
                                             strict=True)
            ])
        return Tensor(rows)

    def parameters(self):
        return self.gain.values() + self.bias.values()

    def __repr__(self):
        return f"LayerNorm({self.dim})"


class Block(Module):
    """Attention, then a feed forward, each wrapped in a residual.

    Two decisions, and both are about where things go rather than what they
    are.

    The residual is `x + f(x)` rather than `f(x)`. The gradient reaches the
    bottom of a deep stack through the addition, which passes it along
    untouched, as well as through f, which multiplies it by something at every
    layer. Without that path a stack of more than a few layers does not train
    at all, and this one line is most of why deep networks became possible.

    The normalisation goes before the sublayer rather than after it. The
    original paper put it after; everybody moved it, because with it before,
    the path from the top of the stack to the bottom is nothing but additions,
    with no normalisation sitting in the middle of it rescaling the gradient.
    """

    def __init__(self, dim, heads, rng, expansion=4):
        self.dim = dim
        self.norm1 = LayerNorm(dim)
        self.attention = MultiHeadAttention(dim, heads, rng)
        self.norm2 = LayerNorm(dim)
        self.mlp = MLP(dim, rng, expansion)

    def forward(self, x):
        x = x + self.attention(self.norm1(x))
        return x + self.mlp(self.norm2(x))

    def parameters(self):
        return (self.norm1.parameters() + self.attention.parameters()
                + self.norm2.parameters() + self.mlp.parameters())

    def __repr__(self):
        return f"Block({self.dim}, {self.attention.head_count} heads)"


class GPT(Module):
    """Embeddings, a stack of blocks, a last normalisation, and back to tokens.

    Every part of this was built already. What is left is the order, the shape
    at each step, and one decision about the last matrix.
    """

    def __init__(self, vocab_size, block_size, dim, heads, layers, rng,
                 expansion=4, tie=True):
        self.vocab_size = vocab_size
        self.block_size = block_size
        self.dim = dim
        self.embeddings = Embeddings(vocab_size, block_size, dim, rng)
        self.blocks = [Block(dim, heads, rng, expansion) for _ in range(layers)]
        self.norm = LayerNorm(dim)
        self.head = Linear(dim, vocab_size, rng, bias=False)
        self.tie = tie
        if tie:
            # The embedding maps a token to a direction. The unembedding maps a
            # direction back to a score per token. They are two views of the
            # same relationship, so GPT-2 and most things since use one matrix
            # for both. It saves vocab times dim parameters, which in a real
            # model is a large fraction of the total, and it says something
            # true: a token's input vector and its output vector should agree.
            self.head.weight = self.embeddings.tokens.weight.transpose()

    def forward(self, ids):
        if len(ids) > self.block_size:
            raise ValueError(
                f"{len(ids)} tokens, and this model has {self.block_size} "
                f"positions to put them in"
            )
        x = self.embeddings(ids)
        for block in self.blocks:
            x = block(x)
        return self.head(self.norm(x))

    def loss(self, ids, targets):
        """The cross-entropy of predicting each next token."""
        return cross_entropy(self(ids), targets)

    def parameters(self):
        """Every parameter once.

        Once matters. Tying makes one matrix reachable by two routes, and an
        optimiser handed it twice would apply its update twice, which is a bug
        that looks like a badly chosen learning rate.
        """
        found, seen = [], set()
        for part in [self.embeddings, *self.blocks, self.norm, self.head]:
            for parameter in part.parameters():
                if id(parameter) not in seen:
                    seen.add(id(parameter))
                    found.append(parameter)
        return found

    def __repr__(self):
        return (f"GPT({self.vocab_size} tokens, {self.dim} wide, "
                f"{len(self.blocks)} layers, {len(self.parameters())} parameters)")


@contextlib.contextmanager
def no_gc():
    """Turn the collector off for a stretch of work that makes a lot of graph.

    One forward pass of this model builds about a quarter of a million small
    objects. Python's generational collector walks every tracked object looking
    for cycles, over and over while the graph is still being built, and finds
    none, because stage one made sure there are none to find. Measured here:
    80 ms a step with it on, 31 ms with it off.

    Nothing leaks while it is off, because a graph with no cycles in it is
    freed by reference counting as soon as the last name for it goes away. The
    collect on the way out is for whatever else the caller did, not for the
    graph, which is why this can wrap a whole training run rather than having
    to sit inside the loop.
    """
    gc.disable()
    try:
        yield
    finally:
        gc.enable()
        gc.collect()


class AdamW:
    """Adam, with the weight decay done the way the second paper says.

    Plain gradient descent takes a step of the same size for every parameter,
    whatever that parameter's gradient has been doing. Adam keeps two running
    averages per parameter, one of the gradient and one of its square, and
    divides the first by the root of the second. A parameter with a small but
    consistent gradient then moves about as far as one with a large and erratic
    one, which is why Adam trains things that plain descent cannot.

    The W has a paper of its own. Weight decay written as an L2 term added to
    the loss goes into those same running averages and gets rescaled along with
    everything else, which is not what anybody meant by it. Decoupling it, so
    the weight is shrunk directly, is one line, and it is what every
    transformer is trained with.
    """

    def __init__(self, parameters, lr=0.01, betas=(0.9, 0.999), eps=1e-8,
                 weight_decay=0.01):
        self.parameters = list(parameters)
        self.lr = lr
        self.beta1, self.beta2 = betas
        self.eps = eps
        self.weight_decay = weight_decay
        self.steps = 0
        self.average = [0.0] * len(self.parameters)
        self.square = [0.0] * len(self.parameters)

    def zero_grad(self):
        for parameter in self.parameters:
            parameter.grad = 0.0

    def step(self):
        """One update for every parameter, from the gradients on them now."""
        self.steps += 1
        # Both averages start at zero, so for the first few steps they are
        # pulled towards zero and the updates come out far too small. Dividing
        # by one minus beta to the power of the step number undoes exactly
        # that, and it matters most at the start, which is where a training run
        # is most fragile.
        correct1 = 1 - self.beta1 ** self.steps
        correct2 = 1 - self.beta2 ** self.steps
        for i, parameter in enumerate(self.parameters):
            gradient = parameter.grad
            self.average[i] = (self.beta1 * self.average[i]
                               + (1 - self.beta1) * gradient)
            self.square[i] = (self.beta2 * self.square[i]
                              + (1 - self.beta2) * gradient * gradient)
            mean = self.average[i] / correct1
            spread = (self.square[i] / correct2) ** 0.5
            if self.weight_decay:
                parameter.data -= self.lr * self.weight_decay * parameter.data
            parameter.data -= self.lr * mean / (spread + self.eps)

    def __repr__(self):
        return (f"AdamW({len(self.parameters)} parameters, lr={self.lr}, "
                f"decay={self.weight_decay})")


def train(model, ids, steps, rng, lr=0.05, batch_size=1, weight_decay=0.01,
          report=None):
    """Train, and return the loss at every step.

    Returning the history rather than printing it is what lets a test assert
    that learning happened. A loop that only prints can only be watched.
    """
    optimiser = AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    history = []
    # Around the whole run, not around each step. Each step's graph is freed by
    # reference counting the moment the next step rebinds `total`, because the
    # graph has no cycles in it, so there is nothing here for a per-step
    # collect to do. The test measures that the live count stays flat.
    with no_gc():
        for step in range(steps):
            inputs, targets = batch(ids, model.block_size, batch_size, rng)
            total = None
            for window, shifted in zip(inputs, targets, strict=True):
                loss = model.loss(window, shifted)
                total = loss if total is None else total + loss
            total = total * (1.0 / len(inputs))
            optimiser.zero_grad()
            total.backward()
            optimiser.step()
            history.append(total.data)
            if report is not None:
                report(step, total.data)
    return history


def softmax_floats(scores):
    """The same thing as `softmax`, on plain numbers.

    Sampling has no gradient to carry, so building a graph for it would be
    thousands of objects created and thrown away per token. The shift by the
    largest entry is here for the same reason it is there.
    """
    biggest = max(scores)
    exps = [math.exp(score - biggest) for score in scores]
    total = sum(exps)
    return [value / total for value in exps]


def pick(probabilities, rng=None):
    """One index, chosen with the probability given to it.

    Without a generator this takes the most likely, which is what greedy
    decoding is. With one it walks the distribution until the running total
    passes a random threshold, which is the whole of sampling.
    """
    if rng is None:
        return max(range(len(probabilities)), key=lambda i: probabilities[i])
    threshold = rng.random()
    running = 0.0
    for index, probability in enumerate(probabilities):
        running += probability
        if running >= threshold:
            return index
    return len(probabilities) - 1


def choose(scores, rng=None, temperature=1.0, top_k=None):
    """One token id from a row of scores.

    Temperature divides the scores before the softmax. Below one it sharpens
    the distribution towards the model's favourite, above one it flattens it
    towards a coin toss, and at zero there is nothing left to sample from, so
    it takes the best.

    `top_k` keeps only that many and drops the rest before normalising. The
    reason is arithmetic rather than taste: the tail of a vocabulary is
    thousands of tokens each with a tiny probability, and together they are not
    tiny at all, so a long enough sample will eventually reach into it and the
    text falls apart.
    """
    values = [value.data if isinstance(value, Value) else float(value)
              for value in scores]
    if temperature < 0:
        raise ValueError("a negative temperature would prefer the worst token")
    if temperature == 0:
        return max(range(len(values)), key=lambda i: values[i])
    values = [value / temperature for value in values]

    if top_k is None:
        keep = list(range(len(values)))
    else:
        if top_k < 1:
            raise ValueError("top_k has to keep at least one token")
        keep = sorted(range(len(values)), key=lambda i: values[i],
                      reverse=True)[:top_k]
        keep.sort()
    probabilities = softmax_floats([values[i] for i in keep])
    return keep[pick(probabilities, rng)]


def generate(model, tokenizer, prompt, length, rng=None, temperature=1.0,
             top_k=None):
    """Continue the prompt, one token at a time.

    Every token costs a whole forward pass over everything written so far,
    because nothing is remembered between steps. That is why generation is slow
    and why real implementations cache the keys and values of positions they
    have already seen, which changes the cost per token from growing with the
    length to being flat.
    """
    ids = tokenizer.encode(prompt)
    if not ids:
        raise ValueError("there is nothing here to continue")
    for _ in range(length):
        # Only the last block_size tokens fit, because that is how many
        # positions the model has. Everything before is gone, and that is
        # exactly what a context window is.
        context = ids[-model.block_size:]
        ids.append(choose(model(context)[-1], rng, temperature, top_k))
    return tokenizer.decode(ids)
~~~
