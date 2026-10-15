"""Standalone conditioned token classifier; no rule/LLM fallback.

Public boundary uses JSON-compatible contract v2 dictionaries until participant
1's shared ProductCard/Candidate classes are supplied. Pydantic inputs work too.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from catalog_ai.participant3.bio import encode_pair, query_for, decode_spans
from catalog_ai.participant3.prepare import ATTRIBUTES


def as_mapping(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, dict):
        return value
    if hasattr(value, "__dict__"):
        return vars(value)
    raise TypeError("Expected a mapping or ProductCard-compatible object")


class TransformerExtractor:
    name = "transformer"

    def __init__(self, checkpoint, device=None, max_length=128, stride=32,
                 batch_size=8, max_windows_per_field=64, threads=2):
        import torch
        from transformers import AutoTokenizer, AutoModelForTokenClassification
        torch.set_num_threads(threads)
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.tokenizer = AutoTokenizer.from_pretrained(checkpoint, use_fast=True, trust_remote_code=False)
        self.model = AutoModelForTokenClassification.from_pretrained(
            checkpoint, use_safetensors=True, trust_remote_code=False).to(self.device).eval()
        self.max_length, self.stride = max_length, stride
        self.batch_size, self.max_windows = batch_size, max_windows_per_field
        self.extractor_id = f"conditioned-bio:{Path(str(checkpoint)).name}"
        task_file = Path(str(checkpoint)) / "task_metadata.json"
        self.task_metadata = json.loads(task_file.read_text()) if task_file.exists() else {}

    def extract(self, card, schema=None, requested_attributes=None):
        started = time.perf_counter()
        try:
            return self._extract(card, schema, requested_attributes)
        except Exception as error:
            # Explicit failure; callers must not interpret it as "no attribute".
            return {"candidates": [], "status": "error", "usage": {},
                    "latency": time.perf_counter() - started,
                    "error": f"{type(error).__name__}: {error}", "warnings": []}

    def _extract(self, card, schema=None, requested_attributes=None):
        import torch
        card = as_mapping(card)
        queries = self.task_metadata.get('attribute_queries')
        supported = set(queries) if queries else set(ATTRIBUTES)
        if requested_attributes is None:
            if schema is None:
                requested_attributes = list(queries) if queries else ATTRIBUTES
            else:
                attrs = as_mapping(schema).get("attributes", [])
                if isinstance(attrs, dict):
                    requested_attributes = list(attrs)
                else:
                    requested_attributes = [a if isinstance(a, str) else as_mapping(a)["attribute_id"] for a in attrs]
        unsupported = [a for a in requested_attributes if a not in supported]
        pending, warnings, candidates = [], [], []
        if unsupported:
            warnings.append("unsupported_attributes:" + ",".join(unsupported))
        fields = [("title", card.get("title", "")), ("description", card.get("description", ""))]
        for i, item in enumerate(card.get("seller_attributes") or []):
            fields.append((f"seller_attributes.{i}.value", as_mapping(item).get("value", "")))
        started = time.perf_counter()
        for attribute in requested_attributes:
            if attribute not in supported:
                continue
            for field, text in fields:
                if not isinstance(text, str) or not text.strip():
                    continue
                query = query_for(attribute, card.get("category_name") or str(card.get("category_id") or ""),
                                  queries.get(attribute) if queries else None)
                encoded = encode_pair(self.tokenizer, query, text, self.max_length, self.stride)
                count = len(encoded["input_ids"])
                if count > self.max_windows:
                    warnings.append(f"window_limit:{attribute}:{field}:{count}>{self.max_windows}")
                for i in range(min(count, self.max_windows)):
                    pending.append({"attribute": attribute, "field": field, "text": text,
                                    "offsets": encoded["offset_mapping"][i],
                                    "sequence_ids": encoded.sequence_ids(i),
                                    "inputs": {k: encoded[k][i] for k in self.tokenizer.model_input_names if k in encoded}})
        with torch.no_grad():
            for start in range(0, len(pending), self.batch_size):
                items = pending[start:start + self.batch_size]
                batch = self.tokenizer.pad([x["inputs"] for x in items], return_tensors="pt")
                batch = {k: v.to(self.device) for k, v in batch.items()}
                probs = self.model(**batch).logits.softmax(-1).cpu()
                scores, labels = probs.max(-1)
                for i, item in enumerate(items):
                    spans = decode_spans(item["text"], item["offsets"], item["sequence_ids"],
                                        labels[i].tolist(), scores[i].tolist())
                    for span in spans:
                        if item["text"][span["start"]:span["end"]] != span["quote"]:
                            raise AssertionError("Offset/source mismatch")
                        candidates.append({"attribute_id": item["attribute"], "raw_value": span["quote"],
                                           "source": "transformer", "extractor_id": self.extractor_id,
                                           "raw_score": span["raw_score"],
                                           "features": {"score_kind": "uncalibrated_min_token_probability",
                                                        "training_support": self.task_metadata.get("train_examples_by_attribute", {}).get(item["attribute"]),
                                                        "training_supervision": self.task_metadata.get("supervision", "unknown")},
                                           "evidence": [{"field": item["field"], "start": span["start"],
                                                         "end": span["end"], "quote": span["quote"]}]})
        unique = {}
        for c in candidates:
            e = c["evidence"][0]
            key = (c["attribute_id"], e["field"], e["start"], e["end"])
            if key not in unique or c["raw_score"] > unique[key]["raw_score"]:
                unique[key] = c
        return {"candidates": list(unique.values()), "status": "partial" if warnings else "ok",
                "usage": {"windows": len(pending), "model_calls": (len(pending) + self.batch_size - 1) // self.batch_size},
                "latency": time.perf_counter() - started, "error": None, "warnings": warnings}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--attributes", nargs="+", default=ATTRIBUTES)
    p.add_argument("--max-length", type=int, default=128)
    a = p.parse_args()
    extractor = TransformerExtractor(a.checkpoint, max_length=a.max_length)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    with a.input.open(encoding="utf-8") as source, a.output.open("w", encoding="utf-8") as target:
        for i, line in enumerate(source):
            if a.limit and i >= a.limit:
                break
            card = json.loads(line)
            result = extractor.extract(card, requested_attributes=a.attributes)
            target.write(json.dumps({"product_id": card["product_id"], **result}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
