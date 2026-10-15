from __future__ import annotations

import json
import math
from catalog_ai.confidence.policy import ConfidencePolicy
from catalog_ai.extractors.transformer import as_mapping


def evidence_valid(card: dict, candidate: dict) -> bool:
    evidence = candidate.get("evidence") or []
    if not evidence:
        return False
    for item in evidence:
        try:
            parts = item["field"].split(".")
            value = card
            for part in parts:
                value = value[int(part)] if isinstance(value, list) else value[part]
            start, end = item["start"], item["end"]
            if not isinstance(value, str) or not isinstance(start, int) or not isinstance(end, int):
                return False
            if start < 0 or end <= start or end > len(value) or value[start:end] != item["quote"]:
                return False
        except (KeyError, IndexError, ValueError, TypeError):
            return False
    return True


def resolve_and_score(card, schema, validated, method="transformer", policy=None):
    """Requires upstream semantic grounding and canonical normalization from #2.

    An evidence-substring check here is a second mechanical guard, not a claim of
    semantic verification. Auto acceptance is OFF until a reviewed policy exists.
    """
    card = as_mapping(card)
    schema = as_mapping(schema)
    attrs = schema.get("attributes", [])
    if isinstance(attrs, dict):
        attrs = list(attrs)
    else:
        attrs = [a if isinstance(a, str) else as_mapping(a)["attribute_id"] for a in attrs]
    policy = policy or ConfidencePolicy()
    grouped = {a: {} for a in attrs}
    for original in validated:
        c = as_mapping(original)
        attr = c["attribute_id"]
        if attr not in grouped or not evidence_valid(card, c):
            continue
        # No implicit normalizer inside resolver: raw candidates are not canonical.
        if "value" not in c or c["value"] is None or not c.get("normalization_id"):
            continue
        if not isinstance(c["value"], (str, int, float)) or isinstance(c["value"], bool):
            continue
        if isinstance(c["value"], float) and not math.isfinite(c["value"]):
            continue
        score, kind = policy.score(c, method)
        entry = {**c, "confidence": score, "confidence_kind": kind}
        entry["supporting_sources"] = [c["source"]]
        key = json.dumps([c["value"], c.get("unit")], ensure_ascii=False)
        current = grouped[attr].get(key)
        if current is None:
            grouped[attr][key] = entry
        else:
            better = score is not None and (current["confidence"] is None or score > current["confidence"])
            chosen = entry if better else current
            proofs = {json.dumps(e, sort_keys=True, ensure_ascii=False): e
                      for e in [*current["evidence"], *entry["evidence"]]}
            chosen["evidence"] = list(proofs.values())
            chosen["supporting_sources"] = sorted(set(current["supporting_sources"] + entry["supporting_sources"]))
            chosen["source"] = "hybrid" if len(chosen["supporting_sources"]) > 1 else chosen["supporting_sources"][0]
            grouped[attr][key] = chosen  # repeated evidence never boosts score
    result = []
    for attr in attrs:
        options = list(grouped[attr].values())
        base = {"attribute_id": attr, "value": None, "unit": None,
                "confidence": None, "confidence_kind": "none", "source": "none",
                "status": "missing", "reason": "no_validated_candidate", "evidence": [], "alternatives": []}
        if len(options) > 1:
            base.update(status="review", reason="conflicting_values", alternatives=options)
        elif len(options) == 1:
            c = options[0]
            accept = policy.auto_accept and c["confidence"] is not None and c["confidence"] >= policy.threshold(method, attr)
            base.update(value=c["value"], unit=c.get("unit"), confidence=c["confidence"],
                        confidence_kind=c["confidence_kind"], source=c["source"],
                        evidence=c["evidence"], status="accepted" if accept else "review",
                        reason="threshold_passed" if accept else "policy_requires_review")
        result.append(base)
    return result
