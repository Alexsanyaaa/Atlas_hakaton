"""Attribute-conditioned BIO allows training on partially annotated catalogs.

Each sequence asks for ONE known attribute. Other unknown attributes are not
declared absent. Unaligned attributes are omitted by the preparation adapter.
"""
from __future__ import annotations

import json
import gzip
import random
from collections import defaultdict
from pathlib import Path

from .prepare import QUERIES

ID2LABEL = {0: "O", 1: "B-VALUE", 2: "I-VALUE"}
LABEL2ID = {v: k for k, v in ID2LABEL.items()}


def query_for(attribute: str, category: str = "", attribute_name: str | None = None) -> str:
    return f"Характеристика: {attribute_name or QUERIES.get(attribute, attribute)}. Категория: {category}."


def encode_pair(tokenizer, query, text, max_length, stride):
    query_ids = tokenizer.encode(query, add_special_tokens=False)
    query_ids = query_ids[:max(1, max_length - 20)]
    query = tokenizer.decode(query_ids, skip_special_tokens=True)
    remaining = max_length - len(tokenizer.encode(query, add_special_tokens=False)) - 3
    return tokenizer(query, text, truncation="only_second", max_length=max_length,
                     stride=max(0, min(stride, remaining - 1)),
                     return_offsets_mapping=True, return_overflowing_tokens=True)


def load_records(path: str | Path, maximum: int = 512, fields=("title",), seed=42):
    """Bounded per-attribute reservoir, independent of item ordering."""
    rng = random.Random(seed)
    cap = max(1, maximum // len(QUERIES)) if maximum else 0
    groups, seen = defaultdict(list), defaultdict(int)
    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            if fields and record["field"] not in fields:
                continue
            attr = record["attribute_id"]
            seen[attr] += 1
            bucket = groups[attr]
            if not cap or len(bucket) < cap:
                bucket.append(record)
            else:
                j = rng.randrange(seen[attr])
                if j < cap:
                    bucket[j] = record
    records = [r for attr in sorted(groups) for r in groups[attr]]
    rng.shuffle(records)
    return records


def token_labels(offsets, sequence_ids, spans):
    labels = []
    previous = None
    for (start, end), sequence in zip(offsets, sequence_ids):
        if sequence != 1 or end <= start:
            labels.append(-100)
            previous = None
            continue
        overlaps = [i for i, s in enumerate(spans) if start < s["end"] and s["start"] < end]
        if len(overlaps) != 1:
            labels.append(0 if not overlaps else -100)
            previous = None
            continue
        index = overlaps[0]
        span = spans[index]
        if start < span["start"] or end > span["end"]:
            labels.append(-100)  # a partially aligned token is not a gold token
            previous = None
        else:
            labels.append(2 if previous == index else 1)
            previous = index
    return labels


def encode_records(records, tokenizer, max_length=128, stride=32):
    features = []
    for record in records:
        query = query_for(record["attribute_id"], record.get("category_name", ""), record.get("attribute_name"))
        encoded = encode_pair(tokenizer, query, record["text"], max_length, stride)
        for i, offsets in enumerate(encoded["offset_mapping"]):
            seq_ids = encoded.sequence_ids(i)
            visible = [(a, b) for (a, b), seq in zip(offsets, seq_ids) if seq == 1 and b > a]
            if not visible:
                continue
            lo, hi = visible[0][0], visible[-1][1]
            spans = [s for s in record["spans"] if lo <= s["start"] and s["end"] <= hi]
            if not spans:
                continue  # no invented negative windows from incomplete annotations
            labels = token_labels(offsets, seq_ids, spans)
            if 1 not in labels:
                continue
            inputs = {key: encoded[key][i] for key in tokenizer.model_input_names if key in encoded}
            features.append({"inputs": inputs, "labels": labels, "offsets": offsets,
                             "sequence_ids": seq_ids, "record": record,
                             "gold_spans": spans})
    return features


def collate(features, tokenizer):
    import torch
    batch = tokenizer.pad([x["inputs"] for x in features], return_tensors="pt")
    length = batch["input_ids"].shape[1]
    batch["labels"] = torch.tensor([x["labels"] + [-100] * (length - len(x["labels"]))
                                    for x in features], dtype=torch.long)
    return batch


def decode_spans(text, offsets, sequence_ids, labels, scores):
    result = []
    current = None
    def flush():
        nonlocal current
        if current:
            current["quote"] = text[current["start"]:current["end"]]
            current["raw_score"] = min(current.pop("scores"))
            result.append(current)
            current = None
    for (start, end), seq, label, score in zip(offsets, sequence_ids, labels, scores):
        if seq != 1 or end <= start or label == 0:
            flush()
        elif label == 1 or current is None:
            flush()
            current = {"start": start, "end": end, "scores": [float(score)]}
        else:
            current["end"] = end
            current["scores"].append(float(score))
    flush()
    return result
