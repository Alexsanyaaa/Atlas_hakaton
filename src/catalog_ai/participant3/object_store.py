"""Append-only scratch object store; RAM holds numeric offsets, not catalog text."""
from __future__ import annotations

import json
import struct
from array import array
from collections import OrderedDict

from .pickle_stream import UnsafePickleError


class AppendObjects:
    def __init__(self, path, cache_size=20000):
        from .disk_pickle import Ref
        self.Ref = Ref
        self.writer = open(path, 'w+b', buffering=1024 * 1024)
        self.writer.write(b'\0')
        self.reader = open(path, 'rb', buffering=1024 * 1024)
        self.flushed = 0
        self.memo_offsets = array('Q')
        self.node_offsets = array('Q', [0])
        self.memo_size = 0
        self.cache_size = cache_size
        self.memo_cache, self.node_cache = OrderedDict(), OrderedDict()

    def _cache(self, cache, key, value):
        cache[key] = value
        cache.move_to_end(key)
        if len(cache) > self.cache_size:
            cache.popitem(last=False)

    def pack(self, value):
        if isinstance(value, self.Ref):
            return {'$node': value.node}
        return value

    def unpack(self, value):
        if isinstance(value, dict) and set(value) == {'$node'}:
            return self.Ref(value['$node'])
        return value

    def write(self, value):
        data = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
        offset = self.writer.tell()
        self.writer.write(struct.pack('<I', len(data)))
        self.writer.write(data)
        return offset

    def read(self, offset):
        if not offset:
            raise UnsafePickleError('Unknown object offset')
        if offset >= self.flushed:
            self.writer.flush()
            self.flushed = self.writer.tell()
        self.reader.seek(offset)
        length = struct.unpack('<I', self.reader.read(4))[0]
        return json.loads(self.reader.read(length))

    def new(self, kind):
        node = len(self.node_offsets)
        if node >= 50_000_000:
            raise UnsafePickleError('Organizer object budget exceeded')
        state = {} if kind == 'dict' else {'length': 0, 'last': 0}
        self.node_offsets.append(self.write([kind, state]))
        self._cache(self.node_cache, node, (kind, state))
        return self.Ref(node)

    def get(self, ref):
        if not isinstance(ref, self.Ref):
            raise UnsafePickleError('Container reference expected')
        if ref.node in self.node_cache:
            self.node_cache.move_to_end(ref.node)
            return self.node_cache[ref.node]
        kind, state = self.read(self.node_offsets[ref.node])
        self._cache(self.node_cache, ref.node, (kind, state))
        return kind, state

    def update(self, ref, pairs):
        kind, state = self.get(ref)
        if kind != 'dict' or len(pairs) % 2:
            raise UnsafePickleError('Invalid dictionary operands')
        for key, value in zip(pairs[::2], pairs[1::2]):
            if not isinstance(key, str):
                raise UnsafePickleError('Organizer dictionary keys must be strings')
            state[key] = self.pack(value)
        self.node_offsets[ref.node] = self.write([kind, state])
        return state

    def append(self, ref, values):
        kind, state = self.get(ref)
        if kind not in {'list', 'tuple'}:
            raise UnsafePickleError('List operands expected')
        chunk = self.write({'previous': state['last'], 'values': [self.pack(v) for v in values]})
        state['last'] = chunk
        state['length'] += len(values)
        self.node_offsets[ref.node] = self.write([kind, state])

    def memo_put(self, index, value, sequential=False):
        if index < 0 or index >= 50_000_000:
            raise UnsafePickleError('Organizer memo budget exceeded')
        if index >= len(self.memo_offsets):
            self.memo_offsets.extend([0] * (index + 1 - len(self.memo_offsets)))
        if not self.memo_offsets[index]:
            self.memo_size += 1
        self.memo_offsets[index] = self.write(self.pack(value))
        self._cache(self.memo_cache, index, value)

    def memo_get(self, index):
        if index in self.memo_cache:
            self.memo_cache.move_to_end(index)
            return self.memo_cache[index]
        if index >= len(self.memo_offsets):
            raise UnsafePickleError('Unknown memo index')
        value = self.unpack(self.read(self.memo_offsets[index]))
        self._cache(self.memo_cache, index, value)
        return value

    def materialize(self, value, ancestors=None):
        if not isinstance(value, self.Ref):
            return value
        ancestors = set() if ancestors is None else ancestors
        if value.node in ancestors:
            raise UnsafePickleError('Cyclic organizer value')
        ancestors = ancestors | {value.node}
        kind, state = self.get(value)
        if kind == 'dict':
            return {k: self.materialize(self.unpack(v), ancestors) for k, v in state.items()}
        chunks = []
        last = state['last']
        while last:
            chunk = self.read(last)
            chunks.append(chunk['values'])
            last = chunk['previous']
        items = [self.materialize(self.unpack(v), ancestors) for chunk in reversed(chunks) for v in chunk]
        return tuple(items) if kind == 'tuple' else items

    def close(self):
        self.writer.close()
        self.reader.close()
