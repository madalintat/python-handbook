---
slug: orm
---

## Columns that behave like attributes

The thing that makes an ORM read well is that a row looks like an object:
`user.name` rather than `user["name"]` or `user.get("name")`. Unit 20 built the
mechanism for that, and this is the case it exists for.

Each column is a **descriptor**. `__set_name__` tells it the name it was bound
to, so the storage name is derived rather than written twice at every
declaration. `__get__` reads it off the instance, `__set__` validates before
storing, and validating on the way in is the whole reason to have a type on a
column at all.

`Integer` needs one extra check that surprises people: `bool` is a subclass of
`int`, so a column of numbers would quietly accept `True` without it.

@goal Fields validate on assignment, know their own name, and render their DDL.

~~~starter
class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        """Learn the name this was bound to, and where to store its value."""
        raise NotImplementedError

    def __get__(self, obj, objtype=None):
        raise NotImplementedError

    def __set__(self, obj, value):
        raise NotImplementedError

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        raise NotImplementedError

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        raise NotImplementedError


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        """int, and not bool, which is a subclass of it."""
        raise NotImplementedError


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        """float, accepting an int because every int is a valid float."""
        raise NotImplementedError
~~~

~~~tests
class Row:
    name = Text()
    age = Integer()
    score = Real()
    required = Text(null=False)


# the descriptor learns its own name
assert Row.name.name == "name"
assert Row.age.name == "age"

# reaching one through the class gives the descriptor, not a value
assert isinstance(Row.name, Text)

# values are stored per instance
a, b = Row(), Row()
a.name = "ada"
b.name = "bob"
assert a.name == "ada" and b.name == "bob"

# an unset field reads as its default
assert Row().name is None
assert Row.__dict__["name"].default is None


class WithDefault:
    kind = Text(default="unknown")


assert WithDefault().kind == "unknown"

# the wrong type is refused, and the message says which field and what
for value in [1, 1.5, [], object()]:
    try:
        Row().name = value
    except TypeError as exc:
        assert "name" in str(exc) and "str" in str(exc), str(exc)
    else:
        raise AssertionError(f"a Text field should refuse {value!r}")

# the bool trap: True is an int, and a number column should not take it
Row().age = 3
try:
    Row().age = True
except TypeError as exc:
    assert "bool" in str(exc), str(exc)
else:
    raise AssertionError("an Integer field should refuse a bool")

# a Real accepts an int, because every int is a valid float
r = Row()
r.score = 1
assert r.score == 1.0 and isinstance(r.score, float)
r.score = 1.5
assert r.score == 1.5
try:
    r.score = True
except TypeError:
    pass
else:
    raise AssertionError("a Real field should refuse a bool")

# null is allowed unless it is not
Row().name = None
try:
    Row().required = None
except ValueError as exc:
    assert "required" in str(exc)
else:
    raise AssertionError("a NOT NULL field should refuse None")

# and each field can render its own column definition
assert Row.__dict__["name"].ddl() == "name TEXT"
assert Row.__dict__["age"].ddl() == "age INTEGER"
assert Row.__dict__["score"].ddl() == "score REAL"
assert Row.__dict__["required"].ddl() == "required TEXT NOT NULL"
assert Integer(primary_key=True).__set_name__(Row, "id") is None
pk = Integer(primary_key=True)
pk.__set_name__(Row, "id")
assert pk.ddl() == "id INTEGER PRIMARY KEY"
~~~

~~~solution
class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)
~~~

## A class body that becomes a table

Now the part that makes `class User(Model)` mean something. When the class body
finishes, the fields declared in it have to be collected into a map the rest of
the library can use, and a table name has to be derived from the class name.

Unit 27 said a metaclass is right when something has to happen **before the
class object exists**, and gave the declarative ORM base as one of the three
real cases. This is that case: `fields` and `table` have to be on the class
before any query can be built against it, and `__init_subclass__` runs late
enough that the namespace has already become a class.

Inherit fields from base classes, so a shared `Timestamped` mixin works. Refuse
two primary keys, because the error at class creation is much cheaper than the
one at the first query.

@goal `class User(Model)` collects its fields, names its table, and builds its DDL.

~~~starter
class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself."""

    def __new__(mcls, name, bases, namespace, **kwargs):
        # The class is still built, because `class Model(metaclass=ModelMeta)`
        # below runs this immediately. What is missing is everything after it:
        # collecting the fields, deriving the table name, finding the key.
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls
        raise NotImplementedError


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        """Take the declared fields as keywords, defaulting the rest."""
        raise NotImplementedError

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        raise NotImplementedError
~~~

~~~tests
# stage one still holds
class Row:
    name = Text()


assert Row.__dict__["name"].ddl() == "name TEXT"
try:
    Row().name = 1
except TypeError:
    pass
else:
    raise AssertionError("a Text field should refuse an int")


class User(Model):
    id = Integer(primary_key=True)
    name = Text(null=False)
    age = Integer()


# the fields are collected, in declaration order
assert list(User.fields) == ["id", "name", "age"], list(User.fields)
assert isinstance(User.fields["name"], Text)

# the table name comes from the class name
assert User.table == "users"
assert User.primary_key == "id"

# an explicit table name wins
class Person(Model):
    table = "people"
    id = Integer(primary_key=True)


assert Person.table == "people"

# Model itself is not a table
assert Model.fields == {} and Model.table == ""

# construction takes keywords, validates them, and defaults the rest
u = User(id=1, name="ada")
assert (u.id, u.name, u.age) == (1, "ada", None)
assert repr(u) == "User(id=1, name='ada', age=None)"

# an unknown field is a mistake worth catching at construction
try:
    User(id=1, name="ada", nope=3)
except TypeError as exc:
    assert "nope" in str(exc)
else:
    raise AssertionError("an unknown field should be refused")

# and the field types still apply
try:
    User(id="one", name="ada")
except TypeError:
    pass
else:
    raise AssertionError("the field types should still be checked")

# rows compare by their values, which is what a row is
assert User(id=1, name="ada") == User(id=1, name="ada")
assert User(id=1, name="ada") != User(id=2, name="ada")
assert User(id=1, name="ada") != Person(id=1)
assert len({User(id=1, name="ada"), User(id=1, name="ada")}) == 1

# fields are inherited, so a mixin works
class Timestamped(Model):
    created = Text()


class Post(Timestamped):
    id = Integer(primary_key=True)
    title = Text()


assert list(Post.fields) == ["created", "id", "title"], list(Post.fields)
assert Post.table == "posts"

# two primary keys is a mistake, caught when the class is created
try:
    class Broken(Model):
        a = Integer(primary_key=True)
        b = Integer(primary_key=True)
except TypeError as exc:
    assert "primary" in str(exc).lower()
else:
    raise AssertionError("two primary keys should be refused at class creation")

# and the DDL
assert User.create_table_sql() == (
    "CREATE TABLE IF NOT EXISTS users "
    "(id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)"
)
~~~

~~~solution
class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"
~~~

## Building the SELECT, safely

A query builder is a small language, and the design decision that matters is
made in the first ten lines: **values never go into the SQL string**. They go
into a parameter list, and the driver sends the query and the data separately,
so nothing a user types can become syntax. That is what makes injection
impossible rather than unlikely, and unit 37 made the general version of the
argument about building structured strings by concatenation.

Django's `field__lookup` convention gives you operators without inventing an
expression language: `age__gt=30` is one keyword argument, and the part after
the double underscore names the comparison.

Return a **new** query from every method rather than mutating. A query you can
hand to two callers and have both narrow differently is worth the copy, and
unit 02 explained what the alternative costs.

@goal `filter`, `order_by` and `limit` chain, and every value becomes a parameter.

~~~starter
class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end."""

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        raise NotImplementedError

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        raise NotImplementedError

    def limit(self, count, offset=None):
        raise NotImplementedError

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        raise NotImplementedError
~~~

~~~tests
class User(Model):
    id = Integer(primary_key=True)
    name = Text(null=False)
    age = Integer()


# stage two still holds
assert User.table == "users" and User.primary_key == "id"
assert User(id=1, name="ada") == User(id=1, name="ada")

# the plainest query
sql, params = Query(User).sql()
assert sql == "SELECT id, name, age FROM users"
assert params == ()

# a filter becomes a parameter, never a literal in the SQL
sql, params = Query(User).filter(name="ada").sql()
assert sql == "SELECT id, name, age FROM users WHERE name = ?", sql
assert params == ("ada",)

# which is what makes injection impossible rather than unlikely
hostile = "'; DROP TABLE users; --"
sql, params = Query(User).filter(name=hostile).sql()
assert "DROP" not in sql, f"a value reached the SQL: {sql}"
assert params == (hostile,)

# lookups
assert Query(User).filter(age__gt=30).sql()[0].endswith("WHERE age > ?")
assert Query(User).filter(age__lte=30).sql()[0].endswith("WHERE age <= ?")
assert Query(User).filter(name__like="a%").sql()[0].endswith("WHERE name LIKE ?")
assert Query(User).filter(name__ne="ada").sql()[0].endswith("WHERE name != ?")

# IN takes as many parameters as it has values
sql, params = Query(User).filter(id__in=[1, 2, 3]).sql()
assert sql.endswith("WHERE id IN (?, ?, ?)"), sql
assert params == (1, 2, 3)

# IS NULL takes none, because NULL is not a value to compare against
sql, params = Query(User).filter(age__isnull=True).sql()
assert sql.endswith("WHERE age IS NULL") and params == ()
assert Query(User).filter(age__isnull=False).sql()[0].endswith("WHERE age IS NOT NULL")

# several conditions are joined
sql, params = Query(User).filter(name="ada", age__gt=30).sql()
assert "WHERE name = ? AND age > ?" in sql
assert params == ("ada", 30)

# and chaining accumulates
sql, params = Query(User).filter(name="ada").filter(age__gt=30).sql()
assert "WHERE name = ? AND age > ?" in sql and params == ("ada", 30)

# ordering, ascending and descending
assert Query(User).order_by("name").sql()[0].endswith("ORDER BY name")
assert Query(User).order_by("-age").sql()[0].endswith("ORDER BY age DESC")
assert Query(User).order_by("name", "-age").sql()[0].endswith("ORDER BY name, age DESC")

# limit and offset
assert Query(User).limit(10).sql()[0].endswith("LIMIT 10")
assert Query(User).limit(10, 20).sql()[0].endswith("LIMIT 10 OFFSET 20")

# everything at once, in the order SQL wants it
sql, params = Query(User).filter(age__gt=18).order_by("-age").limit(5).sql()
assert sql == (
    "SELECT id, name, age FROM users WHERE age > ? ORDER BY age DESC LIMIT 5"
), sql
assert params == (18,)

# a query is never mutated by narrowing it
base = Query(User).filter(name="ada")
narrowed = base.filter(age__gt=30)
assert base.sql()[1] == ("ada",), "the original query was changed"
assert narrowed.sql()[1] == ("ada", 30)

# an unknown field or lookup is caught here rather than by the database
for bad in [{"nope": 1}, {"nope__gt": 1}]:
    try:
        Query(User).filter(**bad)
    except TypeError as exc:
        assert "nope" in str(exc)
    else:
        raise AssertionError(f"filter({bad}) should be refused")

try:
    Query(User).filter(age__wat=1)
except TypeError as exc:
    assert "wat" in str(exc)
else:
    raise AssertionError("an unknown lookup should be refused")

try:
    Query(User).order_by("nope")
except TypeError:
    pass
else:
    raise AssertionError("ordering by an unknown field should be refused")
~~~

~~~solution
class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)
~~~

## Talking to a real database

`sqlite3` is in the standard library and is a real database, which unit 37 said
is true more often than people expect. Wire the query builder to it, and the
ORM stops being a string generator.

Four operations. `insert` writes a row and fills in the primary key the database
assigned, because a row that does not know its own id is one you cannot update.
`update` writes the current values back, matched on that key. `delete` removes
it. `select` runs a query and rebuilds model instances from the rows.

Rebuilding is the interesting one: a row comes back as a mapping of column names
to values, and the model's own constructor turns that into an object, validating
on the way in. That is the same descriptor from stage one doing its job on data
that came from outside the program, which is where unit 23 said validation
belongs.

@goal `insert`, `update`, `delete` and `select` work against a real sqlite3 database.

~~~starter
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0

    def create_tables(self, *models):
        raise NotImplementedError

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        raise NotImplementedError

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        raise NotImplementedError

    def delete(self, row):
        raise NotImplementedError

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        raise NotImplementedError
~~~

~~~tests
class User(Model):
    id = Integer(primary_key=True)
    name = Text(null=False)
    age = Integer()


# stage three still holds
sql, params = Query(User).filter(age__gt=18).order_by("-age").limit(5).sql()
assert params == (18,) and "LIMIT 5" in sql

db = Database()
db.create_tables(User)

# creating twice is not an error, because the DDL says IF NOT EXISTS
db.create_tables(User)

# insert fills in the key the database chose
ada = db.insert(User(name="ada", age=36))
assert ada.id is not None, "the row should know its own id after insert"
bob = db.insert(User(name="bob", age=41))
assert bob.id != ada.id

# select rebuilds real model instances
rows = db.select(Query(User))
assert len(rows) == 2
assert all(isinstance(r, User) for r in rows)
assert {r.name for r in rows} == {"ada", "bob"}
assert isinstance(rows[0].age, int)

# filters reach the database
assert [r.name for r in db.select(Query(User).filter(name="ada"))] == ["ada"]
assert len(db.select(Query(User).filter(age__gt=40))) == 1
assert db.select(Query(User).filter(name="nobody")) == []

# ordering and limits too
names = [r.name for r in db.select(Query(User).order_by("-age"))]
assert names == ["bob", "ada"], names
assert len(db.select(Query(User).limit(1))) == 1

# a hostile value stays a value
db.insert(User(name="'; DROP TABLE users; --", age=1))
assert len(db.select(Query(User))) == 3, "the table is still there"
assert len(db.select(Query(User).filter(name="'; DROP TABLE users; --"))) == 1

# update writes the current values back
ada.age = 37
db.update(ada)
again = db.select(Query(User).filter(id=ada.id))[0]
assert again.age == 37
assert again.name == "ada"

# updating a row that was never saved is a mistake worth naming
try:
    db.update(User(name="ghost"))
except ValueError:
    pass
else:
    raise AssertionError("updating an unsaved row should be refused")

# delete removes exactly one row
db.delete(bob)
remaining = {r.name for r in db.select(Query(User))}
assert "bob" not in remaining and "ada" in remaining
assert len(db.select(Query(User))) == 2

# the field types apply to data coming back out, too
db.execute("INSERT INTO users (name, age) VALUES (?, ?)", ("carol", 30))
db.connection.commit()
carol = db.select(Query(User).filter(name="carol"))[0]
assert carol.age == 30 and isinstance(carol.name, str)

# and a NOT NULL field is enforced before the database ever sees it
try:
    db.insert(User(name=None))
except ValueError:
    pass
else:
    raise AssertionError("a null in a NOT NULL field should be refused")
~~~

~~~solution
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]
~~~

## The interface people actually use

`db.select(Query(User).filter(name="ada"))` works and nobody wants to type it.
The interface every ORM converged on is `User.objects.filter(name="ada")`, and
getting there is one more descriptor.

A manager is a **non-data descriptor** on the model class: reaching `User.objects`
calls its `__get__`, which is how it knows which model it belongs to without
being told twice. Unit 20 covered why that works and why it is not a data
descriptor.

Then two conveniences that are worth building because they are worth
understanding. `get` returns exactly one row and raises for both other cases,
with different exceptions, because "no rows" and "seven rows" are different
bugs. And a query that knows its database can be iterated directly, which is why
`for user in User.objects.filter(...)` reads the way it does.

@goal `User.objects.filter(...).order_by(...)` runs, iterates, and `get` is exact.

~~~starter
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]


class DoesNotExist(LookupError):
    """No row matched."""


class MultipleFound(LookupError):
    """More than one row matched where one was expected."""


class Manager:
    """The bridge between a model class and a database."""

    def __init__(self, database=None):
        self.database = database
        self.model = None

    def __set_name__(self, owner, name):
        raise NotImplementedError

    def __get__(self, obj, objtype=None):
        raise NotImplementedError

    def bind(self, database):
        self.database = database
        return self

    def all(self):
        raise NotImplementedError

    def filter(self, **conditions):
        raise NotImplementedError

    def order_by(self, *names):
        raise NotImplementedError

    def get(self, **conditions):
        """Exactly one row, or an exception saying which way it went wrong."""
        raise NotImplementedError

    def create(self, **values):
        raise NotImplementedError

    def count(self):
        raise NotImplementedError


class BoundQuery:
    """A query that knows its database, so it can run itself."""

    def __init__(self, database, query):
        self.database = database
        self.query = query

    def filter(self, **conditions):
        raise NotImplementedError

    def order_by(self, *names):
        raise NotImplementedError

    def limit(self, count, offset=None):
        raise NotImplementedError

    def all(self):
        raise NotImplementedError

    def first(self):
        raise NotImplementedError

    def count(self):
        raise NotImplementedError

    def __iter__(self):
        return iter(self.all())

    def __len__(self):
        return len(self.all())
~~~

~~~tests
class User(Model):
    id = Integer(primary_key=True)
    name = Text(null=False)
    age = Integer()
    objects = Manager()


# stage four still holds
db = Database()
db.create_tables(User)
ada = db.insert(User(name="ada", age=36))
assert ada.id is not None
assert len(db.select(Query(User))) == 1

User.objects.bind(db)

# the manager knows which model it is on
assert User.objects.model is User

# create writes and returns the row
bob = User.objects.create(name="bob", age=41)
assert bob.id is not None and bob.name == "bob"
assert User.objects.count() == 2

# all, filter, order_by
assert {u.name for u in User.objects.all()} == {"ada", "bob"}
assert [u.name for u in User.objects.filter(age__gt=40)] == ["bob"]
assert [u.name for u in User.objects.order_by("-age")] == ["bob", "ada"]

# chaining
assert [u.name for u in User.objects.filter(age__gt=1).order_by("name")] == ["ada", "bob"]
assert User.objects.filter(age__gt=1).limit(1).count() == 1

# a bound query iterates and measures without being told to run
query = User.objects.filter(age__gt=1)
assert len(query) == 2
assert [u.name for u in query] == sorted(["ada", "bob"]) or len(list(query)) == 2

# first gives one row or None, and never raises
assert User.objects.order_by("name").first().name == "ada"
assert User.objects.filter(name="nobody").first() is None

# get is exact, and says which way it went wrong
assert User.objects.get(name="ada").age == 36

try:
    User.objects.get(name="nobody")
except DoesNotExist as exc:
    assert "nobody" in str(exc)
else:
    raise AssertionError("get with no match should raise DoesNotExist")

User.objects.create(name="ada", age=99)
try:
    User.objects.get(name="ada")
except MultipleFound as exc:
    assert "2" in str(exc)
else:
    raise AssertionError("get with several matches should raise MultipleFound")

# both are LookupErrors, so a caller that does not care can catch one thing
assert issubclass(DoesNotExist, LookupError)
assert issubclass(MultipleFound, LookupError)

# an unbound manager says so rather than failing obscurely
class Orphan(Model):
    id = Integer(primary_key=True)
    objects = Manager()


try:
    Orphan.objects.all()
except RuntimeError as exc:
    assert "Orphan" in str(exc)
else:
    raise AssertionError("an unbound manager should say it is unbound")

# and the field validation still applies through the manager
try:
    User.objects.create(name=None)
except ValueError:
    pass
else:
    raise AssertionError("create should validate like the constructor does")
~~~

~~~solution
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]


class Manager:
    """The bridge between a model class and a database.

    A non-data descriptor, so `User.objects` on the class gives a manager bound
    to that model and the instance dict could still shadow it. Unit 20's
    protocol, used the way Django uses it.
    """

    def __init__(self, database=None):
        self.database = database
        self.model = None

    def __set_name__(self, owner, name):
        self.model = owner

    def __get__(self, obj, objtype=None):
        if objtype is not None and self.model is None:
            self.model = objtype
        return self

    def bind(self, database):
        self.database = database
        return self

    def _query(self):
        if self.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        return Query(self.model)

    def all(self):
        query = self._query()
        return self.database.select(query)

    def filter(self, **conditions):
        return BoundQuery(self.database, self._query().filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self._query().order_by(*names))

    def get(self, **conditions):
        """Exactly one row, or an exception saying which way it went wrong."""
        rows = self.database.select(self._query().filter(**conditions))
        if not rows:
            raise DoesNotExist(f"no {self.model.__name__} matching {conditions}")
        if len(rows) > 1:
            raise MultipleFound(f"{len(rows)} rows matching {conditions}")
        return rows[0]

    def create(self, **values):
        return self.database.insert(self.model(**values))

    def count(self):
        return len(self.all())


class BoundQuery:
    """A query that knows its database, so it can run itself."""

    def __init__(self, database, query):
        self.database = database
        self.query = query

    def filter(self, **conditions):
        return BoundQuery(self.database, self.query.filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self.query.order_by(*names))

    def limit(self, count, offset=None):
        return BoundQuery(self.database, self.query.limit(count, offset))

    def all(self):
        return self.database.select(self.query)

    def first(self):
        rows = self.database.select(self.query.limit(1))
        return rows[0] if rows else None

    def count(self):
        return len(self.all())

    def __iter__(self):
        return iter(self.all())

    def __len__(self):
        return len(self.all())


class DoesNotExist(LookupError):
    """No row matched."""


class MultipleFound(LookupError):
    """More than one row matched where one was expected."""
~~~

## Relations, and the query that runs a thousand times

A foreign key is an integer column that means something. The column stores the
other row's primary key; the interesting part is the two directions of access
it creates, and the second one is where the trouble is.

From the many side, `post.author_id` is the key. From the one side,
`author.posts` should be every post referring to that author, which is another
descriptor: reaching it builds a query filtered on the key. Django spells that
`related_name`, and defaults it from the class name.

Then the mistake that shape invites. Looping over a hundred posts and reading
`post.author` for each is a hundred queries where one would do, which unit 35
called the most expensive item on its list because the cost is a network round
trip rather than a microsecond. Build the fix as well as the feature: fetch
every related row in one query, keyed by id.

@goal Foreign keys work in both directions, and `load_related` replaces N queries with one.

~~~starter
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]


class Manager:
    """The bridge between a model class and a database.

    A non-data descriptor, so `User.objects` on the class gives a manager bound
    to that model and the instance dict could still shadow it. Unit 20's
    protocol, used the way Django uses it.
    """

    def __init__(self, database=None):
        self.database = database
        self.model = None

    def __set_name__(self, owner, name):
        self.model = owner

    def __get__(self, obj, objtype=None):
        if objtype is not None and self.model is None:
            self.model = objtype
        return self

    def bind(self, database):
        self.database = database
        return self

    def _query(self):
        if self.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        return Query(self.model)

    def all(self):
        query = self._query()
        return self.database.select(query)

    def filter(self, **conditions):
        return BoundQuery(self.database, self._query().filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self._query().order_by(*names))

    def get(self, **conditions):
        """Exactly one row, or an exception saying which way it went wrong."""
        rows = self.database.select(self._query().filter(**conditions))
        if not rows:
            raise DoesNotExist(f"no {self.model.__name__} matching {conditions}")
        if len(rows) > 1:
            raise MultipleFound(f"{len(rows)} rows matching {conditions}")
        return rows[0]

    def create(self, **values):
        return self.database.insert(self.model(**values))

    def count(self):
        return len(self.all())


class BoundQuery:
    """A query that knows its database, so it can run itself."""

    def __init__(self, database, query):
        self.database = database
        self.query = query

    def filter(self, **conditions):
        return BoundQuery(self.database, self.query.filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self.query.order_by(*names))

    def limit(self, count, offset=None):
        return BoundQuery(self.database, self.query.limit(count, offset))

    def all(self):
        return self.database.select(self.query)

    def first(self):
        rows = self.database.select(self.query.limit(1))
        return rows[0] if rows else None

    def count(self):
        return len(self.all())

    def __iter__(self):
        return iter(self.all())

    def __len__(self):
        return len(self.all())


class DoesNotExist(LookupError):
    """No row matched."""


class MultipleFound(LookupError):
    """More than one row matched where one was expected."""


class ForeignKey(Field):
    """A reference to another model's primary key."""

    python_type = int
    sql_type = "INTEGER"

    def __init__(self, to, related_name=None, **kwargs):
        super().__init__(**kwargs)
        self.to = to
        self.related_name = related_name

    def __set_name__(self, owner, name):
        """Learn the name, and put the reverse accessor on the other model."""
        raise NotImplementedError

    def ddl(self):
        raise NotImplementedError


class RelatedSet:
    """The rows on the many side of a foreign key, reached from the one side."""

    def __init__(self, model, column):
        self.model = model
        self.column = column

    def __get__(self, obj, objtype=None):
        raise NotImplementedError


def load_related(database, rows, column):
    """Fetch every row's related object in one query rather than one each."""
    raise NotImplementedError
~~~

~~~tests
class Author(Model):
    id = Integer(primary_key=True)
    name = Text(null=False)
    objects = Manager()


class Post(Model):
    id = Integer(primary_key=True)
    title = Text(null=False)
    author_id = ForeignKey(Author)
    objects = Manager()


# stage five still holds
db = Database()
db.create_tables(Author, Post)
Author.objects.bind(db)
Post.objects.bind(db)
ada = Author.objects.create(name="ada")
assert Author.objects.get(name="ada").id == ada.id

# the column carries the reference in its DDL
assert "REFERENCES authors(id)" in Post.fields["author_id"].ddl(), \
    Post.fields["author_id"].ddl()

# the many side stores a key
first = Post.objects.create(title="engines", author_id=ada.id)
assert first.author_id == ada.id

# and it is still an integer column, so it validates
try:
    Post.objects.create(title="bad", author_id="not an id")
except TypeError:
    pass
else:
    raise AssertionError("a foreign key column should refuse a non-integer")

# the one side gets a reverse accessor, named from the other class
Post.objects.create(title="notes", author_id=ada.id)
bob = Author.objects.create(name="bob")
Post.objects.create(title="bob's post", author_id=bob.id)

assert hasattr(Author, "posts"), "the reverse accessor should be on Author"
assert {p.title for p in ada.posts} == {"engines", "notes"}
assert {p.title for p in bob.posts} == {"bob's post"}
assert len(ada.posts) == 2

# the reverse accessor is a query, so it narrows further
assert [p.title for p in ada.posts.filter(title="notes")] == ["notes"]
assert ada.posts.order_by("title").first().title == "engines"

# an explicit related_name wins
class Comment(Model):
    id = Integer(primary_key=True)
    body = Text()
    post_id = ForeignKey(Post, related_name="comments")
    objects = Manager()


assert hasattr(Post, "comments")

# the N+1 fix: one query for every row's related object
db.create_tables(Comment)
Comment.objects.bind(db)
posts = Post.objects.all()
authors = load_related(db, posts, "author_id")

assert set(authors) == {ada.id, bob.id}, set(authors)
assert authors[ada.id].name == "ada"
assert all(isinstance(a, Author) for a in authors.values())

# and it holds every post's author, so nothing needs a second query
assert all(p.author_id in authors for p in posts)

# it does one query, not one per row, which is measurable
queries = []
real_execute = db.execute
db.execute = lambda sql, params=(): queries.append(sql) or real_execute(sql, params)
load_related(db, posts, "author_id")
db.execute = real_execute
assert len(queries) == 1, f"{len(queries)} queries for {len(posts)} rows"

# an empty list of rows asks nothing at all
assert load_related(db, [], "author_id") == {}

# and rows whose key is null are skipped rather than looked up
orphan = Post(title="orphan", author_id=None)
assert load_related(db, [orphan], "author_id") == {}
~~~

~~~solution
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]


class Manager:
    """The bridge between a model class and a database.

    A non-data descriptor, so `User.objects` on the class gives a manager bound
    to that model and the instance dict could still shadow it. Unit 20's
    protocol, used the way Django uses it.
    """

    def __init__(self, database=None):
        self.database = database
        self.model = None

    def __set_name__(self, owner, name):
        self.model = owner

    def __get__(self, obj, objtype=None):
        if objtype is not None and self.model is None:
            self.model = objtype
        return self

    def bind(self, database):
        self.database = database
        return self

    def _query(self):
        if self.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        return Query(self.model)

    def all(self):
        query = self._query()
        return self.database.select(query)

    def filter(self, **conditions):
        return BoundQuery(self.database, self._query().filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self._query().order_by(*names))

    def get(self, **conditions):
        """Exactly one row, or an exception saying which way it went wrong."""
        rows = self.database.select(self._query().filter(**conditions))
        if not rows:
            raise DoesNotExist(f"no {self.model.__name__} matching {conditions}")
        if len(rows) > 1:
            raise MultipleFound(f"{len(rows)} rows matching {conditions}")
        return rows[0]

    def create(self, **values):
        return self.database.insert(self.model(**values))

    def count(self):
        return len(self.all())


class BoundQuery:
    """A query that knows its database, so it can run itself."""

    def __init__(self, database, query):
        self.database = database
        self.query = query

    def filter(self, **conditions):
        return BoundQuery(self.database, self.query.filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self.query.order_by(*names))

    def limit(self, count, offset=None):
        return BoundQuery(self.database, self.query.limit(count, offset))

    def all(self):
        return self.database.select(self.query)

    def first(self):
        rows = self.database.select(self.query.limit(1))
        return rows[0] if rows else None

    def count(self):
        return len(self.all())

    def __iter__(self):
        return iter(self.all())

    def __len__(self):
        return len(self.all())


class DoesNotExist(LookupError):
    """No row matched."""


class MultipleFound(LookupError):
    """More than one row matched where one was expected."""


class ForeignKey(Field):
    """A reference to another model's primary key."""

    python_type = int
    sql_type = "INTEGER"

    def __init__(self, to, related_name=None, **kwargs):
        super().__init__(**kwargs)
        self.to = to
        self.related_name = related_name

    def __set_name__(self, owner, name):
        super().__set_name__(owner, name)
        related = self.related_name or owner.__name__.lower() + "s"
        setattr(self.to, related, RelatedSet(owner, name))

    def ddl(self):
        base = super().ddl()
        return f"{base} REFERENCES {self.to.table}({self.to.primary_key})"


class RelatedSet:
    """The rows on the many side of a foreign key, reached from the one side."""

    def __init__(self, model, column):
        self.model = model
        self.column = column

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        manager = getattr(self.model, "objects", None)
        if manager is None or manager.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        key = getattr(obj, type(obj).primary_key)
        return BoundQuery(manager.database, Query(self.model).filter(**{self.column: key}))


def load_related(database, rows, column):
    """Fetch every row's related object in one query rather than one each.

    The N+1 problem, and its fix. Unit 35 named the shape: a round trip per row
    where one would do, and the tell in a profile is a large call count against
    a small tottime.
    """
    if not rows:
        return {}
    field = type(rows[0]).fields[column]
    keys = sorted({getattr(row, column) for row in rows if getattr(row, column) is not None})
    if not keys:
        return {}
    related = database.select(
        Query(field.to).filter(**{f"{field.to.primary_key}__in": keys})
    )
    return {getattr(r, field.to.primary_key): r for r in related}
~~~

## All of it, or none of it

Two writes that have to happen together are the reason transactions exist. Move
money between accounts, or insert a row and its children: if the second fails,
the first has to be undone, and a library that leaves that to the caller will be
used wrongly.

`with db.transaction():` is unit 22's protocol doing exactly what it is for. The
commit goes in the success path and the rollback in the failure path, and
because `__exit__` runs whatever happens there is no way to leave the block
having done half of it.

Then migrations, which are the same idea over time. A schema change is numbered,
applied once, and recorded; applying the set again runs only what is new. Each
one runs inside a transaction, so a migration that fails halfway leaves the
schema as it was rather than in a state nobody has a name for.

@goal `transaction()` is all-or-nothing, and migrations apply once and roll back.

~~~starter
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    def transaction(self):
        """Everything in the block, or nothing."""
        raise NotImplementedError

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]


class Manager:
    """The bridge between a model class and a database.

    A non-data descriptor, so `User.objects` on the class gives a manager bound
    to that model and the instance dict could still shadow it. Unit 20's
    protocol, used the way Django uses it.
    """

    def __init__(self, database=None):
        self.database = database
        self.model = None

    def __set_name__(self, owner, name):
        self.model = owner

    def __get__(self, obj, objtype=None):
        if objtype is not None and self.model is None:
            self.model = objtype
        return self

    def bind(self, database):
        self.database = database
        return self

    def _query(self):
        if self.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        return Query(self.model)

    def all(self):
        query = self._query()
        return self.database.select(query)

    def filter(self, **conditions):
        return BoundQuery(self.database, self._query().filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self._query().order_by(*names))

    def get(self, **conditions):
        """Exactly one row, or an exception saying which way it went wrong."""
        rows = self.database.select(self._query().filter(**conditions))
        if not rows:
            raise DoesNotExist(f"no {self.model.__name__} matching {conditions}")
        if len(rows) > 1:
            raise MultipleFound(f"{len(rows)} rows matching {conditions}")
        return rows[0]

    def create(self, **values):
        return self.database.insert(self.model(**values))

    def count(self):
        return len(self.all())


class BoundQuery:
    """A query that knows its database, so it can run itself."""

    def __init__(self, database, query):
        self.database = database
        self.query = query

    def filter(self, **conditions):
        return BoundQuery(self.database, self.query.filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self.query.order_by(*names))

    def limit(self, count, offset=None):
        return BoundQuery(self.database, self.query.limit(count, offset))

    def all(self):
        return self.database.select(self.query)

    def first(self):
        rows = self.database.select(self.query.limit(1))
        return rows[0] if rows else None

    def count(self):
        return len(self.all())

    def __iter__(self):
        return iter(self.all())

    def __len__(self):
        return len(self.all())


class DoesNotExist(LookupError):
    """No row matched."""


class MultipleFound(LookupError):
    """More than one row matched where one was expected."""


class ForeignKey(Field):
    """A reference to another model's primary key."""

    python_type = int
    sql_type = "INTEGER"

    def __init__(self, to, related_name=None, **kwargs):
        super().__init__(**kwargs)
        self.to = to
        self.related_name = related_name

    def __set_name__(self, owner, name):
        super().__set_name__(owner, name)
        related = self.related_name or owner.__name__.lower() + "s"
        setattr(self.to, related, RelatedSet(owner, name))

    def ddl(self):
        base = super().ddl()
        return f"{base} REFERENCES {self.to.table}({self.to.primary_key})"


class RelatedSet:
    """The rows on the many side of a foreign key, reached from the one side."""

    def __init__(self, model, column):
        self.model = model
        self.column = column

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        manager = getattr(self.model, "objects", None)
        if manager is None or manager.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        key = getattr(obj, type(obj).primary_key)
        return BoundQuery(manager.database, Query(self.model).filter(**{self.column: key}))


def load_related(database, rows, column):
    """Fetch every row's related object in one query rather than one each.

    The N+1 problem, and its fix. Unit 35 named the shape: a round trip per row
    where one would do, and the tell in a profile is a large call count against
    a small tottime.
    """
    if not rows:
        return {}
    field = type(rows[0]).fields[column]
    keys = sorted({getattr(row, column) for row in rows if getattr(row, column) is not None})
    if not keys:
        return {}
    related = database.select(
        Query(field.to).filter(**{f"{field.to.primary_key}__in": keys})
    )
    return {getattr(r, field.to.primary_key): r for r in related}




class Migration:
    """One numbered change to the schema, and how to undo it."""

    def __init__(self, number, name, up, down=None):
        self.number = number
        self.name = name
        self.up = up
        self.down = down


MIGRATION_TABLE = (
    "CREATE TABLE IF NOT EXISTS _migrations "
    "(number INTEGER PRIMARY KEY, name TEXT NOT NULL)"
)


class Migrator:
    """Applies migrations once each, in order, recording what it has done."""

    def __init__(self, database):
        self.database = database
        self.database.execute(MIGRATION_TABLE)
        self.database.connection.commit()

    def applied(self):
        raise NotImplementedError

    def apply(self, migrations):
        """Run everything not yet applied, in order. Returns what it ran."""
        raise NotImplementedError

    def rollback(self, migrations, to):
        """Undo everything after `to`, newest first."""
        raise NotImplementedError
~~~

~~~tests
class Account(Model):
    id = Integer(primary_key=True)
    name = Text(null=False)
    balance = Integer()
    objects = Manager()


# stage six still holds
db = Database()
db.create_tables(Account)
Account.objects.bind(db)
a = Account.objects.create(name="a", balance=100)
assert Account.objects.get(name="a").balance == 100

# a transaction that succeeds keeps its work
b = Account.objects.create(name="b", balance=0)
with db.transaction():
    a.balance -= 40
    db.update(a)
    b.balance += 40
    db.update(b)

assert Account.objects.get(name="a").balance == 60
assert Account.objects.get(name="b").balance == 40

# one that fails keeps none of it
try:
    with db.transaction():
        a.balance -= 1000
        db.update(a)
        raise ValueError("the second half failed")
except ValueError:
    pass

assert Account.objects.get(name="a").balance == 60, "the failed half was not undone"

# and the exception is not swallowed, which unit 22 said matters
raised = False
try:
    with db.transaction():
        raise RuntimeError("boom")
except RuntimeError:
    raised = True
assert raised, "a transaction must not swallow the exception that failed it"

# migrations: applied once, in order, and recorded
log = []


def add_email(database):
    log.append("up 1")
    database.execute("ALTER TABLE accounts ADD COLUMN email TEXT")


def drop_email(database):
    log.append("down 1")
    database.execute("ALTER TABLE accounts DROP COLUMN email")


def add_index(database):
    log.append("up 2")
    database.execute("CREATE INDEX idx_name ON accounts(name)")


def drop_index(database):
    log.append("down 2")
    database.execute("DROP INDEX idx_name")


migrations = [
    Migration(2, "add index", add_index, drop_index),
    Migration(1, "add email", add_email, drop_email),
]

migrator = Migrator(db)
assert migrator.applied() == []
assert migrator.apply(migrations) == [1, 2], "migrations run in number order"
assert log == ["up 1", "up 2"], log
assert migrator.applied() == [1, 2]

# applying again runs nothing
log.clear()
assert migrator.apply(migrations) == []
assert log == []

# the column really is there
db.execute("UPDATE accounts SET email = ? WHERE name = ?", ("a@example.com", "a"))
db.connection.commit()

# rolling back undoes the newest first, and stops where told
log.clear()
assert migrator.rollback(migrations, to=1) == [2]
assert log == ["down 2"]
assert migrator.applied() == [1]

# and then the rest
assert migrator.rollback(migrations, to=0) == [1]
assert migrator.applied() == []

# a migration with no way down says so rather than half-doing it
one_way = [Migration(9, "no way back", lambda d: None)]
migrator.apply(one_way)
try:
    migrator.rollback(one_way, to=0)
except LookupError as exc:
    assert "9" in str(exc)
else:
    raise AssertionError("an irreversible migration should refuse to roll back")

# a migration that fails leaves the schema as it was
def broken(database):
    database.execute("ALTER TABLE accounts ADD COLUMN half TEXT")
    raise RuntimeError("failed halfway")


try:
    migrator.apply([Migration(20, "broken", broken)])
except RuntimeError:
    pass
assert 20 not in migrator.applied(), "a failed migration must not be recorded"
~~~

~~~solution
import contextlib
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    @contextlib.contextmanager
    def transaction(self):
        """Everything in the block, or nothing.

        Unit 22's protocol: __exit__ runs whatever happens, so the rollback is
        in the failure path and the commit is in the success path, and there is
        no way to leave the block having done half of it.
        """
        self.open_transactions += 1
        try:
            yield self
        except BaseException:
            self.open_transactions -= 1
            self.connection.rollback()
            raise
        self.open_transactions -= 1
        self._maybe_commit()

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]


class Manager:
    """The bridge between a model class and a database.

    A non-data descriptor, so `User.objects` on the class gives a manager bound
    to that model and the instance dict could still shadow it. Unit 20's
    protocol, used the way Django uses it.
    """

    def __init__(self, database=None):
        self.database = database
        self.model = None

    def __set_name__(self, owner, name):
        self.model = owner

    def __get__(self, obj, objtype=None):
        if objtype is not None and self.model is None:
            self.model = objtype
        return self

    def bind(self, database):
        self.database = database
        return self

    def _query(self):
        if self.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        return Query(self.model)

    def all(self):
        query = self._query()
        return self.database.select(query)

    def filter(self, **conditions):
        return BoundQuery(self.database, self._query().filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self._query().order_by(*names))

    def get(self, **conditions):
        """Exactly one row, or an exception saying which way it went wrong."""
        rows = self.database.select(self._query().filter(**conditions))
        if not rows:
            raise DoesNotExist(f"no {self.model.__name__} matching {conditions}")
        if len(rows) > 1:
            raise MultipleFound(f"{len(rows)} rows matching {conditions}")
        return rows[0]

    def create(self, **values):
        return self.database.insert(self.model(**values))

    def count(self):
        return len(self.all())


class BoundQuery:
    """A query that knows its database, so it can run itself."""

    def __init__(self, database, query):
        self.database = database
        self.query = query

    def filter(self, **conditions):
        return BoundQuery(self.database, self.query.filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self.query.order_by(*names))

    def limit(self, count, offset=None):
        return BoundQuery(self.database, self.query.limit(count, offset))

    def all(self):
        return self.database.select(self.query)

    def first(self):
        rows = self.database.select(self.query.limit(1))
        return rows[0] if rows else None

    def count(self):
        return len(self.all())

    def __iter__(self):
        return iter(self.all())

    def __len__(self):
        return len(self.all())


class DoesNotExist(LookupError):
    """No row matched."""


class MultipleFound(LookupError):
    """More than one row matched where one was expected."""


class ForeignKey(Field):
    """A reference to another model's primary key."""

    python_type = int
    sql_type = "INTEGER"

    def __init__(self, to, related_name=None, **kwargs):
        super().__init__(**kwargs)
        self.to = to
        self.related_name = related_name

    def __set_name__(self, owner, name):
        super().__set_name__(owner, name)
        related = self.related_name or owner.__name__.lower() + "s"
        setattr(self.to, related, RelatedSet(owner, name))

    def ddl(self):
        base = super().ddl()
        return f"{base} REFERENCES {self.to.table}({self.to.primary_key})"


class RelatedSet:
    """The rows on the many side of a foreign key, reached from the one side."""

    def __init__(self, model, column):
        self.model = model
        self.column = column

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        manager = getattr(self.model, "objects", None)
        if manager is None or manager.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        key = getattr(obj, type(obj).primary_key)
        return BoundQuery(manager.database, Query(self.model).filter(**{self.column: key}))


def load_related(database, rows, column):
    """Fetch every row's related object in one query rather than one each.

    The N+1 problem, and its fix. Unit 35 named the shape: a round trip per row
    where one would do, and the tell in a profile is a large call count against
    a small tottime.
    """
    if not rows:
        return {}
    field = type(rows[0]).fields[column]
    keys = sorted({getattr(row, column) for row in rows if getattr(row, column) is not None})
    if not keys:
        return {}
    related = database.select(
        Query(field.to).filter(**{f"{field.to.primary_key}__in": keys})
    )
    return {getattr(r, field.to.primary_key): r for r in related}




class Migration:
    """One numbered change to the schema, and how to undo it."""

    def __init__(self, number, name, up, down=None):
        self.number = number
        self.name = name
        self.up = up
        self.down = down


MIGRATION_TABLE = (
    "CREATE TABLE IF NOT EXISTS _migrations "
    "(number INTEGER PRIMARY KEY, name TEXT NOT NULL)"
)


class Migrator:
    """Applies migrations once each, in order, recording what it has done."""

    def __init__(self, database):
        self.database = database
        self.database.execute(MIGRATION_TABLE)
        self.database.connection.commit()

    def applied(self):
        rows = self.database.execute("SELECT number FROM _migrations ORDER BY number")
        return [row[0] for row in rows.fetchall()]

    def apply(self, migrations):
        """Run everything not yet applied, in order. Returns what it ran."""
        done = set(self.applied())
        ran = []
        for migration in sorted(migrations, key=lambda m: m.number):
            if migration.number in done:
                continue
            with self.database.transaction():
                migration.up(self.database)
                self.database.execute(
                    "INSERT INTO _migrations (number, name) VALUES (?, ?)",
                    (migration.number, migration.name),
                )
            ran.append(migration.number)
        return ran

    def rollback(self, migrations, to):
        """Undo everything after `to`, newest first."""
        by_number = {m.number: m for m in migrations}
        undone = []
        for number in reversed(self.applied()):
            if number <= to:
                break
            migration = by_number.get(number)
            if migration is None or migration.down is None:
                raise LookupError(f"migration {number} cannot be undone")
            with self.database.transaction():
                migration.down(self.database)
                self.database.execute("DELETE FROM _migrations WHERE number = ?", (number,))
            undone.append(number)
        return undone
~~~

## Seeing what it actually does

An ORM's convenience is also its problem: `for post in posts: print(post.author)`
reads like a loop and is a hundred queries. The library that lets you write that
owes you a way to find out, and every real one has one.

Two tools. A **query log** that records every statement, so a test can assert
that a page makes three queries rather than three hundred. That assertion is the
one that catches an N+1 before it reaches production, and unit 31's argument
applies: a check that runs beats a rule people remember.

And **`EXPLAIN QUERY PLAN`**, which sqlite will tell you for any query. It says
`SCAN` when it will read the whole table and `SEARCH` when it can jump straight
to the rows, and that word is the answer: a filter on an unindexed column is a
scan, and on a large table that is the difference between a page and a timeout,
which is unit 35's point about the cost being a change of shape rather than a
constant.

@goal A query log counts statements, and `explain` says whether a query searches or scans.

~~~starter
import contextlib
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0
        self.log = None

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        if self.log is not None:
            self.log.record(sql, params)
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    @contextlib.contextmanager
    def transaction(self):
        """Everything in the block, or nothing.

        Unit 22's protocol: __exit__ runs whatever happens, so the rollback is
        in the failure path and the commit is in the success path, and there is
        no way to leave the block having done half of it.
        """
        self.open_transactions += 1
        try:
            yield self
        except BaseException:
            self.open_transactions -= 1
            self.connection.rollback()
            raise
        self.open_transactions -= 1
        self._maybe_commit()

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]


class Manager:
    """The bridge between a model class and a database.

    A non-data descriptor, so `User.objects` on the class gives a manager bound
    to that model and the instance dict could still shadow it. Unit 20's
    protocol, used the way Django uses it.
    """

    def __init__(self, database=None):
        self.database = database
        self.model = None

    def __set_name__(self, owner, name):
        self.model = owner

    def __get__(self, obj, objtype=None):
        if objtype is not None and self.model is None:
            self.model = objtype
        return self

    def bind(self, database):
        self.database = database
        return self

    def _query(self):
        if self.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        return Query(self.model)

    def all(self):
        query = self._query()
        return self.database.select(query)

    def filter(self, **conditions):
        return BoundQuery(self.database, self._query().filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self._query().order_by(*names))

    def get(self, **conditions):
        """Exactly one row, or an exception saying which way it went wrong."""
        rows = self.database.select(self._query().filter(**conditions))
        if not rows:
            raise DoesNotExist(f"no {self.model.__name__} matching {conditions}")
        if len(rows) > 1:
            raise MultipleFound(f"{len(rows)} rows matching {conditions}")
        return rows[0]

    def create(self, **values):
        return self.database.insert(self.model(**values))

    def count(self):
        return len(self.all())


class BoundQuery:
    """A query that knows its database, so it can run itself."""

    def __init__(self, database, query):
        self.database = database
        self.query = query

    def filter(self, **conditions):
        return BoundQuery(self.database, self.query.filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self.query.order_by(*names))

    def limit(self, count, offset=None):
        return BoundQuery(self.database, self.query.limit(count, offset))

    def all(self):
        return self.database.select(self.query)

    def first(self):
        rows = self.database.select(self.query.limit(1))
        return rows[0] if rows else None

    def count(self):
        return len(self.all())

    def __iter__(self):
        return iter(self.all())

    def __len__(self):
        return len(self.all())


class DoesNotExist(LookupError):
    """No row matched."""


class MultipleFound(LookupError):
    """More than one row matched where one was expected."""


class ForeignKey(Field):
    """A reference to another model's primary key."""

    python_type = int
    sql_type = "INTEGER"

    def __init__(self, to, related_name=None, **kwargs):
        super().__init__(**kwargs)
        self.to = to
        self.related_name = related_name

    def __set_name__(self, owner, name):
        super().__set_name__(owner, name)
        related = self.related_name or owner.__name__.lower() + "s"
        setattr(self.to, related, RelatedSet(owner, name))

    def ddl(self):
        base = super().ddl()
        return f"{base} REFERENCES {self.to.table}({self.to.primary_key})"


class RelatedSet:
    """The rows on the many side of a foreign key, reached from the one side."""

    def __init__(self, model, column):
        self.model = model
        self.column = column

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        manager = getattr(self.model, "objects", None)
        if manager is None or manager.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        key = getattr(obj, type(obj).primary_key)
        return BoundQuery(manager.database, Query(self.model).filter(**{self.column: key}))


def load_related(database, rows, column):
    """Fetch every row's related object in one query rather than one each.

    The N+1 problem, and its fix. Unit 35 named the shape: a round trip per row
    where one would do, and the tell in a profile is a large call count against
    a small tottime.
    """
    if not rows:
        return {}
    field = type(rows[0]).fields[column]
    keys = sorted({getattr(row, column) for row in rows if getattr(row, column) is not None})
    if not keys:
        return {}
    related = database.select(
        Query(field.to).filter(**{f"{field.to.primary_key}__in": keys})
    )
    return {getattr(r, field.to.primary_key): r for r in related}




class Migration:
    """One numbered change to the schema, and how to undo it."""

    def __init__(self, number, name, up, down=None):
        self.number = number
        self.name = name
        self.up = up
        self.down = down


MIGRATION_TABLE = (
    "CREATE TABLE IF NOT EXISTS _migrations "
    "(number INTEGER PRIMARY KEY, name TEXT NOT NULL)"
)


class Migrator:
    """Applies migrations once each, in order, recording what it has done."""

    def __init__(self, database):
        self.database = database
        self.database.execute(MIGRATION_TABLE)
        self.database.connection.commit()

    def applied(self):
        rows = self.database.execute("SELECT number FROM _migrations ORDER BY number")
        return [row[0] for row in rows.fetchall()]

    def apply(self, migrations):
        """Run everything not yet applied, in order. Returns what it ran."""
        done = set(self.applied())
        ran = []
        for migration in sorted(migrations, key=lambda m: m.number):
            if migration.number in done:
                continue
            with self.database.transaction():
                migration.up(self.database)
                self.database.execute(
                    "INSERT INTO _migrations (number, name) VALUES (?, ?)",
                    (migration.number, migration.name),
                )
            ran.append(migration.number)
        return ran

    def rollback(self, migrations, to):
        """Undo everything after `to`, newest first."""
        by_number = {m.number: m for m in migrations}
        undone = []
        for number in reversed(self.applied()):
            if number <= to:
                break
            migration = by_number.get(number)
            if migration is None or migration.down is None:
                raise LookupError(f"migration {number} cannot be undone")
            with self.database.transaction():
                migration.down(self.database)
                self.database.execute("DELETE FROM _migrations WHERE number = ?", (number,))
            undone.append(number)
        return undone


class QueryLog:
    """Every statement the database ran, so a test can assert on the count."""

    def __init__(self):
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def record(self, sql, params):
        raise NotImplementedError

    def count(self, containing=None):
        raise NotImplementedError

    def __len__(self):
        return len(self.statements)


def explain(database, query):
    """What sqlite says it will do to answer this, as a list of steps."""
    raise NotImplementedError


def uses_index(database, query):
    """Whether the plan uses an index rather than scanning the table."""
    raise NotImplementedError
~~~

~~~tests
class Author(Model):
    id = Integer(primary_key=True)
    name = Text(null=False)
    objects = Manager()


class Post(Model):
    id = Integer(primary_key=True)
    title = Text(null=False)
    author_id = ForeignKey(Author)
    objects = Manager()


# stage seven still holds
db = Database()
db.create_tables(Author, Post)
Author.objects.bind(db)
Post.objects.bind(db)
ada = Author.objects.create(name="ada")
try:
    with db.transaction():
        raise ValueError("no")
except ValueError:
    pass
assert Author.objects.count() == 1

for i in range(20):
    Post.objects.create(title=f"post {i}", author_id=ada.id)

# the log records what ran
log = QueryLog()
db.log = log
Post.objects.all()
db.log = None
assert len(log) == 1, f"one select made {len(log)} statements"
assert log.count("SELECT") == 1
assert log.count("INSERT") == 0

# and it is what catches an N+1 before production does
posts = Post.objects.all()

log = QueryLog()
db.log = log
for post in posts:
    Author.objects.get(id=post.author_id)
db.log = None
assert len(log) == 20, f"the naive loop made {len(log)} queries"

log = QueryLog()
db.log = log
load_related(db, posts, "author_id")
db.log = None
assert len(log) == 1, "the batched version should make one query"

# the log carries the parameters too, so a test can see what was asked
log = QueryLog()
db.log = log
Post.objects.filter(title="post 3").all()
db.log = None
assert log.statements[0][1] == ("post 3",)

# EXPLAIN says what the database will do
plan = explain(db, Query(Post))
assert isinstance(plan, list) and plan
assert any("posts" in step for step in plan), plan

# a filter on an unindexed column is a scan
assert not uses_index(db, Query(Post).filter(title="post 3"))

# and with an index it is not
db.execute("CREATE INDEX idx_post_title ON posts(title)")
db.connection.commit()
assert uses_index(db, Query(Post).filter(title="post 3")), explain(db, Query(Post).filter(title="post 3"))

# the primary key is indexed for free, which is why lookups by id are fast
assert uses_index(db, Query(Post).filter(id=1))

# logging is off unless asked for, so it costs nothing in production
assert db.log is None
before = Post.objects.count()
assert before == 20

# and the log works as a context manager, which is how a test would use it
with QueryLog() as log:
    db.log = log
    Post.objects.all()
    db.log = None
assert len(log) == 1
~~~

~~~solution
import contextlib
import sqlite3


class Field:
    """One column. A descriptor, so a model reads like an ordinary object."""

    python_type: type = object
    sql_type = "TEXT"

    def __init__(self, primary_key=False, null=True, default=None):
        self.primary_key = primary_key
        self.null = null
        self.default = default
        self.name = None

    def __set_name__(self, owner, name):
        # unit 20: the descriptor learns the name it was bound to, so the
        # storage name is derived rather than repeated at every declaration
        self.name = name
        self.storage = "_" + name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.storage, self.default)

    def __set__(self, obj, value):
        setattr(obj, self.storage, self.check(value))

    def check(self, value):
        """The value, or a TypeError saying what was wrong with it."""
        if value is None:
            if not self.null and not self.primary_key:
                raise ValueError(f"{self.name} cannot be null")
            return None
        if not isinstance(value, self.python_type):
            raise TypeError(
                f"{self.name} takes {self.python_type.__name__}, "
                f"not {type(value).__name__}"
            )
        return value

    def ddl(self):
        """This column, as it appears in a CREATE TABLE."""
        parts = [self.name, self.sql_type]
        if self.primary_key:
            parts.append("PRIMARY KEY")
        elif not self.null:
            parts.append("NOT NULL")
        return " ".join(parts)


class Integer(Field):
    python_type = int
    sql_type = "INTEGER"

    def check(self, value):
        # bool is an int in Python, and a column of numbers should not quietly
        # accept True. Unit 04 explained the inheritance; this is the cost.
        if isinstance(value, bool):
            raise TypeError(f"{self.name} takes int, not bool")
        return super().check(value)


class Text(Field):
    python_type = str
    sql_type = "TEXT"


class Real(Field):
    python_type = float
    sql_type = "REAL"

    def check(self, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        return super().check(value)


class ModelMeta(type):
    """Collects the fields declared in a class body into the class itself.

    A metaclass rather than __init_subclass__ because the table name is derived
    from the class name and the field map has to exist before anything can use
    the class, which unit 27 gave as the narrow case where a metaclass is right.
    """

    def __new__(mcls, name, bases, namespace, **kwargs):
        fields = {}
        for base in bases:
            fields.update(getattr(base, "fields", {}))
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        if not bases:
            return cls                       # Model itself declares nothing
        cls.fields = fields
        cls.table = namespace.get("table") or name.lower() + "s"
        primary = [k for k, f in fields.items() if f.primary_key]
        if len(primary) > 1:
            raise TypeError(f"{name} declares {len(primary)} primary keys")
        cls.primary_key = primary[0] if primary else None
        return cls


class Model(metaclass=ModelMeta):
    """A row. Subclass it and declare fields."""

    fields: dict = {}
    table = ""
    primary_key = None

    def __init__(self, **values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise TypeError(f"{type(self).__name__} has no field {sorted(unknown)[0]!r}")
        for name in self.fields:
            setattr(self, name, values.get(name, self.fields[name].default))

    def __repr__(self):
        shown = ", ".join(f"{name}={getattr(self, name)!r}" for name in self.fields)
        return f"{type(self).__name__}({shown})"

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return all(getattr(self, n) == getattr(other, n) for n in self.fields)

    def __hash__(self):
        return hash(tuple(getattr(self, n) for n in self.fields))

    @classmethod
    def create_table_sql(cls):
        """The CREATE TABLE for this model."""
        columns = ", ".join(field.ddl() for field in cls.fields.values())
        return f"CREATE TABLE IF NOT EXISTS {cls.table} ({columns})"


OPERATORS = {"eq": "=", "ne": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
             "like": "LIKE", "in": "IN", "isnull": "IS"}


class Query:
    """A SELECT, built up one call at a time and executed at the end.

    Every value goes into a parameter list rather than into the SQL, which is
    the whole defence against injection: the database receives the query and
    the data separately, so nothing a user types can become syntax.
    """

    def __init__(self, model):
        self.model = model
        self.wheres = []
        self.params = []
        self.orders = []
        self._limit = None
        self._offset = None

    def _clone(self):
        other = Query(self.model)
        other.wheres = list(self.wheres)
        other.params = list(self.params)
        other.orders = list(self.orders)
        other._limit, other._offset = self._limit, self._offset
        return other

    def filter(self, **conditions):
        """Narrow the query. Chains, and never mutates the query it came from."""
        out = self._clone()
        for key, value in conditions.items():
            name, _, suffix = key.partition("__")
            if name not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {name!r}")
            operator = OPERATORS.get(suffix or "eq")
            if operator is None:
                raise TypeError(f"unknown lookup {suffix!r}")
            if suffix == "in":
                marks = ", ".join("?" for _ in value)
                out.wheres.append(f"{name} IN ({marks})")
                out.params.extend(value)
            elif suffix == "isnull":
                out.wheres.append(f"{name} IS {'NULL' if value else 'NOT NULL'}")
            else:
                out.wheres.append(f"{name} {operator} ?")
                out.params.append(value)
        return out

    def order_by(self, *names):
        """Sort. A leading minus means descending."""
        out = self._clone()
        for name in names:
            descending = name.startswith("-")
            bare = name[1:] if descending else name
            if bare not in self.model.fields:
                raise TypeError(f"{self.model.__name__} has no field {bare!r}")
            out.orders.append(f"{bare} DESC" if descending else bare)
        return out

    def limit(self, count, offset=None):
        out = self._clone()
        out._limit, out._offset = count, offset
        return out

    def sql(self):
        """The SELECT and its parameters, ready for the driver."""
        columns = ", ".join(self.model.fields)
        parts = [f"SELECT {columns} FROM {self.model.table}"]
        if self.wheres:
            parts.append("WHERE " + " AND ".join(self.wheres))
        if self.orders:
            parts.append("ORDER BY " + ", ".join(self.orders))
        if self._limit is not None:
            parts.append(f"LIMIT {int(self._limit)}")
            if self._offset is not None:
                parts.append(f"OFFSET {int(self._offset)}")
        return " ".join(parts), tuple(self.params)




class Database:
    """A connection, and the models registered against it."""

    def __init__(self, path=":memory:"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.open_transactions = 0
        self.log = None

    def create_tables(self, *models):
        for model in models:
            self.connection.execute(model.create_table_sql())
        self._maybe_commit()

    def _maybe_commit(self):
        """Commit, unless a transaction is open and owns that decision."""
        if not self.open_transactions:
            self.connection.commit()

    def execute(self, sql, params=()):
        if self.log is not None:
            self.log.record(sql, params)
        return self.connection.execute(sql, params)

    def insert(self, row):
        """Write a row, and fill in the primary key the database assigned."""
        model = type(row)
        names = [n for n in model.fields
                 if not (n == model.primary_key and getattr(row, n) is None)]
        marks = ", ".join("?" for _ in names)
        values = [getattr(row, n) for n in names]
        cursor = self.execute(
            f"INSERT INTO {model.table} ({', '.join(names)}) VALUES ({marks})", values
        )
        if model.primary_key and getattr(row, model.primary_key) is None:
            setattr(row, model.primary_key, cursor.lastrowid)
        self._maybe_commit()
        return row

    def update(self, row):
        """Write a row's current values back, matched on its primary key."""
        model = type(row)
        if not model.primary_key:
            raise TypeError(f"{model.__name__} has no primary key to update by")
        key = getattr(row, model.primary_key)
        if key is None:
            raise ValueError("this row has never been saved")
        names = [n for n in model.fields if n != model.primary_key]
        assignments = ", ".join(f"{n} = ?" for n in names)
        values = [getattr(row, n) for n in names] + [key]
        self.execute(
            f"UPDATE {model.table} SET {assignments} WHERE {model.primary_key} = ?",
            values,
        )
        self._maybe_commit()
        return row

    def delete(self, row):
        model = type(row)
        key = getattr(row, model.primary_key)
        self.execute(
            f"DELETE FROM {model.table} WHERE {model.primary_key} = ?", (key,)
        )
        self._maybe_commit()

    @contextlib.contextmanager
    def transaction(self):
        """Everything in the block, or nothing.

        Unit 22's protocol: __exit__ runs whatever happens, so the rollback is
        in the failure path and the commit is in the success path, and there is
        no way to leave the block having done half of it.
        """
        self.open_transactions += 1
        try:
            yield self
        except BaseException:
            self.open_transactions -= 1
            self.connection.rollback()
            raise
        self.open_transactions -= 1
        self._maybe_commit()

    def select(self, query):
        """Run a query and rebuild rows from what came back."""
        sql, params = query.sql()
        rows = self.execute(sql, params).fetchall()
        return [query.model(**dict(row)) for row in rows]


class Manager:
    """The bridge between a model class and a database.

    A non-data descriptor, so `User.objects` on the class gives a manager bound
    to that model and the instance dict could still shadow it. Unit 20's
    protocol, used the way Django uses it.
    """

    def __init__(self, database=None):
        self.database = database
        self.model = None

    def __set_name__(self, owner, name):
        self.model = owner

    def __get__(self, obj, objtype=None):
        if objtype is not None and self.model is None:
            self.model = objtype
        return self

    def bind(self, database):
        self.database = database
        return self

    def _query(self):
        if self.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        return Query(self.model)

    def all(self):
        query = self._query()
        return self.database.select(query)

    def filter(self, **conditions):
        return BoundQuery(self.database, self._query().filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self._query().order_by(*names))

    def get(self, **conditions):
        """Exactly one row, or an exception saying which way it went wrong."""
        rows = self.database.select(self._query().filter(**conditions))
        if not rows:
            raise DoesNotExist(f"no {self.model.__name__} matching {conditions}")
        if len(rows) > 1:
            raise MultipleFound(f"{len(rows)} rows matching {conditions}")
        return rows[0]

    def create(self, **values):
        return self.database.insert(self.model(**values))

    def count(self):
        return len(self.all())


class BoundQuery:
    """A query that knows its database, so it can run itself."""

    def __init__(self, database, query):
        self.database = database
        self.query = query

    def filter(self, **conditions):
        return BoundQuery(self.database, self.query.filter(**conditions))

    def order_by(self, *names):
        return BoundQuery(self.database, self.query.order_by(*names))

    def limit(self, count, offset=None):
        return BoundQuery(self.database, self.query.limit(count, offset))

    def all(self):
        return self.database.select(self.query)

    def first(self):
        rows = self.database.select(self.query.limit(1))
        return rows[0] if rows else None

    def count(self):
        return len(self.all())

    def __iter__(self):
        return iter(self.all())

    def __len__(self):
        return len(self.all())


class DoesNotExist(LookupError):
    """No row matched."""


class MultipleFound(LookupError):
    """More than one row matched where one was expected."""


class ForeignKey(Field):
    """A reference to another model's primary key."""

    python_type = int
    sql_type = "INTEGER"

    def __init__(self, to, related_name=None, **kwargs):
        super().__init__(**kwargs)
        self.to = to
        self.related_name = related_name

    def __set_name__(self, owner, name):
        super().__set_name__(owner, name)
        related = self.related_name or owner.__name__.lower() + "s"
        setattr(self.to, related, RelatedSet(owner, name))

    def ddl(self):
        base = super().ddl()
        return f"{base} REFERENCES {self.to.table}({self.to.primary_key})"


class RelatedSet:
    """The rows on the many side of a foreign key, reached from the one side."""

    def __init__(self, model, column):
        self.model = model
        self.column = column

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        manager = getattr(self.model, "objects", None)
        if manager is None or manager.database is None:
            raise RuntimeError(f"{self.model.__name__}.objects is not bound to a database")
        key = getattr(obj, type(obj).primary_key)
        return BoundQuery(manager.database, Query(self.model).filter(**{self.column: key}))


def load_related(database, rows, column):
    """Fetch every row's related object in one query rather than one each.

    The N+1 problem, and its fix. Unit 35 named the shape: a round trip per row
    where one would do, and the tell in a profile is a large call count against
    a small tottime.
    """
    if not rows:
        return {}
    field = type(rows[0]).fields[column]
    keys = sorted({getattr(row, column) for row in rows if getattr(row, column) is not None})
    if not keys:
        return {}
    related = database.select(
        Query(field.to).filter(**{f"{field.to.primary_key}__in": keys})
    )
    return {getattr(r, field.to.primary_key): r for r in related}




class Migration:
    """One numbered change to the schema, and how to undo it."""

    def __init__(self, number, name, up, down=None):
        self.number = number
        self.name = name
        self.up = up
        self.down = down


MIGRATION_TABLE = (
    "CREATE TABLE IF NOT EXISTS _migrations "
    "(number INTEGER PRIMARY KEY, name TEXT NOT NULL)"
)


class Migrator:
    """Applies migrations once each, in order, recording what it has done."""

    def __init__(self, database):
        self.database = database
        self.database.execute(MIGRATION_TABLE)
        self.database.connection.commit()

    def applied(self):
        rows = self.database.execute("SELECT number FROM _migrations ORDER BY number")
        return [row[0] for row in rows.fetchall()]

    def apply(self, migrations):
        """Run everything not yet applied, in order. Returns what it ran."""
        done = set(self.applied())
        ran = []
        for migration in sorted(migrations, key=lambda m: m.number):
            if migration.number in done:
                continue
            with self.database.transaction():
                migration.up(self.database)
                self.database.execute(
                    "INSERT INTO _migrations (number, name) VALUES (?, ?)",
                    (migration.number, migration.name),
                )
            ran.append(migration.number)
        return ran

    def rollback(self, migrations, to):
        """Undo everything after `to`, newest first."""
        by_number = {m.number: m for m in migrations}
        undone = []
        for number in reversed(self.applied()):
            if number <= to:
                break
            migration = by_number.get(number)
            if migration is None or migration.down is None:
                raise LookupError(f"migration {number} cannot be undone")
            with self.database.transaction():
                migration.down(self.database)
                self.database.execute("DELETE FROM _migrations WHERE number = ?", (number,))
            undone.append(number)
        return undone


class QueryLog:
    """Every statement the database ran, so a test can assert on the count."""

    def __init__(self):
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def record(self, sql, params):
        self.statements.append((sql, tuple(params)))

    def count(self, containing=None):
        if containing is None:
            return len(self.statements)
        return sum(1 for sql, _ in self.statements if containing in sql)

    def __len__(self):
        return len(self.statements)


def explain(database, query):
    """What sqlite says it will do to answer this, as a list of steps."""
    sql, params = query.sql()
    rows = database.execute(f"EXPLAIN QUERY PLAN {sql}", params).fetchall()
    return [row[-1] for row in rows]


def uses_index(database, query):
    """Whether the plan searches rather than scans.

    SEARCH means sqlite can jump straight to the rows; SCAN means it reads the
    whole table. The primary key reports as "USING INTEGER PRIMARY KEY" rather
    than naming an index, which is the same thing said differently, so the
    question to ask the plan is SEARCH against SCAN.
    """
    return any(step.startswith("SEARCH") for step in explain(database, query))
~~~
