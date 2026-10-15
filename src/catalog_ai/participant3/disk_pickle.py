"""Restricted pickle interpreter with disk-backed memo and containers.

Unlike the small prefix reader, old strings, dicts and list elements live on
disk. Container references preserve shared objects; no GLOBAL/REDUCE/imports
are evaluated. The scratch database is disposable, not training input.
"""
from __future__ import annotations

import json
import pickletools
import sqlite3
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from .pickle_stream import UnsafePickleError
from .object_store import AppendObjects


@dataclass(frozen=True)
class Ref:
    node: int


def pack(value):
    if isinstance(value, Ref):
        return {'$node': value.node}
    if isinstance(value, bytes):
        raise UnsafePickleError('Binary scalar unsupported in organizer catalog')
    return value


def unpack(value):
    if isinstance(value, dict) and set(value) == {'$node'}:
        return Ref(value['$node'])
    return value


class DiskObjects:
    def __init__(self, path, cache_size=20000):
        self.db = sqlite3.connect(path)
        self.db.executescript('''
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            PRAGMA cache_size=-16384;
            CREATE TABLE memo (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE nodes (id INTEGER PRIMARY KEY, kind TEXT, value TEXT, length INTEGER DEFAULT 0);
            CREATE TABLE items (node INTEGER, pos INTEGER, value TEXT, PRIMARY KEY(node,pos)) WITHOUT ROWID;
        ''')
        self.memo_size = 0
        self.next_node = 0
        self.cache_size = cache_size
        self.memo_cache = OrderedDict()
        self.node_cache = OrderedDict()
        self.writes = 0

    def _cache(self, cache, key, value):
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > self.cache_size:
            cache.popitem(last=False)

    def tick(self):
        self.writes += 1
        if self.writes % 20000 == 0:
            self.db.commit()

    def new(self, kind):
        self.next_node += 1
        ref = Ref(self.next_node)
        value = {} if kind == 'dict' else 0
        self.db.execute('INSERT INTO nodes(id,kind,value) VALUES(?,?,?)',
                        (ref.node, kind, '{}' if kind == 'dict' else None))
        self._cache(self.node_cache, ref.node, (kind, value))
        self.tick()
        return ref

    def get(self, ref):
        if not isinstance(ref, Ref):
            raise UnsafePickleError('Container reference expected')
        if ref.node in self.node_cache:
            result = self.node_cache[ref.node]
            self.node_cache.move_to_end(ref.node)
            return result
        row = self.db.execute('SELECT kind,value,length FROM nodes WHERE id=?', (ref.node,)).fetchone()
        if row is None:
            raise UnsafePickleError('Unknown container')
        kind, value, length = row
        result = (kind, json.loads(value) if kind == 'dict' else length)
        self._cache(self.node_cache, ref.node, result)
        return result

    def update(self, ref, pairs):
        kind, value = self.get(ref)
        if kind != 'dict' or len(pairs) % 2:
            raise UnsafePickleError('Invalid dictionary operands')
        for key, item in zip(pairs[::2], pairs[1::2]):
            if not isinstance(key, str):
                raise UnsafePickleError('Organizer dictionary keys must be strings')
            value[key] = pack(item)
        self.db.execute('UPDATE nodes SET value=? WHERE id=?',
                        (json.dumps(value, ensure_ascii=False), ref.node))
        self.tick()
        return value

    def append(self, ref, values):
        kind, length = self.get(ref)
        if kind not in {'list', 'tuple'}:
            raise UnsafePickleError('List operands expected')
        self.db.executemany('INSERT INTO items(node,pos,value) VALUES(?,?,?)',
                            ((ref.node, length + i, json.dumps(pack(v), ensure_ascii=False))
                             for i, v in enumerate(values)))
        length += len(values)
        self.db.execute('UPDATE nodes SET length=? WHERE id=?', (length, ref.node))
        self._cache(self.node_cache, ref.node, (kind, length))
        self.tick()

    def memo_put(self, index, value, sequential=False):
        if sequential:
            self.memo_size += 1
        elif not self.db.execute('SELECT 1 FROM memo WHERE id=?', (index,)).fetchone():
            self.memo_size += 1
        self.db.execute('INSERT OR REPLACE INTO memo VALUES(?,?)',
                        (index, json.dumps(pack(value), ensure_ascii=False)))
        self._cache(self.memo_cache, index, value)
        self.tick()

    def memo_get(self, index):
        if index in self.memo_cache:
            self.memo_cache.move_to_end(index)
            return self.memo_cache[index]
        row = self.db.execute('SELECT value FROM memo WHERE id=?', (index,)).fetchone()
        if row is None:
            raise UnsafePickleError(f'Unknown memo index {index}')
        value = unpack(json.loads(row[0]))
        self._cache(self.memo_cache, index, value)
        return value

    def materialize(self, value, ancestors=None):
        if not isinstance(value, Ref):
            return value
        ancestors = set() if ancestors is None else ancestors
        if value.node in ancestors:
            raise UnsafePickleError('Cyclic organizer value')
        ancestors = ancestors | {value.node}
        kind, content = self.get(value)
        if kind == 'dict':
            return {k: self.materialize(unpack(v), ancestors) for k, v in content.items()}
        rows = self.db.execute('SELECT value FROM items WHERE node=? ORDER BY pos', (value.node,))
        items = [self.materialize(unpack(json.loads(row[0])), ancestors) for row in rows]
        return tuple(items) if kind == 'tuple' else items

    def close(self):
        self.db.commit()
        self.db.close()


def iter_catalog(path, scratch, *, limit=None, progress=None):
    """Yield complete canonical-pickler offer dictionaries using bounded caches.

    Each yielded offer is a snapshot. The supported organizer format constructs
    offers once; executable opcodes, recursive offers and non-string keys fail.
    Scratch must be a new path; reruns cannot silently reuse a partial memo.
    """
    path, scratch = Path(path), Path(scratch)
    if scratch.exists():
        raise FileExistsError(f'Remove incomplete scratch explicitly: {scratch}')
    scratch.parent.mkdir(parents=True, exist_ok=True)
    objects = AppendObjects(scratch)
    marker = object()
    stack = []
    emitted = 0
    stopped = False

    def tail():
        for i in range(len(stack) - 1, -1, -1):
            if stack[i] is marker:
                values = stack[i + 1:]
                del stack[i:]
                return values
        raise UnsafePickleError('MARK missing')

    try:
        with path.open('rb') as handle:
            for opcode, arg, position in pickletools.genops(handle):
                name = opcode.name
                completed = None
                if name in {'PROTO', 'FRAME'}:
                    continue
                if name == 'MARK':
                    stack.append(marker)
                elif name in {'EMPTY_DICT', 'EMPTY_LIST', 'EMPTY_TUPLE'}:
                    stack.append(objects.new({'EMPTY_DICT': 'dict', 'EMPTY_LIST': 'list', 'EMPTY_TUPLE': 'tuple'}[name]))
                elif name == 'NONE':
                    stack.append(None)
                elif name in {'NEWTRUE', 'NEWFALSE'}:
                    stack.append(name == 'NEWTRUE')
                elif name in {'SHORT_BINUNICODE', 'BINUNICODE', 'BINUNICODE8', 'UNICODE',
                              'BININT', 'BININT1', 'BININT2', 'INT', 'LONG', 'LONG1', 'LONG4', 'BINFLOAT', 'FLOAT'}:
                    stack.append(arg)
                elif name == 'MEMOIZE':
                    objects.memo_put(objects.memo_size, stack[-1], sequential=True)
                elif name in {'BINPUT', 'LONG_BINPUT', 'PUT'}:
                    objects.memo_put(int(arg), stack[-1])
                elif name in {'BINGET', 'LONG_BINGET', 'GET'}:
                    stack.append(objects.memo_get(int(arg)))
                elif name in {'SETITEM', 'SETITEMS'}:
                    pairs = tail() if name == 'SETITEMS' else stack[-2:]
                    if name == 'SETITEM':
                        del stack[-2:]
                    content = objects.update(stack[-1], pairs)
                    if '@id' in content and 'name' in content and any(k in content for k in ['param', 'vendor', 'model']):
                        completed = objects.materialize(stack[-1])
                elif name in {'APPEND', 'APPENDS'}:
                    values = tail() if name == 'APPENDS' else [stack.pop()]
                    objects.append(stack[-1], values)
                elif name in {'DICT', 'LIST', 'TUPLE'}:
                    values = tail()
                    ref = objects.new(name.lower())
                    if name == 'DICT':
                        objects.update(ref, values)
                    else:
                        objects.append(ref, values)
                    stack.append(ref)
                elif name in {'TUPLE1', 'TUPLE2', 'TUPLE3'}:
                    n = int(name[-1])
                    values = stack[-n:]
                    del stack[-n:]
                    ref = objects.new('tuple')
                    objects.append(ref, values)
                    stack.append(ref)
                elif name == 'STOP':
                    stopped = True
                    break
                else:
                    raise UnsafePickleError(f'Unsupported opcode {name} at {position}; executable pickle disabled')
                if completed is not None:
                    emitted += 1
                    if progress and emitted % 2000 == 0:
                        progress(emitted, position)
                    yield completed
                    if limit and emitted >= limit:
                        return
        if not stopped:
            raise UnsafePickleError('Catalog did not reach STOP')
        if progress:
            progress(emitted, path.stat().st_size)
    finally:
        objects.close()
