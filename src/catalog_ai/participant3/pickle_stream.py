"""Read simple YML dictionaries without executing pickle GLOBAL/REDUCE opcodes.

This deliberately bounded prefix reader is for a local pilot, NOT a full-file
sampler. Memoized objects are retained for correctness, so limit must be finite.
The original 1.5 GB catalog is never unpickled into memory.
"""
from __future__ import annotations

import pickletools
from collections.abc import Iterator
from pathlib import Path
from typing import Any


class UnsafePickleError(ValueError):
    pass


def iter_offers(path: str | Path, limit: int = 5000,
                categories: dict[str, dict] | None = None,
                max_bytes: int = 256 * 1024 * 1024) -> Iterator[dict[str, Any]]:
    if limit <= 0 or max_bytes <= 0:
        raise ValueError("A finite positive limit and byte budget are required")
    marker = object()
    stack: list[Any] = []
    memo: dict[int, Any] = {}
    emitted = 0

    def tail() -> list:
        for index in range(len(stack) - 1, -1, -1):
            if stack[index] is marker:
                values = stack[index + 1:]
                del stack[index:]
                return values
        raise UnsafePickleError("MARK missing")

    def completed(value: Any):
        if not isinstance(value, dict):
            return None
        if categories is not None and "@id" in value and "#text" in value and "name" not in value:
            categories[str(value["@id"])] = dict(value)
        if "@id" in value and "name" in value and ("param" in value or "vendor" in value or "model" in value):
            return value
        return None

    with Path(path).open("rb") as stream:
        for opcode, arg, position in pickletools.genops(stream):
            if position > max_bytes:
                raise ValueError(f"Catalog prefix exceeded byte budget {max_bytes}; increase explicitly")
            name = opcode.name
            offer = None
            if name in {"PROTO", "FRAME"}:
                continue
            if name == "MARK":
                stack.append(marker)
            elif name == "EMPTY_DICT":
                stack.append({})
            elif name == "EMPTY_LIST":
                stack.append([])
            elif name == "EMPTY_TUPLE":
                stack.append(())
            elif name == "NONE":
                stack.append(None)
            elif name == "NEWTRUE":
                stack.append(True)
            elif name == "NEWFALSE":
                stack.append(False)
            elif name in {"SHORT_BINUNICODE", "BINUNICODE", "BINUNICODE8", "UNICODE",
                          "BININT", "BININT1", "BININT2", "INT", "LONG", "LONG1", "LONG4",
                          "BINFLOAT", "FLOAT", "SHORT_BINBYTES", "BINBYTES", "BINBYTES8"}:
                stack.append(arg)
            elif name == "MEMOIZE":
                memo[len(memo)] = stack[-1]
            elif name in {"BINPUT", "LONG_BINPUT", "PUT"}:
                memo[int(arg)] = stack[-1]
            elif name in {"BINGET", "LONG_BINGET", "GET"}:
                stack.append(memo[int(arg)])
            elif name == "SETITEM":
                value, key = stack.pop(), stack.pop()
                stack[-1][key] = value
                offer = completed(stack[-1])
            elif name == "SETITEMS":
                pairs = tail()
                if len(pairs) % 2:
                    raise UnsafePickleError("Odd number of dictionary operands")
                stack[-1].update(zip(pairs[::2], pairs[1::2]))
                offer = completed(stack[-1])
            elif name == "APPEND":
                value = stack.pop()
                stack[-1].append(value)
            elif name == "APPENDS":
                values = tail()
                stack[-1].extend(values)
            elif name == "DICT":
                pairs = tail()
                stack.append(dict(zip(pairs[::2], pairs[1::2])))
            elif name == "LIST":
                stack.append(tail())
            elif name == "TUPLE":
                stack.append(tuple(tail()))
            elif name in {"TUPLE1", "TUPLE2", "TUPLE3"}:
                n = int(name[-1])
                values = stack[-n:]
                del stack[-n:]
                stack.append(tuple(values))
            elif name == "STOP":
                break
            else:
                raise UnsafePickleError(f"Unsupported opcode {name} at {position}; executable pickle disabled")
            if offer is not None:
                emitted += 1
                yield offer
                if emitted >= limit:
                    return
