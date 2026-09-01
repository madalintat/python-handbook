---
slug: 08-scope
---

## Reading a name you also assign

`tick` reports the count and then increases it. Both lines refer to the module-level `count`, or so it reads. Run it and note that the error is about a *local* variable, in a function that appears to have none.

@expect raises:UnboundLocalError
@expect ruff:F823
@expect ruff:F841
@hint Python decides where every name lives when the function is compiled, not when each line runs.
@hint Look at `tick.__code__.co_varnames` and ask how `count` got in there.
@diagnose F823 ruff's `F823` is "local variable `count` defined in enclosing scope referenced before assignment", and it is the static form of the same finding. ruff runs the same scoping rules the compiler does, so it can see this without executing anything.
@diagnose F841 A consequence of the first: because `count` is local, the assignment on the last line writes to a local that nothing afterwards reads, so ruff also reports it as assigned and never used. Two complaints, one cause.
@diagnose UnboundLocalError The compiler scanned the whole body before running any of it, saw `count = ...` on the last line, and concluded that `count` is local for the entire function. So the `print` on the first line reads a local slot that has not been filled, and the module-level `count` is never consulted. Reading alone would not have done this; it is the assignment that decides, and every form counts, including `+=`, a `for` target, and `with ... as`. To rebind the module-level name, say `global count`. To leave module state alone, pass the value in and return the new one.

~~~starter
count = 0


def tick():
    """Return the current count, then increase it."""
    current = count
    count = count + 1
    return current


print(tick())
~~~

~~~tests
# the module-level call above has already ticked once
assert tick() == 1
assert tick() == 2
assert count == 3
~~~

~~~solution
count = 0


def tick():
    """Return the current count, then increase it."""
    global count
    current = count
    count = count + 1
    return current


print(tick())
~~~

## A counter that cannot count

`make_counter` returns a function holding a private tally. The inner function reads the tally and adds to it, which makes that name local to the inner function, and the read then has nothing to read.

@expect raises:UnboundLocalError
@expect ruff:F823
@hint `n += 1` is an assignment, so it makes `n` local to `bump`.
@hint You want to rebind a name in the *enclosing function*, not at module level. There is a keyword for exactly that.
@diagnose F823 ruff reports the same defect statically: the name is defined in an enclosing scope and read here before this scope assigns it. A linter that models Python's scoping can see every bug in this unit without running anything, which is worth knowing when you are staring at one.
@diagnose UnboundLocalError Same rule as the previous exercise, one scope inward. `n += 1` assigns, so `n` is local to `bump`, so the read on the right-hand side finds an empty slot. `global` is the wrong fix here because `n` does not live at module level; `nonlocal n` says "bind in the nearest enclosing function scope", which is what a closure with private state needs. Note that no declaration would be needed to *mutate*: if `n` were a list, `n.append(1)` would work untouched, because that is a method call on an object rather than an assignment to a name.

~~~starter
def make_counter():
    """Return a function that returns 1, 2, 3, ... on successive calls."""
    n = 0

    def bump():
        n += 1
        return n

    return bump


print(make_counter()())
~~~

~~~tests
c = make_counter()
assert c() == 1
assert c() == 2
assert c() == 3
other = make_counter()
assert other() == 1, "two counters should not share state"
~~~

~~~solution
def make_counter():
    """Return a function that returns 1, 2, 3, ... on successive calls."""
    n = 0

    def bump():
        nonlocal n
        n += 1
        return n

    return bump


print(make_counter()())
~~~

## Three functions, one variable

`make_adders` builds a function per number. Call them and every one gives the same answer. There is one variable in this loop and three functions all looking at it.

@expect silent
@expect ruff:B023
@hint A closure captures the variable, not the value it held when the closure was made.
@hint By the time any of these run, the loop has finished. What is the loop variable then?
@diagnose B023 ruff's `B023` is "function definition does not bind loop variable `n`", and it exists because this mistake is common enough to deserve its own rule. The wording is precise: the function *uses* the loop variable without *binding* it, so it reads whatever that one variable holds at call time rather than what it held when the function was made.
@diagnose silent Nothing raised, and all three functions agree on the wrong answer. A `for` loop is not a scope, so there is one variable `n` belonging to the enclosing function, reused by every iteration. All three closures hold a reference to that one variable and read it when they are called, which is after the loop has finished and left it at its last value. The fix is to give each closure a variable of its own. A default argument is evaluated at definition time, so `lambda x, n=n: x + n` captures the value; a factory function that takes `n` as a parameter does the same thing more visibly.

~~~starter
def make_adders(numbers):
    """Return one function per number, each adding its own number."""
    adders = []
    for n in numbers:
        adders.append(lambda x: x + n)
    return adders
~~~

~~~tests
add1, add2, add3 = make_adders([1, 2, 3])
assert add1(10) == 11, "the first adder did not add 1"
assert add2(10) == 12
assert add3(10) == 13
~~~

~~~solution
def make_adders(numbers):
    """Return one function per number, each adding its own number."""
    adders = []
    for n in numbers:
        adders.append(lambda x, n=n: x + n)
    return adders
~~~

## Rebinding versus mutating module state

`remember` records a value in a module-level list. It rebinds rather than mutates, which makes the name local, so the module never sees anything. Note which of the two operations would have needed no declaration at all.

@expect raises:UnboundLocalError
@expect ruff:F823
@expect ruff:F841
@hint `SEEN = SEEN + [value]` is an assignment. `SEEN.append(value)` is not.
@hint Only rebinding needs `global`. Mutation reaches through the name.
@diagnose UnboundLocalError Assigning to `SEEN` anywhere in the function makes it local throughout, so the read on the right-hand side finds an unfilled local and never reaches the module-level list at all. Two fixes exist and they are not equivalent. `global SEEN` keeps the rebinding and makes it bind at module level. `SEEN.append(value)` mutates the existing list and needs no declaration whatsoever, because a method call is not an assignment. The second is what you want here, and the fact that it needs no keyword is the clearest statement of the difference between mutation and rebinding you will meet.
@diagnose F823 ruff says the local is referenced before assignment, which is the same finding without running anything.
@diagnose F841 And because the assignment writes to a local nothing later reads, ruff reports that too. One cause, two complaints.

~~~starter
SEEN: list[str] = []


def remember(value):
    """Record a value in the module-level list."""
    SEEN = SEEN + [value]


remember("a")
~~~

~~~tests
# the module-level call above has already recorded "a"
remember("b")
remember("c")
assert SEEN == ["a", "b", "c"], f"the module-level list is {SEEN}"
~~~

~~~solution
SEEN: list[str] = []


def remember(value):
    """Record a value in the module-level list."""
    SEEN.append(value)


remember("a")
~~~

## The comprehension keeps its variable

`last_seen` runs a comprehension and then reads the loop variable afterwards, the way a `for` statement would allow. A comprehension has its own scope, and this is the difference showing.

@expect raises:NameError
@expect ruff:F821
@hint Which constructs introduce a scope? A `for` statement is not one of them.
@hint The comprehension's variable never existed outside it.
@diagnose F821 ruff reports `Undefined name name` without running anything, because the comprehension's variable is not a name in the function at all. A linter that knows the scoping rules can see this as clearly as the interpreter can.
@diagnose NameError A comprehension runs in its own function-like scope, so its loop variable is created and destroyed inside and never leaks. That is a deliberate correction of the `for` statement's behaviour, where the variable does survive and holds the last value. It means a comprehension can never quietly clobber a name you were using, which is worth the small inconvenience here. If you want the last item, ask for it: index the sequence, or keep a `for` statement, which does leave its variable behind.

~~~starter
def last_seen(names):
    """Return the uppercased names, and the last name processed."""
    upper = [name.upper() for name in names]
    return upper, name


print(last_seen(["ada", "bob"]))
~~~

~~~tests
upper, last = last_seen(["ada", "bob"])
assert upper == ["ADA", "BOB"]
assert last == "bob"
assert last_seen([]) == ([], None)
~~~

~~~solution
def last_seen(names):
    """Return the uppercased names, and the last name processed."""
    upper = [name.upper() for name in names]
    return upper, names[-1] if names else None


print(last_seen(["ada", "bob"]))
~~~

## A class body is a scope, but not an enclosing one

`Table` computes a derived value inside the class body, using a comprehension that refers to another class attribute. The comprehension body cannot see it, and the reason is a specific rule about class scope.

@expect raises:NameError
@expect ruff:F821
@expect mypy:name-defined
@hint The comprehension body runs in its own implicit function. Which scopes does a function see?
@hint The class body is a scope, but it is not an *enclosing* scope for functions defined inside it.
@hint Only the first iterable is evaluated outside the comprehension. That is a way in.
@diagnose F821 ruff reports `Undefined name KEYS` for the reference inside the comprehension body, while saying nothing about the identical name in the first iterable. That difference is the rule, visible in a linter's output.
@diagnose name-defined mypy agrees, in its own vocabulary. All three judges see this one, which is a fair indication that the rule is a real part of the language rather than an accident of the interpreter.
@diagnose NameError A comprehension body runs in an implicit function, and a class body is deliberately not an enclosing scope for functions defined inside it. That is the same rule that stops a method from seeing `total` as a bare name and makes it write `self.total`. The **first** iterable is the one exception: it is evaluated in the enclosing scope, which is exactly why `for key in KEYS` works while a reference to `KEYS` inside the body does not. Note that binding it to another class attribute does not help, because that attribute is in the same unreachable scope. The trick that does work is to smuggle the value in through that first iterable: `for keys in [KEYS]` binds `keys` *inside* the comprehension, where the body can see it. Moving the computation into a method is the plainer answer.

~~~starter
class Table:
    KEYS = ["a", "b"]
    PAIRS = [(key, KEYS) for key in KEYS]


print(Table.PAIRS)
~~~

~~~tests
assert Table.KEYS == ["a", "b"]
assert Table.PAIRS == [("a", ["a", "b"]), ("b", ["a", "b"])]
~~~

~~~solution
class Table:
    KEYS = ["a", "b"]
    PAIRS = [(key, keys) for keys in [KEYS] for key in keys]


print(Table.PAIRS)
~~~

## Shadowing a builtin

`summarise` uses three perfectly reasonable names for its locals. Every one of them is also a builtin, and the function stops working at the point where it needs one of them back.

@expect raises:TypeError
@hint The name search stops at the first namespace holding the name, and builtins are searched last.
@hint Read the error and ask what `list` refers to on that line.
@diagnose TypeError The local `list` shadows the builtin for the whole function, so by the time `list(...)` is called the name refers to a list object rather than the type, and a list is not callable. Builtins are the easiest namespace to hide by accident because they are searched last, and the failure appears wherever the builtin is next needed rather than at the shadowing itself. `list`, `dict`, `set`, `type`, `id`, `input`, `str`, `next` and `hash` are all ordinary names and all plausible as variables. The convention when the obvious name is taken is a trailing underscore: `type_`, `input_`, `list_`.

~~~starter
def summarise(records):
    """Return the sorted item names and how many there are."""
    list = []
    for record in records:
        list.append(record["name"])
    return list(sorted(list)), len(list)


print(summarise([{"name": "b"}, {"name": "a"}]))
~~~

~~~tests
names, count = summarise([{"name": "b"}, {"name": "a"}])
assert names == ["a", "b"]
assert count == 2
assert summarise([]) == ([], 0)
~~~

~~~solution
def summarise(records):
    """Return the sorted item names and how many there are."""
    names = []
    for record in records:
        names.append(record["name"])
    return sorted(names), len(names)


print(summarise([{"name": "b"}, {"name": "a"}]))
~~~

## Private state without a global

`make_limiter` should hand back a function with a private allowance that nothing else can reach. It keeps the allowance at module level instead, so two limiters share one budget.

@expect silent
@hint Where does `used` live? Ask what happens when a second limiter is made.
@hint A name bound in the enclosing function is private to that call. `nonlocal` is how the inner function rebinds it.
@diagnose silent It runs and two limiters made from separate calls draw down the same allowance, because `used` is one module-level name rather than one per call. Moving it into `make_limiter` gives every call its own variable, and the returned function closes over that variable rather than a shared one. This is what closures are actually for: a function carrying state that nothing else can reach, where the alternatives are a global that anything can touch or a class that is more ceremony than one operation deserves. The inner function needs `nonlocal` to rebind it, but would need nothing at all to mutate it.

~~~starter
used = 0


def make_limiter(maximum):
    """Return a function granting up to `maximum` in total, then refusing."""
    def allow(n):
        global used
        if used + n > maximum:
            return False
        used += n
        return True

    return allow
~~~

~~~tests
first = make_limiter(10)
assert first(6) is True
assert first(6) is False
second = make_limiter(10)
assert second(6) is True, "a second limiter should start with its own full allowance"
~~~

~~~solution
def make_limiter(maximum):
    """Return a function granting up to `maximum` in total, then refusing."""
    used = 0

    def allow(n):
        nonlocal used
        if used + n > maximum:
            return False
        used += n
        return True

    return allow
~~~
